import { apiService } from './api.service';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { config } from '../config';
import {
  TimeFrame,
  DetailedError,
  ApiErrorCode,
  CachedCandleData
} from '../types/api.types';

/**
 * QuickChart.io图表配置接口
 */
interface QuickChartConfig {
  symbol: string;
  timeFrame: TimeFrame;
  theme?: 'light' | 'dark';
  width?: number;
  height?: number;
  showVolume?: boolean;
}

/**
 * Chart.js OHLC数据格式 (chartjs-chart-financial)
 */
interface OHLCDataPoint {
  x: number;    // 时间戳 (Unix timestamp in milliseconds)
  o: number;    // 开盘价 (Open)
  h: number;    // 最高价 (High)
  l: number;    // 最低价 (Low)
  c: number;    // 收盘价 (Close)
}

/**
 * Chart.js配置对象
 */
interface ChartJsConfig {
  type: string;
  data: {
    datasets: Array<{
      label: string;
      data: OHLCDataPoint[];
      [key: string]: any;
    }>;
  };
  options: {
    [key: string]: any;
  };
}

/**
 * 图表图像响应接口
 */
interface ChartImageResponse {
  success: boolean;
  imageUrl?: string;
  imageBuffer?: Buffer;
  error?: string;
}

/**
 * 缓存的图表数据
 */
interface CachedChartImage {
  imageBuffer: Buffer;
  imageUrl?: string;
  config: QuickChartConfig;
  generatedAt: Date;
  isCached: boolean;
}

/**
 * Chart图像生成服务类
 * 负责使用QuickChart.io生成专业的K线图表
 */
export class ChartImageService {
  private readonly cacheTTL: number;
  private readonly cacheKeyPrefix: string = 'chart_image_';
  private readonly quickChartApiUrl: string;

  constructor() {
    this.cacheTTL = 300; // 5分钟缓存 (与K线数据缓存同步)
    
    // QuickChart.io API配置
    this.quickChartApiUrl = 'https://quickchart.io/chart';
  }

  /**
   * 生成专业K线图表图像
   * @param symbol 交易对符号
   * @param timeFrame 时间框架
   * @param candleData K线数据 (必需)
   * @returns 图表图像数据
   */
  public async generateTradingViewChart(
    symbol: string,
    timeFrame: TimeFrame,
    candleData?: CachedCandleData
  ): Promise<CachedChartImage> {
    const normalizedSymbol = symbol.toUpperCase().trim();
    const cacheKey = `${this.cacheKeyPrefix}${normalizedSymbol}_${timeFrame}`;
    
    logger.info(`Generating candlestick chart for ${normalizedSymbol} ${timeFrame}`);
    
    try {
      // 检查缓存
      const cachedImage = await cacheService.get<CachedChartImage>(cacheKey);
      if (cachedImage.success && cachedImage.data) {
        logger.info(`Chart image retrieved from cache for ${normalizedSymbol} ${timeFrame}`);
        return {
          ...cachedImage.data,
          isCached: true
        };
      }

      // 验证必需的K线数据
      if (!candleData || !candleData.candles || candleData.candles.length === 0) {
        throw new Error('Candle data is required for chart generation');
      }

      // 构建图表配置
      const chartConfig: QuickChartConfig = {
        symbol: normalizedSymbol,
        timeFrame,
        theme: 'dark',
        width: 800,
        height: 500,
        showVolume: false
      };

      // 生成图表图像
      const imageResult = await this.generateQuickChart(chartConfig, candleData);
      
      if (!imageResult.success || !imageResult.imageBuffer) {
        throw new Error(`Chart image generation failed: ${imageResult.error || 'Unknown error'}`);
      }

      const chartImage: CachedChartImage = {
        imageBuffer: imageResult.imageBuffer,
        imageUrl: imageResult.imageUrl,
        config: chartConfig,
        generatedAt: new Date(),
        isCached: false
      };

      // 缓存图表图像
      await cacheService.set(cacheKey, chartImage, this.cacheTTL);

      logger.info(`Chart image generated successfully for ${normalizedSymbol} ${timeFrame}`, {
        imageSize: imageResult.imageBuffer.length,
        candlesCount: candleData.candles.length,
        config: chartConfig
      });

      return chartImage;

    } catch (error) {
      const detailedError = this.handleChartImageError(error as Error, normalizedSymbol, timeFrame);
      logger.error(`Failed to generate chart image for ${normalizedSymbol} ${timeFrame}`, {
        error: detailedError.message,
        code: detailedError.code
      });
      
      throw detailedError;
    }
  }

  /**
   * 使用QuickChart.io生成K线图表
   */
  private async generateQuickChart(config: QuickChartConfig, candleData: CachedCandleData): Promise<ChartImageResponse> {
    try {
      // 转换K线数据为Chart.js格式
      const chartJsData = this.convertToChartJsFormat(candleData);
      
      // 生成Chart.js配置
      const chartJsConfig = this.createChartJsConfig(config, chartJsData);
      
      // 调用QuickChart.io API
      return await this.callQuickChartApi(chartJsConfig);
      
    } catch (error) {
      logger.error('QuickChart generation failed', {
        error: (error as Error).message,
        config,
        candleCount: candleData.candles.length
      });
      
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * 转换K线数据为Chart.js OHLC格式 (chartjs-chart-financial)
   */
  private convertToChartJsFormat(candleData: CachedCandleData): OHLCDataPoint[] {
    return candleData.candles.map(candle => ({
      x: candle.timestamp * 1000,  // Convert to milliseconds for Chart.js
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close
    }));
  }

  /**
   * 创建Chart.js专业candlestick图表配置 (TradingView风格)
   */
  private createChartJsConfig(config: QuickChartConfig, data: OHLCDataPoint[]): ChartJsConfig {
    const isDark = config.theme === 'dark';
    
    return {
      type: 'candlestick',
      data: {
        datasets: [{
          label: `${config.symbol}/USDT`,
          data: data,
          // TradingView style colors
          color: {
            up: '#26a69a',     // Green for upward movement
            down: '#ef5350',   // Red for downward movement  
            unchanged: '#999999'
          },
          borderColor: {
            up: '#26a69a',
            down: '#ef5350', 
            unchanged: '#999999'
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: this.getTimeUnit(config.timeFrame),
              displayFormats: {
                minute: 'HH:mm',
                hour: 'MM-DD HH:mm',
                day: 'MM-DD',
                week: 'MM-DD'
              }
            },
            grid: {
              display: true,
              color: isDark ? '#2a2e39' : '#e2e8f0',
              drawBorder: true,
              borderColor: isDark ? '#363a45' : '#d1d5db'
            },
            ticks: {
              display: false  // Hide time labels for minimal look
            }
          },
          y: {
            position: 'right',
            grid: {
              display: true,
              color: isDark ? '#2a2e39' : '#e2e8f0',
              drawBorder: true,
              borderColor: isDark ? '#363a45' : '#d1d5db'
            },
            ticks: {
              display: true,  // Show price labels for better trading analysis
              color: isDark ? '#9ca3af' : '#6b7280',
              font: {
                size: 10,
                family: 'Inter, sans-serif'
              },
              maxTicksLimit: 7,  // Optimal number of price levels
              callback: (value: any) => {
                return this.formatPrice(Number(value));
              }
            }
          }
        },
        plugins: {
          title: {
            display: false  // Remove title for clean appearance
          },
          legend: {
            display: false
          },
          tooltip: {
            enabled: false  // Disable tooltips for clean minimal chart
          }
        },
        layout: {
          padding: {
            top: 5,
            right: 50,  // Add space for price labels on right side
            bottom: 5,
            left: 5
          }
        },
        // TradingView style background
        backgroundColor: isDark ? '#0d1421' : '#ffffff',
        color: isDark ? '#ffffff' : '#0f172a'
      }
    };
  }

  /**
   * 调用QuickChart.io API生成专业K线图表图像
   */
  private async callQuickChartApi(chartConfig: ChartJsConfig): Promise<ChartImageResponse> {
    try {
      // 使用POST方法发送配置，启用Chart.js v3和财务插件
      const requestBody = {
        chart: chartConfig,
        width: 800,
        height: 500,
        format: 'png',
        backgroundColor: '#0d1421', // TradingView dark background
        version: '3',  // Use Chart.js v3 for candlestick support
        encoding: 'base64'
      };

      const response = await fetch(this.quickChartApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AIW3-TGBot/2.0.0 (Candlestick)'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`QuickChart API error: ${response.status} - ${errorText.substring(0, 200)}`);
      }

      const imageBuffer = Buffer.from(await response.arrayBuffer());
      
      return {
        success: true,
        imageBuffer,
        imageUrl: this.quickChartApiUrl
      };

    } catch (error) {
      throw new Error(`QuickChart candlestick API failed: ${(error as Error).message}`);
    }
  }

  /**
   * 获取时间单位用于Chart.js时间轴
   */
  private getTimeUnit(timeFrame: TimeFrame): string {
    const timeUnitMap: { [key in TimeFrame]: string } = {
      '1m': 'minute',
      '5m': 'minute',
      '15m': 'minute',
      '1h': 'hour',
      '4h': 'hour',
      '1d': 'day'
    };

    return timeUnitMap[timeFrame] || 'hour';
  }

  /**
   * 格式化时间范围显示文本
   */
  private formatTimeFrameDisplay(timeFrame: TimeFrame): string {
    const displayMap: { [key in TimeFrame]: string } = {
      '1m': '1分钟',
      '5m': '5分钟',
      '15m': '15分钟', 
      '1h': '1小时',
      '4h': '4小时',
      '1d': '日线'
    };

    return displayMap[timeFrame] || timeFrame;
  }

  /**
   * 清除特定交易对的图表缓存
   */
  public async clearChartImageCache(symbol: string, timeFrame?: TimeFrame): Promise<boolean> {
    const normalizedSymbol = symbol.toUpperCase().trim();
    
    let pattern: string;
    if (timeFrame) {
      pattern = `${this.cacheKeyPrefix}${normalizedSymbol}_${timeFrame}`;
    } else {
      pattern = `${this.cacheKeyPrefix}${normalizedSymbol}_*`;
    }
    
    const keysResult = await cacheService.keys(pattern);
    
    if (!keysResult.success || !keysResult.data) {
      logger.warn(`Failed to get chart image cache keys for ${normalizedSymbol}`, { 
        error: keysResult.error 
      });
      return false;
    }

    let successCount = 0;
    for (const key of keysResult.data) {
      const deleteResult = await cacheService.delete(key);
      if (deleteResult.success) {
        successCount++;
      }
    }

    logger.info(`Cleared ${successCount}/${keysResult.data.length} chart image cache entries for ${normalizedSymbol}`);
    return successCount === keysResult.data.length;
  }

  /**
   * 处理图表图像相关错误
   */
  private handleChartImageError(error: Error, symbol: string, timeFrame: TimeFrame): DetailedError {
    let code: ApiErrorCode;
    let message: string;
    let retryable: boolean = false;

    if (error.message.includes('404') || error.message.includes('not found')) {
      code = ApiErrorCode.TOKEN_NOT_FOUND;
      message = `无法为 ${symbol} 生成图表，交易对可能不存在`;
      retryable = false;
    } else if (error.message.includes('timeout')) {
      code = ApiErrorCode.TIMEOUT_ERROR;
      message = '图表生成超时，请稍后重试';
      retryable = true;
    } else if (error.message.includes('rate limit') || error.message.includes('429')) {
      code = ApiErrorCode.RATE_LIMIT_EXCEEDED;
      message = '图表生成请求过于频繁，请稍后重试';
      retryable = true;
    } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
      code = ApiErrorCode.NETWORK_ERROR;
      message = '网络连接失败，无法生成图表';
      retryable = true;
    } else if (error.message.includes('server') || error.message.includes('50')) {
      code = ApiErrorCode.SERVER_ERROR;
      message = '图表服务暂时不可用，请稍后重试';
      retryable = true;
    } else {
      code = ApiErrorCode.UNKNOWN_ERROR;
      message = `图表生成失败: ${error.message}`;
      retryable = true;
    }

    return {
      code,
      message,
      retryable,
      context: {
        symbol,
        endpoint: 'chart-image-api',
        timestamp: new Date()
      }
    };
  }

  /**
   * 健康检查 - 测试图表服务是否正常工作
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 测试QuickChart.io API连通性
      const testResponse = await fetch(`${this.quickChartApiUrl}?c={type:'bar',data:{labels:['Test'],datasets:[{data:[1]}]}}&width=100&height=100`);
      return testResponse.ok;
    } catch (error) {
      logger.warn('Chart image service health check failed', { 
        error: (error as Error).message 
      });
      return false;
    }
  }

  /**
   * 格式化价格显示
   * 根据价格范围选择合适的小数位数
   */
  private formatPrice(price: number): string {
    if (price < 0.01) {
      // 非常小的价格，显示6位小数
      return `$${price.toFixed(6)}`;
    } else if (price < 1) {
      // 小价格，显示4位小数 (如: $0.1234)
      return `$${price.toFixed(4)}`;
    } else if (price < 100) {
      // 中等价格，显示2位小数 (如: $23.45)
      return `$${price.toFixed(2)}`;
    } else if (price < 10000) {
      // 较高价格，显示1位小数 (如: $1,234.5)
      const formatted = price.toLocaleString('en-US', { 
        minimumFractionDigits: 1,
        maximumFractionDigits: 1 
      });
      return `$${formatted}`;
    } else {
      // 很高价格，不显示小数 (如: $12,345)
      const formatted = price.toLocaleString('en-US', { 
        minimumFractionDigits: 0,
        maximumFractionDigits: 0 
      });
      return `$${formatted}`;
    }
  }

  /**
   * 获取服务统计信息
   */
  public getStats(): any {
    return {
      name: 'ChartImageService',
      version: '2.1.0',
      apiUrl: this.quickChartApiUrl,
      provider: 'QuickChart.io',
      chartLibrary: 'Chart.js + chartjs-chart-financial',
      cacheTTL: this.cacheTTL,
      supportedSymbols: [
        'BTC', 'ETH', 'SOL', 'ETC', 'LINK', 
        'AVAX', 'UNI', 'MATIC', 'ADA', 'DOT'
      ],
      supportedTimeFrames: ['1m', '5m', '15m', '1h', '4h', '1d'],
      features: [
        'Professional candlestick charts',
        'Dark/Light theme support', 
        'Real-time OHLC data visualization',
        'Customizable chart dimensions',
        'Smart caching system',
        'Free service (no API key required)',
        'High reliability and uptime'
      ]
    };
  }
}

// 导出单例实例
export const chartImageService = new ChartImageService();

// 默认导出
export default chartImageService;
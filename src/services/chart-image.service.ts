import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
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
 * 数据质量分析接口
 */
interface DataQualityResult {
  suitable: boolean;
  issues: string[];
  priceRange: number;
  priceRangePercent: number;
  avgVolume: number;
  dataPoints: number;
  timeSpan: number; // 时间跨度（分钟）
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

      // 简单数据验证 - 确保有足够的K线数据
      logger.info(`Generating chart for ${normalizedSymbol} ${timeFrame}`, {
        candleCount: candleData.candles.length,
        latestPrice: candleData.latestPrice,
        priceChange24h: candleData.priceChangePercent24h
      });

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
        latestPrice: candleData.latestPrice,
        priceChange24h: candleData.priceChangePercent24h?.toFixed(2) + '%',
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
      // 🔧 集成数据质量分析
      const qualityResult = this.analyzeDataQuality(candleData, config.timeFrame);
      
      logger.info(`Data quality analysis for ${config.symbol} ${config.timeFrame}`, {
        suitable: qualityResult.suitable,
        priceRangePercent: qualityResult.priceRangePercent.toFixed(4) + '%',
        dataPoints: qualityResult.dataPoints,
        timeSpan: qualityResult.timeSpan + 'min',
        issues: qualityResult.issues
      });
      
      // 如果有质量问题，记录警告但继续处理
      if (!qualityResult.suitable && qualityResult.issues.length > 0) {
        logger.warn(`Data quality issues detected for ${config.symbol} ${config.timeFrame}`, {
          issues: qualityResult.issues,
          priceRangePercent: qualityResult.priceRangePercent
        });
      }
      
      // 转换K线数据为Chart.js格式 (包含增强处理)
      const chartJsData = this.convertToChartJsFormat(candleData);
      
      // 生成Chart.js配置 (包含改进的Y轴逻辑)
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
   * 包含低流动性时段的可视化增强
   */
  private convertToChartJsFormat(candleData: CachedCandleData): OHLCDataPoint[] {
    let enhancedCount = 0;
    
    const enhancedData = candleData.candles.map(candle => {
      const basePrice = candle.close || candle.open;
      
      // 检测是否为平坦K线 (OHLC完全相同)
      const isFlat = candle.open === candle.high && 
                     candle.high === candle.low && 
                     candle.low === candle.close;
      
      if (isFlat && basePrice > 0) {
        // 为平坦K线添加明显的变化以改善可视化 - 大幅提升变化幅度
        const microVariation = basePrice * 0.0015; // 0.15%的变化，确保视觉可见
        
        // 创建合理的OHLC变化，保持蜡烛图逻辑性
        const enhanced = {
          x: candle.timestamp * 1000,
          o: basePrice - microVariation * 0.2, // 开盘价略低
          h: basePrice + microVariation,        // 最高价明显较高
          l: basePrice - microVariation * 0.6,  // 最低价明显较低  
          c: basePrice + microVariation * 0.1   // 收盘价略高
        };
        
        enhancedCount++;
        
        logger.debug(`Enhanced flat candle for visualization`, {
          symbol: candleData.symbol,
          timeFrame: candleData.timeFrame,
          timestamp: candle.timestamp,
          original: { o: candle.open, h: candle.high, l: candle.low, c: candle.close },
          enhanced: { o: enhanced.o, h: enhanced.h, l: enhanced.l, c: enhanced.c },
          microVariation
        });
        
        return enhanced;
      }
      
      // 非平坦K线保持原样
      return {
        x: candle.timestamp * 1000,
        o: candle.open,
        h: candle.high,
        l: candle.low,
        c: candle.close
      };
    });
    
    if (enhancedCount > 0) {
      logger.info(`Enhanced ${enhancedCount}/${candleData.candles.length} flat candles for better visualization`, {
        symbol: candleData.symbol,
        timeFrame: candleData.timeFrame,
        enhancementRate: ((enhancedCount / candleData.candles.length) * 100).toFixed(1) + '%'
      });
    }
    
    return enhancedData;
  }

  /**
   * 创建Chart.js专业candlestick图表配置 (TradingView风格)
   */
  private createChartJsConfig(config: QuickChartConfig, data: OHLCDataPoint[]): ChartJsConfig {
    const isDark = config.theme === 'dark';
    
    // 🔧 计算Y轴范围，确保低变化时也有足够的视觉高度
    const prices = data.flatMap(d => [d.o, d.h, d.l, d.c]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice;
    const avgPrice = (minPrice + maxPrice) / 2;
    
    // 设置最小可视范围为平均价格的1%（大幅提升）
    const minVisualRange = avgPrice * 0.01;
    
    let yAxisMin: number;
    let yAxisMax: number;
    
    if (range < minVisualRange) {
      // 低变化情况：强制设置足够的Y轴范围
      const halfRange = minVisualRange / 2;
      yAxisMin = avgPrice - halfRange;
      yAxisMax = avgPrice + halfRange;
      
      logger.debug(`Enhanced Y-axis range for low volatility`, {
        symbol: config.symbol,
        timeFrame: config.timeFrame,
        originalRange: range,
        enhancedRange: minVisualRange,
        originalMin: minPrice,
        originalMax: maxPrice,
        enhancedMin: yAxisMin,
        enhancedMax: yAxisMax
      });
    } else {
      // 正常情况：使用数据范围加10%padding
      const padding = range * 0.1;
      yAxisMin = minPrice - padding;
      yAxisMax = maxPrice + padding;
    }
    
    return {
      type: 'candlestick',
      data: {
        datasets: [{
          label: `${config.symbol}/USDT`,
          data: data,
          // 🔧 优化的TradingView风格颜色 - 极高对比度确保可见性
          color: {
            up: '#00ff88',       // 非常鲜艳的绿色
            down: '#ff3366',     // 非常鲜艳的红色  
            unchanged: '#ffffff' // 纯白色，最高对比度
          },
          borderColor: {
            up: '#00ff88',
            down: '#ff3366', 
            unchanged: '#ffffff'
          },
          // 🔧 调整边框宽度和蜡烛宽度，增加间距改善视觉效果
          borderWidth: 2,        // 加粗边框
          // 🔧 优化蜡烛宽度和间距，改善视觉效果
          barPercentage: 0.8,    // 减少蜡烛宽度，增加间距
          categoryPercentage: 0.9 // 增加类别间距，避免过于拥挤
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
              displayFormats: this.getTimeDisplayFormats(config.timeFrame)
              // 移除 stepSize，让Chart.js根据数据点显示时间
            },
            grid: {
              display: true,
              color: isDark ? '#2a2e39' : '#e2e8f0',
              drawBorder: true,
              borderColor: isDark ? '#363a45' : '#d1d5db'
            },
            ticks: {
              display: true,  // 显示时间标签
              source: 'data',  // 强制使用数据点的时间，显示真实时间戳
              maxTicksLimit: this.getMaxTimeTicks(config.timeFrame),
              color: isDark ? '#9ca3af' : '#6b7280',
              font: {
                size: 10,
                family: 'Inter, sans-serif'
              }
            }
          },
          y: {
            type: 'linear',
            position: 'right',
            beginAtZero: false,      // 🔧 Don't force zero baseline for crypto prices
            min: yAxisMin,           // 🔧 直接设置计算好的最小值
            max: yAxisMax,           // 🔧 直接设置计算好的最大值
            grid: {
              display: true,
              color: isDark ? '#2a2e39' : '#e2e8f0',
              drawBorder: true,
              borderColor: isDark ? '#363a45' : '#d1d5db'
            },
            ticks: {
              display: true,
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
   * 获取时间显示格式 - 针对4个支持的时间框架优化
   */
  private getTimeDisplayFormats(timeFrame: TimeFrame): { [key: string]: string } {
    // 根据当前支持的4个时间框架: 1m, 5m, 1h, 1d
    // 所有格式统一不显示年份，只显示月-日
    switch (timeFrame) {
      case '1m':
        return {
          millisecond: 'HH:mm:ss',
          second: 'HH:mm:ss',
          minute: 'HH:mm',           // 1分钟图显示: 14:35
          hour: 'HH:mm',             // 不显示日期，只显示时间
          day: 'MM-DD',
          week: 'MM-DD',
          month: 'MM-DD',
          quarter: 'MM-DD',
          year: 'MM-DD'              // 移除年份显示
        };
      
      case '5m':
        return {
          millisecond: 'HH:mm:ss',
          second: 'HH:mm:ss',
          minute: 'HH:mm',           // 5分钟图显示: 14:30, 14:35
          hour: 'HH:mm',             // 不显示日期，只显示时间
          day: 'MM-DD',
          week: 'MM-DD',
          month: 'MM-DD',
          quarter: 'MM-DD',
          year: 'MM-DD'              // 移除年份显示
        };
      
      case '1h':
        return {
          millisecond: 'HH:mm:ss',
          second: 'HH:mm:ss',
          minute: 'HH:mm',
          hour: 'MM-DD',             // 1小时图只显示: 12-25 (不显示时间)
          day: 'MM-DD',
          week: 'MM-DD',
          month: 'MM-DD',
          quarter: 'MM-DD',
          year: 'MM-DD'              // 移除年份显示
        };
      
      case '1d':
        return {
          millisecond: 'HH:mm:ss',
          second: 'HH:mm:ss',
          minute: 'HH:mm',
          hour: 'MM-DD',
          day: 'MM-DD',              // 日线图显示: 12-25, 12-26
          week: 'MM-DD',
          month: 'MM-DD',
          quarter: 'MM-DD',
          year: 'MM-DD'              // 移除年份显示
        };
      
      default:
        // 默认格式 - 统一不显示年份
        return {
          millisecond: 'HH:mm:ss',
          second: 'HH:mm:ss',
          minute: 'HH:mm',
          hour: 'MM-DD',
          day: 'MM-DD',
          week: 'MM-DD',
          month: 'MM-DD',
          quarter: 'MM-DD',
          year: 'MM-DD'
        };
    }
  }

  /**
   * 获取最大时间刻度数 - 针对4个支持时间框架的密度控制
   */
  private getMaxTimeTicks(timeFrame: TimeFrame): number {
    // 根据当前支持的4个时间框架: 1m, 5m, 1h, 1d 优化刻度数量
    // 目标: 让每根K线或每几根K线都有时间标签（20根K线数据）
    switch (timeFrame) {
      case '1m': return 10;   // 1分钟图: 10个时间刻度, 每2根K线显示一个时间
      case '5m': return 10;   // 5分钟图: 10个时间刻度, 每2根K线显示一个时间
      case '1h': return 10;   // 1小时图: 10个时间刻度, 每2根K线显示一个时间
      case '1d': return 20;   // 日线图: 20个时间刻度, 每根K线显示一个日期
      default: return 10;     // 默认10个刻度
    }
  }


  /**
   * 分析K线数据质量 - 检测可能导致图表显示问题的数据
   */
  private analyzeDataQuality(candleData: CachedCandleData, timeFrame: TimeFrame): DataQualityResult {
    const candles = candleData.candles;
    const issues: string[] = [];
    
    // 计算价格统计
    const prices = candles.flatMap(c => [c.open, c.high, c.low, c.close]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const priceRange = maxPrice - minPrice;
    const priceRangePercent = (priceRange / avgPrice) * 100;
    
    // 计算成交量统计
    const volumes = candles.map(c => c.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    
    // 计算时间跨度
    const timeSpan = candles.length > 1 
      ? (candles[candles.length - 1].timestamp - candles[0].timestamp) / 60  // 转换为分钟
      : 0;
    
    // 检查各种数据质量问题
    
    // 1. 价格范围过小
    if (priceRangePercent < 0.05) {  // 小于0.05%的价格变化
      issues.push(`Price range too small: ${priceRangePercent.toFixed(4)}% (min: 0.05%)`);
    }
    
    // 2. 数据点不足
    const expectedDataPoints = this.getOptimalCandleCountForQuality(timeFrame);
    if (candles.length < expectedDataPoints * 0.5) {  // 少于期望数量的50%
      issues.push(`Insufficient data points: ${candles.length} (expected: ${expectedDataPoints})`);
    }
    
    // 3. 成交量异常低
    if (avgVolume < 1) {  // 平均成交量极低
      issues.push(`Very low volume: ${avgVolume.toFixed(2)} (may indicate inactive market)`);
    }
    
    // 4. 时间跨度问题
    const expectedTimeSpan = this.getExpectedTimeSpan(timeFrame, candles.length);
    if (Math.abs(timeSpan - expectedTimeSpan) > expectedTimeSpan * 0.3) {  // 偏差超过30%
      issues.push(`Time span mismatch: ${timeSpan}min (expected: ~${expectedTimeSpan}min)`);
    }
    
    // 5. 价格数据一致性检查
    const flatCandles = candles.filter(c => c.open === c.high && c.high === c.low && c.low === c.close);
    if (flatCandles.length > candles.length * 0.8) {  // 超过80%的K线是平的
      issues.push(`Too many flat candles: ${flatCandles.length}/${candles.length} (${((flatCandles.length/candles.length)*100).toFixed(1)}%)`);
    }
    
    return {
      suitable: issues.length === 0 || (issues.length <= 2 && priceRangePercent >= 0.01),  // 容忍轻微问题
      issues,
      priceRange,
      priceRangePercent,
      avgVolume,
      dataPoints: candles.length,
      timeSpan
    };
  }

  /**
   * 获取用于质量检查的最优K线数量
   */
  private getOptimalCandleCountForQuality(timeFrame: TimeFrame): number {
    // 复用ChartService的逻辑，但这里需要独立定义以避免循环依赖
    const qualityMap: { [key in TimeFrame]: number } = {
      '1m': 120,   // 2小时
      '5m': 60,    // 5小时
      '15m': 48,   // 12小时
      '1h': 24,    // 1天
      '4h': 20,    // 3.3天
      '1d': 20     // 20天
    };
    
    return qualityMap[timeFrame];
  }

  /**
   * 获取期望的时间跨度（分钟）
   */
  private getExpectedTimeSpan(timeFrame: TimeFrame, candleCount: number): number {
    const timeFrameMinutes: { [key in TimeFrame]: number } = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '1h': 60,
      '4h': 240,
      '1d': 1440
    };
    
    return timeFrameMinutes[timeFrame] * candleCount;
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
  private handleChartImageError(error: Error, symbol: string, _timeFrame: TimeFrame): DetailedError {
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
   * 格式化价格显示 (保持向后兼容)
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
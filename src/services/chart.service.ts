import { apiService } from './api.service';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { config } from '../config';
import {
  CandleData,
  CandleRequestParams,
  CandleApiResponse,
  FormattedCandleData,
  CachedCandleData,
  TimeFrame,
  DetailedError,
  ApiErrorCode
} from '../types/api.types';

/**
 * Chart业务服务类
 * 负责处理K线图相关的业务逻辑，包括K线数据查询、处理和缓存管理
 */
export class ChartService {
  private readonly cacheTTL: number;
  private readonly cacheKeyPrefix: string = 'chart_candles_';

  constructor() {
    this.cacheTTL = 300; // 5分钟缓存 (K线数据变化较频繁)
  }

  /**
   * 获取K线数据 - 保证每个时间框架返回一致的K线数量
   * @param symbol 交易对符号 (如: BTC, ETH, ETC)
   * @param timeFrame 时间框架 (默认: 1h)
   * @param limit 返回数据条数 (默认: 50，保证视觉一致性)
   * @returns K线数据
   */
  public async getCandleData(
    symbol: string, 
    timeFrame: TimeFrame = '1h', 
    limit: number = 50
  ): Promise<CachedCandleData> {
    const normalizedSymbol = symbol.toUpperCase().trim();
    const cacheKey = `${this.cacheKeyPrefix}${normalizedSymbol}_${timeFrame}_${limit}`;
    
    logger.info(`Getting candle data for ${normalizedSymbol} ${timeFrame}`);
    
    try {
      // 使用缓存服务的 getOrSet 方法，自动处理缓存逻辑
      const candleData = await cacheService.getOrSet(
        cacheKey,
        async () => await this.fetchCandleDataFromApi(normalizedSymbol, timeFrame, limit),
        this.cacheTTL
      );

      // 检查数据是否来自缓存
      const cacheResult = await cacheService.get<FormattedCandleData>(cacheKey);
      const isCached = cacheResult.success;

      const cachedCandleData: CachedCandleData = {
        ...candleData,
        isCached,
        cache: isCached ? {
          key: cacheKey,
          ttl: this.cacheTTL,
          createdAt: new Date(),
          updatedAt: new Date()
        } : undefined
      };

      logger.info(`Candle data retrieved for ${normalizedSymbol} ${timeFrame}`, {
        cached: isCached,
        candlesCount: candleData.candles.length,
        latestPrice: candleData.latestPrice
      });

      return cachedCandleData;

    } catch (error) {
      const detailedError = this.handleChartError(error as Error, normalizedSymbol, timeFrame);
      logger.error(`Failed to get candle data for ${normalizedSymbol} ${timeFrame}`, {
        error: detailedError.message,
        code: detailedError.code,
        retryable: detailedError.retryable
      });
      
      throw detailedError;
    }
  }

  /**
   * 从API获取K线数据 - 确保获取足够数据以返回精确的candle数量
   */
  private async fetchCandleDataFromApi(
    symbol: string, 
    timeFrame: TimeFrame, 
    limit: number
  ): Promise<FormattedCandleData> {
    logger.debug(`Fetching candle data from API for ${symbol} ${timeFrame} (requesting ${limit} candles)`);
    
    try {
      // 请求特定时间框架的20根K线 - 让API后端处理时间框架过滤
      const requestLimit = 20; // 始终请求20根指定时间框架的K线
      
      const requestParams: CandleRequestParams = {
        coin: symbol,        // API 使用 coin 参数而不是 symbol
        interval: timeFrame, // 关键：告诉API我们需要哪个时间框架的数据
        limit: requestLimit  // 请求20根该时间框架的K线
      };

      logger.info(`🔍 API request details:`, { 
        symbol, 
        timeFrame, 
        requestLimit,
        originalLimit: limit,
        requestParams 
      });

      // 调用 hyperliquid candles API
      const response = await apiService.post<any>(
        `/api/tgbot/hyperliquid/candles`,
        requestParams
      );

      // 详细记录API响应，特别关注数据量
      logger.info(`📊 API response analysis for ${symbol} ${timeFrame}:`, {
        hasResponse: !!response,
        hasData: !!response?.data,
        hasCandles: !!response?.data?.candles,
        totalCandlesReceived: response?.data?.candles?.length || 0,
        requestedLimit: requestLimit,
        firstCandleTime: response?.data?.candles?.[0]?.t || null,
        lastCandleTime: response?.data?.candles?.slice(-1)?.[0]?.t || null,
        dataTimeSpan: response?.data?.candles?.length > 1 ? 
          `${response?.data?.candles?.length} periods` : 'insufficient data'
      });

      // 检查API响应格式
      if (!response || !response.data || !response.data.candles || !Array.isArray(response.data.candles)) {
        throw new Error(`Invalid API response format: ${JSON.stringify(response).substring(0, 200)}`);
      }

      const processedData = this.processRawCandleData(response.data.candles, symbol, timeFrame, limit);
      
      logger.debug(`API candle data processed successfully for ${symbol} ${timeFrame}`, {
        requestedCandles: limit,
        receivedCandles: response.data.candles.length,
        finalCandlesCount: processedData.candles.length,
        latestPrice: processedData.latestPrice
      });

      return processedData;

    } catch (error) {
      // 如果是API错误，重新抛出以保持错误类型
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to fetch candle data for ${symbol}: ${error}`);
    }
  }

  /**
   * 处理原始K线API数据，转换为标准格式并确保精确的K线数量
   */
  private processRawCandleData(rawData: any[], symbol: string, timeFrame: TimeFrame, requestedLimit: number): FormattedCandleData {
    try {
      // 处理K线数据数组 - API返回的是缩写字段格式
      // API已经按照指定时间框架返回数据，无需额外处理
      const candles: CandleData[] = rawData.map((item: any) => ({
        open: this.parseNumericValue(item.o),      // API字段: o = open
        high: this.parseNumericValue(item.h),      // API字段: h = high  
        low: this.parseNumericValue(item.l),       // API字段: l = low
        close: this.parseNumericValue(item.c),     // API字段: c = close
        volume: this.parseNumericValue(item.v),    // API字段: v = volume
        timestamp: this.parseTimestamp(item.t)     // API字段: t = open time
      }));

      // 验证K线数据
      if (candles.length === 0) {
        throw new Error('No candle data found');
      }

      // 按时间戳排序 (升序) - 确保最新数据在末尾
      candles.sort((a, b) => a.timestamp - b.timestamp);

      // 始终尝试返回20根K线，但根据可用数据调整
      const targetCandles = 20; // 固定目标：20根K线
      
      let finalCandles: CandleData[];
      
      if (candles.length === 0) {
        throw new Error(`No candle data available for ${symbol} ${timeFrame}`);
      } else if (candles.length >= targetCandles) {
        // 数据充足，返回最近的20根K线
        finalCandles = candles.slice(-targetCandles);
        logger.info(`Using ${targetCandles} candles for ${symbol} ${timeFrame} (${candles.length} available)`);
      } else {
        // 数据不足，使用所有可用数据
        finalCandles = candles;
        logger.warn(`Limited data for ${symbol} ${timeFrame}: using ${candles.length} candles instead of ${targetCandles}`);
      }
      
      logger.debug(`Candle data processing: received ${candles.length}, returning ${finalCandles.length} (requested: ${requestedLimit})`);

      // 计算统计数据
      const latestCandle = finalCandles[finalCandles.length - 1];
      const firstCandle = finalCandles[0];
      
      const latestPrice = latestCandle.close;
      const priceChange24h = latestPrice - firstCandle.close;
      const priceChangePercent24h = (priceChange24h / firstCandle.close) * 100;
      
      // 计算统计数据 - 基于返回的K线数据
      const high24h = Math.max(...finalCandles.map(c => c.high));
      const low24h = Math.min(...finalCandles.map(c => c.low));
      
      // 计算总成交量 - 基于返回的K线数据
      const volume24h = finalCandles.reduce((sum, c) => sum + c.volume, 0);

      const formattedData: FormattedCandleData = {
        symbol: symbol.toUpperCase(),
        timeFrame,
        candles: finalCandles, // 使用精确数量的K线数据
        latestPrice,
        priceChange24h,
        priceChangePercent24h,
        high24h,
        low24h,
        volume24h,
        updatedAt: new Date()
      };

      // 验证必需字段
      this.validateCandleData(formattedData);

      return formattedData;

    } catch (error) {
      logger.error(`Failed to process raw candle data for ${symbol}`, {
        error: (error as Error).message,
        rawDataCount: rawData.length
      });
      throw new Error(`Candle data processing failed for ${symbol}: ${(error as Error).message}`);
    }
  }

  /**
   * 解析数值字段，处理字符串和数字类型
   */
  private parseNumericValue(value: any): number {
    if (value === null || value === undefined || value === '') {
      return 0;
    }

    if (typeof value === 'number') {
      return isNaN(value) ? 0 : value;
    }

    if (typeof value === 'string') {
      // 清理字符串中的非数字字符（保留小数点和负号）
      const cleanedValue = value.replace(/[^\d.-]/g, '');
      const parsed = parseFloat(cleanedValue);
      return isNaN(parsed) ? 0 : parsed;
    }

    return 0;
  }

  /**
   * 解析时间戳
   */
  private parseTimestamp(value: any): number {
    if (typeof value === 'number') {
      // API返回毫秒时间戳，需要转换为秒
      return value > 1e12 ? Math.floor(value / 1000) : value;
    }

    if (typeof value === 'string') {
      const timestamp = parseInt(value, 10);
      if (isNaN(timestamp)) {
        return Math.floor(Date.now() / 1000);
      }
      // 检查是否为毫秒时间戳
      return timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp;
    }

    return Math.floor(Date.now() / 1000);
  }

  /**
   * 验证K线数据的完整性
   */
  private validateCandleData(candleData: FormattedCandleData): void {
    const requiredFields: Array<keyof FormattedCandleData> = [
      'symbol', 'timeFrame', 'candles', 'latestPrice'
    ];
    
    for (const field of requiredFields) {
      if (candleData[field] === undefined || candleData[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // 验证K线数据数组
    if (!Array.isArray(candleData.candles) || candleData.candles.length === 0) {
      throw new Error('Invalid candles data: must be non-empty array');
    }

    // 验证价格的合理性
    if (candleData.latestPrice <= 0) {
      throw new Error('Invalid latest price: must be positive');
    }
  }

  /**
   * 获取支持的时间框架列表
   */
  public getSupportedTimeFrames(): TimeFrame[] {
    return ['1m', '5m', '15m', '1h', '4h', '1d'];
  }

  /**
   * 根据时间框架获取最小K线数据要求
   * @param timeFrame 时间框架
   * @returns 最小K线数量
   */
  private getMinCandlesForTimeframe(timeFrame: TimeFrame): number {
    // 所有时间框架都要求20根K线，保证图表质量一致
    return 20;
  }

  // 移除复杂的聚合逻辑 - API后端现在处理不同时间框架的数据过滤

  /**
   * 验证时间框架是否支持
   */
  public isValidTimeFrame(timeFrame: string): timeFrame is TimeFrame {
    return this.getSupportedTimeFrames().includes(timeFrame as TimeFrame);
  }

  /**
   * 清除特定交易对的K线缓存
   */
  public async clearChartCache(symbol: string, timeFrame?: TimeFrame): Promise<boolean> {
    const normalizedSymbol = symbol.toUpperCase().trim();
    
    let pattern: string;
    if (timeFrame) {
      pattern = `${this.cacheKeyPrefix}${normalizedSymbol}_${timeFrame}_*`;
    } else {
      pattern = `${this.cacheKeyPrefix}${normalizedSymbol}_*`;
    }
    
    const keysResult = await cacheService.keys(pattern);
    
    if (!keysResult.success || !keysResult.data) {
      logger.warn(`Failed to get chart cache keys for ${normalizedSymbol}`, { 
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

    logger.info(`Cleared ${successCount}/${keysResult.data.length} chart cache entries for ${normalizedSymbol}`);
    return successCount === keysResult.data.length;
  }

  /**
   * 处理Chart相关错误，转换为DetailedError
   */
  private handleChartError(error: Error, symbol: string, timeFrame: TimeFrame): DetailedError {
    let code: ApiErrorCode;
    let message: string;
    let retryable: boolean = false;

    if (error.message.includes('404') || error.message.includes('not found')) {
      code = ApiErrorCode.TOKEN_NOT_FOUND;
      message = `交易对 ${symbol} 未找到，请检查交易对符号是否正确`;
      retryable = false;
    } else if (error.message.includes('timeout')) {
      code = ApiErrorCode.TIMEOUT_ERROR;
      message = 'K线数据查询超时，请稍后重试';
      retryable = true;
    } else if (error.message.includes('rate limit') || error.message.includes('429')) {
      code = ApiErrorCode.RATE_LIMIT_EXCEEDED;
      message = '请求过于频繁，请稍后重试';
      retryable = true;
    } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
      code = ApiErrorCode.NETWORK_ERROR;
      message = '网络连接失败，请检查网络连接';
      retryable = true;
    } else if (error.message.includes('server') || error.message.includes('50')) {
      code = ApiErrorCode.SERVER_ERROR;
      message = '服务器错误，请稍后重试';
      retryable = true;
    } else if (error.message.includes('Insufficient candle data') || 
               (error.message.includes('only') && error.message.includes('candles available'))) {
      // 保持数据不足错误的原始消息，便于fallback机制识别
      code = ApiErrorCode.UNKNOWN_ERROR;
      message = error.message; // 不包装消息，保持原始错误信息
      retryable = true;
    } else {
      code = ApiErrorCode.UNKNOWN_ERROR;
      message = `查询 ${symbol} K线数据失败: ${error.message}`;
      retryable = true;
    }

    return {
      code,
      message,
      retryable,
      context: {
        symbol,
        endpoint: '/api/tgbot/hyperliquid/candles',
        timestamp: new Date()
      }
    };
  }

  /**
   * 健康检查 - 测试K线服务是否正常工作
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 尝试查询一个常见交易对（BTC）来测试服务健康状况
      await this.fetchCandleDataFromApi('BTC', '1h', 10);
      return true;
    } catch (error) {
      logger.warn('Chart service health check failed', { error: (error as Error).message });
      return false;
    }
  }
}

// 导出单例实例
export const chartService = new ChartService();

// 默认导出
export default chartService;
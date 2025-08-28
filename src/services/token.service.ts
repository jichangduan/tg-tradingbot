import { apiService } from './api.service';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { config } from '../config';
import {
  TokenData,
  TokenPriceApiResponse,
  ApiErrorCode,
  DetailedError,
  PriceChangeType,
  TokenPriceTrend,
  CachedTokenData
} from '../types/api.types';

/**
 * Token业务服务类
 * 负责处理代币相关的业务逻辑，包括价格查询、数据处理和缓存管理
 */
export class TokenService {
  private readonly cacheTTL: number;
  private readonly cacheKeyPrefix: string = 'token_price_';

  constructor() {
    this.cacheTTL = config.cache.tokenPriceTTL;
  }

  /**
   * 获取代币价格信息
   * @param symbol 代币符号 (如: BTC, ETH, SOL)
   * @returns 代币价格数据
   */
  public async getTokenPrice(symbol: string): Promise<CachedTokenData> {
    const normalizedSymbol = symbol.toUpperCase().trim();
    const cacheKey = `${this.cacheKeyPrefix}${normalizedSymbol}`;
    
    logger.info(`Getting token price for ${normalizedSymbol}`);
    
    try {
      // 使用缓存服务的 getOrSet 方法，自动处理缓存逻辑
      const tokenData = await cacheService.getOrSet(
        cacheKey,
        async () => await this.fetchTokenPriceFromApi(normalizedSymbol),
        this.cacheTTL
      );

      // 检查数据是否来自缓存
      const cacheResult = await cacheService.get<TokenData>(cacheKey);
      const isCached = cacheResult.success;

      const cachedTokenData: CachedTokenData = {
        ...tokenData,
        isCached,
        cache: isCached ? {
          key: cacheKey,
          ttl: this.cacheTTL,
          createdAt: new Date(),
          updatedAt: new Date()
        } : undefined
      };

      logger.info(`Token price retrieved for ${normalizedSymbol}`, {
        cached: isCached,
        price: tokenData.price,
        change24h: tokenData.change24h
      });

      return cachedTokenData;

    } catch (error) {
      const detailedError = this.handleTokenError(error as Error, normalizedSymbol);
      logger.error(`Failed to get token price for ${normalizedSymbol}`, {
        error: detailedError.message,
        code: detailedError.code,
        retryable: detailedError.retryable
      });
      
      throw detailedError;
    }
  }

  /**
   * 从API获取代币价格数据
   */
  private async fetchTokenPriceFromApi(symbol: string): Promise<TokenData> {
    logger.debug(`Fetching token price from API for ${symbol}`);
    
    try {
      // 调用trending API获取token列表
      const response = await apiService.get<any>(
        `/api/birdeye/token_trending`
      );

      // 检查API响应格式
      if (!response || !response.data || !Array.isArray(response.data)) {
        throw new Error(`Invalid API response format: ${JSON.stringify(response).substring(0, 200)}`);
      }

      // 从trending列表中查找匹配的token
      const matchedToken = this.findMatchingToken(response.data, symbol);
      
      if (!matchedToken) {
        throw new Error(`Token ${symbol} not found in trending list`);
      }

      const processedData = this.processRawApiData(matchedToken, symbol);
      
      logger.debug(`API data processed successfully for ${symbol}`, {
        price: processedData.price,
        change24h: processedData.change24h
      });

      return processedData;

    } catch (error) {
      // 如果是API错误，重新抛出以保持错误类型
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to fetch token data for ${symbol}: ${error}`);
    }
  }

  /**
   * 从trending列表中查找匹配的token
   */
  private findMatchingToken(tokens: any[], symbol: string): any | null {
    const normalizedSymbol = symbol.toUpperCase().trim();
    
    // 1. 别名映射 - 处理特殊映射关系
    const symbolAliases: { [key: string]: string } = {
      'BTC': 'WBTC',
      'BITCOIN': 'WBTC',
      'ETHEREUM': 'ETH',
      'SOLANA': 'SOL'
    };
    
    const searchSymbol = symbolAliases[normalizedSymbol] || normalizedSymbol;
    
    // 2. 直接匹配 - 精确匹配symbol
    let matchedToken = tokens.find(token => 
      token.symbol && token.symbol.toUpperCase() === searchSymbol
    );
    
    if (matchedToken) {
      logger.debug(`Found direct symbol match for ${normalizedSymbol} → ${searchSymbol}`);
      return matchedToken;
    }
    
    // 3. 模糊匹配 - 通过name字段匹配
    matchedToken = tokens.find(token => {
      if (!token.name) return false;
      const tokenName = token.name.toUpperCase();
      return tokenName.includes(normalizedSymbol) || 
             tokenName.includes(searchSymbol);
    });
    
    if (matchedToken) {
      logger.debug(`Found name match for ${normalizedSymbol} → ${matchedToken.name}`);
      return matchedToken;
    }
    
    // 4. 扩展匹配 - 检查常见的token别名
    const extendedSearch = [
      normalizedSymbol,
      searchSymbol,
      `${normalizedSymbol}USDT`,
      `${searchSymbol}USDT`
    ];
    
    for (const searchTerm of extendedSearch) {
      matchedToken = tokens.find(token => 
        token.symbol && token.symbol.toUpperCase().includes(searchTerm)
      );
      if (matchedToken) {
        logger.debug(`Found extended match for ${normalizedSymbol} → ${matchedToken.symbol}`);
        return matchedToken;
      }
    }
    
    logger.debug(`No match found for ${normalizedSymbol} in ${tokens.length} tokens`);
    return null;
  }

  /**
   * 处理原始API数据，转换为标准格式
   */
  private processRawApiData(rawData: any, symbol: string): TokenData {
    try {
      // 处理价格字段 - 适配BirdEye API字段
      const price = this.parseNumericValue(
        rawData.price || rawData.current_price || rawData.priceUsd || rawData.price_usd
      );

      // 处理24小时变化 - 适配BirdEye API字段
      const change24h = this.parseNumericValue(
        rawData.price_change_24h_percent || rawData.change24h || rawData.price_change_percentage_24h || rawData.priceChange24h
      );

      // 处理交易量 - 适配BirdEye API字段
      const volume24h = this.parseNumericValue(
        rawData.volume_24h_usd || rawData.volume24h || rawData.total_volume || rawData.volume
      );

      // 处理市值 - 适配BirdEye API字段
      const marketCap = this.parseNumericValue(
        rawData.market_cap_usd || rawData.market_cap || rawData.marketCap || rawData.marketCapUsd
      );

      // 处理24小时最高/最低价
      const high24h = this.parseNumericValue(rawData.high24h || rawData.high_24h);
      const low24h = this.parseNumericValue(rawData.low24h || rawData.low_24h);

      // 构建标准化的TokenData对象
      const tokenData: TokenData = {
        symbol: symbol.toUpperCase(),
        name: rawData.name || symbol,
        price: price,
        change24h: change24h,
        volume24h: volume24h,
        marketCap: marketCap,
        high24h: high24h,
        low24h: low24h,
        supply: {
          circulating: this.parseNumericValue(rawData.circulating_supply),
          total: this.parseNumericValue(rawData.total_supply),
          max: this.parseNumericValue(rawData.max_supply)
        },
        updatedAt: new Date(),
        source: 'aiw3_api'
      };

      // 验证必需字段
      this.validateTokenData(tokenData);

      return tokenData;

    } catch (error) {
      logger.error(`Failed to process raw API data for ${symbol}`, {
        error: (error as Error).message,
        rawData: JSON.stringify(rawData, null, 2)
      });
      throw new Error(`Data processing failed for ${symbol}: ${(error as Error).message}`);
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
   * 验证TokenData的完整性
   */
  private validateTokenData(tokenData: TokenData): void {
    const requiredFields: Array<keyof TokenData> = ['symbol', 'name', 'price', 'change24h', 'volume24h'];
    
    for (const field of requiredFields) {
      if (tokenData[field] === undefined || tokenData[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // 验证数值字段的合理性
    if (tokenData.price < 0) {
      throw new Error('Invalid price: cannot be negative');
    }

    if (tokenData.volume24h < 0) {
      throw new Error('Invalid volume: cannot be negative');
    }

    if (tokenData.marketCap < 0) {
      throw new Error('Invalid market cap: cannot be negative');
    }
  }

  /**
   * 计算价格趋势
   */
  public calculatePriceTrend(tokenData: TokenData): TokenPriceTrend {
    const { change24h } = tokenData;
    const absChange = Math.abs(change24h);

    let type: PriceChangeType;
    if (change24h > 0.1) {
      type = PriceChangeType.UP;
    } else if (change24h < -0.1) {
      type = PriceChangeType.DOWN;
    } else {
      type = PriceChangeType.STABLE;
    }

    return {
      type,
      percentage: change24h,
      isSignificant: absChange >= 5 // 5%或以上认为是显著变化
    };
  }

  /**
   * 获取多个代币的价格（批量查询）
   */
  public async getMultipleTokenPrices(symbols: string[]): Promise<CachedTokenData[]> {
    logger.info(`Getting prices for multiple tokens: ${symbols.join(', ')}`);

    const promises = symbols.map(symbol => 
      this.getTokenPrice(symbol).catch(error => {
        logger.warn(`Failed to get price for ${symbol}`, { error: error.message });
        return null; // 返回null而不是抛出错误，允许部分成功
      })
    );

    const results = await Promise.all(promises);
    
    // 过滤掉失败的结果
    const successResults = results.filter(result => result !== null) as CachedTokenData[];
    
    logger.info(`Successfully retrieved prices for ${successResults.length}/${symbols.length} tokens`);
    
    return successResults;
  }

  /**
   * 清除特定代币的缓存
   */
  public async clearTokenCache(symbol: string): Promise<boolean> {
    const normalizedSymbol = symbol.toUpperCase().trim();
    const cacheKey = `${this.cacheKeyPrefix}${normalizedSymbol}`;
    
    const result = await cacheService.delete(cacheKey);
    
    if (result.success) {
      logger.info(`Cache cleared for token: ${normalizedSymbol}`);
    } else {
      logger.warn(`Failed to clear cache for token: ${normalizedSymbol}`, { error: result.error });
    }
    
    return result.success;
  }

  /**
   * 清除所有代币缓存
   */
  public async clearAllTokenCache(): Promise<boolean> {
    const pattern = `${this.cacheKeyPrefix}*`;
    const keysResult = await cacheService.keys(pattern);
    
    if (!keysResult.success || !keysResult.data) {
      logger.warn('Failed to get token cache keys', { error: keysResult.error });
      return false;
    }

    let successCount = 0;
    for (const key of keysResult.data) {
      const deleteResult = await cacheService.delete(key);
      if (deleteResult.success) {
        successCount++;
      }
    }

    logger.info(`Cleared ${successCount}/${keysResult.data.length} token cache entries`);
    return successCount === keysResult.data.length;
  }

  /**
   * 处理Token相关错误，转换为DetailedError
   */
  private handleTokenError(error: Error, symbol: string): DetailedError {
    let code: ApiErrorCode;
    let message: string;
    let retryable: boolean = false;

    if (error.message.includes('404') || error.message.includes('not found')) {
      code = ApiErrorCode.TOKEN_NOT_FOUND;
      message = `代币 ${symbol} 未找到，请检查代币符号是否正确`;
      retryable = false;
    } else if (error.message.includes('timeout')) {
      code = ApiErrorCode.TIMEOUT_ERROR;
      message = '查询超时，请稍后重试';
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
    } else {
      code = ApiErrorCode.UNKNOWN_ERROR;
      message = `查询 ${symbol} 价格失败: ${error.message}`;
      retryable = true;
    }

    return {
      code,
      message,
      retryable,
      context: {
        symbol,
        endpoint: `/api/birdeye/token_trending`,
        timestamp: new Date()
      }
    };
  }

  /**
   * 健康检查 - 测试代币服务是否正常工作
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 尝试查询一个常见代币（BTC）来测试服务健康状况
      await this.fetchTokenPriceFromApi('BTC');
      return true;
    } catch (error) {
      logger.warn('Token service health check failed', { error: (error as Error).message });
      return false;
    }
  }
}

// 导出单例实例
export const tokenService = new TokenService();

// 默认导出
export default tokenService;
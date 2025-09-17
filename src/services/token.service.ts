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
   * 从API获取代币价格数据 (支持多数据源)
   */
  private async fetchTokenPriceFromApi(symbol: string): Promise<TokenData> {
    
    // 尝试AIW3 BirdEye API
    try {
      const response = await apiService.get<any>(
        `/api/birdeye/token_trending`
      );

      if (response && response.data && Array.isArray(response.data)) {
        const matchedToken = this.findMatchingToken(response.data, symbol);
        if (matchedToken) {
          const processedData = this.processRawApiData(matchedToken, symbol);
          return processedData;
        }
      }
    } catch (error) {
    }

    // Fallback 1: 尝试Hyperliquid价格API
    try {
      const hyperliquidData = await this.fetchFromHyperliquid(symbol);
      if (hyperliquidData) {
        return hyperliquidData;
      }
    } catch (error) {
    }

    // Fallback 2: 尝试Binance公共API
    try {
      const binanceData = await this.fetchFromBinance(symbol);
      if (binanceData) {
        return binanceData;
      }
    } catch (error) {
    }

    // Fallback 3: 尝试CoinGecko API
    try {
      const geckoData = await this.fetchFromCoinGecko(symbol);
      if (geckoData) {
        return geckoData;
      }
    } catch (error) {
    }

    // 所有数据源都失败
    throw new Error(`All price data sources failed for ${symbol}. Please try again later.`);
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
        return matchedToken;
      }
    }
    
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

    const promises = symbols.map(symbol => 
      this.getTokenPrice(symbol).catch(error => {
        return null; // 返回null而不是抛出错误，允许部分成功
      })
    );

    const results = await Promise.all(promises);
    
    // 过滤掉失败的结果
    const successResults = results.filter(result => result !== null) as CachedTokenData[];
    
    
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
    } else {
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
      return false;
    }

    let successCount = 0;
    for (const key of keysResult.data) {
      const deleteResult = await cacheService.delete(key);
      if (deleteResult.success) {
        successCount++;
      }
    }

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
      message = `Token ${symbol} not found, please check if the token symbol is correct`;
      retryable = false;
    } else if (error.message.includes('timeout')) {
      code = ApiErrorCode.TIMEOUT_ERROR;
      message = 'Query timeout, please try again later';
      retryable = true;
    } else if (error.message.includes('rate limit') || error.message.includes('429')) {
      code = ApiErrorCode.RATE_LIMIT_EXCEEDED;
      message = 'Too many requests, please try again later';
      retryable = true;
    } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
      code = ApiErrorCode.NETWORK_ERROR;
      message = 'Network connection failed, please check your network connection';
      retryable = true;
    } else if (error.message.includes('server') || error.message.includes('50')) {
      code = ApiErrorCode.SERVER_ERROR;
      message = 'Server error, please try again later';
      retryable = true;
    } else {
      code = ApiErrorCode.UNKNOWN_ERROR;
      message = `Failed to query ${symbol} price: ${error.message}`;
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
   * Hyperliquid价格API fallback
   */
  private async fetchFromHyperliquid(symbol: string): Promise<TokenData | null> {
    try {
      const response = await apiService.get<any>(`/api/hyperliquid/getAllMids`);
      
      if (response && response.data && Array.isArray(response.data)) {
        const tokenData = response.data.find((item: any) => 
          item.coin && item.coin.toUpperCase() === symbol.toUpperCase()
        );
        
        if (tokenData && tokenData.px) {
          return {
            symbol: symbol.toUpperCase(),
            name: symbol,
            price: parseFloat(tokenData.px),
            change24h: 0, // Hyperliquid可能不提供24h变化
            volume24h: 0,
            marketCap: 0,
            high24h: 0,
            low24h: 0,
            supply: { circulating: 0, total: 0, max: 0 },
            updatedAt: new Date(),
            source: 'hyperliquid_api'
          };
        }
      }
    } catch (error) {
    }
    return null;
  }

  /**
   * Binance公共API fallback
   */
  private async fetchFromBinance(symbol: string): Promise<TokenData | null> {
    try {
      const axios = require('axios');
      const binanceSymbol = `${symbol.toUpperCase()}USDT`;
      
      const [priceResponse, statsResponse] = await Promise.all([
        axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`, { timeout: 5000 }),
        axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`, { timeout: 5000 })
      ]);
      
      if (priceResponse.data && priceResponse.data.price) {
        const price = parseFloat(priceResponse.data.price);
        const stats = statsResponse.data || {};
        
        return {
          symbol: symbol.toUpperCase(),
          name: symbol,
          price: price,
          change24h: parseFloat(stats.priceChangePercent || '0'),
          volume24h: parseFloat(stats.volume || '0'),
          marketCap: 0,
          high24h: parseFloat(stats.highPrice || '0'),
          low24h: parseFloat(stats.lowPrice || '0'),
          supply: { circulating: 0, total: 0, max: 0 },
          updatedAt: new Date(),
          source: 'binance_api'
        };
      }
    } catch (error) {
    }
    return null;
  }

  /**
   * CoinGecko API fallback
   */
  private async fetchFromCoinGecko(symbol: string): Promise<TokenData | null> {
    try {
      const axios = require('axios');
      
      // CoinGecko ID映射
      const coinGeckoIds: { [key: string]: string } = {
        'BTC': 'bitcoin',
        'ETH': 'ethereum', 
        'SOL': 'solana',
        'USDC': 'usd-coin',
        'USDT': 'tether'
      };
      
      const coinId = coinGeckoIds[symbol.toUpperCase()];
      if (!coinId) {
        return null;
      }
      
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
        { timeout: 5000 }
      );
      
      if (response.data && response.data[coinId]) {
        const data = response.data[coinId];
        return {
          symbol: symbol.toUpperCase(),
          name: symbol,
          price: data.usd || 0,
          change24h: data.usd_24h_change || 0,
          volume24h: data.usd_24h_vol || 0,
          marketCap: data.usd_market_cap || 0,
          high24h: 0,
          low24h: 0,
          supply: { circulating: 0, total: 0, max: 0 },
          updatedAt: new Date(),
          source: 'coingecko_api'
        };
      }
    } catch (error) {
    }
    return null;
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
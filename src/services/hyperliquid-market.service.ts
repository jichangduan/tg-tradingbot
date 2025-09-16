import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * Hyperliquid API types
 */
export interface HyperliquidMarketMeta {
  szDecimals: number;
  name: string;
  maxLeverage: number;
  marginTableId: number;
  isDelisted?: boolean;
  onlyIsolated?: boolean;
}

export interface HyperliquidMarketData {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
  impactPxs: string[];
  dayBaseVlm: string;
}

export interface HyperliquidMarketInfo {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  decimals: number;
}

export interface HyperliquidApiResponse {
  metadata: { universe: HyperliquidMarketMeta[] };
  marketData: HyperliquidMarketData[];
}

/**
 * Hyperliquid API service for market data
 */
export class HyperliquidMarketService {
  private client: AxiosInstance;
  private readonly baseUrl: string;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly cacheExpiry = 30 * 1000; // 30 seconds cache

  constructor() {
    this.baseUrl = config.hyperliquid.apiUrl;
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: config.hyperliquid.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AIW3-TGBot/1.0'
      }
    });

    this.setupInterceptors();
    
    // Log environment information
    logger.info(`🔧 Hyperliquid Market Service initialized`, {
      environment: config.env.nodeEnv,
      apiUrl: this.baseUrl,
      isMainnet: config.hyperliquid.isMainnet
    });
  }

  /**
   * Setup request/response interceptors for logging
   */
  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`🔗 Hyperliquid Market API: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Hyperliquid Market API request error:', { error: error.message });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`✅ Hyperliquid Market API: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
        return response;
      },
      (error) => {
        logger.warn(`❌ Hyperliquid Market API: ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${error.response?.status || 'NETWORK'}: ${error.message}`);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Check if cached data is still valid
   */
  private isCacheValid(key: string): boolean {
    const cached = this.cache.get(key);
    if (!cached) return false;
    
    return Date.now() - cached.timestamp < this.cacheExpiry;
  }

  /**
   * Get cached data if valid
   */
  private getCachedData(key: string): any | null {
    if (this.isCacheValid(key)) {
      const cached = this.cache.get(key);
      logger.debug(`📋 Using cached data for ${key}`);
      return cached?.data;
    }
    return null;
  }

  /**
   * Store data in cache
   */
  private setCachedData(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Fetch market metadata and data from Hyperliquid
   */
  public async fetchMarketData(): Promise<HyperliquidMarketInfo[]> {
    try {
      const cacheKey = 'market_data';
      
      // Try to get cached data first
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      logger.debug('Fetching fresh market data from Hyperliquid');

      const response = await this.client.post('/info', {
        type: 'metaAndAssetCtxs'
      });

      if (!response.data || !Array.isArray(response.data) || response.data.length !== 2) {
        throw new Error('Invalid response format from Hyperliquid API');
      }

      const [metadataResponse, marketDataResponse] = response.data;
      
      if (!metadataResponse?.universe || !Array.isArray(metadataResponse.universe)) {
        throw new Error('Invalid metadata format from Hyperliquid API');
      }

      if (!Array.isArray(marketDataResponse)) {
        throw new Error('Invalid market data format from Hyperliquid API');
      }

      const metadata = metadataResponse.universe as HyperliquidMarketMeta[];
      const marketData = marketDataResponse as HyperliquidMarketData[];

      // Process and combine metadata with market data
      const processedData = this.processMarketData(metadata, marketData);

      // Cache the processed data
      this.setCachedData(cacheKey, processedData);

      logger.debug(`Successfully processed ${processedData.length} market entries from Hyperliquid`);
      return processedData;

    } catch (error) {
      logger.error('Failed to fetch market data from Hyperliquid', {
        error: (error as Error).message
      });
      throw new Error(`Hyperliquid API error: ${(error as Error).message}`);
    }
  }

  /**
   * Process and combine metadata with market data
   */
  private processMarketData(
    metadata: HyperliquidMarketMeta[], 
    marketData: HyperliquidMarketData[]
  ): HyperliquidMarketInfo[] {
    const results: HyperliquidMarketInfo[] = [];

    for (let i = 0; i < Math.min(metadata.length, marketData.length); i++) {
      const meta = metadata[i];
      const data = marketData[i];

      try {
        // Skip delisted coins
        if (meta.isDelisted) {
          continue;
        }

        const currentPrice = parseFloat(data.midPx || data.markPx || '0');
        const prevPrice = parseFloat(data.prevDayPx || '0');
        const volume24h = parseFloat(data.dayNtlVlm || '0');

        // Skip if prices are invalid or zero
        if (currentPrice <= 0 || prevPrice <= 0) {
          continue;
        }

        // Calculate 24h change percentage
        const change24h = ((currentPrice - prevPrice) / prevPrice) * 100;

        results.push({
          symbol: meta.name,
          price: currentPrice,
          change24h: change24h,
          volume24h: volume24h,
          decimals: meta.szDecimals
        });

      } catch (error) {
        logger.warn(`Failed to process market data for ${meta.name}`, {
          error: (error as Error).message
        });
        continue;
      }
    }

    // Log statistics about changes to verify data quality
    const zeroChangeCount = results.filter(item => Math.abs(item.change24h) < 0.001).length;
    const nonZeroChangeCount = results.length - zeroChangeCount;
    
    logger.debug('Market data change statistics', {
      totalEntries: results.length,
      zeroChangeCount,
      nonZeroChangeCount,
      percentageWithChange: ((nonZeroChangeCount / results.length) * 100).toFixed(2) + '%'
    });

    // Filter out coins with zero change to avoid the "all zeros" problem
    // But keep some fallback data in case all are zero
    const filteredResults = results.filter(item => Math.abs(item.change24h) > 0.001);
    
    if (filteredResults.length === 0) {
      logger.warn('All market data has zero change, returning unfiltered results');
      return results
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, 50); // Return top 50 by volume even if zero change
    }

    // Sort by volume (descending) and return top coins
    return filteredResults
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 100); // Return top 100 by volume
  }

  /**
   * Convert HyperliquidMarketInfo to the format expected by MarketsHandler
   */
  public convertToMarketData(hyperliquidData: HyperliquidMarketInfo[]): Array<{name: string, price: number, change: number}> {
    return hyperliquidData.map(item => ({
      name: item.symbol,
      price: item.price,
      change: item.change24h
    }));
  }

  /**
   * Health check for Hyperliquid API
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.post('/info', {
        type: 'meta'
      });

      return response.status === 200 && response.data?.universe;
    } catch (error) {
      logger.warn('Hyperliquid Market health check failed', {
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * Get supported trading pairs
   */
  public async getSupportedPairs(): Promise<string[]> {
    try {
      const response = await this.client.post('/info', {
        type: 'meta'
      });

      if (!response.data?.universe) {
        throw new Error('Invalid metadata response');
      }

      return response.data.universe
        .filter((item: HyperliquidMarketMeta) => !item.isDelisted)
        .map((item: HyperliquidMarketMeta) => item.name);

    } catch (error) {
      logger.error('Failed to get supported pairs from Hyperliquid', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Clear cache (useful for testing or forcing fresh data)
   */
  public clearCache(): void {
    this.cache.clear();
    logger.debug('Hyperliquid Market service cache cleared');
  }
}

// Export singleton instance
export const hyperliquidMarketService = new HyperliquidMarketService();

// Default export
export default hyperliquidMarketService;
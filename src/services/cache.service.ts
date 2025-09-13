import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * 缓存操作结果接口
 */
interface CacheResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Redis缓存服务类
 * 提供统一的缓存操作接口，包括连接管理、错误处理和降级机制
 */
export class CacheService {
  private client?: RedisClientType;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  private readonly reconnectDelay: number = 1000;
  private readonly redisEnabled: boolean;
  
  // 内存fallback缓存，用于Redis不可用时的备用存储
  private memoryCache = new Map<string, {value: string, expiry: number}>();

  constructor() {
    // Only create Redis client if Redis configuration is provided
    this.redisEnabled = !!(process.env.REDIS_HOST && process.env.REDIS_PORT);
    
    if (this.redisEnabled) {
      this.client = createClient({
        socket: {
          host: config.redis.host,
          port: config.redis.port,
          connectTimeout: config.redis.connectTimeout
        },
        password: config.redis.password,
        database: config.redis.db
      });

      this.setupEventHandlers();
    } else {
      logger.info('Redis configuration not found, running without cache');
    }
  }

  /**
   * 设置Redis事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.client) return;
    
    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info('Redis client ready to use');
    });

    this.client.on('error', (error: Error) => {
      this.isConnected = false;
      logger.error('Redis client error:', { error: error.message });
    });

    this.client.on('end', () => {
      this.isConnected = false;
      logger.warn('Redis connection ended');
    });

    this.client.on('reconnecting', () => {
      this.reconnectAttempts++;
      logger.info(`Redis client reconnecting (attempt ${this.reconnectAttempts})`);
    });
  }

  /**
   * 初始化Redis连接
   */
  public async connect(): Promise<void> {
    if (!this.redisEnabled) {
      logger.info('Redis is disabled, skipping connection');
      return;
    }

    if (this.isConnected || !this.client) {
      return;
    }

    try {
      await this.client.connect();
      logger.info('Redis cache service initialized successfully');
    } catch (error) {
      logger.error('Failed to connect to Redis:', { error: (error as Error).message });
      throw new Error(`Redis connection failed: ${(error as Error).message}`);
    }
  }

  /**
   * 断开Redis连接
   */
  public async disconnect(): Promise<void> {
    if (!this.isConnected || !this.client) {
      return;
    }

    try {
      await this.client.disconnect();
      this.isConnected = false;
      logger.info('Redis cache service disconnected');
    } catch (error) {
      logger.error('Error disconnecting from Redis:', { error: (error as Error).message });
    }
  }

  /**
   * 检查Redis连接状态
   */
  public isReady(): boolean {
    return this.redisEnabled && this.isConnected && this.client?.isReady === true;
  }

  /**
   * 设置缓存值
   */
  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<CacheResult<boolean>> {
    try {
      const serializedValue = JSON.stringify(value);
      
      // 优先尝试Redis存储
      if (this.isReady()) {
        try {
          if (ttlSeconds && ttlSeconds > 0) {
            await this.client!.setEx(key, ttlSeconds, serializedValue);
          } else {
            await this.client!.set(key, serializedValue);
          }
          logger.logCache('set', key, ttlSeconds);
          return { success: true, data: true };
        } catch (redisError) {
          const errorMessage = (redisError as Error).message;
          
          // Redis写入失败，降级到内存存储
          logger.warn(`Redis set failed, falling back to memory cache for key: ${key}`, { 
            error: errorMessage 
          });
        }
      }
      
      // Redis不可用或失败时，使用内存存储
      const expiry = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : 0;
      this.memoryCache.set(key, { value: serializedValue, expiry });
      
      logger.debug(`Fallback memory cache set for key: ${key}`, { ttlSeconds });
      return { success: true, data: true };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Cache set completely failed for key: ${key}`, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 获取缓存值
   */
  public async get<T>(key: string): Promise<CacheResult<T>> {
    try {
      // 优先尝试从Redis获取
      if (this.isReady()) {
        try {
          const value = await this.client!.get(key);
          if (value !== null) {
            const parsedValue = JSON.parse(value) as T;
            logger.logCache('hit', key);
            return { success: true, data: parsedValue };
          }
        } catch (redisError) {
          logger.warn(`Redis get failed, trying memory cache for key: ${key}`, { 
            error: (redisError as Error).message 
          });
        }
      }
      
      // Redis不可用或失败时，尝试从内存缓存获取
      const memoryItem = this.memoryCache.get(key);
      if (memoryItem) {
        // 检查是否过期
        if (memoryItem.expiry > 0 && Date.now() > memoryItem.expiry) {
          this.memoryCache.delete(key);
          logger.logCache('miss', key);
          return { success: false };
        }
        
        const parsedValue = JSON.parse(memoryItem.value) as T;
        logger.debug(`Fallback memory cache hit for key: ${key}`);
        return { success: true, data: parsedValue };
      }

      logger.logCache('miss', key);
      return { success: false };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Cache get completely failed for key: ${key}`, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 删除缓存值
   */
  public async delete(key: string): Promise<CacheResult<boolean>> {
    try {
      let redisDeleted = false;
      
      // 尝试从Redis删除
      if (this.isReady()) {
        try {
          const result = await this.client!.del(key);
          redisDeleted = result > 0;
        } catch (redisError) {
          logger.warn(`Redis delete failed, will delete from memory cache for key: ${key}`, { 
            error: (redisError as Error).message 
          });
        }
      }
      
      // 同时从内存缓存删除
      const memoryDeleted = this.memoryCache.delete(key);
      
      logger.logCache('delete', key);
      return { success: true, data: redisDeleted || memoryDeleted };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Cache delete completely failed for key: ${key}`, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 检查键是否存在
   */
  public async exists(key: string): Promise<CacheResult<boolean>> {
    try {
      if (!this.isReady()) {
        return { success: false, error: 'Redis not connected' };
      }

      const result = await this.client!.exists(key);
      return { success: true, data: result > 0 };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Cache exists check failed for key: ${key}`, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 设置键的过期时间
   */
  public async expire(key: string, ttlSeconds: number): Promise<CacheResult<boolean>> {
    try {
      if (!this.isReady()) {
        return { success: false, error: 'Redis not connected' };
      }

      const result = await this.client!.expire(key, ttlSeconds);
      return { success: true, data: result };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Cache expire failed for key: ${key}`, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 获取键的剩余过期时间
   */
  public async ttl(key: string): Promise<CacheResult<number>> {
    try {
      if (!this.isReady()) {
        return { success: false, error: 'Redis not connected' };
      }

      const result = await this.client!.ttl(key);
      return { success: true, data: result };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Cache TTL check failed for key: ${key}`, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 清除所有缓存（谨慎使用）
   */
  public async flush(): Promise<CacheResult<boolean>> {
    try {
      if (!this.isReady()) {
        return { success: false, error: 'Redis not connected' };
      }

      await this.client!.flushDb();
      logger.warn('All cache data flushed');
      return { success: true, data: true };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('Cache flush failed', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 获取匹配模式的所有键
   */
  public async keys(pattern: string): Promise<CacheResult<string[]>> {
    try {
      if (!this.isReady()) {
        return { success: false, error: 'Redis not connected' };
      }

      const result = await this.client!.keys(pattern);
      return { success: true, data: result };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Cache keys lookup failed for pattern: ${pattern}`, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 健康检查
   */
  public async healthCheck(): Promise<boolean> {
    try {
      if (!this.isReady()) {
        return false;
      }

      await this.client!.ping();
      return true;
    } catch (error) {
      logger.warn('Cache health check failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * 获取缓存统计信息
   */
  public async getStats(): Promise<CacheResult<any>> {
    try {
      if (!this.isReady()) {
        return { success: false, error: 'Redis not connected' };
      }

      const info = await this.client!.info();
      return { success: true, data: info };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('Failed to get cache stats', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 带有降级机制的缓存获取方法
   * 如果缓存失败，执行回调函数获取数据并缓存
   */
  public async getOrSet<T>(
    key: string, 
    fallbackFn: () => Promise<T>, 
    ttlSeconds?: number
  ): Promise<T> {
    // 尝试从缓存获取
    const cacheResult = await this.get<T>(key);
    if (cacheResult.success && cacheResult.data !== undefined) {
      logger.debug(`🎯 Cache hit for key: ${key}`);
      return cacheResult.data;
    }

    // 缓存未命中，执行回调函数
    try {
      logger.debug(`📥 Cache miss for key: ${key}, executing fallback function`);
      const data = await fallbackFn();
      
      // 尝试设置缓存（不阻塞主流程）
      this.set(key, data, ttlSeconds).catch(error => {
        const errorMessage = (error as Error).message || error;
        if (typeof errorMessage === 'string' && 
            (errorMessage.includes('MISCONF') || errorMessage.includes('stop-writes-on-bgsave-error'))) {
          logger.debug(`🔧 Redis config issue prevents caching key: ${key}, but data retrieved successfully`);
        } else {
          logger.warn(`Failed to cache data for key: ${key}`, { error: errorMessage });
        }
      });
      
      return data;
    } catch (error) {
      logger.error(`Fallback function failed for key: ${key}`, { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * 获取匹配模式的所有键
   */
  public async getKeys(pattern: string): Promise<string[]> {
    try {
      if (!this.isReady()) {
        logger.warn('Redis not connected, returning empty keys array');
        return [];
      }

      const keys = await this.client!.keys(pattern);
      return keys;

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Cache getKeys failed for pattern: ${pattern}`, { error: errorMessage });
      return [];
    }
  }
}

// 导出单例实例
export const cacheService = new CacheService();

// 默认导出
export default cacheService;
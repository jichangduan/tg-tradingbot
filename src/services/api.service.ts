import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * 扩展的API请求配置接口
 */
export interface ApiRequestConfig extends AxiosRequestConfig {
  retry?: number;
  skipLogging?: boolean;
}

/**
 * API错误类型
 */
export class ApiError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly response?: any;

  constructor(message: string, status?: number, code?: string, response?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

/**
 * 统一API服务类
 * 提供HTTP请求的统一封装、错误处理、重试机制和日志记录
 */
export class ApiService {
  private client: AxiosInstance;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor() {
    this.maxRetries = config.api.retryAttempts;
    this.retryDelay = config.api.retryDelay;
    
    this.client = axios.create({
      baseURL: config.api.baseUrl,
      timeout: config.api.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AIW3-TGBot/1.0',
        'Accept': 'application/json',
        ...(config.api.apiKey && {
          'x-api-key': config.api.apiKey
        })
      }
    });

    this.setupInterceptors();
  }

  /**
   * 设置请求和响应拦截器
   */
  private setupInterceptors(): void {
    // 请求拦截器
    this.client.interceptors.request.use(
      (config) => {
        const requestId = this.generateRequestId();
        config.metadata = { ...config.metadata, requestId, startTime: Date.now() };
        
        if (!config.skipLogging) {
          logger.http(`API Request [${requestId}]: ${config.method?.toUpperCase()} ${config.url}`, {
            method: config.method,
            url: config.url,
            params: config.params,
            requestId
          });
        }
        
        return config;
      },
      (error: AxiosError) => {
        logger.error('API Request Setup Error:', { error: error.message });
        return Promise.reject(error);
      }
    );

    // 响应拦截器
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        const duration = Date.now() - (response.config.metadata?.startTime || 0);
        const requestId = response.config.metadata?.requestId;
        
        if (!response.config.skipLogging) {
          logger.logApiCall(
            response.config.method?.toUpperCase() || 'UNKNOWN',
            response.config.url || '',
            duration,
            response.status
          );
        }
        
        return response;
      },
      async (error: AxiosError) => {
        const duration = Date.now() - (error.config?.metadata?.startTime || 0);
        const requestId = error.config?.metadata?.requestId;
        
        if (!error.config?.skipLogging) {
          logger.logApiCall(
            error.config?.method?.toUpperCase() || 'UNKNOWN',
            error.config?.url || '',
            duration,
            error.response?.status,
            error.message
          );
        }
        
        return Promise.reject(this.handleApiError(error));
      }
    );
  }

  /**
   * 生成请求ID用于日志跟踪
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 统一API请求方法
   */
  public async request<T>(config: ApiRequestConfig): Promise<T> {
    const retries = config.retry || 0;
    
    try {
      const response = await this.client.request<T>(config);
      return response.data;
    } catch (error) {
      // 判断是否应该重试
      if (retries < this.maxRetries && this.shouldRetry(error as AxiosError)) {
        logger.warn(`Retrying API request (${retries + 1}/${this.maxRetries})`, {
          method: config.method,
          url: config.url,
          attempt: retries + 1,
          error: (error as AxiosError).message
        });
        
        // 递增延迟重试
        await this.delay(this.retryDelay * (retries + 1));
        return this.request({ ...config, retry: retries + 1 });
      }
      
      throw error;
    }
  }

  /**
   * GET请求的便捷方法
   */
  public async get<T>(url: string, params?: any, config?: ApiRequestConfig): Promise<T> {
    return this.request<T>({
      method: 'GET',
      url,
      params,
      ...config
    });
  }

  /**
   * 带认证的GET请求方法
   */
  public async getWithAuth<T>(url: string, accessToken: string, params?: any, config?: ApiRequestConfig): Promise<T> {
    return this.request<T>({
      method: 'GET',
      url,
      params,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...config?.headers
      },
      ...config
    });
  }

  /**
   * POST请求的便捷方法
   */
  public async post<T>(url: string, data?: any, config?: ApiRequestConfig): Promise<T> {
    return this.request<T>({
      method: 'POST',
      url,
      data,
      ...config
    });
  }

  /**
   * PUT请求的便捷方法
   */
  public async put<T>(url: string, data?: any, config?: ApiRequestConfig): Promise<T> {
    return this.request<T>({
      method: 'PUT',
      url,
      data,
      ...config
    });
  }

  /**
   * DELETE请求的便捷方法
   */
  public async delete<T>(url: string, config?: ApiRequestConfig): Promise<T> {
    return this.request<T>({
      method: 'DELETE',
      url,
      ...config
    });
  }

  /**
   * 处理API错误，转换为统一的错误格式
   */
  private handleApiError(error: AxiosError): ApiError {
    if (!error.response) {
      // 网络错误或请求超时
      return new ApiError(
        '网络连接失败，请检查网络连接',
        undefined,
        'NETWORK_ERROR',
        error
      );
    }

    const { status, data } = error.response;
    let message: string;
    let code: string;

    // 根据HTTP状态码生成用户友好的错误消息
    switch (status) {
      case 400:
        message = (data as any)?.message || '请求参数错误';
        code = 'BAD_REQUEST';
        break;
      case 401:
        message = 'API认证失败，请检查API密钥';
        code = 'UNAUTHORIZED';
        break;
      case 403:
        message = '访问权限不足';
        code = 'FORBIDDEN';
        break;
      case 404:
        message = (data as any)?.message || '请求的资源未找到';
        code = 'NOT_FOUND';
        break;
      case 429:
        message = '请求频率超限，请稍后重试';
        code = 'RATE_LIMIT';
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        message = '服务器内部错误，请稍后重试';
        code = 'SERVER_ERROR';
        break;
      default:
        message = (data as any)?.message || `请求失败 (${status})`;
        code = 'UNKNOWN_ERROR';
    }

    return new ApiError(message, status, code, data);
  }

  /**
   * 判断是否应该重试请求
   */
  private shouldRetry(error: AxiosError): boolean {
    // 网络错误或连接超时，应该重试
    if (!error.response) {
      return true;
    }

    const { status } = error.response;
    
    // 以下状态码应该重试：
    // - 5xx 服务器错误
    // - 429 请求频率超限
    return status >= 500 || status === 429;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 健康检查 - 测试API连接状态
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 尝试调用一个轻量级的API端点
      await this.get('/health', undefined, { 
        skipLogging: true,
        timeout: 5000
      });
      return true;
    } catch (error) {
      logger.warn('API health check failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * 获取客户端实例（用于特殊情况的直接访问）
   */
  public getClient(): AxiosInstance {
    return this.client;
  }
}

// 导出单例实例
export const apiService = new ApiService();

// 默认导出
export default apiService;

// 类型声明扩展，为axios config添加metadata
declare module 'axios' {
  interface AxiosRequestConfig {
    metadata?: {
      requestId?: string;
      startTime?: number;
      [key: string]: any;
    };
    skipLogging?: boolean;
  }
}
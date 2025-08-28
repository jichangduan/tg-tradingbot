import { apiService } from './api.service';
import { logger } from '../utils/logger';
import { UserInitRequest, UserInitData, UserInitApiResponse, DetailedError, ApiErrorCode } from '../types/api.types';

/**
 * 用户服务类
 * 处理用户相关的API调用，包括用户初始化、信息获取等
 */
export class UserService {
  private readonly apiEndpoint: string = '/api/tgbot/user/init';


  /**
   * 初始化或获取Telegram用户信息
   * 为新用户自动创建钱包地址，为已存在用户返回用户信息
   * 
   * @param request 用户初始化请求参数
   * @returns 用户初始化数据
   * @throws DetailedError 当API调用失败时
   */
  public async initializeUser(request: UserInitRequest): Promise<UserInitData> {
    const startTime = Date.now();
    const requestId = `user_init_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // 参数验证
      this.validateInitRequest(request);

      logger.info(`User initialization started [${requestId}]`, {
        telegramId: request.telegram_id,
        username: request.username,
        firstName: request.first_name,
        hasInvitationCode: !!request.invitation_code,
        requestId
      });

      // 调用AIW3 API
      const response = await apiService.post<UserInitApiResponse>(
        this.apiEndpoint,
        request,
        {
          timeout: 10000, // 10秒超时，用户初始化可能较慢
          retry: 2 // 允许重试2次
        }
      );

      // 详细响应日志记录 (用于诊断用户初始化API格式问题) - 使用info级别确保可见
      logger.info(`Raw User Init API response [${requestId}]`, {
        endpoint: this.apiEndpoint,
        responseType: typeof response,
        responseKeys: response ? Object.keys(response) : [],
        response: JSON.stringify(response, null, 2),
        requestId
      });

      // 验证响应格式
      if (!this.isValidInitResponse(response)) {
        // 记录完整的API响应用于调试（错误级别确保可见）
        logger.error(`User Init API validation failed - FULL RESPONSE [${requestId}]`, {
          fullApiResponse: JSON.stringify(response, null, 2),
          endpoint: this.apiEndpoint,
          responseType: typeof response,
          responseKeys: response ? Object.keys(response) : [],
          dataKeys: response && (response as any).data && typeof (response as any).data === 'object' ? Object.keys((response as any).data) : [],
          requestId
        });
        
        throw this.createDetailedError(
          ApiErrorCode.DATA_UNAVAILABLE,
          'Invalid API response format',
          'API返回数据格式不正确'
        );
      }

      const duration = Date.now() - startTime;
      logger.info(`User initialization successful [${requestId}] - ${duration}ms`, {
        userId: response.data.userId,
        walletAddress: response.data.walletAddress,
        isNewUser: response.data.isNewUser,
        duration,
        requestId
      });

      // 记录性能指标
      logger.logPerformance('user_initialization_success', duration, {
        telegramId: request.telegram_id,
        username: request.username,
        isNewUser: response.data.isNewUser,
        requestId
      });

      return response.data;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error(`User initialization failed [${requestId}] - ${duration}ms`, {
        telegramId: request.telegram_id,
        username: request.username,
        errorCode: (error as any).code,
        errorMessage: (error as Error).message,
        duration,
        requestId
      });

      // 处理并重新抛出详细错误
      throw this.handleServiceError(error, requestId);
    }
  }

  /**
   * 验证用户初始化请求参数
   */
  private validateInitRequest(request: UserInitRequest): void {
    if (!request.telegram_id) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL, // 复用现有错误码
        'telegram_id is required',
        'Telegram用户ID不能为空'
      );
    }

    // 验证telegram_id格式（应为数字字符串）
    if (!/^\d+$/.test(request.telegram_id)) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL,
        'Invalid telegram_id format',
        'Telegram用户ID格式不正确'
      );
    }

    // 验证可选字段长度
    if (request.username && request.username.length > 32) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL,
        'Username too long',
        '用户名过长，最多32个字符'
      );
    }

    if (request.first_name && request.first_name.length > 64) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL,
        'First name too long',
        '名字过长，最多64个字符'
      );
    }

    if (request.last_name && request.last_name.length > 64) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL,
        'Last name too long',
        '姓氏过长，最多64个字符'
      );
    }
  }

  /**
   * 验证API响应格式
   */
  private isValidInitResponse(response: any): response is UserInitApiResponse {
    return (
      response &&
      typeof response.code === 'number' &&
      typeof response.message === 'string' &&
      response.data &&
      typeof response.data.userId === 'number' &&
      typeof response.data.walletAddress === 'string' &&
      typeof response.data.nickname === 'string' &&
      typeof response.data.profilePhotoUrl === 'string' &&
      typeof response.data.referralCode === 'string' &&
      typeof response.data.energy === 'number' &&
      typeof response.data.isNewUser === 'boolean' &&
      typeof response.data.accessToken === 'string'
    );
  }

  /**
   * 处理服务错误，转换为统一的详细错误格式
   */
  private handleServiceError(error: any, requestId: string): DetailedError {
    // 如果已经是DetailedError，直接返回
    if (error && typeof error.code === 'string' && typeof error.message === 'string' && error.retryable !== undefined) {
      return error as DetailedError;
    }

    // 处理网络错误
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return this.createDetailedError(
        ApiErrorCode.NETWORK_ERROR,
        error.message,
        '网络连接失败，请检查网络连接'
      );
    }

    // 处理超时错误
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return this.createDetailedError(
        ApiErrorCode.TIMEOUT_ERROR,
        error.message,
        '请求超时，请稍后重试'
      );
    }

    // 处理HTTP状态码错误
    if (error.status || error.statusCode) {
      const status = error.status || error.statusCode;
      const message = error.response?.data?.message || error.message;

      switch (status) {
        case 400:
          return this.createDetailedError(
            ApiErrorCode.INVALID_SYMBOL,
            message,
            '请求参数错误，请检查输入信息'
          );
        case 401:
          return this.createDetailedError(
            ApiErrorCode.UNAUTHORIZED,
            message,
            'API认证失败，请联系管理员'
          );
        case 403:
          return this.createDetailedError(
            ApiErrorCode.FORBIDDEN,
            message,
            '访问权限不足'
          );
        case 404:
          return this.createDetailedError(
            ApiErrorCode.TOKEN_NOT_FOUND,
            message,
            '用户服务不可用'
          );
        case 429:
          return this.createDetailedError(
            ApiErrorCode.RATE_LIMIT_EXCEEDED,
            message,
            '请求过于频繁，请稍后重试'
          );
        case 500:
        case 502:
        case 503:
        case 504:
          return this.createDetailedError(
            ApiErrorCode.SERVER_ERROR,
            message,
            '服务器内部错误，请稍后重试'
          );
        default:
          return this.createDetailedError(
            ApiErrorCode.UNKNOWN_ERROR,
            message || error.message,
            `服务异常 (${status})`
          );
      }
    }

    // 默认错误处理
    return this.createDetailedError(
      ApiErrorCode.UNKNOWN_ERROR,
      error.message || 'Unknown error',
      '用户初始化失败，请稍后重试'
    );
  }

  /**
   * 创建详细错误对象
   */
  private createDetailedError(
    code: ApiErrorCode,
    originalMessage: string,
    userFriendlyMessage: string,
    retryable: boolean = true
  ): DetailedError {
    return {
      code,
      message: userFriendlyMessage,
      statusCode: undefined,
      retryable,
      context: {
        endpoint: this.apiEndpoint,
        timestamp: new Date()
      }
    };
  }

  /**
   * 解析邀请码（预留功能）
   * 从/start命令参数中提取邀请码
   */
  public parseInvitationCode(startParameter?: string): string | undefined {
    if (!startParameter) {
      return undefined;
    }

    // 处理不同格式的邀请码
    // 例如: /start invite_ABC123 -> ABC123
    // 例如: /start ABC123 -> ABC123
    const cleaned = startParameter.replace(/^invite_/, '').trim();
    
    // 验证邀请码格式（假设为字母数字组合，6-10位）
    if (/^[A-Za-z0-9]{6,10}$/.test(cleaned)) {
      return cleaned.toUpperCase();
    }

    return undefined;
  }

  /**
   * 获取用户头像URL（预留功能）
   * 从Telegram API获取用户头像
   */
  public async getUserPhotoUrl(telegramId: string): Promise<string | undefined> {
    try {
      // 这里可以调用Telegram Bot API获取用户头像
      // 暂时返回undefined，使用默认头像
      return undefined;
    } catch (error) {
      logger.warn('Failed to get user photo', { 
        telegramId, 
        error: (error as Error).message 
      });
      return undefined;
    }
  }

  /**
   * 健康检查 - 测试用户服务连接状态
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 可以调用一个轻量级的用户服务端点进行健康检查
      // 暂时使用基础API服务的健康检查
      return await apiService.healthCheck();
    } catch (error) {
      logger.warn('User service health check failed', { 
        error: (error as Error).message 
      });
      return false;
    }
  }

  /**
   * 获取服务统计信息
   */
  public getStats(): any {
    return {
      name: 'UserService',
      version: '1.0.0',
      supportedEndpoints: ['/api/tgbot/user/init'],
      features: [
        'User initialization',
        'Automatic wallet creation',
        'Invitation code support',
        'Comprehensive error handling'
      ]
    };
  }

}

// 导出单例实例
export const userService = new UserService();

// 默认导出
export default userService;
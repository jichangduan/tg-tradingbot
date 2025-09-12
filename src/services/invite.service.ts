import { apiService } from './api.service';
import { userService } from './user.service';
import { logger } from '../utils/logger';
import { 
  InviteStatsApiResponse,
  RawInviteStatsApiResponse, 
  FormattedInviteStats, 
  DetailedError, 
  ApiErrorCode,
  UserInitRequest
} from '../types/api.types';

/**
 * 邀请服务类
 * 处理邀请统计相关的API调用，包括邀请记录获取、积分计算等
 */
export class InviteService {
  private readonly apiEndpoint: string = '/api/reward/inviteRecord';

  /**
   * 获取用户的邀请统计信息
   * @param telegramId Telegram用户ID
   * @param page 页码 (可选，默认1)
   * @param pageSize 每页记录数 (可选，默认20)
   * @returns 格式化的邀请统计数据
   * @throws DetailedError 当API调用失败时
   */
  public async getInviteStats(
    telegramId: string, 
    page: number = 1, 
    pageSize: number = 20
  ): Promise<FormattedInviteStats> {
    const startTime = Date.now();
    const requestId = `invite_stats_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      logger.info(`Invite stats query started [${requestId}]`, {
        telegramId,
        page,
        pageSize,
        requestId
      });

      // 步骤1: 确保用户已初始化（获取access token）
      const userInitRequest: UserInitRequest = {
        telegram_id: telegramId
      };
      
      const userData = await userService.initializeUser(userInitRequest);
      logger.debug(`User data retrieved [${requestId}]`, {
        userId: userData.userId,
        walletAddress: userData.walletAddress,
        requestId
      });

      // 步骤2: 构建查询参数
      const queryParams = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString()
      });

      const fullUrl = `${this.apiEndpoint}?${queryParams.toString()}`;

      // 步骤3: 调用邀请统计API，使用用户的accessToken
      // 使用RawInviteStatsApiResponse以支持灵活的数据类型
      const response = await apiService.getWithAuth<RawInviteStatsApiResponse>(
        fullUrl,
        userData.accessToken,
        undefined, // params
        {
          timeout: 8000, // 8秒超时
          retry: 2 // 允许重试2次
        }
      );

      // 详细响应日志记录 (用于诊断API格式问题) - 使用info级别确保可见
      logger.info(`Raw API response [${requestId}]`, {
        endpoint: fullUrl,
        responseType: typeof response,
        responseKeys: response ? Object.keys(response) : [],
        response: JSON.stringify(response, null, 2),
        requestId
      });

      // 步骤4: 验证响应格式
      const validationResult = this.validateInviteStatsResponse(response, requestId);
      if (!validationResult.isValid) {
        // 记录完整的API响应用于调试（错误级别确保可见）
        logger.error(`Invite API validation failed - FULL RESPONSE [${requestId}]`, {
          fullApiResponse: JSON.stringify(response, null, 2),
          validationErrors: validationResult.errors,
          endpoint: fullUrl,
          responseType: typeof response,
          responseKeys: response ? Object.keys(response) : [],
          dataKeys: response?.data ? Object.keys(response.data) : [],
          requestId
        });
        
        throw this.createDetailedError(
          ApiErrorCode.DATA_UNAVAILABLE,
          `Invalid invite stats API response format: ${validationResult.errors.join(', ')}`,
          `API返回数据格式不正确：${validationResult.errors.slice(0, 2).join('，')}`
        );
      }

      // 步骤5: 标准化响应数据并格式化
      const normalizedResponse = this.normalizeInviteStatsResponse(response);
      const formattedStats = this.formatInviteStats(normalizedResponse, page);

      const duration = Date.now() - startTime;
      logger.info(`Invite stats query successful [${requestId}] - ${duration}ms`, {
        inviteeCount: formattedStats.inviteeCount,
        totalTradingVolume: formattedStats.totalTradingVolume,
        currentPoints: formattedStats.currentPoints,
        recordsCount: formattedStats.inviteRecords.length,
        duration,
        requestId
      });

      // 记录性能指标
      logger.logPerformance('invite_stats_success', duration, {
        telegramId,
        page,
        pageSize,
        inviteeCount: formattedStats.inviteeCount,
        totalTradingVolume: formattedStats.totalTradingVolume,
        requestId
      });

      return formattedStats;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error(`Invite stats query failed [${requestId}] - ${duration}ms`, {
        telegramId,
        page,
        pageSize,
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
   * 格式化邀请统计数据
   */
  private formatInviteStats(response: InviteStatsApiResponse, page: number): FormattedInviteStats {
    const data = response.data;
    
    // 计算积分：交易量除以100
    const currentPoints = Math.floor((data.totalTradingVolume || 0) / 100 * 100) / 100; // 保留两位小数
    
    return {
      inviteeCount: data.totalRecords || 0,
      totalTradingVolume: data.totalTradingVolume || 0,
      currentPoints,
      inviteRecords: data.inviteRecord || [],
      invitationLink: data.invitationLink,
      referralCode: data.referralCode,
      pagination: {
        page: data.page || page,
        totalPages: data.totalPages || 1,
        hasNext: (data.page || page) < (data.totalPages || 1),
        hasPrev: (data.page || page) > 1
      },
      lastUpdated: new Date()
    };
  }

  /**
   * 详细验证API响应格式并提供诊断信息
   * 支持字符串到数字的自动转换，以提高兼容性
   */
  private validateInviteStatsResponse(response: any, requestId: string): { 
    isValid: boolean; 
    errors: string[]; 
    normalized?: any; // 标准化后的响应数据
  } {
    const errors: string[] = [];
    
    // 基础响应检查
    if (!response) {
      errors.push('Response is null or undefined');
      return { isValid: false, errors };
    }

    // 检查响应结构
    if (typeof response !== 'object') {
      errors.push(`Response is not an object, got: ${typeof response}`);
      return { isValid: false, errors };
    }

    // 创建标准化副本
    const normalized = JSON.parse(JSON.stringify(response));

    // 检查code字段 (允许字符串转数字)
    if (!('code' in response)) {
      errors.push('Missing "code" field');
    } else {
      const codeValue = response.code;
      if (typeof codeValue === 'string' && !isNaN(Number(codeValue))) {
        normalized.code = Number(codeValue);
      } else if (typeof codeValue !== 'number') {
        errors.push(`"code" should be number or numeric string, got: ${typeof codeValue} (${codeValue})`);
      }
    }

    // 检查data字段
    if (!('data' in response)) {
      errors.push('Missing "data" field');
    } else if (!response.data || typeof response.data !== 'object') {
      errors.push(`"data" should be object, got: ${typeof response.data}`);
    } else {
      const data = response.data;
      
      // 检查inviteRecord字段
      if (!('inviteRecord' in data)) {
        errors.push('Missing "data.inviteRecord" field');
      } else if (!Array.isArray(data.inviteRecord)) {
        errors.push(`"data.inviteRecord" should be array, got: ${typeof data.inviteRecord}`);
      }

      // 检查totalRecords字段 (允许字符串转数字)
      if (!('totalRecords' in data)) {
        errors.push('Missing "data.totalRecords" field');
      } else {
        const totalRecordsValue = data.totalRecords;
        if (typeof totalRecordsValue === 'string' && !isNaN(Number(totalRecordsValue))) {
          normalized.data.totalRecords = Number(totalRecordsValue);
        } else if (typeof totalRecordsValue !== 'number') {
          errors.push(`"data.totalRecords" should be number or numeric string, got: ${typeof totalRecordsValue} (${totalRecordsValue})`);
        }
      }

      // 检查totalTradingVolume字段 (允许字符串转数字)
      if (!('totalTradingVolume' in data)) {
        errors.push('Missing "data.totalTradingVolume" field');
      } else {
        const tradingVolumeValue = data.totalTradingVolume;
        if (typeof tradingVolumeValue === 'string' && !isNaN(Number(tradingVolumeValue))) {
          normalized.data.totalTradingVolume = Number(tradingVolumeValue);
        } else if (typeof tradingVolumeValue !== 'number') {
          errors.push(`"data.totalTradingVolume" should be number or numeric string, got: ${typeof tradingVolumeValue} (${tradingVolumeValue})`);
        }
      }

      // 检查可选的分页字段
      if ('page' in data) {
        const pageValue = data.page;
        if (typeof pageValue === 'string' && !isNaN(Number(pageValue))) {
          normalized.data.page = Number(pageValue);
        } else if (typeof pageValue !== 'number') {
          // 这不是致命错误，只是警告
          logger.warn(`Non-critical: "data.page" should be number, got: ${typeof pageValue} (${pageValue}) [${requestId}]`);
        }
      }

      if ('totalPages' in data) {
        const totalPagesValue = data.totalPages;
        if (typeof totalPagesValue === 'string' && !isNaN(Number(totalPagesValue))) {
          normalized.data.totalPages = Number(totalPagesValue);
        } else if (typeof totalPagesValue !== 'number') {
          // 这不是致命错误，只是警告
          logger.warn(`Non-critical: "data.totalPages" should be number, got: ${typeof totalPagesValue} (${totalPagesValue}) [${requestId}]`);
        }
      }
    }

    const isValid = errors.length === 0;
    
    // 记录验证结果
    if (!isValid) {
      logger.warn(`API response validation failed [${requestId}]`, {
        validationErrors: errors,
        responseStructure: {
          hasCode: 'code' in response,
          codeType: response?.code !== undefined ? typeof response.code : 'undefined',
          codeValue: response?.code,
          hasData: 'data' in response,
          dataType: response?.data !== undefined ? typeof response.data : 'undefined',
          dataKeys: response?.data && typeof response.data === 'object' ? Object.keys(response.data) : []
        },
        rawResponse: JSON.stringify(response, null, 2),
        requestId
      });
    } else {
      logger.info(`API response validation successful [${requestId}]`, {
        dataRecordCount: normalized.data?.inviteRecord?.length || 0,
        totalRecords: normalized.data?.totalRecords || 0,
        totalTradingVolume: normalized.data?.totalTradingVolume || 0,
        hasNormalization: JSON.stringify(response) !== JSON.stringify(normalized),
        requestId
      });
    }

    return { isValid, errors, normalized: isValid ? normalized : undefined };
  }

  /**
   * 验证API响应格式 (向后兼容方法)
   */
  private isValidInviteStatsResponse(response: any): response is InviteStatsApiResponse {
    return this.validateInviteStatsResponse(response, 'legacy').isValid;
  }

  /**
   * 将原始API响应标准化为统一格式
   */
  private normalizeInviteStatsResponse(raw: RawInviteStatsApiResponse): InviteStatsApiResponse {
    const normalized: InviteStatsApiResponse = {
      ...raw,
      code: typeof raw.code === 'string' ? Number(raw.code) : raw.code,
      data: {
        inviteRecord: raw.data.inviteRecord,
        page: raw.data.page ? (typeof raw.data.page === 'string' ? Number(raw.data.page) : raw.data.page) : 1,
        pageSize: raw.data.pageSize ? (typeof raw.data.pageSize === 'string' ? Number(raw.data.pageSize) : raw.data.pageSize) : 10,
        totalPages: raw.data.totalPages ? (typeof raw.data.totalPages === 'string' ? Number(raw.data.totalPages) : raw.data.totalPages) : 1,
        totalRecords: typeof raw.data.totalRecords === 'string' ? Number(raw.data.totalRecords) : raw.data.totalRecords,
        totalTradingVolume: typeof raw.data.totalTradingVolume === 'string' ? Number(raw.data.totalTradingVolume) : raw.data.totalTradingVolume,
        invitationLink: raw.data.invitationLink || '',
        referralCode: raw.data.referralCode || ''
      }
    };

    return normalized;
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
            '邀请服务不可用'
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
      '邀请统计查询失败，请稍后重试'
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
   * 生成邀请链接（预留功能）
   * @param userReferralCode 用户的推荐码
   * @returns 邀请链接
   */
  public generateInviteLink(userReferralCode: string): string {
    // 这里可以构建完整的邀请链接
    // 例如: https://t.me/YourBot?start=invite_ABC123
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || 'aiw3_bot';
    return `https://t.me/${botUsername}?start=invite_${userReferralCode}`;
  }

  /**
   * 健康检查 - 测试邀请服务连接状态
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 可以调用一个轻量级的邀请服务端点进行健康检查
      // 暂时使用基础API服务的健康检查
      return await apiService.healthCheck();
    } catch (error) {
      logger.warn('Invite service health check failed', { 
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
      name: 'InviteService',
      version: '1.0.0',
      supportedEndpoints: ['/api/reward/inviteRecord'],
      features: [
        'Invite statistics query',
        'Points calculation (trading volume / 100)',
        'Pagination support',
        'Invite link generation',
        'Comprehensive error handling'
      ]
    };
  }
}

// 导出单例实例
export const inviteService = new InviteService();

// 默认导出
export default inviteService;
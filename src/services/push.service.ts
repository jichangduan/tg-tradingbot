import { apiService } from './api.service';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { ApiError } from './api.service';

/**
 * 管理的群组信息接口
 */
export interface ManagedGroup {
  group_id: string;
  group_name: string;
  bound_at: string;
}

/**
 * 推送设置接口
 */
export interface PushSettings {
  flash_enabled: boolean;   // 快讯推送
  whale_enabled: boolean;   // 鲸鱼动向推送  
  fund_enabled: boolean;    // 资金流向推送
  managed_groups?: ManagedGroup[]; // 绑定的群组列表
}

/**
 * 推送数据接口
 */
export interface PushData {
  flash_news?: FlashNews[];
  whale_actions?: WhaleAction[];
  fund_flows?: FundFlow[];
}

/**
 * 快讯数据
 */
export interface FlashNews {
  title: string;
  content: string;
  timestamp: string;
  symbol?: string; // 相关代币符号（用于交易按钮）
}

/**
 * 鲸鱼动向数据
 */
export interface WhaleAction {
  address: string;
  action: string;
  amount: string;
  timestamp: string;
  symbol?: string; // 操作的代币符号（可选，用于交易按钮）
}

/**
 * 资金流向数据
 */
export interface FundFlow {
  from: string;
  to: string;
  amount: string;
  timestamp: string;
  symbol?: string; // 流向的代币符号（用于交易按钮）
}

/**
 * API响应接口
 */
export interface PushSettingsResponse {
  code: number;
  data: {
    user_settings: PushSettings & {
      user_id: number;
      updated_at?: string;
    };
    push_data?: PushData;
    cache_info?: {
      last_updated: string;
      update_count: number;
    };
  };
  message: string;
}

/**
 * 推送设置更新请求
 */
export interface PushSettingsUpdateRequest {
  flash_enabled?: boolean;
  whale_enabled?: boolean;
  fund_enabled?: boolean;
}

/**
 * 群组推送绑定请求
 */
export interface GroupPushBindRequest {
  group_action: 'bind' | 'unbind';
  group_id: string;
  group_name?: string;
}

/**
 * 推送服务类
 * 负责推送设置的管理和推送数据的获取
 */
export class PushService {
  private readonly cacheKeyPrefix = 'push_settings';
  private readonly cacheTTL = 300; // 5分钟缓存

  /**
   * 获取用户推送设置和数据
   */
  public async getUserPushSettings(userId: string, accessToken: string): Promise<PushSettingsResponse> {
    const startTime = Date.now();
    const cacheKey = `${this.cacheKeyPrefix}:${userId}`;

    try {
      // 尝试从缓存获取
      const cachedResult = await cacheService.get<PushSettingsResponse>(cacheKey);
      if (cachedResult.success && cachedResult.data) {
        return cachedResult.data;
      }

      // 调用后端API获取推送设置
      
      const response = await apiService.getWithAuth<PushSettingsResponse>(
        '/api/user/push-settings',
        accessToken,
        undefined,
        {
          timeout: 10000,
          retry: 2
        }
      );

      // API响应数据验证和详细日志

      // 验证响应格式
      if (!response.data?.user_settings) {
        throw new ApiError('Invalid API response format', 500, 'INVALID_RESPONSE');
      }

      // 详细记录 managed_groups 数据
      const managedGroups = response.data.user_settings.managed_groups;

      // 缓存结果
      await cacheService.set(cacheKey, response, this.cacheTTL);

      const duration = Date.now() - startTime;

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to get push settings', {
        userId: parseInt(userId || '0'),
        duration,
        error: (error as Error).message
      });

      // 如果是API错误，重新抛出
      if (error instanceof ApiError) {
        throw error;
      }

      // 其他错误转换为API错误
      throw new ApiError(
        '获取推送设置失败，请稍后重试',
        500,
        'FETCH_SETTINGS_ERROR',
        error
      );
    }
  }

  /**
   * 更新用户推送设置
   */
  public async updateUserPushSettings(
    userId: string,
    accessToken: string,
    settings: PushSettingsUpdateRequest
  ): Promise<PushSettingsResponse> {
    const startTime = Date.now();
    const cacheKey = `${this.cacheKeyPrefix}:${userId}`;

    try {
      // 参数验证
      this.validateUpdateRequest(settings);


      // 调用后端API更新设置
      const response = await apiService.postWithAuth<PushSettingsResponse>(
        '/api/user/push-settings',
        accessToken,
        settings,
        {
          timeout: 10000,
          retry: 1
        }
      );

      // 验证响应格式
      if (!response.data?.user_settings) {
        throw new ApiError('Invalid API response format', 500, 'INVALID_RESPONSE');
      }

      // 🔧 POST响应不包含push_data，不应该覆盖包含完整数据的GET缓存
      // 清除缓存，让下次GET请求获取最新的完整数据（包含push_data）
      await cacheService.delete(cacheKey);
      logger.info(`🧹 [POST_UPDATE] Cleared cache after settings update for user ${userId} to prevent data loss`);

      const duration = Date.now() - startTime;

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to update push settings', {
        userId: parseInt(userId || '0'),
        duration,
        settings,
        error: (error as Error).message
      });

      // 如果是API错误，重新抛出
      if (error instanceof ApiError) {
        throw error;
      }

      // 其他错误转换为API错误
      throw new ApiError(
        '更新推送设置失败，请稍后重试',
        500,
        'UPDATE_SETTINGS_ERROR',
        error
      );
    }
  }

  /**
   * 获取所有启用推送的用户列表（用于定时推送）
   * 注意：这个方法需要后端提供相应的API，目前是预留接口
   */
  public async getEnabledPushUsers(pushType?: 'flash' | 'whale' | 'fund'): Promise<Array<{
    userId: string;
    settings: PushSettings;
  }>> {
    try {
      // TODO: 实现获取启用推送的用户列表API
      // 目前返回空数组，待后端API实现
      return [];
      
    } catch (error) {
      logger.error('Failed to get enabled push users', {
        pushType,
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * 验证更新请求参数
   */
  private validateUpdateRequest(settings: PushSettingsUpdateRequest): void {
    const validKeys = ['flash_enabled', 'whale_enabled', 'fund_enabled'];
    const providedKeys = Object.keys(settings);

    // 检查是否至少提供了一个有效参数
    if (providedKeys.length === 0) {
      throw new ApiError('至少需要提供一个推送设置参数', 400, 'MISSING_PARAMETERS');
    }

    // 检查是否所有参数都是有效的
    const invalidKeys = providedKeys.filter(key => !validKeys.includes(key));
    if (invalidKeys.length > 0) {
      throw new ApiError(
        `无效的参数: ${invalidKeys.join(', ')}`,
        400,
        'INVALID_PARAMETERS'
      );
    }

    // 检查参数类型
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value !== 'boolean') {
        throw new ApiError(
          `参数 ${key} 必须是布尔值`,
          400,
          'INVALID_PARAMETER_TYPE'
        );
      }
    }
  }

  /**
   * 清除用户推送设置缓存
   */
  public async clearUserCache(userId: string): Promise<void> {
    const cacheKey = `${this.cacheKeyPrefix}:${userId}`;
    await cacheService.delete(cacheKey);
  }

  /**
   * 绑定群组推送
   */
  public async bindGroupPush(
    userId: string,
    accessToken: string,
    groupId: string,
    groupName?: string
  ): Promise<PushSettingsResponse> {
    const startTime = Date.now();

    try {

      const requestData: GroupPushBindRequest = {
        group_action: 'bind',
        group_id: groupId,
        group_name: groupName
      };

      // 调用后端API绑定群组
      const response = await apiService.postWithAuth<PushSettingsResponse>(
        '/api/user/push-settings',
        accessToken,
        requestData,
        {
          timeout: 10000,
          retry: 1
        }
      );

      // 验证响应格式
      if (!response.data?.user_settings) {
        throw new ApiError('Invalid API response format', 500, 'INVALID_RESPONSE');
      }

      const duration = Date.now() - startTime;

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to bind group push', {
        userId: parseInt(userId || '0'),
        groupId,
        groupName,
        duration,
        error: (error as Error).message
      });

      // 如果是API错误，重新抛出
      if (error instanceof ApiError) {
        throw error;
      }

      // 其他错误转换为API错误
      throw new ApiError(
        '绑定群组推送失败，请稍后重试',
        500,
        'BIND_GROUP_ERROR',
        error
      );
    }
  }

  /**
   * 解绑群组推送
   */
  public async unbindGroupPush(
    userId: string,
    accessToken: string,
    groupId: string
  ): Promise<PushSettingsResponse> {
    const startTime = Date.now();

    try {

      const requestData: GroupPushBindRequest = {
        group_action: 'unbind',
        group_id: groupId
      };

      // 调用后端API解绑群组
      const response = await apiService.postWithAuth<PushSettingsResponse>(
        '/api/user/push-settings',
        accessToken,
        requestData,
        {
          timeout: 10000,
          retry: 1
        }
      );

      // 验证响应格式
      if (!response.data?.user_settings) {
        throw new ApiError('Invalid API response format', 500, 'INVALID_RESPONSE');
      }

      const duration = Date.now() - startTime;

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to unbind group push', {
        userId: parseInt(userId || '0'),
        groupId,
        duration,
        error: (error as Error).message
      });

      // 如果是API错误，重新抛出
      if (error instanceof ApiError) {
        throw error;
      }

      // 其他错误转换为API错误
      throw new ApiError(
        '解绑群组推送失败，请稍后重试',
        500,
        'UNBIND_GROUP_ERROR',
        error
      );
    }
  }

  /**
   * 健康检查 - 测试推送API连接
   */
  public async healthCheck(accessToken: string): Promise<boolean> {
    try {
      // 使用一个测试用户ID进行健康检查
      await apiService.getWithAuth('/api/user/push-settings', accessToken, undefined, {
        timeout: 5000,
        skipLogging: true
      });
      return true;
    } catch (error) {
      logger.warn('Push service health check failed', {
        error: (error as Error).message
      });
      return false;
    }
  }
}

// 导出单例
export const pushService = new PushService();
export default pushService;
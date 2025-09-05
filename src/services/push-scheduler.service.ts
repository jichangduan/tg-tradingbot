import * as cron from 'node-cron';
import { PushSettings, PushData, pushService } from './push.service';
import { pushMessageFormatterService } from './push-message-formatter.service';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { telegramBot } from '../bot';
import { getUserToken, getUserAccessToken } from '../utils/auth';

/**
 * 推送调度服务
 * 负责定时获取和推送各种类型的推送内容
 */
export class PushSchedulerService {
  private isRunning = false;
  private scheduleTask?: cron.ScheduledTask;
  private readonly cachePrefix = 'push_scheduler';
  private readonly lastPushCacheKey = 'last_push_time';
  
  // 内存存储fallback - 跟踪启用推送的用户
  private enabledUsersMemoryStore = new Map<string, {
    settings: PushSettings;
    lastUpdated: number;
  }>();

  /**
   * 启动定时推送调度器
   * 测试环境：每1分钟执行一次
   * 生产环境：每20分钟执行一次
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('Push scheduler is already running');
      return;
    }

    try {
      // 修复cron表达式：生产环境20分钟，开发环境1分钟
      const cronPattern = process.env.NODE_ENV === 'production' ? '*/20 * * * *' : '*/1 * * * *';
      
      logger.info('Initializing push scheduler', { cronPattern, environment: process.env.NODE_ENV });

      this.scheduleTask = cron.schedule(cronPattern, async () => {
        await this.executeScheduledPush();
      }, {
        scheduled: false, // 不自动启动
        timezone: 'Asia/Shanghai'
      });

      // 启动任务
      this.scheduleTask.start();
      this.isRunning = true;

      logger.info('Push scheduler started successfully', { cronPattern });

      // 添加测试用户以便测试推送功能
      this.addTestUserToPushTracking();

      // 5秒后执行首次推送任务
      setTimeout(() => this.executeScheduledPush().catch(() => {}), 5000);

    } catch (error) {
      this.isRunning = false;
      logger.error('❌ Failed to start push scheduler', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw error;
    }
  }

  /**
   * 停止定时推送调度器
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('Push scheduler is not running');
      return;
    }

    if (this.scheduleTask) {
      this.scheduleTask.stop();
      this.scheduleTask = undefined;
    }

    this.isRunning = false;
    logger.info('Push scheduler stopped');
  }

  /**
   * 手动执行一次推送任务（用于测试）
   */
  public async executeManualPush(): Promise<void> {
    logger.info('Executing manual push task');
    await this.executeScheduledPush();
  }

  /**
   * 执行定时推送任务
   */
  private async executeScheduledPush(): Promise<void> {
    const startTime = Date.now();
    const executionId = `push_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    try {
      logger.info(`Starting push execution [${executionId}]`);

      const enabledUsers = await this.getEnabledPushUsers();
      
      if (enabledUsers.length === 0) {
        logger.warn(`No users with push enabled [${executionId}]`);
        return;
      }

      logger.info(`Found ${enabledUsers.length} users with push enabled`);

      let successCount = 0;
      let failureCount = 0;

      for (const user of enabledUsers) {
        try {
          await this.sendPushToUser(user.userId, user.settings, user.pushData);
          successCount++;
        } catch (error) {
          failureCount++;
          logger.error(`Failed to send push to user ${user.userId}`, {
            error: (error as Error).message
          });
        }
      }

      await this.updateLastPushTime();

      const duration = Date.now() - startTime;
      logger.info(`Push execution completed [${executionId}] - ${duration}ms`, {
        totalUsers: enabledUsers.length,
        successCount,
        failureCount
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`💥 ========== PUSH EXECUTION FAILED [${executionId}] ==========`);
      logger.error(`Scheduled push execution failed`, {
        executionId,
        duration,
        durationText: `${duration}ms`,
        error: (error as Error).message,
        stack: (error as Error).stack
      });
    }
  }

  /**
   * 获取启用推送的用户列表
   * 使用本地缓存跟踪启用推送的用户
   */
  private async getEnabledPushUsers(): Promise<Array<{
    userId: string;
    settings: PushSettings;
    pushData?: PushData;
  }>> {
    try {
      logger.info('Getting enabled push users from local cache tracking');
      
      const enabledUsers: Array<{
        userId: string;
        settings: PushSettings;
        pushData?: PushData;
      }> = [];
      
      // 从缓存中获取所有有推送设置的用户列表
      const userCacheKeys = await this.getUsersWithPushSettings();
      
      for (const userId of userCacheKeys) {
        try {
          // 获取用户的推送设置
          const userSettingsResult = await this.getCachedUserPushSettings(userId);
          
          if (userSettingsResult) {
            // 检查是否至少有一项推送功能启用
            const hasAnyEnabled = userSettingsResult.flash_enabled || 
                                userSettingsResult.whale_enabled || 
                                userSettingsResult.fund_enabled;
            
            if (hasAnyEnabled) {
              // 获取推送内容数据
              const pushDataResult = await this.getPushDataForUser(userId);
              
              enabledUsers.push({
                userId: userId,
                settings: userSettingsResult,
                pushData: pushDataResult
              });
              
              logger.debug('Added user for push notifications', {
                telegramId: userId,
                settings: userSettingsResult
              });
            }
          }
        } catch (userError) {
          logger.warn('Failed to process user for push', {
            telegramId: userId,
            error: (userError as Error).message
          });
          continue;
        }
      }

      logger.info('Enabled push users fetched successfully', {
        userCount: enabledUsers.length,
        userIds: enabledUsers.map(u => u.userId)
      });

      return enabledUsers;

    } catch (error) {
      logger.error('Failed to get enabled push users', {
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * 获取有推送设置的用户ID列表
   */
  private async getUsersWithPushSettings(): Promise<string[]> {
    try {
      // 首先尝试从Redis缓存获取
      const pushSettingsPattern = 'push_settings:*';
      logger.debug('Searching for push settings in Redis', { pattern: pushSettingsPattern });
      
      const cacheKeys = await cacheService.getKeys(pushSettingsPattern);
      
      if (cacheKeys.length > 0) {
        const userIds = cacheKeys
          .map(key => key.replace('push_settings:', ''))
          .filter(id => id && /^\d+$/.test(id));
        
        return userIds;
      }
      
      // 如果Redis没有数据，使用内存存储的fallback
      const memoryUserIds = Array.from(this.enabledUsersMemoryStore.keys());
      
      if (memoryUserIds.length > 0) {
        return memoryUserIds;
      }
      
      return [];
      
    } catch (error) {
      logger.warn('Failed to get users with push settings from cache', {
        error: (error as Error).message
      });
      
      return Array.from(this.enabledUsersMemoryStore.keys());
    }
  }

  /**
   * 从缓存获取用户的推送设置
   */
  private async getCachedUserPushSettings(userId: string): Promise<PushSettings | null> {
    try {
      // 首先尝试从Redis缓存获取
      const cacheKey = `push_settings:${userId}`;
      const cachedResult = await cacheService.get<{
        data: { user_settings: PushSettings };
      }>(cacheKey);
      
      if (cachedResult.success && cachedResult.data?.data?.user_settings) {
        // 同时更新内存存储
        this.enabledUsersMemoryStore.set(userId, {
          settings: cachedResult.data.data.user_settings,
          lastUpdated: Date.now()
        });
        
        return cachedResult.data.data.user_settings;
      }
      
      // 如果Redis没有，尝试从内存存储获取
      const memoryData = this.enabledUsersMemoryStore.get(userId);
      if (memoryData) {
        logger.debug('Using memory store fallback for user push settings', { telegramId: userId });
        return memoryData.settings;
      }
      
      return null;
      
    } catch (error) {
      logger.debug('Failed to get cached user push settings, trying memory store', {
        telegramId: userId,
        error: (error as Error).message
      });
      
      // 出错时使用内存存储
      const memoryData = this.enabledUsersMemoryStore.get(userId);
      if (memoryData) {
        logger.debug('Using memory store fallback after error', { telegramId: userId });
        return memoryData.settings;
      }
      
      return null;
    }
  }

  /**
   * 添加用户到推送跟踪（供外部调用）
   */
  public addUserToPushTracking(userId: string, settings: PushSettings): void {
    this.enabledUsersMemoryStore.set(userId, {
      settings,
      lastUpdated: Date.now()
    });
    
    logger.debug('User added to push tracking', { telegramId: userId, settings });
  }

  /**
   * 在推送调度器启动时初始化已知用户
   */
  public addTestUserToPushTracking(): void {
    // 添加已知的测试用户以便立即开始推送测试
    // 这样系统启动后就能立即开始推送，无需等待用户手动设置
    const knownUsers = [
      {
        userId: '1238737093', // 从日志中看到的活跃用户
        settings: {
          flash_enabled: true,
          whale_enabled: true,
          fund_enabled: true
        }
      }
    ];

    knownUsers.forEach(user => {
      this.addUserToPushTracking(user.userId, user.settings);
    });
    
    logger.info('Push scheduler initialized with known users', { 
      userCount: knownUsers.length,
      userIds: knownUsers.map(u => u.userId)
    });
  }

  /**
   * 从推送跟踪中移除用户
   */
  public removeUserFromPushTracking(userId: string): void {
    this.enabledUsersMemoryStore.delete(userId);
    logger.debug('User removed from push tracking', { telegramId: userId });
  }

  /**
   * 为用户获取推送数据
   * 从push.service.ts的getUserPushSettings中获取推送数据
   */
  private async getPushDataForUser(userId: string): Promise<PushData | undefined> {
    try {
      // 获取访问令牌
      let accessToken = await getUserToken(userId);
      
      if (!accessToken) {
        logger.debug('No cached token found, initializing user', { telegramId: userId });
        
        const userInfo = {
          username: undefined,
          first_name: undefined,
          last_name: undefined
        };
        
        accessToken = await getUserAccessToken(userId, userInfo);
      }

      // 获取用户推送设置，其中包含推送数据
      const response = await pushService.getUserPushSettings(userId, accessToken);
      
      return response.data.push_data;
      
    } catch (error) {
      logger.warn('Failed to get push data for user', {
        telegramId: userId,
        error: (error as Error).message
      });
      return undefined;
    }
  }

  /**
   * 向用户发送推送消息
   */
  private async sendPushToUser(
    userId: string,
    settings: PushSettings,
    pushData?: PushData
  ): Promise<void> {
    try {
      const bot = telegramBot.getBot();
      if (!bot) {
        throw new Error('Telegram Bot instance is not available');
      }

      // 检查是否有新的推送内容
      if (!pushData || !this.hasNewPushContent(pushData)) {
        logger.debug('No new push content for user', { userId: parseInt(userId || '0') });
        return;
      }

      // 使用消息格式化服务处理消息
      const messages = pushMessageFormatterService.formatBatchMessages(
        settings.flash_enabled ? pushData.flash_news || [] : [],
        settings.whale_enabled ? pushData.whale_actions || [] : [],
        settings.fund_enabled ? pushData.fund_flows || [] : []
      );

      if (messages.length === 0) {
        logger.debug('No messages to send', { userId: parseInt(userId || '0') });
        return;
      }

      logger.info(`Sending ${messages.length} messages to user ${userId}`);

      // 发送所有消息
      for (const message of messages) {
        const sendOptions: any = {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        };

        if (message.keyboard) {
          sendOptions.reply_markup = { inline_keyboard: message.keyboard };
        }

        await bot.telegram.sendMessage(parseInt(userId), message.content, sendOptions);
        await new Promise(resolve => setTimeout(resolve, 150)); // API限制延迟
      }

      logger.info(`All push messages sent successfully to user ${userId}`);

    } catch (error) {
      logger.error(`Failed to send push messages to user ${userId}`, {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * 检查是否有新的推送内容
   */
  private hasNewPushContent(pushData: PushData | undefined): boolean {
    if (!pushData) return false;
    
    // 检查是否有任何推送内容
    const hasFlashNews = pushData.flash_news && pushData.flash_news.length > 0;
    const hasWhaleActions = pushData.whale_actions && pushData.whale_actions.length > 0;
    const hasFundFlows = pushData.fund_flows && pushData.fund_flows.length > 0;
    
    return !!(hasFlashNews || hasWhaleActions || hasFundFlows);
  }

  /**
   * 更新最后推送时间
   */
  private async updateLastPushTime(): Promise<void> {
    try {
      const cacheKey = `${this.cachePrefix}:${this.lastPushCacheKey}`;
      await cacheService.set(cacheKey, new Date().toISOString(), 24 * 60 * 60);
      logger.debug('Updated last push time');
    } catch (error) {
      logger.warn('Failed to update last push time', { error: (error as Error).message });
    }
  }


  /**
   * 获取调度器状态
   */
  public getStatus(): {
    isRunning: boolean;
    cronPattern: string;
    environment: string;
  } {
    const cronPattern = process.env.NODE_ENV === 'production' ? '*/20 * * * *' : '*/1 * * * *';
    
    return {
      isRunning: this.isRunning,
      cronPattern,
      environment: process.env.NODE_ENV || 'development'
    };
  }
}

// 导出单例
export const pushScheduler = new PushSchedulerService();
export default pushScheduler;
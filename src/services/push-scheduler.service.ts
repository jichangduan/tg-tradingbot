import * as cron from 'node-cron';
import { PushSettings, PushData, pushService } from './push.service';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { telegramBot } from '../bot';
import { apiService } from './api.service';

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
      
      logger.info('🔧 Initializing push scheduler', {
        cronPattern,
        environment: process.env.NODE_ENV || 'development',
        timezone: 'Asia/Shanghai',
        description: process.env.NODE_ENV === 'production' ? 'Every 20 minutes' : 'Every 1 minute'
      });

      this.scheduleTask = cron.schedule(cronPattern, async () => {
        await this.executeScheduledPush();
      }, {
        scheduled: false, // 不自动启动
        timezone: 'Asia/Shanghai'
      });

      // 启动任务
      this.scheduleTask.start();
      this.isRunning = true;

      logger.info('✅ Push scheduler started successfully', {
        isRunning: this.isRunning,
        cronPattern,
        nextExecutionEstimate: 'Within 1-20 minutes depending on environment'
      });

      // 立即执行一次推送任务用于测试
      logger.info('🚀 Executing initial push task for immediate testing...');
      setTimeout(() => {
        this.executeScheduledPush().catch(error => {
          logger.error('Initial push task failed', { error: error.message });
        });
      }, 5000); // 5秒后执行第一次推送

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
      logger.info(`🚀 ========== PUSH EXECUTION START [${executionId}] ==========`);
      logger.info(`Starting scheduled push execution`, {
        executionId,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
      });

      // 获取所有启用推送的用户
      logger.info(`📋 Step 1: Getting enabled push users [${executionId}]`);
      const enabledUsers = await this.getEnabledPushUsers();
      
      if (enabledUsers.length === 0) {
        logger.warn(`⚠️ No users with push enabled [${executionId}]`, { 
          executionId,
          suggestion: 'Add test users or check user settings in database'
        });
        return;
      }

      logger.info(`✅ Step 1 completed: Found ${enabledUsers.length} users with push enabled`, {
        userCount: enabledUsers.length,
        executionId,
        userIds: enabledUsers.map(u => parseInt(u.userId || '0'))
      });

      // 为每个用户推送消息
      logger.info(`📤 Step 2: Sending push messages to users [${executionId}]`);
      let successCount = 0;
      let failureCount = 0;

      for (const user of enabledUsers) {
        try {
          logger.info(`📱 Sending push to user ${user.userId}`, {
            userId: parseInt(user.userId || '0'),
            settings: user.settings,
            executionId
          });

          await this.sendPushToUser(user.userId, user.settings, user.pushData);
          successCount++;
          
          logger.info(`✅ Push sent successfully to user ${user.userId}`, {
            userId: parseInt(user.userId || '0'),
            executionId
          });

        } catch (error) {
          failureCount++;
          logger.error(`❌ Failed to send push to user ${user.userId}`, {
            userId: parseInt(user.userId || '0'),
            error: (error as Error).message,
            stack: (error as Error).stack,
            executionId
          });
        }
      }

      // 更新最后推送时间
      logger.info(`📝 Step 3: Updating last push time [${executionId}]`);
      await this.updateLastPushTime();

      const duration = Date.now() - startTime;
      logger.info(`🎉 ========== PUSH EXECUTION COMPLETED [${executionId}] ==========`);
      logger.info(`Scheduled push execution completed successfully`, {
        executionId,
        duration,
        durationText: `${duration}ms`,
        totalUsers: enabledUsers.length,
        successCount,
        failureCount,
        successRate: enabledUsers.length > 0 ? Math.round((successCount / enabledUsers.length) * 100) + '%' : '0%'
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
      
      logger.debug('Redis cache keys found', {
        patternUsed: pushSettingsPattern,
        totalKeys: cacheKeys.length,
        keys: cacheKeys.slice(0, 10) // 显示前10个keys用于调试
      });
      
      if (cacheKeys.length > 0) {
        // 从key中提取用户ID
        const userIds = cacheKeys
          .map(key => key.replace('push_settings:', ''))
          .filter(id => id && /^\d+$/.test(id));
        
        logger.debug('Found users with push settings in Redis cache', {
          userCount: userIds.length,
          userIds: userIds.slice(0, 5),
          allKeys: cacheKeys
        });
        
        return userIds;
      }
      
      // 如果Redis没有数据，使用内存存储的fallback
      const memoryUserIds = Array.from(this.enabledUsersMemoryStore.keys());
      
      if (memoryUserIds.length > 0) {
        logger.debug('Using memory store fallback for push users', {
          userCount: memoryUserIds.length,
          userIds: memoryUserIds.slice(0, 5),
          reason: 'No Redis cache keys found'
        });
        
        return memoryUserIds;
      }
      
      logger.info('No push users found in cache or memory store');
      return [];
      
    } catch (error) {
      logger.warn('Failed to get users with push settings from cache, trying memory store', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      
      // 出错时使用内存存储
      const memoryUserIds = Array.from(this.enabledUsersMemoryStore.keys());
      
      logger.debug('Using memory store fallback after error', {
        userCount: memoryUserIds.length,
        error: (error as Error).message
      });
      
      return memoryUserIds;
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
   * 从推送跟踪中移除用户
   */
  public removeUserFromPushTracking(userId: string): void {
    this.enabledUsersMemoryStore.delete(userId);
    logger.debug('User removed from push tracking', { telegramId: userId });
  }

  /**
   * 为用户获取推送数据
   * 从各种数据源获取快讯、鲸鱼动向、资金流向等信息
   */
  private async getPushDataForUser(userId: string): Promise<PushData | undefined> {
    try {
      logger.debug('Fetching push data for user', { telegramId: userId });
      
      // 调用后端API获取推送内容
      const response = await apiService.get<{
        code: string;
        message: string;
        data: {
          flash_news: Array<{
            title: string;
            content: string;
            timestamp: string;
          }>;
          whale_actions: Array<{
            address: string;
            action: string;
            amount: string;
            timestamp: string;
          }>;
          fund_flows: Array<{
            from: string;
            to: string;
            amount: string;
            timestamp: string;
          }>;
        };
      }>('/api/tgbot/push/content');
      
      if (response.code === '0' && response.data) {
        logger.debug('Successfully fetched push data', {
          telegramId: userId,
          flashNewsCount: response.data.flash_news?.length || 0,
          whaleActionsCount: response.data.whale_actions?.length || 0,
          fundFlowsCount: response.data.fund_flows?.length || 0
        });
        
        return {
          flash_news: response.data.flash_news || [],
          whale_actions: response.data.whale_actions || [],
          fund_flows: response.data.fund_flows || []
        };
      }
      
      logger.debug('No push data available from API', { telegramId: userId });
      return undefined;
      
    } catch (error) {
      logger.warn('Failed to fetch push data for user', {
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
      logger.debug(`🔧 Initializing message sending for user ${userId}`, {
        userId: parseInt(userId || '0'),
        settings,
        hasData: !!pushData
      });

      const bot = telegramBot.getBot();
      
      // 检查Bot实例是否可用
      if (!bot) {
        throw new Error('Telegram Bot instance is not available');
      }

      // 检查是否有新的推送内容
      if (!pushData || !this.hasNewPushContent(pushData)) {
        logger.debug('📭 No new push content for user', { 
          userId: parseInt(userId || '0'),
          hasData: !!pushData,
          dataDetails: pushData ? {
            flashCount: pushData.flash_news?.length || 0,
            whaleCount: pushData.whale_actions?.length || 0,
            fundCount: pushData.fund_flows?.length || 0
          } : 'no data'
        });
        return;
      }

      let messages: string[] = [];
      const messageTypes: string[] = [];

      // 处理快讯推送
      if (settings.flash_enabled && pushData.flash_news && pushData.flash_news.length > 0) {
        for (const news of pushData.flash_news) {
          messages.push(this.formatFlashNewsMessage(news));
          messageTypes.push('flash_news');
        }
        logger.debug(`📰 Added ${pushData.flash_news.length} flash news messages`);
      }

      // 处理鲸鱼动向推送
      if (settings.whale_enabled && pushData.whale_actions && pushData.whale_actions.length > 0) {
        for (const action of pushData.whale_actions) {
          messages.push(this.formatWhaleActionMessage(action));
          messageTypes.push('whale_action');
        }
        logger.debug(`🐋 Added ${pushData.whale_actions.length} whale action messages`);
      }

      // 处理资金流向推送
      if (settings.fund_enabled && pushData.fund_flows && pushData.fund_flows.length > 0) {
        for (const flow of pushData.fund_flows) {
          messages.push(this.formatFundFlowMessage(flow));
          messageTypes.push('fund_flow');
        }
        logger.debug(`💰 Added ${pushData.fund_flows.length} fund flow messages`);
      }

      if (messages.length === 0) {
        logger.debug(`📭 No messages to send (settings disabled or no content)`, {
          userId: parseInt(userId || '0'),
          settings
        });
        return;
      }

      logger.info(`📤 Sending ${messages.length} messages to user ${userId}`, {
        userId: parseInt(userId || '0'),
        messageCount: messages.length,
        messageTypes
      });

      // 发送消息
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const messageType = messageTypes[i];
        
        try {
          logger.debug(`📱 Sending message ${i + 1}/${messages.length} (${messageType})`, {
            userId: parseInt(userId || '0'),
            messageType,
            messageLength: message.length
          });

          await bot.telegram.sendMessage(parseInt(userId), message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          } as any);

          logger.debug(`✅ Message ${i + 1}/${messages.length} sent successfully`, {
            userId: parseInt(userId || '0'),
            messageType
          });

          // 添加短暂延迟避免触发Telegram API限制
          await new Promise(resolve => setTimeout(resolve, 150));
          
        } catch (messageError) {
          logger.error(`❌ Failed to send message ${i + 1}/${messages.length}`, {
            userId: parseInt(userId || '0'),
            messageType,
            error: (messageError as Error).message
          });
          throw messageError;
        }
      }

      logger.info(`🎉 All push messages sent successfully to user ${userId}`, {
        userId: parseInt(userId || '0'),
        totalMessages: messages.length,
        messageTypes: messageTypes.join(', ')
      });

    } catch (error) {
      logger.error(`💥 Failed to send push messages to user ${userId}`, {
        userId: parseInt(userId || '0'),
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw error;
    }
  }

  /**
   * 检查是否有新的推送内容
   */
  private hasNewPushContent(pushData: PushData | undefined): boolean {
    if (!pushData) return false;
    
    // 简化的检查逻辑：只要有任何数据就认为是新的
    // 实际实现中应该检查时间戳或ID来判断是否为新内容
    const hasFlashNews = pushData.flash_news && pushData.flash_news.length > 0;
    const hasWhaleActions = pushData.whale_actions && pushData.whale_actions.length > 0;
    const hasFundFlows = pushData.fund_flows && pushData.fund_flows.length > 0;
    
    return !!(hasFlashNews || hasWhaleActions || hasFundFlows);
  }

  /**
   * 格式化快讯推送消息
   */
  private formatFlashNewsMessage(news: any): string {
    return `🚨 <b>【快讯】</b>\n\n` +
           `📰 ${news.title}\n` +
           `${news.content ? news.content + '\n' : ''}` +
           `⏰ ${this.formatTimestamp(news.timestamp)}`;
  }

  /**
   * 格式化鲸鱼动向推送消息
   */
  private formatWhaleActionMessage(action: any): string {
    return `🐋 <b>【鲸鱼动向】</b>\n\n` +
           `地址: <code>${action.address}</code>\n` +
           `操作: ${action.action}\n` +
           `金额: ${action.amount}\n` +
           `⏰ ${this.formatTimestamp(action.timestamp)}`;
  }

  /**
   * 格式化资金流向推送消息
   */
  private formatFundFlowMessage(flow: any): string {
    return `💰 <b>【资金流向】</b>\n\n` +
           `从: ${flow.from}\n` +
           `到: ${flow.to}\n` +
           `金额: ${flow.amount}\n` +
           `⏰ ${this.formatTimestamp(flow.timestamp)}`;
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return timestamp;
    }
  }

  /**
   * 更新最后推送时间
   */
  private async updateLastPushTime(): Promise<void> {
    try {
      const cacheKey = `${this.cachePrefix}:${this.lastPushCacheKey}`;
      const currentTime = new Date().toISOString();
      
      await cacheService.set(cacheKey, currentTime, 24 * 60 * 60); // 24小时缓存
      
      logger.debug('Updated last push time', { timestamp: currentTime });
    } catch (error) {
      logger.warn('Failed to update last push time', {
        error: (error as Error).message
      });
    }
  }

  /**
   * 获取最后推送时间
   */
  public async getLastPushTime(): Promise<string | null> {
    try {
      const cacheKey = `${this.cachePrefix}:${this.lastPushCacheKey}`;
      const result = await cacheService.get<string>(cacheKey);
      
      if (result.success && result.data) {
        return result.data;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get last push time', {
        error: (error as Error).message
      });
      return null;
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
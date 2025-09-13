import * as cron from 'node-cron';
import { PushSettings, PushData } from './push.service';
import { pushMessageFormatterService } from './push-message-formatter.service';
import { pushDataService } from './push-data.service';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { PushLogger } from '../utils/push-logger';
import { pushDeduplicator } from '../utils/push-deduplicator';
import { telegramBot } from '../bot';

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
  
  // 群组推送相关 - 缓存机器人加入的群组
  private botGroupsCache: Set<string> = new Set();
  private groupCacheLastUpdate = 0;
  private readonly groupCacheTTL = 5 * 60 * 1000; // 5分钟缓存

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
            // 删除发送前的详细日志
          
          await this.sendPushToUser(user.userId, user.settings, user.pushData);
          successCount++;
          
          // 删除发送完成的详细日志
        } catch (error) {
          failureCount++;
          logger.error(`❌ [SCHEDULER] Failed to send push to user ${user.userId}`, {
            error: (error as Error).message,
            stack: (error as Error).stack
          });
        }
      }

      // 执行群组推送
      await this.executeGroupPush(executionId);
      
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
      // 删除获取用户的开始日志
      
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
              // 删除详细的调用前日志
              
              try {
                // 获取推送内容数据
                const pushDataResult = await pushDataService.getPushDataForUser(userId);
                
                // 删除详细的调用完成日志
                
                enabledUsers.push({
                  userId: userId,
                  settings: userSettingsResult,
                  pushData: pushDataResult
                });
                
                // 删除用户添加的debug日志
              } catch (pushDataError) {
                logger.error(`❌ [SCHEDULER] Error calling pushDataService.getPushDataForUser for user ${userId}`, {
                  error: (pushDataError as Error).message,
                  stack: (pushDataError as Error).stack
                });
                
                // 仍然添加用户，但没有推送数据
                enabledUsers.push({
                  userId: userId,
                  settings: userSettingsResult,
                  pushData: undefined
                });
              }
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
      // 删除Redis搜索日志
      
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
        // 删除内存存储fallback日志
        return memoryData.settings;
      }
      
      return null;
      
    } catch (error) {
      // 删除获取缓存设置失败的debug日志
      
      // 出错时使用内存存储
      const memoryData = this.enabledUsersMemoryStore.get(userId);
      if (memoryData) {
        // 删除错误后使用内存存储的debug日志
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
    
    // 删除用户添加到跟踪的debug日志
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
    // 删除用户移除跟踪的debug日志
  }


  /**
   * 向用户发送推送消息
   */
  private async sendPushToUser(
    userId: string,
    settings: PushSettings,
    pushData?: PushData
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      PushLogger.logMessageSendStart(userId, settings, !!pushData);
      
      const bot = telegramBot.getBot();
      if (!bot) {
        PushLogger.logTelegramBotStatus(userId, false);
        throw new Error('Telegram Bot instance is not available');
      } else {
        PushLogger.logTelegramBotStatus(userId, true);
      }

      // 检查是否有新的推送内容
      PushLogger.logPushContentCheck(userId, !!pushData, pushData ? Object.keys(pushData) : []);
      
      if (!pushData || !pushDataService.hasNewPushContent(pushData)) {
        logger.warn(`⚠️ [MESSAGE_SEND] No new push content for user ${userId} - stopping send process`, {
          hasPushData: !!pushData,
          contentCheckPassed: pushData ? pushDataService.hasNewPushContent(pushData) : false
        });
        return;
      }

      // 删除内容验证通过日志

      // 根据用户设置筛选推送内容
      const { flashNews, whaleActions, fundFlows } = pushDataService.filterPushContent(pushData, settings);
      
      PushLogger.logContentFiltering(userId, flashNews.length, whaleActions.length, fundFlows.length, settings);
      
      // 应用去重逻辑，过滤掉已推送过的内容
      const [dedupFlashNews, dedupWhaleActions, dedupFundFlows] = await Promise.all([
        pushDeduplicator.filterDuplicates(userId, flashNews, 'flash_news'),
        pushDeduplicator.filterDuplicates(userId, whaleActions, 'whale_actions'),
        pushDeduplicator.filterDuplicates(userId, fundFlows, 'fund_flows')
      ]);
      
      logger.info(`🚫 [DEDUP] Deduplication results for user ${userId}`, {
        flashNews: { original: flashNews.length, filtered: dedupFlashNews.length },
        whaleActions: { original: whaleActions.length, filtered: dedupWhaleActions.length },
        fundFlows: { original: fundFlows.length, filtered: dedupFundFlows.length }
      });

      // 使用消息格式化服务处理消息（使用去重后的数据）
      const messages = pushMessageFormatterService.formatBatchMessages(dedupFlashNews, dedupWhaleActions, dedupFundFlows);

      PushLogger.logMessageFormatting(userId, messages);

      if (messages.length === 0) {
        logger.warn(`⚠️ [MESSAGE_SEND] No messages generated after formatting for user ${userId}`);
        return;
      }

      // 删除消息发送开始的详细日志

      // 发送所有消息
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        // 删除每条消息发送的详细日志
        
        const sendOptions: any = {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        };

        if (message.keyboard) {
          sendOptions.reply_markup = { inline_keyboard: message.keyboard };
        }

        try {
          const telegramResult = await bot.telegram.sendMessage(parseInt(userId), message.content, sendOptions);
          // 删除每条消息发送成功的详细日志
        } catch (sendError) {
          logger.error(`❌ [MESSAGE_SEND] Failed to send message ${i + 1} to user ${userId}`, {
            error: (sendError as Error).message,
            messageContent: message.content?.substring(0, 200)
          });
          throw sendError;
        }
        
        // API限制延迟
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      // 标记所有内容为已推送
      await Promise.all([
        pushDeduplicator.markBatchAsPushed(userId, dedupFlashNews, 'flash_news'),
        pushDeduplicator.markBatchAsPushed(userId, dedupWhaleActions, 'whale_actions'),
        pushDeduplicator.markBatchAsPushed(userId, dedupFundFlows, 'fund_flows')
      ]);
      
      // 删除去重标记的详细日志

      const duration = Date.now() - startTime;
      const totalContentLength = messages.reduce((total, msg) => total + (msg.content?.length || 0), 0);
      PushLogger.logMessageSendComplete(userId, messages.length, duration, totalContentLength);

    } catch (error) {
      const duration = Date.now() - startTime;
      PushLogger.logMessageSendError(userId, duration, error as Error, settings, !!pushData);
      throw error;
    }
  }


  /**
   * 更新最后推送时间
   */
  private async updateLastPushTime(): Promise<void> {
    try {
      const cacheKey = `${this.cachePrefix}:${this.lastPushCacheKey}`;
      const result = await cacheService.set(cacheKey, new Date().toISOString(), 24 * 60 * 60);
      
      if (!result.success) {
        const errorMessage = result.error || 'Unknown cache error';
        // Redis配置问题不影响推送核心功能
        if (errorMessage.includes('Redis config issue')) {
          logger.debug('🔧 Redis config prevents caching push time, but push system continues normally');
        } else {
          logger.warn('Failed to cache push time - push tracking may be affected', { error: errorMessage });
        }
      }
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

  // ==================== 群组推送功能 ====================

  /**
   * 执行群组推送任务
   */
  private async executeGroupPush(executionId: string): Promise<void> {
    try {
      logger.info(`[${executionId}] Starting group push execution`);
      
      const botGroups = await this.getBotGroups();
      
      if (botGroups.length === 0) {
        logger.info(`[${executionId}] No groups found for bot`);
        return;
      }
      
      logger.info(`[${executionId}] Found ${botGroups.length} groups to process`);
      
      let groupSuccessCount = 0;
      let groupFailureCount = 0;
      
      for (const groupId of botGroups) {
        try {
          // 获取群主ID
          const ownerId = await this.getGroupOwner(groupId);
          if (!ownerId) {
            logger.warn(`[${executionId}] No owner found for group ${groupId}`);
            continue;
          }
          
          // 获取群主的推送设置
          const ownerSettings = await this.getCachedUserPushSettings(ownerId);
          if (!ownerSettings) {
            logger.debug(`[${executionId}] No push settings for group ${groupId} owner ${ownerId}`);
            continue;
          }
          
          // 检查群主是否启用了任何推送
          const hasAnyEnabled = ownerSettings.flash_enabled || 
                              ownerSettings.whale_enabled || 
                              ownerSettings.fund_enabled;
          
          if (!hasAnyEnabled) {
            logger.debug(`[${executionId}] Group ${groupId} owner has all push disabled`);
            continue;
          }
          
          // 获取推送数据
          const pushData = await pushDataService.getPushDataForUser(ownerId);
          
          // 发送群组推送
          await this.sendPushToGroup(groupId, ownerSettings, pushData, executionId);
          groupSuccessCount++;
          
        } catch (error) {
          groupFailureCount++;
          logger.error(`[${executionId}] Failed to process group ${groupId}`, {
            error: (error as Error).message
          });
        }
      }
      
      logger.info(`[${executionId}] Group push execution completed`, {
        totalGroups: botGroups.length,
        successCount: groupSuccessCount,
        failureCount: groupFailureCount
      });
      
    } catch (error) {
      logger.error(`[${executionId}] Group push execution failed`, {
        error: (error as Error).message
      });
    }
  }

  /**
   * 获取机器人加入的群组列表
   */
  private async getBotGroups(): Promise<string[]> {
    try {
      // 检查缓存是否有效
      const now = Date.now();
      if (now - this.groupCacheLastUpdate < this.groupCacheTTL && this.botGroupsCache.size > 0) {
        return Array.from(this.botGroupsCache);
      }
      
      // 注意：Telegram Bot API没有直接获取所有群组的方法
      // 这里我们需要通过其他方式维护群组列表
      // 方案1：通过缓存记录bot被添加到的群组
      // 方案2：在bot启动时通过getUpdates获取最近的群组消息
      
      // 临时方案：从Redis缓存中获取已知的群组ID
      const groupKeys = await cacheService.getKeys('bot_group:*');
      const groups = groupKeys.map(key => key.replace('bot_group:', ''));
      
      // 更新缓存
      this.botGroupsCache.clear();
      groups.forEach(groupId => this.botGroupsCache.add(groupId));
      this.groupCacheLastUpdate = now;
      
      logger.debug('Retrieved bot groups from cache', { groupCount: groups.length });
      return groups;
      
    } catch (error) {
      logger.error('Failed to get bot groups', {
        error: (error as Error).message
      });
      return Array.from(this.botGroupsCache); // 返回缓存的数据
    }
  }

  /**
   * 获取群组的群主ID
   */
  private async getGroupOwner(groupId: string): Promise<string | null> {
    try {
      const bot = telegramBot.getBot();
      if (!bot) {
        logger.error('Telegram Bot instance not available for getting group owner');
        return null;
      }
      
      // 调用Telegram API获取群组管理员
      const administrators = await bot.telegram.getChatAdministrators(parseInt(groupId));
      
      // 找到群主（creator）
      const creator = administrators.find(admin => admin.status === 'creator');
      
      if (creator && creator.user) {
        return creator.user.id.toString();
      }
      
      logger.warn(`No creator found for group ${groupId}`);
      return null;
      
    } catch (error) {
      logger.error(`Failed to get group owner for ${groupId}`, {
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * 向群组发送推送消息
   */
  private async sendPushToGroup(
    groupId: string,
    settings: PushSettings,
    pushData: PushData | undefined,
    executionId: string
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.debug(`[${executionId}] Starting group push to ${groupId}`);
      
      const bot = telegramBot.getBot();
      if (!bot) {
        throw new Error('Telegram Bot instance is not available');
      }
      
      // 检查是否有新的推送内容
      if (!pushData || !pushDataService.hasNewPushContent(pushData)) {
        logger.debug(`[${executionId}] No new push content for group ${groupId}`);
        return;
      }
      
      // 根据群主设置筛选推送内容
      const { flashNews, whaleActions, fundFlows } = pushDataService.filterPushContent(pushData, settings);
      
      // 应用去重逻辑（使用群组ID作为去重key）
      const [dedupFlashNews, dedupWhaleActions, dedupFundFlows] = await Promise.all([
        pushDeduplicator.filterDuplicates(`group_${groupId}`, flashNews, 'flash_news'),
        pushDeduplicator.filterDuplicates(`group_${groupId}`, whaleActions, 'whale_actions'),
        pushDeduplicator.filterDuplicates(`group_${groupId}`, fundFlows, 'fund_flows')
      ]);
      
      // 格式化消息
      const messages = pushMessageFormatterService.formatBatchMessages(dedupFlashNews, dedupWhaleActions, dedupFundFlows);
      
      if (messages.length === 0) {
        logger.debug(`[${executionId}] No messages to send to group ${groupId}`);
        return;
      }
      
      // 发送所有消息到群组
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        
        const sendOptions: any = {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        };
        
        if (message.keyboard) {
          sendOptions.reply_markup = { inline_keyboard: message.keyboard };
        }
        
        try {
          await bot.telegram.sendMessage(parseInt(groupId), message.content, sendOptions);
          logger.debug(`[${executionId}] Sent message ${i + 1}/${messages.length} to group ${groupId}`);
        } catch (sendError) {
          logger.error(`[${executionId}] Failed to send message to group ${groupId}`, {
            error: (sendError as Error).message,
            messageIndex: i + 1
          });
          throw sendError;
        }
        
        // API限制延迟
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // 标记内容为已推送
      await Promise.all([
        pushDeduplicator.markBatchAsPushed(`group_${groupId}`, dedupFlashNews, 'flash_news'),
        pushDeduplicator.markBatchAsPushed(`group_${groupId}`, dedupWhaleActions, 'whale_actions'),
        pushDeduplicator.markBatchAsPushed(`group_${groupId}`, dedupFundFlows, 'fund_flows')
      ]);
      
      const duration = Date.now() - startTime;
      logger.info(`[${executionId}] Group push completed for ${groupId}`, {
        messageCount: messages.length,
        duration: duration,
        durationText: `${duration}ms`
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[${executionId}] Group push failed for ${groupId}`, {
        duration: duration,
        durationText: `${duration}ms`,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * 添加群组到机器人群组列表（供外部调用）
   */
  public addBotGroup(groupId: string): void {
    this.botGroupsCache.add(groupId);
    
    // 同时保存到Redis缓存
    cacheService.set(`bot_group:${groupId}`, { added_at: new Date().toISOString() }, 24 * 60 * 60)
      .catch(error => {
        logger.warn('Failed to cache bot group', {
          groupId,
          error: (error as Error).message
        });
      });
    
    logger.debug('Added bot group to tracking', { groupId });
  }

  /**
   * 从机器人群组列表移除群组（供外部调用）
   */
  public removeBotGroup(groupId: string): void {
    this.botGroupsCache.delete(groupId);
    
    // 同时从Redis移除
    cacheService.delete(`bot_group:${groupId}`)
      .catch(error => {
        logger.warn('Failed to remove bot group from cache', {
          groupId,
          error: (error as Error).message
        });
      });
    
    logger.debug('Removed bot group from tracking', { groupId });
  }
}

// 导出单例
export const pushScheduler = new PushSchedulerService();
export default pushScheduler;
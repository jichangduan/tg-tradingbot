import * as cron from 'node-cron';
import { PushSettings, PushData, pushService } from './push.service';
import { pushMessageFormatterService } from './push-message-formatter.service';
import { pushDataService } from './push-data.service';
import { logger } from '../utils/logger';
import { PushLogger } from '../utils/push-logger';
import { pushDeduplicator } from '../utils/push-deduplicator';
import { telegramBot } from '../bot';
import { getUserAccessToken } from '../utils/auth';
import { PUSH_CONSTANTS } from '../types/push.types';

/**
 * 推送调度服务
 * 负责定时获取和推送各种类型的推送内容
 */
export class PushSchedulerService {
  private isRunning = false;
  private scheduleTask?: cron.ScheduledTask;
  
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
   * 开发环境：每1分钟执行一次
   * 测试环境：每2分钟执行一次
   * 生产环境：每20分钟执行一次
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('Push scheduler is already running');
      return;
    }

    try {
      const environment = process.env.NODE_ENV || 'development';
      
      // 简化环境配置：测试环境统一每分钟执行
      let cronPattern: string;
      if (environment === 'production') {
        cronPattern = PUSH_CONSTANTS.CRON.PRODUCTION; // 每20分钟
      } else {
        // 测试环境（test/testing/development）统一每分钟执行
        cronPattern = PUSH_CONSTANTS.CRON.TEST; // 每1分钟
      }
      
      logger.info('📅 [PUSH_SCHEDULER] Push scheduler configuration', {
        environment,
        cronPattern,
        intervalDescription: this.getCronDescription(cronPattern),
        timezone: 'Asia/Shanghai'
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

      logger.info('✅ [PUSH_SCHEDULER] Push scheduler started successfully', {
        isRunning: this.isRunning,
        cronPattern,
        environment,
        intervalDescription: this.getCronDescription(cronPattern),
        timezone: 'Asia/Shanghai'
      });

      // 添加测试用户以便测试推送功能
      this.addTestUserToPushTracking();

      // 启动后立即执行首次推送 - 解决用户开启推送后等待时间过长的问题
      setTimeout(() => {
        logger.info('🚀 [IMMEDIATE_PUSH] Executing immediate push after startup');
        this.executeScheduledPush().catch((error) => {
          logger.error('❌ [IMMEDIATE_PUSH] Initial push failed', {
            error: (error as Error).message
          });
        });
      }, 1000); // 1秒后立即推送

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
  }

  /**
   * 手动执行一次推送任务（用于测试）
   */
  public async executeManualPush(): Promise<void> {
    await this.executeScheduledPush();
  }

  /**
   * 用户设置推送后立即触发推送检查
   * 用于改善用户体验，设置推送后立即看到效果
   */
  public async triggerImmediatePush(userId?: string): Promise<void> {
    try {
      logger.info('🎯 [USER_TRIGGER] User triggered immediate push', {
        userId: userId ? parseInt(userId) || undefined : undefined,
        userIdString: userId || 'all_users',
        timestamp: new Date().toISOString()
      });
      
      await this.executeScheduledPush();
      
      logger.info('✅ [USER_TRIGGER] Immediate push completed successfully');
    } catch (error) {
      logger.error('❌ [USER_TRIGGER] Immediate push failed', {
        userId: userId ? parseInt(userId) || undefined : undefined,
        userIdString: userId || 'all_users',
        error: (error as Error).message
      });
      throw error;
    }
  }

  // 记录上次推送时间，用于计算实际间隔
  private lastPushTime: number = 0;

  /**
   * 执行定时推送任务
   */
  private async executeScheduledPush(): Promise<void> {
    const startTime = Date.now();
    const executionId = `push_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // ✅ 间隔保护已移除 - 测试环境每分钟执行推送

    // 🕐 简化推送执行日志
    logger.info('🚀 [PUSH_EXECUTION] Starting scheduled push', {
      executionId,
      currentTime: new Date(startTime).toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
    
    this.lastPushTime = startTime;

    try {

      const enabledUsers = await this.getEnabledPushUsers();
      
      if (enabledUsers.length === 0) {
        return;
      }


      let successCount = 0;
      let failureCount = 0;
      let groupSuccessCount = 0;
      let groupFailureCount = 0;

      // 🔄 统一推送流程：为每个用户同时处理个人推送和群组推送，避免双重推送
      for (const user of enabledUsers) {
        try {
          // 1. 发送个人推送
          await this.sendPushToUser(user.userId, user.settings, user.pushData);
          successCount++;
          
          // 2. 同时处理该用户的群组推送（使用已获取的群组数据，避免重复API调用）
          try {
            const userBoundGroups = user.managedGroups || [];
            const groupIds = userBoundGroups.map(group => group.group_id).filter(id => id);
            
            if (groupIds.length > 0) {
              logger.info(`📤 [UNIFIED_PUSH] Processing ${groupIds.length} groups for user ${user.userId}`, {
                executionId,
                userId: parseInt(user.userId),
                groupCount: groupIds.length,
                source: 'cached_api_response'
              });
              
              for (const groupId of groupIds) {
                try {
                  await this.sendPushToGroup(groupId, user.settings, user.pushData, executionId);
                  groupSuccessCount++;
                } catch (groupError) {
                  groupFailureCount++;
                  logger.error(`❌ [UNIFIED_PUSH] Failed to send to group ${groupId}`, {
                    error: (groupError as Error).message,
                    executionId
                  });
                }
              }
            }
          } catch (groupError) {
            logger.error(`❌ [UNIFIED_PUSH] Failed to process groups for user ${user.userId}`, {
              error: (groupError as Error).message
            });
          }
          
        } catch (error) {
          failureCount++;
          logger.error(`❌ [SCHEDULER] Failed to send push to user ${user.userId}`, {
            error: (error as Error).message,
            stack: (error as Error).stack
          });
        }
      }

      logger.info(`✅ [UNIFIED_PUSH] Push execution completed [${executionId}]`, {
        executionId,
        userPushes: { success: successCount, failed: failureCount },
        groupPushes: { success: groupSuccessCount, failed: groupFailureCount },
        totalSuccess: successCount + groupSuccessCount,
        totalFailed: failureCount + groupFailureCount
      });
      
      await this.updateLastPushTime();

      const duration = Date.now() - startTime;

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
   * 简化版本：直接使用内存存储 + API调用，删除Redis缓存依赖
   */
  private async getEnabledPushUsers(): Promise<Array<{
    userId: string;
    settings: PushSettings;
    pushData?: PushData;
    managedGroups?: Array<{group_id: string; group_name: string; bound_at: string}>;
  }>> {
    try {
      const enabledUsers: Array<{
        userId: string;
        settings: PushSettings;
        pushData?: PushData;
        managedGroups?: Array<{group_id: string; group_name: string; bound_at: string}>;
      }> = [];
      
      // 🎯 简化逻辑：直接从内存存储获取用户列表
      const enabledUserIds = Array.from(this.enabledUsersMemoryStore.keys());
      
      logger.info(`📋 [PUSH_SCHEDULER] Processing ${enabledUserIds.length} users from memory store`, {
        userIds: enabledUserIds
      });
      
      for (const userId of enabledUserIds) {
        try {
          // 🔄 直接调用API获取最新的用户设置和推送数据
          const accessToken = await getUserAccessToken(userId, {
            username: undefined,
            first_name: undefined,
            last_name: undefined
          });
          
          const apiResponse = await pushService.getUserPushSettings(userId, accessToken);
          const userSettings = apiResponse.data.user_settings;
          const pushData = apiResponse.data.push_data;
          
          // 检查是否至少有一项推送功能启用
          const hasAnyEnabled = userSettings.flash_enabled || 
                              userSettings.whale_enabled || 
                              userSettings.fund_enabled;
          
          if (hasAnyEnabled) {
            // 统计推送内容数量
            if (pushData) {
              const dataCount = (pushData.flash_news?.length || 0) + 
                               (pushData.whale_actions?.length || 0) + 
                               (pushData.fund_flows?.length || 0);
              logger.info(`📊 [PUSH_DATA] User ${userId} - ${dataCount} total items available (from API)`);
            }
            
            enabledUsers.push({
              userId: userId,
              settings: userSettings,
              pushData: pushData,
              managedGroups: userSettings.managed_groups || []
            });
          } else {
            // 用户关闭了所有推送，从内存中移除
            logger.info(`⚠️ [PUSH_SCHEDULER] User ${userId} disabled all push types, removing from memory`);
            this.enabledUsersMemoryStore.delete(userId);
          }
          
        } catch (userError) {
          logger.warn(`⚠️ [PUSH_SCHEDULER] Failed to get settings for user ${userId}`, {
            error: (userError as Error).message
          });
          // 继续处理其他用户，不移除该用户（可能是临时网络问题）
          continue;
        }
      }

      logger.info(`✅ [PUSH_SCHEDULER] Enabled push users processed successfully`, {
        totalUsers: enabledUserIds.length,
        enabledUsers: enabledUsers.length,
        userIds: enabledUsers.map(u => u.userId)
      });

      return enabledUsers;

    } catch (error) {
      logger.error('❌ [PUSH_SCHEDULER] Failed to get enabled push users', {
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * @deprecated 已删除复杂的Redis缓存逻辑
   * 现在直接使用内存存储和API调用，见 getEnabledPushUsers()
   */

  /**
   * @deprecated 已删除复杂的Redis缓存逻辑
   * 现在直接调用API获取最新设置，见 getEnabledPushUsers()
   */

  /**
   * 添加用户到推送跟踪（供外部调用）
   */
  public addUserToPushTracking(userId: string, settings: PushSettings): void {
    this.enabledUsersMemoryStore.set(userId, {
      settings,
      lastUpdated: Date.now()
    });
  }

  /**
   * 在推送调度器启动时初始化已知用户
   */
  public addTestUserToPushTracking(): void {
    // 添加已知的测试用户以便立即开始推送测试
    // 这样系统启动后就能立即开始推送，无需等待用户手动设置
    const knownUsers = [
      {
        userId: '111919', // 从用户提供的JWT Token中提取的用户ID
        settings: {
          flash_enabled: true,
          whale_enabled: true,
          fund_enabled: false // 根据API响应，用户关闭了fund推送
        }
      },
      {
        userId: '1238737093', // 备用测试用户
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
      
      const environment = process.env.NODE_ENV || 'development';
      
      // 测试环境：跳过内容新鲜度检查，只要有API数据就推送
      if (environment === 'production') {
        if (!pushData || !pushDataService.hasNewPushContent(pushData)) {
          logger.warn(`⚠️ [MESSAGE_SEND] No new push content for user ${userId} - stopping send process`, {
            hasPushData: !!pushData,
            contentCheckPassed: pushData ? pushDataService.hasNewPushContent(pushData) : false
          });
          return;
        }
      } else {
        // 测试环境：只要有pushData就继续，不检查新鲜度
        if (!pushData) {
          logger.warn(`⚠️ [TEST_PUSH] No pushData for user ${userId} - stopping send process`);
          return;
        }
        logger.info(`✅ [TEST_PUSH] Skipping content freshness check for test environment - user ${userId}`);
      }

      // 根据用户设置筛选推送内容
      const { flashNews, whaleActions, fundFlows } = pushDataService.filterPushContent(pushData, settings);
      
      PushLogger.logContentFiltering(userId, flashNews.length, whaleActions.length, fundFlows.length, settings);
      
      // 应用去重逻辑，过滤掉已推送过的内容
      const [dedupFlashNews, dedupWhaleActions, dedupFundFlows] = await Promise.all([
        pushDeduplicator.filterDuplicates(userId, flashNews, 'flash_news'),
        pushDeduplicator.filterDuplicates(userId, whaleActions, 'whale_actions'),
        pushDeduplicator.filterDuplicates(userId, fundFlows, 'fund_flows')
      ]);
      
      // 简化去重日志
      const totalAfterDedup = dedupFlashNews.length + dedupWhaleActions.length + dedupFundFlows.length;
      if (totalAfterDedup > 0) {
        logger.info(`📤 [PUSH_READY] User ${userId} - ${totalAfterDedup} items ready for push`);
      }

      // 使用消息格式化服务处理消息（使用去重后的数据）
      const messages = pushMessageFormatterService.formatBatchMessages(dedupFlashNews, dedupWhaleActions, dedupFundFlows);

      PushLogger.logMessageFormatting(userId, messages);

      if (messages.length === 0) {
        logger.warn(`⚠️ [MESSAGE_SEND] No messages generated after formatting for user ${userId}`);
        return;
      }

      // 发送所有消息
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
          await bot.telegram.sendMessage(parseInt(userId), message.content, sendOptions);
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
   * 简化版本：仅在内存中记录，不再依赖Redis缓存
   */
  private async updateLastPushTime(): Promise<void> {
    try {
      this.lastPushTime = Date.now();
      logger.debug('📝 [PUSH_SCHEDULER] Updated last push time in memory', {
        lastPushTime: new Date(this.lastPushTime).toISOString()
      });
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
    intervalDescription: string;
  } {
    const environment = process.env.NODE_ENV || 'development';
    
    // 简化环境配置：测试环境统一每分钟执行
    let cronPattern: string;
    if (environment === 'production') {
      cronPattern = PUSH_CONSTANTS.CRON.PRODUCTION; // 每20分钟
    } else {
      // 测试环境（test/testing/development）统一每分钟执行
      cronPattern = PUSH_CONSTANTS.CRON.TEST; // 每1分钟
    }
    
    return {
      isRunning: this.isRunning,
      cronPattern,
      environment,
      intervalDescription: this.getCronDescription(cronPattern)
    };
  }

  /**
   * 获取Cron表达式的描述
   */
  private getCronDescription(cronPattern: string): string {
    switch (cronPattern) {
      case PUSH_CONSTANTS.CRON.PRODUCTION:
        return 'Every 20 minutes';
      case PUSH_CONSTANTS.CRON.TEST:
        return 'Every 1 minute (Test Environment)';
      default:
        return `Custom: ${cronPattern}`;
    }
  }

  // ==================== 群组推送功能 ====================

  /**
   * @deprecated 已优化：不再需要重复API调用
   * 群组信息现在在 getEnabledPushUsers() 中一次性获取，避免重复调用
   * 使用 user.managedGroups 替代此方法
   */
  private async getUserBoundGroups(userId: string): Promise<string[]> {
    logger.warn('🚨 [DEPRECATED] getUserBoundGroups() should not be called anymore. Groups are fetched in getEnabledPushUsers()');
    return [];
  }

  /**
   * 执行群组推送任务 (基于用户的managed_groups)
   */
  private async executeGroupPush(executionId: string): Promise<void> {
    try {
      logger.info(`🚀 [${executionId}] Starting unified group push execution`);
      
      // 获取所有启用推送的用户
      const enabledUsers = await this.getEnabledPushUsers();
      
      if (enabledUsers.length === 0) {
        logger.info(`[${executionId}] No users with push enabled`);
        return;
      }
      
      let totalGroupsProcessed = 0;
      let groupSuccessCount = 0;
      let groupFailureCount = 0;
      const processedGroups = new Set<string>(); // 防止重复推送
      
      logger.info(`📊 [${executionId}] Processing ${enabledUsers.length} enabled users for group push`);
      
      for (const user of enabledUsers) {
        try {
          // 使用已获取的群组数据，避免重复API调用
          const userBoundGroups = user.managedGroups || [];
          const groupIds = userBoundGroups.map(group => group.group_id).filter(id => id);
          
          if (groupIds.length === 0) {
            continue;
          }
          
          logger.info(`🎯 [${executionId}] User ${user.userId} has ${groupIds.length} bound groups (from cached data)`);
          
          // 使用已获取的推送数据，避免重复API调用
          const pushData = user.pushData;
          
          // 遍历用户绑定的每个群组
          for (const groupId of groupIds) {
            // 避免重复推送 (如果多个用户绑定了同一个群组)
            if (processedGroups.has(groupId)) {
              continue;
            }
            
            try {
              totalGroupsProcessed++;
              processedGroups.add(groupId);
              
              logger.info(`📤 [${executionId}] Sending to group ${groupId} (bound by user ${user.userId})`);
              
              // 发送群组推送 (使用绑定用户的设置和数据)
              await this.sendPushToGroup(groupId, user.settings, pushData, executionId);
              groupSuccessCount++;
              
            } catch (error) {
              groupFailureCount++;
              logger.error(`[${executionId}] Failed to send to group ${groupId}`, {
                groupId,
                userId: parseInt(user.userId),
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
          
        } catch (error) {
          logger.error(`[${executionId}] Failed to process user ${user.userId} groups`, {
            userId: parseInt(user.userId),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      logger.info(`✅ [${executionId}] Unified group push execution completed`, {
        enabledUsers: enabledUsers.length,
        totalGroupsProcessed: totalGroupsProcessed,
        uniqueGroupsReached: processedGroups.size,
        successCount: groupSuccessCount,
        failureCount: groupFailureCount,
        successRate: totalGroupsProcessed > 0 ? Math.round((groupSuccessCount / totalGroupsProcessed) * 100) : 0,
        dataSource: 'user_managed_groups'
      });
      
    } catch (error) {
      logger.error(`[${executionId}] Group push execution failed`, {
        error: (error as Error).message
      });
    }
  }

  /**
   * @deprecated 不再使用基于Redis缓存的群组管理
   * 现在使用用户API中的managed_groups来统一群组数据源
   * 使用getUserBoundGroups()方法替代
   */
  private async getBotGroups(): Promise<string[]> {
    logger.warn('🚨 [DEPRECATED] getBotGroups() is deprecated, use getUserBoundGroups() instead');
    return [];
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
      const environment = process.env.NODE_ENV || 'development';
      
      // 测试环境：跳过内容新鲜度检查，只要有API数据就推送
      if (environment === 'production') {
        if (!pushData || !pushDataService.hasNewPushContent(pushData)) {
          logger.debug(`[${executionId}] No new push content for group ${groupId}`);
          return;
        }
      } else {
        // 测试环境：只要有pushData就继续，不检查新鲜度
        if (!pushData) {
          logger.debug(`[${executionId}] No pushData for group ${groupId} - stopping send process`);
          return;
        }
        logger.debug(`[${executionId}] Test environment: skipping content freshness check for group ${groupId}`);
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
   * @deprecated 不再使用Redis缓存管理群组
   * 群组数据现在通过用户API的managed_groups统一管理
   */
  public addBotGroup(groupId: string): void {
    logger.warn('🚨 [DEPRECATED] addBotGroup() is deprecated, groups are managed via user API managed_groups');
  }

  /**
   * @deprecated 不再使用Redis缓存管理群组  
   * 群组数据现在通过用户API的managed_groups统一管理
   */
  public removeBotGroup(groupId: string): void {
    logger.warn('🚨 [DEPRECATED] removeBotGroup() is deprecated, groups are managed via user API managed_groups');
  }
}

// 导出单例
export const pushScheduler = new PushSchedulerService();
export default pushScheduler;
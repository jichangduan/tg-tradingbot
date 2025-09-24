import * as cron from 'node-cron';
import { PushSettings, PushData, pushService } from './push.service';
import { pushMessageFormatterService } from './push-message-formatter.service';
import { pushDataService } from './push-data.service';
import { cacheService } from './cache.service';
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
      
      // 根据环境变量选择推送间隔
      let cronPattern: string;
      switch (environment) {
        case 'production':
          cronPattern = PUSH_CONSTANTS.CRON.PRODUCTION; // 每20分钟
          break;
        case 'testing':
          cronPattern = PUSH_CONSTANTS.CRON.TESTING; // 每2分钟
          break;
        case 'development':
        default:
          cronPattern = PUSH_CONSTANTS.CRON.TEST; // 每1分钟
          break;
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
  }

  /**
   * 手动执行一次推送任务（用于测试）
   */
  public async executeManualPush(): Promise<void> {
    await this.executeScheduledPush();
  }

  // 记录上次推送时间，用于计算实际间隔
  private lastPushTime: number = 0;

  /**
   * 执行定时推送任务
   */
  private async executeScheduledPush(): Promise<void> {
    const startTime = Date.now();
    const executionId = `push_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // 🕐 记录实际推送间隔
    const actualInterval = this.lastPushTime > 0 ? startTime - this.lastPushTime : 0;
    const actualIntervalMinutes = actualInterval / (1000 * 60);
    
    logger.error('⏰ [PUSH_INTERVAL_DEBUG] Push execution timing analysis', {
      executionId,
      currentTime: new Date(startTime).toISOString(),
      lastPushTime: this.lastPushTime > 0 ? new Date(this.lastPushTime).toISOString() : 'first_execution',
      actualIntervalMs: actualInterval,
      actualIntervalMinutes: actualIntervalMinutes.toFixed(2),
      expectedInterval: '20_minutes',
      intervalAccurate: Math.abs(actualIntervalMinutes - 20) < 0.5 ? 'YES' : 'NO'
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
          
          // 2. 同时处理该用户的群组推送（避免重复API调用和重复推送）
          try {
            const userBoundGroups = await this.getUserBoundGroups(user.userId);
            if (userBoundGroups.length > 0) {
              logger.info(`📤 [UNIFIED_PUSH] Processing ${userBoundGroups.length} groups for user ${user.userId}`, {
                executionId,
                userId: parseInt(user.userId),
                groupCount: userBoundGroups.length
              });
              
              for (const groupId of userBoundGroups) {
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
                // 📊 对比调试: 定时推送 vs 立即推送的API调用模式
                logger.info(`📊 [SCHEDULED_PUSH_DEBUG] Starting push data request for comparison`, {
                  userId: parseInt(userId),
                  apiCallContext: 'scheduled_push_request',
                  userSettingsExists: !!userSettingsResult
                });
                
                // 获取推送内容数据
                const pushDataResult = await pushDataService.getPushDataForUser(userId);
                
                // 📊 对比结果记录
                logger.info(`📊 [SCHEDULED_PUSH_DEBUG] Push data result for comparison`, {
                  userId: parseInt(userId),
                  pushDataExists: !!pushDataResult,
                  apiCallContext: 'scheduled_push_request',
                  hasFlashNews: !!pushDataResult?.flash_news?.length,
                  hasWhaleActions: !!pushDataResult?.whale_actions?.length,
                  hasFundFlows: !!pushDataResult?.fund_flows?.length,
                  flashNewsCount: pushDataResult?.flash_news?.length || 0,
                  whaleActionsCount: pushDataResult?.whale_actions?.length || 0,
                  fundFlowsCount: pushDataResult?.fund_flows?.length || 0
                });
                
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
    intervalDescription: string;
  } {
    const environment = process.env.NODE_ENV || 'development';
    
    // 根据环境变量选择推送间隔
    let cronPattern: string;
    switch (environment) {
      case 'production':
        cronPattern = PUSH_CONSTANTS.CRON.PRODUCTION; // 每20分钟
        break;
      case 'testing':
        cronPattern = PUSH_CONSTANTS.CRON.TESTING; // 每2分钟
        break;
      case 'development':
      default:
        cronPattern = PUSH_CONSTANTS.CRON.TEST; // 每1分钟
        break;
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
      case PUSH_CONSTANTS.CRON.TESTING:
        return 'Every 2 minutes';
      case PUSH_CONSTANTS.CRON.TEST:
        return 'Every 1 minute';
      default:
        return `Custom: ${cronPattern}`;
    }
  }

  // ==================== 群组推送功能 ====================

  /**
   * 获取用户绑定的群组 (与测试推送使用相同逻辑)
   */
  private async getUserBoundGroups(userId: string): Promise<string[]> {
    try {
      
      const accessToken = await getUserAccessToken(userId, {
        username: undefined,
        first_name: undefined,
        last_name: undefined
      });

      const response = await pushService.getUserPushSettings(userId, accessToken);
      const managedGroups = response.data.user_settings.managed_groups || [];
      const groupIds = managedGroups.map(group => group.group_id).filter(id => id);
      
      logger.debug(`✅ [GROUP_UNIFY] Found ${groupIds.length} bound groups for user ${userId}`, {
        userId: parseInt(userId),
        groupCount: groupIds.length,
        groupIds: groupIds,
        dataSource: 'api_managed_groups'
      });
      
      return groupIds;
    } catch (error) {
      logger.warn(`❌ [GROUP_UNIFY] Failed to get bound groups for user ${userId}`, {
        userId: parseInt(userId),
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
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
          // 获取用户绑定的群组 (使用与测试推送相同的逻辑)
          const userBoundGroups = await this.getUserBoundGroups(user.userId);
          
          if (userBoundGroups.length === 0) {
            continue;
          }
          
          logger.info(`🎯 [${executionId}] User ${user.userId} has ${userBoundGroups.length} bound groups`);
          
          // 获取用户的推送数据
          const pushData = await pushDataService.getPushDataForUser(user.userId);
          
          // 遍历用户绑定的每个群组
          for (const groupId of userBoundGroups) {
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
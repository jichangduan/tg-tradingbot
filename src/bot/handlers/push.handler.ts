import { Context } from 'telegraf';
import { ExtendedContext } from '../index';
import { logger } from '../../utils/logger';
import { messageFormatter } from '../utils/message.formatter';
import { pushService, PushSettings, PushData } from '../../services/push.service';
import { ApiError } from '../../services/api.service';
import { getUserToken, getUserAccessToken } from '../../utils/auth';
import { pushScheduler } from '../../services/push-scheduler.service';
import { pushDataService } from '../../services/push-data.service';
import { pushMessageFormatterService } from '../../services/push-message-formatter.service';
import { telegramBot } from '../index';
import { config } from '../../config';
import { longHandler } from './long.handler';
import { shortHandler } from './short.handler';

/**
 * Push command handler
 * Handles /push command, manages user's push settings (flash news, whale movements, fund flows)
 * 
 * Features:
 * - Personal push settings management (private chat)
 * - Group push binding/unbinding (group chat)
 * - Group creator verification and permission control
 * - Comprehensive error handling and user feedback
 */
export class PushHandler {
  // Rate limiting for test push messages
  private lastTestPushTime = new Map<string, number>();
  private readonly TEST_PUSH_COOLDOWN = 3000; // 3 seconds cooldown

  /**
   * Check if user can send test push (rate limiting)
   */
  private canSendTestPush(userId: string): { allowed: boolean; remainingTime?: number } {
    const lastTime = this.lastTestPushTime.get(userId);
    const now = Date.now();
    
    if (!lastTime) {
      return { allowed: true };
    }
    
    const elapsed = now - lastTime;
    if (elapsed >= this.TEST_PUSH_COOLDOWN) {
      return { allowed: true };
    }
    
    const remaining = Math.ceil((this.TEST_PUSH_COOLDOWN - elapsed) / 1000);
    return { allowed: false, remainingTime: remaining };
  }

  /**
   * Record test push attempt
   */
  private recordTestPushAttempt(userId: string): void {
    this.lastTestPushTime.set(userId, Date.now());
    
    // Clean up old entries (older than 5 minutes) to prevent memory leak
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    for (const [id, time] of this.lastTestPushTime.entries()) {
      if (time < fiveMinutesAgo) {
        this.lastTestPushTime.delete(id);
      }
    }
  }

  /**
   * Send immediate push when user enables a push type
   */
  private async sendImmediatePushOnEnable(
    userId: string, 
    pushType: 'flash' | 'whale' | 'fund',
    requestId: string
  ): Promise<void> {
    try {
      logger.info(`🎯 [IMMEDIATE_PUSH] Starting immediate push for ${pushType} [${requestId}]`, {
        userId: parseInt(userId),
        pushType,
        requestId
      });

      // 1. 强制获取包含push_data的新数据，绕过缓存
      let pushData = await this.getFreshPushDataForImmediate(userId, requestId);
      
      if (!pushData) {
        logger.warn(`⚠️ [IMMEDIATE_PUSH] No push data available after fresh fetch [${requestId}]`);
        await this.sendImmediatePushFallbackMessage(userId, pushType, requestId);
        return;
      }

      logger.info(`✅ [IMMEDIATE_PUSH] Got fresh push data, proceeding with real content [${requestId}]`, {
        flashNewsCount: pushData.flash_news?.length || 0,
        whaleActionsCount: pushData.whale_actions?.length || 0,
        fundFlowsCount: pushData.fund_flows?.length || 0
      });

      // 2. 根据开启的类型过滤数据
      const settings: PushSettings = {
        flash_enabled: pushType === 'flash',
        whale_enabled: pushType === 'whale',
        fund_enabled: pushType === 'fund'
      };
      
      const filteredContent = pushDataService.filterPushContent(pushData, settings);
      
      logger.info(`Filtered content for immediate send [${requestId}]`, {
        userId: parseInt(userId),
        pushType,
        flashNewsCount: filteredContent.flashNews.length,
        whaleActionsCount: filteredContent.whaleActions.length,
        fundFlowsCount: filteredContent.fundFlows.length,
        requestId
      });

      // 3. 格式化消息
      const formattedMessages = pushMessageFormatterService.formatBatchMessages(
        filteredContent.flashNews,
        filteredContent.whaleActions,
        filteredContent.fundFlows
      );

      // 提取消息内容
      const messages = formattedMessages.map(msg => msg.content);

      if (messages.length === 0) {
        logger.info(`No messages to send for immediate push [${requestId}]`, {
          userId: parseInt(userId),
          pushType,
          requestId
        });
        return;
      }

      // 4. 发送消息给用户
      const bot = telegramBot.getBot();
      for (const message of messages) {
        try {
          await bot.telegram.sendMessage(parseInt(userId), message, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true }
          });
          
          logger.info(`Immediate push message sent [${requestId}]`, {
            userId: parseInt(userId),
            pushType,
            messageLength: message.length,
            requestId
          });
        } catch (sendError) {
          logger.error(`Failed to send immediate push message [${requestId}]`, {
            userId: parseInt(userId),
            pushType,
            error: (sendError as Error).message,
            requestId
          });
        }
      }

      logger.info(`Immediate push completed [${requestId}]`, {
        userId: parseInt(userId),
        pushType,
        messagesSent: messages.length,
        requestId
      });

    } catch (error) {
      logger.error(`Immediate push failed [${requestId}]`, {
        userId: parseInt(userId),
        pushType,
        error: (error as Error).message,
        stack: (error as Error).stack,
        requestId
      });
    }
  }

  /**
   * Get fresh push data for immediate push - bypasses cache to get real data
   */
  private async getFreshPushDataForImmediate(userId: string, requestId: string): Promise<any> {
    try {
      logger.info(`🔄 [FRESH_DATA] Getting fresh push data for immediate push [${requestId}]`);

      // 1. 先清除可能的缓存
      await pushService.clearUserCache(userId);
      
      // 2. 获取访问令牌
      let accessToken = await getUserToken(userId);
      if (!accessToken) {
        const userInfo = { username: undefined, first_name: undefined, last_name: undefined };
        accessToken = await getUserAccessToken(userId, userInfo);
      }

      // 3. 直接调用push service获取包含push_data的新鲜响应
      const response = await pushService.getUserPushSettings(userId, accessToken);
      
      logger.info(`📡 [FRESH_DATA] API response for immediate push [${requestId}]`, {
        hasData: !!response.data,
        hasPushData: !!response.data?.push_data,
        responseMessage: response.message
      });
      
      if (response.data?.push_data) {
        const pushData = response.data.push_data;
        logger.info(`✅ [FRESH_DATA] Successfully got fresh push data [${requestId}]`, {
          flashNews: pushData.flash_news?.length || 0,
          whaleActions: pushData.whale_actions?.length || 0,
          fundFlows: pushData.fund_flows?.length || 0
        });
        return pushData;
      }

      logger.warn(`⚠️ [FRESH_DATA] Fresh API call returned no push data [${requestId}]`);
      return null;

    } catch (error) {
      logger.error(`❌ [FRESH_DATA] Error getting fresh push data [${requestId}]`, {
        error: (error as Error).message,
        requestId
      });
      return null;
    }
  }

  /**
   * Get push data with retry mechanism for immediate push
   */
  private async getPushDataWithRetry(userId: string, requestId: string): Promise<any> {
    const maxRetries = 2;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`🔄 [RETRY] Attempt ${attempt}/${maxRetries} to get push data [${requestId}]`, {
          userId: parseInt(userId),
          attempt,
          requestId
        });

        const pushData = await pushDataService.getPushDataForUser(userId);
        
        if (pushData) {
          logger.info(`✅ [RETRY] Successfully got push data on attempt ${attempt} [${requestId}]`, {
            userId: parseInt(userId),
            attempt,
            requestId
          });
          return pushData;
        }

        if (attempt < maxRetries) {
          logger.info(`⏳ [RETRY] No data on attempt ${attempt}, retrying in ${retryDelay}ms [${requestId}]`, {
            userId: parseInt(userId),
            attempt,
            retryDelay,
            requestId
          });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      } catch (error) {
        logger.error(`❌ [RETRY] Error on attempt ${attempt} [${requestId}]`, {
          userId: parseInt(userId),
          attempt,
          error: (error as Error).message,
          requestId
        });
        
        if (attempt === maxRetries) {
          throw error;
        }
      }
    }

    logger.warn(`⚠️ [RETRY] All attempts failed to get push data [${requestId}]`, {
      userId: parseInt(userId),
      maxRetries,
      requestId
    });

    return null;
  }

  /**
   * Send fallback message when immediate push data is not available
   */
  private async sendImmediatePushFallbackMessage(
    userId: string, 
    pushType: 'flash' | 'whale' | 'fund',
    requestId: string
  ): Promise<void> {
    try {
      const typeName = this.getTypeName(pushType);
      const emoji = this.getTypeEmoji(pushType);
      
      const fallbackMessage = `
${emoji} <b>${typeName} Push Enabled!</b>

✅ Your ${typeName.toLowerCase()} notifications are now active.

📡 <b>What happens next:</b>
• You'll receive ${typeName.toLowerCase()} updates as they become available
• New content will be pushed automatically based on our monitoring schedule
• You can disable notifications anytime using /push

⏰ <b>Next push:</b> Within the next 20 minutes or when new ${typeName.toLowerCase()} activity is detected.

<i>💡 Push system is now actively monitoring for ${typeName.toLowerCase()} content.</i>
      `.trim();

      const bot = telegramBot.getBot();
      await bot.telegram.sendMessage(parseInt(userId), fallbackMessage, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });

      logger.info(`📋 [FALLBACK] Sent immediate push fallback message [${requestId}]`, {
        userId: parseInt(userId),
        pushType,
        typeName,
        requestId
      });

    } catch (error) {
      logger.error(`❌ [FALLBACK] Failed to send fallback message [${requestId}]`, {
        userId: parseInt(userId),
        pushType,
        error: (error as Error).message,
        requestId
      });
    }
  }

  /**
   * Get emoji for push type
   */
  private getTypeEmoji(type: string): string {
    switch (type) {
      case 'flash': return '🚨';
      case 'whale': return '🐋';
      case 'fund': return '💰';
      default: return '🔔';
    }
  }

  /**
   * Log group push operation with detailed context
   */
  private logGroupPushOperation(
    operation: 'bind_request' | 'unbind_request' | 'creator_check' | 'api_call' | 'success' | 'error' | 'test_push_initiated' | 'test_push_sent' | 'test_push_error',
    requestId: string,
    context: {
      userId?: string | number;
      groupId?: string | number;
      groupName?: string;
      error?: string;
      duration?: number;
      isCreator?: boolean;
      pushType?: string;
      action?: string;
      privateChat?: boolean;
      groupCount?: number;
      success?: boolean;
      [key: string]: any;
    }
  ): void {
    const logData = {
      operation,
      requestId,
      timestamp: new Date().toISOString(),
      userId: typeof context.userId === 'string' ? parseInt(context.userId) : context.userId,
      groupId: typeof context.groupId === 'string' ? context.groupId : context.groupId?.toString(),
      groupName: context.groupName,
      error: context.error,
      duration: context.duration,
      isCreator: context.isCreator
    };

    switch (operation) {
      case 'bind_request':
      case 'unbind_request':
        logger.info(`🔗 Group push ${operation.replace('_request', '')} initiated`, logData);
        break;
      case 'creator_check':
        logger.info(`👑 Group creator verification: ${context.isCreator ? 'PASSED' : 'FAILED'}`, logData);
        break;
      case 'api_call':
        logger.info(`📡 API call for group push operation`, logData);
        break;
      case 'success':
        logger.info(`✅ Group push operation completed successfully`, logData);
        break;
      case 'error':
        logger.error(`❌ Group push operation failed`, logData);
        break;
      case 'test_push_initiated':
        logger.info(`🧪 [TEST_PUSH] Test push initiated for ${context.pushType}`, {
          ...logData,
          pushType: context.pushType,
          privateChat: context.privateChat,
          groupCount: context.groupCount || 0,
          actionType: 'test_push_start'
        });
        break;
      case 'test_push_sent':
        logger.info(`🧪✅ [TEST_PUSH] Test push completed successfully`, {
          ...logData,
          pushType: context.pushType,
          privateChat: context.privateChat,
          groupCount: context.groupCount || 0,
          successRate: context.success ? '100%' : 'partial',
          actionType: 'test_push_complete'
        });
        break;
      case 'test_push_error':
        logger.error(`🧪❌ [TEST_PUSH] Test push failed`, {
          ...logData,
          pushType: context.pushType,
          privateChat: context.privateChat,
          groupCount: context.groupCount || 0,
          errorCategory: 'test_push_failure',
          actionType: 'test_push_error'
        });
        break;
      default:
        logger.debug(`Group push operation: ${operation}`, logData);
    }
  }
  /**
   * Handle /push command
   * @param ctx Telegram context
   * @param args Command parameter array
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';
    const chatType = ctx.chat?.type;
    const chatId = ctx.chat?.id;

    try {
      logger.logCommand('push', userId!, username, args);

      // 检查是否在群组中执行
      if (chatType === 'group' || chatType === 'supergroup') {
        // 群组环境 - 验证群主权限后显示推送设置
        await this.handleGroupPushCommand(ctx, args);
      } else {
        // 私聊环境 - 显示个人推送设置
        await this.showPushSettings(ctx);
      }

      const duration = Date.now() - startTime;
      logger.info(`Push command completed [${requestId}] - ${duration}ms`, {
        userId,
        username,
        chatType,
        chatId,
        duration,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Push command failed [${requestId}] - ${duration}ms`, {
        error: (error as Error).message,
        userId,
        username,
        chatType,
        chatId,
        requestId
      });

      await this.handleError(ctx, error as Error);
    }
  }

  /**
   * Handle group push command - 验证群主权限后显示推送设置
   */
  private async handleGroupPushCommand(ctx: ExtendedContext, args: string[]): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const chatTitle = (ctx.chat && 'title' in ctx.chat) ? ctx.chat.title || 'Unnamed Group' : 'Unnamed Group';
    const requestId = ctx.requestId || 'unknown';

    if (!userId || !chatId) {
      const userInfoError = await ctx.__!('trading.userInfoError');
      await ctx.reply(userInfoError);
      return;
    }

    try {
      // 记录群组推送命令接收
      logger.info(`群组推送设置请求 [${requestId}]`, {
        userId,
        groupId: chatId,
        groupName: chatTitle,
        requestId
      });

      // 验证用户是否为群主
      const isCreator = await this.verifyGroupCreator(ctx, userId, chatId);
      
      if (!isCreator) {
        const insufficientPermMsg = await ctx.__!('push.insufficientPermissions');
        await ctx.reply(insufficientPermMsg, { parse_mode: 'HTML' });
        return;
      }

      // 群主权限验证通过，显示推送设置界面（与私聊相同）
      // 群组的自动绑定由中间件处理，这里只负责显示设置
      await this.showPushSettings(ctx);

      logger.info(`群组推送设置显示成功 [${requestId}]`, {
        userId,
        groupId: chatId,
        groupName: chatTitle,
        requestId
      });

    } catch (error) {
      logger.error(`群组推送设置失败 [${requestId}]`, {
        userId,
        groupId: chatId,
        groupName: chatTitle,
        error: (error as Error).message,
        requestId
      });

      const pushErrorMsg = await ctx.__!('push.error');
      await ctx.reply(pushErrorMsg, { parse_mode: 'HTML' });
    }
  }

  /**
   * Verify if user is group creator
   */
  private async verifyGroupCreator(ctx: ExtendedContext, userId: number, chatId: number): Promise<boolean> {
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.debug(`Verifying group creator [${requestId}]`, { userId, chatId, requestId });

      // 获取群组管理员列表
      const administrators = await ctx.telegram.getChatAdministrators(chatId);
      
      // 检查用户是否为群组创建者
      const isCreator = administrators.some(admin =>
        admin.status === 'creator' && admin.user.id === userId
      );

      logger.debug(`Group creator verification result [${requestId}]`, {
        userId,
        chatId,
        isCreator,
        totalAdmins: administrators.length,
        requestId
      });

      return isCreator;

    } catch (error) {
      logger.error(`Failed to verify group creator [${requestId}]`, {
        userId,
        chatId,
        error: (error as Error).message,
        requestId
      });

      // 权限验证失败时，为安全起见返回 false
      return false;
    }
  }


  /**
   * Generate test push message content
   */
  private generateTestPushMessage(type: 'flash' | 'whale' | 'fund'): { content: string; symbol?: string } {
    const timestamp = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    switch (type) {
      case 'flash':
        return {
          content: 
            `🚨 <b>Test News</b>\n\n` +
            `📈 <b>BTC Breaks Through $75,000 Major Resistance</b>\n` +
            `💡 Large capital inflow, market sentiment extremely optimistic\n` +
            `📊 24h gain: +8.5%\n` +
            `⏰ ${timestamp}\n\n` +
            `<i>🧪 This is a test push message</i>`,
          symbol: 'BTC'
        };

      case 'whale':
        return {
          content:
            `🐋 <b>Test Whale Activity</b>\n\n` +
            `💰 <b>Whale Address Large Transfer In</b>\n` +
            `📍 Address: 0x742d...8a3f\n` +
            `🔢 Amount: 10,000 ETH\n` +
            `💵 Value: ~$25,000,000\n` +
            `📈 Action: Buy position\n` +
            `⏰ ${timestamp}\n\n` +
            `<i>🧪 This is a test push message</i>`,
          symbol: 'ETH'
        };

      case 'fund':
        return {
          content:
            `💰 <b>Test Fund Flow</b>\n\n` +
            `📤 <b>Binance Large Fund Outflow</b>\n` +
            `🏦 Exchange: Binance → Unknown Wallet\n` +
            `🔢 Amount: 50,000 BTC\n` +
            `💵 Value: ~$3,750,000,000\n` +
            `📊 Flow: Cold wallet storage\n` +
            `⏰ ${timestamp}\n\n` +
            `<i>🧪 This is a test push message</i>`,
          symbol: 'BTC'
        };

      default:
        return {
          content: `🧪 <b>Test Push</b>\n\nUnknown type push test\n⏰ ${timestamp}`
        };
    }
  }

  /**
   * Send test push message to user
   */
  private async sendTestPushMessage(
    ctx: ExtendedContext, 
    type: 'flash' | 'whale' | 'fund', 
    userId: string
  ): Promise<void> {
    const requestId = ctx.requestId || 'unknown';

    try {
      // 生成测试消息
      const testMessage = this.generateTestPushMessage(type);
      
      // 先获取绑定的群组以便日志记录
      const boundGroups = await this.getBoundGroups(userId);
      
      // 记录测试推送开始
      this.logGroupPushOperation('test_push_initiated', requestId, {
        userId,
        pushType: type,
        action: 'send_test_message',
        privateChat: true,
        groupCount: boundGroups.length
      });
      
      // 1. 发送到私聊（当前对话）
      await ctx.reply(testMessage.content, { parse_mode: 'HTML' });

      // 2. 检查是否有绑定的群组并发送
      logger.info('🎯 [PUSH_PREP] Starting group push preparation', {
        userId: parseInt(userId),
        requestId,
        testMessageGenerated: !!testMessage,
        testMessageLength: testMessage?.content?.length || 0,
        privateMessageSent: true
      });

      let groupResults = { success: 0, failed: 0, errors: [] as string[] };
      
      logger.info('📊 [PUSH_PREP] Group binding check completed', {
        userId: parseInt(userId),
        requestId,
        boundGroupsCount: boundGroups.length,
        boundGroups: boundGroups,
        willSendToGroups: boundGroups.length > 0
      });
      
      if (boundGroups.length > 0) {
        logger.info(`🚀 [PUSH_PREP] Initiating group push to ${boundGroups.length} bound groups`, {
          userId: parseInt(userId),
          groupCount: boundGroups.length,
          requestId,
          targetGroups: boundGroups,
          messageContent: testMessage.content.substring(0, 100) + '...'
        });
        
        groupResults = await this.sendToGroups(boundGroups, testMessage, requestId);
        
        logger.info('📈 [PUSH_PREP] Group push execution completed', {
          userId: parseInt(userId),
          requestId,
          totalGroups: boundGroups.length,
          successfulSends: groupResults.success,
          failedSends: groupResults.failed,
          errors: groupResults.errors
        });

        // 诊断日志：Telegram发送阶段
        this.logComprehensiveDiagnosis('telegram_send', {
          userId,
          requestId,
          success: groupResults.success > 0,
          details: {
            totalAttempts: boundGroups.length,
            successfulDeliveries: groupResults.success,
            failedDeliveries: groupResults.failed,
            successRate: boundGroups.length > 0 ? Math.round((groupResults.success / boundGroups.length) * 100) : 0,
            errors: groupResults.errors,
            privateMessageSent: true,
            groupMessagesSent: groupResults.success > 0
          },
          error: groupResults.failed > 0 ? groupResults.errors.join('; ') : undefined
        });
      } else {
        logger.warn('⚠️ [PUSH_PREP] No bound groups found - skipping group push', {
          userId: parseInt(userId),
          requestId,
          reason: 'no_bound_groups',
          onlyPrivateMessageSent: true
        });

        // 诊断日志：推送准备阶段（无群组情况）
        this.logComprehensiveDiagnosis('push_preparation', {
          userId,
          requestId,
          success: false, // 从功能角度看，没有群组意味着群组推送失败
          details: {
            boundGroupsCount: 0,
            privateMessageSent: true,
            groupMessagesSent: false,
            reason: 'no_bound_groups_available'
          },
          error: 'No bound groups found for user'
        });
      }

      // 记录测试推送成功
      this.logGroupPushOperation('test_push_sent', requestId, {
        userId,
        pushType: type,
        privateChat: true,
        groupCount: boundGroups.length,
        groupSuccess: groupResults.success,
        groupFailed: groupResults.failed,
        success: groupResults.success > 0 && groupResults.failed === 0
      });

      logger.info(`Test push message sent successfully [${requestId}]`, {
        userId: parseInt(userId),
        type,
        symbol: testMessage.symbol,
        requestId
      });

    } catch (error) {
      // 记录测试推送失败
      this.logGroupPushOperation('test_push_error', requestId, {
        userId,
        pushType: type,
        privateChat: true,
        groupCount: 0, // 错误情况下群组数量未知
        error: (error as Error).message
      });

      logger.error(`Failed to send test push message [${requestId}]`, {
        userId: parseInt(userId),
        type,
        error: (error as Error).message,
        requestId
      });

      // 发送错误提示
      try {
        const testPushErrorMsg = await ctx.__!('push.testPushFailed', this.getTypeName(type));
        await ctx.reply(testPushErrorMsg, { parse_mode: 'HTML' });
      } catch (replyError) {
        logger.error(`Failed to send error message [${requestId}]`, {
          replyError: (replyError as Error).message,
          requestId
        });
      }
    }
  }

  /**
   * Diagnostic method to log comprehensive analysis
   */
  private logComprehensiveDiagnosis(
    stage: 'api_response' | 'data_extraction' | 'push_preparation' | 'telegram_send',
    context: {
      userId: string;
      requestId: string;
      success: boolean;
      details: any;
      error?: string;
    }
  ): void {
    const logData = {
      stage,
      timestamp: new Date().toISOString(),
      userId: parseInt(context.userId),
      requestId: context.requestId,
      success: context.success,
      details: context.details,
      error: context.error
    };

    const stageEmojis = {
      api_response: '🌐',
      data_extraction: '📊', 
      push_preparation: '🎯',
      telegram_send: '📤'
    };

    if (context.success) {
      logger.info(`${stageEmojis[stage]} [DIAGNOSIS] ${stage.toUpperCase()} stage completed successfully`, logData);
    } else {
      logger.error(`${stageEmojis[stage]} [DIAGNOSIS] ${stage.toUpperCase()} stage failed`, logData);
    }
  }

  /**
   * Get bound groups for a user
   */
  private async getBoundGroups(userId: string): Promise<string[]> {
    const requestId = 'getBoundGroups_' + Date.now();
    const startTime = Date.now();
    
    try {
      logger.info('🔍 [GROUP_FETCH] Starting to fetch bound groups for user', { 
        userId: parseInt(userId),
        requestId,
        timestamp: new Date().toISOString()
      });

      // Get access token for API call
      const accessToken = await getUserAccessToken(userId, {
        username: undefined,
        first_name: undefined,
        last_name: undefined
      });

      // Get user push settings which includes managed_groups
      const response = await pushService.getUserPushSettings(userId, accessToken);
      
      // 详细记录API响应数据结构
      logger.info('📊 [DATA_EXTRACT] API response structure analysis', {
        userId: parseInt(userId),
        requestId,
        responseValid: !!response,
        dataValid: !!response.data,
        userSettingsValid: !!response.data?.user_settings,
        managedGroupsField: response.data?.user_settings?.managed_groups !== undefined ? 'exists' : 'missing'
      });

      // Extract group IDs from managed_groups
      const managedGroups = response.data.user_settings.managed_groups || [];
      
      // 详细记录数据提取过程
      logger.info('🔧 [DATA_EXTRACT] Extracting group IDs from managed_groups', {
        userId: parseInt(userId),
        requestId,
        originalManagedGroups: managedGroups,
        managedGroupsType: Array.isArray(managedGroups) ? 'array' : typeof managedGroups,
        managedGroupsLength: Array.isArray(managedGroups) ? managedGroups.length : 'not_array',
        rawData: JSON.stringify(managedGroups).substring(0, 300)
      });

      const groupIds = managedGroups.map((group, index) => {
        const groupId = group?.group_id;
        logger.debug(`🔍 [DATA_EXTRACT] Processing group ${index}`, {
          userId: parseInt(userId),
          requestId,
          index,
          group,
          extractedGroupId: groupId,
          groupIdType: typeof groupId,
          groupIdValid: !!groupId
        });
        return groupId;
      }).filter(id => id); // 过滤掉空值

      logger.info('📋 [DATA_EXTRACT] Group ID extraction completed', {
        userId: parseInt(userId),
        requestId,
        originalGroupsCount: managedGroups.length,
        extractedGroupsCount: groupIds.length,
        extractedGroupIds: groupIds,
        extractionSuccess: groupIds.length > 0
      });

      // 诊断日志：数据提取阶段
      this.logComprehensiveDiagnosis('data_extraction', {
        userId,
        requestId,
        success: groupIds.length > 0,
        details: {
          managedGroupsFromAPI: managedGroups.length,
          extractedValidGroupIds: groupIds.length,
          extractedGroupIds: groupIds,
          apiResponseStructureValid: !!response.data?.user_settings,
          managedGroupsFieldExists: response.data?.user_settings?.managed_groups !== undefined
        }
      });
      
      const duration = Date.now() - startTime;
      
      if (groupIds.length > 0) {
        logger.info('✅ [GROUP_FETCH] Successfully retrieved bound groups', {
          userId: parseInt(userId),
          groupCount: groupIds.length,
          duration: duration,
          groups: managedGroups.map(g => ({ 
            id: g.group_id, 
            name: g.group_name,
            bound_at: g.bound_at,
            boundDaysAgo: Math.floor((Date.now() - new Date(g.bound_at).getTime()) / (1000 * 60 * 60 * 24))
          })),
          requestId,
          dataSource: 'api_response.managed_groups'
        });
      } else {
        logger.info('⚪ [GROUP_FETCH] No bound groups found for user', {
          userId: parseInt(userId),
          duration: duration,
          requestId,
          reason: 'managed_groups_empty_or_missing',
          apiResponseReceived: !!response.data.user_settings
        });
      }

      return groupIds;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('❌ [GROUP_FETCH] Failed to retrieve bound groups', {
        userId: parseInt(userId),
        duration: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        requestId,
        fallback: 'returning_empty_array'
      });
      return [];
    }
  }

  /**
   * Send message to specific groups
   */
  private async sendToGroups(
    groupIds: string[], 
    message: { content: string; symbol?: string },
    requestId: string = 'unknown'
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const startTime = Date.now();
    const results = { success: 0, failed: 0, errors: [] as string[] };
    
    logger.info(`🎯 [GROUP_PUSH] Starting test push to groups`, {
      groupCount: groupIds.length,
      requestId,
      messageType: message.symbol ? `${message.symbol} push` : 'generic push',
      contentLength: message.content.length,
      timestamp: new Date().toISOString()
    });
    
    if (groupIds.length === 0) {
      logger.warn('⚠️ [GROUP_PUSH] No bound groups found for test push', { requestId });
      return results;
    }

    // Import telegramBot to send messages
    const { telegramBot } = await import('../index');
    const bot = telegramBot.getBot();

    logger.info('🤖 [TG_SEND] Telegram Bot instance check', {
      requestId,
      botAvailable: !!bot,
      botType: bot?.constructor?.name || 'unknown'
    });

    if (!bot) {
      logger.error('❌ [TG_SEND] Telegram Bot instance not available', { requestId });
      throw new Error('Telegram Bot instance not available');
    }

    for (let i = 0; i < groupIds.length; i++) {
      const groupId = groupIds[i];
      const groupStartTime = Date.now();
      
      try {
        logger.info(`📤 [TG_SEND] Preparing to send to group ${i + 1}/${groupIds.length}`, { 
          groupId, 
          requestId,
          contentLength: message.content.length,
          sequence: `${i + 1}/${groupIds.length}`,
          groupIdType: typeof groupId,
          groupIdValid: !!groupId
        });

        // Add group push identifier to message
        const groupMessage = message.content + '\n\n📢 <i>Group Push Test</i>';

        // 记录即将发送的完整参数
        logger.info('📋 [TG_SEND] Telegram API call parameters', {
          groupId,
          requestId,
          sequence: `${i + 1}/${groupIds.length}`,
          chatId: groupId,
          chatIdParsed: parseInt(groupId),
          messageLength: groupMessage.length,
          parseMode: 'HTML',
          messageSample: groupMessage.substring(0, 100) + '...'
        });

        // Send message to group
        const telegramResponse = await bot.telegram.sendMessage(parseInt(groupId), groupMessage, { 
          parse_mode: 'HTML' 
        });

        const groupDuration = Date.now() - groupStartTime;
        results.success++;
        
        logger.info(`✅ [TG_SEND] Message delivered to group successfully`, {
          groupId,
          requestId,
          sequence: `${i + 1}/${groupIds.length}`,
          duration: groupDuration,
          messageId: telegramResponse.message_id,
          deliveryStatus: 'success',
          telegramResponse: {
            messageId: telegramResponse.message_id,
            date: telegramResponse.date,
            chat: {
              id: telegramResponse.chat.id,
              type: telegramResponse.chat.type
            }
          }
        });

        // Add small delay between group messages to avoid rate limits
        if (i < groupIds.length - 1) {
          logger.debug('⏱️ [TG_SEND] Rate limit delay', { requestId, delay: '100ms' });
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (error) {
        const groupDuration = Date.now() - groupStartTime;
        results.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.errors.push(`Group ${groupId}: ${errorMessage}`);
        
        logger.error(`❌ [TG_SEND] Failed to deliver message to group`, {
          groupId,
          error: errorMessage,
          requestId,
          sequence: `${i + 1}/${groupIds.length}`,
          duration: groupDuration,
          deliveryStatus: 'failed',
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorStack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined,
          telegramErrorDetails: {
            message: errorMessage,
            possibleCauses: [
              'Bot not added to group',
              'Bot lacks send message permission',
              'Group ID format incorrect',
              'Group has been deleted or archived'
            ]
          }
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    logger.info(`📊 [GROUP_PUSH] Test push batch completed`, {
      requestId,
      totalDuration: `${totalDuration}ms`,
      totalGroups: groupIds.length,
      successCount: results.success,
      failedCount: results.failed,
      successRate: groupIds.length > 0 ? `${Math.round((results.success / groupIds.length) * 100)}%` : 'N/A',
      avgTimePerGroup: groupIds.length > 0 ? `${Math.round(totalDuration / groupIds.length)}ms` : 'N/A'
    });

    return results;
  }

  /**
   * Show push settings interface
   */
  private async showPushSettings(ctx: ExtendedContext): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    try {
      // Get user's current push settings and push data
      const { settings, pushData } = await this.getUserPushSettings(userId);

      const message = this.formatPushSettingsMessage(settings, pushData);
      const keyboard = await this.createPushSettingsKeyboard(ctx, settings);

      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });

    } catch (error) {
      logger.error('Failed to show push settings', {
        userId: parseInt(userId || '0'),
        error: (error as Error).message
      });

      // Show default error status
      const defaultSettings: PushSettings = {
        flash_enabled: false,
        whale_enabled: false,
        fund_enabled: false
      };

      const message = this.formatPushSettingsMessage(defaultSettings);
      const keyboard = await this.createPushSettingsKeyboard(ctx, defaultSettings);

      await ctx.reply(
        `📢 <b>Active Push Notifications</b>\n\n${await ctx.__!('push.error.settingsUnavailable')}\n\n${message}`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );
    }
  }

  /**
   * Get user push settings
   */
  private async getUserPushSettings(userId: string): Promise<{
    settings: PushSettings;
    pushData?: PushData;
  }> {
    try {
      // First try to get access token from cache
      let accessToken = await getUserToken(userId);
      
      // If no cached token, automatically initialize user
      if (!accessToken) {
        logger.info('No cached token found, initializing user', { telegramId: userId });
        
        // Get user info from context
        const userInfo = {
          username: undefined, // 在这里我们无法直接获取，但API会处理
          first_name: undefined,
          last_name: undefined
        };
        
        accessToken = await getUserAccessToken(userId, userInfo);
        logger.info('User initialized and token obtained', { telegramId: userId });
      }

      // Call push service to get settings and data
      const response = await pushService.getUserPushSettings(userId, accessToken);
      
      return {
        settings: response.data.user_settings,
        pushData: response.data.push_data
      };

    } catch (error) {
      logger.error('Failed to get user push settings', {
        userId: parseInt(userId || '0'),
        error: (error as Error).message
      });
      
      // If API error, rethrow for upper layer handling
      if (error instanceof ApiError) {
        throw error;
      }
      
      // Rethrow other errors as well
      throw new Error('Failed to get push settings: ' + (error as Error).message);
    }
  }

  /**
   * Format push settings message
   */
  private formatPushSettingsMessage(settings: PushSettings, pushData?: PushData): string {
    const flashStatus = settings.flash_enabled ? '✅ On' : '❌ Off';
    const whaleStatus = settings.whale_enabled ? '✅ On' : '❌ Off';
    const fundStatus = settings.fund_enabled ? '✅ On' : '❌ Off';

    const message = `📢 <b>Active Push Settings</b>\n\n` +
                    `🚨 Flash News: ${flashStatus}\n` +
                    `🐋 Whale Movements: ${whaleStatus}\n` +
                    `💰 Fund Flows: ${fundStatus}\n\n` +
                    `Click the buttons below to manage push settings:`;
    
    return message;
  }

  /**
   * Create push settings keyboard
   */
  private async createPushSettingsKeyboard(ctx: ExtendedContext, settings: PushSettings): Promise<any[][]> {
    // Get localized button text
    const flashNewsOn = await ctx.__!('button.flashNews.turnOn');
    const flashNewsOff = await ctx.__!('button.flashNews.turnOff');
    const whaleMovementsOn = await ctx.__!('button.whaleMovements.turnOn');
    const whaleMovementsOff = await ctx.__!('button.whaleMovements.turnOff');
    const fundFlowsOn = await ctx.__!('button.fundFlows.turnOn');
    const fundFlowsOff = await ctx.__!('button.fundFlows.turnOff');
    
    return [
      [
        {
          text: settings.flash_enabled ? flashNewsOff : flashNewsOn,
          callback_data: `push_toggle_flash_${!settings.flash_enabled}`
        }
      ],
      [
        {
          text: settings.whale_enabled ? whaleMovementsOff : whaleMovementsOn,
          callback_data: `push_toggle_whale_${!settings.whale_enabled}`
        }
      ],
      [
        {
          text: settings.fund_enabled ? fundFlowsOff : fundFlowsOn,
          callback_data: `push_toggle_fund_${!settings.fund_enabled}`
        }
      ]
    ];
  }

  /**
   * Handle button callbacks
   */
  public async handleCallback(ctx: ExtendedContext, callbackData: string): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const userIdString = ctx.from?.id?.toString();
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.info(`🔘 [CALLBACK] Push callback: ${callbackData} [${requestId}]`);

      if (!userIdString) {
        await ctx.answerCbQuery('Invalid user information');
        return;
      }

      // Parse callback data
      const callbackParts = callbackData.split('_').slice(1); // Remove 'push' prefix
      const action = callbackParts[0];

      // Handle push trading buttons
      if (action === 'trade') {
        await this.handleTradingCallback(ctx, callbackParts);
        return;
      }

      // Handle push settings buttons
      if (action === 'toggle') {
        const [, type, value] = callbackParts;
        const enabled = value === 'true';
        
        logger.info(`🔄 [TOGGLE] ${enabled ? 'Enabling' : 'Disabling'} ${type} push [${requestId}]`);
        
        // Update user settings
        await this.updateUserPushSetting(userIdString, type, enabled);

        // 禁用立即推送测试 - 等待20分钟定时器推送
        if (enabled) {
          logger.info(`✅ [PUSH_ENABLED] ${type} push enabled, will receive updates via 20-minute timer [${requestId}]`);
        }

        // Get updated settings
        const { settings: updatedSettings, pushData } = await this.getUserPushSettings(userIdString);

        // Update message
        const message = this.formatPushSettingsMessage(updatedSettings, pushData);
        const keyboard = await this.createPushSettingsKeyboard(ctx, updatedSettings);

        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: keyboard
          }
        });

        // Give user feedback (no test message notification since test messages are disabled)
        const typeName = this.getTypeName(type);
        const statusText = enabled ? 'enabled' : 'disabled';
        const feedbackMessage = `✅ ${typeName} push notifications ${statusText}!`;
        
        await ctx.answerCbQuery(feedbackMessage);

        const duration = Date.now() - startTime;
        logger.info(`Push callback completed [${requestId}] - ${duration}ms`, {
          userId,
          type,
          enabled,
          testPushSent: false, // Test push disabled
          duration,
          requestId
        });
        return;
      }

      // Unrecognized operation
      await ctx.answerCbQuery('Invalid operation');

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Push callback failed [${requestId}] - ${duration}ms`, {
        error: (error as Error).message,
        userId,
        callbackData,
        requestId
      });

      await ctx.answerCbQuery('Operation failed, please retry later');
    }
  }

  /**
   * Handle trading button callbacks
   */
  private async handleTradingCallback(ctx: ExtendedContext, callbackParts: string[]): Promise<void> {
    const requestId = ctx.requestId || 'unknown';
    const userId = ctx.from?.id;

    try {
      // callbackParts: ['trade', 'long'/'short', symbol]
      const [, direction, symbol] = callbackParts;
      
      if (!symbol || (direction !== 'long' && direction !== 'short')) {
        await ctx.answerCbQuery('Invalid trading parameters');
        return;
      }

      logger.info(`Trading callback received [${requestId}]`, {
        userId,
        direction,
        symbol,
        requestId
      });

      // Call corresponding trading handler with guided mode (same as chart handler)
      // Using only symbol parameter triggers guided trading flow
      if (direction === 'long') {
        await longHandler.handle(ctx, [symbol]);
        await ctx.answerCbQuery(`✅ Opening ${symbol} long trading interface...`);
      } else {
        await shortHandler.handle(ctx, [symbol]);
        await ctx.answerCbQuery(`✅ Opening ${symbol} short trading interface...`);
      }

      logger.info(`Trading callback completed [${requestId}]`, {
        userId,
        direction,
        symbol,
        requestId
      });

    } catch (error) {
      logger.error(`Trading callback failed [${requestId}]`, {
        error: (error as Error).message,
        userId,
        callbackParts,
        requestId
      });

      await ctx.answerCbQuery('Trade execution failed, please retry later');
    }
  }

  /**
   * Update user push settings
   */
  private async updateUserPushSetting(userId: string, type: string, enabled: boolean): Promise<void> {
    try {
      // First try to get access token from cache
      let accessToken = await getUserToken(userId);
      
      // If no cached token, automatically initialize user
      if (!accessToken) {
        logger.info('No cached token found, initializing user for update', { telegramId: userId });
        
        const userInfo = {
          username: undefined,
          first_name: undefined,
          last_name: undefined
        };
        
        accessToken = await getUserAccessToken(userId, userInfo);
        logger.info('User initialized and token obtained for update', { telegramId: userId });
      }

      // Construct update request
      const updateRequest: { [key: string]: boolean } = {};
      switch (type) {
        case 'flash':
          updateRequest.flash_enabled = enabled;
          break;
        case 'whale':
          updateRequest.whale_enabled = enabled;
          break;
        case 'fund':
          updateRequest.fund_enabled = enabled;
          break;
        default:
          throw new Error(`Invalid push type: ${type}`);
      }

      // Call push service to update settings
      const response = await pushService.updateUserPushSettings(userId, accessToken, updateRequest);

      // Update push scheduler's memory tracking
      if (response.data?.user_settings) {
        pushScheduler.addUserToPushTracking(userId, response.data.user_settings);
      }

      logger.info('Push setting updated successfully', {
        userId: parseInt(userId || '0'),
        type,
        enabled
      });

    } catch (error) {
      logger.error('Failed to update push setting', {
        userId: parseInt(userId || '0'),
        type,
        enabled,
        error: (error as Error).message
      });
      
      // Rethrow error for upper layer handling
      throw error;
    }
  }

  /**
   * Get type name
   */
  private getTypeName(type: string): string {
    switch (type) {
      case 'flash': return 'Flash News';
      case 'whale': return 'Whale Movements';
      case 'fund': return 'Fund Flows';
      default: return 'Unknown';
    }
  }



  /**
   * Error handling
   */
  private async handleError(ctx: ExtendedContext, error: Error): Promise<void> {
    const errorMessage = '❌ Push settings operation failed, please retry later\n\n' +
                        'If the problem persists, please contact technical support';

    try {
      await ctx.reply(errorMessage, { parse_mode: 'HTML' });
    } catch (replyError) {
      logger.error('Failed to send error message', {
        originalError: error.message,
        replyError: (replyError as Error).message
      });
    }
  }
}

// 导出单例
export const pushHandler = new PushHandler();
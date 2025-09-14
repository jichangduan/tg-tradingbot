import { Context } from 'telegraf';
import { ExtendedContext } from '../index';
import { logger } from '../../utils/logger';
import { messageFormatter } from '../utils/message.formatter';
import { pushService, PushSettings, PushData } from '../../services/push.service';
import { ApiError } from '../../services/api.service';
import { getUserToken, getUserAccessToken } from '../../utils/auth';
import { pushScheduler } from '../../services/push-scheduler.service';
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
  /**
   * Log group push operation with detailed context
   */
  private logGroupPushOperation(
    operation: 'bind_request' | 'unbind_request' | 'creator_check' | 'api_call' | 'success' | 'error',
    requestId: string,
    context: {
      userId?: string | number;
      groupId?: string | number;
      groupName?: string;
      error?: string;
      duration?: number;
      isCreator?: boolean;
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
        // 群组环境 - 处理群组推送绑定
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
   * Handle group push command
   */
  private async handleGroupPushCommand(ctx: ExtendedContext, args: string[]): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const chatTitle = (ctx.chat && 'title' in ctx.chat) ? ctx.chat.title || '未命名群组' : '未命名群组';
    const requestId = ctx.requestId || 'unknown';

    if (!userId || !chatId) {
      await ctx.reply('❌ 无法获取用户或群组信息');
      return;
    }

    try {
      // 记录群组推送命令接收
      this.logGroupPushOperation('bind_request', requestId, {
        userId,
        groupId: chatId,
        groupName: chatTitle,
        args: args.join(' ')
      });

      // 验证用户是否为群主
      const isCreator = await this.verifyGroupCreator(ctx, userId, chatId);
      
      // 记录权限验证结果
      this.logGroupPushOperation('creator_check', requestId, {
        userId,
        groupId: chatId,
        groupName: chatTitle,
        isCreator
      });

      if (!isCreator) {
        await ctx.reply(
          '⚠️ <b>权限不足</b>\n\n' +
          '只有群主可以设置群组推送功能\n\n' +
          '💡 如果您是群主，请确认机器人具有读取群组成员权限',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 解析命令参数 - 支持 bind/unbind 操作
      const action = args[0]?.toLowerCase();
      
      if (action === 'unbind') {
        // 记录解绑请求
        this.logGroupPushOperation('unbind_request', requestId, {
          userId,
          groupId: chatId,
          groupName: chatTitle
        });
        
        // 解绑群组推送
        await this.unbindGroupPush(ctx, userId.toString(), chatId.toString());
      } else {
        // 默认为绑定操作（bind 或无参数）
        await this.bindGroupPush(ctx, userId.toString(), chatId.toString(), chatTitle);
      }

    } catch (error) {
      // 记录错误
      this.logGroupPushOperation('error', requestId, {
        userId,
        groupId: chatId,
        groupName: chatTitle,
        error: (error as Error).message
      });

      await ctx.reply(
        '❌ 群组推送设置失败\n\n' +
        '请稍后重试，如果问题持续存在，请联系管理员',
        { parse_mode: 'HTML' }
      );
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
   * Bind group push
   */
  private async bindGroupPush(ctx: ExtendedContext, userId: string, groupId: string, groupName: string): Promise<void> {
    const requestId = ctx.requestId || 'unknown';

    try {
      // 记录开始绑定
      this.logGroupPushOperation('api_call', requestId, {
        userId,
        groupId,
        groupName,
        action: 'bind'
      });

      // 获取用户访问令牌
      const accessToken = await getUserAccessToken(userId, {
        username: ctx.from?.username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // 调用推送服务绑定群组
      await pushService.bindGroupPush(userId, accessToken, groupId, groupName);

      // 发送成功消息
      await ctx.reply(
        '✅ <b>群组推送绑定成功</b>\n\n' +
        `📢 群组：<code>${groupName}</code>\n` +
        `👤 群主：@${ctx.from?.username || ctx.from?.first_name || '未知'}\n\n` +
        '🔔 后续推送将根据群主的个人推送设置发送到本群\n' +
        '⚙️ 群主可通过私聊机器人使用 /push 命令调整推送设置\n\n' +
        '💡 使用 <code>/push unbind</code> 可以解除群组推送绑定',
        { parse_mode: 'HTML' }
      );

      // 记录成功绑定
      this.logGroupPushOperation('success', requestId, {
        userId,
        groupId,
        groupName,
        action: 'bind'
      });

    } catch (error) {
      // 记录绑定失败
      this.logGroupPushOperation('error', requestId, {
        userId,
        groupId,
        groupName,
        action: 'bind',
        error: (error as Error).message
      });

      // 根据错误类型提供不同提示
      let errorMessage = '❌ 群组推送绑定失败\n\n';
      
      if ((error as Error).message.includes('token')) {
        errorMessage += '🔐 用户认证失败，请先私聊机器人发送 /start 进行初始化\n\n';
      } else if ((error as Error).message.includes('403')) {
        errorMessage += '🚫 权限不足，请确认您已完成用户初始化\n\n';
      } else {
        errorMessage += '⚠️ 系统暂时繁忙，请稍后重试\n\n';
      }
      
      errorMessage += '💡 如需帮助，请联系管理员';

      await ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }
  }

  /**
   * Unbind group push
   */
  private async unbindGroupPush(ctx: ExtendedContext, userId: string, groupId: string): Promise<void> {
    const requestId = ctx.requestId || 'unknown';
    const groupName = (ctx.chat && 'title' in ctx.chat) ? ctx.chat.title || '未知群组' : '未知群组';

    try {
      // 记录开始解绑
      this.logGroupPushOperation('api_call', requestId, {
        userId,
        groupId,
        groupName,
        action: 'unbind'
      });

      // 获取用户访问令牌
      const accessToken = await getUserAccessToken(userId, {
        username: ctx.from?.username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // 调用推送服务解绑群组
      await pushService.unbindGroupPush(userId, accessToken, groupId);

      // 发送成功消息
      await ctx.reply(
        '✅ <b>群组推送解绑成功</b>\n\n' +
        `📢 群组：<code>${groupName}</code>\n` +
        `👤 群主：@${ctx.from?.username || ctx.from?.first_name || '未知'}\n\n` +
        '🔕 本群将不再接收推送通知\n\n' +
        '💡 使用 <code>/push</code> 可以重新绑定群组推送',
        { parse_mode: 'HTML' }
      );

      // 记录成功解绑
      this.logGroupPushOperation('success', requestId, {
        userId,
        groupId,
        groupName,
        action: 'unbind'
      });

    } catch (error) {
      // 记录解绑失败
      this.logGroupPushOperation('error', requestId, {
        userId,
        groupId,
        groupName,
        action: 'unbind',
        error: (error as Error).message
      });

      await ctx.reply(
        '❌ 群组推送解绑失败\n\n' +
        '请稍后重试，如果问题持续存在，请联系管理员',
        { parse_mode: 'HTML' }
      );
    }
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
      const keyboard = this.createPushSettingsKeyboard(settings);

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
      const keyboard = this.createPushSettingsKeyboard(defaultSettings);

      await ctx.reply(
        `📢 <b>Active Push Notifications</b>\n\n❌ Unable to get your push settings temporarily, showing default status\n\n${message}`,
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

    let message = `📢 <b>Active Push Settings</b>\n\n` +
                  `🚨 Flash News: ${flashStatus}\n` +
                  `🐋 Whale Movements: ${whaleStatus}\n` +
                  `💰 Fund Flows: ${fundStatus}\n\n`;

    // Show push content status
    if (pushData && this.hasValidPushContent(pushData)) {
      message += `<b>📈 Latest Push Content</b>\n\n`;

      // Show flash news
      if (pushData.flash_news && pushData.flash_news.length > 0) {
        const latestFlash = pushData.flash_news[0];
        message += `🚨 <b>Flash News</b>\n${latestFlash.title}\n⏰ ${this.formatTimestamp(latestFlash.timestamp)}\n\n`;
      }

      // Show whale movements
      if (pushData.whale_actions && pushData.whale_actions.length > 0) {
        const latestWhale = pushData.whale_actions[0];
        message += `🐋 <b>Whale Movements</b>\nAddress: ${latestWhale.address}\nAction: ${latestWhale.action} ${latestWhale.amount}\n⏰ ${this.formatTimestamp(latestWhale.timestamp)}\n\n`;
      }

      // Show fund flows
      if (pushData.fund_flows && pushData.fund_flows.length > 0) {
        const latestFund = pushData.fund_flows[0];
        message += `💰 <b>Fund Flows</b>\nFrom: ${latestFund.from} → To: ${latestFund.to}\nAmount: ${latestFund.amount}\n⏰ ${this.formatTimestamp(latestFund.timestamp)}\n\n`;
      }
    } else {
      message += `<b>📋 Push Status</b>\n\n`;
      message += `📭 <i>No latest push content available</i>\n\n`;
    }

    message += `Click the buttons below to manage push settings:`;
    
    return message;
  }

  /**
   * Create push settings keyboard
   */
  private createPushSettingsKeyboard(settings: PushSettings): any[][] {
    return [
      [
        {
          text: settings.flash_enabled ? '🚨 Flash News [Turn Off]' : '🚨 Flash News [Turn On]',
          callback_data: `push_toggle_flash_${!settings.flash_enabled}`
        }
      ],
      [
        {
          text: settings.whale_enabled ? '🐋 Whale Movements [Turn Off]' : '🐋 Whale Movements [Turn On]',
          callback_data: `push_toggle_whale_${!settings.whale_enabled}`
        }
      ],
      [
        {
          text: settings.fund_enabled ? '💰 Fund Flows [Turn Off]' : '💰 Fund Flows [Turn On]',
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
      logger.info(`Push callback received [${requestId}]`, {
        userId,
        callbackData,
        requestId
      });

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
        
        // Update user settings
        await this.updateUserPushSetting(userIdString, type, enabled);

        // Get updated settings
        const { settings: updatedSettings, pushData } = await this.getUserPushSettings(userIdString);

        // Update message
        const message = this.formatPushSettingsMessage(updatedSettings, pushData);
        const keyboard = this.createPushSettingsKeyboard(updatedSettings);

        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: keyboard
          }
        });

        // Give user feedback
        const typeName = this.getTypeName(type);
        const statusText = enabled ? 'enabled' : 'disabled';
        await ctx.answerCbQuery(`✅ ${typeName} push notifications ${statusText}`);

        const duration = Date.now() - startTime;
        logger.info(`Push callback completed [${requestId}] - ${duration}ms`, {
          userId,
          type,
          enabled,
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
   * Check if there is valid push content
   */
  private hasValidPushContent(pushData: PushData): boolean {
    if (!pushData) return false;
    
    const hasFlashNews = pushData.flash_news && pushData.flash_news.length > 0;
    const hasWhaleActions = pushData.whale_actions && pushData.whale_actions.length > 0;
    const hasFundFlows = pushData.fund_flows && pushData.fund_flows.length > 0;
    
    return !!(hasFlashNews || hasWhaleActions || hasFundFlows);
  }

  /**
   * Format timestamp
   */
  private formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMinutes / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMinutes < 1) {
        return 'Just now';
      } else if (diffMinutes < 60) {
        return `${diffMinutes} minutes ago`;
      } else if (diffHours < 24) {
        return `${diffHours} hours ago`;
      } else if (diffDays < 7) {
        return `${diffDays} days ago`;
      } else {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    } catch (error) {
      logger.warn('Failed to format timestamp', { timestamp, error: (error as Error).message });
      return timestamp;
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
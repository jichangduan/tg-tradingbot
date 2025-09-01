import { Context } from 'telegraf';
import { ExtendedContext } from '../index';
import { logger } from '../../utils/logger';
import { messageFormatter } from '../utils/message.formatter';
import { pushService, PushSettings, PushData } from '../../services/push.service';
import { ApiError } from '../../services/api.service';
import { getUserToken } from '../../utils/auth';

/**
 * Push命令处理器
 * 处理 /push 命令，管理用户的推送设置（快讯、鲸鱼动向、资金流向）
 */
export class PushHandler {
  /**
   * 处理 /push 命令
   * @param ctx Telegram上下文
   * @param args 命令参数数组
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('push', userId!, username, args);

      // 显示推送设置界面
      await this.showPushSettings(ctx);

      const duration = Date.now() - startTime;
      logger.info(`Push command completed [${requestId}] - ${duration}ms`, {
        userId,
        username,
        duration,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Push command failed [${requestId}] - ${duration}ms`, {
        error: (error as Error).message,
        userId,
        username,
        requestId
      });

      await this.handleError(ctx, error as Error);
    }
  }

  /**
   * 显示推送设置界面
   */
  private async showPushSettings(ctx: ExtendedContext): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    try {
      // 获取用户当前的推送设置和推送数据
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

      // 显示默认的错误状态
      const defaultSettings: PushSettings = {
        flash_enabled: false,
        whale_enabled: false,
        fund_enabled: false
      };

      const message = this.formatPushSettingsMessage(defaultSettings);
      const keyboard = this.createPushSettingsKeyboard(defaultSettings);

      await ctx.reply(
        `📢 <b>主动推送</b>\n\n❌ 暂时无法获取您的推送设置，显示默认状态\n\n${message}`,
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
   * 获取用户推送设置
   */
  private async getUserPushSettings(userId: string): Promise<{
    settings: PushSettings;
    pushData?: PushData;
  }> {
    try {
      // 获取用户的访问令牌
      const accessToken = await getUserToken(userId);
      if (!accessToken) {
        throw new Error('用户未认证，无法获取推送设置');
      }

      // 调用推送服务获取设置和数据
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
      
      // 如果是API错误，重新抛出以便上层处理
      if (error instanceof ApiError) {
        throw error;
      }
      
      // 其他错误也重新抛出
      throw new Error('获取推送设置失败: ' + (error as Error).message);
    }
  }

  /**
   * 格式化推送设置消息
   */
  private formatPushSettingsMessage(settings: PushSettings, pushData?: PushData): string {
    const flashStatus = settings.flash_enabled ? '✅ 开启' : '❌ 关闭';
    const whaleStatus = settings.whale_enabled ? '✅ 开启' : '❌ 关闭';
    const fundStatus = settings.fund_enabled ? '✅ 开启' : '❌ 关闭';

    let message = `📢 <b>主动推送设置</b>\n\n` +
                  `🚨 快讯推送: ${flashStatus}\n` +
                  `🐋 鲸鱼动向: ${whaleStatus}\n` +
                  `💰 资金流向: ${fundStatus}\n\n`;

    // 如果有推送数据，显示最新的推送内容
    if (pushData) {
      message += `<b>📈 最新推送内容</b>\n\n`;

      // 显示快讯
      if (pushData.flash_news && pushData.flash_news.length > 0) {
        const latestFlash = pushData.flash_news[0];
        message += `🚨 <b>快讯</b>\n${latestFlash.title}\n⏰ ${this.formatTimestamp(latestFlash.timestamp)}\n\n`;
      }

      // 显示鲸鱼动向
      if (pushData.whale_actions && pushData.whale_actions.length > 0) {
        const latestWhale = pushData.whale_actions[0];
        message += `🐋 <b>鲸鱼动向</b>\n地址: ${latestWhale.address}\n操作: ${latestWhale.action} ${latestWhale.amount}\n⏰ ${this.formatTimestamp(latestWhale.timestamp)}\n\n`;
      }

      // 显示资金流向
      if (pushData.fund_flows && pushData.fund_flows.length > 0) {
        const latestFund = pushData.fund_flows[0];
        message += `💰 <b>资金流向</b>\n从: ${latestFund.from} → 到: ${latestFund.to}\n金额: ${latestFund.amount}\n⏰ ${this.formatTimestamp(latestFund.timestamp)}\n\n`;
      }
    }

    message += `点击下方按钮管理推送设置:`;
    
    return message;
  }

  /**
   * 创建推送设置键盘
   */
  private createPushSettingsKeyboard(settings: PushSettings): any[][] {
    return [
      [
        {
          text: settings.flash_enabled ? '🚨 快讯 [关闭]' : '🚨 快讯 [开启]',
          callback_data: `push_toggle_flash_${!settings.flash_enabled}`
        }
      ],
      [
        {
          text: settings.whale_enabled ? '🐋 鲸鱼动向 [关闭]' : '🐋 鲸鱼动向 [开启]',
          callback_data: `push_toggle_whale_${!settings.whale_enabled}`
        }
      ],
      [
        {
          text: settings.fund_enabled ? '💰 资金流向 [关闭]' : '💰 资金流向 [开启]',
          callback_data: `push_toggle_fund_${!settings.fund_enabled}`
        }
      ]
    ];
  }

  /**
   * 处理按钮回调
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
        await ctx.answerCbQuery('用户信息无效');
        return;
      }

      // 解析回调数据
      const [action, type, value] = callbackData.split('_').slice(1); // 移除 'push' 前缀
      if (action !== 'toggle') {
        await ctx.answerCbQuery('无效的操作');
        return;
      }

      const enabled = value === 'true';
      
      // 更新用户设置
      await this.updateUserPushSetting(userIdString, type, enabled);

      // 获取更新后的设置
      const { settings: updatedSettings, pushData } = await this.getUserPushSettings(userIdString);

      // 更新消息
      const message = this.formatPushSettingsMessage(updatedSettings, pushData);
      const keyboard = this.createPushSettingsKeyboard(updatedSettings);

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });

      // 反馈用户
      const typeName = this.getTypeName(type);
      const statusText = enabled ? '开启' : '关闭';
      await ctx.answerCbQuery(`✅ ${typeName}推送已${statusText}`);

      const duration = Date.now() - startTime;
      logger.info(`Push callback completed [${requestId}] - ${duration}ms`, {
        userId,
        type,
        enabled,
        duration,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Push callback failed [${requestId}] - ${duration}ms`, {
        error: (error as Error).message,
        userId,
        callbackData,
        requestId
      });

      await ctx.answerCbQuery('操作失败，请稍后重试');
    }
  }

  /**
   * 更新用户推送设置
   */
  private async updateUserPushSetting(userId: string, type: string, enabled: boolean): Promise<void> {
    try {
      // 获取用户的访问令牌
      const accessToken = await getUserToken(userId);
      if (!accessToken) {
        throw new Error('用户未认证，无法更新推送设置');
      }

      // 构造更新请求
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
          throw new Error(`无效的推送类型: ${type}`);
      }

      // 调用推送服务更新设置
      await pushService.updateUserPushSettings(userId, accessToken, updateRequest);

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
      
      // 重新抛出错误以便上层处理
      throw error;
    }
  }

  /**
   * 获取类型名称
   */
  private getTypeName(type: string): string {
    switch (type) {
      case 'flash': return '快讯';
      case 'whale': return '鲸鱼动向';
      case 'fund': return '资金流向';
      default: return '未知';
    }
  }

  /**
   * 格式化时间戳
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
        return '刚刚';
      } else if (diffMinutes < 60) {
        return `${diffMinutes}分钟前`;
      } else if (diffHours < 24) {
        return `${diffHours}小时前`;
      } else if (diffDays < 7) {
        return `${diffDays}天前`;
      } else {
        return date.toLocaleDateString('zh-CN', {
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
   * 错误处理
   */
  private async handleError(ctx: ExtendedContext, error: Error): Promise<void> {
    const errorMessage = '❌ 推送设置操作失败，请稍后重试\n\n' +
                        '如果问题持续存在，请联系技术支持';

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
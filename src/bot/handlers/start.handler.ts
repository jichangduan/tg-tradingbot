import { Context } from 'telegraf';
import { userService } from '../../services/user.service';
import { messageFormatter } from '../utils/message.formatter';
import { logger } from '../../utils/logger';
import { DetailedError } from '../../types/api.types';
import { ExtendedContext } from '../index';
import { UserInitRequest, UserInitData } from '../../types/api.types';
import { cacheService } from '../../services/cache.service';

/**
 * Start命令处理器
 * 处理 /start 命令的完整流程，包括用户初始化、邀请码解析等
 */
export class StartHandler {
  /**
   * 处理 /start 命令
   * @param ctx Telegram上下文
   * @param args 命令参数数组（可能包含邀请码）
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('start', userId!, username, args);

      // 1. 发送欢迎消息（立即响应用户）
      const welcomeMessage = await ctx.reply(
        this.getWelcomeMessage(),
        { parse_mode: 'HTML' }
      );

      // 2. 后台进行用户初始化
      await this.initializeUserInBackground(ctx, args, requestId);

      const duration = Date.now() - startTime;
      logger.info(`Start command completed [${requestId}] - ${duration}ms`, {
        userId,
        username,
        duration,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Start command failed [${requestId}] - ${duration}ms`, {
        error: (error as Error).message,
        stack: (error as Error).stack,
        duration,
        userId,
        username,
        args,
        requestId
      });

      // 发送错误消息
      await this.sendErrorMessage(ctx, error as Error);
    }
  }

  /**
   * 后台初始化用户（不阻塞用户体验）
   */
  private async initializeUserInBackground(
    ctx: ExtendedContext, 
    args: string[], 
    requestId: string
  ): Promise<void> {
    try {
      const user = ctx.from;
      if (!user) {
        logger.warn('No user information available in context', { requestId });
        return;
      }

      // 解析邀请码
      const invitationCode = this.parseInvitationCodeFromArgs(args);

      // 构建用户初始化请求
      const initRequest: UserInitRequest = {
        telegram_id: user.id.toString(),
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        invitation_code: invitationCode
      };

      logger.info(`Starting user initialization [${requestId}]`, {
        telegramId: initRequest.telegram_id,
        username: initRequest.username,
        hasInvitationCode: !!invitationCode,
        requestId
      });

      // 调用用户服务初始化
      const userData = await userService.initializeUser(initRequest);

      // 缓存用户的accessToken
      await this.cacheUserAccessToken(user.id, userData.accessToken, requestId);

      // 发送初始化完成消息
      await this.sendInitializationSuccessMessage(ctx, userData);

      logger.info(`User initialization completed [${requestId}]`, {
        userId: userData.userId,
        walletAddress: userData.walletAddress,
        isNewUser: userData.isNewUser,
        tokenCached: true,
        requestId
      });

    } catch (error) {
      logger.error(`Background user initialization failed [${requestId}]`, {
        error: (error as Error).message,
        requestId
      });

      // 发送初始化失败消息（友好提示）
      await this.sendInitializationErrorMessage(ctx, error as DetailedError);
    }
  }

  /**
   * 从命令参数中解析邀请码
   */
  private parseInvitationCodeFromArgs(args: string[]): string | undefined {
    if (args.length === 0) {
      return undefined;
    }

    // 取第一个参数作为潜在的邀请码
    const potentialCode = args[0];
    return userService.parseInvitationCode(potentialCode);
  }

  /**
   * 获取欢迎消息
   */
  private getWelcomeMessage(): string {
    return `
🎉 <b>欢迎使用 AIW3 TGBot!</b>

正在为您初始化账户，请稍候...

<b>🚀 主要功能:</b>
• 💰 实时价格查询
• 📊 24小时涨跌数据  
• 💹 交易量和市值
• ⚡ 智能缓存优化
• 🎁 邀请奖励系统

<b>📝 常用命令:</b>
<code>/price BTC</code> - 查询比特币价格
<code>/markets</code> - 查看市场行情
<code>/help</code> - 查看帮助信息

<i>💡 正在为您创建专属钱包地址...</i>
    `.trim();
  }

  /**
   * 发送用户初始化成功消息
   */
  private async sendInitializationSuccessMessage(
    ctx: Context, 
    userData: UserInitData
  ): Promise<void> {
    const message = messageFormatter.formatUserInitSuccessMessage(userData);
    
    try {
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Failed to send initialization success message', {
        error: (error as Error).message,
        userId: userData.userId
      });
    }
  }

  /**
   * 发送用户初始化错误消息
   */
  private async sendInitializationErrorMessage(
    ctx: Context, 
    error: DetailedError
  ): Promise<void> {
    const message = messageFormatter.formatUserInitErrorMessage(error);
    
    try {
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (sendError) {
      logger.error('Failed to send initialization error message', {
        error: (sendError as Error).message,
        originalError: error.message
      });
    }
  }

  /**
   * 发送通用错误消息
   */
  private async sendErrorMessage(ctx: Context, error: Error): Promise<void> {
    const errorMessage = 
      '❌ <b>系统错误</b>\n\n' +
      '很抱歉，处理您的请求时出现了意外错误。\n\n' +
      '💡 <b>您可以尝试:</b>\n' +
      '• 稍后重试 /start 命令\n' +
      '• 查看帮助信息 /help\n' +
      '• 直接开始使用 /price BTC\n\n' +
      '<i>如果问题持续存在，请联系管理员</i>';

    try {
      await ctx.reply(errorMessage, { parse_mode: 'HTML' });
    } catch (sendError) {
      logger.error('Failed to send error message', {
        originalError: error.message,
        sendError: (sendError as Error).message
      });
    }
  }

  /**
   * 处理带参数的start命令（邀请链接）
   * 例如: /start invite_ABC123
   */
  public async handleWithInvitation(
    ctx: ExtendedContext, 
    invitationCode: string
  ): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.info(`Start command with invitation [${requestId}]`, {
        userId,
        username,
        invitationCode,
        requestId
      });

      // 发送特殊的邀请欢迎消息
      const inviteMessage = this.getInvitationWelcomeMessage(invitationCode);
      await ctx.reply(inviteMessage, { parse_mode: 'HTML' });

      // 使用邀请码进行用户初始化
      await this.initializeUserInBackground(ctx, [invitationCode], requestId);

      const duration = Date.now() - startTime;
      logger.info(`Start with invitation completed [${requestId}] - ${duration}ms`, {
        userId,
        invitationCode,
        duration,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Start with invitation failed [${requestId}] - ${duration}ms`, {
        error: (error as Error).message,
        userId,
        invitationCode,
        duration,
        requestId
      });

      await this.sendErrorMessage(ctx, error as Error);
    }
  }

  /**
   * 获取邀请链接的欢迎消息
   */
  private getInvitationWelcomeMessage(invitationCode: string): string {
    return `
🎁 <b>欢迎通过邀请链接加入 AIW3 TGBot!</b>

邀请码: <code>${invitationCode}</code>

正在为您初始化账户并处理邀请奖励...

<b>🎉 邀请福利:</b>
• 💰 额外能量奖励
• 🚀 优先功能体验
• 💎 专属用户标识

<b>📝 快速开始:</b>
<code>/price BTC</code> - 查询价格
<code>/help</code> - 查看更多功能

<i>💡 正在为您创建专属钱包并处理邀请奖励...</i>
    `.trim();
  }

  /**
   * 缓存用户的accessToken到Redis
   */
  private async cacheUserAccessToken(
    telegramId: number,
    accessToken: string,
    requestId: string
  ): Promise<void> {
    try {
      const tokenKey = `user:token:${telegramId}`;
      const tokenTTL = 24 * 60 * 60; // 24小时过期
      
      const result = await cacheService.set(tokenKey, accessToken, tokenTTL);
      
      if (result.success) {
        logger.info(`AccessToken cached successfully [${requestId}]`, {
          telegramId,
          tokenKey,
          expiresIn: tokenTTL,
          requestId
        });
      } else {
        logger.warn(`Failed to cache accessToken [${requestId}]`, {
          telegramId,
          tokenKey,
          error: result.error,
          requestId
        });
      }
    } catch (error) {
      logger.error(`Error caching accessToken [${requestId}]`, {
        telegramId,
        error: (error as Error).message,
        requestId
      });
    }
  }

  /**
   * 获取处理器统计信息
   */
  public getStats(): any {
    return {
      name: 'StartHandler',
      version: '1.0.0',
      supportedCommands: ['/start'],
      features: [
        'User initialization',
        'Invitation code processing',
        'Automatic wallet creation',
        'Background processing',
        'AccessToken caching',
        'Comprehensive error handling'
      ]
    };
  }
}

// 导出单例实例
export const startHandler = new StartHandler();

// 默认导出
export default startHandler;
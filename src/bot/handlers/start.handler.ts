import { Context, Markup } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { userService } from '../../services/user.service';
import { messageFormatter } from '../utils/message.formatter';
import { logger } from '../../utils/logger';
import { DetailedError } from '../../types/api.types';
import { ExtendedContext } from '../index';
import { UserInitRequest, UserInitData } from '../../types/api.types';
import { cacheService } from '../../services/cache.service';
import { config } from '../../config';

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
    const chatType = ctx.chat?.type;

    try {
      logger.logCommand('start', userId!, username, args);

      // 检查是否为群组启动场景（通过startgroup参数识别）
      const isGroupStart = args.length > 0 && args[0] === 'welcome' && chatType !== 'private';
      
      if (isGroupStart) {
        // 处理群组启动场景
        await this.handleGroupStart(ctx, args);
        return;
      }

      // 1. 发送欢迎消息（立即响应用户）
      // 检查是否为私聊，只在私聊中显示"添加到群组"按钮
      const isPrivateChat = ctx.chat?.type === 'private';
      
      const welcomeMessage = await ctx.reply(
        this.getWelcomeMessage(),
        {
          parse_mode: 'HTML',
          reply_markup: isPrivateChat ? this.createAddToGroupKeyboard() : undefined
        }
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
🎉 <b>Welcome to AIW3 Trading Bot!</b>

Initializing your account, please wait...

<b>🚀 Main Features:</b>
• 💰 Real-time price queries
• 📊 24-hour price change data  
• 💹 Trading volume and market cap
• 📈 Trade execution (/long, /short)
• 💼 Wallet management (/wallet)
• 🎁 Referral reward system

<b>📝 Common Commands:</b>
<code>/price BTC</code> - Check Bitcoin price
<code>/long ETH 10</code> - Long Ethereum
<code>/markets</code> - View market overview
<code>/wallet</code> - View wallet info

<b>🤖 Bot ID:</b> @yuze_trading_bot

<i>💡 Creating your exclusive wallet address...</i>
    `.trim();
  }

  /**
   * 创建添加到群组的内联键盘
   */
  private createAddToGroupKeyboard(): InlineKeyboardMarkup {
    const botUsername = config.telegram.botUsername || 'yuze_trading_bot';
    
    return {
      inline_keyboard: [
        [
          {
            text: '🤖 添加到群组',
            url: `tg://resolve?domain=${botUsername}&startgroup=welcome`
          }
        ],
        [
          {
            text: '⚠️ 使用说明',
            callback_data: 'group_usage_guide'
          }
        ]
      ]
    };
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
   * Get invitation link welcome message
   */
  private getInvitationWelcomeMessage(invitationCode: string): string {
    return `
🎁 <b>Welcome to AIW3 TGBot via invitation link!</b>

Invitation code: <code>${invitationCode}</code>

Initializing your account and processing invitation rewards...

<b>🎉 Invitation Benefits:</b>
• 💰 Extra energy rewards
• 🚀 Priority feature access
• 💎 Exclusive user badge

<b>📝 Quick Start:</b>
<code>/price BTC</code> - Check prices
<code>/help</code> - View more features

<i>💡 Creating your exclusive wallet and processing invitation rewards...</i>
    `.trim();
  }

  /**
   * Get group welcome message
   */
  private getGroupWelcomeMessage(): string {
    return `
👋 <b>AIW3 Trading Bot added to group!</b>

🤖 I'm @yuze_trading_bot, your professional crypto trading assistant

<b>🚀 Core Features:</b>
• 💰 Real-time price queries - <code>/price BTC</code>
• 📈 Trade execution - <code>/long ETH 10</code> | <code>/short BTC 5</code>
• 💼 Wallet management - <code>/wallet</code> | <code>/positions</code>
• 📊 Market data - <code>/markets</code>
• 📈 Chart analysis - <code>/chart BTC</code>
• 💹 Order management - <code>/orders</code>

<b>⚠️ Important Notes:</b>
• This is <b>AIW3 Trading Bot</b>, not a management tool
• Supports real trading functions, use with caution
• All trades require wallet initialization and funding

<b>📝 Quick Start:</b>
1. <code>/start</code> - Initialize your trading account
2. <code>/price BTC</code> - Check Bitcoin price  
3. <code>/wallet</code> - View wallet status
4. <code>/help</code> - Get complete command list

<b>🤖 Bot Identity Confirmed:</b> @yuze_trading_bot

<i>🎉 Start your crypto trading journey!</i>
    `.trim();
  }

  /**
   * 处理群组启动场景
   */
  public async handleGroupStart(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const chatType = ctx.chat?.type;
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.info(`Group start command [${requestId}]`, {
        userId,
        username,
        chatType,
        args,
        requestId
      });

      // 发送群组欢迎消息
      await ctx.reply(
        this.getGroupWelcomeMessage(),
        { parse_mode: 'HTML' }
      );

      // 后台初始化用户（如果需要）
      if (userId) {
        await this.initializeUserInBackground(ctx, [], requestId);
      }

      const duration = Date.now() - startTime;
      logger.info(`Group start completed [${requestId}] - ${duration}ms`, {
        userId,
        username,
        chatType,
        duration,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Group start failed [${requestId}] - ${duration}ms`, {
        error: (error as Error).message,
        stack: (error as Error).stack,
        duration,
        userId,
        username,
        chatType,
        args,
        requestId
      });

      // Send error message
      await ctx.reply(
        '❌ Group initialization failed\n\n' +
        'Please try again later or contact administrator.',
        { parse_mode: 'HTML' }
      );
    }
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
   * 处理群组使用说明回调
   */
  public async handleGroupUsageGuide(ctx: any): Promise<void> {
    try {
      const guideMessage = `
📖 <b>Group Addition Usage Guide</b>

<b>⚠️ Important Reminder:</b>
Please ensure you're adding the correct trading bot:

<b>✅ Correct Bot:</b>
• Username: @yuze_trading_bot
• Name: Test_Trading_Bot  
• Function: Cryptocurrency trading and price queries

<b>❌ If a settings interface bot appears in the group, it means wrong bot was added</b>

<b>🔧 Correct Addition Steps:</b>
1. Click "🤖 Add to Group" button below
2. Select target group
3. Confirm bot username is @yuze_trading_bot
4. After successful addition, bot will automatically send welcome message

<b>🎯 Verification Method:</b>
After adding, send <code>/price BTC</code> in the group
If it can query prices normally, addition was successful

<b>🔄 If Added Wrong Bot:</b>
1. Remove current Bot
2. Re-click "Add to Group" button
3. Confirm bot info before adding

<b>📞 Need Help?</b>
Please contact administrator or restart with /start
      `.trim();

      await ctx.answerCbQuery();
      await ctx.reply(guideMessage, { parse_mode: 'HTML' });
      
    } catch (error) {
      logger.error('Group usage guide failed', {
        error: (error as Error).message,
        userId: ctx.from?.id
      });
      await ctx.answerCbQuery('❌ Failed to get guide');
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
        'Group usage guidance',
        'Comprehensive error handling'
      ]
    };
  }
}

// 导出单例实例
export const startHandler = new StartHandler();

// 默认导出
export default startHandler;
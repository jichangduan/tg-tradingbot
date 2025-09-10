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
🎉 <b>欢迎使用 AIW3 交易机器人!</b>

正在为您初始化账户，请稍候...

<b>🚀 主要功能:</b>
• 💰 实时价格查询
• 📊 24小时涨跌数据  
• 💹 交易量和市值
• 📈 交易执行 (/long, /short)
• 💼 钱包管理 (/wallet)
• 🎁 邀请奖励系统

<b>📝 常用命令:</b>
<code>/price BTC</code> - 查询比特币价格
<code>/long ETH 10</code> - 做多以太坊
<code>/markets</code> - 查看市场行情
<code>/wallet</code> - 查看钱包信息

<b>🤖 Bot标识:</b> @yuze_trading_bot

<i>💡 正在为您创建专属钱包地址...</i>
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
   * 获取群组欢迎消息
   */
  private getGroupWelcomeMessage(): string {
    return `
👋 <b>AIW3 交易机器人已添加到群组！</b>

🤖 我是 @yuze_trading_bot，专业的加密货币交易助手

<b>🚀 核心功能:</b>
• 💰 实时价格查询 - <code>/price BTC</code>
• 📈 交易执行 - <code>/long ETH 10</code> | <code>/short BTC 5</code>
• 💼 钱包管理 - <code>/wallet</code> | <code>/positions</code>
• 📊 市场数据 - <code>/markets</code>
• 📈 图表分析 - <code>/chart BTC</code>
• 💹 订单管理 - <code>/orders</code>

<b>⚠️ 重要说明:</b>
• 这是 <b>AIW3 交易机器人</b>，不是管理工具
• 支持真实交易功能，请谨慎使用
• 所有交易需要钱包初始化和资金充值

<b>📝 快速开始:</b>
1. <code>/start</code> - 初始化您的交易账户
2. <code>/price BTC</code> - 查询比特币价格  
3. <code>/wallet</code> - 查看钱包状态
4. <code>/help</code> - 获取完整命令列表

<b>🤖 Bot标识确认:</b> @yuze_trading_bot

<i>🎉 开始您的加密货币交易之旅！</i>
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

      // 发送错误消息
      await ctx.reply(
        '❌ 群组初始化失败\n\n' +
        '请稍后重试或联系管理员。',
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
📖 <b>群组添加使用说明</b>

<b>⚠️ 重要提醒：</b>
请确保您添加的是正确的交易机器人：

<b>✅ 正确的Bot:</b>
• 用户名: @yuze_trading_bot
• 名称: Test_Trading_Bot  
• 功能: 加密货币交易和价格查询

<b>❌ 如果群组中出现设置界面的Bot，说明添加错误</b>

<b>🔧 正确添加步骤:</b>
1. 点击下方"🤖 添加到群组"按钮
2. 选择目标群组
3. 确认Bot用户名为 @yuze_trading_bot
4. 添加成功后，bot会自动发送欢迎消息

<b>🎯 验证方法:</b>
添加后在群组中发送 <code>/price BTC</code>
如果能正常查询价格，说明添加成功

<b>🔄 如果添加错误：</b>
1. 移除当前Bot
2. 重新点击"添加到群组"按钮
3. 确认Bot信息后再添加

<b>📞 需要帮助？</b>
请联系管理员或重新开始 /start
      `.trim();

      await ctx.answerCbQuery();
      await ctx.reply(guideMessage, { parse_mode: 'HTML' });
      
    } catch (error) {
      logger.error('Group usage guide failed', {
        error: (error as Error).message,
        userId: ctx.from?.id
      });
      await ctx.answerCbQuery('❌ 获取说明失败');
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
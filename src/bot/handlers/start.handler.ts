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
 * Start command handler
 * Handles complete /start command flow, including user initialization and invitation code parsing
 */
export class StartHandler {
  /**
   * Handle /start command
   * @param ctx Telegram context
   * @param args Command parameter array (may contain invitation code)
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';
    const chatType = ctx.chat?.type;

    try {
      logger.logCommand('start', userId!, username, args);

      // Check if it's a group redirect command
      if (args.length > 0 && args[0].startsWith('cmd_')) {
        await this.handleGroupRedirectCommand(ctx, args[0]);
        return;
      }

      // Check if it's a group start scenario (identified by startgroup parameter)
      const isGroupStart = args.length > 0 && args[0] === 'welcome' && chatType !== 'private';
      
      if (isGroupStart) {
        // Handle group start scenario
        await this.handleGroupStart(ctx, args);
        return;
      }

      // 1. Send welcome message (immediate user response)
      // Check if it's private chat, only show "Add to Group" button in private chat
      const isPrivateChat = ctx.chat?.type === 'private';
      
      const welcomeMessage = await ctx.reply(
        await this.getWelcomeMessage(ctx),
        {
          parse_mode: 'HTML',
          reply_markup: isPrivateChat ? await this.createAddToGroupKeyboard(ctx) : undefined
        }
      );

      // 2. Perform user initialization in background
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

      // Send error message
      await this.sendErrorMessage(ctx, error as Error);
    }
  }

  /**
   * Initialize user in background (non-blocking user experience)
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

      // Parse invitation code
      const invitationCode = this.parseInvitationCodeFromArgs(args);

      // Build user initialization request
      const initRequest: UserInitRequest = {
        telegram_id: user.id.toString(),
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        invitation_code: invitationCode
      };

      logger.info(`🚀 Starting user initialization [${requestId}]`, {
        telegramId: initRequest.telegram_id,
        username: initRequest.username,
        hasInvitationCode: !!invitationCode,
        invitationCode: invitationCode || 'none',  // Show specific invitation code
        fullInitRequest: JSON.stringify(initRequest, null, 2),  // Complete request body
        requestId
      });

      // Call user service initialization
      const userData = await userService.initializeUser(initRequest);

      // Cache user's accessToken
      await this.cacheUserAccessToken(user.id, userData.accessToken, requestId);

      // Send initialization completion message
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

      // Send initialization failure message (friendly hint)
      await this.sendInitializationErrorMessage(ctx, error as DetailedError);
    }
  }

  /**
   * Parse invitation code from command parameters
   */
  private parseInvitationCodeFromArgs(args: string[]): string | undefined {
    logger.info('🔍 Parsing invitation code from /start args', {
      argsLength: args.length,
      args: args,
      firstArg: args[0] || 'none'
    });

    if (args.length === 0) {
      logger.info('❌ No args provided - no invitation code');
      return undefined;
    }

    // Take first parameter as potential invitation code
    const potentialCode = args[0];
    const parsedCode = userService.parseInvitationCode(potentialCode);
    
    logger.info('🎯 Invitation code parsing result', {
      originalArg: potentialCode,
      parsedCode: parsedCode,
      isValidCode: !!parsedCode
    });

    return parsedCode;
  }

  /**
   * Get welcome message (now supports multiple languages)
   */
  private async getWelcomeMessage(ctx: ExtendedContext): Promise<string> {
    const botUsername = config.telegram.botUsername || 'aiw3_tradebot';
    
    const title = await ctx.__!('welcome.title');
    const initializing = await ctx.__!('welcome.initializing');
    const features = await ctx.__!('welcome.features');
    const commands = await ctx.__!('welcome.commands');
    const botId = await ctx.__!('welcome.botId', { botUsername });
    const creating = await ctx.__!('welcome.creating');
    
    return `
${title}

${initializing}

<b>${features}</b>
• 💰 Real-time price queries
• 📊 24-hour price change data  
• 💹 Trading volume and market cap
• 📈 Trade execution (/long, /short)
• 💼 Wallet management (/wallet)
• 🎁 Referral reward system

<b>${commands}</b>
<code>/price BTC</code> - Check Bitcoin price
<code>/long ETH 10</code> - Long Ethereum
<code>/markets</code> - View market overview
<code>/wallet</code> - View wallet info

<b>${botId}</b>

<i>${creating}</i>
    `.trim();
  }

  /**
   * Create inline keyboard for adding to group (now supports multiple languages)
   */
  private async createAddToGroupKeyboard(ctx: ExtendedContext): Promise<InlineKeyboardMarkup> {
    const botUsername = config.telegram.botUsername || 'aiw3_tradebot';
    
    // For now, keep English button text for compatibility, but structure is ready for i18n
    return {
      inline_keyboard: [
        [
          {
            text: '🤖 Add to Group',
            url: `tg://resolve?domain=${botUsername}&startgroup=welcome`
          }
        ],
        [
          {
            text: '⚠️ Usage Guide',
            callback_data: 'group_usage_guide'
          }
        ]
      ]
    };
  }

  /**
   * Send user initialization success message
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
   * Send user initialization error message
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
   * Send general error message
   */
  private async sendErrorMessage(ctx: Context, error: Error): Promise<void> {
    const errorMessage = 
      '❌ <b>System Error</b>\n\n' +
      'Sorry, an unexpected error occurred while processing your request.\n\n' +
      '💡 <b>You can try:</b>\n' +
      '• Retry /start command later\n' +
      '• Check help information /help\n' +
      '• Start using directly /price BTC\n\n' +
      '<i>If the problem persists, please contact admin</i>';

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
   * Handle start command with parameters (invitation link)
   * Example: /start invite_ABC123
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

      // Send special invitation welcome message
      const inviteMessage = this.getInvitationWelcomeMessage(invitationCode);
      await ctx.reply(inviteMessage, { parse_mode: 'HTML' });

      // Use invitation code for user initialization
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

🤖 I'm @${config.telegram.botUsername || 'aiw3_tradebot'}, your professional crypto trading assistant

<b>🚀 Core Features:</b>
• 💰 Real-time price queries - <code>/price BTC</code>
• 📈 Trade execution - <code>/long ETH 10</code> | <code>/short BTC 5</code>
• 💼 Wallet management - <code>/wallet</code> | <code>/positions</code>
• 📊 Market data - <code>/markets</code>
• 📈 Chart analysis - <code>/chart BTC</code>

<b>⚠️ Important Notes:</b>
• This is <b>AIW3 Trading Bot</b>, not a management tool
• Supports real trading functions, use with caution
• All trades require wallet initialization and funding

<b>📝 Quick Start:</b>
1. <code>/start</code> - Initialize your trading account
2. <code>/price BTC</code> - Check Bitcoin price  
3. <code>/wallet</code> - View wallet status
4. <code>/help</code> - Get complete command list

<b>🤖 Bot Identity Confirmed:</b> @${config.telegram.botUsername || 'aiw3_tradebot'}

<i>🎉 Start your crypto trading journey!</i>
    `.trim();
  }

  /**
   * Handle group start scenario
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

      // Send group welcome message
      await ctx.reply(
        this.getGroupWelcomeMessage(),
        { parse_mode: 'HTML' }
      );

      // Initialize user in background (if needed)
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
   * Cache user's accessToken to Redis
   */
  private async cacheUserAccessToken(
    telegramId: number,
    accessToken: string,
    requestId: string
  ): Promise<void> {
    try {
      const tokenKey = `user:token:${telegramId}`;
      const tokenTTL = 24 * 60 * 60; // 24 hour expiration
      
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
   * Handle group usage guide callback
   */
  public async handleGroupUsageGuide(ctx: any): Promise<void> {
    try {
      const guideMessage = `
📖 <b>Group Addition Usage Guide</b>

<b>⚠️ Important Reminder:</b>
Please ensure you're adding the correct trading bot:

<b>✅ Correct Bot:</b>
• Username: @${config.telegram.botUsername || 'aiw3_tradebot'}
• Name: Test_Trading_Bot  
• Function: Cryptocurrency trading and price queries

<b>❌ If a settings interface bot appears in the group, it means wrong bot was added</b>

<b>🔧 Correct Addition Steps:</b>
1. Click "🤖 Add to Group" button below
2. Select target group
3. Confirm bot username is @${config.telegram.botUsername || 'aiw3_tradebot'}
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
   * Handle group redirect command
   */
  private async handleGroupRedirectCommand(ctx: ExtendedContext, encodedParam: string): Promise<void> {
    const requestId = ctx.requestId || 'unknown';
    const userId = ctx.from?.id;

    try {
      logger.info(`Processing group redirect command [${requestId}]`, {
        userId,
        encodedParam: encodedParam.substring(0, 20) + '...', // Truncated display
        requestId
      });

      // Decode command parameters
      const encodedCommand = encodedParam.substring(4); // Remove 'cmd_' prefix
      const decoded = Buffer.from(encodedCommand, 'base64').toString('utf-8');
      const commandData = JSON.parse(decoded);
      
      const { cmd: command, args: commandArgs } = commandData;
      
      logger.info(`Decoded group redirect command [${requestId}]`, {
        command,
        args: commandArgs,
        userId,
        requestId
      });

      // Route directly to corresponding handler, no confirmation message
      switch (command) {
        case '/start':
          // Avoid recursive calls, execute initialization logic directly
          const welcomeMessage = await this.getWelcomeMessage(ctx);
          await ctx.reply(welcomeMessage, { parse_mode: 'HTML' });
          await this.initializeUserInBackground(ctx, [], requestId);
          break;
        case '/long':
          try {
            const { longHandler } = await import('./long.handler');
            await longHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import long handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply('❌ Long trading feature temporarily unavailable');
          }
          break;
        case '/short':
          try {
            const { shortHandler } = await import('./short.handler');
            await shortHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import short handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply('❌ Short trading feature temporarily unavailable');
          }
          break;
        case '/close':
          try {
            const { closeHandler } = await import('./close.handler');
            await closeHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import close handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply('❌ Position closing feature temporarily unavailable');
          }
          break;
        case '/positions':
          try {
            const { positionsHandler } = await import('./positions.handler');
            await positionsHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import positions handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply('❌ Positions view feature temporarily unavailable');
          }
          break;
        case '/wallet':
          try {
            const { walletHandler } = await import('./wallet.handler');
            await walletHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import wallet handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply('❌ Wallet feature temporarily unavailable');
          }
          break;
        case '/pnl':
          try {
            const { pnlHandler } = await import('./pnl.handler');
            await pnlHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import pnl handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply('❌ PnL analysis feature temporarily unavailable');
          }
          break;
        case '/push':
          try {
            const { pushHandler } = await import('./push.handler');
            await pushHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import push handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply('❌ Push settings feature temporarily unavailable');
          }
          break;
        default:
          await ctx.reply(
            `❌ <b>Unsupported Command</b>\n\n` +
            `Command "${command}" is not supported for group redirect`,
            { parse_mode: 'HTML' }
          );
      }

    } catch (error) {
      logger.error(`Group redirect command failed [${requestId}]`, {
        error: (error as Error).message,
        encodedParam,
        userId,
        requestId
      });

      await ctx.reply(
        '❌ <b>Command Execution Failed</b>\n\n' +
        'Invalid command format from group redirect.\n' +
        'Please try again or use the command directly in private chat.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Get handler statistics
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
        'Group command redirect handling',
        'Comprehensive error handling'
      ]
    };
  }
}

// Export singleton instance
export const startHandler = new StartHandler();

// Default export
export default startHandler;
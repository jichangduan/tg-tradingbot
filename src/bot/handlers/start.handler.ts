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

      // 1. Initialize user first to get account information
      const userData = await this.initializeUser(ctx, args, requestId);
      
      // 2. Send welcome message with account information
      // Check if it's private chat, only show "Add to Group" button in private chat
      const isPrivateChat = ctx.chat?.type === 'private';
      
      const welcomeMessage = await ctx.reply(
        await this.getWelcomeMessage(ctx, userData),
        {
          parse_mode: 'HTML',
          reply_markup: isPrivateChat ? await this.createAddToGroupKeyboard(ctx) : undefined
        }
      );

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
   * Initialize user and return user data (synchronous)
   */
  private async initializeUser(
    ctx: ExtendedContext, 
    args: string[], 
    requestId: string
  ): Promise<UserInitData | null> {
    try {
      const user = ctx.from;
      if (!user) {
        logger.warn('No user information available in context', { requestId });
        return null;
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
        invitationCode: invitationCode || 'none',
        fullInitRequest: JSON.stringify(initRequest, null, 2),
        requestId
      });

      // Call user service initialization
      const userData = await userService.initializeUser(initRequest);

      // Cache user's accessToken
      await this.cacheUserAccessToken(user.id, userData.accessToken, requestId);

      logger.info(`User initialization completed [${requestId}]`, {
        userId: userData.userId,
        walletAddress: userData.walletAddress,
        isNewUser: userData.isNewUser,
        tokenCached: true,
        requestId
      });

      return userData;

    } catch (error) {
      logger.error(`User initialization failed [${requestId}]`, {
        error: (error as Error).message,
        requestId
      });
      return null;
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
   * Get welcome message (fixed content, supports multiple languages, includes account info)
   */
  private async getWelcomeMessage(ctx: ExtendedContext, userData?: UserInitData | null): Promise<string> {
    // Get fixed welcome content
    const title = await ctx.__!('welcome.fixed.title');
    
    let message = `🎉 <b>${title}</b>\n\n`;
    
    // Add account info if available
    if (userData) {
      const accountInfo = await ctx.__!('welcome.fixed.accountInfo');
      const userId = await ctx.__!('welcome.fixed.userId', { userId: userData.userId });
      const walletAddress = await ctx.__!('welcome.fixed.walletAddress', { walletAddress: userData.walletAddress });
      const referralCode = await ctx.__!('welcome.fixed.referralCode', { referralCode: userData.referralCode });
      
      message += `<b>${accountInfo}</b>\n`;
      message += `${userId}\n`;
      message += `${walletAddress}\n`;
      message += `${referralCode}\n\n`;
    }
    
    const quickStart = await ctx.__!('welcome.fixed.quickStart');
    const priceCommand = await ctx.__!('welcome.fixed.priceCommand');
    const marketsCommand = await ctx.__!('welcome.fixed.marketsCommand');
    const helpCommand = await ctx.__!('welcome.fixed.helpCommand');
    
    const availableCommands = await ctx.__!('welcome.fixed.availableCommands');
    const walletCommand = await ctx.__!('welcome.fixed.walletCommand');
    const marketsListCommand = await ctx.__!('welcome.fixed.marketsListCommand');
    const chartCommand = await ctx.__!('welcome.fixed.chartCommand');
    const priceCheckCommand = await ctx.__!('welcome.fixed.priceCheckCommand');
    const longShortCommand = await ctx.__!('welcome.fixed.longShortCommand');
    const closeCommand = await ctx.__!('welcome.fixed.closeCommand');
    const positionsCommand = await ctx.__!('welcome.fixed.positionsCommand');
    const pnlCommand = await ctx.__!('welcome.fixed.pnlCommand');
    const pushCommand = await ctx.__!('welcome.fixed.pushCommand');
    
    const securityNote = await ctx.__!('welcome.fixed.securityNote');
    const moreFeatures = await ctx.__!('welcome.fixed.moreFeatures');
    
    message += `<b>${quickStart}</b>\n`;
    message += `${priceCommand}\n`;
    message += `${marketsCommand}\n`;
    message += `${helpCommand}\n\n`;
    
    message += `<b>${availableCommands}</b>\n`;
    message += `${walletCommand}\n`;
    message += `${marketsListCommand}\n`;
    message += `${chartCommand}\n`;
    message += `${priceCheckCommand}\n`;
    message += `${longShortCommand}\n`;
    message += `${closeCommand}\n`;
    message += `${positionsCommand}\n`;
    message += `${pnlCommand}\n`;
    message += `${pushCommand}\n\n`;
    
    message += `${securityNote}\n`;
    message += `${moreFeatures}`;
    
    return message.trim();
  }

  /**
   * Create inline keyboard for adding to group (now supports multiple languages)
   */
  private async createAddToGroupKeyboard(ctx: ExtendedContext): Promise<InlineKeyboardMarkup> {
    // botUsername 现在在 config 中已经包含了环境感知的 fallback
    const botUsername = config.telegram.botUsername;
    
    // Get localized button text
    const addToGroupText = await ctx.__!('button.addToGroup');
    const usageGuideText = await ctx.__!('button.usageGuide');
    
    return {
      inline_keyboard: [
        [
          {
            text: addToGroupText,
            url: `tg://resolve?domain=${botUsername}&startgroup=welcome`
          }
        ],
        [
          {
            text: usageGuideText,
            callback_data: 'group_usage_guide'
          }
        ]
      ]
    };
  }


  /**
   * Send general error message
   */
  private async sendErrorMessage(ctx: ExtendedContext, error: Error): Promise<void> {
    const title = await ctx.__!('errors.systemError.title');
    const description = await ctx.__!('errors.systemError.description');
    const suggestions = await ctx.__!('errors.systemError.suggestions');
    const retryStart = await ctx.__!('errors.systemError.retryStart');
    const checkHelp = await ctx.__!('errors.systemError.checkHelp');
    const usePrice = await ctx.__!('errors.systemError.usePrice');
    const contactAdmin = await ctx.__!('errors.systemError.contactAdmin');
    
    const errorMessage = 
      `${title}\n\n` +
      `${description}\n\n` +
      `${suggestions}\n` +
      `${retryStart}\n` +
      `${checkHelp}\n` +
      `${usePrice}\n\n` +
      `${contactAdmin}`;

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

      // Initialize user with invitation code first
      const userData = await this.initializeUser(ctx, [invitationCode], requestId);
      
      // Send special invitation welcome message (or regular welcome if invitation message not needed)
      if (userData) {
        // Send welcome message with account info
        await ctx.reply(
          await this.getWelcomeMessage(ctx, userData),
          { parse_mode: 'HTML' }
        );
      } else {
        // Fallback to invitation message if initialization failed
        const inviteMessage = await this.getInvitationWelcomeMessage(ctx, invitationCode);
        await ctx.reply(inviteMessage, { parse_mode: 'HTML' });
      }

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
  private async getInvitationWelcomeMessage(ctx: ExtendedContext, invitationCode: string): Promise<string> {
    const title = await ctx.__!('invite.welcome.title');
    const codeLabel = await ctx.__!('invite.welcome.code');
    const initializing = await ctx.__!('invite.welcome.initializing');
    const benefitsTitle = await ctx.__!('invite.benefits.title');
    const benefitsEnergy = await ctx.__!('invite.benefits.energy');
    const priorityAccess = await ctx.__!('invite.welcome.priorityAccess');
    const exclusiveBadge = await ctx.__!('invite.welcome.exclusiveBadge');
    const quickStart = await ctx.__!('invite.welcome.quickStart');
    const checkPrices = await ctx.__!('invite.welcome.checkPrices');
    const viewFeatures = await ctx.__!('invite.welcome.viewFeatures');
    const creating = await ctx.__!('invite.welcome.creating');
    
    return `
<b>${title}</b>

${codeLabel} <code>${invitationCode}</code>

${initializing}

${benefitsTitle}
• ${benefitsEnergy}
• ${priorityAccess}
• ${exclusiveBadge}

<b>${quickStart}</b>
<code>/price BTC</code> - ${checkPrices}
<code>/help</code> - ${viewFeatures}

<i>${creating}</i>
    `.trim();
  }

  /**
   * Get group welcome message
   */
  private async getGroupWelcomeMessage(ctx: ExtendedContext): Promise<string> {
    const botUsername = config.telegram.botUsername || 'aiw3_tradebot';
    
    const title = await ctx.__!('group.welcome.title');
    const introduction = await ctx.__!('group.welcome.introduction', { botUsername });
    const coreFeatures = await ctx.__!('group.welcome.coreFeatures');
    const priceQueries = await ctx.__!('welcome.commands.priceQueries');
    const tradeExecution = await ctx.__!('welcome.commands.tradeExecution');
    const accountInfo = await ctx.__!('welcome.commands.accountInfo');
    const marketData = await ctx.__!('welcome.commands.marketData');
    const chartAnalysis = await ctx.__!('welcome.commands.chartAnalysis');
    const importantNotes = await ctx.__!('group.welcome.importantNotes');
    const tradingBot = await ctx.__!('group.welcome.tradingBot');
    const realTrading = await ctx.__!('group.welcome.realTrading');
    const walletRequired = await ctx.__!('group.welcome.walletRequired');
    const quickStart = await ctx.__!('group.welcome.quickStart');
    const initializeAccount = await ctx.__!('group.welcome.initializeAccount');
    const checkBitcoin = await ctx.__!('group.welcome.checkBitcoin');
    const viewWallet = await ctx.__!('group.welcome.viewWallet');
    const getCommands = await ctx.__!('group.welcome.getCommands');
    const botConfirmed = await ctx.__!('group.welcome.botConfirmed');
    const tradingCall = await ctx.__!('welcome.commands.tradingCall');
    
    return `
<b>${title}</b>

${introduction}

<b>${coreFeatures}</b>
• ${priceQueries}
• ${tradeExecution}
• ${accountInfo}
• ${marketData}
• ${chartAnalysis}

<b>${importantNotes}</b>
• ${tradingBot}
• ${realTrading}
• ${walletRequired}

<b>${quickStart}</b>
1. <code>/start</code> - ${initializeAccount}
2. <code>/price BTC</code> - ${checkBitcoin}
3. <code>/wallet</code> - ${viewWallet}
4. <code>/help</code> - ${getCommands}

<b>${botConfirmed}</b> @${botUsername}

${tradingCall}
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
        await this.getGroupWelcomeMessage(ctx),
        { parse_mode: 'HTML' }
      );

      // Initialize user in background (if needed)
      if (userId) {
        await this.initializeUser(ctx, [], requestId);
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
      await ctx.answerCbQuery(await ctx.__!('guide.error.failed'));
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
          const userData = await this.initializeUser(ctx, [], requestId);
          const welcomeMessage = await this.getWelcomeMessage(ctx, userData);
          await ctx.reply(welcomeMessage, { parse_mode: 'HTML' });
          break;
        case '/long':
          try {
            const { longHandler } = await import('./long.handler');
            await longHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import long handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply(await ctx.__!('errors.feature.longUnavailable'));
          }
          break;
        case '/short':
          try {
            const { shortHandler } = await import('./short.handler');
            await shortHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import short handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply(await ctx.__!('errors.feature.shortUnavailable'));
          }
          break;
        case '/close':
          try {
            const { closeHandler } = await import('./close.handler');
            await closeHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import close handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply(await ctx.__!('errors.feature.closeUnavailable'));
          }
          break;
        case '/positions':
          try {
            const { positionsHandler } = await import('./positions.handler');
            await positionsHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import positions handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply(await ctx.__!('errors.feature.positionsUnavailable'));
          }
          break;
        case '/wallet':
          try {
            const { walletHandler } = await import('./wallet.handler');
            await walletHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import wallet handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply(await ctx.__!('errors.feature.walletUnavailable'));
          }
          break;
        case '/pnl':
          try {
            const { pnlHandler } = await import('./pnl.handler');
            await pnlHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import pnl handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply(await ctx.__!('errors.feature.pnlUnavailable'));
          }
          break;
        case '/push':
          try {
            const { pushHandler } = await import('./push.handler');
            await pushHandler.handle(ctx, commandArgs);
          } catch (importError) {
            logger.error(`Failed to import push handler [${requestId}]`, { error: (importError as Error).message });
            await ctx.reply(await ctx.__!('errors.feature.pushUnavailable'));
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
import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { apiService } from '../../services/api.service';
import { tokenService } from '../../services/token.service';
import { userService } from '../../services/user.service';
import { getUserAccessToken, getUserDataAndToken } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { handleTradingError } from '../../utils/error-handler';
import { ExtendedContext } from '../index';
import { accountService } from '../../services/account.service';
import { tradingStateService, TradingState } from '../../services/trading-state.service';
import { messageFormatter } from '../utils/message.formatter';
import { i18nService } from '../../services/i18n.service';

/**
 * Long command handler
 * Supports two modes: guided mode and quick mode
 */
export class LongHandler {
  /**
   * Handle /long command - supports two modes
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('long', userId!, username, args);

      // Check if user has active trading state
      const activeState = await tradingStateService.getState(userId!.toString());
      if (activeState) {
        const activeSessionMsg = await ctx.__!('trading.activeSession');
        const completeOrCancelMsg = await ctx.__!('trading.completeOrCancel');
        await ctx.reply(
          `${activeSessionMsg}\n\n${completeOrCancelMsg}`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Determine handling mode based on parameter count
      if (args.length === 0) {
        // Guided mode: no parameters, start step-by-step guidance
        await this.handleGuidedMode(ctx, 'long');
        return;
      } else if (args.length === 1) {
        // Guided mode: only token provided, jump to leverage selection
        await this.handleGuidedMode(ctx, 'long', args[0]);
        return;
      } else if (args.length === 3) {
        // Quick mode: complete parameters, handle directly
        await this.handleQuickMode(ctx, args);
        return;
      } else {
        // Incorrect parameter count
        const userLanguage = await i18nService.getUserLanguage(ctx.from?.id);
        await ctx.reply(
          await messageFormatter.formatTradingCommandErrorMessage('long', userLanguage),
          { parse_mode: 'HTML' }
        );
        return;
      }

    } catch (error) {
      // Use unified error handling for system exceptions
      await handleTradingError(ctx, error, 'long', args[0], args[2]);
    }
  }

  /**
   * Handle guided mode
   */
  private async handleGuidedMode(ctx: ExtendedContext, action: 'long', symbol?: string): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      const userInfoError = await ctx.__!('trading.userInfoError');
      await ctx.reply(userInfoError);
      return;
    }
    
    if (!symbol) {
      // Step 1: Select token
      const state = await tradingStateService.createState(userId, action);
      const userLanguage = await i18nService.getUserLanguage(ctx.from?.id);
      const message = await messageFormatter.formatTradingSymbolPrompt(action, userLanguage);
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    } else {
      // Jump to step 2: Select leverage (already have token)
      const state = await tradingStateService.createState(userId, action, symbol.toUpperCase());
      
      try {
        // Get current price and available margin
        const tokenData = await tokenService.getTokenPrice(symbol);
        const accountBalance = await accountService.getAccountBalance(userId!.toString());
        const availableMargin = accountBalance.withdrawableAmount || 0;
        
        const userLanguage = await i18nService.getUserLanguage(ctx.from?.id);
        const message = await messageFormatter.formatTradingLeveragePrompt(
          action, 
          symbol.toUpperCase(), 
          tokenData.price, 
          availableMargin,
          userLanguage
        );
        
        const keyboard = this.createLeverageKeyboard(symbol.toUpperCase());
        
        await ctx.reply(message, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      } catch (error) {
        await tradingStateService.clearState(userId);
        const tokenNotFound = await ctx.__!('errors.tokenNotFound');
        const tryAgainLater = await ctx.__!('trading.errors.tryAgainLater');
        await ctx.reply(
          `❌ ${symbol.toUpperCase()}: ${tokenNotFound}\n\n${tryAgainLater}`,
          { parse_mode: 'HTML' }
        );
      }
    }
  }

  /**
   * Handle quick mode
   */
  private async handleQuickMode(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    const [symbol, leverageStr, amountStr] = args;

    // Basic validation
    if (!symbol || !leverageStr || !amountStr) {
      const userLanguage = await i18nService.getUserLanguage(ctx.from?.id);
      await ctx.reply(
        await messageFormatter.formatTradingCommandErrorMessage('long', userLanguage),
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Validate trading amount format
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      const amountError = await ctx.__!('trading.amountError');
      const invalidAmount = await ctx.__!('trading.invalidAmount');
      await ctx.reply(
        `${amountError}\n\n${invalidAmount}\n\n` +
        `Example: <code>/long BTC 10x 100</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Validate Hyperliquid minimum trading amount ($10)
    if (amount < 10) {
      const minimumAmount = await ctx.__!('trading.minimumAmount');
      const minimumRequired = await ctx.__!('trading.minimumRequired');
      const adjustAmount = await ctx.__!('trading.adjustAmount');
      await ctx.reply(
        `${minimumAmount}\n\n` +
        `${minimumRequired}\n` +
        `Your amount: <code>$${amount}</code>\n\n` +
        `💡 <b>${adjustAmount}</b>\n` +
        `<code>/long ${symbol.toUpperCase()} ${leverageStr} 10</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Send processing message
    const userLanguage = await i18nService.getUserLanguage(ctx.from?.id);
    const loadingMessage = await ctx.reply(
      await messageFormatter.formatTradingProcessingMessage('long', symbol, leverageStr, amountStr, userLanguage),
      { parse_mode: 'HTML' }
    );

    try {
      // Get user data and access token in one call
      const { userData, accessToken } = await getUserDataAndToken(userId!.toString(), {
        username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // 🔍 Verify user data acquisition
      logger.info(`🔍 User Data Check:`, {
        telegramId: userId!.toString(),
        internalUserId: userData.userId,
        userIdType: typeof userData.userId,
        accessTokenLength: accessToken?.length,
        hasAccessToken: !!accessToken
      });

      // Get token price for size calculation
      const tokenData = await tokenService.getTokenPrice(symbol);
      const size = parseFloat(amountStr) / tokenData.price;
      
      // Prepare trading data with internal userId
      const tradingData = {
        userId: userData.userId,                          // ✅ Use internal user ID
        symbol: symbol.toUpperCase(),
        leverage: parseInt(leverageStr.replace('x', '')), // Convert to number
        size: size,                                       // Calculated token quantity
        orderType: "market"
      };
      
      // 📋 Verify trading data construction
      logger.info(`📋 Trading Data Built:`, {
        userId: tradingData.userId,
        userIdType: typeof tradingData.userId,
        symbol: tradingData.symbol,
        leverage: tradingData.leverage,
        size: tradingData.size,
        orderType: tradingData.orderType
      });

      // Check if balance is sufficient
      const requiredAmount = parseFloat(amountStr);
      if (isNaN(requiredAmount) || requiredAmount <= 0) {
        const parameterError = await ctx.__!('trading.parameterError');
        const validQuantity = await ctx.__!('trading.validQuantity');
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          `${parameterError}\n\n${validQuantity}\n\n` +
          'Example: <code>/long BTC 10x 200</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Check account balance - consider leverage multiplier
      try {
        const leverageNum = parseFloat(leverageStr.replace('x', ''));
        
        // All leverage ratios (including 1x) use margin trading with contract wallet
        const marginCheck = await accountService.checkAvailableMargin(
          userId!.toString(),
          requiredAmount,
          leverageNum
        );

        if (!marginCheck.sufficient) {
          let errorMessage = '';
          const contractAccountValue = (await accountService.getAccountBalance(userId!.toString())).nativeBalance;
          
          switch (marginCheck.reason) {
            case 'margin_occupied':
              const marginOccupied = await ctx.__!('trading.balance.marginOccupied');
              const total = await ctx.__!('trading.balance.total', { amount: contractAccountValue.toFixed(2) });
              const available = await ctx.__!('trading.balance.available', { amount: marginCheck.availableMargin.toFixed(2) });
              const required = await ctx.__!('trading.balance.required', { amount: marginCheck.requiredMargin.toFixed(2) });
              const solutions = await ctx.__!('trading.balance.solutions');
              const closePositions = await ctx.__!('trading.balance.closePositions');
              const reduceAmount = await ctx.__!('trading.balance.reduceAmount');
              const reduceLeverage = await ctx.__!('trading.balance.reduceLeverage');
              const deposit = await ctx.__!('trading.balance.deposit');
              
              errorMessage = `${marginOccupied}\n\n` +
                `${total}\n` +
                `${available}\n` +
                `${required}\n\n` +
                `💡 <b>Cause Analysis:</b>\n` +
                `• Your funds are occupied by existing positions as margin\n` +
                `• Leverage trading requires sufficient available margin\n\n` +
                `${solutions}\n` +
                `${closePositions}\n` +
                `${reduceAmount}: <code>/long ${symbol.toUpperCase()} ${leverageStr} ${Math.floor(marginCheck.availableMargin * leverageNum)}</code>\n` +
                `${reduceLeverage}\n` +
                `${deposit}`;
              break;
            case 'no_funds':
              const noFunds = await ctx.__!('trading.balance.noFunds');
              const depositMsg = await ctx.__!('trading.balance.deposit');
              const checkWallet = await ctx.__!('trading.balance.checkWallet');
              const solutionsMsg = await ctx.__!('trading.balance.solutions');
              
              errorMessage = `${noFunds}\n\n` +
                `Leverage trading requires contract account funds\n` +
                `Current contract account balance: <code>$0</code>\n\n` +
                `💡 ${solutionsMsg}\n` +
                `${depositMsg}\n` +
                `${checkWallet}`;
              break;
            default:
              const insufficientMargin = await ctx.__!('trading.balance.insufficient');
              const requiredMsg = await ctx.__!('trading.balance.required', { amount: marginCheck.requiredMargin.toFixed(2) });
              const availableMsg = await ctx.__!('trading.balance.available', { amount: marginCheck.availableMargin.toFixed(2) });
              const solutionsDefault = await ctx.__!('trading.balance.solutions');
              const depositDefault = await ctx.__!('trading.balance.deposit');
              
              errorMessage = `${insufficientMargin}\n\n` +
                `${requiredMsg}\n` +
                `${availableMsg}\n\n` +
                `💡 ${solutionsDefault}\n` +
                `• Reduce trading amount or leverage multiplier\n` +
                `${depositDefault}`;
          }

          await ctx.telegram.editMessageText(
            ctx.chat?.id,
            loadingMessage.message_id,
            undefined,
            errorMessage,
            { parse_mode: 'HTML' }
          );
          return;
        }
      } catch (balanceError) {
        logger.warn(`Failed to check balance for long trading`, {
          userId,
          requiredAmount,
          leverage: leverageStr,
          error: (balanceError as Error).message,
          requestId
        });
        // If balance check fails, continue with trade (let backend handle)
      }

      logger.info(`🚀 [LONG ORDER] ${symbol.toUpperCase()} ${leverageStr} $${amountStr}`);
      
      // Show order preview instead of executing trade directly
      // Fix: actual token quantity user will purchase (excluding leverage)
      const orderSize = parseFloat(amountStr) / tokenData.price;
      const liquidationPrice = this.calculateLiquidationPrice(tokenData.price, parseFloat(leverageStr.replace('x', '')), 'long');
      
      const previewMessage = await messageFormatter.formatTradingOrderPreview(
        'long',
        symbol.toUpperCase(),
        leverageStr,
        amountStr,
        tokenData.price,
        orderSize,
        liquidationPrice,
        userLanguage
      );
      
      const keyboard = await this.createConfirmationKeyboard(ctx, symbol, leverageStr, amountStr);
      
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        loadingMessage.message_id,
        undefined,
        previewMessage,
        { 
          parse_mode: 'HTML',
          reply_markup: keyboard
        }
      );


    } catch (apiError: any) {
      // Critical trade failure log
      logger.error(`❌ [LONG FAILED] ${symbol.toUpperCase()} ${leverageStr} $${amountStr}: ${apiError.message}`);
      
      // Simplified error data log
      if (apiError.response?.data) {
        logger.debug(`📥 Error response: ${JSON.stringify(apiError.response.data)}`);
      }
      
      // Use unified error handling system
      await handleTradingError(
        ctx, 
        apiError, 
        'long', 
        symbol, 
        amountStr, 
        loadingMessage.message_id
      );
    }
  }

  /**
   * Handle trading callback queries (confirm/cancel buttons)
   */
  public async handleCallback(ctx: ExtendedContext, callbackData: string): Promise<void> {
    try {
      if (callbackData.startsWith('long_confirm_')) {
        // Confirm execution of trade
        const [, , symbol, leverage, amount] = callbackData.split('_');
        await this.executeTrading(ctx, 'long', symbol, leverage, amount);
      } else if (callbackData.startsWith('long_cancel_')) {
        // Cancel trade
        const cancelled = await ctx.__!('trading.cancelled');
        const restartAnytime = await ctx.__!('trading.restartAnytime');
        await ctx.answerCbQuery(cancelled);
        await ctx.editMessageText(
          `${cancelled}\n\n${restartAnytime}`,
          { parse_mode: 'HTML' }
        );
      } else if (callbackData.startsWith('long_leverage_')) {
        // Handle leverage selection callback
        await this.handleLeverageSelection(ctx, callbackData);
      }
    } catch (error) {
      logger.error('Long callback error', {
        error: (error as Error).message,
        callbackData,
        userId: ctx.from?.id
      });
      const operationFailed = await ctx.__!('trading.operationFailed');
      await ctx.answerCbQuery(operationFailed);
    }
  }

  /**
   * Handle leverage selection callback
   */
  private async handleLeverageSelection(ctx: ExtendedContext, callbackData: string): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      const userInfoError = await ctx.__!('trading.userInfoError');
      await ctx.answerCbQuery(userInfoError);
      return;
    }
    const leverage = callbackData.split('_')[3]; // long_leverage_BTC_3x
    
    const state = await tradingStateService.getState(userId);
    if (!state || !state.symbol) {
      const sessionExpired = await ctx.__!('trading.sessionExpired');
      await ctx.answerCbQuery(sessionExpired);
      return;
    }

    // Update state
    await tradingStateService.updateState(userId, {
      leverage: leverage,
      step: 'amount'
    });

    const leverageSelected = await ctx.__!('trading.leverage.selected', { leverage });
    await ctx.answerCbQuery(leverageSelected);

    // Show amount input prompt
    // Get available margin
    const accountBalance = await accountService.getAccountBalance(userId);
    const availableMargin = accountBalance.withdrawableAmount || 0;
    
    const userLanguage = await i18nService.getUserLanguage(ctx.from?.id);
    const message = await messageFormatter.formatTradingAmountPrompt(
      'long',
      state.symbol,
      leverage,
      availableMargin,
      userLanguage
    );

    await ctx.editMessageText(message, { parse_mode: 'HTML' });
  }

  /**
   * Execute actual trade
   */
  private async executeTrading(ctx: ExtendedContext, action: 'long', symbol: string, leverage: string, amount: string): Promise<void> {
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';

    try {
      const executingTrade = await ctx.__!('trading.executingTrade');
      await ctx.answerCbQuery(executingTrade);
      
      // Get user data and access token (single call)
      const { userData, accessToken } = await getUserDataAndToken(userId!.toString(), {
        username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // 🔍 Verify user data acquisition  
      logger.info(`🔍 User Data Check (executeTrading):`, {
        telegramId: userId!.toString(),
        internalUserId: userData.userId,
        userIdType: typeof userData.userId,
        accessTokenLength: accessToken?.length,
        hasAccessToken: !!accessToken
      });

      // Get token price for size calculation
      const tokenData = await tokenService.getTokenPrice(symbol);
      const size = parseFloat(amount) / tokenData.price;
      
      // Call trading API - add internal userId
      const tradingData = {
        userId: userData.userId,                       // ✅ Use internal user ID
        symbol: symbol.toUpperCase(),
        leverage: parseInt(leverage.replace('x', '')), // Convert to number
        size: size,                                    // Calculated token quantity
        orderType: "market"
      };

      // 📋 Verify trading data construction
      logger.info(`📋 Trading Data Built (executeTrading):`, {
        userId: tradingData.userId,
        userIdType: typeof tradingData.userId,
        symbol: tradingData.symbol,
        leverage: tradingData.leverage,
        size: tradingData.size,
        orderType: tradingData.orderType
      });

      // 🚀 Final API Call Verification
      logger.info(`🚀 API Call:`, {
        endpoint: '/api/tgbot/trading/long',
        userId: tradingData.userId,
        hasToken: !!accessToken
      });

      const result = await apiService.postWithAuth(
        '/api/tgbot/trading/long',
        accessToken,
        tradingData
      );
      
      logger.info(`📥 API Response Success:`, { result });

      // Check API response to determine if truly successful
      const apiResult = result as any; // Type assertion
      let successMessage = '';
      if (apiResult && apiResult.success !== false && !apiResult.error) {
        // Trade success log
        logger.info('🎯 [TRADING SUCCESS] Long position opened', {
          symbol: symbol.toUpperCase(),
          leverage: leverage,
          amount: `$${amount}`,
          orderId: apiResult.data?.orderId || 'N/A'
        });
        
        // Only show success message when confirmed successful
        const longSuccess = await ctx.__!('trading.long.success');
        const token = await ctx.__!('trading.preview.token', { symbol: symbol.toUpperCase() });
        const leverageMsg = await ctx.__!('trading.preview.leverage', { leverage });
        const amountMsg = await ctx.__!('trading.preview.amount', { amount });
        const recommendations = await ctx.__!('trading.recommendations');
        const viewPositions = await ctx.__!('trading.viewPositions');
        const checkBalance = await ctx.__!('trading.checkBalance');
        
        successMessage = `${longSuccess}\n\n` +
          `${token}\n` +
          `${leverageMsg}\n` +
          `${amountMsg}\n\n` +
          `${recommendations}\n` +
          `${viewPositions}\n` +
          `${checkBalance}`;
      } else {
        // If response indicates failure, throw error
        throw new Error(apiResult?.message || 'Hyperliquid API returned failure status');
      }

      await ctx.editMessageText(successMessage, { parse_mode: 'HTML' });

    } catch (error: any) {
      // Detailed API error logging for debugging
      logger.error('🚨 Long Trading API Error - Complete Details:', {
        userId,
        symbol: symbol.toUpperCase(),
        leverage,
        amount,
        errorStatus: error.response?.status,
        errorData: error.response?.data,
        errorMessage: error.message
      });
      
      const executionFailed = await ctx.__!('trading.executionFailed');
      await ctx.answerCbQuery(executionFailed);
      
      // Parse API error and provide user-friendly error message
      const tradeFailed = await ctx.__!('trading.long.failed');
      let errorMessage = `${tradeFailed}\n\n`;
      
      // Check if it's insufficient balance error
      if (error.response?.status === 400) {
        const responseData = error.response?.data;
        const errorMsg = responseData?.message || error.message || '';
        
        // Handle new API error codes
        if (errorMsg.includes('Builder fee has not been approved')) {
          const builderFee = await ctx.__!('trading.errors.builderFee');
          const builderFeeDesc = await ctx.__!('trading.errors.builderFeeDesc');
          const builderFeeSolution = await ctx.__!('trading.errors.builderFeeSolution');
          const contactSupport = await ctx.__!('trading.errors.contactSupport');
          
          errorMessage = `${builderFee}\n\n${builderFeeDesc}\n\n` +
            `💡 <b>Solution:</b>\n${builderFeeSolution}\n` +
            `• After approval, all trading will work normally\n` +
            `• If the issue persists, ${contactSupport}`;
        } else if (errorMsg.includes('size must be a positive number')) {
          const sizeInvalid = await ctx.__!('trading.errors.sizeInvalid');
          const sizeInvalidDesc = await ctx.__!('trading.errors.sizeInvalidDesc');
          const tryAgainLater = await ctx.__!('trading.errors.tryAgainLater');
          
          errorMessage = `${sizeInvalid}\n\n${sizeInvalidDesc}\n\n` +
            `💡 <b>Possible causes:</b>\n` +
            `• Price data retrieval failed\n` +
            `• Trading amount too small\n` +
            `• ${tryAgainLater} or increase trading amount`;
        } else if (errorMsg.includes('insufficient') || errorMsg.toLowerCase().includes('balance')) {
          const insufficient = await ctx.__!('trading.balance.insufficient');
          const checkWallet = await ctx.__!('trading.balance.checkWallet');
          const deposit = await ctx.__!('trading.balance.deposit');
          const minimumRequired = await ctx.__!('trading.minimumRequired');
          
          errorMessage = `${insufficient}\n\n` +
            `Cannot complete $${amount} long trade\n\n` +
            `💡 <b>Solutions:</b>\n` +
            `${checkWallet}\n` +
            `${deposit}\n` +
            `• Reduce trading amount\n\n` +
            `<i>💸 Note: ${minimumRequired}</i>`;
        } else if (errorMsg.includes('minimum') || parseFloat(amount) < 10) {
          const minimumAmount = await ctx.__!('trading.minimumAmount');
          const minimumRequired = await ctx.__!('trading.minimumRequired');
          const adjustAmount = await ctx.__!('trading.adjustAmount');
          
          errorMessage = `${minimumAmount}\n\n` +
            `${minimumRequired}\n` +
            `Your amount: <code>$${amount}</code>\n\n` +
            `💡 <b>${adjustAmount}</b>\n` +
            `<code>/long ${symbol.toUpperCase()} ${leverage} 10</code>`;
        } else {
          const tryAgainLater = await ctx.__!('trading.errors.tryAgainLater');
          errorMessage += `Parameter error: ${errorMsg}\n\n` +
            `<i>Please check trading parameters or ${tryAgainLater}</i>`;
        }
      } else if (error.response?.status === 401) {
        const responseData = error.response?.data;
        const errorMsg = responseData?.message || error.message || '';
        
        if (errorMsg.includes('Invalid access token')) {
          const authExpired = await ctx.__!('trading.errors.authExpired');
          const authExpiredDesc = await ctx.__!('trading.errors.authExpiredDesc');
          const authSolution = await ctx.__!('trading.errors.authSolution');
          
          errorMessage = `${authExpired}\n\n${authExpiredDesc}\n\n` +
            `💡 <b>Solution:</b>\n${authSolution}\n` +
            `• This will automatically refresh your access permissions`;
        } else {
          const authSolution = await ctx.__!('trading.errors.authSolution');
          errorMessage += `Authentication failed, please log in again\n\n` +
            `<i>${authSolution} to restart</i>`;
        }
      } else if (error.response?.status >= 500) {
        const serverUnavailable = await ctx.__!('trading.errors.serverUnavailable');
        const tryAgainLater = await ctx.__!('trading.errors.tryAgainLater');
        errorMessage += `${serverUnavailable}\n\n<i>${tryAgainLater}</i>`;
      } else {
        const contactSupport = await ctx.__!('trading.errors.contactSupport');
        errorMessage += `${error.message}\n\n<i>${contactSupport}</i>`;
      }
      
      await ctx.editMessageText(errorMessage, { parse_mode: 'HTML' });
    }
  }

  /**
   * Create leverage selection keyboard
   */
  public createLeverageKeyboard(symbol: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '1x', callback_data: `long_leverage_${symbol}_1x` },
          { text: '2x', callback_data: `long_leverage_${symbol}_2x` },
          { text: '3x', callback_data: `long_leverage_${symbol}_3x` }
        ]
      ]
    };
  }

  /**
   * Create confirmation keyboard
   */
  public async createConfirmationKeyboard(ctx: ExtendedContext, symbol: string, leverage: string, amount: string): Promise<InlineKeyboardMarkup> {
    const cancel = await ctx.__!('trading.preview.cancel');
    const confirm = await ctx.__!('trading.preview.confirm');
    
    return {
      inline_keyboard: [
        [
          { text: cancel, callback_data: `long_cancel_${symbol}_${leverage}_${amount}` },
          { text: confirm, callback_data: `long_confirm_${symbol}_${leverage}_${amount}` }
        ]
      ]
    };
  }

  /**
   * Calculate liquidation price
   */
  private calculateLiquidationPrice(currentPrice: number, leverage: number, direction: 'long' | 'short'): number {
    // Simplified calculation, should be more complex in practice
    const marginRatio = 0.05; // 5% maintenance margin ratio
    const liquidationRatio = (leverage - 1) / leverage * (1 - marginRatio);
    
    if (direction === 'long') {
      return currentPrice * (1 - liquidationRatio);
    } else {
      return currentPrice * (1 + liquidationRatio);
    }
  }

  /**
   * Get handler statistics
   */
  public getStats(): any {
    return {
      name: 'LongHandler',
      version: '2.0.0',
      supportedCommands: ['/long'],
      features: [
        'Guided step-by-step trading',
        'Quick command trading',
        'Interactive keyboard interfaces',
        'Order preview and confirmation',
        'User state management',
        'Balance validation',
        'Error handling',
        'Trading status feedback'
      ]
    };
  }
}

// Export singleton instance
export const longHandler = new LongHandler();

// Default export
export default longHandler;
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
        await ctx.reply(
          '⚠️ <b>You have an active trading session</b>\n\n' +
          'Please complete current trade or send /cancel to cancel current session',
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
        await ctx.reply(
          messageFormatter.formatTradingCommandErrorMessage('long'),
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
      await ctx.reply('❌ Unable to get user information, please retry');
      return;
    }
    
    if (!symbol) {
      // Step 1: Select token
      const state = await tradingStateService.createState(userId, action);
      const message = messageFormatter.formatTradingSymbolPrompt(action);
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    } else {
      // Jump to step 2: Select leverage (already have token)
      const state = await tradingStateService.createState(userId, action, symbol.toUpperCase());
      
      try {
        // Get current price and available margin
        const tokenData = await tokenService.getTokenPrice(symbol);
        const accountBalance = await accountService.getAccountBalance(userId!.toString());
        const availableMargin = accountBalance.withdrawableAmount || 0;
        
        const message = messageFormatter.formatTradingLeveragePrompt(
          action, 
          symbol.toUpperCase(), 
          tokenData.price, 
          availableMargin
        );
        
        const keyboard = this.createLeverageKeyboard(symbol.toUpperCase());
        
        await ctx.reply(message, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      } catch (error) {
        await tradingStateService.clearState(userId);
        await ctx.reply(
          `❌ Unable to get ${symbol.toUpperCase()} price information, please retry later`,
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
      await ctx.reply(
        messageFormatter.formatTradingCommandErrorMessage('long'),
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Validate trading amount format
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        `❌ <b>Trading Amount Error</b>\n\n` +
        `Please enter a valid numeric amount\n\n` +
        `Example: <code>/long BTC 10x 100</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Validate Hyperliquid minimum trading amount ($10)
    if (amount < 10) {
      await ctx.reply(
        `💰 <b>Insufficient Trading Amount</b>\n\n` +
        `Hyperliquid minimum trading amount is <b>$10</b>\n` +
        `Your amount: <code>$${amount}</code>\n\n` +
        `💡 <b>Please adjust to at least $10:</b>\n` +
        `<code>/long ${symbol.toUpperCase()} ${leverageStr} 10</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Send processing message
    const loadingMessage = await ctx.reply(
      messageFormatter.formatTradingProcessingMessage('long', symbol, leverageStr, amountStr),
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
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          '❌ <b>Trading Parameter Error</b>\n\n' +
          'Please enter a valid quantity\n\n' +
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
              errorMessage = `💰 <b>Insufficient Available Margin</b>\n\n` +
                `Contract Account Total Value: <code>$${contractAccountValue.toFixed(2)}</code>\n` +
                `Available Margin: <code>$${marginCheck.availableMargin.toFixed(2)}</code>\n` +
                `Required Margin: <code>$${marginCheck.requiredMargin.toFixed(2)}</code>\n\n` +
                `💡 <b>Cause Analysis:</b>\n` +
                `• Your funds are occupied by existing positions as margin\n` +
                `• Leverage trading requires sufficient available margin\n\n` +
                `🔧 <b>Solutions:</b>\n` +
                `• Close some positions to release margin\n` +
                `• Reduce trading amount: <code>/long ${symbol.toUpperCase()} ${leverageStr} ${Math.floor(marginCheck.availableMargin * leverageNum)}</code>\n` +
                `• Reduce leverage multiplier\n` +
                `• Deposit more USDC to contract account`;
              break;
            case 'no_funds':
              errorMessage = `💰 <b>Contract Account No Funds</b>\n\n` +
                `Leverage trading requires contract account funds\n` +
                `Current contract account balance: <code>$0</code>\n\n` +
                `💡 <b>Solutions:</b>\n` +
                `• Deposit USDC to wallet\n` +
                `• Use /wallet to check account status`;
              break;
            default:
              errorMessage = `💰 <b>Insufficient Margin</b>\n\n` +
                `Required margin: <code>$${marginCheck.requiredMargin.toFixed(2)}</code>\n` +
                `Available margin: <code>$${marginCheck.availableMargin.toFixed(2)}</code>\n\n` +
                `💡 <b>Solutions:</b>\n` +
                `• Reduce trading amount or leverage multiplier\n` +
                `• Deposit more USDC to contract account`;
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
        // 如果余额检查失败，继续执行交易（让后端处理）
      }

      logger.info(`🚀 [LONG ORDER] ${symbol.toUpperCase()} ${leverageStr} $${amountStr}`);
      
      // 显示订单预览而不是直接执行交易
      // 修复：用户实际购买的代币数量（不考虑杠杆）
      const orderSize = parseFloat(amountStr) / tokenData.price;
      const liquidationPrice = this.calculateLiquidationPrice(tokenData.price, parseFloat(leverageStr.replace('x', '')), 'long');
      
      const previewMessage = messageFormatter.formatTradingOrderPreview(
        'long',
        symbol.toUpperCase(),
        leverageStr,
        amountStr,
        tokenData.price,
        orderSize,
        liquidationPrice
      );
      
      const keyboard = this.createConfirmationKeyboard(symbol, leverageStr, amountStr);
      
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
      // 关键交易失败日志
      logger.error(`❌ [LONG FAILED] ${symbol.toUpperCase()} ${leverageStr} $${amountStr}: ${apiError.message}`);
      
      // 简化错误数据日志
      if (apiError.response?.data) {
        logger.debug(`📥 Error response: ${JSON.stringify(apiError.response.data)}`);
      }
      
      // 使用统一错误处理系统
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
        await ctx.answerCbQuery('❌ Trade cancelled');
        await ctx.editMessageText(
          '❌ <b>Trade Cancelled</b>\n\nYou can restart trading anytime',
          { parse_mode: 'HTML' }
        );
      } else if (callbackData.startsWith('long_leverage_')) {
        // 处理杠杆选择回调
        await this.handleLeverageSelection(ctx, callbackData);
      }
    } catch (error) {
      logger.error('Long callback error', {
        error: (error as Error).message,
        callbackData,
        userId: ctx.from?.id
      });
      await ctx.answerCbQuery('❌ 操作失败，请重试');
    }
  }

  /**
   * 处理杠杆选择回调
   */
  private async handleLeverageSelection(ctx: ExtendedContext, callbackData: string): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      await ctx.answerCbQuery('❌ 无法获取用户信息，请重试');
      return;
    }
    const leverage = callbackData.split('_')[3]; // long_leverage_BTC_3x
    
    const state = await tradingStateService.getState(userId);
    if (!state || !state.symbol) {
      await ctx.answerCbQuery('❌ 会话已过期，请重新开始');
      return;
    }

    // 更新状态
    await tradingStateService.updateState(userId, {
      leverage: leverage,
      step: 'amount'
    });

    await ctx.answerCbQuery(`✅ 已选择 ${leverage} 杠杆`);

    // 显示金额输入提示
    // 获取可用保证金
    const accountBalance = await accountService.getAccountBalance(userId);
    const availableMargin = accountBalance.withdrawableAmount || 0;
    
    const message = messageFormatter.formatTradingAmountPrompt(
      'long',
      state.symbol,
      leverage,
      availableMargin
    );

    await ctx.editMessageText(message, { parse_mode: 'HTML' });
  }

  /**
   * 执行实际交易
   */
  private async executeTrading(ctx: ExtendedContext, action: 'long', symbol: string, leverage: string, amount: string): Promise<void> {
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';

    try {
      await ctx.answerCbQuery('🔄 正在执行交易...');
      
      // 获取用户数据和访问令牌（一次调用）
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

      // 获取代币价格用于计算size
      const tokenData = await tokenService.getTokenPrice(symbol);
      const size = parseFloat(amount) / tokenData.price;
      
      // 调用交易API - 添加内部userId
      const tradingData = {
        userId: userData.userId,                       // ✅ 使用内部用户ID
        symbol: symbol.toUpperCase(),
        leverage: parseInt(leverage.replace('x', '')), // 转换为数字
        size: size,                                    // 计算的代币数量
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

      // 检查API响应以确定是否真正成功
      const apiResult = result as any; // 类型断言
      let successMessage = '';
      if (apiResult && apiResult.success !== false && !apiResult.error) {
        // 交易成功日志
        logger.info('🎯 [TRADING SUCCESS] Long position opened', {
          symbol: symbol.toUpperCase(),
          leverage: leverage,
          amount: `$${amount}`,
          orderId: apiResult.data?.orderId || 'N/A'
        });
        
        // 只有确认成功才显示成功消息
        successMessage = `✅ <b>做多开仓成功</b>\n\n` +
          `代币: <code>${symbol.toUpperCase()}</code>\n` +
          `杠杆: <code>${leverage}</code>\n` +
          `金额: <code>$${amount}</code>\n\n` +
          `🎯 <b>建议操作:</b>\n` +
          `• 使用 /positions 查看持仓\n` +
          `• 使用 /wallet 查看余额变化`;
      } else {
        // 如果响应表明失败，抛出错误
        throw new Error(apiResult?.message || 'Hyperliquid API返回失败状态');
      }

      await ctx.editMessageText(successMessage, { parse_mode: 'HTML' });

    } catch (error: any) {
      // 详细记录API错误信息用于调试
      logger.error('🚨 Long Trading API Error - Complete Details:', {
        userId,
        symbol: symbol.toUpperCase(),
        leverage,
        amount,
        errorStatus: error.response?.status,
        errorData: error.response?.data,
        errorMessage: error.message
      });
      
      await ctx.answerCbQuery('❌ 交易执行失败');
      
      // 解析API错误，提供更友好的错误信息
      let errorMessage = '❌ <b>交易执行失败</b>\n\n';
      
      // 检查是否是余额不足错误
      if (error.response?.status === 400) {
        const responseData = error.response?.data;
        const errorMsg = responseData?.message || error.message || '';
        
        // Handle new API error codes
        if (errorMsg.includes('Builder fee has not been approved')) {
          errorMessage = '🔧 <b>Builder Fee Approval Required</b>\n\n' +
            `First-time trading requires builder fee approval\n\n` +
            `💡 <b>Solution:</b>\n` +
            `• This is a one-time setup, please confirm approval\n` +
            `• After approval, all trading will work normally\n` +
            `• If the issue persists, please contact support`;
        } else if (errorMsg.includes('size must be a positive number')) {
          errorMessage = '📊 <b>Trading Size Parameter Error</b>\n\n' +
            `Calculated token amount is invalid\n\n` +
            `💡 <b>Possible causes:</b>\n` +
            `• Price data retrieval failed\n` +
            `• Trading amount too small\n` +
            `• Please try again later or increase trading amount`;
        } else if (errorMsg.includes('余额不足') || errorMsg.includes('insufficient') || errorMsg.toLowerCase().includes('balance')) {
          errorMessage = '💰 <b>Insufficient Account Balance</b>\n\n' +
            `Cannot complete $${amount} long trade\n\n` +
            `💡 <b>Solutions:</b>\n` +
            `• Use /wallet to check current balance\n` +
            `• Deposit more USDC to wallet\n` +
            `• Reduce trading amount\n\n` +
            `<i>💸 Note: Hyperliquid minimum trade amount is $10</i>`;
        } else if (errorMsg.includes('minimum') || errorMsg.includes('最小') || parseFloat(amount) < 10) {
          errorMessage = '💰 <b>Trading Amount Requirements Not Met</b>\n\n' +
            `Hyperliquid minimum trade amount is <b>$10</b>\n` +
            `Your amount: <code>$${amount}</code>\n\n` +
            `💡 <b>Please adjust to at least $10:</b>\n` +
            `<code>/long ${symbol.toUpperCase()} ${leverage} 10</code>`;
        } else {
          errorMessage += `Parameter error: ${errorMsg}\n\n` +
            `<i>Please check trading parameters or try again later</i>`;
        }
      } else if (error.response?.status === 401) {
        const responseData = error.response?.data;
        const errorMsg = responseData?.message || error.message || '';
        
        if (errorMsg.includes('Invalid access token')) {
          errorMessage = '🔑 <b>Invalid Access Token</b>\n\n' +
            `Your login session has expired\n\n` +
            `💡 <b>Solution:</b>\n` +
            `• Use /start to reinitialize\n` +
            `• This will automatically refresh your access permissions`;
        } else {
          errorMessage += `Authentication failed, please log in again\n\n` +
            `<i>Use /start to restart</i>`;
        }
      } else if (error.response?.status >= 500) {
        errorMessage += `Server temporarily unavailable\n\n` +
          `<i>Please try again later</i>`;
      } else {
        errorMessage += `${error.message}\n\n` +
          `<i>Please try again later or contact support</i>`;
      }
      
      await ctx.editMessageText(errorMessage, { parse_mode: 'HTML' });
    }
  }

  /**
   * 创建杠杆选择键盘
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
  public createConfirmationKeyboard(symbol: string, leverage: string, amount: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '❌ Cancel', callback_data: `long_cancel_${symbol}_${leverage}_${amount}` },
          { text: '✅ Confirm', callback_data: `long_confirm_${symbol}_${leverage}_${amount}` }
        ]
      ]
    };
  }

  /**
   * 计算强制平仓价格
   */
  private calculateLiquidationPrice(currentPrice: number, leverage: number, direction: 'long' | 'short'): number {
    // 简化计算，实际应该更复杂
    const marginRatio = 0.05; // 5% 维持保证金率
    const liquidationRatio = (leverage - 1) / leverage * (1 - marginRatio);
    
    if (direction === 'long') {
      return currentPrice * (1 - liquidationRatio);
    } else {
      return currentPrice * (1 + liquidationRatio);
    }
  }

  /**
   * 获取处理器统计信息
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

// 导出单例实例
export const longHandler = new LongHandler();

// 默认导出
export default longHandler;
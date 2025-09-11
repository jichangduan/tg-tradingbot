import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { apiService } from '../../services/api.service';
import { tokenService } from '../../services/token.service';
import { getUserAccessToken } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { handleTradingError } from '../../utils/error-handler';
import { ExtendedContext } from '../index';
import { accountService } from '../../services/account.service';
import { tradingStateService, TradingState } from '../../services/trading-state.service';
import { messageFormatter } from '../utils/message.formatter';

/**
 * Short command handler
 * Supports two modes: guided mode and quick mode
 */
export class ShortHandler {
  /**
   * Handle /short command - supports two modes
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('short', userId!, username, args);

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
        await this.handleGuidedMode(ctx, 'short');
        return;
      } else if (args.length === 1) {
        // Guided mode: only token provided, jump to leverage selection
        await this.handleGuidedMode(ctx, 'short', args[0]);
        return;
      } else if (args.length === 3) {
        // Quick mode: complete parameters, handle directly
        await this.handleQuickMode(ctx, args);
        return;
      } else {
        // Incorrect parameter count
        await ctx.reply(
          messageFormatter.formatTradingCommandErrorMessage('short'),
          { parse_mode: 'HTML' }
        );
        return;
      }

    } catch (error) {
      // Use unified error handling for system exceptions
      await handleTradingError(ctx, error, 'short', args[0], args[2]);
    }
  }

  /**
   * Handle guided mode
   */
  private async handleGuidedMode(ctx: ExtendedContext, action: 'short', symbol?: string): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      await ctx.reply('❌ Unable to get user information, please retry');
      return;
    }
    
    if (!symbol) {
      // 第一步：选择代币
      const state = await tradingStateService.createState(userId, action);
      const message = messageFormatter.formatTradingSymbolPrompt(action);
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    } else {
      // 跳到第二步：选择杠杆 (已有代币)
      const state = await tradingStateService.createState(userId, action, symbol.toUpperCase());
      
      try {
        // 获取当前价格和可用保证金
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

    // 基础验证
    if (!symbol || !leverageStr || !amountStr) {
      await ctx.reply(
        messageFormatter.formatTradingCommandErrorMessage('short'),
        { parse_mode: 'HTML' }
      );
      return;
    }

    // 验证交易金额格式
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        `❌ <b>交易金额错误</b>\n\n` +
        `请输入有效的数字金额\n\n` +
        `示例: <code>/short BTC 10x 100</code>`,
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
        `<code>/short ${symbol.toUpperCase()} ${leverageStr} 10</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // 发送处理中消息
    const loadingMessage = await ctx.reply(
      messageFormatter.formatTradingProcessingMessage('short', symbol, leverageStr, amountStr),
      { parse_mode: 'HTML' }
    );

    try {
      // 获取用户访问令牌
      const accessToken = await getUserAccessToken(userId!.toString(), {
        username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // 获取代币价格用于计算size
      const tokenData = await tokenService.getTokenPrice(symbol);
      const size = parseFloat(amountStr) / tokenData.price;
      
      // 准备交易数据
      const tradingData = {
        symbol: symbol.toUpperCase(),
        leverage: parseInt(leverageStr.replace('x', '')), // 转换为数字
        size: size,                                       // 计算的代币数量
        orderType: "market"
      };

      // 检查余额是否足够
      const requiredAmount = parseFloat(amountStr);
      if (isNaN(requiredAmount) || requiredAmount <= 0) {
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          '❌ <b>交易参数错误</b>\n\n' +
          '请输入有效的数量\n\n' +
          '示例: <code>/short BTC 10x 200</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 检查账户余额 - 考虑杠杆倍数
      try {
        const leverageNum = parseFloat(leverageStr.replace('x', ''));
        
        if (leverageNum > 1) {
          // 杠杆交易：检查合约账户可用保证金
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
                errorMessage = `💰 <b>可用保证金不足</b>\n\n` +
                  `合约账户总价值: <code>$${contractAccountValue.toFixed(2)}</code>\n` +
                  `可用保证金: <code>$${marginCheck.availableMargin.toFixed(2)}</code>\n` +
                  `所需保证金: <code>$${marginCheck.requiredMargin.toFixed(2)}</code>\n\n` +
                  `💡 <b>原因分析:</b>\n` +
                  `• 您的资金被现有持仓占用作保证金\n` +
                  `• 杠杆交易需要足够的可用保证金\n\n` +
                  `🔧 <b>解决方案:</b>\n` +
                  `• 平仓部分持仓释放保证金\n` +
                  `• 降低交易金额: <code>/short ${symbol.toUpperCase()} ${leverageStr} ${Math.floor(marginCheck.availableMargin * leverageNum)}</code>\n` +
                  `• 减少杠杆倍数\n` +
                  `• 充值更多USDC到合约账户`;
                break;
              case 'no_funds':
                errorMessage = `💰 <b>合约账户无资金</b>\n\n` +
                  `杠杆交易需要使用合约账户资金\n` +
                  `当前合约账户余额: <code>$0</code>\n\n` +
                  `💡 <b>解决方案:</b>\n` +
                  `• 向钱包充值USDC\n` +
                  `• 使用 /wallet 查看账户状态`;
                break;
              default:
                errorMessage = `💰 <b>保证金不足</b>\n\n` +
                  `所需保证金: <code>$${marginCheck.requiredMargin.toFixed(2)}</code>\n` +
                  `可用保证金: <code>$${marginCheck.availableMargin.toFixed(2)}</code>\n\n` +
                  `💡 <b>解决方案:</b>\n` +
                  `• 降低交易金额或杠杆倍数\n` +
                  `• 向合约账户充值更多USDC`;
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
        } else {
          // 现货交易：检查现货余额
          const hasEnoughBalance = await accountService.checkSufficientBalance(
            userId!.toString(),
            requiredAmount,
            'USDC',
            1
          );

          if (!hasEnoughBalance) {
            await ctx.telegram.editMessageText(
              ctx.chat?.id,
              loadingMessage.message_id,
              undefined,
              messageFormatter.formatTradingInsufficientFundsMessage(),
              { parse_mode: 'HTML' }
            );
            return;
          }
        }
      } catch (balanceError) {
        logger.warn(`Failed to check balance for short trading`, {
          userId,
          requiredAmount,
          leverage: leverageStr,
          error: (balanceError as Error).message,
          requestId
        });
        // 如果余额检查失败，继续执行交易（让后端处理）
      }

      // 关键交易请求日志
      logger.info(`🚀 [SHORT ORDER] ${symbol.toUpperCase()} ${leverageStr} $${amountStr}`);
      
      // 简化接口数据日志
      logger.debug(`📤 Request data: ${JSON.stringify(tradingData)}`);

      // 显示订单预览而不是直接执行交易
      // 修复：用户实际购买的代币数量（不考虑杠杆）
      const orderSize = parseFloat(amountStr) / tokenData.price;
      const liquidationPrice = this.calculateLiquidationPrice(tokenData.price, parseFloat(leverageStr.replace('x', '')), 'short');
      
      const previewMessage = messageFormatter.formatTradingOrderPreview(
        'short',
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

      // 移除详细性能日志，减少噪音

    } catch (apiError: any) {
      // 关键交易失败日志
      logger.error(`❌ [SHORT FAILED] ${symbol.toUpperCase()} ${leverageStr} $${amountStr}: ${apiError.message}`);
      
      // 简化错误数据日志
      if (apiError.response?.data) {
        logger.debug(`📥 Error response: ${JSON.stringify(apiError.response.data)}`);
      }
      
      // 使用统一错误处理系统
      await handleTradingError(
        ctx, 
        apiError, 
        'short', 
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
      if (callbackData.startsWith('short_confirm_')) {
        // Confirm execution of trade
        const [, , symbol, leverage, amount] = callbackData.split('_');
        await this.executeTrading(ctx, 'short', symbol, leverage, amount);
      } else if (callbackData.startsWith('short_cancel_')) {
        // Cancel trade
        await ctx.answerCbQuery('❌ Trade cancelled');
        await ctx.editMessageText(
          '❌ <b>Trade Cancelled</b>\n\nYou can restart trading anytime',
          { parse_mode: 'HTML' }
        );
      } else if (callbackData.startsWith('short_leverage_')) {
        // 处理杠杆选择回调
        await this.handleLeverageSelection(ctx, callbackData);
      }
    } catch (error) {
      logger.error('Short callback error', {
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
    const leverage = callbackData.split('_')[3]; // short_leverage_BTC_3x
    
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
      'short',
      state.symbol,
      leverage,
      availableMargin
    );

    await ctx.editMessageText(message, { parse_mode: 'HTML' });
  }

  /**
   * 执行实际交易
   */
  private async executeTrading(ctx: ExtendedContext, action: 'short', symbol: string, leverage: string, amount: string): Promise<void> {
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';

    try {
      await ctx.answerCbQuery('🔄 正在执行交易...');
      
      // 获取用户访问令牌
      const accessToken = await getUserAccessToken(userId!.toString(), {
        username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // 获取代币价格用于计算size
      const tokenData = await tokenService.getTokenPrice(symbol);
      const size = parseFloat(amount) / tokenData.price;
      
      // 调用交易API
      const tradingData = {
        symbol: symbol.toUpperCase(),
        leverage: parseInt(leverage.replace('x', '')), // 转换为数字
        size: size,                                    // 计算的代币数量
        orderType: "market"
      };

      // 🚀 显眼的API参数日志
      logger.info('🚀🚀🚀 SHORT TRADING API CALL - DETAILED PARAMETERS 🚀🚀🚀');
      logger.info('═══════════════════════════════════════════════════════');
      logger.info('📋 Trading Request Details:', {
        endpoint: '/api/tgbot/trading/short',
        userId,
        symbol: symbol.toUpperCase(),
        leverage: `${leverage.replace('x', '')} (${leverage})`,
        userInputAmount: `$${amount}`,
        tokenPrice: `$${tokenData.price.toFixed(2)}`,
        calculatedSize: `${size.toFixed(8)} ${symbol.toUpperCase()}`,
        orderType: 'market'
      });
      logger.info('📦 Complete Request Payload:', tradingData);
      logger.info('🔐 Authentication Status:', {
        hasAccessToken: !!accessToken,
        tokenLength: accessToken?.length || 0,
        tokenPreview: accessToken ? `${accessToken.substring(0, 10)}...` : 'none'
      });
      logger.info('═══════════════════════════════════════════════════════');

      const result = await apiService.postWithAuth(
        '/api/tgbot/trading/short',
        accessToken,
        tradingData
      );
      
      // 简化接口返回数据日志
      logger.debug(`📥 Response data: ${JSON.stringify(result)}`);

      // 检查API响应以确定是否真正成功
      const apiResult = result as any; // 类型断言
      let successMessage = '';
      if (apiResult && apiResult.success !== false && !apiResult.error) {
        // 打印显眼的交易成功日志
        logger.info('🎯 [TRADING SUCCESS] Short position opened');
        logger.info('==============================================');
        logger.info('📊 Trading Details:', {
          symbol: symbol.toUpperCase(),
          leverage: leverage,
          amount: `$${amount}`,
          orderId: apiResult.data?.orderId || 'N/A',
          side: 'SHORT'
        });
        
        // 打印保证金信息（如果API返回了）
        if (apiResult.data) {
          logger.info('💰 Margin Information:', {
            requiredMargin: apiResult.data.requiredMargin || 'N/A',
            availableMargin: apiResult.data.availableMargin || 'N/A',
            marginUsage: apiResult.data.marginUsage || 'N/A',
            leverageConfirmed: apiResult.data.leverage || leverage
          });
        }
        logger.info('==============================================');
        
        // 只有确认成功才显示成功消息
        successMessage = `✅ <b>做空开仓成功</b>\n\n` +
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
      logger.error('🚨 Short Trading API Error - Complete Details:', {
        userId,
        symbol: symbol.toUpperCase(),
        leverage,
        amount,
        requestData: {
          symbol: symbol.toUpperCase(),
          leverage: parseInt(leverage.replace('x', '')),
          amount: parseFloat(amount),
          orderType: "market",
          telegram_id: userId?.toString()
        },
        errorStatus: error.response?.status,
        errorData: error.response?.data,
        errorMessage: error.message,
        errorHeaders: error.response?.headers,
        fullError: error.toString()
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
            `Cannot complete $${amount} short trade\n\n` +
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
            `<code>/short ${symbol.toUpperCase()} ${leverage} 10</code>`;
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
          { text: '1x', callback_data: `short_leverage_${symbol}_1x` },
          { text: '2x', callback_data: `short_leverage_${symbol}_2x` },
          { text: '3x', callback_data: `short_leverage_${symbol}_3x` }
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
          { text: '❌ Cancel', callback_data: `short_cancel_${symbol}_${leverage}_${amount}` },
          { text: '✅ Confirm', callback_data: `short_confirm_${symbol}_${leverage}_${amount}` }
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
      name: 'ShortHandler',
      version: '2.0.0',
      supportedCommands: ['/short'],
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
export const shortHandler = new ShortHandler();

// 默认导出
export default shortHandler;
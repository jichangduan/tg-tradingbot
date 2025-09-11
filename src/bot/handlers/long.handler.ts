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
 * Long命令处理器
 * 支持两种模式：引导模式和快捷模式
 */
export class LongHandler {
  /**
   * 处理 /long 命令 - 支持两种模式
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('long', userId!, username, args);

      // 检查用户是否有活跃的交易状态
      const activeState = await tradingStateService.getState(userId!.toString());
      if (activeState) {
        await ctx.reply(
          '⚠️ <b>您已有进行中的交易流程</b>\n\n' +
          '请完成当前交易或发送 /cancel 取消当前流程',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 根据参数数量决定处理模式
      if (args.length === 0) {
        // 引导模式：无参数，开始分步引导
        await this.handleGuidedMode(ctx, 'long');
        return;
      } else if (args.length === 1) {
        // 引导模式：只提供了代币，跳到杠杆选择
        await this.handleGuidedMode(ctx, 'long', args[0]);
        return;
      } else if (args.length === 3) {
        // 快捷模式：完整参数，直接处理
        await this.handleQuickMode(ctx, args);
        return;
      } else {
        // 参数数量不正确
        await ctx.reply(
          messageFormatter.formatTradingCommandErrorMessage('long'),
          { parse_mode: 'HTML' }
        );
        return;
      }

    } catch (error) {
      // 使用统一错误处理处理系统异常
      await handleTradingError(ctx, error, 'long', args[0], args[2]);
    }
  }

  /**
   * 处理引导模式
   */
  private async handleGuidedMode(ctx: ExtendedContext, action: 'long', symbol?: string): Promise<void> {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      await ctx.reply('❌ 无法获取用户信息，请重试');
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
          `❌ 无法获取 ${symbol.toUpperCase()} 的价格信息，请稍后重试`,
          { parse_mode: 'HTML' }
        );
      }
    }
  }

  /**
   * 处理快捷模式
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
        messageFormatter.formatTradingCommandErrorMessage('long'),
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
        `示例: <code>/long BTC 10x 100</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // 验证Hyperliquid最小交易金额 ($10)
    if (amount < 10) {
      await ctx.reply(
        `💰 <b>交易金额不足</b>\n\n` +
        `Hyperliquid最小交易金额为 <b>$10</b>\n` +
        `您的金额: <code>$${amount}</code>\n\n` +
        `💡 <b>请调整为至少$10:</b>\n` +
        `<code>/long ${symbol.toUpperCase()} ${leverageStr} 10</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // 发送处理中消息
    const loadingMessage = await ctx.reply(
      messageFormatter.formatTradingProcessingMessage('long', symbol, leverageStr, amountStr),
      { parse_mode: 'HTML' }
    );

    try {
      // 获取用户访问令牌
      const accessToken = await getUserAccessToken(userId!.toString(), {
        username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // 准备交易数据
      const tradingData = {
        symbol: symbol.toUpperCase(),
        leverage: parseInt(leverageStr.replace('x', '')), // 转换为数字
        amount: parseFloat(amountStr),                    // 转换为数字
        orderType: "market",
        telegram_id: userId?.toString()                   // 可能需要的字段
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
          '示例: <code>/long BTC 10x 200</code>',
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
                  `• 降低交易金额: <code>/long ${symbol.toUpperCase()} ${leverageStr} ${Math.floor(marginCheck.availableMargin * leverageNum)}</code>\n` +
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
        logger.warn(`Failed to check balance for long trading`, {
          userId,
          requiredAmount,
          leverage: leverageStr,
          error: (balanceError as Error).message,
          requestId
        });
        // 如果余额检查失败，继续执行交易（让后端处理）
      }

      // 关键交易请求日志
      logger.info(`🚀 [LONG ORDER] ${symbol.toUpperCase()} ${leverageStr} $${amountStr}`);
      
      // 简化接口数据日志
      logger.debug(`📤 Request data: ${JSON.stringify(tradingData)}`);

      // 显示订单预览而不是直接执行交易
      const tokenData = await tokenService.getTokenPrice(symbol);
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

      // 移除详细性能日志，减少噪音

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
   * 处理交易回调查询（确认/取消按钮）
   */
  public async handleCallback(ctx: ExtendedContext, callbackData: string): Promise<void> {
    try {
      if (callbackData.startsWith('long_confirm_')) {
        // 确认执行交易
        const [, , symbol, leverage, amount] = callbackData.split('_');
        await this.executeTrading(ctx, 'long', symbol, leverage, amount);
      } else if (callbackData.startsWith('long_cancel_')) {
        // 取消交易
        await ctx.answerCbQuery('❌ 交易已取消');
        await ctx.editMessageText(
          '❌ <b>交易已取消</b>\n\n您可以随时重新开始交易',
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
      
      // 获取用户访问令牌
      const accessToken = await getUserAccessToken(userId!.toString(), {
        username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // 调用交易API
      const tradingData = {
        symbol: symbol.toUpperCase(),
        leverage: parseInt(leverage.replace('x', '')), // 转换为数字
        amount: parseFloat(amount),                    // 转换为数字
        orderType: "market",
        telegram_id: userId?.toString()               // 可能需要的字段
      };

      // 详细记录API请求信息用于调试
      logger.info('📤 Long Trading API Request - Complete Details:', {
        endpoint: '/api/tgbot/trading/long',
        userId,
        requestData: tradingData,
        hasAccessToken: !!accessToken,
        tokenLength: accessToken?.length || 0
      });

      const result = await apiService.postWithAuth(
        '/api/tgbot/trading/long',
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
        logger.info('🎯 [TRADING SUCCESS] Long position opened');
        logger.info('==============================================');
        logger.info('📊 Trading Details:', {
          symbol: symbol.toUpperCase(),
          leverage: leverage,
          amount: `$${amount}`,
          orderId: apiResult.data?.orderId || 'N/A',
          side: 'LONG'
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
        
        if (errorMsg.includes('余额不足') || errorMsg.includes('insufficient') || errorMsg.toLowerCase().includes('balance')) {
          errorMessage = '💰 <b>账户余额不足</b>\n\n' +
            `无法完成$${amount}的做多交易\n\n` +
            `💡 <b>解决方案:</b>\n` +
            `• 使用 /wallet 查看当前余额\n` +
            `• 向钱包充值更多USDC\n` +
            `• 减少交易金额\n\n` +
            `<i>💸 提醒: Hyperliquid最小交易金额为$10</i>`;
        } else if (errorMsg.includes('minimum') || errorMsg.includes('最小') || parseFloat(amount) < 10) {
          errorMessage = '💰 <b>交易金额不符合要求</b>\n\n' +
            `Hyperliquid最小交易金额为 <b>$10</b>\n` +
            `您的金额: <code>$${amount}</code>\n\n` +
            `💡 <b>请调整为至少$10:</b>\n` +
            `<code>/long ${symbol.toUpperCase()} ${leverage} 10</code>`;
        } else {
          errorMessage += `参数错误: ${errorMsg}\n\n` +
            `<i>请检查交易参数或稍后重试</i>`;
        }
      } else if (error.response?.status === 401) {
        errorMessage += `认证失败，请重新登录\n\n` +
          `<i>使用 /start 重新开始</i>`;
      } else if (error.response?.status >= 500) {
        errorMessage += `服务器暂时不可用\n\n` +
          `<i>请稍后重试</i>`;
      } else {
        errorMessage += `${error.message}\n\n` +
          `<i>请稍后重试或联系客服</i>`;
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
   * 创建确认键盘
   */
  public createConfirmationKeyboard(symbol: string, leverage: string, amount: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '❌ 取消', callback_data: `long_cancel_${symbol}_${leverage}_${amount}` },
          { text: '✅ 确认', callback_data: `long_confirm_${symbol}_${leverage}_${amount}` }
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
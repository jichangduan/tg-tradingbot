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
 * Short命令处理器
 * 支持两种模式：引导模式和快捷模式
 */
export class ShortHandler {
  /**
   * 处理 /short 命令 - 支持两种模式
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('short', userId!, username, args);

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
        await this.handleGuidedMode(ctx, 'short');
        return;
      } else if (args.length === 1) {
        // 引导模式：只提供了代币，跳到杠杆选择
        await this.handleGuidedMode(ctx, 'short', args[0]);
        return;
      } else if (args.length === 3) {
        // 快捷模式：完整参数，直接处理
        await this.handleQuickMode(ctx, args);
        return;
      } else {
        // 参数数量不正确
        await ctx.reply(
          messageFormatter.formatTradingCommandErrorMessage('short'),
          { parse_mode: 'HTML' }
        );
        return;
      }

    } catch (error) {
      // 使用统一错误处理处理系统异常
      await handleTradingError(ctx, error, 'short', args[0], args[2]);
    }
  }

  /**
   * 处理引导模式
   */
  private async handleGuidedMode(ctx: ExtendedContext, action: 'short', symbol?: string): Promise<void> {
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
        const availableMargin = 30.74; // 示例值，实际应从accountService获取
        
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
        messageFormatter.formatTradingCommandErrorMessage('short'),
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

      // 准备交易数据
      const tradingData = {
        symbol: symbol.toUpperCase(),
        leverage: leverageStr,
        amount: amountStr,
        telegram_id: userId!.toString()
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

      // 检查账户余额
      try {
        const hasEnoughBalance = await accountService.checkSufficientBalance(
          userId!.toString(),
          requiredAmount,
          'USDC'
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
      } catch (balanceError) {
        logger.warn(`Failed to check balance for short trading`, {
          userId,
          requiredAmount,
          error: (balanceError as Error).message,
          requestId
        });
        // 如果余额检查失败，继续执行交易（让后端处理）
      }

      // 显示订单预览而不是直接执行交易
      const tokenData = await tokenService.getTokenPrice(symbol);
      const orderSize = parseFloat(amountStr) / tokenData.price * parseFloat(leverageStr.replace('x', ''));
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

      const duration = Date.now() - startTime;
      logger.logPerformance('short_preview_success', duration, {
        symbol,
        leverage: leverageStr,
        amount: amountStr,
        userId,
        username,
        requestId
      });

    } catch (apiError: any) {
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
   * 处理交易回调查询（确认/取消按钮）
   */
  public async handleCallback(ctx: ExtendedContext, callbackData: string): Promise<void> {
    try {
      if (callbackData.startsWith('short_confirm_')) {
        // 确认执行交易
        const [, , symbol, leverage, amount] = callbackData.split('_');
        await this.executeTrading(ctx, 'short', symbol, leverage, amount);
      } else if (callbackData.startsWith('short_cancel_')) {
        // 取消交易
        await ctx.answerCbQuery('❌ 交易已取消');
        await ctx.editMessageText(
          '❌ <b>交易已取消</b>\n\n您可以随时重新开始交易',
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
    const message = messageFormatter.formatTradingAmountPrompt(
      'short',
      state.symbol,
      leverage,
      30.74 // 示例可用保证金
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

      // 调用交易API
      const tradingData = {
        symbol: symbol.toUpperCase(),
        leverage: leverage,
        amount: amount,
        telegram_id: userId!.toString()
      };

      const result = await apiService.postWithAuth(
        '/api/tgbot/trading/short',
        accessToken,
        tradingData
      );

      // 编辑消息显示成功结果
      await ctx.editMessageText(
        `✅ <b>做空交易已提交</b>\n\n` +
        `代币: <code>${symbol.toUpperCase()}</code>\n` +
        `杠杆: <code>${leverage}</code>\n` +
        `金额: <code>${amount}</code>\n\n` +
        `<i>交易正在处理中，请稍候...</i>`,
        { parse_mode: 'HTML' }
      );

    } catch (error: any) {
      await ctx.answerCbQuery('❌ 交易执行失败');
      
      // 解析API错误，提供更友好的错误信息
      let errorMessage = '❌ <b>交易执行失败</b>\n\n';
      
      // 检查是否是余额不足错误
      if (error.response?.status === 400) {
        const responseData = error.response?.data;
        if (responseData?.message && responseData.message.includes('余额不足')) {
          errorMessage = '❌ <b>余额不足</b>\n\n' +
            `当前USDC余额不足以完成交易\n` +
            `交易金额: <code>${amount} USDC</code>\n\n` +
            `💡 <i>请先充值USDC到您的钱包</i>`;
        } else if (responseData?.message && (responseData.message.includes('insufficient') || responseData.message.toLowerCase().includes('balance'))) {
          errorMessage = '❌ <b>余额不足</b>\n\n' +
            `当前USDC余额不足以完成交易\n` +
            `交易金额: <code>${amount} USDC</code>\n\n` +
            `💡 <i>请使用 /wallet 查看余额并充值</i>`;
        } else {
          errorMessage += `参数错误: ${responseData?.message || '请检查交易参数'}\n\n` +
            `<i>请稍后重试或联系客服</i>`;
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
          { text: '1x', callback_data: `short_leverage_${symbol}_1x` },
          { text: '2x', callback_data: `short_leverage_${symbol}_2x` },
          { text: '3x', callback_data: `short_leverage_${symbol}_3x` }
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
          { text: '❌ 取消', callback_data: `short_cancel_${symbol}_${leverage}_${amount}` },
          { text: '✅ 确认', callback_data: `short_confirm_${symbol}_${leverage}_${amount}` }
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
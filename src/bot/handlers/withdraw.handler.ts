import { Context } from 'telegraf';
import { ExtendedContext } from '../index';
import { apiService } from '../../services/api.service';
import { getUserDataAndToken } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { accountService } from '../../services/account.service';

/**
 * WithdrawHandler - 处理 /withdraw 命令
 * 提供资金提现功能，包含输入界面、确认界面和成功界面
 */
export class WithdrawHandler {
  private readonly commandName = '/withdraw';
  
  // 用户输入状态管理
  private userStates = new Map<string, {
    address?: string;
    amount?: string;
    step: 'address' | 'amount' | 'confirm';
    messageId?: number;
  }>();

  /**
   * 处理 /withdraw 命令
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id?.toString();
    const username = ctx.from?.username || 'unknown';
    const requestId = `withdraw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // 验证用户ID
      if (!userId) {
        await ctx.reply('❌ Unable to identify user', { parse_mode: 'HTML' });
        return;
      }

      logger.info(`Withdraw command started [${requestId}]`, {
        telegramId: parseInt(userId),
        username,
        commandName: this.commandName,
        requestId
      });

      // 显示输入界面
      await this.showInputInterface(ctx, userId);

      const duration = Date.now() - startTime;
      logger.info(`Withdraw command completed [${requestId}] - ${duration}ms`, {
        telegramId: parseInt(userId),
        username,
        duration,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Withdraw command failed [${requestId}] - ${duration}ms`, {
        error: (error as Error).message,
        telegramId: userId ? parseInt(userId) : 0,
        username,
        requestId
      });

      await ctx.reply('❌ Withdraw function temporarily unavailable, please try again later', { 
        parse_mode: 'HTML' 
      });
    }
  }

  /**
   * 显示输入界面
   */
  private async showInputInterface(ctx: ExtendedContext, userId: string): Promise<void> {
    // 初始化用户状态
    this.userStates.set(userId, {
      step: 'address'
    });

    const message = `💸 <b>/Withdraw</b>

📝 <b>Please enter your withdrawal details:</b>

<i>Please enter your Arbitrum wallet address for withdrawal</i>
<code>Enter wallet address...</code>

<i>Please enter your withdrawal amount (USDT)</i>  
<code>Enter amount...</code>

💡 <i>Instructions:</i>
• First reply with your Arbitrum wallet address
• Then reply with the withdrawal amount
• Make sure your address starts with 0x`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Max', callback_data: 'withdraw_max' }
        ],
        [
          { text: 'Cancel', callback_data: 'withdraw_cancel' }
        ]
      ]
    };

    const sentMessage = await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });

    // 更新用户状态，保存消息ID
    const currentState = this.userStates.get(userId);
    if (currentState) {
      currentState.messageId = sentMessage.message_id;
      this.userStates.set(userId, currentState);
    }
  }

  /**
   * 处理用户文本输入
   */
  public async handleUserInput(ctx: ExtendedContext): Promise<boolean> {
    const userId = ctx.from?.id?.toString();
    const userInput = ctx.message && 'text' in ctx.message ? ctx.message.text : '';

    if (!userId || !userInput) {
      return false;
    }

    const userState = this.userStates.get(userId);
    if (!userState) {
      return false; // 用户没有在提现流程中
    }

    try {
      if (userState.step === 'address') {
        // 处理地址输入
        const validation = this.validateAddress(userInput);
        if (!validation.isValid) {
          await ctx.reply(`❌ ${validation.error}`, { parse_mode: 'HTML' });
          return true;
        }

        userState.address = userInput;
        userState.step = 'amount';
        this.userStates.set(userId, userState);

        await ctx.reply(`✅ Address saved: <code>${userInput}</code>

Now please enter the withdrawal amount (USDT):`, { parse_mode: 'HTML' });
        return true;

      } else if (userState.step === 'amount') {
        // 处理金额输入
        const validation = this.validateAmount(userInput);
        if (!validation.isValid) {
          await ctx.reply(`❌ ${validation.error}`, { parse_mode: 'HTML' });
          return true;
        }

        userState.amount = userInput;
        userState.step = 'confirm';
        this.userStates.set(userId, userState);

        // 显示确认界面
        await this.showConfirmInterface(ctx, userId, userState.address!, userState.amount!);
        return true;
      }

    } catch (error) {
      logger.error('Error handling user input for withdraw', {
        telegramId: parseInt(userId),
        error: (error as Error).message
      });
      await ctx.reply('❌ Error processing your input, please try again', { parse_mode: 'HTML' });
    }

    return false;
  }

  /**
   * 显示确认界面
   */
  private async showConfirmInterface(ctx: ExtendedContext, userId: string, address: string, amount: string): Promise<void> {
    const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
    
    const message = `⚠️ <b>Confirm Withdrawal Details</b>

<b>Amount:</b> ${amount} USDT
<b>Address:</b> <code>${shortAddress}</code>
<b>Network:</b> Arbitrum
<b>Fee:</b> 1.00 USDT

Please verify the information and click confirm`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Confirm Withdrawal', callback_data: `withdraw_confirm_${amount}_${encodeURIComponent(address)}` }
        ],
        [
          { text: 'Cancel', callback_data: 'withdraw_cancel' }
        ]
      ]
    };

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  /**
   * 处理按钮回调
   */
  public async handleCallback(ctx: ExtendedContext): Promise<void> {
    const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    const userId = ctx.from?.id?.toString();

    if (!userId || !callbackData.startsWith('withdraw_')) {
      return;
    }

    try {
      await ctx.answerCbQuery(); // 确认回调

      if (callbackData === 'withdraw_cancel') {
        await this.handleCancel(ctx, userId);
      } else if (callbackData === 'withdraw_max') {
        await this.handleMaxAmount(ctx, userId);
      } else if (callbackData.startsWith('withdraw_confirm_')) {
        await this.handleConfirm(ctx, userId, callbackData);
      }

    } catch (error) {
      logger.error('Error handling withdraw callback', {
        telegramId: parseInt(userId),
        callbackData,
        error: (error as Error).message
      });
      await ctx.answerCbQuery('❌ Operation failed, please try again');
    }
  }

  /**
   * 处理取消操作
   */
  private async handleCancel(ctx: ExtendedContext, userId: string): Promise<void> {
    this.userStates.delete(userId);
    
    await ctx.editMessageText('❌ Withdrawal cancelled', {
      parse_mode: 'HTML'
    });
  }

  /**
   * 处理Max按钮
   */
  private async handleMaxAmount(ctx: ExtendedContext, userId: string): Promise<void> {
    try {
      // 获取用户余额
      const balance = await this.getUserBalance(userId);
      
      await ctx.answerCbQuery(`💰 Max available: $${balance} USDT`);
      
    } catch (error) {
      await ctx.answerCbQuery('❌ Unable to get balance info');
    }
  }

  /**
   * 处理确认提现
   */
  private async handleConfirm(ctx: ExtendedContext, userId: string, callbackData: string): Promise<void> {
    const parts = callbackData.replace('withdraw_confirm_', '').split('_');
    const amount = parts[0];
    const encodedAddress = parts.slice(1).join('_');
    const address = decodeURIComponent(encodedAddress);

    // 清除用户状态
    this.userStates.delete(userId);

    // 显示处理中消息
    await ctx.editMessageText('🔄 Processing withdrawal request...', {
      parse_mode: 'HTML'
    });

    try {
      // 调用API
      const result = await this.processWithdrawal(userId, amount, address);
      
      if (result.success) {
        // 显示成功界面
        await this.showSuccessInterface(ctx, amount);
      } else {
        await ctx.editMessageText(`❌ Withdrawal failed: ${result.error}`, {
          parse_mode: 'HTML'
        });
      }

    } catch (error) {
      logger.error('Withdrawal processing failed', {
        telegramId: parseInt(userId),
        amount,
        address,
        error: (error as Error).message
      });

      await ctx.editMessageText('❌ Withdrawal failed: Network error, please try again later', {
        parse_mode: 'HTML'
      });
    }
  }

  /**
   * 显示成功界面
   */
  private async showSuccessInterface(ctx: ExtendedContext, amount: string): Promise<void> {
    const message = `✅ <b>Withdrawal Submitted</b>

Your withdrawal request for <b>${amount} USDT</b> has been submitted successfully.

Your request will be processed within 24 hours.

Transaction details will be sent once confirmed.`;

    await ctx.editMessageText(message, {
      parse_mode: 'HTML'
    });
  }

  /**
   * 验证地址格式
   */
  private validateAddress(address: string): { isValid: boolean; error?: string } {
    if (!address || address.trim() === '') {
      return { isValid: false, error: 'Address cannot be empty' };
    }

    const trimmedAddress = address.trim();
    
    if (!trimmedAddress.startsWith('0x')) {
      return { isValid: false, error: 'Address must start with 0x' };
    }

    if (trimmedAddress.length !== 42) {
      return { isValid: false, error: 'Invalid address length (must be 42 characters)' };
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmedAddress)) {
      return { isValid: false, error: 'Address contains invalid characters' };
    }

    return { isValid: true };
  }

  /**
   * 验证金额格式
   */
  private validateAmount(amount: string): { isValid: boolean; error?: string } {
    if (!amount || amount.trim() === '') {
      return { isValid: false, error: 'Amount cannot be empty' };
    }

    const numAmount = parseFloat(amount);
    
    if (isNaN(numAmount)) {
      return { isValid: false, error: 'Amount must be a valid number' };
    }

    if (numAmount <= 0) {
      return { isValid: false, error: 'Amount must be greater than 0' };
    }

    if (numAmount < 10) {
      return { isValid: false, error: 'Minimum withdrawal amount is $10' };
    }

    return { isValid: true };
  }

  /**
   * 获取用户余额
   */
  private async getUserBalance(userId: string): Promise<string> {
    try {
      // 获取用户钱包余额信息
      const balance = await accountService.getAccountBalance(userId);
      
      // 优先使用withdrawableAmount，如果没有则使用totalUsdValue
      const availableBalance = balance.withdrawableAmount ?? balance.totalUsdValue ?? 0;
      
      logger.debug('User balance retrieved for withdraw', {
        telegramId: parseInt(userId),
        withdrawableAmount: balance.withdrawableAmount,
        totalUsdValue: balance.totalUsdValue,
        availableBalance
      });
      
      return availableBalance.toFixed(2);
    } catch (error) {
      logger.error('Failed to get user balance', {
        telegramId: parseInt(userId),
        error: (error as Error).message
      });
      return "0.00";
    }
  }

  /**
   * 处理提现请求
   */
  private async processWithdrawal(userId: string, amount: string, destination: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 获取用户数据和访问令牌
      const { userData, accessToken } = await getUserDataAndToken(userId, {
        username: undefined,
        first_name: undefined,
        last_name: undefined
      });

      logger.info('Processing withdrawal request', {
        telegramId: parseInt(userId),
        internalUserId: userData.userId,
        amount,
        destination: destination.substring(0, 10) + '...'
      });

      // 调用提现API
      const response = await apiService.postWithAuth(
        '/api/tgbot/withdraw',
        accessToken,
        {
          amount: amount,
          destination: destination
        }
      ) as any;

      if (response.code === 200) {
        logger.info('Withdrawal request successful', {
          telegramId: parseInt(userId),
          amount,
          transactionHash: response.data?.transactionHash
        });
        return { success: true };
      } else {
        logger.warn('Withdrawal request failed', {
          telegramId: parseInt(userId),
          amount,
          error: response.message
        });
        return { success: false, error: response.message || 'Unknown error' };
      }

    } catch (error) {
      logger.error('Withdrawal API call failed', {
        telegramId: parseInt(userId),
        amount,
        error: (error as Error).message
      });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 获取处理器统计信息
   */
  public getStats(): any {
    return {
      name: 'WithdrawHandler',
      version: '1.0.0',
      supportedCommands: ['/withdraw'],
      features: [
        'Address input and validation',
        'Amount input and validation',
        'Confirmation interface',
        'API integration',
        'Success feedback'
      ]
    };
  }
}

// 导出单例实例
export const withdrawHandler = new WithdrawHandler();

// 默认导出
export default withdrawHandler;
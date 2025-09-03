import { Context } from 'telegraf';
import { apiService } from '../../services/api.service';
import { getUserAccessToken } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { handleTradingError } from '../../utils/error-handler';
import { ExtendedContext } from '../index';

/**
 * Close命令处理器
 * 处理 /close <symbol> [percentage] 命令
 * 支持全仓平仓和部分平仓
 */
export class CloseHandler {
  /**
   * 处理 /close 命令
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('close', userId!, username, args);

      // 参数验证
      if (args.length === 0) {
        await ctx.reply(
          '❌ <b>参数不足</b>\n\n' +
          '正确格式:\n' +
          '• <code>/close &lt;symbol&gt;</code> - 全仓平仓\n' +
          '• <code>/close &lt;symbol&gt; &lt;percentage&gt;</code> - 部分平仓\n\n' +
          '<b>示例:</b>\n' +
          '• <code>/close BTC</code> - 平掉所有BTC仓位\n' +
          '• <code>/close ETH 50%</code> - 平掉50%的ETH仓位\n' +
          '• <code>/close SOL 0.5</code> - 平掉具体数量',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const symbol = args[0];
      const closeAmount = args[1] || '100%'; // 默认全仓平仓

      // 基础验证
      if (!symbol) {
        await ctx.reply(
          '❌ 请提供要平仓的代币符号\n\n' +
          '格式: <code>/close &lt;symbol&gt; [percentage]</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 验证平仓数量格式
      const { isValid, amount, isPercentage, errorMsg } = this.validateCloseAmount(closeAmount);
      if (!isValid) {
        await ctx.reply(
          `❌ <b>平仓数量格式错误</b>\n\n` +
          `输入值: <code>${closeAmount}</code>\n` +
          `错误: ${errorMsg}\n\n` +
          '<b>支持的格式:</b>\n' +
          '• 百分比: <code>50%</code>, <code>100%</code>\n' +
          '• 小数: <code>0.5</code>, <code>1.0</code>\n' +
          '• 整数: <code>1</code>, <code>10</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 发送处理中消息
      const loadingMessage = await ctx.reply(
        `🔄 <b>正在处理平仓操作...</b>\n\n` +
        `代币: <code>${symbol.toUpperCase()}</code>\n` +
        `平仓${isPercentage ? '比例' : '数量'}: <code>${closeAmount}</code>\n` +
        `操作类型: ${closeAmount === '100%' ? '全仓平仓' : '部分平仓'}`,
        { parse_mode: 'HTML' }
      );

      // 准备平仓数据（移到try块外以便重试时使用）
      // 修复：根据后端API期望格式化参数 (TgBotController.js line 428)
      const closeData = {
        symbol: symbol.toUpperCase(),
        // 如果是百分比，发送原始用户输入（已包含%）；如果是数量，发送数量字符串
        percentage: isPercentage ? closeAmount : amount.toString(),
        orderType: 'market'
      };

      try {
        // 获取用户访问令牌
        const accessToken = await getUserAccessToken(userId!.toString(), {
          username,
          first_name: ctx.from?.first_name,
          last_name: ctx.from?.last_name
        });

        // 调用平仓API
        logger.info(`Close position auth attempt [${requestId}]`, {
          userId,
          symbol,
          hasAccessToken: !!accessToken,
          tokenLength: accessToken?.length,
          requestId
        });

        const result = await apiService.postWithAuth(
          '/api/tgbot/trading/close',
          accessToken,
          closeData
        );

        // 编辑消息显示成功结果
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          `✅ <b>平仓操作已提交</b>\n\n` +
          `代币: <code>${symbol.toUpperCase()}</code>\n` +
          `平仓${isPercentage ? '比例' : '数量'}: <code>${closeAmount}</code>\n` +
          `操作类型: ${closeAmount === '100%' ? '全仓平仓' : '部分平仓'}\n\n` +
          `<i>平仓订单正在处理中，请稍候...</i>\n\n` +
          `💡 使用 <code>/positions</code> 查看最新仓位状态`,
          { parse_mode: 'HTML' }
        );

        const duration = Date.now() - startTime;
        logger.logPerformance('close_position_success', duration, {
          symbol,
          closeAmount,
          isPercentage,
          userId,
          username,
          requestId
        });

      } catch (apiError: any) {
        // 使用新的统一错误处理系统
        if (apiError.status === 401) {
          // 401错误：尝试刷新Token并重试
          logger.warn(`Close position 401 error, attempting token refresh [${requestId}]`, {
            userId,
            symbol,
            originalError: apiError.message,
            requestId
          });

          try {
            // 获取新的访问令牌
            const newAccessToken = await getUserAccessToken(userId!.toString(), {
              username,
              first_name: ctx.from?.first_name,
              last_name: ctx.from?.last_name
            });

            logger.info(`Token refreshed, retrying close position [${requestId}]`, {
              userId,
              symbol,
              hasNewToken: !!newAccessToken,
              requestId
            });

            // 用新Token重试API调用
            const retryResult = await apiService.postWithAuth(
              '/api/tgbot/trading/close',
              newAccessToken,
              closeData
            );

            // 重试成功，显示成功消息
            await ctx.telegram.editMessageText(
              ctx.chat?.id,
              loadingMessage.message_id,
              undefined,
              `✅ <b>平仓操作已提交</b>\n\n` +
              `代币: <code>${symbol.toUpperCase()}</code>\n` +
              `平仓${isPercentage ? '比例' : '数量'}: <code>${closeAmount}</code>\n` +
              `操作类型: ${closeAmount === '100%' ? '全仓平仓' : '部分平仓'}\n\n` +
              `<i>平仓订单正在处理中，请稍候...</i>\n\n` +
              `💡 使用 <code>/positions</code> 查看最新仓位状态`,
              { parse_mode: 'HTML' }
            );

            logger.info(`Close position retry success [${requestId}]`, {
              userId,
              symbol,
              closeAmount,
              requestId
            });

            return; // 成功，直接返回
          } catch (retryError: any) {
            // 重试失败，使用统一错误处理
            await handleTradingError(
              ctx, 
              retryError, 
              'close', 
              symbol, 
              closeAmount, 
              loadingMessage.message_id
            );
            return;
          }
        } else {
          // 其他错误，使用统一错误处理
          await handleTradingError(
            ctx, 
            apiError, 
            'close', 
            symbol, 
            closeAmount, 
            loadingMessage.message_id
          );
        }
      }

    } catch (error) {
      // 使用统一错误处理处理系统异常
      await handleTradingError(ctx, error, 'close', args[0], args[1]);
    }
  }

  /**
   * 验证平仓数量格式
   */
  private validateCloseAmount(amountStr: string): {
    isValid: boolean;
    amount: number;
    isPercentage: boolean;
    errorMsg?: string;
  } {
    if (!amountStr || amountStr.trim() === '') {
      return {
        isValid: false,
        amount: 0,
        isPercentage: false,
        errorMsg: '数量不能为空'
      };
    }

    const trimmed = amountStr.trim();

    // 检查百分比格式
    if (trimmed.endsWith('%')) {
      const percentageStr = trimmed.slice(0, -1);
      const percentage = parseFloat(percentageStr);
      
      if (isNaN(percentage)) {
        return {
          isValid: false,
          amount: 0,
          isPercentage: true,
          errorMsg: '百分比格式不正确'
        };
      }
      
      if (percentage <= 0 || percentage > 100) {
        return {
          isValid: false,
          amount: 0,
          isPercentage: true,
          errorMsg: '百分比必须在0-100%之间'
        };
      }
      
      return {
        isValid: true,
        amount: percentage,
        isPercentage: true
      };
    }

    // 检查数字格式
    const amount = parseFloat(trimmed);
    if (isNaN(amount)) {
      return {
        isValid: false,
        amount: 0,
        isPercentage: false,
        errorMsg: '数量格式不正确'
      };
    }
    
    if (amount <= 0) {
      return {
        isValid: false,
        amount: 0,
        isPercentage: false,
        errorMsg: '数量必须大于0'
      };
    }
    
    if (amount > 999999) {
      return {
        isValid: false,
        amount: 0,
        isPercentage: false,
        errorMsg: '数量过大'
      };
    }
    
    return {
      isValid: true,
      amount: amount,
      isPercentage: false
    };
  }

  /**
   * 获取处理器统计信息
   */
  public getStats(): any {
    return {
      name: 'CloseHandler',
      version: '1.0.0',
      supportedCommands: ['/close'],
      features: [
        'Position closing',
        'Partial position closing',
        'Percentage-based closing',
        'User authentication',
        'Parameter validation',
        'Detailed error handling',
        'Trading status feedback'
      ]
    };
  }
}

// 导出单例实例
export const closeHandler = new CloseHandler();

// 默认导出
export default closeHandler;
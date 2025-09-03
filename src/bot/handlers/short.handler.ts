import { Context } from 'telegraf';
import { apiService } from '../../services/api.service';
import { tokenService } from '../../services/token.service';
import { getUserAccessToken } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { handleTradingError } from '../../utils/error-handler';
import { ExtendedContext } from '../index';
import { accountService } from '../../services/account.service';

/**
 * Short命令处理器
 * 处理 /short <symbol> <leverage> <amount> 命令
 */
export class ShortHandler {
  /**
   * 处理 /short 命令
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('short', userId!, username, args);

      // 参数验证
      if (args.length < 3) {
        await ctx.reply(
          '❌ <b>参数不足</b>\n\n' +
          '正确格式: <code>/short &lt;symbol&gt; &lt;leverage&gt; &lt;amount&gt;</code>\n\n' +
          '示例: <code>/short BTC 10x 200</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const [symbol, leverageStr, amountStr] = args;

      // 基础验证
      if (!symbol || !leverageStr || !amountStr) {
        await ctx.reply(
          '❌ 请提供完整的交易参数\n\n' +
          '格式: <code>/short &lt;symbol&gt; &lt;leverage&gt; &lt;amount&gt;</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 发送处理中消息
      const loadingMessage = await ctx.reply(
        `🔄 <b>正在处理做空交易...</b>\n\n` +
        `代币: <code>${symbol.toUpperCase()}</code>\n` +
        `杠杆: <code>${leverageStr}</code>\n` +
        `金额: <code>${amountStr}</code>`,
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
              '💰 <b>账户余额不足</b>\n\n' +
              `交易需要: <code>${requiredAmount} USDC</code>\n\n` +
              '💡 <b>解决方案:</b>\n' +
              `• 使用 /wallet 查看当前余额\n` +
              `• 向钱包充值更多 USDC\n` +
              `• 减少交易金额`,
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

        // 调用交易API
        const result = await apiService.postWithAuth(
          '/api/tgbot/trading/short',
          accessToken,
          tradingData
        );

        // 编辑消息显示成功结果
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          `✅ <b>做空交易已提交</b>\n\n` +
          `代币: <code>${symbol.toUpperCase()}</code>\n` +
          `杠杆: <code>${leverageStr}</code>\n` +
          `金额: <code>${amountStr}</code>\n\n` +
          `<i>交易正在处理中，请稍候...</i>`,
          { parse_mode: 'HTML' }
        );

        const duration = Date.now() - startTime;
        logger.logPerformance('short_trade_success', duration, {
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
          `${leverageStr} ${amountStr}`, 
          loadingMessage.message_id
        );
      }

    } catch (error) {
      // 使用统一错误处理处理系统异常
      await handleTradingError(ctx, error, 'short', args[0], `${args[1]} ${args[2]}`);
    }
  }

  /**
   * 获取处理器统计信息
   */
  public getStats(): any {
    return {
      name: 'ShortHandler',
      version: '1.0.0',
      supportedCommands: ['/short'],
      features: [
        'Short position trading',
        'User authentication',
        'Parameter validation',
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
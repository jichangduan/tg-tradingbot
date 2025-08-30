import { Context } from 'telegraf';
import { apiService } from '../../services/api.service';
import { tokenService } from '../../services/token.service';
import { getUserAccessToken } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { ExtendedContext } from '../index';

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
        // 处理API错误
        let errorMessage = '❌ <b>交易请求失败</b>\n\n';
        
        if (apiError.status === 400) {
          const responseMessage = apiError.response?.message || '';
          
          if (responseMessage.includes('Hyperliquid API returned null')) {
            errorMessage += '🚫 <b>交易执行失败</b>\n\n';
            errorMessage += '💡 <b>可能的原因:</b>\n';
            errorMessage += '• 💰 账户余额不足（无法支付保证金）\n';
            errorMessage += '• 🔒 账户未激活或被限制\n';
            errorMessage += '• 📈 市场流动性不足\n';
            errorMessage += '• ⚙️ 交易参数超出限制\n\n';
            errorMessage += '🔍 <b>建议操作:</b>\n';
            errorMessage += '• 检查 <code>/wallet</code> 余额是否足够\n';
            errorMessage += '• 降低杠杆倍数或交易金额\n';
            errorMessage += '• 稍后重试或联系管理员';
          } else if (responseMessage.includes('Invalid symbol') || responseMessage.includes('symbol')) {
            errorMessage += '🚫 <b>代币符号错误</b>\n\n';
            errorMessage += `输入的代币: <code>${symbol.toUpperCase()}</code>\n\n`;
            errorMessage += '💡 <b>支持的代币:</b>\n';
            errorMessage += '• 主流币: BTC, ETH, SOL, BNB\n';
            errorMessage += '• 稳定币: USDT, USDC\n';
            errorMessage += '• 其他: 请联系管理员确认\n\n';
            errorMessage += '🔍 <b>请检查代币符号是否正确</b>';
          } else if (responseMessage.includes('leverage') || responseMessage.includes('杠杆')) {
            errorMessage += '🚫 <b>杠杆倍数无效</b>\n\n';
            errorMessage += `输入的杠杆: <code>${leverageStr}</code>\n\n`;
            errorMessage += '💡 <b>有效杠杆范围:</b>\n';
            errorMessage += '• 1x - 50x （具体取决于代币）\n';
            errorMessage += '• 格式: 1x, 2x, 5x, 10x, 20x 等\n\n';
            errorMessage += '🔍 <b>请使用正确的杠杆格式</b>';
          } else if (responseMessage.includes('amount') || responseMessage.includes('金额')) {
            errorMessage += '🚫 <b>交易金额无效</b>\n\n';
            errorMessage += `输入的金额: <code>${amountStr}</code>\n\n`;
            errorMessage += '💡 <b>金额要求:</b>\n';
            errorMessage += '• 必须为正数\n';
            errorMessage += '• 最小交易金额: 取决于代币\n';
            errorMessage += '• 不能超过账户余额\n\n';
            errorMessage += '🔍 <b>请检查金额是否正确</b>';
          } else {
            errorMessage += `错误详情: ${responseMessage}\n\n`;
            errorMessage += '💡 <b>常见原因:</b>\n';
            errorMessage += '• 💰 账户余额不足\n';
            errorMessage += '• 📊 代币符号不支持\n';
            errorMessage += '• ⚙️ 杠杆或金额参数错误\n';
            errorMessage += '• 🌐 网络连接问题\n\n';
            errorMessage += '🔍 <b>建议:</b> 检查参数并重试';
          }
        } else if (apiError.status === 403) {
          errorMessage += '🔐 <b>认证失败</b>\n\n';
          errorMessage += '您的账户认证出现问题，请重新尝试。\n\n';
          errorMessage += '<i>如果问题持续存在，请联系管理员</i>';
        } else if (apiError.status === 500) {
          errorMessage += '🔧 <b>服务器内部错误</b>\n\n';
          errorMessage += 'Hyperliquid交易系统暂时不可用，请稍后重试。\n\n';
          errorMessage += '<i>如果问题持续存在，请联系技术支持</i>';
        } else {
          errorMessage += `🚫 ${apiError.message || '服务暂时不可用'}\n\n`;
          errorMessage += '<i>这可能是后端API集成问题，请联系技术支持</i>';
        }

        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          errorMessage,
          { parse_mode: 'HTML' }
        );

        logger.error(`Short trade failed [${requestId}]`, {
          error: apiError.message,
          status: apiError.status,
          response: apiError.response,
          symbol,
          leverage: leverageStr,
          amount: amountStr,
          userId,
          requestId
        });
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Short command failed [${requestId}]`, {
        error: (error as Error).message,
        stack: (error as Error).stack,
        duration,
        userId,
        username,
        args,
        requestId
      });

      await ctx.reply(
        '❌ <b>系统错误</b>\n\n' +
        '很抱歉，处理您的交易请求时出现了意外错误。\n\n' +
        '💡 <b>请尝试:</b>\n' +
        '• 稍后重试\n' +
        '• 检查命令格式是否正确\n' +
        '• 联系管理员获取帮助\n\n' +
        '<i>错误已记录，技术团队会尽快处理</i>',
        { parse_mode: 'HTML' }
      );
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
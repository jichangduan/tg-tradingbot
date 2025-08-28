import { Context } from 'telegraf';
import { tokenService } from '../../services/token.service';
import { messageFormatter } from '../utils/message.formatter';
import { validateSymbol } from '../utils/validator';
import { logger } from '../../utils/logger';
import { DetailedError } from '../../types/api.types';
import { ExtendedContext } from '../index';

/**
 * Price命令处理器
 * 处理 /price <symbol> 命令的完整流程
 */
export class PriceHandler {
  /**
   * 处理 /price 命令
   * @param ctx Telegram上下文
   * @param args 命令参数数组
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('price', userId!, username, args);

      // 1. 参数验证
      if (args.length === 0) {
        await this.sendHelpMessage(ctx);
        return;
      }

      if (args.length > 1) {
        await ctx.reply(
          '⚠️ 请一次只查询一个代币\n\n' +
          '正确格式: <code>/price BTC</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 2. 验证代币符号
      let symbol: string;
      try {
        symbol = validateSymbol(args[0]);
      } catch (validationError) {
        await this.handleValidationError(ctx, validationError as Error, args[0]);
        return;
      }

      // 3. 发送"查询中..."消息
      const loadingMessage = await ctx.reply(
        messageFormatter.formatLoadingMessage(symbol),
        { parse_mode: 'HTML' }
      );

      // 4. 调用Token服务获取价格数据
      let tokenData;
      try {
        tokenData = await tokenService.getTokenPrice(symbol);
      } catch (serviceError) {
        await this.handleServiceError(ctx, serviceError as DetailedError, loadingMessage.message_id);
        return;
      }

      // 5. 格式化并发送响应消息
      try {
        const responseMessage = messageFormatter.formatPriceMessage(tokenData);
        
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          responseMessage,
          { parse_mode: 'HTML' }
        );

        // 记录成功的查询
        const duration = Date.now() - startTime;
        logger.logPerformance('price_query_success', duration, {
          symbol,
          userId,
          username,
          cached: tokenData.isCached,
          price: tokenData.price,
          requestId
        });

      } catch (messageError) {
        logger.error(`Failed to send price message [${requestId}]`, {
          error: (messageError as Error).message,
          symbol,
          userId,
          requestId
        });

        // 如果编辑消息失败，尝试发送新消息
        await ctx.reply(
          '❌ 消息发送失败，请重试\n\n' +
          '<i>如果问题持续存在，请联系管理员</i>',
          { parse_mode: 'HTML' }
        );
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Price command failed [${requestId}]`, {
        error: (error as Error).message,
        stack: (error as Error).stack,
        duration,
        userId,
        username,
        args,
        requestId
      });

      // 发送通用错误消息
      await this.sendGenericErrorMessage(ctx);
    }
  }

  /**
   * 发送帮助消息
   */
  private async sendHelpMessage(ctx: Context): Promise<void> {
    const helpMessage = messageFormatter.formatHelpMessage();
    await ctx.reply(helpMessage, { parse_mode: 'HTML' });
  }

  /**
   * 处理参数验证错误
   */
  private async handleValidationError(ctx: Context, error: Error, inputSymbol: string): Promise<void> {
    let errorMessage = `❌ <b>无效的代币符号: ${inputSymbol}</b>\n\n`;
    errorMessage += error.message;
    
    // 提供一些常见代币的建议
    errorMessage += `\n\n💡 <b>试试这些热门代币:</b>\n`;
    errorMessage += `<code>/price BTC</code> - Bitcoin\n`;
    errorMessage += `<code>/price ETH</code> - Ethereum\n`;
    errorMessage += `<code>/price SOL</code> - Solana\n`;
    errorMessage += `<code>/price USDT</code> - Tether`;

    await ctx.reply(errorMessage, { parse_mode: 'HTML' });
  }

  /**
   * 处理服务错误
   */
  private async handleServiceError(
    ctx: Context, 
    error: DetailedError, 
    loadingMessageId: number
  ): Promise<void> {
    const errorMessage = messageFormatter.formatErrorMessage(error);
    
    try {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        loadingMessageId,
        undefined,
        errorMessage,
        { parse_mode: 'HTML' }
      );
    } catch (editError) {
      // 如果编辑失败，发送新消息
      await ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }
  }

  /**
   * 发送通用错误消息
   */
  private async sendGenericErrorMessage(ctx: Context): Promise<void> {
    const errorMessage = 
      '❌ <b>系统错误</b>\n\n' +
      '很抱歉，处理您的请求时出现了意外错误。\n\n' +
      '💡 <b>您可以尝试:</b>\n' +
      '• 稍后重试\n' +
      '• 检查代币符号是否正确\n' +
      '• 使用常见代币 (如 BTC, ETH, SOL)\n\n' +
      '<i>如果问题持续存在，请联系管理员</i>';

    await ctx.reply(errorMessage, { parse_mode: 'HTML' });
  }

  /**
   * 处理批量价格查询（暂未实现，预留接口）
   */
  public async handleMultiple(ctx: ExtendedContext, symbols: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    // 限制批量查询数量
    const maxSymbols = 5;
    if (symbols.length > maxSymbols) {
      await ctx.reply(
        `⚠️ 批量查询最多支持 ${maxSymbols} 个代币\n\n` +
        '请减少查询数量后重试',
        { parse_mode: 'HTML' }
      );
      return;
    }

    try {
      logger.info(`Batch price query started [${requestId}]`, {
        symbols,
        count: symbols.length,
        userId,
        username,
        requestId
      });

      // 发送查询中消息
      const loadingMessage = await ctx.reply(
        `🔍 正在查询 ${symbols.length} 个代币的价格信息...`,
        { parse_mode: 'HTML' }
      );

      // 批量获取价格数据
      const results = await tokenService.getMultipleTokenPrices(symbols);

      if (results.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          '❌ 未能获取任何代币的价格信息\n\n请检查代币符号是否正确',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 格式化批量响应消息
      const responseMessage = messageFormatter.formatMultiTokenMessage(results);

      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        loadingMessage.message_id,
        undefined,
        responseMessage,
        { parse_mode: 'HTML' }
      );

      const duration = Date.now() - startTime;
      logger.logPerformance('batch_price_query_success', duration, {
        requestedSymbols: symbols,
        successCount: results.length,
        failureCount: symbols.length - results.length,
        userId,
        username,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Batch price query failed [${requestId}]`, {
        error: (error as Error).message,
        symbols,
        duration,
        userId,
        username,
        requestId
      });

      await this.sendGenericErrorMessage(ctx);
    }
  }

  /**
   * 获取处理器统计信息
   */
  public getStats(): any {
    // 这里可以返回处理器的统计信息
    // 比如处理的请求数、成功率、平均响应时间等
    return {
      name: 'PriceHandler',
      version: '1.0.0',
      supportedCommands: ['/price'],
      features: [
        'Single token price query',
        'Batch token price query (limited)',
        'Price trend analysis',
        'Cache-optimized responses',
        'Detailed error handling'
      ]
    };
  }
}

// 导出单例实例
export const priceHandler = new PriceHandler();

// 默认导出
export default priceHandler;
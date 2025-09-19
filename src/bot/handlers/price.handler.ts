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
        const invalidCommand = await ctx.__!('errors.invalidCommand');
        await ctx.reply(
          `${invalidCommand}\n\n` +
          'Please query only one token at a time\n\n' +
          'Correct format: <code>/price BTC</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 2. Validate token symbol
      let symbol: string;
      try {
        symbol = validateSymbol(args[0]);
      } catch (validationError) {
        await this.handleValidationError(ctx, validationError as Error, args[0]);
        return;
      }

      // 3. Send "querying..." message
      const loadingMsg = await ctx.__!('price.loading', { symbol: symbol.toUpperCase() });
      const loadingMessage = await ctx.reply(loadingMsg, { parse_mode: 'HTML' });

      // 4. Call Token service to get price data
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

        // Log successful query
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

        // If message edit fails, try sending new message
        await ctx.reply(
          '❌ Message failed to send, please retry\n\n' +
          '<i>If the problem persists, please contact administrator</i>',
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

      // Send generic error message
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
   * Handle parameter validation errors
   */
  private async handleValidationError(ctx: Context, error: Error, inputSymbol: string): Promise<void> {
    let errorMessage = `❌ <b>Invalid token symbol: ${inputSymbol}</b>\n\n`;
    errorMessage += error.message;
    
    // Provide suggestions for common tokens
    errorMessage += `\n\n💡 <b>Try these popular tokens:</b>\n`;
    errorMessage += `<code>/price BTC</code> - Bitcoin\n`;
    errorMessage += `<code>/price ETH</code> - Ethereum\n`;
    errorMessage += `<code>/price SOL</code> - Solana\n`;
    errorMessage += `<code>/price USDT</code> - Tether`;

    await ctx.reply(errorMessage, { parse_mode: 'HTML' });
  }

  /**
   * Handle service errors
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
      '❌ <b>System Error</b>\n\n' +
      'Sorry, an unexpected error occurred while processing your request.\n\n' +
      '💡 <b>You can try:</b>\n' +
      '• Retry later\n' +
      '• Check if token symbol is correct\n' +
      '• Use common tokens (like BTC, ETH, SOL)\n\n' +
      '<i>If the problem persists, please contact admin</i>';

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
        `⚠️ Batch query supports maximum ${maxSymbols} tokens\n\n` +
        'Please reduce query count and try again',
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
        `🔍 Querying price information for ${symbols.length} tokens...`,
        { parse_mode: 'HTML' }
      );

      // 批量获取价格数据
      const results = await tokenService.getMultipleTokenPrices(symbols);

      if (results.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          '❌ Unable to get price information for any token\n\nPlease check if token symbols are correct',
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
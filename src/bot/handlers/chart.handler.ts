import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { chartService } from '../../services/chart.service';
import { chartImageService } from '../../services/chart-image.service';
import { messageFormatter } from '../utils/message.formatter';
import { validateSymbol } from '../utils/validator';
import { logger } from '../../utils/logger';
import { DetailedError, TimeFrame } from '../../types/api.types';
import { ExtendedContext } from '../index';

/**
 * Chart command handler
 * Handles the complete flow of /chart <symbol> [timeframe] command
 */
export class ChartHandler {
  /**
   * 处理 /chart 命令
   * @param ctx Telegram上下文
   * @param args 命令参数数组
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('chart', userId!, username, args);

      // 1. 参数验证
      if (args.length === 0) {
        await this.sendHelpMessage(ctx);
        return;
      }

      if (args.length > 2) {
        await ctx.reply(
          '⚠️ Too many parameters\n\n' +
          'Correct format: <code>/chart BTC</code> or <code>/chart BTC 1h</code>\n\n' +
          'Supported timeframes: 1m, 5m, 15m, 1h, 4h, 1d',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 2. 验证交易对符号
      let symbol: string;
      try {
        symbol = validateSymbol(args[0]);
      } catch (validationError) {
        await this.handleValidationError(ctx, validationError as Error, args[0]);
        return;
      }

      // 3. 验证时间框架
      let timeFrame: TimeFrame = '1h'; // 默认时间框架
      if (args.length === 2) {
        const inputTimeFrame = args[1].toLowerCase();
        if (!chartService.isValidTimeFrame(inputTimeFrame)) {
          await ctx.reply(
            `⚠️ <b>Unsupported timeframe: ${args[1]}</b>\n\n` +
            'Supported timeframes: 1m, 5m, 15m, 1h, 4h, 1d\n\n' +
            'Example: <code>/chart BTC 1h</code>',
            { parse_mode: 'HTML' }
          );
          return;
        }
        timeFrame = inputTimeFrame as TimeFrame;
      }

      // 4. Send "Loading..." message
      const loadingMessage = await ctx.reply(
        messageFormatter.formatChartLoadingMessage(symbol, timeFrame),
        { parse_mode: 'HTML' }
      );

      // 5. 调用Chart服务获取K线数据 (固定20根K线)
      let candleData;
      try {
        candleData = await chartService.getCandleData(symbol, timeFrame, 20);
      } catch (serviceError) {
        await this.handleServiceError(ctx, serviceError as DetailedError, loadingMessage.message_id);
        return;
      }

      // 6. 生成TradingView图表图像
      let chartImage;
      let useImageChart = true; // 默认使用图表图像
      
      try {
        chartImage = await chartImageService.generateTradingViewChart(symbol, timeFrame, candleData);
      } catch (imageError) {
        logger.warn(`Chart image generation failed, falling back to ASCII chart`, {
          error: (imageError as Error).message,
          symbol,
          timeFrame,
          requestId
        });
        useImageChart = false; // 回退到ASCII图表
      }

      // 7. 发送图表响应
      try {
        if (useImageChart && chartImage) {
          // 发送干净的图表图像 + 交互按钮
          const keyboard = this.createChartKeyboard(symbol, timeFrame);
          
          await ctx.telegram.deleteMessage(ctx.chat?.id!, loadingMessage.message_id);
          
          await ctx.replyWithPhoto(
            { source: chartImage.imageBuffer },
            {
              reply_markup: keyboard
            }
          );
        } else {
          // 回退到原有的ASCII图表
          const responseMessage = messageFormatter.formatChartMessage(candleData);
          
          await ctx.telegram.editMessageText(
            ctx.chat?.id,
            loadingMessage.message_id,
            undefined,
            responseMessage,
            { parse_mode: 'HTML' }
          );
        }

        // 移除fallback通知 - 现在始终使用用户选择的时间框架

        // 记录成功的查询
        const duration = Date.now() - startTime;
        logger.logPerformance('chart_query_success', duration, {
          symbol,
          timeFrame,
          userId,
          username,
          cached: candleData.isCached,
          candlesCount: candleData.candles.length,
          latestPrice: candleData.latestPrice,
          chartType: useImageChart ? 'image' : 'ascii',
          imageGenerated: !!chartImage,
          requestId
        });

      } catch (messageError) {
        logger.error(`Failed to send chart message [${requestId}]`, {
          error: (messageError as Error).message,
          symbol,
          timeFrame,
          userId,
          requestId
        });

        // If message sending fails, try to send simple error message
        try {
          await ctx.reply(
            '❌ Chart sending failed, please retry\n\n' +
            '<i>If the problem persists, please contact administrator</i>',
            { parse_mode: 'HTML' }
          );
        } catch (fallbackError) {
          // 最后的错误处理
          logger.error(`Fallback message also failed [${requestId}]`, {
            error: (fallbackError as Error).message
          });
        }
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Chart command failed [${requestId}]`, {
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
   * Send help message
   */
  private async sendHelpMessage(ctx: Context): Promise<void> {
    const helpMessage = messageFormatter.formatChartHelpMessage();
    await ctx.reply(helpMessage, { parse_mode: 'HTML' });
  }

  /**
   * Handle parameter validation errors
   */
  private async handleValidationError(ctx: Context, error: Error, inputSymbol: string): Promise<void> {
    let errorMessage = `❌ <b>Invalid trading pair symbol: ${inputSymbol}</b>\n\n`;
    errorMessage += error.message;
    
    // Provide suggestions for common trading pairs
    errorMessage += `\n\n💡 <b>Try these popular trading pairs:</b>\n`;
    errorMessage += `<code>/chart BTC</code> - Bitcoin\n`;
    errorMessage += `<code>/chart ETH</code> - Ethereum\n`;
    errorMessage += `<code>/chart SOL</code> - Solana\n`;
    errorMessage += `<code>/chart ETC</code> - Ethereum Classic`;

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
    // Special handling for insufficient data errors
    let errorMessage: string;
    if (error.message.includes('Insufficient candle data') || error.message.includes('only') && error.message.includes('candles available')) {
      errorMessage = 
        '📊 <b>Insufficient Candlestick Data</b>\n\n' +
        'This trading pair has limited historical data for this timeframe.\n\n' +
        '💡 <b>Suggestions:</b>\n' +
        '• Try shorter timeframes (1h, 5m, 1m)\n' +
        '• Choose more mainstream trading pairs (BTC, ETH)\n' +
        '• Retry later, data may be updating\n\n' +
        '<i>If this issue persists with mainstream coins, please contact administrator</i>';
    } else if (error.message.includes('Unable to get candle data') && error.message.includes('in any supported timeframe')) {
      errorMessage = 
        '❌ <b>Unable to Get Data</b>\n\n' +
        'Sorry, unable to get data for any timeframe of this trading pair.\n\n' +
        '💡 <b>Possible reasons:</b>\n' +
        '• Trading pair does not exist or has been delisted\n' +
        '• Data source temporarily unavailable\n' +
        '• Network connection issues\n\n' +
        'Please check if the trading pair symbol is correct, or retry later.';
    } else {
      errorMessage = messageFormatter.formatErrorMessage(error);
    }
    
    try {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        loadingMessageId,
        undefined,
        errorMessage,
        { parse_mode: 'HTML' }
      );
    } catch (editError) {
      // If editing fails, send new message
      await ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }
  }

  /**
   * Send generic error message
   */
  private async sendGenericErrorMessage(ctx: Context): Promise<void> {
    const errorMessage = 
      '❌ <b>System Error</b>\n\n' +
      'Sorry, an unexpected error occurred while processing your request.\n\n' +
      '💡 <b>You can try:</b>\n' +
      '• Retry later\n' +
      '• Check if trading pair symbol is correct\n' +
      '• Use common trading pairs (like BTC, ETH, SOL)\n' +
      '• Check if timeframe is supported\n\n' +
      '<i>If the problem persists, please contact administrator</i>';

    await ctx.reply(errorMessage, { parse_mode: 'HTML' });
  }

  /**
   * Create chart interactive keyboard
   */
  private createChartKeyboard(symbol: string, currentTimeFrame: TimeFrame): InlineKeyboardMarkup {
    const timeframes: TimeFrame[] = ['1m', '5m', '1h', '1d'];
    
    // Timeframe button row
    const timeframeButtons = timeframes.map(tf => ({
      text: tf === currentTimeFrame ? `• ${tf.toUpperCase()} •` : tf.toUpperCase(),
      callback_data: `chart_${symbol}_${tf}`
    }));

    // Trading button row (connected to actual trading commands)
    const tradingButtons = [
      {
        text: `📉 Short ${symbol}`,
        callback_data: `short_${symbol}`
      },
      {
        text: `📈 Long ${symbol}`,
        callback_data: `long_${symbol}`
      }
    ];

    return {
      inline_keyboard: [
        timeframeButtons,
        tradingButtons
      ]
    };
  }

  /**
   * Handle chart callback queries
   */
  public async handleCallback(ctx: ExtendedContext): Promise<void> {
    const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!callbackData) return;

    try {
      if (callbackData.startsWith('chart_')) {
        // Parse callback data: chart_BTC_1h
        const [, symbol, newTimeFrame] = callbackData.split('_');
        await this.regenerateChart(ctx, symbol, newTimeFrame as TimeFrame);
      } else if (callbackData.startsWith('short_') || callbackData.startsWith('long_')) {
        // Handle trading buttons
        await this.handleTradingCallback(ctx, callbackData);
      }
    } catch (error) {
      logger.error('Chart callback error', {
        error: (error as Error).message,
        callbackData,
        userId: ctx.from?.id
      });

      await ctx.answerCbQuery('❌ Operation failed, please retry');
    }
  }

  /**
   * Regenerate chart
   */
  private async regenerateChart(ctx: ExtendedContext, symbol: string, timeFrame: TimeFrame): Promise<void> {
    const userId = ctx.from?.id;
    const requestId = `callback_${Date.now()}`;

    try {
      // Check if clicked the same timeframe
      const currentTimeFrame = this.getCurrentTimeFrameFromMessage(ctx);
      if (currentTimeFrame === timeFrame) {
        // User clicked already selected timeframe, show hint without updating
        await ctx.answerCbQuery(`📊 Currently showing ${timeFrame.toUpperCase()} timeframe`, { show_alert: false });
        return;
      }

      // Show loading status
      await ctx.answerCbQuery('🔄 Updating chart...');

      logger.info(`Regenerating chart for ${symbol} ${timeFrame}`, {
        userId,
        requestId,
        trigger: 'callback'
      });

      // Get candlestick data (fixed 20 candles)
      const candleData = await chartService.getCandleData(symbol, timeFrame, 20);

      // Generate chart image
      let chartImage;
      let useImageChart = true;

      try {
        chartImage = await chartImageService.generateTradingViewChart(symbol, timeFrame, candleData);
      } catch (imageError) {
        logger.warn('Chart regeneration fallback to ASCII', {
          error: (imageError as Error).message,
          symbol,
          timeFrame,
          requestId
        });
        useImageChart = false;
      }

      if (useImageChart && chartImage) {
        // Update chart and buttons
        const keyboard = this.createChartKeyboard(symbol, timeFrame);
        
        await ctx.editMessageMedia({
          type: 'photo',
          media: { source: chartImage.imageBuffer }
        }, {
          reply_markup: keyboard
        });
      } else {
        // Fallback to text message
        const responseMessage = messageFormatter.formatChartMessage(candleData);
        await ctx.editMessageText(responseMessage, { parse_mode: 'HTML' });
      }

      // Remove fallback notification - now always use user-selected timeframe

    } catch (error) {
      logger.error('Chart regeneration failed', {
        error: (error as Error).message,
        symbol,
        timeFrame,
        userId,
        requestId
      });

      await ctx.answerCbQuery('❌ Chart update failed, please retry');
    }
  }

  /**
   * Handle trading button callbacks
   */
  private async handleTradingCallback(ctx: ExtendedContext, callbackData: string): Promise<void> {
    const isShort = callbackData.startsWith('short_');
    const symbol = callbackData.split('_')[1];
    const action = isShort ? 'Short' : 'Long';

    // Confirm user operation
    await ctx.answerCbQuery(
      `Opening ${action} ${symbol} trading interface...`,
      { show_alert: false }
    );

    // Call corresponding trading handler
    try {
      if (isShort) {
        const { default: shortHandler } = await import('./short.handler');
        await shortHandler.handle(ctx, [symbol]);
      } else {
        const { default: longHandler } = await import('./long.handler');
        await longHandler.handle(ctx, [symbol]);
      }
    } catch (error) {
      logger.error('Failed to handle trading callback', {
        action,
        symbol,
        userId: ctx.from?.id,
        error: (error as Error).message
      });
      
      await ctx.reply(
        `❌ Unable to open ${action} ${symbol} trading interface, please retry later.`
      );
    }
  }

  /**
   * Detect currently selected timeframe from message's inline keyboard
   */
  private getCurrentTimeFrameFromMessage(ctx: ExtendedContext): TimeFrame | null {
    try {
      const message = ctx.callbackQuery?.message;
      if (!message || !('reply_markup' in message) || !message.reply_markup?.inline_keyboard) {
        return null;
      }

      // Look for buttons with • marker (indicating currently selected timeframe)
      for (const row of message.reply_markup.inline_keyboard) {
        for (const button of row) {
          if (button.text.includes('•')) {
            // Extract timeframe, remove • symbols and spaces
            const timeFrame = button.text.replace(/[•\s]/g, '').toLowerCase();
            return timeFrame as TimeFrame;
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.warn('Failed to detect current timeframe from message', {
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * Get handler statistics
   */
  public getStats(): any {
    return {
      name: 'ChartHandler',
      version: '3.1.0',
      supportedCommands: ['/chart'],
      supportedTimeFrames: chartService.getSupportedTimeFrames(),
      features: [
        'Clean minimal TradingView charts',
        'Interactive timeframe buttons',
        'Placeholder trading buttons',
        'Dynamic chart regeneration',
        'K-line data query',
        'Image chart generation',
        'ASCII fallback visualization',
        'Cache-optimized responses',
        'Detailed error handling'
      ]
    };
  }
}

// 导出单例实例
export const chartHandler = new ChartHandler();

// 默认导出
export default chartHandler;
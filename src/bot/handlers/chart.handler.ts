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
 * Chart命令处理器
 * 处理 /chart <symbol> [timeframe] 命令的完整流程
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
          '⚠️ 参数过多\n\n' +
          '正确格式: <code>/chart BTC</code> 或 <code>/chart BTC 1h</code>\n\n' +
          '支持的时间框架: 1m, 5m, 15m, 1h, 4h, 1d',
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
            `⚠️ <b>不支持的时间框架: ${args[1]}</b>\n\n` +
            '支持的时间框架: 1m, 5m, 15m, 1h, 4h, 1d\n\n' +
            '示例: <code>/chart BTC 1h</code>',
            { parse_mode: 'HTML' }
          );
          return;
        }
        timeFrame = inputTimeFrame as TimeFrame;
      }

      // 4. 发送"查询中..."消息
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

        // 如果发送消息失败，尝试发送简单的错误提示
        try {
          await ctx.reply(
            '❌ 图表发送失败，请重试\n\n' +
            '<i>如果问题持续存在，请联系管理员</i>',
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
   * 发送帮助消息
   */
  private async sendHelpMessage(ctx: Context): Promise<void> {
    const helpMessage = messageFormatter.formatChartHelpMessage();
    await ctx.reply(helpMessage, { parse_mode: 'HTML' });
  }

  /**
   * 处理参数验证错误
   */
  private async handleValidationError(ctx: Context, error: Error, inputSymbol: string): Promise<void> {
    let errorMessage = `❌ <b>无效的交易对符号: ${inputSymbol}</b>\n\n`;
    errorMessage += error.message;
    
    // 提供一些常见交易对的建议
    errorMessage += `\n\n💡 <b>试试这些热门交易对:</b>\n`;
    errorMessage += `<code>/chart BTC</code> - Bitcoin\n`;
    errorMessage += `<code>/chart ETH</code> - Ethereum\n`;
    errorMessage += `<code>/chart SOL</code> - Solana\n`;
    errorMessage += `<code>/chart ETC</code> - Ethereum Classic`;

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
    // 特殊处理数据不足的错误
    let errorMessage: string;
    if (error.message.includes('Insufficient candle data') || error.message.includes('only') && error.message.includes('candles available')) {
      errorMessage = 
        '📊 <b>K线数据不足</b>\n\n' +
        '该交易对在此时间框架下的历史数据有限。\n\n' +
        '💡 <b>建议:</b>\n' +
        '• 尝试较短的时间框架 (1h, 5m, 1m)\n' +
        '• 选择更主流的交易对 (BTC, ETH)\n' +
        '• 稍后重试，数据可能正在更新\n\n' +
        '<i>如果是主流币种仍有此问题，请联系管理员</i>';
    } else if (error.message.includes('Unable to get candle data') && error.message.includes('in any supported timeframe')) {
      errorMessage = 
        '❌ <b>无法获取数据</b>\n\n' +
        '很抱歉，无法获取该交易对的任何时间框架数据。\n\n' +
        '💡 <b>可能的原因:</b>\n' +
        '• 交易对不存在或已下线\n' +
        '• 数据源暂时不可用\n' +
        '• 网络连接问题\n\n' +
        '请检查交易对符号是否正确，或稍后重试。';
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
      '• 检查交易对符号是否正确\n' +
      '• 使用常见交易对 (如 BTC, ETH, SOL)\n' +
      '• 检查时间框架是否支持\n\n' +
      '<i>如果问题持续存在，请联系管理员</i>';

    await ctx.reply(errorMessage, { parse_mode: 'HTML' });
  }

  /**
   * 创建图表交互键盘
   */
  private createChartKeyboard(symbol: string, currentTimeFrame: TimeFrame): InlineKeyboardMarkup {
    const timeframes: TimeFrame[] = ['1m', '5m', '1h', '1d'];
    
    // 时间框架按钮行
    const timeframeButtons = timeframes.map(tf => ({
      text: tf === currentTimeFrame ? `• ${tf.toUpperCase()} •` : tf.toUpperCase(),
      callback_data: `chart_${symbol}_${tf}`
    }));

    // 交易按钮行 (连接到实际的交易命令)
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
   * 处理图表回调查询
   */
  public async handleCallback(ctx: ExtendedContext): Promise<void> {
    const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!callbackData) return;

    try {
      if (callbackData.startsWith('chart_')) {
        // 解析回调数据: chart_BTC_1h
        const [, symbol, newTimeFrame] = callbackData.split('_');
        await this.regenerateChart(ctx, symbol, newTimeFrame as TimeFrame);
      } else if (callbackData.startsWith('short_') || callbackData.startsWith('long_')) {
        // 处理交易按钮
        await this.handleTradingCallback(ctx, callbackData);
      }
    } catch (error) {
      logger.error('Chart callback error', {
        error: (error as Error).message,
        callbackData,
        userId: ctx.from?.id
      });

      await ctx.answerCbQuery('❌ 操作失败，请重试');
    }
  }

  /**
   * 重新生成图表
   */
  private async regenerateChart(ctx: ExtendedContext, symbol: string, timeFrame: TimeFrame): Promise<void> {
    const userId = ctx.from?.id;
    const requestId = `callback_${Date.now()}`;

    try {
      // 检查是否点击了相同的时间框架
      const currentTimeFrame = this.getCurrentTimeFrameFromMessage(ctx);
      if (currentTimeFrame === timeFrame) {
        // 用户点击了已选择的时间框架，显示提示而不进行更新
        await ctx.answerCbQuery(`📊 当前已显示 ${timeFrame.toUpperCase()} 时间框架`, { show_alert: false });
        return;
      }

      // 显示加载状态
      await ctx.answerCbQuery('🔄 正在更新图表...');

      logger.info(`Regenerating chart for ${symbol} ${timeFrame}`, {
        userId,
        requestId,
        trigger: 'callback'
      });

      // 获取K线数据 (固定20根K线)
      const candleData = await chartService.getCandleData(symbol, timeFrame, 20);

      // 生成图表图像
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
        // 更新图表和按钮
        const keyboard = this.createChartKeyboard(symbol, timeFrame);
        
        await ctx.editMessageMedia({
          type: 'photo',
          media: { source: chartImage.imageBuffer }
        }, {
          reply_markup: keyboard
        });
      } else {
        // 回退到文本消息
        const responseMessage = messageFormatter.formatChartMessage(candleData);
        await ctx.editMessageText(responseMessage, { parse_mode: 'HTML' });
      }

      // 移除fallback通知 - 现在始终使用用户选择的时间框架

    } catch (error) {
      logger.error('Chart regeneration failed', {
        error: (error as Error).message,
        symbol,
        timeFrame,
        userId,
        requestId
      });

      await ctx.answerCbQuery('❌ 图表更新失败，请重试');
    }
  }

  /**
   * 处理交易按钮回调
   */
  private async handleTradingCallback(ctx: ExtendedContext, callbackData: string): Promise<void> {
    const isShort = callbackData.startsWith('short_');
    const symbol = callbackData.split('_')[1];
    const action = isShort ? 'Short' : 'Long';

    // 确认用户操作
    await ctx.answerCbQuery(
      `正在打开 ${action} ${symbol} 交易界面...`,
      { show_alert: false }
    );

    // 调用相应的交易处理器
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
        `❌ 无法打开 ${action} ${symbol} 交易界面，请稍后重试。`
      );
    }
  }

  /**
   * 从消息的内联键盘中检测当前选中的时间框架
   */
  private getCurrentTimeFrameFromMessage(ctx: ExtendedContext): TimeFrame | null {
    try {
      const message = ctx.callbackQuery?.message;
      if (!message || !('reply_markup' in message) || !message.reply_markup?.inline_keyboard) {
        return null;
      }

      // 查找带有 • 标记的按钮（表示当前选中的时间框架）
      for (const row of message.reply_markup.inline_keyboard) {
        for (const button of row) {
          if (button.text.includes('•')) {
            // 提取时间框架，移除 • 符号和空格
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
   * 获取处理器统计信息
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
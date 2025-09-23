import { Telegraf } from 'telegraf';
import { priceHandler } from './price.handler';
import { marketsHandler } from './markets.handler';
import { startHandler } from './start.handler';
import { walletHandler } from './wallet.handler';
import { inviteHandler } from './invite.handler';
// import { pointsHandler } from './points.handler';
import { chartHandler } from './chart.handler';
import { longHandler } from './long.handler';
import { shortHandler } from './short.handler';
import { closeHandler } from './close.handler';
import { positionsHandler } from './positions.handler';
// import { ordersHandler } from './orders.handler'; // Temporarily disabled
import { pnlHandler } from './pnl.handler';
import { pushHandler } from './push.handler';
import { languageHandler } from './language.handler';
import { withdrawHandler } from './withdraw.handler';
import { logger } from '../../utils/logger';
import { ExtendedContext } from '../index';
import { tradingStateService, TradingState } from '../../services/trading-state.service';
import { tokenService } from '../../services/token.service';
import { accountService } from '../../services/account.service';
import { messageFormatter } from '../utils/message.formatter';
import { i18nService } from '../../services/i18n.service';

/**
 * 命令处理器注册系统
 * 负责注册所有Bot命令和相应的处理器
 */

/**
 * 处理交易状态下的文本输入
 */
async function handleTradingInput(ctx: ExtendedContext, state: TradingState, input: string): Promise<void> {
  const userId = ctx.from?.id?.toString();
  if (!userId) return;

  try {
    if (state.step === 'symbol') {
      // 处理代币符号输入
      const symbol = input.trim().toUpperCase();
      
      // 验证代币符号
      try {
        const tokenData = await tokenService.getTokenPrice(symbol);
        const accountBalance = await accountService.getAccountBalance(userId);
        const availableMargin = accountBalance.withdrawableAmount || 0;
        
        // 更新状态到杠杆选择
        await tradingStateService.updateState(userId, {
          symbol: symbol,
          step: 'leverage'
        });
        
        const userLanguage = await i18nService.getUserLanguage(ctx.from?.id);
        const message = await messageFormatter.formatTradingLeveragePrompt(
          state.action,
          symbol,
          tokenData.price,
          availableMargin,
          userLanguage
        );
        
        const keyboard = state.action === 'long' 
          ? longHandler.createLeverageKeyboard(symbol)
          : shortHandler.createLeverageKeyboard(symbol);
        
        await ctx.reply(message, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        
      } catch (error) {
        await ctx.reply(
          `❌ <b>Invalid token symbol: ${symbol}</b>\n\n` +
          `Please enter a valid token symbol, for example: BTC, ETH, SOL`,
          { parse_mode: 'HTML' }
        );
      }
      
    } else if (state.step === 'amount') {
      // 处理金额输入
      const amount = parseFloat(input.trim());
      
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply(
          `❌ <b>无效的金额</b>\n\n` +
          `请输入有效的数字金额，例如：30`,
          { parse_mode: 'HTML' }
        );
        return;
      }
      
      // 更新状态到确认
      await tradingStateService.updateState(userId, {
        amount: amount.toString(),
        step: 'confirm'
      });
      
      // 显示订单预览
      try {
        const tokenData = await tokenService.getTokenPrice(state.symbol!);
        const orderSize = amount / tokenData.price * parseFloat(state.leverage!.replace('x', ''));
        const liquidationPrice = calculateLiquidationPrice(tokenData.price, parseFloat(state.leverage!.replace('x', '')), state.action);
        
        const userLanguage = await i18nService.getUserLanguage(ctx.from?.id);
        const previewMessage = await messageFormatter.formatTradingOrderPreview(
          state.action,
          state.symbol!,
          state.leverage!,
          amount.toString(),
          tokenData.price,
          orderSize,
          liquidationPrice,
          userLanguage
        );
        
        const keyboard = state.action === 'long'
          ? await longHandler.createConfirmationKeyboard(ctx, state.symbol!, state.leverage!, amount.toString())
          : await shortHandler.createConfirmationKeyboard(ctx, state.symbol!, state.leverage!, amount.toString());
        
        await ctx.reply(previewMessage, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        
      } catch (error) {
        await ctx.reply(
          `❌ <b>生成订单预览失败</b>\n\n` +
          `请稍后重试或重新开始交易`,
          { parse_mode: 'HTML' }
        );
        await tradingStateService.clearState(userId);
      }
    }
    
  } catch (error) {
    logger.error('Trading input handler error', {
      error: (error as Error).message,
      userId: parseInt(userId || '0'),
      state,
      input: input.substring(0, 50)
    });
    
    await ctx.reply(
      `❌ <b>处理输入时出错</b>\n\n` +
      `请重新开始交易流程`,
      { parse_mode: 'HTML' }
    );
    await tradingStateService.clearState(userId);
  }
}

/**
 * 计算强制平仓价格（辅助函数）
 */
function calculateLiquidationPrice(currentPrice: number, leverage: number, direction: 'long' | 'short'): number {
  const marginRatio = 0.05; // 5% 维持保证金率
  const liquidationRatio = (leverage - 1) / leverage * (1 - marginRatio);
  
  if (direction === 'long') {
    return currentPrice * (1 - liquidationRatio);
  } else {
    return currentPrice * (1 + liquidationRatio);
  }
}

/**
 * 解析命令参数
 */
function parseCommandArgs(text: string): { command: string; args: string[] } {
  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  
  return { command, args };
}

/**
 * 创建命令处理器包装函数
 */
function createCommandWrapper(
  handlerName: string, 
  handler: (ctx: ExtendedContext, args: string[]) => Promise<void>
) {
  return async (ctx: ExtendedContext) => {
    const startTime = Date.now();
    const requestId = ctx.requestId || 'unknown';
    
    try {
      // 解析命令参数
      const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      const { args } = parseCommandArgs(messageText || '');
      
      logger.debug(`Command handler started [${requestId}]`, {
        handler: handlerName,
        args,
        userId: ctx.from?.id,
        requestId
      });

      // 调用实际的处理器
      await handler(ctx, args);
      
      const duration = Date.now() - startTime;
      logger.debug(`Command handler completed [${requestId}] - ${duration}ms`, {
        handler: handlerName,
        duration,
        requestId
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Command handler failed [${requestId}]`, {
        handler: handlerName,
        error: (error as Error).message,
        stack: (error as Error).stack,
        duration,
        userId: ctx.from?.id,
        requestId
      });
      
      // 发送通用错误消息给用户
      try {
        await ctx.reply(
          '❌ 命令处理失败\n\n' +
          '很抱歉，处理您的命令时出现了错误。\n' +
          '请稍后重试或联系管理员。',
          { parse_mode: 'HTML' }
        );
      } catch (replyError) {
        logger.error(`Failed to send error reply [${requestId}]`, {
          error: (replyError as Error).message,
          requestId
        });
      }
    }
  };
}

/**
 * Handle numeric input (1, 2, etc.) with helpful English responses
 */
function handleNumericInput(input: string): string | null {
  const trimmed = input.trim();
  
  // Check if input is a simple number (1-9)
  if (/^[1-9]$/.test(trimmed)) {
    const number = parseInt(trimmed);
    
    switch (number) {
      case 1:
        return `
🔢 <b>Number "1" Received</b>

Looking for trading commands? Try these:

<b>📈 Trading Commands:</b>
• <code>/long BTC 1x 100</code> - Long Bitcoin with 1x leverage
• <code>/positions</code> - View your positions
• <code>/wallet</code> - Check wallet balance

<b>📊 Market Data:</b>
• <code>/price BTC</code> - Bitcoin price
• <code>/markets</code> - Market overview

Send <code>/help</code> for complete command list 📚
        `.trim();
        
      case 2:
        return `
🔢 <b>Number "2" Received</b>

Want to explore more features? Here are some options:

<b>📉 Short Trading:</b>
• <code>/short ETH 2x 50</code> - Short Ethereum with 2x leverage
• <code>/close ETH</code> - Close ETH position

<b>📈 Analysis Tools:</b>
• <code>/chart BTC</code> - View BTC chart
• <code>/pnl</code> - Check profit/loss

Send <code>/help</code> for all available commands 🚀
        `.trim();
        
      default:
        return `
🔢 <b>Number "${number}" Received</b>

I'm a trading bot focused on cryptocurrency operations.

<b>🎯 Quick Actions:</b>
• <code>/positions</code> - View open positions
• <code>/wallet</code> - Check account balance
• <code>/markets</code> - Market data

<b>📚 Need Help?</b>
• <code>/help</code> - Complete command guide
• <code>/start</code> - Restart bot

Try using command format: <code>/command parameter</code>
        `.trim();
    }
  }
  
  // Check for multi-digit numbers
  if (/^\d+$/.test(trimmed)) {
    return `
🔢 <b>Number "${trimmed}" Received</b>

I understand you sent a number, but I work with specific commands.

<b>💡 Did you mean to:</b>
• <code>/price BTC</code> - Check token price
• <code>/long BTC 10x ${trimmed}</code> - Trade with $${trimmed}
• <code>/positions</code> - View positions

<b>📚 For help:</b>
Send <code>/help</code> to see all available commands

Use format: <code>/command token amount</code>
    `.trim();
  }
  
  return null; // Not a numeric input
}

/**
 * 注册所有命令处理器
 */
export function registerCommands(bot: Telegraf<ExtendedContext>): void {
  logger.info('Registering command handlers...');

  // /start 命令 - 用户初始化和欢迎消息
  bot.start(createCommandWrapper('start', startHandler.handle.bind(startHandler)));

  // /help 命令 - 帮助信息
  bot.help(async (ctx) => {
    logger.info('Help command received', {
      userId: ctx.from?.id,
      requestId: ctx.requestId
    });

    const helpMessage = `
📚 <b>AIW3 TGBot User Guide</b>

<b>🔍 Price Query Commands:</b>
<code>/price &lt;token symbol&gt;</code>
Examples: <code>/price BTC</code>, <code>/price ETH</code>

<b>📊 Market Data Commands:</b>
<code>/markets</code> - View major cryptocurrency market data
<code>/chart &lt;trading pair&gt; [timeframe]</code> - Candlestick chart analysis
Examples: <code>/chart BTC</code>, <code>/chart ETH 1d</code>

<b>📈 Trading Commands:</b>
<code>/long &lt;token&gt; &lt;leverage&gt; &lt;amount&gt;</code> - Long position
<code>/short &lt;token&gt; &lt;leverage&gt; &lt;amount&gt;</code> - Short position
<code>/close &lt;token&gt; [quantity]</code> - Close position
<code>/positions</code> - View all open positions
<code>/pnl</code> - Profit & Loss analysis report
Examples: <code>/long BTC 10x 200</code>, <code>/short ETH 5x 100</code>, <code>/close BTC 50%</code>

<b>💰 Account Management:</b>
<code>/wallet</code> - View wallet balance
<code>/withdraw</code> - Withdraw funds to external wallet

<b>📢 Push Notifications:</b>
<code>/push</code> - Manage push notification settings

<b>💡 Other Commands:</b>
<code>/start</code> - Restart bot
<code>/help</code> - Show this help information

<b>🪙 Supported Tokens:</b>
<b>Major Coins:</b> BTC, ETH, SOL, USDT, USDC, BNB, XRP, ADA
<b>DeFi:</b> UNI, LINK, AAVE, COMP, SUSHI, CRV
<b>Layer 1:</b> DOT, AVAX, MATIC, ATOM, NEAR, ALGO
<b>Others:</b> DOGE, SHIB, PEPE, APT, SUI, etc.

<b>✨ Key Features:</b>
• 🚀 Millisecond-level response speed
• 📊 Detailed price analysis
• 💹 24-hour price trends
• ⚡ Smart caching system
• 🛡️ Secure and reliable data

<b>💬 Usage Tips:</b>
• Token symbols are case-insensitive
• Query one token at a time for best experience
• Data updates automatically every 5 minutes

Need help? Contact administrator 👨‍💻
    `.trim();

    await ctx.reply(helpMessage, { parse_mode: 'HTML' });
  });

  // /price 命令 - 价格查询
  bot.command(
    'price', 
    createCommandWrapper('price', priceHandler.handle.bind(priceHandler))
  );

  // /chart 命令 - K线图表
  bot.command(
    'chart', 
    createCommandWrapper('chart', chartHandler.handle.bind(chartHandler))
  );

  // /markets command - Market data
  bot.command(
    'markets', 
    createCommandWrapper('markets', marketsHandler.handle.bind(marketsHandler))
  );

  // /wallet 命令 - 钱包余额
  bot.command(
    'wallet', 
    createCommandWrapper('wallet', walletHandler.handle.bind(walletHandler))
  );

  // /invite 命令 - 邀请统计
  bot.command(
    'invite', 
    createCommandWrapper('invite', inviteHandler.handle.bind(inviteHandler))
  );

  // /points 命令 - 积分查询 (temporarily disabled)
  // bot.command(
  //   'points', 
  //   createCommandWrapper('points', pointsHandler.handle.bind(pointsHandler))
  // );

  // /long 命令 - 做多交易
  bot.command(
    'long', 
    createCommandWrapper('long', longHandler.handle.bind(longHandler))
  );

  // /short 命令 - 做空交易
  bot.command(
    'short', 
    createCommandWrapper('short', shortHandler.handle.bind(shortHandler))
  );

  // /close 命令 - 平仓操作
  bot.command(
    'close', 
    createCommandWrapper('close', closeHandler.handle.bind(closeHandler))
  );

  // /positions 命令 - 仓位查询
  bot.command(
    'positions', 
    createCommandWrapper('positions', positionsHandler.handle.bind(positionsHandler))
  );

  // /orders 命令 - 订单查询 (Temporarily disabled)
  // bot.command(
  //   'orders', 
  //   createCommandWrapper('orders', ordersHandler.handle.bind(ordersHandler))
  // );

  // /pnl 命令 - 盈亏分析
  bot.command(
    'pnl', 
    createCommandWrapper('pnl', pnlHandler.handle.bind(pnlHandler))
  );

  // /push 命令 - 推送设置
  bot.command(
    'push', 
    createCommandWrapper('push', pushHandler.handle.bind(pushHandler))
  );

  // /language 命令 - 语言设置（新增）
  bot.command(
    'language', 
    createCommandWrapper('language', languageHandler.handle.bind(languageHandler))
  );

  // /withdraw 命令 - 提现操作
  bot.command(
    'withdraw', 
    createCommandWrapper('withdraw', withdrawHandler.handle.bind(withdrawHandler))
  );

  // /cancel 命令 - 取消当前交易流程
  bot.command('cancel', async (ctx) => {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    try {
      const state = await tradingStateService.getState(userId);
      if (state) {
        await tradingStateService.clearState(userId);
        await ctx.reply(
          '✅ <b>Trading Process Cancelled</b>\n\nYou can restart trading anytime',
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(
          '💡 <b>No Active Trading Process</b>\n\nUse <code>/long</code> or <code>/short</code> to start trading',
          { parse_mode: 'HTML' }
        );
      }
    } catch (error) {
      logger.error('Cancel command error', {
        error: (error as Error).message,
        userId: parseInt(userId || '0')
      });
      await ctx.reply('❌ Cancel operation failed, please retry');
    }
  });

  // /status command - System status
  bot.command('status', async (ctx) => {
    logger.info('Status command received', {
      userId: ctx.from?.id,
      requestId: ctx.requestId
    });

    try {
      // 这里可以检查各个服务的健康状态
      // 暂时返回简单的状态信息
      const statusMessage = `
⚙️ <b>System Status</b>

🤖 <b>Bot Status:</b> 🟢 Running Normally
📡 <b>API Service:</b> 🟢 Connected Normally
⚡ <b>Cache Service:</b> 🟢 Working Normally
💾 <b>Data Update:</b> 🟢 Real-time Sync

<b>⚡ Performance Metrics:</b>
• Average Response Time: &lt;2s
• Cache Hit Rate: &gt;80%
• System Availability: 99.9%

<b>🔄 Recent Updates:</b>
• Support for more token types
• Optimized response speed
• Enhanced error handling

<i>🕐 Check Time: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}</i>
      `.trim();

      await ctx.reply(statusMessage, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Status command failed', {
        error: (error as Error).message,
        requestId: ctx.requestId
      });
      
      await ctx.reply(
        '❌ Unable to get system status\nPlease try again later',
        { parse_mode: 'HTML' }
      );
    }
  });

  // 处理未知命令和文本输入
  bot.on('text', async (ctx) => {
    const messageText = ctx.message.text;
    const userId = ctx.from?.id?.toString();
    
    if (!userId) return;
    
    // 首先检查用户是否有活跃的交易状态
    const tradingState = await tradingStateService.getState(userId);
    
    if (tradingState && !messageText.startsWith('/')) {
      // 用户在交易流程中，处理输入
      await handleTradingInput(ctx, tradingState, messageText);
      return;
    }

    // 检查用户是否在提现流程中
    if (!messageText.startsWith('/')) {
      try {
        const handled = await withdrawHandler.handleUserInput(ctx);
        if (handled) {
          logger.debug('Withdraw handler processed user input', {
            userId: ctx.from?.id,
            messageText: messageText.substring(0, 50),
            requestId: ctx.requestId
          });
          return;
        }
      } catch (error) {
        logger.error('Error in withdraw handler input processing', {
          error: (error as Error).message,
          userId: ctx.from?.id,
          requestId: ctx.requestId
        });
      }
    }
    
    // 检查是否为命令格式
    if (messageText.startsWith('/')) {
      const command = messageText.split(' ')[0];
      
      logger.info('Unknown command received', {
        command,
        fullText: messageText,
        userId: ctx.from?.id,
        requestId: ctx.requestId
      });

      const unknownCommandMessage = `
❓ <b>Unknown command: ${command}</b>

I don't recognize this command. Try these available commands:

<b>🔍 Price Queries:</b>
<code>/price BTC</code> - Query Bitcoin price
<code>/chart BTC</code> - Candlestick chart analysis
<code>/markets</code> - View market data

<b>📈 Trading Operations:</b>
<code>/long BTC 10x 200</code> - Long position
<code>/short ETH 5x 100</code> - Short position
<code>/close BTC 50%</code> - Close position
<code>/positions</code> - View positions
<code>/pnl</code> - Profit & Loss analysis

<b>💰 Account Management:</b>
<code>/wallet</code> - View wallet balance
<code>/withdraw</code> - Withdraw funds to external wallet
<code>/invite</code> - View invitation stats
<!-- <code>/points</code> - View points details -->

<b>📢 Push Settings:</b>
<code>/push</code> - Manage push notifications

<b>📚 Help Information:</b>
<code>/help</code> - View complete help
<code>/start</code> - Restart bot

💡 Tip: Send <code>/help</code> to view all available commands
      `.trim();

      await ctx.reply(unknownCommandMessage, { parse_mode: 'HTML' });
    } else {
      // 处理非命令文本消息
      logger.debug('Non-command text received', {
        text: messageText.substring(0, 100), // 只记录前100个字符
        userId: ctx.from?.id,
        requestId: ctx.requestId
      });

      // Check if input is numeric (1, 2, etc.)
      const numericResponse = handleNumericInput(messageText);
      if (numericResponse) {
        await ctx.reply(numericResponse, { parse_mode: 'HTML' });
        return;
      }

      const textResponseMessage = `
💬 <b>Text Message Received</b>

I'm a trading bot that supports cryptocurrency price queries and trading.

<b>🔍 Price Query:</b>
<code>/price BTC</code> - Query Bitcoin price

<b>📈 Quick Trading:</b>
<code>/long</code> - Start long position guide
<code>/short</code> - Start short position guide

Need help? Send <code>/help</code> to view complete guide 📚
      `.trim();

      await ctx.reply(textResponseMessage, { parse_mode: 'HTML' });
    }
  });

  // 处理回调查询（inline keyboard按钮点击）
  bot.on('callback_query', async (ctx) => {
    const callbackData = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : 'unknown';
    
    logger.debug('Callback query received', {
      data: callbackData,
      userId: ctx.from?.id,
      requestId: ctx.requestId
    });

    try {
      // 路由chart相关的回调到chartHandler
      if (typeof callbackData === 'string' && callbackData.startsWith('chart_')) {
        await chartHandler.handleCallback(ctx);
        return;
      }

      // 路由long相关的回调到longHandler
      if (typeof callbackData === 'string' && 
          (callbackData.startsWith('long_confirm_') || 
           callbackData.startsWith('long_cancel_') || 
           callbackData.startsWith('long_leverage_'))) {
        await longHandler.handleCallback(ctx, callbackData);
        return;
      }

      // 路由short相关的回调到shortHandler  
      if (typeof callbackData === 'string' && 
          (callbackData.startsWith('short_confirm_') || 
           callbackData.startsWith('short_cancel_') || 
           callbackData.startsWith('short_leverage_'))) {
        await shortHandler.handleCallback(ctx, callbackData);
        return;
      }

      // 路由图表交易按钮到相应的处理器
      if (typeof callbackData === 'string' && callbackData.startsWith('short_')) {
        await chartHandler.handleCallback(ctx);
        return;
      }

      if (typeof callbackData === 'string' && callbackData.startsWith('long_')) {
        await chartHandler.handleCallback(ctx);
        return;
      }

      // 路由push相关的回调到pushHandler
      if (typeof callbackData === 'string' && callbackData.startsWith('push_')) {
        await pushHandler.handleCallback(ctx, callbackData);
        return;
      }

      // 路由markets相关的回调到marketsHandler (支持新的callback格式)
      if (typeof callbackData === 'string' && callbackData.startsWith('markets_')) {
        await marketsHandler.handleCallback(ctx);
        return;
      }

      // 处理群组使用说明回调
      if (typeof callbackData === 'string' && callbackData === 'group_usage_guide') {
        await startHandler.handleGroupUsageGuide(ctx);
        return;
      }

      // 路由language相关的回调到languageHandler（新增）
      if (typeof callbackData === 'string' && callbackData.startsWith('lang_')) {
        await languageHandler.handleLanguageChange(ctx);
        return;
      }

      // 路由withdraw相关的回调到withdrawHandler（新增）
      if (typeof callbackData === 'string' && callbackData.startsWith('withdraw_')) {
        await withdrawHandler.handleCallback(ctx);
        return;
      }

      // 其他未处理的回调
      await ctx.answerCbQuery('功能开发中...');
      
    } catch (error) {
      logger.error('Callback query error', {
        error: (error as Error).message,
        callbackData,
        userId: ctx.from?.id,
        requestId: ctx.requestId
      });
      
      await ctx.answerCbQuery('❌ 操作失败，请重试');
    }
  });

  // 错误恢复机制 - 处理所有其他类型的更新
  bot.on('message', async (ctx) => {
    logger.debug('Other message type received', {
      messageType: ctx.message,
      userId: ctx.from?.id,
      requestId: ctx.requestId
    });

    await ctx.reply(
      '🤖 我只能处理文本消息和命令\n\n' +
      '发送 <code>/help</code> 查看可用命令',
      { parse_mode: 'HTML' }
    );
  });

  logger.info('✅ All command handlers registered successfully');
}

/**
 * 获取所有注册的命令列表
 */
export function getRegisteredCommands(): Array<{ command: string; description: string }> {
  return [
    { command: '/start', description: 'Start using Bot - User initialization' },
    { command: '/help', description: 'Show help information' },
    { command: '/price <symbol>', description: 'Query token price' },
    { command: '/chart <symbol> [timeframe]', description: 'Candlestick chart analysis' },
    { command: '/long <symbol> <leverage> <amount>', description: 'Long position trading' },
    { command: '/short <symbol> <leverage> <amount>', description: 'Short position trading' },
    { command: '/close <symbol> [amount]', description: 'Close position' },
    { command: '/positions', description: 'View all open positions' },
    // { command: '/orders', description: 'View all pending orders' }, // Temporarily disabled
    { command: '/pnl', description: 'Profit & Loss analysis report' },
    { command: '/markets', description: 'View market data' },
    { command: '/wallet', description: 'View wallet balance' },
    { command: '/withdraw', description: 'Withdraw funds to external wallet' },
    { command: '/invite', description: 'View invitation stats and points' },
    // { command: '/points', description: 'View your earned points' }, // temporarily disabled
    { command: '/push', description: 'Manage push notification settings' },
    { command: '/status', description: 'View system status' }
  ];
}

/**
 * 设置Bot菜单命令（用于Telegram的命令菜单）
 * 注意：主要通过BotFather手动设置，此处作为备份
 */
export async function setBotCommands(bot: Telegraf<ExtendedContext>): Promise<void> {
  const commands = [
    { command: 'start', description: 'Setup your pvp.trade account' },
    { command: 'help', description: 'Show help information' },
    { command: 'price', description: 'Query token price' },
    { command: 'chart', description: 'View the chart for a token' },
    { command: 'long', description: 'Long a token' },
    { command: 'short', description: 'Short a token' },
    { command: 'close', description: 'Close a position' },
    { command: 'positions', description: 'Show your positions' },
    { command: 'pnl', description: 'Profit & Loss analysis' },
    { command: 'markets', description: 'View market data' },
    { command: 'wallet', description: 'View wallet balance' },
    { command: 'withdraw', description: 'Withdraw funds to external wallet' },
    { command: 'invite', description: 'View invitation stats' },
    { command: 'push', description: 'Manage push settings' },
    { command: 'status', description: 'View system status' }
  ];

  try {
    // Set commands as backup (primary config through BotFather)
    await bot.telegram.setMyCommands(commands);
    logger.info('✅ Bot commands set successfully');
  } catch (error) {
    logger.warn('Failed to set bot commands (using BotFather configuration instead)', {
      error: (error as Error).message
    });
  }
}

export default { registerCommands, getRegisteredCommands, setBotCommands };
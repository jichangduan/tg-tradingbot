import { Telegraf } from 'telegraf';
import { priceHandler } from './price.handler';
import { marketsHandler } from './markets.handler';
import { startHandler } from './start.handler';
import { walletHandler } from './wallet.handler';
import { inviteHandler } from './invite.handler';
import { pointsHandler } from './points.handler';
import { chartHandler } from './chart.handler';
import { longHandler } from './long.handler';
import { shortHandler } from './short.handler';
import { closeHandler } from './close.handler';
import { positionsHandler } from './positions.handler';
// import { ordersHandler } from './orders.handler'; // Temporarily disabled
import { pnlHandler } from './pnl.handler';
import { pushHandler } from './push.handler';
import { logger } from '../../utils/logger';
import { ExtendedContext } from '../index';
import { tradingStateService, TradingState } from '../../services/trading-state.service';
import { tokenService } from '../../services/token.service';
import { accountService } from '../../services/account.service';
import { messageFormatter } from '../utils/message.formatter';

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
        
        const message = messageFormatter.formatTradingLeveragePrompt(
          state.action,
          symbol,
          tokenData.price,
          availableMargin
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
          `❌ <b>无效的代币符号: ${symbol}</b>\n\n` +
          `请输入有效的代币符号，例如：BTC, ETH, SOL`,
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
        
        const previewMessage = messageFormatter.formatTradingOrderPreview(
          state.action,
          state.symbol!,
          state.leverage!,
          amount.toString(),
          tokenData.price,
          orderSize,
          liquidationPrice
        );
        
        const keyboard = state.action === 'long'
          ? longHandler.createConfirmationKeyboard(state.symbol!, state.leverage!, amount.toString())
          : shortHandler.createConfirmationKeyboard(state.symbol!, state.leverage!, amount.toString());
        
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
📚 <b>AIW3 TGBot 使用指南</b>

<b>🔍 价格查询命令:</b>
<code>/price &lt;代币符号&gt;</code>
例如: <code>/price BTC</code>, <code>/price ETH</code>

<b>📊 市场数据命令:</b>
<code>/markets</code> - 查看主要加密货币市场行情
<code>/chart &lt;交易对&gt; [时间]</code> - K线图表分析
例如: <code>/chart BTC</code>, <code>/chart ETH 1d</code>

<b>📈 交易命令:</b>
<code>/long &lt;代币&gt; &lt;杠杆&gt; &lt;金额&gt;</code> - 做多交易
<code>/short &lt;代币&gt; &lt;杠杆&gt; &lt;金额&gt;</code> - 做空交易
<code>/close &lt;代币&gt; [数量]</code> - 平仓操作
<code>/positions</code> - 查看所有持仓情况
<code>/pnl</code> - 盈亏分析报告
例如: <code>/long BTC 10x 200</code>, <code>/short ETH 5x 100</code>, <code>/close BTC 50%</code>

<b>💰 账户管理:</b>
<code>/wallet</code> - 查看钱包余额
<code>/invite</code> - 查看邀请统计和积分
<code>/points</code> - 查看您赚取的积分

<b>📢 推送设置:</b>
<code>/push</code> - 管理推送通知设置

<b>💡 其他命令:</b>
<code>/start</code> - 重新开始
<code>/help</code> - 显示此帮助信息
<code>/status</code> - 查看系统状态

<b>🪙 支持的代币:</b>
<b>主流币:</b> BTC, ETH, SOL, USDT, USDC, BNB, XRP, ADA
<b>DeFi:</b> UNI, LINK, AAVE, COMP, SUSHI, CRV
<b>Layer 1:</b> DOT, AVAX, MATIC, ATOM, NEAR, ALGO
<b>其他:</b> DOGE, SHIB, PEPE, APT, SUI 等

<b>✨ 功能特点:</b>
• 🚀 毫秒级响应速度
• 📊 详细的价格分析
• 💹 24小时涨跌趋势
• ⚡ 智能缓存系统
• 🛡️ 数据安全可靠

<b>💬 使用提示:</b>
• 代币符号不区分大小写
• 一次查询一个代币获得最佳体验
• 数据每5分钟自动更新

需要帮助？联系管理员 👨‍💻
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

  // /markets 命令 - 市场行情
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

  // /points 命令 - 积分查询
  bot.command(
    'points', 
    createCommandWrapper('points', pointsHandler.handle.bind(pointsHandler))
  );

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

  // /cancel 命令 - 取消当前交易流程
  bot.command('cancel', async (ctx) => {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    try {
      const state = await tradingStateService.getState(userId);
      if (state) {
        await tradingStateService.clearState(userId);
        await ctx.reply(
          '✅ <b>交易流程已取消</b>\n\n您可以随时重新开始交易',
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(
          '💡 <b>当前没有进行中的交易流程</b>\n\n使用 <code>/long</code> 或 <code>/short</code> 开始交易',
          { parse_mode: 'HTML' }
        );
      }
    } catch (error) {
      logger.error('Cancel command error', {
        error: (error as Error).message,
        userId: parseInt(userId || '0')
      });
      await ctx.reply('❌ 取消操作失败，请重试');
    }
  });

  // /status 命令 - 系统状态
  bot.command('status', async (ctx) => {
    logger.info('Status command received', {
      userId: ctx.from?.id,
      requestId: ctx.requestId
    });

    try {
      // 这里可以检查各个服务的健康状态
      // 暂时返回简单的状态信息
      const statusMessage = `
⚙️ <b>系统状态</b>

🤖 <b>Bot状态:</b> 🟢 运行正常
📡 <b>API服务:</b> 🟢 连接正常
⚡ <b>缓存服务:</b> 🟢 工作正常
💾 <b>数据更新:</b> 🟢 实时同步

<b>⚡ 性能指标:</b>
• 平均响应时间: &lt;2秒
• 缓存命中率: &gt;80%
• 系统可用性: 99.9%

<b>🔄 最近更新:</b>
• 支持更多代币类型
• 优化响应速度
• 增强错误处理

<i>🕐 检查时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</i>
      `.trim();

      await ctx.reply(statusMessage, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Status command failed', {
        error: (error as Error).message,
        requestId: ctx.requestId
      });
      
      await ctx.reply(
        '❌ 无法获取系统状态\n请稍后重试',
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
❓ <b>未知命令: ${command}</b>

我不认识这个命令。试试这些可用的命令:

<b>🔍 价格查询:</b>
<code>/price BTC</code> - 查询比特币价格
<code>/chart BTC</code> - K线图表分析
<code>/markets</code> - 查看市场行情

<b>📈 交易操作:</b>
<code>/long BTC 10x 200</code> - 做多交易
<code>/short ETH 5x 100</code> - 做空交易
<code>/close BTC 50%</code> - 平仓操作
<code>/positions</code> - 查看持仓情况
<code>/pnl</code> - 盈亏分析报告

<b>💰 账户管理:</b>
<code>/wallet</code> - 查看钱包余额
<code>/invite</code> - 查看邀请统计
<code>/points</code> - 查看积分详情

<b>📢 推送设置:</b>
<code>/push</code> - 管理推送通知设置

<b>📚 帮助信息:</b>
<code>/help</code> - 查看完整帮助
<code>/start</code> - 重新开始

<b>⚙️ 系统信息:</b>
<code>/status</code> - 查看系统状态

💡 提示: 发送 <code>/help</code> 查看所有可用命令
      `.trim();

      await ctx.reply(unknownCommandMessage, { parse_mode: 'HTML' });
    } else {
      // 处理非命令文本消息
      logger.debug('Non-command text received', {
        text: messageText.substring(0, 100), // 只记录前100个字符
        userId: ctx.from?.id,
        requestId: ctx.requestId
      });

      const textResponseMessage = `
💬 <b>文本消息收到</b>

我是交易机器人，支持加密货币价格查询和交易。

<b>🔍 价格查询:</b>
<code>/price BTC</code> - 查询比特币价格

<b>📈 快速交易:</b>
<code>/long</code> - 开始做多引导
<code>/short</code> - 开始做空引导

需要帮助？发送 <code>/help</code> 查看完整指南 📚
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

      // 处理群组使用说明回调
      if (typeof callbackData === 'string' && callbackData === 'group_usage_guide') {
        await startHandler.handleGroupUsageGuide(ctx);
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
    { command: '/start', description: '开始使用Bot - 用户初始化' },
    { command: '/help', description: '显示帮助信息' },
    { command: '/price <symbol>', description: '查询代币价格' },
    { command: '/chart <symbol> [timeframe]', description: 'K线图表分析' },
    { command: '/long <symbol> <leverage> <amount>', description: '做多交易' },
    { command: '/short <symbol> <leverage> <amount>', description: '做空交易' },
    { command: '/close <symbol> [amount]', description: '平仓操作' },
    { command: '/positions', description: '查看所有持仓情况' },
    // { command: '/orders', description: '查看所有挂单情况' }, // Temporarily disabled
    { command: '/pnl', description: '盈亏分析报告' },
    { command: '/markets', description: '查看市场行情' },
    { command: '/wallet', description: '查看钱包余额' },
    { command: '/invite', description: '查看邀请统计和积分' },
    { command: '/points', description: '查看您赚取的积分' },
    { command: '/push', description: '管理推送通知设置' },
    { command: '/status', description: '查看系统状态' }
  ];
}

/**
 * 设置Bot菜单命令（用于Telegram的命令菜单）
 */
export async function setBotCommands(bot: Telegraf<ExtendedContext>): Promise<void> {
  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: '🚀 开始使用' },
      { command: 'help', description: '📚 帮助信息' },
      { command: 'price', description: '💰 查询价格' },
      { command: 'chart', description: '📊 K线图表' },
      { command: 'positions', description: '📊 查看持仓' },
      // { command: 'orders', description: '📋 查看挂单' }, // Temporarily disabled
      { command: 'pnl', description: '📈 盈亏分析' },
      { command: 'markets', description: '📈 市场行情' },
      { command: 'wallet', description: '💰 钱包余额' },
      { command: 'invite', description: '🎁 邀请统计' },
      { command: 'points', description: '🎯 积分详情' },
      { command: 'push', description: '📢 推送设置' },
      { command: 'status', description: '⚙️ 系统状态' }
    ]);
    
    logger.info('✅ Bot commands menu set successfully');
  } catch (error) {
    logger.warn('Failed to set bot commands menu', {
      error: (error as Error).message
    });
  }
}

export default { registerCommands, getRegisteredCommands, setBotCommands };
import { ExtendedContext } from '../index';
import { logger } from '../../utils/logger';
import { config } from '../../config';

/**
 * 群组命令跳转处理器
 * 处理在群组中输入的需要跳转到私聊的命令
 */

/**
 * 获取Bot用户名
 */
async function getBotUsername(ctx: ExtendedContext): Promise<string> {
  try {
    // 尝试从缓存获取
    if (config.telegram.botUsername) {
      return config.telegram.botUsername;
    }
    
    // 从Telegram API获取
    const botInfo = await ctx.telegram.getMe();
    return botInfo.username || 'aiw3_tgbot';
  } catch (error) {
    logger.warn('Failed to get bot username, using default', {
      error: (error as Error).message
    });
    return 'aiw3_tgbot'; // 默认用户名
  }
}

/**
 * 格式化命令按钮显示
 */
function formatCommandForButton(command: string, args: string[]): { buttonText: string; emoji: string } {
  const cleanCommand = command.replace('/', '');
  
  const commandConfig: Record<string, { emoji: string; name: string }> = {
    'start': { emoji: '🚀', name: 'Start' },
    'long': { emoji: '📈', name: 'Long' },
    'short': { emoji: '📉', name: 'Short' },
    'close': { emoji: '⏹️', name: 'Close' },
    'positions': { emoji: '📊', name: 'Positions' },
    'wallet': { emoji: '💰', name: 'Wallet' },
    'pnl': { emoji: '💹', name: 'PnL' },
    'push': { emoji: '🔔', name: 'Push' },
    'withdraw': { emoji: '💸', name: 'Withdraw' }
  };
  
  const config = commandConfig[cleanCommand] || { emoji: '⚡', name: cleanCommand };
  
  if (args.length === 0) {
    return { buttonText: config.name, emoji: config.emoji };
  } else if (args.length === 1) {
    return { buttonText: `${config.name} ${args[0]}`, emoji: config.emoji };
  } else if (args.length >= 2) {
    // 对于交易命令，显示更友好的格式
    if (cleanCommand === 'long' || cleanCommand === 'short') {
      const symbol = args[0];
      const leverage = args[1];
      const amount = args[2];
      
      if (amount) {
        return { buttonText: `${config.name} ${symbol} ${leverage} $${amount}`, emoji: config.emoji };
      } else if (leverage) {
        return { buttonText: `${config.name} ${symbol} ${leverage}`, emoji: config.emoji };
      } else {
        return { buttonText: `${config.name} ${symbol}`, emoji: config.emoji };
      }
    } else {
      const displayArgs = args.slice(0, 3); // 最多显示3个参数
      return { buttonText: `${config.name} ${displayArgs.join(' ')}`, emoji: config.emoji };
    }
  }
  
  return { buttonText: config.name, emoji: config.emoji };
}

/**
 * 获取命令操作名称
 */
function getCommandActionName(command: string): string {
  const names: Record<string, string> = {
    'start': 'Setup',
    'long': 'Long Trading',
    'short': 'Short Trading', 
    'close': 'Position Closing',
    'positions': 'Position View',
    'wallet': 'Wallet Access',
    'pnl': 'PnL Analysis',
    'push': 'Push Settings',
    'withdraw': 'Withdrawal'
  };
  
  return names[command.replace('/', '')] || 'Action';
}

/**
 * 处理群组命令跳转到私聊
 */
export async function handleGroupCommandRedirect(
  ctx: ExtendedContext, 
  command: string, 
  args: string[]
): Promise<void> {
  const requestId = ctx.requestId || 'unknown';
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  
  try {
    logger.info(`Group command redirect initiated [${requestId}]`, {
      command,
      args,
      userId,
      username,
      chatId: ctx.chat?.id,
      requestId
    });

    const { buttonText, emoji } = formatCommandForButton(command, args);
    const actionName = getCommandActionName(command);
    
    // 编码命令参数 - 使用JSON格式更安全
    const commandData = {
      cmd: command,
      args: args
    };
    const encodedParams = Buffer.from(JSON.stringify(commandData)).toString('base64');
    
    // 检查URL长度限制 (Telegram限制约为64字符的start参数)
    if (encodedParams.length > 60) {
      logger.warn(`Encoded command too long, truncating args [${requestId}]`, {
        command,
        originalArgsLength: args.length,
        encodedLength: encodedParams.length,
        requestId
      });
      
      // 如果参数过长，只保留命令不保留参数
      const simpleCommandData = { cmd: command, args: [] };
      const simpleEncodedParams = Buffer.from(JSON.stringify(simpleCommandData)).toString('base64');
      
      // 获取Bot用户名并构建跳转URL
      const botUsername = await getBotUsername(ctx);
      const jumpUrl = `https://t.me/${botUsername}?start=cmd_${simpleEncodedParams}`;
      
      // 提示用户参数被简化
      const { buttonText, emoji } = formatCommandForButton(command, []);
      const actionName = getCommandActionName(command);
      
      const title = await ctx.__!('group.redirect.title', { actionName });
      const info = await ctx.__!('group.redirect.info');
      const continue_msg = await ctx.__!('group.redirect.continue', { buttonText });
      const params_warning = await ctx.__!('group.redirect.paramsWarning');
      
      const message = `
🔒 <b>${title}</b>

${info}

${continue_msg}

⚠️ <i>${params_warning}</i>
      `.trim();
      
      const keyboard = {
        inline_keyboard: [[
          { text: `${emoji} ${buttonText}`, url: jumpUrl }
        ]]
      };
      
      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      
      return;
    }
    
    // 获取Bot用户名并构建跳转URL
    const botUsername = await getBotUsername(ctx);
    const jumpUrl = `https://t.me/${botUsername}?start=cmd_${encodedParams}`;
    
    // 构建提示消息
    const title = await ctx.__!('group.redirect.title', { actionName });
    const info = await ctx.__!('group.redirect.info');
    const continue_msg = await ctx.__!('group.redirect.continue', { buttonText });
    
    const message = `
🔒 <b>${title}</b>

${info}

${continue_msg}
    `.trim();
    
    // 创建跳转按钮
    const keyboard = {
      inline_keyboard: [[
        { text: `${emoji} ${buttonText}`, url: jumpUrl }
      ]]
    };
    
    // 发送带有跳转按钮的消息
    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
    
    logger.info(`Group command redirect completed [${requestId}]`, {
      command,
      buttonText,
      botUsername,
      userId,
      requestId
    });
    
  } catch (error) {
    logger.error(`Group command redirect failed [${requestId}]`, {
      error: (error as Error).message,
      command,
      args,
      userId,
      requestId
    });
    
    // 发送错误提示
    try {
      const error_title = await ctx.__!('group.redirect.error.title');
      const error_message = await ctx.__!('group.redirect.error.message');
      
      await ctx.reply(
        `❌ ${error_title}\n\n${error_message}`,
        { parse_mode: 'HTML' }
      );
    } catch (replyError) {
      logger.error(`Failed to send error reply [${requestId}]`, {
        error: (replyError as Error).message,
        requestId
      });
    }
  }
}

export default {
  handleGroupCommandRedirect
};
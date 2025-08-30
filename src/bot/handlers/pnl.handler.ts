import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';
import { cacheService } from '../../services/cache.service';
import { MessageFormatter } from '../utils/message.formatter';
import { Validator } from '../utils/validator';
import { ExtendedContext } from '../index';
import { getUserAccessToken } from '../../utils/auth';

/**
 * 交易记录接口
 */
interface Trade {
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  price: string;
  fee: string;
  timestamp: number;
  value: string;
}

/**
 * 统计数据接口
 */
interface Statistics {
  totalVolume: string;
  totalFees: string;
  buyTrades: number;
  sellTrades: number;
  averageTradeSize: string;
  tradingDays: number;
}

/**
 * 交易对统计接口
 */
interface SymbolBreakdown {
  symbol: string;
  trades: number;
  volume: string;
  fees: string;
  buyTrades: number;
  sellTrades: number;
}

/**
 * 日期统计接口
 */
interface DailyBreakdown {
  date: string;
  trades: number;
  volume: string;
  fees: string;
}

/**
 * PNL查询响应接口
 */
interface PnlResponse {
  code: number;
  data: {
    trades: Trade[];
    totalTrades: number;
    statistics: Statistics;
    symbolBreakdown: SymbolBreakdown[];
    dailyBreakdown: DailyBreakdown[];
  };
  message: string;
}

/**
 * PNL盈亏分析命令处理器
 * 处理用户的 /pnl 命令，查询并显示历史交易记录和盈亏统计分析
 */
export class PnlHandler {
  private formatter: MessageFormatter;
  private validator: Validator;
  private readonly cacheKey = 'tgbot:pnl:';
  private readonly cacheTTL = 60; // 60秒缓存（盈亏数据相对稳定）

  constructor() {
    this.formatter = new MessageFormatter();
    this.validator = new Validator();
  }

  /**
   * 处理 /pnl 命令
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ 无法识别用户身份');
      return;
    }

    // 发送加载消息
    const loadingMessage = await ctx.reply(
      '📊 正在生成您的盈亏分析报告...\n' +
      '⏳ 请稍候，正在计算历史数据'
    );

    try {
      // 尝试从缓存获取数据
      const cachedData = await this.getCachedPnl(userId);
      if (cachedData) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMessage.message_id,
          undefined,
          cachedData,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 从API获取数据
      const pnlData = await this.fetchPnlFromAPI(userId, ctx);
      const formattedMessage = this.formatPnlMessage(pnlData);
      
      // 缓存结果
      await this.cachePnl(userId, formattedMessage);

      // 更新消息
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMessage.message_id,
        undefined,
        formattedMessage,
        { parse_mode: 'HTML' }
      );

    } catch (error) {
      const errorMessage = this.handleError(error as Error);
      
      try {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMessage.message_id,
          undefined,
          errorMessage,
          { parse_mode: 'HTML' }
        );
      } catch (editError) {
        await ctx.reply(errorMessage, { parse_mode: 'HTML' });
      }

      logger.error('PNL command failed', {
        error: (error as Error).message,
        userId,
        requestId: ctx.requestId
      });
    }
  }

  /**
   * 从API获取PNL数据
   */
  private async fetchPnlFromAPI(userId: number, ctx?: ExtendedContext): Promise<PnlResponse> {
    // 获取用户的access token，支持fallback重新认证
    const userToken = await this.getUserAccessToken(userId, ctx);
    
    if (!userToken) {
      throw new Error('用户未登录，请先使用 /start 命令登录');
    }

    const response = await apiService.getWithAuth<PnlResponse>(
      '/api/tgbot/trading/pnl',
      userToken,
      {},
      { timeout: 15000 } // 增加超时时间，因为数据计算较复杂
    );

    if (response.code !== 200) {
      throw new Error(response.message || '获取盈亏分析失败');
    }

    return response;
  }

  /**
   * 格式化PNL分析消息
   */
  private formatPnlMessage(data: PnlResponse): string {
    const { trades, totalTrades, statistics, symbolBreakdown, dailyBreakdown } = data.data;

    // 如果没有交易记录
    if (totalTrades === 0) {
      return `
📊 <b>盈亏分析报告</b>

📈 <b>交易统计:</b>
• 总交易次数: 0
• 成交量: $0.00
• 手续费: $0.00
• 交易天数: 0

📝 <b>交易记录:</b>
暂无交易记录

💡 <i>开始交易获取盈亏数据:</i>
• <code>/long BTC 10x 100</code> - 做多BTC
• <code>/short ETH 5x 50</code> - 做空ETH
• <code>/markets</code> - 查看市场行情

<i>🕐 分析时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</i>
      `.trim();
    }

    // 生成完整的盈亏分析报告
    let analysisMessage = `
📊 <b>盈亏分析报告</b>

📈 <b>交易统计:</b>
• 总交易次数: ${totalTrades.toLocaleString()}
• 总成交量: $${this.formatNumber(statistics.totalVolume)}
• 总手续费: $${this.formatNumber(statistics.totalFees)}
• 买入交易: ${statistics.buyTrades} (${((statistics.buyTrades / totalTrades) * 100).toFixed(1)}%)
• 卖出交易: ${statistics.sellTrades} (${((statistics.sellTrades / totalTrades) * 100).toFixed(1)}%)
• 平均交易规模: $${this.formatNumber(statistics.averageTradeSize)}
• 交易天数: ${statistics.tradingDays}天

📊 <b>主要交易对分析:</b>
${this.formatSymbolBreakdown(symbolBreakdown)}

📅 <b>近期交易活动:</b>
${this.formatDailyBreakdown(dailyBreakdown)}

📝 <b>最近交易记录 (最新${Math.min(trades.length, 10)}笔):</b>
${this.formatRecentTrades(trades.slice(0, 10))}

💡 <i>交易建议:</i>
• <code>/positions</code> - 查看当前持仓
• <code>/orders</code> - 查看挂单情况
• <code>/markets</code> - 分析市场行情

<i>🕐 分析时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</i>
    `.trim();

    return analysisMessage;
  }

  /**
   * 格式化交易对统计
   */
  private formatSymbolBreakdown(breakdown: SymbolBreakdown[]): string {
    if (breakdown.length === 0) {
      return '暂无数据';
    }

    // 取前5个最活跃的交易对
    const topSymbols = breakdown.slice(0, 5);
    
    return topSymbols.map((item, index) => {
      const buyPercentage = item.trades > 0 ? ((item.buyTrades / item.trades) * 100).toFixed(1) : '0.0';
      return `${index + 1}. <b>${item.symbol}</b>: ${item.trades}笔, $${this.formatNumber(item.volume)} (买入${buyPercentage}%)`;
    }).join('\n');
  }

  /**
   * 格式化日期统计
   */
  private formatDailyBreakdown(breakdown: DailyBreakdown[]): string {
    if (breakdown.length === 0) {
      return '暂无数据';
    }

    // 取最近7天的数据
    const recentDays = breakdown.slice(-7).reverse();
    
    return recentDays.map((item, index) => {
      const date = new Date(item.date).toLocaleDateString('zh-CN', { 
        month: '2-digit', 
        day: '2-digit' 
      });
      return `${date}: ${item.trades}笔交易, $${this.formatNumber(item.volume)}`;
    }).join('\n');
  }

  /**
   * 格式化最近交易记录
   */
  private formatRecentTrades(trades: Trade[]): string {
    if (trades.length === 0) {
      return '暂无数据';
    }

    return trades.map((trade, index) => {
      const sideIcon = trade.side === 'buy' ? '🟢' : '🔴';
      const sideText = trade.side === 'buy' ? '买' : '卖';
      const tradeTime = new Date(trade.timestamp * 1000).toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      return `${sideIcon} <b>${trade.symbol}</b> ${sideText} ${this.formatNumber(trade.quantity)} @$${this.formatNumber(trade.price)} (${tradeTime})`;
    }).join('\n');
  }

  /**
   * 数字格式化工具
   */
  private formatNumber(value: string | number): string {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    
    if (isNaN(num)) {
      return '0.00';
    }

    // 大数值使用K, M简写
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(2) + 'K';
    } else if (num >= 1) {
      return num.toFixed(2);
    } else {
      return num.toFixed(4);
    }
  }

  /**
   * 错误处理
   */
  private handleError(error: Error): string {
    logger.error('PNL handler error:', { error: error.message });

    if (error.message.includes('未登录')) {
      return `
❌ <b>用户未登录</b>

请先使用 /start 命令登录系统后再查询盈亏分析。

<i>如果您已经登录但仍出现此错误，请联系管理员。</i>
      `.trim();
    }

    if (error.message.includes('网络')) {
      return `
❌ <b>网络连接失败</b>

请检查网络连接后重试，或稍后再试。

<i>如果问题持续存在，请联系管理员。</i>
      `.trim();
    }

    return `
❌ <b>分析失败</b>

生成盈亏分析报告时出现错误，请稍后重试。

<b>错误详情:</b> ${error.message}

<i>如果问题持续存在，请联系管理员。</i>
    `.trim();
  }

  /**
   * 获取缓存的PNL数据
   */
  private async getCachedPnl(userId: number): Promise<string | null> {
    try {
      const key = `${this.cacheKey}${userId}`;
      const result = await cacheService.get<string>(key);
      if (result.success && result.data) {
        return result.data;
      }
      return null;
    } catch (error) {
      logger.warn('Failed to get cached pnl', { error: (error as Error).message, userId });
      return null;
    }
  }

  /**
   * 缓存PNL数据
   */
  private async cachePnl(userId: number, data: string): Promise<void> {
    try {
      const key = `${this.cacheKey}${userId}`;
      await cacheService.set(key, data, this.cacheTTL);
    } catch (error) {
      logger.warn('Failed to cache pnl', { error: (error as Error).message, userId });
    }
  }

  /**
   * 获取用户的访问令牌
   * 支持从缓存获取，如果没有则尝试重新认证并缓存
   */
  private async getUserAccessToken(userId: number, ctx?: ExtendedContext): Promise<string | null> {
    try {
      // 方案1: 从缓存中获取用户token
      const tokenKey = `user:token:${userId}`;
      const result = await cacheService.get<string>(tokenKey);
      
      if (result.success && result.data) {
        logger.debug('AccessToken found in cache', { userId, tokenKey });
        return result.data;
      }

      // 方案2: 如果缓存中没有token，尝试通过用户信息重新获取
      if (ctx && ctx.from) {
        logger.info('AccessToken not in cache, attempting to re-authenticate', { userId });
        
        const userInfo = {
          username: ctx.from.username,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name
        };

        try {
          const freshToken = await getUserAccessToken(userId.toString(), userInfo);
          
          // 将新获取的token缓存起来
          await this.cacheUserAccessToken(userId, freshToken);
          
          logger.info('AccessToken re-authenticated and cached successfully', { userId });
          return freshToken;
        } catch (authError) {
          logger.warn('Failed to re-authenticate user', {
            userId,
            error: (authError as Error).message
          });
        }
      }

      // 方案3: 如果所有方法都失败，返回null
      logger.warn('No access token available for user', { userId });
      return null;

    } catch (error) {
      logger.error('Failed to get user access token', { 
        error: (error as Error).message, 
        userId 
      });
      return null;
    }
  }

  /**
   * 缓存用户的accessToken
   */
  private async cacheUserAccessToken(userId: number, accessToken: string): Promise<void> {
    try {
      const tokenKey = `user:token:${userId}`;
      const tokenTTL = 24 * 60 * 60; // 24小时过期
      
      const result = await cacheService.set(tokenKey, accessToken, tokenTTL);
      
      if (result.success) {
        logger.debug('AccessToken cached in pnl handler', {
          userId,
          tokenKey,
          expiresIn: tokenTTL
        });
      } else {
        logger.warn('Failed to cache accessToken in pnl handler', {
          userId,
          tokenKey,
          error: result.error
        });
      }
    } catch (error) {
      logger.error('Error caching accessToken in pnl handler', {
        userId,
        error: (error as Error).message
      });
    }
  }
}

// 导出处理器实例
export const pnlHandler = new PnlHandler();
export default pnlHandler;
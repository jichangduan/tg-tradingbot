import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';
import { cacheService } from '../../services/cache.service';
import { MessageFormatter } from '../utils/message.formatter';
import { Validator } from '../utils/validator';
import { ExtendedContext } from '../index';
import { getUserAccessToken } from '../../utils/auth';
import { chartImageService, PnlChartData, PnlDataPoint } from '../../services/chart-image.service';

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

      // 🔧 生成并发送PNL趋势图表
      try {
        if (pnlData.data.trades.length > 0) {
          const chartData = this.preparePnlChartData(pnlData);
          const chartImage = await chartImageService.generatePnlChart(chartData);
          
          // 发送图表图片
          await ctx.replyWithPhoto({ source: chartImage.imageBuffer }, {
            caption: '📈 PNL趋势图表',
            parse_mode: 'HTML'
          });
          
          logger.info('PNL chart sent successfully', {
            userId,
            totalPnl: chartData.totalPnl,
            dataPoints: chartData.pnlHistory.length
          });
        }
      } catch (chartError) {
        logger.warn('Failed to generate PNL chart', {
          userId,
          error: (chartError as Error).message
        });
        // 图表生成失败不影响主要功能
      }

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

    // 🔧 数据质量验证和清理
    this.validateAndCleanPnlData(response, userId);

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

    // 🔧 去重处理：根据组合键去除重复交易
    const uniqueTrades = this.deduplicateTrades(trades);
    
    // 🔧 数据质量检查
    const duplicateCount = trades.length - uniqueTrades.length;
    if (duplicateCount > 0) {
      logger.warn('PNL: Detected duplicate trades', {
        originalCount: trades.length,
        uniqueCount: uniqueTrades.length,
        duplicatesRemoved: duplicateCount
      });
    }

    // 限制显示最新10笔不重复的交易
    const displayTrades = uniqueTrades.slice(0, 10);

    let tradesText = displayTrades.map((trade, index) => {
      const sideIcon = trade.side === 'buy' ? '🟢' : '🔴';
      const sideText = trade.side === 'buy' ? '买' : '卖';
      
      // 🔧 改进时间显示，包含秒数避免相同时间
      const tradeTime = new Date(trade.timestamp * 1000).toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      return `${sideIcon} <b>${trade.symbol}</b> ${sideText} ${this.formatNumber(trade.quantity)} @$${this.formatNumber(trade.price)} (${tradeTime})`;
    }).join('\n');

    // 🔧 如果检测到重复数据，添加说明
    if (duplicateCount > 0) {
      tradesText += `\n\n⚠️ <i>已过滤${duplicateCount}条重复记录</i>`;
    }

    return tradesText;
  }

  /**
   * 去除重复的交易记录
   */
  private deduplicateTrades(trades: Trade[]): Trade[] {
    const seen = new Set<string>();
    const uniqueTrades: Trade[] = [];

    for (const trade of trades) {
      // 创建唯一标识符：如果有tradeId使用tradeId，否则使用组合键
      const uniqueKey = trade.tradeId || 
        `${trade.symbol}_${trade.side}_${trade.quantity}_${trade.price}_${trade.timestamp}`;
      
      if (!seen.has(uniqueKey)) {
        seen.add(uniqueKey);
        uniqueTrades.push(trade);
      }
    }

    return uniqueTrades;
  }

  /**
   * 验证和清理PNL数据质量
   */
  private validateAndCleanPnlData(response: PnlResponse, userId: number): void {
    const { data } = response;
    
    if (!data || !data.trades) {
      logger.warn('PNL: Invalid response data structure', { userId });
      return;
    }

    const trades = data.trades;
    const issues: string[] = [];

    // 🔧 检查重复交易
    const uniqueTradeIds = new Set<string>();
    let duplicateCount = 0;
    
    for (const trade of trades) {
      const key = trade.tradeId || `${trade.symbol}_${trade.side}_${trade.quantity}_${trade.price}_${trade.timestamp}`;
      if (uniqueTradeIds.has(key)) {
        duplicateCount++;
      } else {
        uniqueTradeIds.add(key);
      }
    }

    if (duplicateCount > trades.length * 0.3) { // 超过30%重复
      issues.push(`High duplicate rate: ${duplicateCount}/${trades.length} (${((duplicateCount/trades.length)*100).toFixed(1)}%)`);
    }

    // 🔧 检查时间戳异常
    let sameTimestampCount = 0;
    const timestamps = trades.map(t => t.timestamp);
    const uniqueTimestamps = new Set(timestamps);
    
    if (uniqueTimestamps.size < timestamps.length * 0.7) { // 少于70%的唯一时间戳
      sameTimestampCount = timestamps.length - uniqueTimestamps.size;
      issues.push(`Many trades with same timestamp: ${sameTimestampCount}/${timestamps.length}`);
    }

    // 🔧 检查价格异常
    const priceGroups = new Map<string, number>();
    for (const trade of trades) {
      const priceKey = `${trade.symbol}_${trade.price}`;
      priceGroups.set(priceKey, (priceGroups.get(priceKey) || 0) + 1);
    }

    let highRepeatPriceCount = 0;
    for (const [key, count] of priceGroups) {
      if (count > 5) { // 同一个价格出现超过5次
        highRepeatPriceCount += count;
      }
    }

    if (highRepeatPriceCount > trades.length * 0.4) { // 超过40%
      issues.push(`High price repetition: ${highRepeatPriceCount}/${trades.length} trades with repeated prices`);
    }

    // 🔧 记录数据质量问题
    if (issues.length > 0) {
      logger.warn('PNL: Data quality issues detected', {
        userId,
        totalTrades: trades.length,
        uniqueTrades: uniqueTradeIds.size,
        duplicates: duplicateCount,
        sameTimestamp: sameTimestampCount,
        issues,
        dataQuality: issues.length > 2 ? 'POOR' : 'MODERATE'
      });

      // 🔧 如果数据质量很差，添加警告到响应中
      if (issues.length > 2) {
        logger.error('PNL: Poor data quality detected - likely backend API issue', {
          userId,
          issues,
          suggestion: 'Contact backend team to check /api/tgbot/trading/pnl endpoint'
        });
      }
    } else {
      logger.debug('PNL: Data quality check passed', {
        userId,
        totalTrades: trades.length,
        uniqueTrades: uniqueTradeIds.size
      });
    }
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

    // 🔧 判断是否为外部接口问题（API返回400/500等状态码）
    if (error.message.includes('status code 400')) {
      return `
❌ <b>外部接口错误 (400)</b>

盈亏分析接口暂时不可用，这是后端API接口问题。

💡 <b>建议操作:</b>
• 稍后重试此命令
• 联系管理员报告接口故障
• 使用其他命令如 /positions 查看持仓

⚠️ <i>这不是您的操作问题，而是系统接口需要修复。</i>
      `.trim();
    }

    if (error.message.includes('status code 500') || error.message.includes('status code 502') || error.message.includes('status code 503')) {
      return `
❌ <b>服务器错误</b>

后端服务暂时不可用，请稍后重试。

💡 <b>建议操作:</b>
• 等待5-10分钟后重试
• 检查其他命令是否正常工作
• 联系管理员确认服务状态

⚠️ <i>这是临时性服务问题，通常会自动恢复。</i>
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
   * 准备PNL图表数据
   */
  private preparePnlChartData(pnlData: PnlResponse): PnlChartData {
    const trades = pnlData.data.trades;
    
    // 按时间排序交易记录
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    
    // 计算累计PNL历史
    let cumulativePnl = 0;
    const pnlHistory: PnlDataPoint[] = [];
    
    // 添加起始点 (第一笔交易前的0点)
    if (sortedTrades.length > 0) {
      pnlHistory.push({
        x: sortedTrades[0].timestamp * 1000,
        y: 0
      });
    }
    
    for (const trade of sortedTrades) {
      // 计算这笔交易的PNL影响 (简化计算，实际应该考虑买卖方向和价格差)
      const tradeValue = parseFloat(trade.value);
      const tradeFee = parseFloat(trade.fee);
      
      // 买入为负现金流，卖出为正现金流
      if (trade.side === 'buy') {
        cumulativePnl -= (tradeValue + tradeFee);
      } else {
        cumulativePnl += (tradeValue - tradeFee);
      }
      
      pnlHistory.push({
        x: trade.timestamp * 1000,
        y: cumulativePnl
      });
    }
    
    // 计算总PNL (使用统计数据)
    const statistics = pnlData.data.statistics;
    const totalVolume = parseFloat(statistics.totalVolume);
    const totalFees = parseFloat(statistics.totalFees);
    
    // 估算总PNL (这里使用简化计算，实际需要更精确的计算)
    const finalPnl = cumulativePnl;
    
    return {
      totalPnl: finalPnl,
      pnlHistory: pnlHistory,
      timeRange: {
        start: sortedTrades[0]?.timestamp * 1000 || Date.now(),
        end: sortedTrades[sortedTrades.length - 1]?.timestamp * 1000 || Date.now()
      }
    };
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
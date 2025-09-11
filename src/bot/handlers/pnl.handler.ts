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
      await ctx.reply('❌ Unable to identify user');
      return;
    }

    // 发送加载消息
    const loadingMessage = await ctx.reply(
      '📊 Generating your PNL analysis report...\n' +
      '⏳ Please wait, calculating historical data'
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
            caption: '📈 PNL Trend Chart',
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
      throw new Error('User not logged in, please use /start command to login first');
    }

    const response = await apiService.getWithAuth<PnlResponse>(
      '/api/tgbot/trading/pnl',
      userToken,
      {},
      { timeout: 15000 } // 增加超时时间，因为数据计算较复杂
    );

    // 🔧 详细记录API响应用于诊断
    logger.info('PNL API Response - Full Debug', {
      userId,
      responseCode: response.code,
      responseMessage: response.message,
      dataStructure: {
        hasTrades: response.data?.trades ? true : false,
        tradesCount: response.data?.trades?.length || 0,
        totalTrades: response.data?.totalTrades || 0,
        hasStatistics: response.data?.statistics ? true : false,
        hasSymbolBreakdown: response.data?.symbolBreakdown ? true : false,
        hasDailyBreakdown: response.data?.dailyBreakdown ? true : false
      },
      // 记录前3笔交易的详细信息用于调试
      sampleTrades: response.data?.trades?.slice(0, 3).map(trade => ({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        quantityType: typeof trade.quantity,
        price: trade.price,
        priceType: typeof trade.price,
        fee: trade.fee,
        timestamp: trade.timestamp,
        value: trade.value
      })) || [],
      fullResponse: JSON.stringify(response, null, 2)
    });

    if (response.code !== 200) {
      throw new Error(response.message || 'Failed to get PNL analysis');
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

    // 🔧 检测数据异常情况
    const dataQualityIssues = this.detectDataQualityIssues(data);

    // If no trading records
    if (totalTrades === 0) {
      return `
📊 <b>PNL Analysis Report</b>

📈 <b>Trading Statistics:</b>
• Total Trades: 0
• Volume: $0.00
• Fees: $0.00
• Trading Days: 0

📝 <b>Trading Records:</b>
No trading records

💡 <i>Start trading to get PNL data:</i>
• <code>/long BTC 10x 100</code> - Long BTC
• <code>/short ETH 5x 50</code> - Short ETH
• <code>/markets</code> - View market data

<i>🕐 Analysis time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })}</i>
      `.trim();
    }

    // 🔧 If severe data quality issues detected, show warning
    if (dataQualityIssues.severity === 'high') {
      return `
📊 <b>PNL Analysis Report</b>

⚠️ <b>Data Anomaly Detection</b>

Severe data quality issues detected:
${dataQualityIssues.issues.map(issue => `• ${issue}`).join('\n')}

📈 <b>Basic Statistics:</b>
• Total Trades: ${totalTrades.toLocaleString()}
• Data Error Rate: ${dataQualityIssues.errorRate}

💡 <b>Suggested Actions:</b>
• This is a backend API data issue, not your operation error
• Please contact technical support to report this issue
• You can try using <code>/positions</code> to view current positions
• You can try using <code>/wallet</code> to check account balance

🔧 <b>Technical Information:</b>
API: <code>/api/tgbot/trading/pnl</code>
Status: Data returned but quality abnormal
Suggestion: Check Hyperliquid data mapping logic

<i>🕐 Detection time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })}</i>
      `.trim();
    }

    // Generate complete PNL analysis report
    let analysisMessage = `
📊 <b>PNL Analysis Report</b>

📈 <b>Trading Statistics:</b>
• Total Trades: ${totalTrades.toLocaleString()}
• Total Volume: $${this.formatNumber(statistics.totalVolume)}
• Total Fees: $${this.formatNumber(statistics.totalFees)}
• Buy Trades: ${statistics.buyTrades} (${((statistics.buyTrades / totalTrades) * 100).toFixed(1)}%)
• Sell Trades: ${statistics.sellTrades} (${((statistics.sellTrades / totalTrades) * 100).toFixed(1)}%)
• Average Trade Size: $${this.formatNumber(statistics.averageTradeSize)}
• Trading Days: ${statistics.tradingDays} days

📊 <b>Main Trading Pairs Analysis:</b>
${this.formatSymbolBreakdown(symbolBreakdown)}

📅 <b>Recent Trading Activity:</b>
${this.formatDailyBreakdown(dailyBreakdown)}

📝 <b>Recent Trading Records (Latest ${Math.min(trades.length, 10)}):</b>
${this.formatRecentTrades(trades.slice(0, 10))}

💡 <i>Trading Suggestions:</i>
• <code>/positions</code> - View current positions
• <code>/orders</code> - View open orders
• <code>/markets</code> - Analyze market data

<i>🕐 Analysis time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })}</i>
    `.trim();

    return analysisMessage;
  }

  /**
   * 格式化交易对统计
   */
  private formatSymbolBreakdown(breakdown: SymbolBreakdown[]): string {
    if (breakdown.length === 0) {
      return 'No data available';
    }

    // Take top 5 most active trading pairs
    const topSymbols = breakdown.slice(0, 5);
    
    return topSymbols.map((item, index) => {
      const buyPercentage = item.trades > 0 ? ((item.buyTrades / item.trades) * 100).toFixed(1) : '0.0';
      return `${index + 1}. <b>${item.symbol}</b>: ${item.trades} trades, $${this.formatNumber(item.volume)} (${buyPercentage}% buy)`;
    }).join('\n');
  }

  /**
   * 格式化日期统计
   */
  private formatDailyBreakdown(breakdown: DailyBreakdown[]): string {
    if (breakdown.length === 0) {
      return 'No data available';
    }

    // Take last 7 days data
    const recentDays = breakdown.slice(-7).reverse();
    
    return recentDays.map((item, index) => {
      const date = new Date(item.date).toLocaleDateString('en-US', { 
        month: '2-digit', 
        day: '2-digit' 
      });
      return `${date}: ${item.trades} trades, $${this.formatNumber(item.volume)}`;
    }).join('\n');
  }

  /**
   * 格式化最近交易记录
   */
  private formatRecentTrades(trades: Trade[]): string {
    if (trades.length === 0) {
      return 'No data available';
    }

    // 🔧 详细记录原始交易数据用于调试
    logger.info('PNL: Formatting trades - Debug Info', {
      totalTrades: trades.length,
      sampleTradesDetailed: trades.slice(0, 3).map(trade => ({
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        quantityValue: parseFloat(trade.quantity) || 0,
        quantityType: typeof trade.quantity,
        price: trade.price,
        priceValue: parseFloat(trade.price) || 0,
        priceType: typeof trade.price,
        fee: trade.fee,
        value: trade.value,
        timestamp: trade.timestamp,
        isQuantityZero: trade.quantity === '0' || trade.quantity === '0.00' || parseFloat(trade.quantity) === 0,
        isPriceZero: trade.price === '0' || trade.price === '0.00' || parseFloat(trade.price) === 0
      }))
    });

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

    // 检查是否所有交易都是0值
    const zeroValueTrades = uniqueTrades.filter(trade => 
      (parseFloat(trade.quantity) || 0) === 0 || (parseFloat(trade.price) || 0) === 0
    );

    if (zeroValueTrades.length > uniqueTrades.length * 0.8) {
      logger.error('PNL: Most trades have zero values - likely API data issue', {
        totalTrades: uniqueTrades.length,
        zeroValueTrades: zeroValueTrades.length,
        percentage: ((zeroValueTrades.length / uniqueTrades.length) * 100).toFixed(1)
      });
    }

    // 限制显示最新10笔不重复的交易
    const displayTrades = uniqueTrades.slice(0, 10);

    let tradesText = displayTrades.map((trade, index) => {
      const sideIcon = trade.side === 'buy' ? '🟢' : '🔴';
      const sideText = trade.side === 'buy' ? 'Buy' : 'Sell';
      
      // 🔧 改进数量和价格的显示逻辑
      const quantity = this.formatTradeNumber(trade.quantity, 'quantity');
      const price = this.formatTradeNumber(trade.price, 'price');
      
      // 🔧 改进时间显示，包含秒数避免相同时间
      const tradeTime = new Date(trade.timestamp * 1000).toLocaleString('en-US', { 
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // 🔧 如果数据异常，添加调试信息
      const isQuantityZero = (parseFloat(trade.quantity) || 0) === 0;
      const isPriceZero = (parseFloat(trade.price) || 0) === 0;
      
      let tradeText = `${sideIcon} <b>${trade.symbol}</b> ${sideText} ${quantity} @$${price} (${tradeTime})`;
      
      // 如果发现异常数据，添加原始值信息用于调试
      if (isQuantityZero || isPriceZero) {
        tradeText += ` <i>[Raw: qty=${trade.quantity}, px=${trade.price}]</i>`;
      }
      
      return tradeText;
    }).join('\n');

    // 🔧 如果检测到重复数据，添加说明
    if (duplicateCount > 0) {
      tradesText += `\n\n⚠️ <i>Filtered ${duplicateCount} duplicate records</i>`;
    }

    // 🔧 如果检测到大量零值交易，添加警告
    if (zeroValueTrades.length > uniqueTrades.length * 0.5) {
      tradesText += `\n\n⚠️ <i>Detected ${zeroValueTrades.length}/${uniqueTrades.length} abnormal trade data (price or quantity is 0)</i>`;
      tradesText += `\n<i>This may be a backend API data issue, please contact technical support</i>`;
    }

    return tradesText;
  }

  /**
   * 去除重复的交易记录
   * 改进算法避免过度过滤正常交易
   */
  private deduplicateTrades(trades: Trade[]): Trade[] {
    const seen = new Set<string>();
    const uniqueTrades: Trade[] = [];
    const skippedTrades: any[] = [];

    for (const trade of trades) {
      // 🔧 改进去重策略：优先使用 tradeId，如果没有则使用更严格的组合键
      let uniqueKey: string;
      
      if (trade.tradeId && trade.tradeId !== '' && trade.tradeId !== 'undefined') {
        // 如果有 tradeId，直接使用（最可靠）
        uniqueKey = `id_${trade.tradeId}`;
      } else {
        // 如果没有 tradeId，使用组合键，但增加更多区分因素
        // 包含时间戳精确到秒，以及交易值
        uniqueKey = `combo_${trade.symbol}_${trade.side}_${trade.quantity}_${trade.price}_${trade.timestamp}_${trade.value || ''}`;
      }
      
      if (!seen.has(uniqueKey)) {
        seen.add(uniqueKey);
        uniqueTrades.push(trade);
      } else {
        // 记录被跳过的交易用于调试
        skippedTrades.push({
          uniqueKey,
          symbol: trade.symbol,
          side: trade.side,
          quantity: trade.quantity,
          price: trade.price,
          timestamp: trade.timestamp,
          tradeId: trade.tradeId
        });
      }
    }

    // 🔧 详细记录去重结果
    if (skippedTrades.length > 0) {
      logger.info('PNL: Deduplication results', {
        originalCount: trades.length,
        uniqueCount: uniqueTrades.length,
        skippedCount: skippedTrades.length,
        skippedPercentage: ((skippedTrades.length / trades.length) * 100).toFixed(1),
        // 记录前3个被跳过的交易
        sampleSkipped: skippedTrades.slice(0, 3)
      });

      // 🔧 如果跳过的交易过多，可能是算法过于严格
      if (skippedTrades.length > trades.length * 0.5) {
        logger.warn('PNL: High deduplication rate - may be too aggressive', {
          skippedPercentage: ((skippedTrades.length / trades.length) * 100).toFixed(1),
          suggestion: 'Consider relaxing deduplication criteria'
        });
      }
    }

    return uniqueTrades;
  }

  /**
   * 检测数据质量问题
   */
  private detectDataQualityIssues(data: PnlResponse): {
    severity: 'none' | 'low' | 'medium' | 'high';
    issues: string[];
    errorRate: string;
  } {
    const issues: string[] = [];
    const trades = data.data.trades || [];
    
    if (trades.length === 0) {
      return { severity: 'none', issues: [], errorRate: '0%' };
    }

    // 检查零值交易
    const zeroQuantityTrades = trades.filter(t => 
      !t.quantity || t.quantity === '0' || t.quantity === '0.00' || parseFloat(t.quantity) === 0
    );
    const zeroPriceTrades = trades.filter(t => 
      !t.price || t.price === '0' || t.price === '0.00' || parseFloat(t.price) === 0
    );

    const zeroQuantityRate = (zeroQuantityTrades.length / trades.length) * 100;
    const zeroPriceRate = (zeroPriceTrades.length / trades.length) * 100;

    if (zeroQuantityRate > 50) {
      issues.push(`${zeroQuantityRate.toFixed(1)}% of trades have zero quantity`);
    }
    if (zeroPriceRate > 50) {
      issues.push(`${zeroPriceRate.toFixed(1)}% of trades have zero price`);
    }

    // 检查重复数据
    const uniqueTradeIds = new Set(trades.map(t => t.tradeId).filter(Boolean));
    const duplicateRate = ((trades.length - uniqueTradeIds.size) / trades.length) * 100;
    
    if (duplicateRate > 30) {
      issues.push(`${duplicateRate.toFixed(1)}% of trade records are duplicated`);
    }

    // 检查时间戳异常
    const sameTimestamps = trades.filter((t, i, arr) => 
      arr.some((other, j) => i !== j && other.timestamp === t.timestamp)
    );
    const sameTimestampRate = (sameTimestamps.length / trades.length) * 100;

    if (sameTimestampRate > 40) {
      issues.push(`${sameTimestampRate.toFixed(1)}% of trades have identical timestamps`);
    }

    // 计算总体错误率
    const totalErrorRate = Math.max(zeroQuantityRate, zeroPriceRate, duplicateRate, sameTimestampRate);
    
    // 确定严重程度
    let severity: 'none' | 'low' | 'medium' | 'high' = 'none';
    if (totalErrorRate > 70) {
      severity = 'high';
    } else if (totalErrorRate > 40) {
      severity = 'medium';
    } else if (totalErrorRate > 20) {
      severity = 'low';
    }

    return {
      severity,
      issues,
      errorRate: `${totalErrorRate.toFixed(1)}%`
    };
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
   * 专门用于交易数据的数字格式化工具
   * 处理异常数据并提供调试信息
   */
  private formatTradeNumber(value: string | number, type: 'quantity' | 'price'): string {
    // 🔧 记录原始值用于调试
    const originalValue = value;
    
    if (value === null || value === undefined) {
      logger.warn(`PNL: Trade ${type} is null/undefined`, { originalValue });
      return `N/A`;
    }

    if (value === '' || value === '0' || value === '0.00' || value === '0.0000') {
      logger.warn(`PNL: Trade ${type} is zero string`, { originalValue });
      return `0.00`;
    }

    const num = typeof value === 'string' ? parseFloat(value) : value;
    
    if (isNaN(num) || num === 0) {
      logger.warn(`PNL: Trade ${type} conversion failed or zero`, { 
        originalValue, 
        convertedValue: num,
        type: typeof value 
      });
      return `0.00`;
    }

    // 根据类型调整格式化精度
    if (type === 'quantity') {
      // 数量：根据大小调整精度
      if (num >= 1000000) {
        return (num / 1000000).toFixed(2) + 'M';
      } else if (num >= 1000) {
        return (num / 1000).toFixed(2) + 'K';
      } else if (num >= 1) {
        return num.toFixed(4);
      } else if (num >= 0.0001) {
        return num.toFixed(6);
      } else {
        return num.toExponential(2);
      }
    } else {
      // 价格：保持合理的小数位数
      if (num >= 10000) {
        return num.toFixed(2);
      } else if (num >= 1) {
        return num.toFixed(4);
      } else if (num >= 0.0001) {
        return num.toFixed(6);
      } else {
        return num.toExponential(2);
      }
    }
  }

  /**
   * 错误处理
   */
  private handleError(error: Error): string {
    logger.error('PNL handler error:', { error: error.message });

    if (error.message.includes('未登录')) {
      return `
❌ <b>User Not Logged In</b>

Please use /start command to login first before querying PNL analysis.

<i>If you are already logged in but still see this error, please contact administrator.</i>
      `.trim();
    }

    if (error.message.includes('网络')) {
      return `
❌ <b>Network Connection Failed</b>

Please check your network connection and retry, or try again later.

<i>If the problem persists, please contact administrator.</i>
      `.trim();
    }

    // 🔧 判断是否为外部接口问题（API返回400/500等状态码）
    if (error.message.includes('status code 400')) {
      return `
❌ <b>External Interface Error (400)</b>

PNL analysis interface is temporarily unavailable, this is a backend API issue.

💡 <b>Suggested Actions:</b>
• Retry this command later
• Contact administrator to report interface failure
• Use other commands like /positions to view positions

⚠️ <i>This is not your operation error, but a system interface that needs repair.</i>
      `.trim();
    }

    if (error.message.includes('status code 500') || error.message.includes('status code 502') || error.message.includes('status code 503')) {
      return `
❌ <b>Server Error</b>

Backend service is temporarily unavailable, please retry later.

💡 <b>Suggested Actions:</b>
• Wait 5-10 minutes and retry
• Check if other commands work normally
• Contact administrator to confirm service status

⚠️ <i>This is a temporary service issue that usually recovers automatically.</i>
      `.trim();
    }

    return `
❌ <b>Analysis Failed</b>

An error occurred while generating PNL analysis report, please try again later.

<b>Error Details:</b> ${error.message}

<i>If the problem persists, please contact administrator.</i>
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
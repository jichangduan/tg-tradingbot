import { logger } from '../utils/logger';

/**
 * 推送消息的接口定义
 */
export interface FormattedPushMessage {
  content: string;
  type: string;
  keyboard?: any;
}

/**
 * 快讯数据接口
 */
export interface FlashNewsData {
  title: string;
  content?: string;
  timestamp: string;
  symbol?: string;
}

/**
 * 鲸鱼动向数据接口
 */
export interface WhaleActionData {
  address: string;
  action: string;
  amount: string;
  timestamp: string;
  symbol?: string;
}

/**
 * 资金流向数据接口（TGBot内部格式）
 */
export interface FundFlowData {
  from: string;
  to: string;
  amount: string;
  timestamp: string;
  symbol?: string;
}

/**
 * AIW3资金流向数据接口（外部API格式）
 */
export interface AIW3FundFlowData {
  message: string;
  symbol: string;
  price: string;
  flow1h: string;
  flow4h: string;
  timestamp: string;
}

/**
 * 推送消息格式化服务
 * 负责格式化各种类型的推送消息内容
 */
export class PushMessageFormatterService {
  
  /**
   * 格式化快讯推送消息
   * @param news 快讯数据
   * @returns 格式化后的消息内容
   */
  public formatFlashNewsMessage(news: FlashNewsData): string {
    if (!news || !news.title) {
      logger.warn('Invalid flash news data provided', { news });
      return '🚨 <b>【快讯】</b>\n\n无效的快讯数据';
    }

    try {
      const formattedTimestamp = this.formatTimestamp(news.timestamp);
      
      let message = `🚨 <b>【快讯】</b>\n\n` +
                   `<code>┌──────────────────────────────────────┐</code>\n` +
                   `<code>│ </code>${this.escapeHtml(news.title)}<code> │</code>\n`;

      // 如果有内容，添加内容行
      if (news.content && news.content.trim()) {
        message += `<code>│ </code>${this.escapeHtml(news.content)}<code> │</code>\n`;
      }

      message += `<code>│ ⏰ ${formattedTimestamp} │</code>\n` +
                 `<code>└──────────────────────────────────────┘</code>`;

      // 如果有相关代币符号，在消息末尾提示
      if (news.symbol) {
        message += `\n\n💡 <i>相关代币: ${news.symbol}</i>`;
      }

      logger.debug('Flash news message formatted', {
        hasContent: !!news.content,
        hasSymbol: !!news.symbol,
        titleLength: news.title.length
      });

      return message;
      
    } catch (error) {
      logger.error('Failed to format flash news message', {
        error: (error as Error).message,
        news
      });
      return `🚨 <b>【快讯】</b>\n\n${this.escapeHtml(news.title)}\n⏰ ${news.timestamp}`;
    }
  }

  /**
   * 格式化鲸鱼动向推送消息
   * @param action 鲸鱼动向数据
   * @returns 格式化后的消息内容
   */
  public formatWhaleActionMessage(action: WhaleActionData): string {
    if (!action || !action.address || !action.action) {
      logger.warn('Invalid whale action data provided', { action });
      return '🐋 <b>【鲸鱼动向】</b>\n\n无效的鲸鱼动向数据';
    }

    try {
      const formattedTimestamp = this.formatTimestamp(action.timestamp);
      const truncatedAddress = this.truncateAddress(action.address);
      
      let message = `🐋 <b>【鲸鱼动向】</b>\n\n` +
                   `<code>┌──────────────────────────────────────┐</code>\n` +
                   `<code>│ </code>地址: <code>${truncatedAddress}</code><code> │</code>\n` +
                   `<code>│ </code>操作: ${this.escapeHtml(action.action)}<code> │</code>\n`;

      // 如果有金额信息，添加金额行
      if (action.amount && action.amount.trim()) {
        message += `<code>│ </code>金额: ${this.escapeHtml(action.amount)}<code> │</code>\n`;
      }

      message += `<code>│ ⏰ ${formattedTimestamp} │</code>\n` +
                 `<code>└──────────────────────────────────────┘</code>`;

      // 如果有相关代币符号，在消息末尾提示
      if (action.symbol) {
        message += `\n\n💡 <i>代币: ${action.symbol}</i>`;
      }

      logger.debug('Whale action message formatted', {
        hasAmount: !!action.amount,
        hasSymbol: !!action.symbol,
        addressLength: action.address.length
      });

      return message;
      
    } catch (error) {
      logger.error('Failed to format whale action message', {
        error: (error as Error).message,
        action
      });
      return `🐋 <b>【鲸鱼动向】</b>\n\n地址: ${this.truncateAddress(action.address)}\n操作: ${this.escapeHtml(action.action)}\n⏰ ${action.timestamp}`;
    }
  }

  /**
   * 格式化资金流向推送消息
   * @param flow 资金流向数据（支持内部格式和AIW3格式）
   * @returns 格式化后的消息内容
   */
  public formatFundFlowMessage(flow: FundFlowData | AIW3FundFlowData): string {
    if (!flow) {
      logger.warn('No fund flow data provided', { flow });
      return '💰 <b>【资金流向】</b>\n\n无效的资金流向数据';
    }

    // 检查是否是AIW3格式的数据
    const isAIW3Format = 'message' in flow && 'flow1h' in flow && 'flow4h' in flow;
    
    if (isAIW3Format) {
      return this.formatAIW3FundFlowMessage(flow as AIW3FundFlowData);
    }

    // 传统格式验证
    const traditionalFlow = flow as FundFlowData;
    if (!traditionalFlow.from || !traditionalFlow.to) {
      logger.warn('Invalid traditional fund flow data provided', { flow });
      return '💰 <b>【资金流向】</b>\n\n无效的资金流向数据';
    }

    try {
      const formattedTimestamp = this.formatTimestamp(flow.timestamp);
      
      let message = `💰 <b>【资金流向】</b>\n\n` +
                   `<code>┌──────────────────────────────────────┐</code>\n` +
                   `<code>│ </code>从: ${this.escapeHtml(flow.from)}<code> │</code>\n` +
                   `<code>│ </code>到: ${this.escapeHtml(flow.to)}<code> │</code>\n`;

      // 如果有金额信息，添加金额行
      if (flow.amount && flow.amount.trim()) {
        message += `<code>│ </code>金额: ${this.escapeHtml(flow.amount)}<code> │</code>\n`;
      }

      message += `<code>│ ⏰ ${formattedTimestamp} │</code>\n` +
                 `<code>└──────────────────────────────────────┘</code>`;

      // 如果有相关代币符号，在消息末尾提示
      if (flow.symbol) {
        message += `\n\n💡 <i>代币: ${flow.symbol}</i>`;
      }

      logger.debug('Fund flow message formatted', {
        hasAmount: !!flow.amount,
        hasSymbol: !!flow.symbol,
        fromLength: flow.from.length,
        toLength: flow.to.length
      });

      return message;
      
    } catch (error) {
      logger.error('Failed to format fund flow message', {
        error: (error as Error).message,
        flow
      });
      const traditionalFlow = flow as FundFlowData;
      return `💰 <b>【资金流向】</b>\n\n从: ${this.escapeHtml(traditionalFlow.from)}\n到: ${this.escapeHtml(traditionalFlow.to)}\n⏰ ${traditionalFlow.timestamp}`;
    }
  }

  /**
   * 格式化AIW3格式的资金流向推送消息
   * @param flow AIW3资金流向数据
   * @returns 格式化后的消息内容
   */
  public formatAIW3FundFlowMessage(flow: AIW3FundFlowData): string {
    try {
      const formattedTimestamp = this.formatTimestamp(flow.timestamp);
      
      let message = `💰 <b>【资金流向】</b>\n\n` +
                   `<code>┌──────────────────────────────────────┐</code>\n` +
                   `<code>│ </code>${this.escapeHtml(flow.message)}<code> │</code>\n` +
                   `<code>│ </code>代币: ${this.escapeHtml(flow.symbol)}<code> │</code>\n` +
                   `<code>│ </code>价格: $${this.escapeHtml(flow.price)}<code> │</code>\n` +
                   `<code>│ </code>1h流入: ${this.escapeHtml(flow.flow1h)}<code> │</code>\n` +
                   `<code>│ </code>4h流入: ${this.escapeHtml(flow.flow4h)}<code> │</code>\n` +
                   `<code>│ ⏰ ${formattedTimestamp} │</code>\n` +
                   `<code>└──────────────────────────────────────┘</code>`;

      message += `\n\n💡 <i>代币: ${flow.symbol}</i>`;

      logger.debug('AIW3 fund flow message formatted', {
        hasMessage: !!flow.message,
        hasSymbol: !!flow.symbol,
        messageLength: flow.message.length
      });

      return message;
      
    } catch (error) {
      logger.error('Failed to format AIW3 fund flow message', {
        error: (error as Error).message,
        flow
      });
      return `💰 <b>【资金流向】</b>\n\n${this.escapeHtml(flow.message)}\n代币: ${flow.symbol}\n⏰ ${flow.timestamp}`;
    }
  }

  /**
   * 创建交易按钮键盘
   * @param symbol 代币符号
   * @returns 内联键盘配置
   */
  public createTradingKeyboard(symbol: string): any[] {
    if (!symbol || typeof symbol !== 'string') {
      logger.warn('Invalid symbol provided for trading keyboard', { symbol });
      return [];
    }

    const upperSymbol = symbol.toUpperCase();
    
    logger.debug('Creating trading keyboard', { symbol: upperSymbol });
    
    return [
      [
        {
          text: `Long ${upperSymbol}`,
          callback_data: `push_trade_long_${upperSymbol}`
        },
        {
          text: `Short ${upperSymbol}`,
          callback_data: `push_trade_short_${upperSymbol}`
        }
      ]
    ];
  }

  /**
   * 格式化时间戳为用户友好的格式
   * @param timestamp 时间戳字符串
   * @returns 格式化后的时间字符串
   */
  public formatTimestamp(timestamp: string): string {
    try {
      if (!timestamp) {
        return '未知时间';
      }

      const date = new Date(timestamp);
      
      // 检查日期是否有效
      if (isNaN(date.getTime())) {
        logger.warn('Invalid timestamp provided', { timestamp });
        return timestamp;
      }

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMinutes / 60);
      const diffDays = Math.floor(diffHours / 24);

      // 根据时间差返回不同格式
      if (diffMinutes < 1) {
        return '刚刚';
      } else if (diffMinutes < 60) {
        return `${diffMinutes}分钟前`;
      } else if (diffHours < 24) {
        return `${diffHours}小时前`;
      } else if (diffDays < 7) {
        return `${diffDays}天前`;
      } else {
        // 超过7天显示具体日期时间
        return date.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    } catch (error) {
      logger.warn('Failed to format timestamp', { 
        timestamp, 
        error: (error as Error).message 
      });
      return timestamp;
    }
  }

  /**
   * 转义HTML特殊字符
   * @param text 原始文本
   * @returns 转义后的文本
   */
  private escapeHtml(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 截断长地址，保留前后部分
   * @param address 完整地址
   * @returns 截断后的地址
   */
  private truncateAddress(address: string): string {
    if (!address || typeof address !== 'string') {
      return 'N/A';
    }

    if (address.length <= 20) {
      return address;
    }

    // 保留前8个字符和后6个字符，中间用...连接
    return `${address.substring(0, 8)}...${address.substring(address.length - 6)}`;
  }

  /**
   * 批量格式化推送消息
   * @param newsItems 快讯数据数组
   * @param whaleActions 鲸鱼动向数据数组  
   * @param fundFlows 资金流向数据数组（支持内部格式和AIW3格式）
   * @returns 格式化后的消息数组
   */
  public formatBatchMessages(
    newsItems: FlashNewsData[] = [],
    whaleActions: WhaleActionData[] = [],
    fundFlows: (FundFlowData | AIW3FundFlowData)[] = []
  ): FormattedPushMessage[] {
    const messages: FormattedPushMessage[] = [];

    try {
      // 处理快讯
      for (const news of newsItems) {
        messages.push({
          content: this.formatFlashNewsMessage(news),
          type: 'flash_news',
          keyboard: news.symbol ? this.createTradingKeyboard(news.symbol) : undefined
        });
      }

      // 处理鲸鱼动向
      for (const action of whaleActions) {
        messages.push({
          content: this.formatWhaleActionMessage(action),
          type: 'whale_action',
          keyboard: action.symbol ? this.createTradingKeyboard(action.symbol) : undefined
        });
      }

      // 处理资金流向
      for (const flow of fundFlows) {
        const symbol = 'symbol' in flow ? flow.symbol : undefined;
        messages.push({
          content: this.formatFundFlowMessage(flow),
          type: 'fund_flow',
          keyboard: symbol ? this.createTradingKeyboard(symbol) : undefined
        });
      }

      logger.info('Batch message formatting completed', {
        newsCount: newsItems.length,
        whaleActionsCount: whaleActions.length,
        fundFlowsCount: fundFlows.length,
        totalMessages: messages.length
      });

      return messages;
      
    } catch (error) {
      logger.error('Failed to format batch messages', {
        error: (error as Error).message,
        newsCount: newsItems.length,
        whaleActionsCount: whaleActions.length,
        fundFlowsCount: fundFlows.length
      });
      
      return messages; // 返回已处理的部分
    }
  }
}

// 导出单例
export const pushMessageFormatterService = new PushMessageFormatterService();
export default pushMessageFormatterService;
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
      return '🚨 <b>News</b>\n\nInvalid news data';
    }

    try {
      // 简洁的标题格式
      let message = `🚨 <b>News</b>\n\n`;
      
      // 添加标题内容
      message += `${this.escapeHtml(news.title)}`;

      // 如果有内容，清理HTML并添加内容
      if (news.content && news.content.trim()) {
        const cleanContent = this.cleanHtmlContent(news.content);
        if (cleanContent) {
          message += `\n\n${this.escapeHtml(cleanContent)}`;
        }
      }

      // 如果有相关代币符号，在消息末尾提示
      if (news.symbol) {
        message += `\n\n💡 <i>Related token: ${news.symbol}</i>`;
      }

      return message;
      
    } catch (error) {
      logger.error('Failed to format flash news message', {
        error: (error as Error).message,
        news
      });
      return `🚨 <b>News</b>\n\n${this.escapeHtml(news.title)}`;
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
      return '🐋 <b>Whale Alert</b>\n\nInvalid whale action data';
    }

    try {
      const truncatedAddress = this.truncateAddress(action.address);
      
      // 简洁的标题格式
      let message = `🐋 <b>Whale Alert</b>\n\n`;
      
      // 添加地址和操作信息
      message += `Address: <code>${truncatedAddress}</code>\n`;
      message += `Action: ${this.escapeHtml(action.action)}`;

      // 如果有金额信息，添加金额行
      if (action.amount && action.amount.trim()) {
        message += `\nAmount: ${this.escapeHtml(action.amount)}`;
      }

      // 如果有相关代币符号，在消息末尾提示
      if (action.symbol) {
        message += `\n\n💡 <i>Related token: ${action.symbol}</i>`;
      }

      return message;
      
    } catch (error) {
      logger.error('Failed to format whale action message', {
        error: (error as Error).message,
        action
      });
      return `🐋 <b>Whale Alert</b>\n\nAddress: ${this.truncateAddress(action.address)}\nAction: ${this.escapeHtml(action.action)}`;
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
      return '💰 <b>Fund Flow</b>\n\nInvalid fund flow data';
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
      return '💰 <b>Fund Flow</b>\n\nInvalid fund flow data';
    }

    try {
      // 简洁的标题格式
      let message = `💰 <b>Fund Flow</b>\n\n`;
      
      // 添加流向信息
      message += `From: ${this.escapeHtml(flow.from)}\n`;
      message += `To: ${this.escapeHtml(flow.to)}`;

      // 如果有金额信息，添加金额行
      if (flow.amount && flow.amount.trim()) {
        message += `\nAmount: ${this.escapeHtml(flow.amount)}`;
      }

      // 如果有相关代币符号，在消息末尾提示
      if (flow.symbol) {
        message += `\n\n💡 <i>Related token: ${flow.symbol}</i>`;
      }

      return message;
      
    } catch (error) {
      logger.error('Failed to format fund flow message', {
        error: (error as Error).message,
        flow
      });
      const traditionalFlow = flow as FundFlowData;
      return `💰 <b>Fund Flow</b>\n\nFrom: ${this.escapeHtml(traditionalFlow.from)}\nTo: ${this.escapeHtml(traditionalFlow.to)}`;
    }
  }

  /**
   * 格式化AIW3格式的资金流向推送消息
   * @param flow AIW3资金流向数据
   * @returns 格式化后的消息内容
   */
  public formatAIW3FundFlowMessage(flow: AIW3FundFlowData): string {
    try {
      // 简洁的标题格式
      let message = `💰 <b>Fund Flow</b>\n\n`;
      
      // 添加消息内容
      message += `${this.escapeHtml(flow.message)}\n\n`;
      
      // 添加详细信息
      message += `Token: ${this.escapeHtml(flow.symbol)}\n`;
      message += `Price: $${this.escapeHtml(flow.price)}\n`;
      message += `1h Flow: ${this.escapeHtml(flow.flow1h)}\n`;
      message += `4h Flow: ${this.escapeHtml(flow.flow4h)}`;

      message += `\n\n💡 <i>Related token: ${flow.symbol}</i>`;

      return message;
      
    } catch (error) {
      logger.error('Failed to format AIW3 fund flow message', {
        error: (error as Error).message,
        flow
      });
      return `💰 <b>Fund Flow</b>\n\n${this.escapeHtml(flow.message)}\nToken: ${flow.symbol}`;
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
    
    // 删除创建交易键盘debug日志
    
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
   * 清理HTML标签并格式化内容为纯文本
   * @param htmlContent 包含HTML标签的内容
   * @returns 清理后的纯文本内容
   */
  private cleanHtmlContent(htmlContent: string): string {
    if (!htmlContent || typeof htmlContent !== 'string') {
      return '';
    }

    let cleanText = htmlContent
      // 处理段落标签：<p> -> 换行, </p> -> 换行
      .replace(/<p>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      // 处理换行标签：<br> -> 换行
      .replace(/<br\s*\/?>/gi, '\n')
      // 移除所有其他HTML标签
      .replace(/<[^>]*>/g, '')
      // 清理HTML实体
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // 移除竖线符号（避免与边框冲突）
      .replace(/\|/g, '')
      // 清理多余的空行：连续超过2个换行合并为2个
      .replace(/\n{3,}/g, '\n\n')
      // 清理每行首尾空白
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      // 清理开头和结尾的换行
      .trim();

    return cleanText;
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

      // 保留批量格式化完成信息但简化
      const totalCount = newsItems.length + whaleActions.length + fundFlows.length;
      if (totalCount > 0) {
        logger.info(`📝 [FORMATTER] Generated ${messages.length} messages from ${totalCount} items`);
      }

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
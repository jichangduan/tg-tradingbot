import { logger } from '../utils/logger';

/**
 * Push message interface definition
 */
export interface FormattedPushMessage {
  content: string;
  type: string;
  keyboard?: any;
}

/**
 * Flash news data interface
 */
export interface FlashNewsData {
  title: string;
  content?: string;
  timestamp: string;
  symbol?: string;
}

/**
 * Whale action data interface
 */
export interface WhaleActionData {
  address: string;
  action: string;
  amount: string;
  timestamp: string;
  symbol?: string;
  
  // 新增字段用于详细的鲸鱼交易信息
  leverage?: string;       // 杠杆倍数 (如 "10x")
  position_type?: string;  // 仓位类型 ("long" | "short")
  trade_type?: string;     // 交易类型 ("open" | "close")
  pnl_amount?: string;     // 盈亏金额
  pnl_currency?: string;   // 盈亏币种 (如 "USDT")
  pnl_type?: string;       // 盈亏类型 ("profit" | "loss")
  margin_type?: string;    // 保证金类型 ("cross" | "isolated")
}

/**
 * Fund flow data interface (TGBot internal format)
 */
export interface FundFlowData {
  from: string;
  to: string;
  amount: string;
  timestamp: string;
  symbol?: string;
}

/**
 * AIW3 fund flow data interface (external API format)
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
 * Push message formatter service
 * Responsible for formatting various types of push message content
 */
export class PushMessageFormatterService {
  
  /**
   * Format flash news push message
   * @param news Flash news data
   * @returns Formatted message content
   */
  public formatFlashNewsMessage(news: FlashNewsData): string {
    if (!news || !news.title) {
      logger.warn('Invalid flash news data provided', { news });
      return '🚨 <b>News</b>\n\nInvalid news data';
    }

    try {
      // Simple title format
      let message = `🚨 <b>News</b>\n\n`;
      
      // Add title content
      message += `${this.escapeHtml(news.title)}`;

      // If content exists, clean HTML and add only first paragraph
      if (news.content && news.content.trim()) {
        const cleanContent = this.cleanHtmlContent(news.content);
        const firstParagraph = this.getFirstParagraph(cleanContent);
        if (firstParagraph) {
          message += `\n\n${this.escapeHtml(firstParagraph)}`;
        }
      }

      // If there are related token symbols, show at message end
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
   * Format whale action push message
   * @param action Whale action data
   * @returns Formatted message content
   */
  public formatWhaleActionMessage(action: WhaleActionData): string {
    if (!action || !action.address || !action.action) {
      logger.warn('Invalid whale action data provided', { action });
      return '🐋 Whale Alert: Invalid whale action data';
    }

    try {
      const truncatedAddress = this.truncateWalletAddress(action.address);
      
      // 统一使用英文单行格式，不再区分详细/简单格式
      return this.formatEnglishWhaleMessage(action, truncatedAddress);
      
    } catch (error) {
      logger.error('Failed to format whale action message', {
        error: (error as Error).message,
        action
      });
      return `🐋 Whale ${this.truncateWalletAddress(action.address)} ${action.action}`;
    }
  }

  /**
   * 格式化英文鲸鱼交易消息（统一格式）
   * 模板：🐋 Whale 0x7c33…502a just closed 1.56M FARTCOIN long position (10x cross), loss 2,484.66 USDT.
   */
  private formatEnglishWhaleMessage(action: WhaleActionData, truncatedAddress: string): string {
    const formattedAmount = this.formatTradeAmount(action.amount);
    const symbol = action.symbol || 'TOKEN';
    
    let message = `🐋 Whale ${truncatedAddress} just`;
    
    // 动作描述 - 优先使用trade_type，fallback到action，确保过去时
    if (action.trade_type === 'close') {
      message += ` closed`;
    } else if (action.trade_type === 'open') {
      message += ` opened`;
    } else if (action.action) {
      // 处理action字段，转换为英文动作（过去时）
      const actionText = this.normalizeActionText(action.action);
      message += ` ${actionText}`;
    } else {
      message += ` traded`;
    }
    
    // 金额和币种
    message += ` ${formattedAmount}`;
    if (symbol) {
      message += ` ${symbol}`;
    }
    
    // 仓位信息（如果有）
    if (action.position_type) {
      message += ` ${action.position_type} position`;
    }
    
    // 杠杆和保证金类型（如果有）
    if (action.leverage || action.margin_type) {
      const leverageInfo = [];
      if (action.leverage) leverageInfo.push(action.leverage);
      if (action.margin_type) leverageInfo.push(action.margin_type);
      message += ` (${leverageInfo.join(' ')})`;
    }
    
    // 盈亏信息（重要：始终尝试显示盈亏）
    const pnlInfo = this.formatPnlInfo(action);
    if (pnlInfo) {
      message += `, ${pnlInfo}`;
    }
    
    // 确保消息以句号结尾
    if (!message.endsWith('.')) {
      message += '.';
    }
    
    return message;
  }

  /**
   * 标准化动作文本为英文（确保过去时）
   */
  private normalizeActionText(action: string): string {
    if (!action) return 'traded';
    
    const actionLower = action.toLowerCase().trim();
    
    // 常见动作映射 - 确保都是过去时
    const actionMap: { [key: string]: string } = {
      // 英文动作映射
      'open': 'opened',
      'opened': 'opened',
      'opening': 'opened',
      'close': 'closed', 
      'closed': 'closed',
      'closing': 'closed',
      'buy': 'bought',
      'bought': 'bought',
      'buying': 'bought',
      'sell': 'sold',
      'sold': 'sold',
      'selling': 'sold',
      'transfer': 'transferred',
      'transferred': 'transferred',
      'transferring': 'transferred',
      'trade': 'traded',
      'traded': 'traded',
      'trading': 'traded',
      'liquidate': 'liquidated',
      'liquidated': 'liquidated',
      'liquidating': 'liquidated',
      
      // 中文动作映射
      '买入': 'bought',
      '购买': 'bought', 
      '卖出': 'sold',
      '出售': 'sold',
      '开仓': 'opened',
      '开多': 'opened',
      '开空': 'opened',
      '平仓': 'closed',
      '平多': 'closed',
      '平空': 'closed',
      '转账': 'transferred',
      '转入': 'transferred',
      '转出': 'transferred',
      '交易': 'traded',
      '清算': 'liquidated'
    };
    
    return actionMap[actionLower] || 'traded';
  }

  /**
   * 格式化盈亏信息
   * 确保格式：loss 2,484.66 USDT 或 profit 1,234.56 USDT
   */
  private formatPnlInfo(action: WhaleActionData): string {
    // 方案1：使用pnl字段
    if (action.pnl_type && action.pnl_amount) {
      const pnlCurrency = action.pnl_currency || 'USDT';
      const formattedAmount = this.formatPnlAmount(action.pnl_amount);
      return `${action.pnl_type} ${formattedAmount} ${pnlCurrency}`;
    }
    
    // 方案2：从action或其他字段推断盈亏（如果数据源提供）
    // 这里可以根据实际数据源格式进行扩展
    
    return ''; // 无盈亏信息时返回空字符串
  }

  /**
   * 格式化盈亏金额，确保正确的数字格式
   * @param amount 原始盈亏金额
   * @returns 格式化后的金额 (如: 2,484.66)
   */
  private formatPnlAmount(amount: string): string {
    if (!amount) return '';
    
    // 移除非数字字符，保留小数点和负号
    const cleanAmount = amount.replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleanAmount);
    
    if (isNaN(num)) return amount;
    
    // 格式化为带千分位分隔符的数字，保留2位小数
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Math.abs(num)); // 使用绝对值，因为loss/profit已经表明了正负
  }

  /**
   * 截断钱包地址显示
   * @param address 完整地址
   * @returns 截断后的地址 (如: 0x7c33…502a)
   */
  private truncateWalletAddress(address: string): string {
    if (!address || address.length < 10) {
      return address;
    }
    
    // 标准格式: 前6位...后4位
    return `${address.substring(0, 6)}…${address.substring(address.length - 4)}`;
  }

  /**
   * 格式化交易金额显示
   * @param amount 原始金额字符串
   * @returns 格式化后的金额 (如: 1.56M, 156K)
   */
  private formatTradeAmount(amount: string): string {
    if (!amount) return '';
    
    // 提取数字部分
    const numberMatch = amount.match(/[\d,]+\.?\d*/);
    if (!numberMatch) return amount;
    
    const numStr = numberMatch[0].replace(/,/g, '');
    const num = parseFloat(numStr);
    
    if (isNaN(num)) return amount;
    
    // 格式化为简洁显示
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2).replace('.00', '')}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1).replace('.0', '')}K`;
    } else {
      return num.toString();
    }
  }

  /**
   * Format fund flow push message
   * @param flow Fund flow data (supports internal format and AIW3 format)
   * @returns Formatted message content
   */
  public formatFundFlowMessage(flow: FundFlowData | AIW3FundFlowData): string {
    if (!flow) {
      logger.warn('No fund flow data provided', { flow });
      return '💰 <b>Fund Flow</b>\n\nInvalid fund flow data';
    }

    // Check if it's AIW3 format data
    const isAIW3Format = 'message' in flow && 'flow1h' in flow && 'flow4h' in flow;
    
    if (isAIW3Format) {
      return this.formatAIW3FundFlowMessage(flow as AIW3FundFlowData);
    }

    // Traditional format validation
    const traditionalFlow = flow as FundFlowData;
    if (!traditionalFlow.from || !traditionalFlow.to) {
      logger.warn('Invalid traditional fund flow data provided', { flow });
      return '💰 <b>Fund Flow</b>\n\nInvalid fund flow data';
    }

    try {
      // Simple title format
      let message = `💰 <b>Fund Flow</b>\n\n`;
      
      // Add flow information
      message += `From: ${this.escapeHtml(flow.from)}\n`;
      message += `To: ${this.escapeHtml(flow.to)}`;

      // If amount information exists, add amount line
      if (flow.amount && flow.amount.trim()) {
        message += `\nAmount: ${this.escapeHtml(flow.amount)}`;
      }

      // If there are related token symbols, show at message end
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
   * Format AIW3 format fund flow push message
   * @param flow AIW3 fund flow data
   * @returns Formatted message content
   */
  public formatAIW3FundFlowMessage(flow: AIW3FundFlowData): string {
    try {
      // Simple title format
      let message = `💰 <b>Fund Flow</b>\n\n`;
      
      // Add message content
      message += `${this.escapeHtml(flow.message)}\n\n`;
      
      // Add detailed information
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
   * Extract token symbol from text content
   * @param text Text content to analyze
   * @returns Extracted token symbol or null
   */
  public extractSymbolFromText(text: string): string | null {
    if (!text || typeof text !== 'string') {
      return null;
    }

    // Common cryptocurrency symbols (prioritized by popularity)
    const commonTokens = [
      'BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOT', 'MATIC',
      'DOGE', 'SHIB', 'TRX', 'DAI', 'ATOM', 'LTC', 'LINK', 'UNI', 'XLM', 'FTM',
      'ALGO', 'VET', 'ICP', 'FIL', 'SAND', 'MANA', 'AAVE', 'CRV', 'GRT', 'COMP'
    ];

    // Convert to uppercase for matching
    const upperText = text.toUpperCase();

    // Strategy 1: Look for explicit mentions like "ETH", "BTC", etc.
    for (const token of commonTokens) {
      // Match token as standalone word (not part of another word)
      const tokenRegex = new RegExp(`\\b${token}\\b`, 'i');
      if (tokenRegex.test(text)) {
        return token;
      }
    }

    // Strategy 2: Look for $TOKEN format (e.g., $ETH, $BTC)
    const dollarTokenMatch = upperText.match(/\$([A-Z]{2,10})\b/);
    if (dollarTokenMatch && commonTokens.includes(dollarTokenMatch[1])) {
      return dollarTokenMatch[1];
    }

    // Strategy 3: Look for "TOKEN position", "TOKEN long", "TOKEN whale", etc.
    for (const token of commonTokens) {
      const contextRegex = new RegExp(`\\b${token}\\s+(position|long|short|whale|trading|price|profit)`, 'i');
      if (contextRegex.test(text)) {
        return token;
      }
    }

    // Strategy 4: Look for specific patterns in content
    const patterns = [
      /(\w+)\s+long\s+position/i,           // "ETH long position"
      /(\w+)\s+whale/i,                     // "BTC whale"
      /(\w+)\s+trading/i,                   // "SOL trading"
      /on\s+(\w+)/i,                        // "on ETH"
      /(\w+)\s+has\s+(achieved|realized)/i  // "ETH has achieved"
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] && commonTokens.includes(match[1].toUpperCase())) {
        return match[1].toUpperCase();
      }
    }

    return null;
  }

  /**
   * Create trading button keyboard
   * @param symbol Token symbol
   * @returns Inline keyboard configuration
   */
  public createTradingKeyboard(symbol: string): any[] {
    if (!symbol || typeof symbol !== 'string') {
      logger.warn('Invalid symbol provided for trading keyboard', { symbol });
      return [];
    }

    const upperSymbol = symbol.toUpperCase();
    
    // Create trading keyboard for the symbol
    
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
   * Format timestamp to user-friendly format
   * @param timestamp Timestamp string
   * @returns Formatted time string
   */
  public formatTimestamp(timestamp: string): string {
    try {
      if (!timestamp) {
        return 'Unknown time';
      }

      const date = new Date(timestamp);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        logger.warn('Invalid timestamp provided', { timestamp });
        return timestamp;
      }

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMinutes / 60);
      const diffDays = Math.floor(diffHours / 24);

      // Return different formats based on time difference
      if (diffMinutes < 1) {
        return 'Just now';
      } else if (diffMinutes < 60) {
        return `${diffMinutes} min ago`;
      } else if (diffHours < 24) {
        return `${diffHours}h ago`;
      } else if (diffDays < 7) {
        return `${diffDays}d ago`;
      } else {
        // Show specific date and time for over 7 days
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
   * Clean HTML tags and format content to plain text
   * @param htmlContent Content containing HTML tags
   * @returns Cleaned plain text content
   */
  private cleanHtmlContent(htmlContent: string): string {
    if (!htmlContent || typeof htmlContent !== 'string') {
      return '';
    }

    let cleanText = htmlContent
      // Process paragraph tags: <p> -> newline, </p> -> newline
      .replace(/<p>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      // Process line break tags: <br> -> newline
      .replace(/<br\s*\/?>/gi, '\n')
      // Remove all other HTML tags
      .replace(/<[^>]*>/g, '')
      // Clean HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Remove vertical line symbols (avoid border conflicts)
      .replace(/\|/g, '')
      // Clean excess blank lines: merge consecutive 3+ newlines to 2
      .replace(/\n{3,}/g, '\n\n')
      // Clean leading and trailing whitespace of each line
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      // Clean leading and trailing newlines
      .trim();

    return cleanText;
  }

  /**
   * Extract first paragraph from cleaned content
   * @param content Cleaned text content
   * @returns First paragraph, truncated if too long
   */
  private getFirstParagraph(content: string): string {
    if (!content || typeof content !== 'string') {
      return '';
    }

    // Split by newlines and find first non-empty paragraph
    const paragraphs = content.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    
    if (paragraphs.length === 0) {
      return '';
    }

    let firstParagraph = paragraphs[0];

    // Truncate if too long (keep within 200 characters for better UX)
    const maxLength = 200;
    if (firstParagraph.length > maxLength) {
      firstParagraph = firstParagraph.substring(0, maxLength).trim() + '...';
    }

    return firstParagraph;
  }

  /**
   * Escape HTML special characters
   * @param text Original text
   * @returns Escaped text
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
   * Truncate long address, keep front and back parts
   * @param address Full address
   * @returns Truncated address
   */
  private truncateAddress(address: string): string {
    if (!address || typeof address !== 'string') {
      return 'N/A';
    }

    if (address.length <= 20) {
      return address;
    }

    // Keep first 8 characters and last 6 characters, connect with ...
    return `${address.substring(0, 8)}...${address.substring(address.length - 6)}`;
  }

  /**
   * Batch format push messages - merge same type messages
   * @param newsItems Flash news data array
   * @param whaleActions Whale action data array
   * @param fundFlows Fund flow data array (supports internal and AIW3 formats)
   * @returns Formatted message array
   */
  public formatBatchMessages(
    newsItems: FlashNewsData[] = [],
    whaleActions: WhaleActionData[] = [],
    fundFlows: (FundFlowData | AIW3FundFlowData)[] = []
  ): FormattedPushMessage[] {
    const messages: FormattedPushMessage[] = [];

    try {
      // Process flash news - merge to one message
      if (newsItems.length > 0) {
        const batchMessage = this.formatBatchFlashNews(newsItems);
        if (batchMessage) {
          messages.push(batchMessage);
        }
      }

      // Process whale actions - send individual messages (no batch merging)
      if (whaleActions.length > 0) {
        whaleActions.forEach(action => {
          const singleMessage = this.formatWhaleActionMessage(action);
          if (singleMessage) {
            // Create individual message with trading keyboard
            const actionMessage: FormattedPushMessage = {
              content: singleMessage,
              type: 'whale_action',
              keyboard: this.createTradingKeyboard(action.symbol || 'BTC')
            };
            messages.push(actionMessage);
          }
        });
      }

      // Process fund flows - merge to one message
      if (fundFlows.length > 0) {
        const batchMessage = this.formatBatchFundFlows(fundFlows);
        if (batchMessage) {
          messages.push(batchMessage);
        }
      }

      // Output statistics information
      const totalCount = newsItems.length + whaleActions.length + fundFlows.length;
      if (totalCount > 0) {
        logger.info(`📝 [FORMATTER] Generated ${messages.length} grouped messages from ${totalCount} items`, {
          newsItems: newsItems.length,
          whaleActions: whaleActions.length, 
          fundFlows: fundFlows.length,
          groupedMessages: messages.length
        });
      }

      return messages;
      
    } catch (error) {
      logger.error('Failed to format batch messages', {
        error: (error as Error).message,
        newsCount: newsItems.length,
        whaleActionsCount: whaleActions.length,
        fundFlowsCount: fundFlows.length
      });
      
      return messages; // Return processed parts
    }
  }

  /**
   * Batch format flash news messages - merge multiple flash news into one message
   * @param newsItems Flash news data array
   * @returns Formatted message object
   */
  public formatBatchFlashNews(newsItems: FlashNewsData[]): FormattedPushMessage | null {
    if (!newsItems || newsItems.length === 0) {
      return null;
    }

    try {
      let message = '';
      let symbols: string[] = [];
      
      if (newsItems.length === 1) {
        // Single flash news keeps original format
        const news = newsItems[0];
        message = this.formatFlashNewsMessage(news);
        
        // Try to get symbol from API data first
        if (news.symbol) {
          symbols.push(news.symbol);
        } else {
          // Extract symbol from content if not provided by API
          const extractedSymbol = this.extractSymbolFromText(news.title + ' ' + (news.content || ''));
          if (extractedSymbol) {
            symbols.push(extractedSymbol);
          }
        }
      } else {
        // Multiple flash news merged format
        message = `🚨 <b>Flash News</b> (${newsItems.length} items)\n\n`;
        
        newsItems.forEach((news, index) => {
          if (news.title) {
            message += `${index + 1}. ${this.escapeHtml(news.title)}\n`;
            
            // Try to get symbol from API data first
            if (news.symbol && !symbols.includes(news.symbol)) {
              symbols.push(news.symbol);
            } else {
              // Extract symbol from content if not provided by API
              const extractedSymbol = this.extractSymbolFromText(news.title + ' ' + (news.content || ''));
              if (extractedSymbol && !symbols.includes(extractedSymbol)) {
                symbols.push(extractedSymbol);
              }
            }
          }
        });
      }

      // Create trading buttons - always provide buttons
      let keyboard: any = undefined;
      if (symbols.length > 0) {
        // Use extracted symbol to create trading buttons
        keyboard = this.createTradingKeyboard(symbols[0]);
        
        // If multiple symbols, show at message end
        if (symbols.length > 1) {
          message += `\n\n💡 <i>Related tokens: ${symbols.join(', ')}</i>`;
        } else {
          message += `\n\n💡 <i>Related token: ${symbols[0]}</i>`;
        }
      } else {
        // Fallback: provide BTC trading buttons if no symbol detected
        keyboard = this.createTradingKeyboard('BTC');
        message += `\n\n💡 <i>Market news - Trade popular tokens</i>`;
      }

      return {
        content: message,
        type: 'flash_news_batch',
        keyboard
      };
      
    } catch (error) {
      logger.error('Failed to format batch flash news', {
        error: (error as Error).message,
        itemCount: newsItems.length
      });
      return null;
    }
  }


  /**
   * Batch format fund flow messages - merge multiple fund flows into one message
   * @param fundFlows Fund flow data array
   * @returns Formatted message object
   */
  public formatBatchFundFlows(fundFlows: (FundFlowData | AIW3FundFlowData)[]): FormattedPushMessage | null {
    if (!fundFlows || fundFlows.length === 0) {
      return null;
    }

    try {
      let message = '';
      let symbols: string[] = [];
      
      if (fundFlows.length === 1) {
        // Single fund flow keeps original format
        const flow = fundFlows[0];
        message = this.formatFundFlowMessage(flow);
        const symbol = 'symbol' in flow ? flow.symbol : undefined;
        if (symbol) symbols.push(symbol);
      } else {
        // Multiple fund flows merged format
        message = `💰 <b>Fund Flow</b> (${fundFlows.length} flows)\n\n`;
        
        fundFlows.forEach((flow, index) => {
          const isAIW3Format = 'message' in flow && 'flow1h' in flow;
          
          if (isAIW3Format) {
            const aiw3Flow = flow as AIW3FundFlowData;
            message += `${index + 1}. ${this.escapeHtml(aiw3Flow.message)}\n`;
            message += `   Token: ${aiw3Flow.symbol} | Price: $${aiw3Flow.price}\n`;
            
            if (!symbols.includes(aiw3Flow.symbol)) {
              symbols.push(aiw3Flow.symbol);
            }
          } else {
            const traditionalFlow = flow as FundFlowData;
            if (traditionalFlow.from && traditionalFlow.to) {
              message += `${index + 1}. ${this.escapeHtml(traditionalFlow.from)} → ${this.escapeHtml(traditionalFlow.to)}`;
              if (traditionalFlow.amount) {
                message += ` | ${this.escapeHtml(traditionalFlow.amount)}`;
              }
              message += '\n';
              
              if (traditionalFlow.symbol && !symbols.includes(traditionalFlow.symbol)) {
                symbols.push(traditionalFlow.symbol);
              }
            }
          }
        });
      }

      // Create trading buttons - always provide buttons
      let keyboard: any = undefined;
      if (symbols.length > 0) {
        // Use detected symbol to create trading buttons
        keyboard = this.createTradingKeyboard(symbols[0]);
        
        // If multiple symbols, show at message end
        if (symbols.length > 1) {
          message += `\n💡 <i>Related tokens: ${symbols.join(', ')}</i>`;
        } else {
          message += `\n💡 <i>Related token: ${symbols[0]}</i>`;
        }
      } else {
        // Fallback: provide ETH trading buttons for fund flows
        keyboard = this.createTradingKeyboard('ETH');
        message += `\n💡 <i>Fund activity - Trade popular tokens</i>`;
      }

      return {
        content: message,
        type: 'fund_flow_batch',
        keyboard
      };
      
    } catch (error) {
      logger.error('Failed to format batch fund flows', {
        error: (error as Error).message,
        itemCount: fundFlows.length
      });
      return null;
    }
  }
}

// Export singleton
export const pushMessageFormatterService = new PushMessageFormatterService();
export default pushMessageFormatterService;
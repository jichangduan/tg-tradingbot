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
  // API返回的核心字段
  address: string;         // 钱包地址
  baseCoin: string;        // 交易对 (如 "ETH", "BTC")
  side: string;            // 方向 ("Long" | "Short")
  leverage: number;        // 杠杆倍数
  entryPx: number;         // 开仓价格
  positionValue: number;   // 仓位价值 (USD)
  size: number;            // 持仓数量
  state: number;           // 状态 (1=开仓, 2=平仓)
  type: string;            // 保证金类型 ("cross" | "isolated")
  price: number;           // 当前价格
  unrealizedPnl?: number;  // 未实现盈亏
  ts: number;              // 时间戳
  
  // 兼容旧字段 (向后兼容)
  action?: string;         // 动作描述 (兼容旧版)
  amount?: string;         // 金额 (兼容旧版)
  timestamp?: string;      // 时间戳字符串 (兼容旧版)
  symbol?: string;         // 代币符号 (兼容旧版，优先使用baseCoin)
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
    // 添加数据有效性验证
    if (!this.isValidWhaleAction(action)) {
      logger.warn('Invalid or insufficient whale action data, skipping', { action });
      return ''; // 返回空字符串，让上层过滤掉
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
      return ''; // 出错时返回空字符串，让上层过滤掉
    }
  }

  /**
   * 验证鲸鱼动作数据是否有效
   */
  private isValidWhaleAction(action: WhaleActionData): boolean {
    if (!action) {
      return false;
    }

    // 🚧 TEMPORARY: 大幅放宽验证条件，确保立即推送功能正常工作
    logger.info(`🚧 [TEMP_VALIDATION] Relaxed whale action validation`, {
      hasAddress: !!action.address,
      hasBaseCoin: !!action.baseCoin,
      hasSymbol: !!action.symbol, 
      hasCoin: !!(action as any).coin,
      hasPositionValue: !!action.positionValue,
      hasAmount: !!(action as any).amount,
      hasSize: !!action.size,
      hasLeverage: !!action.leverage,
      fullAction: JSON.stringify(action).substring(0, 500)
    });

    // 仅检查最基本的字段
    if (!action.address) {
      logger.warn('🚧 [TEMP_VALIDATION] Missing address field');
      return false;
    }

    // 检查代币符号 (支持多种字段名)
    const symbol = action.baseCoin || action.symbol || (action as any).coin;
    if (!symbol) {
      logger.warn('🚧 [TEMP_VALIDATION] Missing symbol/coin field');
      return false;
    }

    // 🚧 暂时跳过其他验证，让数据能通过
    logger.info(`🚧 [TEMP_VALIDATION] Whale action passed validation`, {
      address: action.address?.substring(0, 10),
      symbol: symbol
    });

    return true;
  }

  /**
   * 格式化英文鲸鱼交易消息（紧凑单行格式）
   * 模板：🐋 Whale 0x7c33…502a just closed 1.56M FARTCOIN long position (10x cross), loss 2,484.66 USDT.
   */
  private formatEnglishWhaleMessage(action: WhaleActionData, truncatedAddress: string): string {
    // 🚧 TEMPORARY: 适应实际API返回的数据结构
    const apiAction = action as any;
    
    logger.info(`🚧 [TEMP_FORMAT] Formatting whale message with actual API data`, {
      originalAction: JSON.stringify(action).substring(0, 300),
      apiFields: {
        coin: apiAction.coin,
        action: apiAction.action, 
        amount: apiAction.amount,
        pnl: apiAction.pnl,
        message: apiAction.message?.substring(0, 100)
      }
    });
    
    // 如果API直接返回了格式化的消息，优先使用
    if (apiAction.message && typeof apiAction.message === 'string' && apiAction.message.includes('Whale')) {
      logger.info(`🚧 [TEMP_FORMAT] Using pre-formatted message from API`);
      return apiAction.message;
    }
    
    // 否则尝试构建消息
    const symbol = action.baseCoin || action.symbol || apiAction.coin || 'TOKEN';
    const side = action.side || this.extractSideFromAction(action) || 'long'; // 默认为long
    const operation = apiAction.action ? this.normalizeActionText(apiAction.action) : 'traded';
    
    // 使用API返回的amount字段
    const amount = apiAction.amount || 'unknown';
    
    // 简化的杠杆信息
    const leverage = action.leverage || 5; // 默认5x
    const marginType = 'cross'; // 默认全仓
    const leverageInfo = `${leverage}x ${marginType}`;
    
    // 构建消息
    let message = `🐋 Whale ${truncatedAddress} just ${operation} ${amount} ${symbol} ${side.toLowerCase()} position (${leverageInfo})`;
    
    // 添加盈亏信息
    if (apiAction.pnl) {
      const pnlValue = parseFloat(apiAction.pnl);
      if (!isNaN(pnlValue)) {
        const pnlText = pnlValue >= 0 ? `profit ${Math.abs(pnlValue)} USDT` : `loss ${Math.abs(pnlValue)} USDT`;
        message += `, ${pnlText}`;
      }
    }
    
    message += '.';
    
    logger.info(`🚧 [TEMP_FORMAT] Generated message: ${message.substring(0, 150)}`);
    
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

  /**
   * 从动作中提取方向信息 (兼容旧数据)
   */
  private extractSideFromAction(action: WhaleActionData): string {
    if (action.side) {
      return action.side;
    }
    
    // 从旧的action字段中提取
    if (action.action) {
      const lowerAction = action.action.toLowerCase();
      if (lowerAction.includes('long')) {
        return 'Long';
      } else if (lowerAction.includes('short')) {
        return 'Short';
      }
    }
    
    // 从size判断（负数通常是short）
    if (action.size && action.size < 0) {
      return 'Short';
    }
    
    return 'Long'; // 默认
  }

  /**
   * 获取操作类型
   */
  private getOperationType(action: WhaleActionData): string {
    if (action.state === 1) {
      return 'opened';
    } else if (action.state === 2) {
      return 'closed';
    }
    
    // 兼容旧数据
    if (action.action) {
      const lowerAction = action.action.toLowerCase();
      if (lowerAction.includes('open') || lowerAction.includes('增仓') || lowerAction.includes('建仓')) {
        return 'opened';
      } else if (lowerAction.includes('close') || lowerAction.includes('平仓')) {
        return 'closed';
      }
    }
    
    return 'traded'; // 默认
  }

  /**
   * 格式化仓位价值
   */
  private formatPositionValue(value: number): string {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  }

  /**
   * 格式化价格
   */
  private formatPrice(price: number): string {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else if (price >= 1) {
      return `$${price.toFixed(4)}`;
    } else {
      return `$${price.toFixed(6)}`;
    }
  }

  /**
   * 格式化数量
   */
  private formatSize(size: number): string {
    if (size >= 1000000) {
      return `${(size / 1000000).toFixed(2)}M`;
    } else if (size >= 1000) {
      return `${(size / 1000).toFixed(1)}K`;
    } else {
      return size.toFixed(4);
    }
  }

  /**
   * 格式化未实现盈亏
   */
  private formatUnrealizedPnl(pnl: number): string {
    const absAmount = Math.abs(pnl);
    const formattedAmount = absAmount >= 1000 
      ? `${(absAmount / 1000).toFixed(1)}K` 
      : absAmount.toFixed(2);
    
    if (pnl > 0) {
      return `📈 Unrealized PnL: +$${formattedAmount}`;
    } else if (pnl < 0) {
      return `📉 Unrealized PnL: -$${formattedAmount}`;
    } else {
      return `📊 Unrealized PnL: $0.00`;
    }
  }

  /**
   * 格式化紧凑的盈亏信息 (用于单行格式)
   * 格式: "loss 2,484.66 USDT" 或 "profit 1,234.56 USDT"
   */
  private formatCompactPnl(action: WhaleActionData): string {
    // 对于平仓操作，可以显示实际盈亏
    if (action.state === 2 && action.unrealizedPnl !== undefined) {
      const absAmount = Math.abs(action.unrealizedPnl);
      const formattedAmount = this.formatPnlAmount(absAmount);
      
      if (action.unrealizedPnl > 0) {
        return `profit ${formattedAmount} USDT`;
      } else if (action.unrealizedPnl < 0) {
        return `loss ${formattedAmount} USDT`;
      }
    }
    
    // 对于开仓操作，显示未实现盈亏（如果有）
    if (action.state === 1 && action.unrealizedPnl !== undefined && action.unrealizedPnl !== 0) {
      const absAmount = Math.abs(action.unrealizedPnl);
      const formattedAmount = this.formatPnlAmount(absAmount);
      
      if (action.unrealizedPnl > 0) {
        return `unrealized profit ${formattedAmount} USDT`;
      } else if (action.unrealizedPnl < 0) {
        return `unrealized loss ${formattedAmount} USDT`;
      }
    }
    
    return ''; // 没有盈亏信息
  }

  /**
   * 格式化盈亏金额 (带千分位逗号)
   */
  private formatPnlAmount(amount: number): string {
    if (amount >= 1000) {
      return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      return amount.toFixed(2);
    }
  }
}

// Export singleton
export const pushMessageFormatterService = new PushMessageFormatterService();
export default pushMessageFormatterService;
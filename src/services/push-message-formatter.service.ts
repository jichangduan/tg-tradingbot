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

      // If content exists, clean HTML and add content
      if (news.content && news.content.trim()) {
        const cleanContent = this.cleanHtmlContent(news.content);
        if (cleanContent) {
          message += `\n\n${this.escapeHtml(cleanContent)}`;
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
      return '🐋 <b>Whale Alert</b>\n\nInvalid whale action data';
    }

    try {
      const truncatedAddress = this.truncateAddress(action.address);
      
      // Simple title format
      let message = `🐋 <b>Whale Alert</b>\n\n`;
      
      // Add address and action information
      message += `Address: <code>${truncatedAddress}</code>\n`;
      message += `Action: ${this.escapeHtml(action.action)}`;

      // If amount information exists, add amount line
      if (action.amount && action.amount.trim()) {
        message += `\nAmount: ${this.escapeHtml(action.amount)}`;
      }

      // If there are related token symbols, show at message end
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

      // Process whale actions - merge to one message
      if (whaleActions.length > 0) {
        const batchMessage = this.formatBatchWhaleActions(whaleActions);
        if (batchMessage) {
          messages.push(batchMessage);
        }
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
        if (news.symbol) symbols.push(news.symbol);
      } else {
        // Multiple flash news merged format
        message = `🚨 <b>Flash News</b> (${newsItems.length} items)\n\n`;
        
        newsItems.forEach((news, index) => {
          if (news.title) {
            message += `${index + 1}. ${this.escapeHtml(news.title)}\n`;
            if (news.symbol && !symbols.includes(news.symbol)) {
              symbols.push(news.symbol);
            }
          }
        });
      }

      // Create trading buttons - if there are related token symbols
      let keyboard: any = undefined;
      if (symbols.length > 0) {
        // Use first symbol to create trading buttons
        keyboard = this.createTradingKeyboard(symbols[0]);
        
        // If multiple symbols, show at message end
        if (symbols.length > 1) {
          message += `\n\n💡 <i>Related tokens: ${symbols.join(', ')}</i>`;
        } else {
          message += `\n\n💡 <i>Related token: ${symbols[0]}</i>`;
        }
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
   * Batch format whale action messages - merge multiple whale actions into one message
   * @param whaleActions Whale action data array
   * @returns Formatted message object
   */
  public formatBatchWhaleActions(whaleActions: WhaleActionData[]): FormattedPushMessage | null {
    if (!whaleActions || whaleActions.length === 0) {
      return null;
    }

    try {
      let message = '';
      let symbols: string[] = [];
      
      if (whaleActions.length === 1) {
        // Single whale action keeps original format
        const action = whaleActions[0];
        message = this.formatWhaleActionMessage(action);
        if (action.symbol) symbols.push(action.symbol);
      } else {
        // Multiple whale actions merged format
        message = `🐋 <b>Whale Alert</b> (${whaleActions.length} actions)\n\n`;
        
        whaleActions.forEach((action, index) => {
          if (action.address && action.action) {
            const truncatedAddress = this.truncateAddress(action.address);
            message += `${index + 1}. <code>${truncatedAddress}</code> | ${this.escapeHtml(action.action)}`;
            if (action.amount) {
              message += ` | ${this.escapeHtml(action.amount)}`;
            }
            message += '\n';
            
            if (action.symbol && !symbols.includes(action.symbol)) {
              symbols.push(action.symbol);
            }
          }
        });
      }

      // Create trading buttons - if there are related token symbols
      let keyboard: any = undefined;
      if (symbols.length > 0) {
        // Use first symbol to create trading buttons
        keyboard = this.createTradingKeyboard(symbols[0]);
        
        // If multiple symbols, show at message end
        if (symbols.length > 1) {
          message += `\n💡 <i>Related tokens: ${symbols.join(', ')}</i>`;
        } else {
          message += `\n💡 <i>Related token: ${symbols[0]}</i>`;
        }
      }

      return {
        content: message,
        type: 'whale_action_batch',
        keyboard
      };
      
    } catch (error) {
      logger.error('Failed to format batch whale actions', {
        error: (error as Error).message,
        itemCount: whaleActions.length
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

      // Create trading buttons - if there are related token symbols
      let keyboard: any = undefined;
      if (symbols.length > 0) {
        // Use first symbol to create trading buttons
        keyboard = this.createTradingKeyboard(symbols[0]);
        
        // If multiple symbols, show at message end
        if (symbols.length > 1) {
          message += `\n💡 <i>Related tokens: ${symbols.join(', ')}</i>`;
        } else {
          message += `\n💡 <i>Related token: ${symbols[0]}</i>`;
        }
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
import { logger } from './logger';

/**
 * 鲸鱼动向数据接口
 */
export interface WhaleActionData {
  address: string;
  action: string;
  amount: string;
  timestamp: string;
}

/**
 * 代币符号提取工具类
 * 负责从各种文本和数据中提取加密货币代币符号
 */
export class SymbolExtractor {
  // 常见代币符号的正则表达式
  private readonly tokenPatterns = [
    /\b([A-Z]{3,10})\b/g, // 3-10个大写字母的代币符号
    /\$([A-Z]{3,10})\b/g, // 带$符号的代币
    /(BTC|ETH|USDT|USDC|BNB|ADA|SOL|DOGE|SHIB|PEPE|WIF|BONK)/gi // 常见代币
  ];

  // 需要排除的常见非代币词汇
  private readonly excludeWords = [
    'THE', 'AND', 'FOR', 'ALL', 'NEW', 'NOW', 'GET', 'SET', 
    'USD', 'CNY', 'EUR', 'GBP', 'JPY', // 法币
    'API', 'URL', 'HTTP', 'JSON', 'XML', // 技术词汇
    'CEO', 'CTO', 'CFO', 'COO', // 职位
    'MIN', 'MAX', 'AVG', 'SUM', // 统计词汇
    'TOP', 'HOT', 'BIG', 'LOW', 'HIGH' // 描述词汇
  ];

  /**
   * 从文本中提取代币符号
   * @param text 要分析的文本内容
   * @returns 提取到的代币符号，如果没有找到则返回 undefined
   */
  public extractFromText(text: string): string | undefined {
    if (!text || typeof text !== 'string') {
      return undefined;
    }

    logger.debug('Extracting symbol from text', { 
      textLength: text.length,
      textPreview: text.substring(0, 100) 
    });

    for (const pattern of this.tokenPatterns) {
      // 重置正则表达式的 lastIndex
      pattern.lastIndex = 0;
      
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        // 处理每个匹配项
        for (const match of matches) {
          // 去掉$符号并转换为大写
          const symbol = match.replace('$', '').toUpperCase().trim();
          
          // 验证符号有效性
          if (this.isValidSymbol(symbol)) {
            logger.debug('Symbol extracted successfully', { 
              originalText: text.substring(0, 50),
              extractedSymbol: symbol,
              matchedPattern: pattern.source
            });
            return symbol;
          }
        }
      }
    }

    logger.debug('No valid symbol found in text', { 
      textLength: text.length,
      textPreview: text.substring(0, 50)
    });
    return undefined;
  }

  /**
   * 从鲸鱼动向数据中提取代币符号
   * @param action 鲸鱼动向数据
   * @returns 提取到的代币符号，如果没有找到则返回 undefined
   */
  public extractFromWhaleAction(action: WhaleActionData): string | undefined {
    if (!action || typeof action !== 'object') {
      return undefined;
    }

    logger.debug('Extracting symbol from whale action', {
      action: action.action,
      amount: action.amount,
      address: action.address?.substring(0, 10)
    });

    // 优先从action字段提取
    if (action.action) {
      const symbolFromAction = this.extractFromText(action.action);
      if (symbolFromAction) {
        logger.debug('Symbol extracted from action field', { 
          symbol: symbolFromAction,
          actionText: action.action
        });
        return symbolFromAction;
      }
    }
    
    // 其次从amount字段提取
    if (action.amount) {
      const symbolFromAmount = this.extractFromText(action.amount);
      if (symbolFromAmount) {
        logger.debug('Symbol extracted from amount field', { 
          symbol: symbolFromAmount,
          amountText: action.amount
        });
        return symbolFromAmount;
      }
    }
    
    // 最后尝试从address提取（地址通常不包含符号信息，但保留扩展性）
    if (action.address && action.address.length > 10) {
      // 这里可以添加更复杂的地址解析逻辑
      // 目前暂时跳过，因为地址通常不直接包含符号信息
      logger.debug('Address analysis skipped', { 
        address: action.address?.substring(0, 10) 
      });
    }
    
    logger.debug('No symbol found in whale action data', {
      action: action.action,
      amount: action.amount
    });
    return undefined;
  }

  /**
   * 验证代币符号的有效性
   * @param symbol 待验证的符号
   * @returns 如果符号有效返回 true，否则返回 false
   */
  private isValidSymbol(symbol: string): boolean {
    if (!symbol || typeof symbol !== 'string') {
      return false;
    }

    // 检查长度（至少3个字符，最多10个字符）
    if (symbol.length < 3 || symbol.length > 10) {
      return false;
    }

    // 检查是否只包含字母
    if (!/^[A-Z]+$/.test(symbol)) {
      return false;
    }

    // 排除常见的非代币词汇
    if (this.excludeWords.includes(symbol)) {
      logger.debug('Symbol excluded as common word', { symbol });
      return false;
    }

    return true;
  }

  /**
   * 批量从文本数组中提取符号
   * @param texts 文本数组
   * @returns 提取到的所有有效符号的数组（去重）
   */
  public extractMultipleFromTexts(texts: string[]): string[] {
    if (!texts || !Array.isArray(texts)) {
      return [];
    }

    const symbols = new Set<string>();
    
    for (const text of texts) {
      const symbol = this.extractFromText(text);
      if (symbol) {
        symbols.add(symbol);
      }
    }

    const result = Array.from(symbols);
    logger.debug('Extracted multiple symbols from texts', {
      textCount: texts.length,
      symbolsFound: result.length,
      symbols: result
    });

    return result;
  }

  /**
   * 验证符号是否为已知的加密货币代币
   * @param symbol 代币符号
   * @returns 如果是已知代币返回 true，否则返回 false
   */
  public isKnownToken(symbol: string): boolean {
    if (!symbol) return false;
    
    // 常见的加密货币代币列表
    const knownTokens = [
      'BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'ADA', 'SOL', 'XRP', 'DOGE',
      'MATIC', 'DOT', 'SHIB', 'AVAX', 'LINK', 'UNI', 'LTC', 'ATOM',
      'PEPE', 'WIF', 'BONK', 'FLOKI', 'MEME', 'POPCAT', 'NEIRO',
      'WBTC', 'DAI', 'WETH', 'STETH', 'BUSD', 'TUSD', 'FRAX'
    ];
    
    const upperSymbol = symbol.toUpperCase();
    const isKnown = knownTokens.includes(upperSymbol);
    
    logger.debug('Checked if symbol is known token', {
      symbol: upperSymbol,
      isKnown
    });
    
    return isKnown;
  }
}

// 导出单例
export const symbolExtractor = new SymbolExtractor();
export default symbolExtractor;
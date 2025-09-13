import { 
  SupportedTokenSymbol, 
  TokenSymbolValidation
} from '../../types/api.types';

/**
 * 支持的代币符号列表
 */
const SUPPORTED_TOKENS: SupportedTokenSymbol[] = [
  // 主流加密货币
  'BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'ADA',
  // DeFi代币
  'UNI', 'LINK', 'AAVE', 'COMP', 'SUSHI', 'CRV', 'YFI',
  // Layer 1
  'DOT', 'AVAX', 'MATIC', 'ATOM', 'NEAR', 'ALGO', 'EGLD',
  // Layer 2
  'OP', 'ARB', 'IMX', 'LRC',
  // Meme币
  'DOGE', 'SHIB', 'PEPE', 'FLOKI', 'HYPE',
  // 其他流行代币
  'APT', 'SUI', 'FTM', 'SAND', 'MANA', 'AXS'
];

/**
 * 代币符号别名映射
 */
const TOKEN_ALIASES: Record<string, string> = {
  'BITCOIN': 'BTC',
  'ETHEREUM': 'ETH',
  'SOLANA': 'SOL',
  'TETHER': 'USDT',
  'USD-COIN': 'USDC',
  'BINANCE-COIN': 'BNB',
  'CARDANO': 'ADA',
  'POLKADOT': 'DOT',
  'CHAINLINK': 'LINK',
  'POLYGON': 'MATIC',
  'AVALANCHE': 'AVAX',
  'UNISWAP': 'UNI',
  'DOGECOIN': 'DOGE',
  'SHIBA-INU': 'SHIB'
};

/**
 * 参数验证工具类
 * 提供各种输入参数的验证功能
 */
export class Validator {

  /**
   * 验证代币符号
   * @param symbol 用户输入的代币符号
   * @returns 验证结果和标准化后的符号
   */
  public validateTokenSymbol(symbol: any): TokenSymbolValidation {
    // 基础类型检查
    if (!symbol || typeof symbol !== 'string') {
      return {
        isValid: false,
        normalized: '',
        error: '代币符号不能为空且必须是字符串'
      };
    }

    // 清理和标准化输入
    const cleanSymbol = symbol.trim().toUpperCase();

    // 长度检查
    if (cleanSymbol.length === 0) {
      return {
        isValid: false,
        normalized: '',
        error: '代币符号不能为空'
      };
    }

    if (cleanSymbol.length > 10) {
      return {
        isValid: false,
        normalized: cleanSymbol,
        error: '代币符号过长，请使用标准代币符号'
      };
    }

    // 字符检查 - 只允许字母和数字
    if (!/^[A-Z0-9]+$/.test(cleanSymbol)) {
      return {
        isValid: false,
        normalized: cleanSymbol,
        error: '代币符号只能包含字母和数字'
      };
    }

    // 检查是否为别名
    const aliasSymbol = TOKEN_ALIASES[cleanSymbol];
    const finalSymbol = aliasSymbol || cleanSymbol;

    // 检查是否为支持的代币
    const isSupported = SUPPORTED_TOKENS.includes(finalSymbol as SupportedTokenSymbol);

    if (isSupported) {
      return {
        isValid: true,
        normalized: finalSymbol
      };
    }

    // 如果不在支持列表中，但格式正确，仍然允许（可能是新代币）
    // 但提供建议
    const suggestions = this.findSimilarTokens(cleanSymbol);

    return {
      isValid: true, // 允许尝试查询
      normalized: finalSymbol,
      suggestions: suggestions.length > 0 ? suggestions : undefined
    };
  }

  /**
   * 验证命令参数
   * @param args 命令参数数组
   * @param minArgs 最少参数数量
   * @param maxArgs 最多参数数量
   */
  public validateCommandArgs(args: string[], minArgs: number = 0, maxArgs?: number): {
    isValid: boolean;
    error?: string;
  } {
    if (args.length < minArgs) {
      return {
        isValid: false,
        error: `参数不足，至少需要 ${minArgs} 个参数`
      };
    }

    if (maxArgs && args.length > maxArgs) {
      return {
        isValid: false,
        error: `参数过多，最多支持 ${maxArgs} 个参数`
      };
    }

    return { isValid: true };
  }

  /**
   * 验证用户ID
   */
  public validateUserId(userId: any): boolean {
    return typeof userId === 'number' && userId > 0 && Number.isInteger(userId);
  }

  /**
   * 验证聊天ID
   */
  public validateChatId(chatId: any): boolean {
    return typeof chatId === 'number' && Number.isInteger(chatId);
  }

  /**
   * 验证用户名
   */
  public validateUsername(username: any): boolean {
    if (!username || typeof username !== 'string') {
      return false;
    }
    
    // Telegram用户名规则：3-32个字符，只能包含字母、数字、下划线
    return /^[a-zA-Z0-9_]{3,32}$/.test(username);
  }

  /**
   * 查找相似的代币符号（用于提供建议）
   */
  private findSimilarTokens(input: string): string[] {
    const suggestions: string[] = [];
    const inputLower = input.toLowerCase();

    // 精确前缀匹配
    for (const token of SUPPORTED_TOKENS) {
      if (token.toLowerCase().startsWith(inputLower)) {
        suggestions.push(token);
      }
    }

    // 如果精确前缀匹配没有结果，尝试模糊匹配
    if (suggestions.length === 0) {
      for (const token of SUPPORTED_TOKENS) {
        if (this.calculateSimilarity(inputLower, token.toLowerCase()) > 0.6) {
          suggestions.push(token);
        }
      }
    }

    // 检查别名
    for (const [alias, token] of Object.entries(TOKEN_ALIASES)) {
      if (alias.toLowerCase().includes(inputLower) || inputLower.includes(alias.toLowerCase())) {
        if (!suggestions.includes(token)) {
          suggestions.push(token);
        }
      }
    }

    return suggestions.slice(0, 5); // 最多返回5个建议
  }

  /**
   * 计算字符串相似度（简单的Levenshtein距离算法）
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1;
    
    const distance = this.levenshteinDistance(str1, str2);
    return (maxLength - distance) / maxLength;
  }

  /**
   * 计算Levenshtein距离
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * 验证和标准化多个代币符号
   */
  public validateMultipleTokenSymbols(symbols: string[]): {
    valid: string[];
    invalid: Array<{ symbol: string; error: string; suggestions?: string[] }>;
  } {
    const valid: string[] = [];
    const invalid: Array<{ symbol: string; error: string; suggestions?: string[] }> = [];

    for (const symbol of symbols) {
      const validation = this.validateTokenSymbol(symbol);
      if (validation.isValid) {
        valid.push(validation.normalized);
      } else {
        invalid.push({
          symbol: symbol,
          error: validation.error || '无效的代币符号',
          suggestions: validation.suggestions
        });
      }
    }

    return { valid, invalid };
  }

  /**
   * 检查是否为常见的代币符号错误
   */
  public checkCommonErrors(symbol: string): string | null {
    const normalizedSymbol = symbol.toUpperCase().trim();

    // 常见错误映射
    const commonErrors: Record<string, string> = {
      'BITCOIN': '请使用 BTC 而不是 BITCOIN',
      'ETHEREUM': '请使用 ETH 而不是 ETHEREUM',
      'SOLANA': '请使用 SOL 而不是 SOLANA',
      'BINANCE': '请使用 BNB 而不是 BINANCE',
      'TETHER': '请使用 USDT 而不是 TETHER'
    };

    return commonErrors[normalizedSymbol] || null;
  }

  /**
   * 获取支持的代币列表
   */
  public getSupportedTokens(): SupportedTokenSymbol[] {
    return [...SUPPORTED_TOKENS];
  }

  /**
   * 获取代币别名映射
   */
  public getTokenAliases(): Record<string, string> {
    return { ...TOKEN_ALIASES };
  }

  /**
   * 检查是否为高风险代币符号（防止恶意输入）
   */
  public isHighRiskSymbol(symbol: string): boolean {
    const dangerous = [
      'SCAM', 'FAKE', 'TEST', 'NULL', 'UNDEFINED', 
      'ADMIN', 'ROOT', 'SYSTEM', 'DELETE', 'DROP'
    ];
    
    return dangerous.some(risk => symbol.toUpperCase().includes(risk));
  }

  /**
   * 验证价格查询频率（防止滥用）
   */
  public validateQueryFrequency(_userId: number, lastQueryTime?: number): {
    allowed: boolean;
    waitTime?: number;
  } {
    if (!lastQueryTime) {
      return { allowed: true };
    }

    const minInterval = 1000; // 最小间隔1秒
    const timeSinceLastQuery = Date.now() - lastQueryTime;

    if (timeSinceLastQuery < minInterval) {
      return {
        allowed: false,
        waitTime: Math.ceil((minInterval - timeSinceLastQuery) / 1000)
      };
    }

    return { allowed: true };
  }
}

// 便捷的验证函数
export function validateSymbol(symbol: any): string {
  const validator = new Validator();
  const result = validator.validateTokenSymbol(symbol);
  
  if (!result.isValid) {
    throw new Error(result.error || '无效的代币符号');
  }

  // 如果有建议但符号仍然有效，记录警告但不抛出错误
  if (result.suggestions && result.suggestions.length > 0) {
    // 这里可以添加日志记录，但不阻塞查询
    console.warn(`Token ${symbol} not in supported list, but attempting query. Suggestions: ${result.suggestions.join(', ')}`);
  }

  return result.normalized;
}

export function validateArgs(args: string[], min: number = 0, max?: number): void {
  const validator = new Validator();
  const result = validator.validateCommandArgs(args, min, max);
  
  if (!result.isValid) {
    throw new Error(result.error);
  }
}

// 导出单例实例
export const validator = new Validator();

// 默认导出
export default validator;
/**
 * 错误类型枚举
 * 定义TGBot系统中常见的错误类型
 */
export enum ErrorType {
  // 交易相关错误
  NO_POSITIONS = 'NO_POSITIONS',           // 没有持仓
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS', // 余额不足
  INSUFFICIENT_POSITION = 'INSUFFICIENT_POSITION', // 持仓不足
  INVALID_AMOUNT = 'INVALID_AMOUNT',       // 数量无效
  TRADING_EXECUTION_FAILED = 'TRADING_EXECUTION_FAILED', // 交易执行失败
  
  // 格式和参数错误
  FORMAT_ERROR = 'FORMAT_ERROR',           // 格式错误
  MISSING_PARAMS = 'MISSING_PARAMS',       // 缺少参数
  INVALID_SYMBOL = 'INVALID_SYMBOL',       // 代币符号无效
  
  // 认证和权限错误
  AUTH_FAILED = 'AUTH_FAILED',             // 认证失败
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',         // 令牌过期
  PERMISSION_DENIED = 'PERMISSION_DENIED',  // 权限不足
  
  // 网络和服务错误
  NETWORK_ERROR = 'NETWORK_ERROR',         // 网络错误
  API_ERROR = 'API_ERROR',                 // API错误
  SERVER_ERROR = 'SERVER_ERROR',           // 服务器错误
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE', // 服务不可用
  RATE_LIMIT = 'RATE_LIMIT',               // 请求频率超限
  
  // 数据和状态错误
  DATA_NOT_FOUND = 'DATA_NOT_FOUND',       // 数据未找到
  INVALID_STATE = 'INVALID_STATE',         // 状态无效
  
  // 未知错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'          // 未知错误
}

/**
 * 错误分类结果接口
 */
export interface ErrorClassification {
  type: ErrorType;
  originalError: any;
  httpStatus?: number;
  isRetryable: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * 错误分类器类
 * 自动识别和分类各种错误类型
 */
export class ErrorClassifier {
  /**
   * 分类API错误
   */
  public static classifyApiError(error: any): ErrorClassification {
    const httpStatus = error.status || error.response?.status;
    const responseMessage = error.response?.message || error.message || '';
    const responseData = error.response || {};

    // 根据HTTP状态码分类
    switch (httpStatus) {
      case 400:
        return this.classify400Error(responseMessage, error, httpStatus);
      
      case 401:
        return {
          type: ErrorType.AUTH_FAILED,
          originalError: error,
          httpStatus,
          isRetryable: true, // 可以尝试刷新token重试
          severity: 'medium'
        };
      
      case 403:
        return {
          type: ErrorType.PERMISSION_DENIED,
          originalError: error,
          httpStatus,
          isRetryable: false,
          severity: 'medium'
        };
      
      case 404:
        return {
          type: ErrorType.DATA_NOT_FOUND,
          originalError: error,
          httpStatus,
          isRetryable: false,
          severity: 'low'
        };
      
      case 429:
        return {
          type: ErrorType.RATE_LIMIT,
          originalError: error,
          httpStatus,
          isRetryable: true,
          severity: 'medium'
        };
      
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          type: ErrorType.SERVER_ERROR,
          originalError: error,
          httpStatus,
          isRetryable: true,
          severity: 'high'
        };
      
      default:
        // 检查是否是网络错误
        if (!httpStatus || error.code === 'NETWORK_ERROR' || error.code === 'ECONNREFUSED') {
          return {
            type: ErrorType.NETWORK_ERROR,
            originalError: error,
            httpStatus,
            isRetryable: true,
            severity: 'high'
          };
        }
        
        return {
          type: ErrorType.UNKNOWN_ERROR,
          originalError: error,
          httpStatus,
          isRetryable: false,
          severity: 'medium'
        };
    }
  }

  /**
   * 分类400错误（业务逻辑错误）
   */
  private static classify400Error(message: string, error: any, httpStatus: number): ErrorClassification {
    const lowerMessage = message.toLowerCase();

    // 没有持仓相关
    if (lowerMessage.includes('no position') || 
        lowerMessage.includes('position not found') || 
        lowerMessage.includes('仓位不存在') ||
        lowerMessage.includes('no positions found')) {
      return {
        type: ErrorType.NO_POSITIONS,
        originalError: error,
        httpStatus,
        isRetryable: false,
        severity: 'low'
      };
    }

    // 持仓不足
    if (lowerMessage.includes('insufficient position') || 
        lowerMessage.includes('仓位不足')) {
      return {
        type: ErrorType.INSUFFICIENT_POSITION,
        originalError: error,
        httpStatus,
        isRetryable: false,
        severity: 'low'
      };
    }

    // 余额不足
    if (lowerMessage.includes('insufficient fund') || 
        lowerMessage.includes('insufficient balance') ||
        lowerMessage.includes('余额不足') ||
        lowerMessage.includes('资金不足')) {
      return {
        type: ErrorType.INSUFFICIENT_FUNDS,
        originalError: error,
        httpStatus,
        isRetryable: false,
        severity: 'medium'
      };
    }

    // 数量无效
    if (lowerMessage.includes('invalid amount') || 
        lowerMessage.includes('invalid quantity') ||
        lowerMessage.includes('数量无效') ||
        lowerMessage.includes('amount must be')) {
      return {
        type: ErrorType.INVALID_AMOUNT,
        originalError: error,
        httpStatus,
        isRetryable: false,
        severity: 'low'
      };
    }

    // 交易执行失败
    if (lowerMessage.includes('hyperliquid api returned null') ||
        lowerMessage.includes('execution failed') ||
        lowerMessage.includes('trade failed') ||
        lowerMessage.includes('交易失败')) {
      return {
        type: ErrorType.TRADING_EXECUTION_FAILED,
        originalError: error,
        httpStatus,
        isRetryable: true,
        severity: 'high'
      };
    }

    // 代币符号无效
    if (lowerMessage.includes('invalid symbol') ||
        lowerMessage.includes('unknown symbol') ||
        lowerMessage.includes('symbol not found') ||
        lowerMessage.includes('代币不存在')) {
      return {
        type: ErrorType.INVALID_SYMBOL,
        originalError: error,
        httpStatus,
        isRetryable: false,
        severity: 'low'
      };
    }

    // 参数格式错误
    if (lowerMessage.includes('invalid format') ||
        lowerMessage.includes('format error') ||
        lowerMessage.includes('malformed') ||
        lowerMessage.includes('格式错误')) {
      return {
        type: ErrorType.FORMAT_ERROR,
        originalError: error,
        httpStatus,
        isRetryable: false,
        severity: 'low'
      };
    }

    // 缺少参数
    if (lowerMessage.includes('missing parameter') ||
        lowerMessage.includes('required parameter') ||
        lowerMessage.includes('参数缺失') ||
        lowerMessage.includes('缺少参数')) {
      return {
        type: ErrorType.MISSING_PARAMS,
        originalError: error,
        httpStatus,
        isRetryable: false,
        severity: 'low'
      };
    }

    // 默认为API错误
    return {
      type: ErrorType.API_ERROR,
      originalError: error,
      httpStatus,
      isRetryable: false,
      severity: 'medium'
    };
  }

  /**
   * 分类通用错误
   */
  public static classifyGenericError(error: Error | any): ErrorClassification {
    const message = error.message || error.toString() || '';
    const lowerMessage = message.toLowerCase();

    // 网络相关错误
    if (lowerMessage.includes('network') || 
        lowerMessage.includes('connection') ||
        lowerMessage.includes('timeout') ||
        lowerMessage.includes('econnrefused') ||
        lowerMessage.includes('enotfound')) {
      return {
        type: ErrorType.NETWORK_ERROR,
        originalError: error,
        isRetryable: true,
        severity: 'high'
      };
    }

    // 认证相关错误
    if (lowerMessage.includes('unauthorized') ||
        lowerMessage.includes('authentication') ||
        lowerMessage.includes('token') ||
        lowerMessage.includes('认证')) {
      return {
        type: ErrorType.AUTH_FAILED,
        originalError: error,
        isRetryable: true,
        severity: 'medium'
      };
    }

    // 参数验证错误
    if (lowerMessage.includes('validation') ||
        lowerMessage.includes('invalid') ||
        lowerMessage.includes('format') ||
        lowerMessage.includes('验证')) {
      return {
        type: ErrorType.FORMAT_ERROR,
        originalError: error,
        isRetryable: false,
        severity: 'low'
      };
    }

    // 默认为未知错误
    return {
      type: ErrorType.UNKNOWN_ERROR,
      originalError: error,
      isRetryable: false,
      severity: 'medium'
    };
  }

  /**
   * 判断错误是否可以重试
   */
  public static isRetryableError(error: any): boolean {
    const classification = this.classifyApiError(error);
    return classification.isRetryable;
  }

  /**
   * 获取错误严重程度
   */
  public static getErrorSeverity(error: any): 'low' | 'medium' | 'high' | 'critical' {
    const classification = this.classifyApiError(error);
    return classification.severity;
  }
}

// 导出默认实例
export default ErrorClassifier;
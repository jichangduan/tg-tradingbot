import { ErrorType } from './error-classifier';

/**
 * 错误消息接口
 */
export interface ErrorMessage {
  icon: string;
  title: string;
  description: string;
  reasons?: string[];
  suggestions: string[];
  isUserFault: boolean; // 是否为用户操作错误
}

/**
 * 错误消息模板配置
 * 为每种错误类型提供用户友好的消息模板
 */
export const ERROR_MESSAGES: Record<ErrorType, ErrorMessage> = {
  // 交易相关错误
  [ErrorType.NO_POSITIONS]: {
    icon: '📭',
    title: 'No position found for this token',
    description: 'No position information found for this token in your account',
    reasons: [
      'Currently no position for this token',
      'Position has been completely closed',
      'Token symbol entered incorrectly',
      'May be in different wallet type (trading/strategy)'
    ],
    suggestions: [
      'Use /positions to view all current positions',
      'Check token symbol spelling (e.g.: BTC, ETH, SOL)',
      'Confirm if using correct trading pair name',
      'If traded recently, please wait for data sync'
    ],
    isUserFault: true
  },

  [ErrorType.INSUFFICIENT_FUNDS]: {
    icon: '💰',
    title: 'Insufficient account balance',
    description: 'Your account balance is insufficient to complete this transaction',
    reasons: [
      'Insufficient available balance',
      'Funds occupied by other orders',
      'Insufficient margin'
    ],
    suggestions: [
      'Use /wallet to check account balance',
      'Reduce trading amount',
      'Deposit more funds',
      'Cancel other pending orders'
    ],
    isUserFault: true
  },

  [ErrorType.INSUFFICIENT_POSITION]: {
    icon: '📉',
    title: 'Insufficient position amount',
    description: 'The amount you want to close exceeds your current actual position',
    reasons: [
      'Position amount is less than requested close amount',
      'Some positions have been closed by other orders',
      'Multiple close operations performed simultaneously',
      'Data synchronization delay exists'
    ],
    suggestions: [
      'Use /positions to check latest position amount',
      'Try using smaller close percentage (e.g. 50%)',
      'Cancel other pending close orders first',
      'Wait a few seconds and retry the operation'
    ],
    isUserFault: true
  },

  [ErrorType.INVALID_AMOUNT]: {
    icon: '🔢',
    title: 'Invalid close amount format',
    description: 'The close amount format you entered is incorrect or out of range',
    reasons: [
      'Amount format does not meet requirements',
      'Percentage not in valid range (0-100%)',
      'Amount is negative or zero',
      'Contains invalid characters or special symbols'
    ],
    suggestions: [
      'Percentage format: 30%, 50%, 100%',
      'Decimal format: 0.5, 1.0, 2.5',
      'Integer format: 1, 10, 100',
      'Ensure value is greater than 0 and reasonable'
    ],
    isUserFault: true
  },

  [ErrorType.TRADING_EXECUTION_FAILED]: {
    icon: '⚠️',
    title: 'Close execution failed',
    description: 'Close request was submitted but encountered problems during execution',
    reasons: [
      'Market liquidity temporarily insufficient',
      'Trading system busy or under maintenance',
      'Large price volatility causing execution difficulties',
      'Network connection or API service anomaly'
    ],
    suggestions: [
      'Wait 10-30 seconds and retry',
      'Try partial closing (e.g. close 50% first)',
      'Use /positions to confirm current status',
      'If continues to fail, please contact technical support'
    ],
    isUserFault: false
  },

  // 格式和参数错误
  [ErrorType.FORMAT_ERROR]: {
    icon: '📝',
    title: 'Command format error',
    description: 'The command format you entered is incorrect',
    reasons: [
      'Parameter format does not meet requirements',
      'Missing required parameters',
      'Incorrect parameter order'
    ],
    suggestions: [
      'Check command format',
      'Refer to usage examples',
      'Use /help to view command help'
    ],
    isUserFault: true
  },

  [ErrorType.MISSING_PARAMS]: {
    icon: '❓',
    title: 'Missing required parameters',
    description: 'Command is missing required parameters',
    reasons: [
      'Required parameters not provided',
      'Insufficient number of parameters'
    ],
    suggestions: [
      'Add missing parameters',
      'Refer to complete command format',
      'View command examples'
    ],
    isUserFault: true
  },

  [ErrorType.INVALID_SYMBOL]: {
    icon: '🪙',
    title: 'Invalid token symbol',
    description: 'The token symbol you entered does not exist or is not supported',
    reasons: [
      'Token symbol does not exist',
      'This token does not support trading yet',
      'Symbol spelling error'
    ],
    suggestions: [
      'Check token symbol spelling',
      'Use /markets to view supported tokens',
      'Confirm if token is already listed'
    ],
    isUserFault: true
  },

  // 认证和权限错误
  [ErrorType.AUTH_FAILED]: {
    icon: '🔐',
    title: 'Authentication failed',
    description: 'Unable to verify your identity information, please log in again',
    reasons: [
      'Login session has expired',
      'Account authentication information is invalid',
      'System is performing security verification',
      'Token corrupted during network transmission'
    ],
    suggestions: [
      'Send /start to reinitialize account',
      'Wait a few seconds and retry operation',
      'Check if network connection is stable',
      'If problem persists, please contact technical support'
    ],
    isUserFault: false
  },

  [ErrorType.TOKEN_EXPIRED]: {
    icon: '⏰',
    title: 'Session expired',
    description: 'Your login session has expired',
    reasons: [
      'Long time without operation',
      'System security policy',
      'Account status change'
    ],
    suggestions: [
      'Restart conversation with /start',
      'Re-authenticate'
    ],
    isUserFault: false
  },

  [ErrorType.PERMISSION_DENIED]: {
    icon: '🚫',
    title: 'Insufficient permissions',
    description: 'Your account permissions are insufficient to perform this operation',
    reasons: [
      'Account level restriction',
      'Insufficient feature permissions',
      'Risk control policy restriction'
    ],
    suggestions: [
      'Contact customer service to understand permission requirements',
      'Upgrade account level',
      'Complete relevant verification'
    ],
    isUserFault: false
  },

  // 网络和服务错误
  [ErrorType.NETWORK_ERROR]: {
    icon: '🌐',
    title: 'Network connection problem',
    description: 'Unable to connect to server',
    reasons: [
      'Unstable network connection',
      'Server temporarily unreachable',
      'DNS resolution problem'
    ],
    suggestions: [
      'Check network connection',
      'Try again later',
      'Switch network environment'
    ],
    isUserFault: false
  },

  [ErrorType.API_ERROR]: {
    icon: '🔧',
    title: 'API interface error',
    description: 'Backend interface returned error',
    reasons: [
      'API interface exception',
      'Data processing error',
      'Internal service problem'
    ],
    suggestions: [
      'Try again later',
      'Contact technical support',
      'Check input parameters'
    ],
    isUserFault: false
  },

  [ErrorType.SERVER_ERROR]: {
    icon: '🔧',
    title: 'Internal server error',
    description: 'Server encountered internal error',
    reasons: [
      'Internal server exception',
      'Database connection problem',
      'Insufficient system resources'
    ],
    suggestions: [
      'Try again later',
      'Contact technical support',
      'Follow system status announcements'
    ],
    isUserFault: false
  },

  [ErrorType.SERVICE_UNAVAILABLE]: {
    icon: '🚧',
    title: 'Service temporarily unavailable',
    description: 'Related service is under maintenance or upgrading',
    reasons: [
      'System under maintenance',
      'Service upgrading',
      'Traffic overload'
    ],
    suggestions: [
      'Try again later',
      'Follow maintenance announcements',
      'Use other features'
    ],
    isUserFault: false
  },

  [ErrorType.RATE_LIMIT]: {
    icon: '⏱️',
    title: 'Request frequency limit exceeded',
    description: 'Your operations are too frequent',
    reasons: [
      'Too many requests in short time',
      'Rate limit triggered',
      'Anti-spam mechanism triggered'
    ],
    suggestions: [
      'Wait a moment and retry',
      'Slow down operation frequency',
      'Merge similar operations'
    ],
    isUserFault: true
  },

  // 数据和状态错误
  [ErrorType.DATA_NOT_FOUND]: {
    icon: '🔍',
    title: 'Data not found',
    description: 'The requested data does not exist',
    reasons: [
      'Data has been deleted',
      'Query condition error',
      'Data synchronization delay'
    ],
    suggestions: [
      'Check query parameters',
      'Try again later',
      'Confirm if data exists'
    ],
    isUserFault: true
  },

  [ErrorType.INVALID_STATE]: {
    icon: '🔄',
    title: 'State exception',
    description: 'Current state does not allow this operation',
    reasons: [
      'Account state exception',
      'Trading state conflict',
      'System state mismatch'
    ],
    suggestions: [
      'Check account status',
      'Wait for state recovery',
      'Contact customer service'
    ],
    isUserFault: false
  },

  // 未知错误
  [ErrorType.UNKNOWN_ERROR]: {
    icon: '❌',
    title: 'Unknown error',
    description: 'Encountered unknown system error',
    reasons: [
      'System encountered unexpected error',
      'New error type',
      'Configuration problem'
    ],
    suggestions: [
      'Try again later',
      'Contact technical support',
      'Provide detailed error information'
    ],
    isUserFault: false
  }
};

/**
 * 格式化错误消息为Telegram消息格式
 */
export function formatErrorMessage(
  errorType: ErrorType, 
  context?: {
    symbol?: string;
    amount?: string;
    command?: string;
    details?: string;
  }
): string {
  const template = ERROR_MESSAGES[errorType];
  if (!template) {
    return formatErrorMessage(ErrorType.UNKNOWN_ERROR, context);
  }

  let message = `${template.icon} <b>${template.title}</b>\n\n`;
  
  // 添加描述和上下文信息
  if (context?.symbol) {
    message += `Token: <code>${context.symbol.toUpperCase()}</code>\n`;
  }
  if (context?.amount) {
    message += `Amount: <code>${context.amount}</code>\n`;
  }
  if (context?.details) {
    message += `Details: ${context.details}\n`;
  }
  
  if (context?.symbol || context?.amount || context?.details) {
    message += '\n';
  }
  
  message += `${template.description}\n\n`;

  // 添加可能的原因
  if (template.reasons && template.reasons.length > 0) {
    message += '🤔 <b>Possible reasons:</b>\n';
    template.reasons.forEach(reason => {
      message += `• ${reason}\n`;
    });
    message += '\n';
  }

  // 添加建议操作
  message += '💡 <b>Suggested actions:</b>\n';
  template.suggestions.forEach(suggestion => {
    message += `• ${suggestion}\n`;
  });

  // 对于非用户错误，添加技术支持信息
  if (!template.isUserFault) {
    message += '\n<i>If the problem persists, please contact technical support</i>';
  }

  return message;
}

/**
 * 生成简短的错误消息（用于日志）
 */
export function getShortErrorMessage(errorType: ErrorType): string {
  const template = ERROR_MESSAGES[errorType];
  return template ? `${template.icon} ${template.title}` : `❌ ${errorType}`;
}

/**
 * 判断是否为用户操作错误
 */
export function isUserFault(errorType: ErrorType): boolean {
  const template = ERROR_MESSAGES[errorType];
  return template ? template.isUserFault : false;
}

// 导出常用的错误消息
export default ERROR_MESSAGES;
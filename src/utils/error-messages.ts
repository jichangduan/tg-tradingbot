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
    title: '当前没有该代币的持仓',
    description: '您的账户中没有找到相关代币的持仓信息',
    reasons: [
      '当前没有该代币的持仓',
      '仓位已被平掉',
      '代币符号不正确'
    ],
    suggestions: [
      '使用 /positions 查看当前持仓',
      '检查代币符号是否正确',
      '确认是否在正确的交易对'
    ],
    isUserFault: true
  },

  [ErrorType.INSUFFICIENT_FUNDS]: {
    icon: '💰',
    title: '账户余额不足',
    description: '您的账户余额不足以完成此次交易',
    reasons: [
      '账户可用余额不够',
      '资金被其他订单占用',
      '保证金不足'
    ],
    suggestions: [
      '使用 /wallet 查看账户余额',
      '减少交易数量',
      '充值更多资金',
      '取消其他未成交的订单'
    ],
    isUserFault: true
  },

  [ErrorType.INSUFFICIENT_POSITION]: {
    icon: '📉',
    title: '仓位数量不足',
    description: '您要平仓的数量超过了当前持仓',
    reasons: [
      '持仓数量小于请求数量',
      '部分仓位已被平仓',
      '数据更新延迟'
    ],
    suggestions: [
      '使用 /positions 查看实际持仓数量',
      '尝试较小的平仓数量',
      '等待数据同步后重试'
    ],
    isUserFault: true
  },

  [ErrorType.INVALID_AMOUNT]: {
    icon: '🔢',
    title: '交易数量格式错误',
    description: '您输入的交易数量格式不正确',
    reasons: [
      '数量格式不符合要求',
      '数量超出限制范围',
      '使用了无效字符'
    ],
    suggestions: [
      '检查数量格式（支持小数、百分比）',
      '确保数量大于0',
      '参考示例：1.5、50%、100'
    ],
    isUserFault: true
  },

  [ErrorType.TRADING_EXECUTION_FAILED]: {
    icon: '⚠️',
    title: '交易执行失败',
    description: '交易请求已提交但执行时遇到问题',
    reasons: [
      '市场流动性不足',
      '仓位被锁定或限制',
      '交易系统繁忙',
      '价格波动过大'
    ],
    suggestions: [
      '稍后重试',
      '尝试分批交易',
      '调整价格参数',
      '联系客服获取帮助'
    ],
    isUserFault: false
  },

  // 格式和参数错误
  [ErrorType.FORMAT_ERROR]: {
    icon: '📝',
    title: '命令格式错误',
    description: '您输入的命令格式不正确',
    reasons: [
      '参数格式不符合要求',
      '缺少必需的参数',
      '参数顺序错误'
    ],
    suggestions: [
      '检查命令格式',
      '参考使用示例',
      '使用 /help 查看命令帮助'
    ],
    isUserFault: true
  },

  [ErrorType.MISSING_PARAMS]: {
    icon: '❓',
    title: '缺少必要参数',
    description: '命令缺少必要的参数',
    reasons: [
      '未提供必需的参数',
      '参数数量不足'
    ],
    suggestions: [
      '添加缺少的参数',
      '参考完整的命令格式',
      '查看命令示例'
    ],
    isUserFault: true
  },

  [ErrorType.INVALID_SYMBOL]: {
    icon: '🪙',
    title: '代币符号无效',
    description: '您输入的代币符号不存在或不支持',
    reasons: [
      '代币符号不存在',
      '该代币暂不支持交易',
      '符号拼写错误'
    ],
    suggestions: [
      '检查代币符号拼写',
      '使用 /markets 查看支持的代币',
      '确认代币是否已上线'
    ],
    isUserFault: true
  },

  // 认证和权限错误
  [ErrorType.AUTH_FAILED]: {
    icon: '🔐',
    title: '认证失败',
    description: '无法验证您的身份信息',
    reasons: [
      '用户会话已过期',
      '认证令牌无效',
      '账户状态异常'
    ],
    suggestions: [
      '重新启动对话 /start',
      '稍后重试',
      '联系客服获取帮助'
    ],
    isUserFault: false
  },

  [ErrorType.TOKEN_EXPIRED]: {
    icon: '⏰',
    title: '会话已过期',
    description: '您的登录会话已过期',
    reasons: [
      '长时间未操作',
      '系统安全策略',
      '账户状态变更'
    ],
    suggestions: [
      '重新启动对话 /start',
      '重新进行身份验证'
    ],
    isUserFault: false
  },

  [ErrorType.PERMISSION_DENIED]: {
    icon: '🚫',
    title: '权限不足',
    description: '您的账户权限不足以执行此操作',
    reasons: [
      '账户等级限制',
      '功能权限不足',
      '风控策略限制'
    ],
    suggestions: [
      '联系客服了解权限要求',
      '升级账户等级',
      '完成相关认证'
    ],
    isUserFault: false
  },

  // 网络和服务错误
  [ErrorType.NETWORK_ERROR]: {
    icon: '🌐',
    title: '网络连接问题',
    description: '无法连接到服务器',
    reasons: [
      '网络连接不稳定',
      '服务器暂时不可达',
      'DNS解析问题'
    ],
    suggestions: [
      '检查网络连接',
      '稍后重试',
      '切换网络环境'
    ],
    isUserFault: false
  },

  [ErrorType.API_ERROR]: {
    icon: '🔧',
    title: 'API接口错误',
    description: '后端接口返回错误',
    reasons: [
      'API接口异常',
      '数据处理错误',
      '服务内部问题'
    ],
    suggestions: [
      '稍后重试',
      '联系技术支持',
      '检查输入参数'
    ],
    isUserFault: false
  },

  [ErrorType.SERVER_ERROR]: {
    icon: '🔧',
    title: '服务器内部错误',
    description: '服务器遇到内部错误',
    reasons: [
      '服务器内部异常',
      '数据库连接问题',
      '系统资源不足'
    ],
    suggestions: [
      '稍后重试',
      '联系技术支持',
      '关注系统状态公告'
    ],
    isUserFault: false
  },

  [ErrorType.SERVICE_UNAVAILABLE]: {
    icon: '🚧',
    title: '服务暂时不可用',
    description: '相关服务正在维护或升级中',
    reasons: [
      '系统维护中',
      '服务升级中',
      '流量过载'
    ],
    suggestions: [
      '稍后重试',
      '关注维护公告',
      '使用其他功能'
    ],
    isUserFault: false
  },

  [ErrorType.RATE_LIMIT]: {
    icon: '⏱️',
    title: '请求频率超限',
    description: '您的操作过于频繁',
    reasons: [
      '短时间内请求过多',
      '触发频率限制',
      '防刷机制触发'
    ],
    suggestions: [
      '稍等一会再重试',
      '减慢操作频率',
      '合并相似操作'
    ],
    isUserFault: true
  },

  // 数据和状态错误
  [ErrorType.DATA_NOT_FOUND]: {
    icon: '🔍',
    title: '数据未找到',
    description: '请求的数据不存在',
    reasons: [
      '数据已被删除',
      '查询条件错误',
      '数据同步延迟'
    ],
    suggestions: [
      '检查查询参数',
      '稍后重试',
      '确认数据是否存在'
    ],
    isUserFault: true
  },

  [ErrorType.INVALID_STATE]: {
    icon: '🔄',
    title: '状态异常',
    description: '当前状态不允许执行此操作',
    reasons: [
      '账户状态异常',
      '交易状态冲突',
      '系统状态不符'
    ],
    suggestions: [
      '检查账户状态',
      '等待状态恢复',
      '联系客服处理'
    ],
    isUserFault: false
  },

  // 未知错误
  [ErrorType.UNKNOWN_ERROR]: {
    icon: '❌',
    title: '未知错误',
    description: '遇到了未知的系统错误',
    reasons: [
      '系统遇到未预期的错误',
      '新的错误类型',
      '配置问题'
    ],
    suggestions: [
      '稍后重试',
      '联系技术支持',
      '提供详细的错误信息'
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
    message += `代币: <code>${context.symbol.toUpperCase()}</code>\n`;
  }
  if (context?.amount) {
    message += `数量: <code>${context.amount}</code>\n`;
  }
  if (context?.details) {
    message += `详情: ${context.details}\n`;
  }
  
  if (context?.symbol || context?.amount || context?.details) {
    message += '\n';
  }
  
  message += `${template.description}\n\n`;

  // 添加可能的原因
  if (template.reasons && template.reasons.length > 0) {
    message += '🤔 <b>可能原因:</b>\n';
    template.reasons.forEach(reason => {
      message += `• ${reason}\n`;
    });
    message += '\n';
  }

  // 添加建议操作
  message += '💡 <b>建议操作:</b>\n';
  template.suggestions.forEach(suggestion => {
    message += `• ${suggestion}\n`;
  });

  // 对于非用户错误，添加技术支持信息
  if (!template.isUserFault) {
    message += '\n<i>如果问题持续存在，请联系技术支持</i>';
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
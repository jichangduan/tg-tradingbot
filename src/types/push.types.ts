/**
 * 推送相关的类型定义
 */

/**
 * 推送设置类型
 */
export interface PushSettings {
  flash_enabled: boolean;   // 快讯推送开关
  whale_enabled: boolean;   // 鲸鱼动向推送开关
  fund_enabled: boolean;    // 资金流向推送开关
}

/**
 * 扩展的推送设置（包含用户信息）
 */
export interface UserPushSettings extends PushSettings {
  user_id: number;         // 用户ID
  updated_at?: string;     // 最后更新时间
}

/**
 * 快讯数据类型
 */
export interface FlashNews {
  id?: string | number;    // 快讯ID（用于去重）
  title: string;           // 标题
  content?: string;        // 内容
  timestamp: string;       // 时间戳
  source?: string;         // 来源
  url?: string;           // 详情链接
}

/**
 * 鲸鱼动向数据类型
 */
export interface WhaleAction {
  id?: string | number;    // 动向ID（用于去重）
  address: string;         // 钱包地址
  action: string;          // 操作类型 (买入/卖出/转账等)
  amount: string;          // 操作金额
  symbol?: string;         // 币种符号
  timestamp: string;       // 时间戳
  transaction_hash?: string; // 交易哈希
  exchange?: string;       // 交易所
  
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
 * 资金流向数据类型
 */
export interface FundFlow {
  id?: string | number;    // 流向ID（用于去重）
  from: string;            // 资金来源
  to: string;              // 资金去向
  amount: string;          // 流向金额
  symbol?: string;         // 币种符号
  timestamp: string;       // 时间戳
  flow_type?: string;      // 流向类型 (流入/流出)
  exchange_from?: string;  // 来源交易所
  exchange_to?: string;    // 目标交易所
}

/**
 * 推送数据容器
 */
export interface PushData {
  flash_news?: FlashNews[];      // 快讯数据
  whale_actions?: WhaleAction[]; // 鲸鱼动向数据
  fund_flows?: FundFlow[];       // 资金流向数据
}

/**
 * 推送设置请求参数
 */
export interface PushSettingsUpdateRequest {
  flash_enabled?: boolean;
  whale_enabled?: boolean;
  fund_enabled?: boolean;
}

/**
 * API响应格式 - 获取推送设置
 */
export interface PushSettingsResponse {
  code: number;
  data: {
    user_settings: UserPushSettings;
    push_data?: PushData;
    cache_info?: {
      last_updated: string;
      update_count: number;
    };
  };
  message: string;
}

/**
 * API响应格式 - 更新推送设置
 */
export interface PushSettingsUpdateResponse {
  code: number;
  data: {
    user_settings: UserPushSettings;
  };
  message: string;
}

/**
 * 推送用户信息
 */
export interface PushUser {
  userId: string;           // Telegram用户ID
  telegramId: number;       // Telegram数字ID
  settings: PushSettings;   // 推送设置
  accessToken?: string;     // 访问令牌
  lastPushTime?: string;    // 最后推送时间
}

/**
 * 推送任务执行结果
 */
export interface PushExecutionResult {
  executionId: string;      // 执行ID
  startTime: Date;          // 开始时间
  endTime: Date;            // 结束时间
  duration: number;         // 执行时长（毫秒）
  totalUsers: number;       // 总用户数
  successCount: number;     // 成功推送数
  failureCount: number;     // 失败推送数
  errors?: string[];        // 错误信息列表
}

/**
 * 推送调度器状态
 */
export interface SchedulerStatus {
  isRunning: boolean;       // 是否运行中
  cronPattern: string;      // Cron表达式
  environment: string;      // 运行环境
  lastExecution?: Date;     // 最后执行时间
  nextExecution?: Date;     // 下次执行时间
}

/**
 * 推送消息类型
 */
export enum PushMessageType {
  FLASH_NEWS = 'flash_news',
  WHALE_ACTION = 'whale_action',
  FUND_FLOW = 'fund_flow'
}

/**
 * 推送消息内容
 */
export interface PushMessage {
  type: PushMessageType;    // 消息类型
  title: string;            // 消息标题
  content: string;          // 消息内容
  timestamp: string;        // 时间戳
  data: FlashNews | WhaleAction | FundFlow; // 原始数据
}

/**
 * 推送错误类型
 */
export enum PushErrorType {
  API_ERROR = 'api_error',
  AUTH_ERROR = 'auth_error',
  NETWORK_ERROR = 'network_error',
  TELEGRAM_ERROR = 'telegram_error',
  DATA_ERROR = 'data_error'
}

/**
 * 推送错误信息
 */
export interface PushError {
  type: PushErrorType;      // 错误类型
  message: string;          // 错误消息
  userId?: string;          // 相关用户ID
  timestamp: Date;          // 错误时间
  details?: any;            // 详细信息
}

/**
 * 推送统计信息
 */
export interface PushStats {
  totalPushes: number;      // 总推送数
  successfulPushes: number; // 成功推送数
  failedPushes: number;     // 失败推送数
  activeUsers: number;      // 活跃用户数
  lastPushTime: Date;       // 最后推送时间
  averageResponseTime: number; // 平均响应时间
}

/**
 * 推送缓存键常量
 */
export const PUSH_CACHE_KEYS = {
  USER_SETTINGS: 'push_settings',
  LAST_PUSH_TIME: 'last_push_time',
  PUSH_DATA: 'push_data',
  USER_TOKEN: 'user:token',
  SCHEDULER_STATUS: 'scheduler_status'
} as const;

/**
 * 推送配置常量
 */
export const PUSH_CONSTANTS = {
  // 缓存TTL（秒）
  CACHE_TTL: {
    USER_SETTINGS: 300,     // 5分钟
    PUSH_DATA: 600,         // 10分钟
    USER_TOKEN: 86400,      // 24小时
    LAST_PUSH: 86400        // 24小时
  },
  
  // 推送限制
  LIMITS: {
    MAX_BATCH_SIZE: 100,    // 最大批处理大小
    MAX_RETRIES: 3,         // 最大重试次数
    RETRY_DELAY: 1000,      // 重试延迟（毫秒）
    MESSAGE_DELAY: 100      // 消息间隔（毫秒）
  },
  
  // Cron表达式
  CRON: {
    TEST: '* * * * *',        // 每分钟（开发环境）
    TESTING: '*/2 * * * *',   // 每2分钟（测试环境）
    PRODUCTION: '*/20 * * * *' // 每20分钟（生产环境）
  }
} as const;

/**
 * 推送设置验证规则
 */
export const PUSH_VALIDATION = {
  REQUIRED_FIELDS: ['telegram_id'],
  OPTIONAL_FIELDS: ['flash_enabled', 'whale_enabled', 'fund_enabled'],
  BOOLEAN_FIELDS: ['flash_enabled', 'whale_enabled', 'fund_enabled']
} as const;
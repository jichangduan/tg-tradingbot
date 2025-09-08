/**
 * API相关类型定义
 * 包含与AIW3 API交互所需的所有接口和类型定义
 */

/**
 * 基础API响应接口
 */
export interface BaseApiResponse {
  success: boolean;
  message?: string;
  timestamp?: string;
}

/**
 * 成功响应接口
 */
export interface SuccessApiResponse<T = any> extends BaseApiResponse {
  success: true;
  data: T;
}

/**
 * 错误响应接口
 */
export interface ErrorApiResponse extends BaseApiResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * 联合类型：API响应
 */
export type ApiResponse<T = any> = SuccessApiResponse<T> | ErrorApiResponse;

/**
 * 代币基础信息接口
 */
export interface TokenInfo {
  symbol: string;          // 代币符号 (如: BTC, ETH, SOL)
  name: string;           // 代币全名 (如: Bitcoin, Ethereum)
  mint?: string;          // Solana mint地址 (如果适用)
  decimals?: number;      // 小数位数
  logoUrl?: string;       // 代币图标URL
}

/**
 * 代币价格数据接口
 */
export interface TokenData extends TokenInfo {
  price: number;          // 当前价格 (USD)
  change24h: number;      // 24小时价格变化百分比
  volume24h: number;      // 24小时交易量 (USD)
  marketCap: number;      // 市值 (USD)
  high24h?: number;       // 24小时最高价
  low24h?: number;        // 24小时最低价
  supply?: {
    circulating?: number;  // 流通供应量
    total?: number;        // 总供应量
    max?: number;          // 最大供应量
  };
  updatedAt: Date;        // 数据更新时间
  source: string;         // 数据来源标识
}

/**
 * AIW3 API 代币价格响应接口
 * 基于现有 /api/tokens/:mint/getTokenPriceChange 接口
 */
export interface TokenPriceApiResponse extends BaseApiResponse {
  success: true;
  data: {
    symbol: string;         // 代币符号
    name?: string;          // 代币名称
    price: string | number; // 当前价格
    change24h: string | number; // 24小时涨跌幅
    volume24h: string | number; // 24小时交易量
    market_cap?: string | number; // 市值
    high24h?: string | number;    // 24小时最高价
    low24h?: string | number;     // 24小时最低价
    // 可能的额外字段
    current_price?: string | number;
    price_change_percentage_24h?: string | number;
    total_volume?: string | number;
    circulating_supply?: string | number;
    total_supply?: string | number;
    max_supply?: string | number;
  };
}

/**
 * 代币价格变化趋势
 */
export enum PriceChangeType {
  UP = 'up',
  DOWN = 'down',
  STABLE = 'stable'
}

/**
 * 代币价格趋势数据
 */
export interface TokenPriceTrend {
  type: PriceChangeType;
  percentage: number;
  isSignificant: boolean; // 是否为显著变化（通常>5%）
}

/**
 * 缓存相关类型
 */
export interface CacheMetadata {
  key: string;
  ttl: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 带缓存信息的代币数据
 */
export interface CachedTokenData extends TokenData {
  cache?: CacheMetadata;
  isCached: boolean;
}

/**
 * API请求上下文
 */
export interface ApiRequestContext {
  requestId?: string;
  userId?: number;
  username?: string;
  command?: string;
  timestamp: Date;
}

/**
 * 错误类型枚举
 */
export enum ApiErrorCode {
  // 网络相关错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  
  // API相关错误
  API_KEY_INVALID = 'API_KEY_INVALID',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  
  // 数据相关错误
  TOKEN_NOT_FOUND = 'TOKEN_NOT_FOUND',
  INVALID_SYMBOL = 'INVALID_SYMBOL',
  DATA_UNAVAILABLE = 'DATA_UNAVAILABLE',
  
  // 服务器错误
  SERVER_ERROR = 'SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  
  // 通用错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * 详细错误信息接口
 */
export interface DetailedError {
  code: ApiErrorCode;
  message: string;
  statusCode?: number;
  retryable: boolean;
  context?: {
    symbol?: string;
    endpoint?: string;
    timestamp: Date;
  };
}

/**
 * 服务健康状态
 */
export interface ServiceHealth {
  api: boolean;
  cache: boolean;
  overall: boolean;
  lastCheck: Date;
  details?: {
    apiLatency?: number;
    cacheLatency?: number;
    errors?: DetailedError[];
  };
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  requestCount: number;
  averageResponseTime: number;
  cacheHitRate: number;
  errorRate: number;
  period: {
    start: Date;
    end: Date;
  };
}

/**
 * 支持的代币符号类型
 */
export type SupportedTokenSymbol = 
  | 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'USDC' | 'BNB'
  | 'ADA' | 'DOT' | 'LINK' | 'MATIC' | 'AVAX' | 'UNI'
  | string; // 允许其他代币符号

/**
 * 代币符号验证结果
 */
export interface TokenSymbolValidation {
  isValid: boolean;
  normalized: string; // 标准化后的符号（大写）
  suggestions?: string[]; // 如果无效，提供建议
  error?: string;
}

/**
 * 格式化选项
 */
export interface FormatOptions {
  currency: 'USD' | 'BTC' | 'ETH';
  precision: number;
  compact: boolean; // 是否使用紧凑格式 (1.2K, 1.5M)
  showSymbol: boolean;
}

/**
 * 消息格式化数据
 */
export interface MessageFormatData {
  token: TokenData;
  trend: TokenPriceTrend;
  formatOptions?: Partial<FormatOptions>;
  template?: 'default' | 'compact' | 'detailed';
}

/**
 * 用户上下文（Telegram相关）
 */
export interface TelegramUserContext {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  is_premium?: boolean;
}

/**
 * 用户初始化请求接口
 */
export interface UserInitRequest {
  telegram_id: string;          // Telegram用户ID (必需)
  username?: string;            // Telegram用户名 (可选)
  first_name?: string;          // 用户名字 (可选)  
  last_name?: string;           // 用户姓氏 (可选)
  photo_url?: string;           // 用户头像URL (可选)
  invitation_code?: string;     // 邀请码 (可选)
}

/**
 * 用户初始化响应数据接口
 */
export interface UserInitData {
  userId: number;               // 用户ID
  walletAddress: string;        // 钱包地址
  nickname: string;             // 昵称
  profilePhotoUrl: string;      // 头像URL
  referralCode: string;         // 推荐码
  energy: number;               // 能量值
  isNewUser: boolean;           // 是否新用户
  accessToken: string;          // 访问令牌 (用于后续API调用)
}

/**
 * 用户初始化API响应接口
 */
export interface UserInitApiResponse extends BaseApiResponse {
  code: number;
  message: string;
  data: UserInitData;
}

/**
 * 链上代币余额数据接口
 */
export interface TokenBalance {
  mint: string;               // 代币mint地址
  symbol: string;             // 代币符号 (SOL, USDT, USDC)
  name: string;               // 代币全名
  balance: string;            // 余额 (原始单位)
  decimals: number;           // 小数位数
  uiAmount: number;           // UI显示金额
  usdValue?: number;          // USD价值 (可选)
}

/**
 * Solana钱包余额数据接口
 */
export interface SolanaWalletBalance {
  address: string;            // 钱包地址
  solBalance: number;         // SOL余额
  tokenBalances: TokenBalance[]; // 代币余额列表
  totalUsdValue: number;      // 总USD价值
  lastUpdated: Date;          // 最后更新时间
}

/**
 * Solana RPC响应接口
 */
export interface SolanaRPCResponse<T = any> {
  jsonrpc: string;
  id: number;
  result: T;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * 格式化后的钱包余额接口 (重新设计为链上版本)
 */
export interface FormattedWalletBalance {
  address: string;            // 钱包地址
  network: 'solana' | 'ethereum' | 'arbitrum' | 'hyperliquid'; // 网络类型
  nativeBalance: number;      // 主币余额 (SOL/ETH/USDC)
  nativeSymbol: string;       // 主币符号
  tokenBalances: TokenBalance[]; // 代币余额
  totalUsdValue: number;      // 总USD价值
  withdrawableAmount?: number; // 可提取金额 (仅限Hyperliquid)
  lastUpdated: Date;          // 最后更新时间
}

// 保留旧的交易所账户接口以防兼容性需要
/**
 * 交易所账户余额数据接口 (已弃用 - 用于交易所账户)
 */
export interface AccountBalanceData {
  uTime: string;              // 更新时间戳
  totalEq: string;            // 总权益
  isoEq: string;              // 逐仓权益
  adjEq: string;              // 调整后权益
  availEq: string;            // 可用权益
  ordFroz: string;            // 订单冻结金额
  imr: string;                // 初始保证金
  mmr: string;                // 维持保证金
  mgnRatio: string;           // 保证金率
  notionalUsd: string;        // 名义价值USD
}

/**
 * 交易所账户余额API响应接口 (已弃用)
 */
export interface AccountBalanceApiResponse extends BaseApiResponse {
  code: string;
  message: string;
  data: AccountBalanceData[];
}

/**
 * 旧版格式化账户余额接口 (已弃用 - 用于交易所账户)
 */
export interface FormattedAccountBalance {
  totalEquity: number;        // 总权益(数值)
  availableEquity: number;    // 可用权益(数值)
  orderFrozen: number;        // 冻结金额(数值)
  adjustedEquity: number;     // 调整权益(数值)
  utilizationRate: number;    // 资金使用率(百分比)
  lastUpdated: Date;          // 最后更新时间
  currency: string;           // 币种(USDT)
}

/**
 * 命令处理上下文
 */
export interface CommandContext {
  user: TelegramUserContext;
  command: string;
  args: string[];
  timestamp: Date;
  chatId: number;
  messageId?: number;
}

/**
 * 类型保护函数接口
 */
export interface TypeGuards {
  isSuccessResponse<T>(response: ApiResponse<T>): response is SuccessApiResponse<T>;
  isErrorResponse(response: ApiResponse): response is ErrorApiResponse;
  isValidTokenData(data: any): data is TokenData;
  isValidTokenSymbol(symbol: any): symbol is SupportedTokenSymbol;
}

/**
 * 实用工具类型
 */
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type AsyncResult<T> = Promise<T>;

/**
 * 分页相关类型
 */
export interface PaginationParams {
  page: number;
  limit: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * 排序相关类型
 */
export interface SortParams {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * 查询过滤器
 */
export interface TokenQueryFilter {
  symbols?: string[];
  minPrice?: number;
  maxPrice?: number;
  minVolume?: number;
  minMarketCap?: number;
  sort?: SortParams;
  pagination?: PaginationParams;
}

/**
 * 邀请记录接口
 */
export interface InviteRecord {
  wallet_address: string;    // 被邀请用户的钱包地址
  createdAt: number;         // 邀请时间戳
}

/**
 * 邀请统计数据接口 (标准化)
 */
export interface InviteStatsData {
  inviteRecord: InviteRecord[];    // 邀请记录列表
  page: number;                    // 当前页码
  pageSize: number;                // 每页记录数
  totalPages: number;              // 总页数
  totalRecords: number;            // 总邀请用户数量
  totalTradingVolume: number;      // 总交易量
}

/**
 * 邀请统计原始数据接口 (支持字符串和数字类型以提高API兼容性)
 */
export interface RawInviteStatsData {
  inviteRecord: InviteRecord[];           // 邀请记录列表
  page?: number | string;                 // 当前页码 (可选，API可能返回字符串)
  pageSize?: number | string;             // 每页记录数 (可选)
  totalPages?: number | string;           // 总页数 (可选)
  totalRecords: number | string;          // 总邀请用户数量 (必需)
  totalTradingVolume: number | string;    // 总交易量 (必需)
}

/**
 * 邀请统计API响应接口 (标准化)
 */
export interface InviteStatsApiResponse extends BaseApiResponse {
  code: number;
  data: InviteStatsData;
  message?: string;
}

/**
 * 邀请统计原始API响应接口 (支持灵活的数据类型)
 */
export interface RawInviteStatsApiResponse extends BaseApiResponse {
  code: number | string;
  data: RawInviteStatsData;
  message?: string;
}

/**
 * 格式化后的邀请统计接口
 */
export interface FormattedInviteStats {
  inviteeCount: number;            // 邀请人数
  totalTradingVolume: number;      // 总交易量
  currentPoints: number;           // 当前积分 (交易量/100)
  inviteRecords: InviteRecord[];   // 邀请记录
  pagination: {
    page: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  lastUpdated: Date;               // 最后更新时间
}

/**
 * K线数据相关接口
 */
export interface CandleData {
  open: number;          // 开盘价
  high: number;          // 最高价
  low: number;           // 最低价
  close: number;         // 收盘价
  volume: number;        // 成交量
  timestamp: number;     // 时间戳
}

/**
 * 支持的时间框架
 */
export type TimeFrame = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

/**
 * K线数据请求参数
 */
export interface CandleRequestParams {
  coin: string;          // 交易对符号 (API使用 coin 参数)
  interval: TimeFrame;   // 时间框架 (必需，告诉API返回哪个时间框架的数据)
  limit?: number;        // 返回数据条数 (默认20，针对指定时间框架)
}

/**
 * K线数据API响应接口
 */
export interface CandleApiResponse extends BaseApiResponse {
  success: true;
  data: CandleData[];
}

/**
 * 格式化K线数据接口
 */
export interface FormattedCandleData {
  symbol: string;
  timeFrame: TimeFrame;
  candles: CandleData[];
  latestPrice: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  updatedAt: Date;
}

/**
 * 带缓存信息的K线数据
 */
export interface CachedCandleData extends FormattedCandleData {
  cache?: CacheMetadata;
  isCached: boolean;
}

// 导出所有类型的联合类型（用于类型检查）
export type AllApiTypes = 
  | BaseApiResponse 
  | SuccessApiResponse 
  | ErrorApiResponse
  | TokenInfo 
  | TokenData 
  | TokenPriceApiResponse
  | CachedTokenData
  | DetailedError
  | ServiceHealth
  | PerformanceMetrics
  | CommandContext
  | TelegramUserContext
  | CandleData
  | CandleApiResponse
  | FormattedCandleData
  | CachedCandleData;
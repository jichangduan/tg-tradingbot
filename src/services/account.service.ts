import { solanaService } from './solana.service';
import { userService } from './user.service';
import { logger } from '../utils/logger';
import { 
  FormattedWalletBalance,
  DetailedError, 
  ApiErrorCode 
} from '../types/api.types';

/**
 * 账户服务类 (重新设计为链上钱包服务)
 * 处理链上钱包相关的查询，包括余额查询、代币信息等
 */
export class AccountService {
  /**
   * 获取用户钱包余额 (链上查询)
   * 
   * @param telegramId Telegram用户ID
   * @returns 格式化的钱包余额信息
   * @throws DetailedError 当查询失败时
   */
  public async getAccountBalance(telegramId: string): Promise<FormattedWalletBalance> {
    const startTime = Date.now();
    const requestId = `wallet_balance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // 参数验证
      this.validateTelegramId(telegramId);

      logger.info(`Wallet balance query started [${requestId}]`, {
        telegramId,
        requestId
      });

      // 步骤1: 通过telegram_id获取用户信息和钱包地址
      const userInitRequest = { telegram_id: telegramId };
      const userData = await userService.initializeUser(userInitRequest);
      
      if (!userData.walletAddress) {
        throw this.createDetailedError(
          ApiErrorCode.TOKEN_NOT_FOUND,
          'User wallet address not found',
          '未找到用户钱包地址，请先完成账户初始化'
        );
      }

      // 步骤2: 查询链上钱包余额
      const walletBalance = await solanaService.getWalletBalance(userData.walletAddress);

      const duration = Date.now() - startTime;
      logger.info(`Wallet balance query successful [${requestId}] - ${duration}ms`, {
        telegramId,
        walletAddress: userData.walletAddress,
        nativeBalance: walletBalance.nativeBalance,
        tokenCount: walletBalance.tokenBalances.length,
        totalUsdValue: walletBalance.totalUsdValue,
        duration,
        requestId
      });

      // 记录性能指标
      logger.logPerformance('wallet_balance_success', duration, {
        telegramId,
        requestId
      });

      return walletBalance;

    } catch (error) {
      const duration = Date.now() - startTime;
      const detailedError = this.handleServiceError(error, requestId);
      
      logger.error(`Wallet balance query failed [${requestId}] - ${duration}ms`, {
        telegramId,
        errorCode: detailedError.code,
        errorMessage: detailedError.message,
        duration,
        requestId
      });

      throw detailedError;
    }
  }

  /**
   * 检查钱包是否有足够余额进行交易
   */
  public async checkSufficientBalance(
    telegramId: string, 
    requiredAmount: number,
    tokenSymbol: string = 'SOL'
  ): Promise<boolean> {
    try {
      const balance = await this.getAccountBalance(telegramId);
      
      if (tokenSymbol === 'SOL') {
        return balance.nativeBalance >= requiredAmount;
      } else {
        const token = balance.tokenBalances.find(t => t.symbol === tokenSymbol);
        return token ? token.uiAmount >= requiredAmount : false;
      }
    } catch (error) {
      logger.warn('Failed to check balance for trading', {
        telegramId,
        requiredAmount,
        tokenSymbol,
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * 验证Telegram ID
   */
  private validateTelegramId(telegramId: string): void {
    if (!telegramId) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL,
        'telegram_id is required',
        'Telegram用户ID不能为空'
      );
    }

    // 验证telegram_id格式（应为数字字符串）
    if (!/^\d+$/.test(telegramId)) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL,
        'Invalid telegram_id format',
        'Telegram用户ID格式不正确'
      );
    }
  }

  /**
   * 获取余额警告信息
   */
  public getBalanceWarnings(balance: FormattedWalletBalance): string[] {
    const warnings: string[] = [];

    // SOL余额过低警告
    if (balance.nativeBalance < 0.01) {
      warnings.push('⚠️ SOL余额不足0.01，可能影响交易手续费支付');
    }

    // 总价值过低警告
    if (balance.totalUsdValue < 10) {
      warnings.push('⚠️ 钱包总价值低于$10，建议充值后进行交易');
    }

    // 空钱包警告
    if (balance.nativeBalance === 0 && balance.tokenBalances.length === 0) {
      warnings.push('📭 钱包暂无资产，请先转入资金');
    }

    return warnings;
  }

  /**
   * 处理服务错误，转换为统一的详细错误格式
   */
  private handleServiceError(error: any, requestId: string): DetailedError {
    // 如果已经是DetailedError，直接返回
    if (error && typeof error.code === 'string' && typeof error.message === 'string' && error.retryable !== undefined) {
      return error as DetailedError;
    }

    // 处理网络错误
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return this.createDetailedError(
        ApiErrorCode.NETWORK_ERROR,
        error.message,
        '网络连接失败，请检查网络连接'
      );
    }

    // 处理超时错误
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return this.createDetailedError(
        ApiErrorCode.TIMEOUT_ERROR,
        error.message,
        '请求超时，请稍后重试'
      );
    }

    // 处理HTTP状态码错误
    if (error.status || error.statusCode) {
      const status = error.status || error.statusCode;
      const message = error.response?.data?.message || error.message;

      switch (status) {
        case 400:
          return this.createDetailedError(
            ApiErrorCode.INVALID_SYMBOL,
            message,
            '请求参数错误，请检查用户信息'
          );
        case 401:
          return this.createDetailedError(
            ApiErrorCode.UNAUTHORIZED,
            message,
            'API认证失败，请联系管理员'
          );
        case 403:
          return this.createDetailedError(
            ApiErrorCode.FORBIDDEN,
            message,
            '访问权限不足'
          );
        case 404:
          return this.createDetailedError(
            ApiErrorCode.TOKEN_NOT_FOUND,
            message,
            '未找到账户信息，请先完成交易账户初始化'
          );
        case 429:
          return this.createDetailedError(
            ApiErrorCode.RATE_LIMIT_EXCEEDED,
            message,
            '请求过于频繁，请稍后重试'
          );
        case 500:
        case 502:
        case 503:
        case 504:
          return this.createDetailedError(
            ApiErrorCode.SERVER_ERROR,
            message,
            '服务器内部错误，请稍后重试'
          );
        default:
          return this.createDetailedError(
            ApiErrorCode.UNKNOWN_ERROR,
            message || error.message,
            `服务异常 (${status})`
          );
      }
    }

    // 默认错误处理
    return this.createDetailedError(
      ApiErrorCode.UNKNOWN_ERROR,
      error.message || 'Unknown error',
      '账户余额查询失败，请稍后重试'
    );
  }

  /**
   * 创建详细错误对象
   */
  private createDetailedError(
    code: ApiErrorCode,
    originalMessage: string,
    userFriendlyMessage: string,
    retryable: boolean = true
  ): DetailedError {
    return {
      code,
      message: userFriendlyMessage,
      statusCode: undefined,
      retryable,
      context: {
        endpoint: 'on-chain-wallet-balance',
        timestamp: new Date()
      }
    };
  }


  /**
   * 健康检查 - 测试钱包服务连接状态
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 检查Solana服务和用户服务的健康状态
      const [solanaHealthy, userHealthy] = await Promise.all([
        solanaService.healthCheck(),
        userService.healthCheck().catch(() => false)
      ]);
      
      return solanaHealthy && userHealthy;
    } catch (error) {
      logger.warn('Account service health check failed', { 
        error: (error as Error).message 
      });
      return false;
    }
  }

  /**
   * 获取服务统计信息
   */
  public getStats(): any {
    return {
      name: 'AccountService',
      version: '2.0.0',
      type: 'On-chain Wallet Service',
      supportedNetworks: ['solana'],
      features: [
        'On-chain wallet balance query',
        'Multi-token balance support',
        'Real-time balance updates',
        'USD value calculation',
        'Balance validation',
        'Risk warnings',
        'Comprehensive error handling'
      ]
    };
  }
}

// 导出单例实例
export const accountService = new AccountService();

// 默认导出
export default accountService;
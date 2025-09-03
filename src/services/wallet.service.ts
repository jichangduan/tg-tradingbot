import { 
  getUserWallet, 
  getUserHyperliquidBalance, 
  getUserContractBalance,
  IUserWalletData,
  IUserBalanceData,
  IUserStateData
} from './hyperliquid.service';
import { userService } from './user.service';
import { logger } from '../utils/logger';
import { 
  FormattedWalletBalance,
  TokenBalance,
  DetailedError, 
  ApiErrorCode 
} from '../types/api.types';

/**
 * 钱包服务适配器
 * 将Hyperliquid服务适配为标准钱包服务接口
 */
export class WalletService {
  /**
   * 获取用户钱包余额 (基于Hyperliquid)
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

      logger.info(`Hyperliquid wallet balance query started [${requestId}]`, {
        telegramId,
        requestId
      });

      // 步骤1: 通过telegram_id获取用户信息
      const userInitRequest = { telegram_id: telegramId };
      const userData = await userService.initializeUser(userInitRequest);
      
      if (!userData.walletAddress) {
        throw this.createDetailedError(
          ApiErrorCode.TOKEN_NOT_FOUND,
          'User wallet address not found',
          '未找到用户钱包地址，请先完成账户初始化'
        );
      }

      // 步骤2: 获取Hyperliquid钱包地址
      const walletData = await getUserWallet();
      if (!walletData || !walletData.tradingwalletaddress) {
        throw this.createDetailedError(
          ApiErrorCode.TOKEN_NOT_FOUND,
          'Hyperliquid wallet not found',
          '未找到Hyperliquid交易钱包，请确保账户已正确初始化'
        );
      }

      // 步骤3: 并行查询现货余额和合约余额
      const [spotBalance, contractBalance] = await Promise.all([
        getUserHyperliquidBalance(1), // 1 = trading wallet
        getUserContractBalance(1)
      ]);

      // 步骤4: 转换为标准格式
      const walletBalance = this.convertToFormattedBalance(
        walletData,
        spotBalance.data,
        contractBalance.data
      );

      const duration = Date.now() - startTime;
      logger.info(`Hyperliquid wallet balance query successful [${requestId}] - ${duration}ms`, {
        telegramId,
        walletAddress: walletData.tradingwalletaddress,
        spotBalance: spotBalance.data?.total,
        contractValue: contractBalance.data?.marginSummary?.accountValue,
        totalUsdValue: walletBalance.totalUsdValue,
        duration,
        requestId
      });

      // 记录性能指标
      logger.logPerformance('hyperliquid_balance_success', duration, {
        telegramId,
        requestId
      });

      return walletBalance;

    } catch (error) {
      const duration = Date.now() - startTime;
      const detailedError = this.handleServiceError(error, requestId);
      
      logger.error(`Hyperliquid wallet balance query failed [${requestId}] - ${duration}ms`, {
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
   * 转换Hyperliquid数据为标准钱包格式
   */
  private convertToFormattedBalance(
    walletData: IUserWalletData,
    spotBalance: IUserBalanceData | undefined,
    contractBalance: IUserStateData
  ): FormattedWalletBalance {
    const tokenBalances: TokenBalance[] = [];
    
    // 添加USDC现货余额
    if (spotBalance && parseFloat(spotBalance.total) > 0) {
      tokenBalances.push({
        mint: 'USDC',
        symbol: 'USDC',
        name: 'USD Coin',
        balance: (parseFloat(spotBalance.total) * 1e6).toString(), // 转换为最小单位
        decimals: 6,
        uiAmount: parseFloat(spotBalance.total),
        usdValue: parseFloat(spotBalance.total)
      });
    }

    // 计算总价值 (现货余额 + 合约账户价值)
    const spotValue = spotBalance ? parseFloat(spotBalance.total) : 0;
    const contractValue = contractBalance?.marginSummary?.accountValue 
      ? parseFloat(contractBalance.marginSummary.accountValue) 
      : 0;
    const totalUsdValue = spotValue + contractValue;

    return {
      address: walletData.tradingwalletaddress,
      network: 'arbitrum', // Hyperliquid运行在Arbitrum上
      nativeBalance: contractValue, // 合约账户余额作为主余额
      nativeSymbol: 'USDC',
      tokenBalances,
      totalUsdValue,
      lastUpdated: new Date()
    };
  }

  /**
   * 检查钱包是否有足够余额进行交易
   */
  public async checkSufficientBalance(
    telegramId: string, 
    requiredAmount: number,
    tokenSymbol: string = 'USDC'
  ): Promise<boolean> {
    try {
      const balance = await this.getAccountBalance(telegramId);
      
      if (tokenSymbol === 'USDC') {
        // 检查现货余额 + 合约余额
        const usdcToken = balance.tokenBalances.find(t => t.symbol === 'USDC');
        const spotBalance = usdcToken ? usdcToken.uiAmount : 0;
        const contractBalance = balance.nativeBalance;
        const totalBalance = spotBalance + contractBalance;
        
        return totalBalance >= requiredAmount;
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
   * 获取余额警告信息
   */
  public getBalanceWarnings(balance: FormattedWalletBalance): string[] {
    const warnings: string[] = [];

    // USDC余额过低警告
    if (balance.totalUsdValue < 10) {
      warnings.push('⚠️ USDC余额低于$10，建议充值后进行交易');
    }

    // 合约账户余额过低警告
    if (balance.nativeBalance < 1) {
      warnings.push('⚠️ 合约账户余额不足$1，可能影响交易执行');
    }

    // 空钱包警告
    if (balance.totalUsdValue === 0) {
      warnings.push('📭 钱包暂无资产，请先转入资金');
    }

    return warnings;
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
        'Hyperliquid网络连接失败，请检查网络连接'
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
            'Hyperliquid API认证失败，请联系管理员'
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
            '未找到Hyperliquid账户信息，请先完成交易账户初始化'
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
            'Hyperliquid服务器内部错误，请稍后重试'
          );
        default:
          return this.createDetailedError(
            ApiErrorCode.UNKNOWN_ERROR,
            message || error.message,
            `Hyperliquid服务异常 (${status})`
          );
      }
    }

    // 默认错误处理
    return this.createDetailedError(
      ApiErrorCode.UNKNOWN_ERROR,
      error.message || 'Unknown error',
      'Hyperliquid钱包余额查询失败，请稍后重试'
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
        endpoint: 'hyperliquid-wallet-balance',
        timestamp: new Date()
      }
    };
  }

  /**
   * 健康检查 - 测试Hyperliquid服务连接状态
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 简单的连接测试
      await getUserWallet();
      return true;
    } catch (error) {
      logger.warn('Hyperliquid wallet service health check failed', { 
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
      name: 'WalletService',
      version: '1.0.0',
      type: 'Hyperliquid Wallet Service',
      supportedNetworks: ['arbitrum', 'hyperliquid'],
      features: [
        'Hyperliquid wallet balance query',
        'Spot and contract balance support',
        'USDC balance tracking',
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
export const walletService = new WalletService();

// 默认导出
export default walletService;
import { 
  getUserWallet, 
  getUserHyperliquidBalance, 
  getUserContractBalance,
  getUserActiveAssetData,
  createUserHyperliquidWallet,
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

      logger.debug(`🔎 Starting wallet balance query for ${telegramId}`);

      // 步骤1: 获取Hyperliquid钱包地址，如果不存在则自动创建
      let walletData = await getUserWallet(telegramId);
      
      if (!walletData?.tradingwalletaddress) {
        logger.debug(`🔒 No wallet found, creating new one`);
      }
      
      // 如果钱包不存在，尝试创建新钱包
      if (!walletData || !walletData.tradingwalletaddress) {
        logger.debug(`🔒 Creating Hyperliquid wallet for user ${telegramId}`);
        
        // 尝试创建钱包
        const createdWallet = await createUserHyperliquidWallet(telegramId);
        if (createdWallet && createdWallet.tradingwalletaddress) {
          walletData = createdWallet;
          logger.debug(`✅ Created wallet: ${createdWallet.tradingwalletaddress}`);
        } else {
          throw this.createDetailedError(
            ApiErrorCode.TOKEN_NOT_FOUND,
            'Failed to create Hyperliquid wallet',
            'Failed to create Hyperliquid trading wallet, please try again later or contact administrator'
          );
        }
      }

      // 步骤2: 并行查询现货余额和合约余额
      const [spotBalance, contractBalance] = await Promise.all([
        getUserHyperliquidBalance(1, telegramId), // 1 = trading wallet
        getUserContractBalance(1, telegramId)
      ]);

      // 简化API结果日志
      const spotValue = spotBalance?.data?.total ? parseFloat(spotBalance.data.total) : 0;
      const contractValue = parseFloat(contractBalance?.data?.marginSummary?.accountValue || '0');
      logger.debug(`💰 API results: spot=$${spotValue.toFixed(2)}, contract=$${contractValue.toFixed(2)}`);

      // 步骤3: 转换为标准格式
      const walletBalance = this.convertToFormattedBalance(
        walletData,
        spotBalance.data,
        contractBalance.data,
        telegramId
      );

      const duration = Date.now() - startTime;
      // 简化成功日志
      logger.debug(`⚡ Balance query successful: ${duration}ms - total: $${walletBalance.totalUsdValue.toFixed(2)}`);

      return walletBalance;

    } catch (error) {
      const duration = Date.now() - startTime;
      const detailedError = this.handleServiceError(error, 'wallet_balance');
      
      logger.error(`❌ Wallet balance query failed - ${duration}ms: ${detailedError.message}`);

      throw detailedError;
    }
  }

  /**
   * 转换Hyperliquid数据为标准钱包格式
   */
  private convertToFormattedBalance(
    walletData: IUserWalletData,
    spotBalance: IUserBalanceData | undefined,
    contractBalance: IUserStateData,
    telegramId?: string
  ): FormattedWalletBalance {
    const tokenBalances: TokenBalance[] = [];
    
    // 解析现货余额
    const spotValue = spotBalance ? parseFloat(spotBalance.total || "0") : 0;
    
    // 总是添加USDC现货余额，即使为0也要显示
    tokenBalances.push({
      mint: 'USDC',
      symbol: 'USDC',
      name: 'USD Coin',
      balance: spotValue.toString(), // 直接使用USDC金额
      decimals: 6,
      uiAmount: spotValue,
      usdValue: spotValue
    });

    // 从嵌套结构中提取合约账户价值 - 需要类型断言
    const contractData = contractBalance as any; // 临时类型断言
    const contractAccountValue = contractData?.data?.data?.marginSummary?.accountValue || 
                                 contractData?.data?.marginSummary?.accountValue ||
                                 contractData?.marginSummary?.accountValue ||
                                 "0";
    const contractValue = parseFloat(contractAccountValue);
    
    // 提取可提取金额
    const withdrawableAmount = contractData?.data?.data?.withdrawable ||
                              contractData?.data?.withdrawable ||
                              contractData?.withdrawable ||
                              "0";

    // 提取数据结构
    const rawContractData = contractData?.data?.data || contractData?.data || contractData;
    const assetPositions = rawContractData?.assetPositions || [];
    const marginSummary = rawContractData?.marginSummary || {};
    
    // 简化日志：只记录关键余额信息
    logger.debug(`💰 Balance: contract=$${contractValue.toFixed(2)}, withdrawable=$${parseFloat(withdrawableAmount).toFixed(2)}, positions=${assetPositions.length}`);

    // 计算总价值和保证金
    const totalUsdValue = spotValue + contractValue;
    const withdrawableAmountNum = parseFloat(withdrawableAmount);
    const hyperliquidMarginUsed = parseFloat(marginSummary.totalMarginUsed || "0");
    const calculatedOccupiedMargin = contractValue - withdrawableAmountNum;
    const occupiedMargin = hyperliquidMarginUsed > 0 ? hyperliquidMarginUsed : calculatedOccupiedMargin;

    return {
      address: walletData.tradingwalletaddress,
      network: 'arbitrum', // Hyperliquid运行在Arbitrum上
      nativeBalance: contractValue, // 合约账户余额作为主余额
      nativeSymbol: 'USDC',
      tokenBalances,
      totalUsdValue,
      withdrawableAmount: withdrawableAmountNum, // 可提取金额
      lastUpdated: new Date()
    };
  }

  /**
   * 检查钱包是否有足够余额进行交易
   * 根据杠杆倍数决定检查现货余额还是合约余额
   */
  public async checkSufficientBalance(
    telegramId: string, 
    requiredAmount: number,
    tokenSymbol: string = 'USDC',
    leverage: number = 1
  ): Promise<boolean> {
    try {
      const balance = await this.getAccountBalance(telegramId);
      
      if (tokenSymbol === 'USDC') {
        if (leverage > 1) {
          // 杠杆交易：检查合约账户可用保证金
          const availableMargin = balance.withdrawableAmount || 0;
          const requiredMargin = requiredAmount / leverage; // 保证金需求
          
          logger.info('Leveraged trading balance check', {
            telegramId,
            leverage,
            requiredAmount,
            requiredMargin,
            availableMargin,
            sufficient: availableMargin >= requiredMargin
          });
          
          return availableMargin >= requiredMargin;
        } else {
          // 现货交易：检查现货余额
          const usdcToken = balance.tokenBalances.find(t => t.symbol === 'USDC');
          const spotBalance = usdcToken ? usdcToken.uiAmount : 0;
          
          logger.info('Spot trading balance check', {
            telegramId,
            leverage,
            requiredAmount,
            spotBalance,
            sufficient: spotBalance >= requiredAmount
          });
          
          return spotBalance >= requiredAmount;
        }
      } else {
        const token = balance.tokenBalances.find(t => t.symbol === tokenSymbol);
        return token ? token.uiAmount >= requiredAmount : false;
      }
    } catch (error) {
      logger.warn('Failed to check balance for trading', {
        telegramId,
        requiredAmount,
        tokenSymbol,
        leverage,
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * 检查合约账户是否有足够的可用保证金进行杠杆交易
   */
  public async checkAvailableMargin(
    telegramId: string,
    requiredAmount: number,
    leverage: number
  ): Promise<{sufficient: boolean, availableMargin: number, requiredMargin: number, reason?: string}> {
    try {
      // 简化日志：只记录关键的余额检查开始
      logger.debug(`💰 Margin check: $${requiredAmount} @ ${leverage}x`);
      
      const balance = await this.getAccountBalance(telegramId);
      
      // 计算保证金需求
      const availableMargin = balance.withdrawableAmount || 0;
      const requiredMargin = requiredAmount / leverage;
      
      const result = {
        sufficient: availableMargin >= requiredMargin,
        availableMargin,
        requiredMargin,
        reason: undefined as string | undefined
      };
      
      // 分析失败原因 - 简化日志
      if (!result.sufficient) {
        if (balance.nativeBalance === 0) {
          result.reason = 'no_funds';
          logger.debug(`❌ No funds: $0 available`);
        } else if (balance.nativeBalance > 0 && availableMargin < requiredMargin) {
          result.reason = 'margin_occupied';
          logger.debug(`❌ Margin occupied: need $${requiredMargin.toFixed(2)}, have $${availableMargin.toFixed(2)}`);
        } else {
          result.reason = 'insufficient_margin';
          logger.debug(`❌ Insufficient margin: total $${balance.nativeBalance.toFixed(2)} < required $${requiredMargin.toFixed(2)}`);
        }
      } else {
        logger.debug(`✅ Margin sufficient: $${availableMargin.toFixed(2)} >= $${requiredMargin.toFixed(2)}`);
      }
      
      return result;
      
    } catch (error) {
      logger.error(`💥 Margin check error: ${(error as Error).message}`);
      
      return {
        sufficient: false,
        availableMargin: 0,
        requiredMargin: requiredAmount / leverage,
        reason: 'check_failed'
      };
    }
  }

  /**
   * 获取余额警告信息
   */
  public getBalanceWarnings(balance: FormattedWalletBalance): string[] {
    const warnings: string[] = [];

    // USDC balance too low warning
    if (balance.totalUsdValue < 10) {
      warnings.push('⚠️ USDC balance below $10, recommend depositing before trading');
    }

    // Contract account balance too low warning  
    if (balance.nativeBalance < 1) {
      warnings.push('⚠️ Contract account balance below $1, may affect trade execution');
    }

    // Empty wallet warning
    if (balance.totalUsdValue === 0) {
      warnings.push('📭 Wallet has no assets, please deposit funds first');
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
        'Telegram user ID cannot be empty'
      );
    }

    // 验证telegram_id格式（应为数字字符串）
    if (!/^\d+$/.test(telegramId)) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL,
        'Invalid telegram_id format',
        'Invalid Telegram user ID format'
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
        '🌐 <b>Network Connection Failed</b>\n\nPlease execute <code>/start</code> command first to ensure your account status is normal, then retry wallet query.\n\n📶 Please check your network connection.',
        true
      );
    }

    // 处理超时错误
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return this.createDetailedError(
        ApiErrorCode.TIMEOUT_ERROR,
        error.message,
        '⏰ <b>Request Timeout</b>\n\nService response is slow, recommend executing <code>/start</code> command first to refresh account status, then retry.\n\n🔄 Please try wallet query again later.',
        true
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
            'Request parameter error, please check user information'
          );
        case 401:
          return this.createDetailedError(
            ApiErrorCode.UNAUTHORIZED,
            message,
            'Hyperliquid API authentication failed, please contact administrator'
          );
        case 403:
          return this.createDetailedError(
            ApiErrorCode.FORBIDDEN,
            message,
            'Insufficient access permissions'
          );
        case 404:
          return this.createDetailedError(
            ApiErrorCode.TOKEN_NOT_FOUND,
            message,
            '👤 <b>Account Not Initialized</b>\n\nPlease execute <code>/start</code> command first to initialize your account and create trading wallet.\n\n🚀 You can view wallet balance after initialization is complete.',
            false
          );
        case 429:
          return this.createDetailedError(
            ApiErrorCode.RATE_LIMIT_EXCEEDED,
            message,
            'Requests too frequent, please try again later'
          );
        case 500:
        case 502:
        case 503:
        case 504:
          return this.createDetailedError(
            ApiErrorCode.SERVER_ERROR,
            message,
            '🔧 <b>Service Initializing</b>\n\nPlease execute <code>/start</code> command first to initialize your account, then retry wallet query.\n\n💡 If the problem persists, please try again later or contact administrator.',
            true
          );
        default:
          return this.createDetailedError(
            ApiErrorCode.UNKNOWN_ERROR,
            message || error.message,
            `Hyperliquid service error (${status})`
          );
      }
    }

    // 默认错误处理
    return this.createDetailedError(
      ApiErrorCode.UNKNOWN_ERROR,
      error.message || 'Unknown error',
      '❌ <b>Wallet Query Failed</b>\n\nPlease execute <code>/start</code> command first to reinitialize your account.\n\n🔄 If the problem persists, please try again later or contact administrator.',
      true
    );
  }

  /**
   * 创建详细错误对象
   */
  private createDetailedError(
    code: ApiErrorCode,
    _originalMessage: string,
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
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

      logger.info(`Hyperliquid wallet balance query started [${requestId}]`, {
        telegramId,
        requestId
      });

      // 步骤1: 获取Hyperliquid钱包地址，如果不存在则自动创建
      let walletData = await getUserWallet(telegramId);
      
      logger.info(`User wallet query result [${requestId}]`, {
        telegramId,
        walletFound: !!walletData,
        hasTradingWallet: !!(walletData?.tradingwalletaddress),
        tradingWallet: walletData?.tradingwalletaddress,
        requestId
      });
      
      // 如果钱包不存在，尝试创建新钱包
      if (!walletData || !walletData.tradingwalletaddress) {
        logger.info(`Hyperliquid wallet not found for user ${telegramId}, attempting to create new wallet`, {
          telegramId,
          requestId
        });
        
        // 尝试创建钱包
        const createdWallet = await createUserHyperliquidWallet(telegramId);
        if (createdWallet && createdWallet.tradingwalletaddress) {
          walletData = createdWallet;
          logger.info(`Successfully created Hyperliquid wallet for user ${telegramId}`, {
            telegramId,
            tradingWallet: createdWallet.tradingwalletaddress,
            requestId
          });
        } else {
          throw this.createDetailedError(
            ApiErrorCode.TOKEN_NOT_FOUND,
            'Failed to create Hyperliquid wallet',
            '无法创建Hyperliquid交易钱包，请稍后重试或联系管理员'
          );
        }
      }

      // 步骤2: 并行查询现货余额和合约余额
      const [spotBalance, contractBalance] = await Promise.all([
        getUserHyperliquidBalance(1, telegramId), // 1 = trading wallet
        getUserContractBalance(1, telegramId)
      ]);

      // 记录API返回结果用于调试
      logger.info(`Hyperliquid balance APIs result for ${telegramId}`, {
        telegramId,
        spotBalance: {
          success: !!spotBalance,
          data: spotBalance?.data,
          coin: spotBalance?.data?.coin,
          total: spotBalance?.data?.total
        },
        contractBalance: {
          success: !!contractBalance,
          data: contractBalance?.data,
          accountValue: contractBalance?.data?.marginSummary?.accountValue
        },
        requestId
      });

      // 步骤3: 转换为标准格式
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

    // 🔍 详细分析Hyperliquid合约数据结构
    const rawContractData = contractData?.data?.data || contractData?.data || contractData;
    const assetPositions = rawContractData?.assetPositions || [];
    const marginSummary = rawContractData?.marginSummary || {};
    const crossMarginSummary = rawContractData?.crossMarginSummary || {};
    
    // 记录完整的合约余额数据分析
    logger.info(`🔍 Hyperliquid contract balance analysis`, {
      telegramId,
      walletAddress: walletData.tradingwalletaddress,
      
      // 原始数据结构
      rawDataStructure: {
        hasDataData: !!(contractData?.data?.data),
        hasData: !!(contractData?.data),
        topLevelKeys: contractData ? Object.keys(contractData) : [],
        dataLevelKeys: contractData?.data ? Object.keys(contractData.data) : [],
        dataDataLevelKeys: rawContractData ? Object.keys(rawContractData) : []
      },
      
      // 账户价值分析
      accountValues: {
        contractAccountValue,
        contractValueParsed: contractValue,
        withdrawableAmount,
        withdrawableAmountParsed: parseFloat(withdrawableAmount),
        calculatedOccupiedMargin: contractValue - parseFloat(withdrawableAmount)
      },
      
      // 保证金详情分析
      marginAnalysis: {
        marginSummary: {
          accountValue: marginSummary.accountValue,
          totalMarginUsed: marginSummary.totalMarginUsed,
          totalNtlPos: marginSummary.totalNtlPos,
          totalRawUsd: marginSummary.totalRawUsd
        },
        crossMarginSummary: {
          accountValue: crossMarginSummary.accountValue,
          totalMarginUsed: crossMarginSummary.totalMarginUsed,
          totalNtlPos: crossMarginSummary.totalNtlPos,
          totalRawUsd: crossMarginSummary.totalRawUsd
        },
        crossMaintenanceMarginUsed: rawContractData?.crossMaintenanceMarginUsed
      },
      
      // 🎯 持仓分析 - 关键数据！
      positionsAnalysis: {
        assetPositionsCount: assetPositions.length,
        assetPositions: assetPositions,
        hasPositions: assetPositions.length > 0
      },
      
      // 其他字段分析
      otherFields: {
        time: rawContractData?.time,
        allAvailableFields: rawContractData ? Object.keys(rawContractData) : []
      },
      
      // 现货余额对比
      spotComparison: {
        spotValue,
        spotBalance: spotBalance
      }
    });

    // 计算总价值 (现货余额 + 合约账户价值)
    const totalUsdValue = spotValue + contractValue;
    const withdrawableAmountNum = parseFloat(withdrawableAmount);
    
    // 🔧 改进的保证金占用计算 - 优先使用Hyperliquid原生数据
    const hyperliquidMarginUsed = parseFloat(marginSummary.totalMarginUsed || "0");
    const calculatedOccupiedMargin = contractValue - withdrawableAmountNum;
    
    // 选择更准确的保证金占用值
    const occupiedMargin = hyperliquidMarginUsed > 0 ? hyperliquidMarginUsed : calculatedOccupiedMargin;

    // 🔍 保证金占用逻辑验证 - 改进后的分析
    logger.info(`💰 Margin occupation analysis (improved)`, {
      telegramId,
      
      // 改进后的计算方法
      improvedCalculations: {
        contractValue,
        withdrawableAmount: withdrawableAmountNum,
        hyperliquidMarginUsed,
        calculatedOccupiedMargin,
        finalOccupiedMargin: occupiedMargin,
        useHyperliquidValue: hyperliquidMarginUsed > 0,
        occupiedPercentage: contractValue > 0 ? ((occupiedMargin / contractValue) * 100).toFixed(2) + '%' : '0%'
      },
      
      // 逻辑验证
      validationChecks: {
        hasContractValue: contractValue > 0,
        hasWithdrawable: withdrawableAmountNum > 0,
        hasOccupiedMargin: occupiedMargin > 0,
        occupiedMoreThanHalf: occupiedMargin > (contractValue * 0.5),
        
        // 关键检查：使用Hyperliquid原生数据更准确判断
        positionMarginConsistency: {
          hasPositions: assetPositions.length > 0,
          hasMarginUsed: hyperliquidMarginUsed > 0,
          consistencyCheck: (assetPositions.length > 0) === (hyperliquidMarginUsed > 0),
          possibleInconsistency: (assetPositions.length === 0) && (hyperliquidMarginUsed > 10)
        }
      },
      
      // Hyperliquid原生数据验证
      hyperliquidValidation: {
        totalMarginUsed: marginSummary.totalMarginUsed,
        totalNtlPos: marginSummary.totalNtlPos,
        crossMaintenanceMarginUsed: rawContractData?.crossMaintenanceMarginUsed,
        
        // 数据源选择逻辑
        dataSourceSelection: {
          preferHyperliquidValue: hyperliquidMarginUsed > 0,
          hyperliquidVsCalculated: {
            hyperliquid: hyperliquidMarginUsed,
            calculated: calculatedOccupiedMargin,
            difference: Math.abs(hyperliquidMarginUsed - calculatedOccupiedMargin),
            significantDifference: Math.abs(hyperliquidMarginUsed - calculatedOccupiedMargin) > 1
          }
        }
      }
    });

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
    const requestId = `margin_check_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    logger.info(`🔍 Starting margin check for trading [${requestId}]`, {
      telegramId,
      requiredAmount,
      leverage,
      requestId
    });

    try {
      // 获取账户余额
      logger.info(`📊 Getting account balance [${requestId}]`, {
        telegramId,
        requestId
      });
      
      const balance = await this.getAccountBalance(telegramId);
      
      // 🔍 详细记录账户余额信息
      logger.info(`💰 Account balance retrieved [${requestId}]`, {
        telegramId,
        accountBalance: {
          nativeBalance: balance.nativeBalance,
          withdrawableAmount: balance.withdrawableAmount,
          totalUsdValue: balance.totalUsdValue,
          address: balance.address
        },
        requestId
      });
      
      // 计算保证金需求
      const availableMargin = balance.withdrawableAmount || 0;
      const requiredMargin = requiredAmount / leverage;
      
      // 🔍 详细的保证金计算分析
      logger.info(`📈 Margin calculation analysis [${requestId}]`, {
        telegramId,
        tradingParameters: {
          requiredAmount,
          leverage,
          requiredMargin: requiredMargin
        },
        marginAnalysis: {
          availableMargin,
          contractAccountValue: balance.nativeBalance,
          occupiedMargin: balance.nativeBalance - availableMargin,
          occupiedPercentage: balance.nativeBalance > 0 
            ? (((balance.nativeBalance - availableMargin) / balance.nativeBalance) * 100).toFixed(2) + '%'
            : '0%'
        },
        sufficientCheck: {
          sufficient: availableMargin >= requiredMargin,
          shortfall: requiredMargin - availableMargin,
          shortfallPercentage: requiredMargin > 0 
            ? (((requiredMargin - availableMargin) / requiredMargin) * 100).toFixed(2) + '%'
            : '0%'
        },
        requestId
      });
      
      const result = {
        sufficient: availableMargin >= requiredMargin,
        availableMargin,
        requiredMargin,
        reason: undefined as string | undefined
      };
      
      // 🎯 分析失败原因
      if (!result.sufficient) {
        logger.warn(`❌ Margin check failed - analyzing reason [${requestId}]`, {
          telegramId,
          failureAnalysis: {
            hasContractFunds: balance.nativeBalance > 0,
            availableVsRequired: {
              available: availableMargin,
              required: requiredMargin,
              difference: requiredMargin - availableMargin
            },
            possibleReasons: {
              noFundsAtAll: balance.nativeBalance === 0,
              fundsButOccupied: balance.nativeBalance > 0 && availableMargin < requiredMargin,
              insufficientTotal: balance.nativeBalance > 0 && balance.nativeBalance < requiredMargin
            }
          },
          requestId
        });
        
        if (balance.nativeBalance === 0) {
          result.reason = 'no_funds';
          logger.info(`📋 Failure reason: no_funds [${requestId}]`, { telegramId, requestId });
        } else if (balance.nativeBalance > 0 && availableMargin < requiredMargin) {
          result.reason = 'margin_occupied';
          logger.info(`📋 Failure reason: margin_occupied [${requestId}]`, {
            telegramId,
            occupiedMargin: balance.nativeBalance - availableMargin,
            totalFunds: balance.nativeBalance,
            availableFunds: availableMargin,
            requestId
          });
        } else {
          result.reason = 'insufficient_margin';
          logger.info(`📋 Failure reason: insufficient_margin [${requestId}]`, { telegramId, requestId });
        }
      } else {
        logger.info(`✅ Margin check passed [${requestId}]`, {
          telegramId,
          marginSufficient: {
            available: availableMargin,
            required: requiredMargin,
            surplus: availableMargin - requiredMargin
          },
          requestId
        });
      }
      
      // 🔍 最终结果总结
      logger.info(`🏁 Margin check completed [${requestId}]`, {
        telegramId,
        finalResult: {
          sufficient: result.sufficient,
          availableMargin: result.availableMargin,
          requiredMargin: result.requiredMargin,
          reason: result.reason || 'sufficient'
        },
        requestId
      });
      
      return result;
      
    } catch (error) {
      logger.error(`💥 Margin check error [${requestId}]`, {
        telegramId,
        requiredAmount,
        leverage,
        error: (error as Error).message,
        errorStack: (error as Error).stack,
        requestId
      });
      
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
        '🌐 <b>网络连接失败</b>\n\n请先执行 <code>/start</code> 命令确保您的账户状态正常，然后重试钱包查询。\n\n📶 请检查网络连接状态。',
        true
      );
    }

    // 处理超时错误
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return this.createDetailedError(
        ApiErrorCode.TIMEOUT_ERROR,
        error.message,
        '⏰ <b>请求超时</b>\n\n服务响应较慢，建议先执行 <code>/start</code> 命令刷新账户状态，然后重试。\n\n🔄 请稍后重试钱包查询。',
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
            '👤 <b>账户未初始化</b>\n\n请先执行 <code>/start</code> 命令初始化您的账户，创建交易钱包。\n\n🚀 初始化完成后即可查看钱包余额。',
            false
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
            '🔧 <b>服务初始化中</b>\n\n请先执行 <code>/start</code> 命令初始化您的账户，然后重试钱包查询。\n\n💡 如果问题持续存在，请稍后重试或联系管理员。',
            true
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
      '❌ <b>钱包查询失败</b>\n\n请先执行 <code>/start</code> 命令重新初始化您的账户。\n\n🔄 如果问题持续存在，请稍后重试或联系管理员。',
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
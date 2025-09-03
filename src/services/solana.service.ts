import { apiService } from './api.service';
import { logger } from '../utils/logger';
import { 
  TokenBalance, 
  FormattedWalletBalance,
  SolanaRPCResponse,
  DetailedError, 
  ApiErrorCode 
} from '../types/api.types';

/**
 * Solana链服务类
 * 处理Solana链上数据查询，包括余额查询、代币信息等
 */
export class SolanaService {
  private readonly rpcEndpoint: string = 'https://api.mainnet-beta.solana.com';
  
  // 主要SPL代币mint地址映射
  private readonly tokenMints = {
    'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'SOL': 'So11111111111111111111111111111111111111112', // Wrapped SOL
    'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'
  };

  /**
   * 获取用户钱包的链上余额
   * @param walletAddress Solana钱包地址
   * @returns 格式化的钱包余额信息
   */
  public async getWalletBalance(walletAddress: string): Promise<FormattedWalletBalance> {
    const startTime = Date.now();
    const requestId = `sol_balance_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    try {
      // 验证钱包地址格式
      this.validateSolanaAddress(walletAddress);

      logger.info(`Solana wallet balance query started [${requestId}]`, {
        walletAddress,
        requestId
      });

      // 并行查询SOL余额和代币余额
      const [solBalance, tokenBalances] = await Promise.all([
        this.getSolBalance(walletAddress),
        this.getTokenBalances(walletAddress)
      ]);

      // 获取代币价格并计算USD价值
      const tokenBalancesWithUSD = await this.addUSDValues(tokenBalances);
      
      // 计算总USD价值
      const solUSDPrice = await this.getSOLPrice();
      const totalUsdValue = (solBalance * solUSDPrice) + 
        tokenBalancesWithUSD.reduce((sum, token) => sum + (token.usdValue || 0), 0);

      const walletBalance: FormattedWalletBalance = {
        address: walletAddress,
        network: 'solana',
        nativeBalance: solBalance,
        nativeSymbol: 'SOL',
        tokenBalances: tokenBalancesWithUSD,
        totalUsdValue,
        lastUpdated: new Date()
      };

      const duration = Date.now() - startTime;
      logger.info(`Solana wallet balance query successful [${requestId}] - ${duration}ms`, {
        walletAddress,
        solBalance,
        tokenCount: tokenBalances.length,
        totalUsdValue,
        duration,
        requestId
      });

      // 记录性能指标
      logger.logPerformance('solana_balance_success', duration, {
        walletAddress,
        requestId
      });

      return walletBalance;

    } catch (error) {
      const duration = Date.now() - startTime;
      const detailedError = this.handleServiceError(error, requestId);
      
      logger.error(`Solana wallet balance query failed [${requestId}] - ${duration}ms`, {
        walletAddress,
        errorCode: detailedError.code,
        errorMessage: detailedError.message,
        duration,
        requestId
      });

      throw detailedError;
    }
  }

  /**
   * 获取SOL余额
   */
  private async getSolBalance(address: string): Promise<number> {
    const rpcCall = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getBalance',
      params: [address]
    };

    const response = await this.makeRPCCall<number>(rpcCall);
    return response / 1e9; // 转换为SOL (从lamports)
  }

  /**
   * 获取代币余额
   */
  private async getTokenBalances(address: string): Promise<TokenBalance[]> {
    const rpcCall = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        address,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed' }
      ]
    };

    const response = await this.makeRPCCall<{
      value: Array<{
        account: {
          data: {
            parsed: {
              info: {
                mint: string;
                tokenAmount: {
                  amount: string;
                  decimals: number;
                  uiAmount: number;
                };
              };
            };
          };
        };
      }>;
    }>(rpcCall);

    const tokenBalances: TokenBalance[] = [];
    
    for (const tokenAccount of response.value) {
      const { mint, tokenAmount } = tokenAccount.account.data.parsed.info;
      
      // 只包含有余额的代币
      if (tokenAmount.uiAmount > 0) {
        const symbol = this.getTokenSymbol(mint);
        const name = this.getTokenName(mint);
        
        tokenBalances.push({
          mint,
          symbol,
          name,
          balance: tokenAmount.amount,
          decimals: tokenAmount.decimals,
          uiAmount: tokenAmount.uiAmount,
          usdValue: 0 // 稍后添加
        });
      }
    }

    return tokenBalances;
  }

  /**
   * 添加USD价值到代币余额
   */
  private async addUSDValues(tokenBalances: TokenBalance[]): Promise<TokenBalance[]> {
    // 这里可以调用现有的价格API来获取代币价格
    const tokensWithUSD: TokenBalance[] = [];
    
    for (const token of tokenBalances) {
      let usdValue = 0;
      
      try {
        // 使用现有的价格API获取代币价格
        if (['USDT', 'USDC'].includes(token.symbol)) {
          usdValue = token.uiAmount; // 稳定币按1:1计算
        } else {
          // 对于其他代币，可以调用价格API
          // 暂时设为0，后续可以集成价格查询
          usdValue = 0;
        }
      } catch (error) {
        logger.warn(`Failed to get USD value for ${token.symbol}`, {
          mint: token.mint,
          error: (error as Error).message
        });
      }
      
      tokensWithUSD.push({
        ...token,
        usdValue
      });
    }
    
    return tokensWithUSD;
  }

  /**
   * 获取SOL价格
   */
  private async getSOLPrice(): Promise<number> {
    try {
      // 调用实际的价格API获取SOL价格
      const response = await apiService.get<{
        code: string;
        message: string;
        data: {
          price: number;
          symbol: string;
        };
      }>('/api/market/price/SOL');
      
      if (response.code === '0' && response.data?.price) {
        return response.data.price;
      }
      
      // 如果API失败，抛出错误而不是返回硬编码值
      throw new Error('Failed to fetch SOL price from API');
      
    } catch (error) {
      logger.warn('Failed to get SOL price', {
        error: (error as Error).message
      });
      // 重新抛出错误，让调用方处理
      throw error;
    }
  }

  /**
   * 根据mint地址获取代币符号
   */
  private getTokenSymbol(mint: string): string {
    const entry = Object.entries(this.tokenMints).find(([_, mintAddress]) => mintAddress === mint);
    return entry ? entry[0] : 'UNKNOWN';
  }

  /**
   * 根据mint地址获取代币名称
   */
  private getTokenName(mint: string): string {
    const symbolToName: { [key: string]: string } = {
      'USDT': 'Tether USD',
      'USDC': 'USD Coin',
      'SOL': 'Solana',
      'BONK': 'Bonk',
      'WIF': 'dogwifhat'
    };
    
    const symbol = this.getTokenSymbol(mint);
    return symbolToName[symbol] || symbol;
  }

  /**
   * 执行Solana RPC调用
   */
  private async makeRPCCall<T>(rpcCall: any): Promise<T> {
    try {
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rpcCall)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as SolanaRPCResponse<T>;
      
      if (data.error) {
        throw new Error(`RPC Error ${data.error.code}: ${data.error.message}`);
      }

      return data.result;
    } catch (error) {
      throw new Error(`Solana RPC call failed: ${(error as Error).message}`);
    }
  }

  /**
   * 验证Solana钱包地址格式
   */
  private validateSolanaAddress(address: string): void {
    if (!address) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL,
        'Wallet address is required',
        '钱包地址不能为空'
      );
    }

    // Solana地址应该是Base58编码，长度通常为32-44字符
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      throw this.createDetailedError(
        ApiErrorCode.INVALID_SYMBOL,
        'Invalid Solana wallet address format',
        'Solana钱包地址格式不正确'
      );
    }
  }

  /**
   * 处理服务错误
   */
  private handleServiceError(error: any, _requestId: string): DetailedError {
    // 如果已经是DetailedError，直接返回
    if (error && typeof error.code === 'string' && error.retryable !== undefined) {
      return error as DetailedError;
    }

    // 处理网络错误
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return this.createDetailedError(
        ApiErrorCode.NETWORK_ERROR,
        error.message,
        '网络连接失败，请检查网络连接'
      );
    }

    // 处理RPC错误
    if (error.message?.includes('RPC Error')) {
      return this.createDetailedError(
        ApiErrorCode.SERVER_ERROR,
        error.message,
        'Solana网络查询失败，请稍后重试'
      );
    }

    // 默认错误处理
    return this.createDetailedError(
      ApiErrorCode.UNKNOWN_ERROR,
      error.message || 'Unknown error',
      '钱包余额查询失败，请稍后重试'
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
        endpoint: 'solana-rpc',
        timestamp: new Date()
      }
    };
  }

  /**
   * 健康检查
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const rpcCall = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getHealth',
        params: []
      };

      await this.makeRPCCall(rpcCall);
      return true;
    } catch (error) {
      logger.warn('Solana service health check failed', { 
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
      name: 'SolanaService',
      version: '1.0.0',
      network: 'mainnet-beta',
      rpcEndpoint: this.rpcEndpoint,
      supportedTokens: Object.keys(this.tokenMints),
      features: [
        'SOL balance query',
        'SPL token balance query',
        'USD value calculation',
        'Real-time on-chain data',
        'Comprehensive error handling'
      ]
    };
  }
}

// 导出单例实例
export const solanaService = new SolanaService();

// 默认导出
export default solanaService;
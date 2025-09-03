import { walletService } from './wallet.service';
import { userService } from './user.service';
import { logger } from '../utils/logger';
import { 
  FormattedWalletBalance
} from '../types/api.types';

/**
 * 账户服务类 (重新设计为Hyperliquid钱包服务)
 * 处理Hyperliquid钱包相关的查询，包括余额查询、代币信息等
 */
export class AccountService {
  /**
   * 获取用户钱包余额 (Hyperliquid查询)
   * 
   * @param telegramId Telegram用户ID
   * @returns 格式化的钱包余额信息
   * @throws DetailedError 当查询失败时
   */
  public async getAccountBalance(telegramId: string): Promise<FormattedWalletBalance> {
    // 直接委托给 walletService
    return await walletService.getAccountBalance(telegramId);
  }

  /**
   * 检查钱包是否有足够余额进行交易
   */
  public async checkSufficientBalance(
    telegramId: string, 
    requiredAmount: number,
    tokenSymbol: string = 'USDC'
  ): Promise<boolean> {
    // 直接委托给 walletService
    return await walletService.checkSufficientBalance(telegramId, requiredAmount, tokenSymbol);
  }


  /**
   * 获取余额警告信息
   */
  public getBalanceWarnings(balance: FormattedWalletBalance): string[] {
    // 直接委托给 walletService
    return walletService.getBalanceWarnings(balance);
  }



  /**
   * 健康检查 - 测试钱包服务连接状态
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 检查Hyperliquid钱包服务和用户服务的健康状态
      const [walletHealthy, userHealthy] = await Promise.all([
        walletService.healthCheck(),
        userService.healthCheck().catch(() => false)
      ]);
      
      return walletHealthy && userHealthy;
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
      version: '3.0.0',
      type: 'Hyperliquid Wallet Service Adapter',
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
export const accountService = new AccountService();

// 默认导出
export default accountService;
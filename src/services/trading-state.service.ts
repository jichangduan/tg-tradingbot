import { cacheService } from './cache.service';
import { logger } from '../utils/logger';

/**
 * 交易状态接口定义
 */
export interface TradingState {
  userId: string;
  action: 'long' | 'short';
  symbol?: string;
  leverage?: string;
  amount?: string;
  step: 'symbol' | 'leverage' | 'amount' | 'confirm';
  messageId?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 交易状态管理服务
 * 负责管理用户的交易会话状态，支持分步式交易流程
 */
export class TradingStateService {
  private readonly STATE_PREFIX = 'trading_state:';
  private readonly STATE_TTL = 300; // 5分钟过期

  /**
   * 保存交易状态
   */
  public async saveState(state: TradingState): Promise<void> {
    try {
      const key = this.getStateKey(state.userId);
      state.updatedAt = Date.now();
      
      await cacheService.set(key, state, this.STATE_TTL);
      
      logger.debug('Trading state saved', {
        userId: parseInt(state.userId),
        action: state.action,
        step: state.step,
        symbol: state.symbol,
        key
      });
    } catch (error) {
      logger.error('Failed to save trading state', {
        userId: parseInt(state.userId),
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * 获取交易状态
   */
  public async getState(userId: string): Promise<TradingState | null> {
    try {
      const key = this.getStateKey(userId);
      const result = await cacheService.get<TradingState>(key);
      
      if (!result.success || !result.data) {
        return null;
      }
      
      const state = result.data;
      
      logger.debug('Trading state retrieved', {
        userId: parseInt(userId),
        action: state.action,
        step: state.step,
        symbol: state.symbol
      });
      
      return state;
    } catch (error) {
      logger.warn('Failed to get trading state', {
        userId: parseInt(userId),
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * 更新交易状态
   */
  public async updateState(userId: string, updates: Partial<TradingState>): Promise<TradingState | null> {
    try {
      const currentState = await this.getState(userId);
      if (!currentState) {
        logger.warn('Attempting to update non-existent trading state', { userId: parseInt(userId) });
        return null;
      }
      
      const updatedState: TradingState = {
        ...currentState,
        ...updates,
        updatedAt: Date.now()
      };
      
      await this.saveState(updatedState);
      return updatedState;
    } catch (error) {
      logger.error('Failed to update trading state', {
        userId: parseInt(userId),
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * 清除交易状态
   */
  public async clearState(userId: string): Promise<void> {
    try {
      const key = this.getStateKey(userId);
      await cacheService.delete(key);
      
      logger.debug('Trading state cleared', { userId: parseInt(userId), key });
    } catch (error) {
      logger.warn('Failed to clear trading state', {
        userId: parseInt(userId),
        error: (error as Error).message
      });
    }
  }

  /**
   * 创建新的交易状态
   */
  public async createState(userId: string, action: 'long' | 'short', symbol?: string): Promise<TradingState> {
    const now = Date.now();
    const state: TradingState = {
      userId,
      action,
      symbol,
      step: symbol ? 'leverage' : 'symbol',
      createdAt: now,
      updatedAt: now
    };
    
    await this.saveState(state);
    return state;
  }

  /**
   * 检查用户是否有活跃的交易状态
   */
  public async hasActiveState(userId: string): Promise<boolean> {
    const state = await this.getState(userId);
    return state !== null;
  }

  /**
   * 验证交易状态的完整性
   */
  public validateStateForExecution(state: TradingState): { valid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];
    
    if (!state.symbol) missingFields.push('symbol');
    if (!state.leverage) missingFields.push('leverage');
    if (!state.amount) missingFields.push('amount');
    
    return {
      valid: missingFields.length === 0,
      missingFields
    };
  }

  /**
   * 获取下一步骤
   */
  public getNextStep(state: TradingState): TradingState['step'] {
    if (!state.symbol) return 'symbol';
    if (!state.leverage) return 'leverage';
    if (!state.amount) return 'amount';
    return 'confirm';
  }

  /**
   * 批量清理过期状态 (可选的清理任务)
   */
  public async cleanupExpiredStates(): Promise<void> {
    try {
      // 这个方法可以被定时任务调用来清理过期的状态
      // 由于Redis会自动处理TTL，这里主要用于日志记录
      logger.debug('Trading state cleanup completed');
    } catch (error) {
      logger.warn('Trading state cleanup failed', {
        error: (error as Error).message
      });
    }
  }

  /**
   * 获取状态的Redis键
   */
  private getStateKey(userId: string): string {
    return `${this.STATE_PREFIX}${userId}`;
  }

  /**
   * 获取服务状态统计
   */
  public async getStats(): Promise<{
    name: string;
    version: string;
    features: string[];
    cacheStatus: boolean;
  }> {
    return {
      name: 'TradingStateService',
      version: '1.0.0',
      features: [
        'Step-by-step trading state management',
        'Redis-based state persistence',
        'Automatic TTL cleanup',
        'State validation',
        'Multi-user support'
      ],
      cacheStatus: await cacheService.healthCheck()
    };
  }
}

// 导出单例实例
export const tradingStateService = new TradingStateService();

// 默认导出
export default tradingStateService;
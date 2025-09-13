import { PushSettings, PushData, pushService } from './push.service';
import { PushLogger } from '../utils/push-logger';
import { logger } from '../utils/logger';
import { getUserToken, getUserAccessToken } from '../utils/auth';

/**
 * 推送数据管理服务
 * 负责获取和处理用户的推送数据
 */
export class PushDataService {

  /**
   * 为用户获取推送数据
   * 从push.service.ts的getUserPushSettings中获取推送数据
   */
  public async getPushDataForUser(userId: string): Promise<PushData | undefined> {
    const startTime = Date.now();
    
    try {
      PushLogger.logDataFetchStart(userId);
      
      // 获取访问令牌
      let accessToken = await getUserToken(userId);
      
      if (!accessToken) {
        PushLogger.logTokenStatus(userId, false);
        
        const userInfo = {
          username: undefined,
          first_name: undefined,
          last_name: undefined
        };
        
        accessToken = await getUserAccessToken(userId, userInfo);
        PushLogger.logTokenInitialized(userId);
      } else {
        PushLogger.logTokenStatus(userId, true);
      }

      // 获取用户推送设置，其中包含推送数据
      PushLogger.logApiCallStart(userId);
      const response = await pushService.getUserPushSettings(userId, accessToken);
      
      // 详细日志记录API响应
      const duration = Date.now() - startTime;
      PushLogger.logApiResponse(userId, response, duration);
      
      // 检查推送数据是否存在
      if (!response?.data?.push_data) {
        PushLogger.logDataFetchSuccess(userId, duration);
        return undefined; // 返回undefined而不是测试数据
      }
      
      // 直接返回AIW3真实推送数据
      PushLogger.logDataFetchSuccess(userId, duration);
      return response.data.push_data;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // 详细记录错误信息以便调试
      logger.error(`🚨 [PUSH_DATA] Detailed error analysis for user ${userId}`, {
        errorName: (error as Error).name,
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
        durationMs: duration,
        durationText: `${duration}ms`,
        userIdStr: userId,
        errorType: error instanceof Error ? error.constructor.name : typeof error
      });
      
      PushLogger.logDataFetchError(userId, duration, error as Error);
      
      // 直接抛出错误，不使用fallback测试数据
      throw error;
    }
  }

  /**
   * 检查是否有新的推送内容
   */
  public hasNewPushContent(pushData: PushData | undefined): boolean {
    PushLogger.logContentCheckStart(pushData);
    
    if (!pushData) {
      PushLogger.logContentCheckFailed();
      return false;
    }
    
    // 检查是否有任何推送内容
    const hasFlashNews = pushData.flash_news && pushData.flash_news.length > 0;
    const hasWhaleActions = pushData.whale_actions && pushData.whale_actions.length > 0;
    const hasFundFlows = pushData.fund_flows && pushData.fund_flows.length > 0;
    
    // 详细记录每种内容类型的状态
    PushLogger.logContentAnalysis(pushData);
    
    const hasAnyContent = !!(hasFlashNews || hasWhaleActions || hasFundFlows);
    
    PushLogger.logContentCheckResult(hasAnyContent, pushData);
    
    return hasAnyContent;
  }


  /**
   * 根据用户设置筛选推送内容
   */
  public filterPushContent(pushData: PushData, settings: PushSettings): {
    flashNews: any[];
    whaleActions: any[];
    fundFlows: any[];
  } {
    const flashNews = settings.flash_enabled ? pushData.flash_news || [] : [];
    let whaleActions = settings.whale_enabled ? pushData.whale_actions || [] : [];
    const fundFlows = settings.fund_enabled ? pushData.fund_flows || [] : [];
    
    // 对鲸鱼交易进行金额过滤，小于$1,000,000的不推送
    if (whaleActions.length > 0) {
      whaleActions = this.filterWhaleActionsByAmount(whaleActions);
    }
    
    return { flashNews, whaleActions, fundFlows };
  }

  /**
   * 根据交易金额过滤鲸鱼动作
   * @param whaleActions 鲸鱼动作数组
   * @returns 过滤后的鲸鱼动作数组
   */
  private filterWhaleActionsByAmount(whaleActions: any[]): any[] {
    const minThreshold = 1000000; // $1,000,000 门槛
    
    return whaleActions.filter(action => {
      try {
        if (!action.amount || typeof action.amount !== 'string') {
          return true; // 如果没有金额信息，保留
        }
        
        const parsedAmount = this.parseAmountToUSD(action.amount);
        
        // 如果解析失败，保留该条记录（保守处理）
        if (parsedAmount === null) {
          logger.debug('Failed to parse whale action amount, keeping record', {
            amount: action.amount,
            address: action.address
          });
          return true;
        }
        
        const shouldKeep = parsedAmount >= minThreshold;
        
        if (!shouldKeep) {
          logger.debug('Filtering out whale action below threshold', {
            amount: action.amount,
            parsedAmount: parsedAmount,
            threshold: minThreshold,
            address: action.address
          });
        }
        
        return shouldKeep;
        
      } catch (error) {
        logger.warn('Error filtering whale action by amount', {
          error: (error as Error).message,
          action
        });
        return true; // 出错时保留记录
      }
    });
  }

  /**
   * 解析金额字符串为USD数值
   * 支持多种格式：1.56M, 1,560,000, $1560000, 1560000 USDT等
   * @param amountStr 金额字符串
   * @returns 解析后的USD数值，解析失败返回null
   */
  private parseAmountToUSD(amountStr: string): number | null {
    if (!amountStr || typeof amountStr !== 'string') {
      return null;
    }
    
    try {
      // 移除常见的非数字字符，保留数字、小数点、逗号、M、K、B等单位
      const cleanStr = amountStr.replace(/[^0-9.,MKBmkb]/g, '').trim();
      
      if (!cleanStr) {
        return null;
      }
      
      // 检查是否有单位后缀
      const hasM = /[Mm]$/.test(cleanStr);
      const hasK = /[Kk]$/.test(cleanStr);
      const hasB = /[Bb]$/.test(cleanStr);
      
      // 移除单位后缀，提取数字部分
      const numStr = cleanStr.replace(/[MKBmkb]$/, '').replace(/,/g, '');
      const baseNum = parseFloat(numStr);
      
      if (isNaN(baseNum)) {
        return null;
      }
      
      // 根据单位计算最终数值
      let finalAmount = baseNum;
      if (hasB) {
        finalAmount = baseNum * 1000000000; // 十亿
      } else if (hasM) {
        finalAmount = baseNum * 1000000; // 百万
      } else if (hasK) {
        finalAmount = baseNum * 1000; // 千
      }
      
      return finalAmount;
      
    } catch (error) {
      logger.debug('Failed to parse amount string', {
        amountStr,
        error: (error as Error).message
      });
      return null;
    }
  }
}

// 导出单例
export const pushDataService = new PushDataService();
export default pushDataService;
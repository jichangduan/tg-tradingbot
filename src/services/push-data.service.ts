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
   * 临时增加模拟快讯用于测试
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
      
      // 临时添加一条测试快讯数据
      const realPushData = response?.data?.push_data;
      const testFlashNews = [{
        title: "🔥 Bitcoin突破$95,000大关！",
        content: "机构资金大量流入，市场情绪极度乐观",
        timestamp: new Date().toISOString(),
        symbol: "BTC"
      }];
      
      const combinedPushData: PushData = {
        flash_news: [...testFlashNews, ...(realPushData?.flash_news || [])],
        whale_actions: realPushData?.whale_actions || [],
        fund_flows: realPushData?.fund_flows || []
      };
      
      PushLogger.logDataFetchSuccess(userId, duration);
      return combinedPushData;
      
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
    const whaleActions = settings.whale_enabled ? pushData.whale_actions || [] : [];
    const fundFlows = settings.fund_enabled ? pushData.fund_flows || [] : [];
    
    return { flashNews, whaleActions, fundFlows };
  }
}

// 导出单例
export const pushDataService = new PushDataService();
export default pushDataService;
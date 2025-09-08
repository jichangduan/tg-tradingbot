import { apiService } from './api.service';
import { logger } from '../utils/logger';
import { getUserAccessToken } from '../utils/auth';

/**
 * 标准化以太坊地址格式
 * @param address 原始地址
 * @returns 标准化的小写地址
 */
function normalizeAddress(address: string): string {
  if (!address) return address;
  
  // 移除0x前缀，转换为小写，再添加0x前缀
  const cleanAddress = address.replace(/^0x/i, '').toLowerCase();
  return `0x${cleanAddress}`;
}

/**
 * 验证以太坊地址格式
 * @param address 地址字符串
 * @returns 是否为有效地址
 */
function isValidEthereumAddress(address: string): boolean {
  if (!address) return false;
  
  // 检查格式：0x + 40个十六进制字符
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export interface IUserWalletData {
  tradingwalletaddress: string;
  strategywalletaddress: string;
}

export interface IBalanceItem {
  coin: string;
  entryNtl: string;
  hold: string;
  token: number;
  total: string;
}

export interface IUserBalanceResponse {
  balances: IBalanceItem[];
}

export interface IUserBalanceData {
  coin: string;
  total: string;
}

// 合约余额相关接口定义
export interface IMarginSummary {
  accountValue?: string;
  totalMarginUsed?: string;
  totalNtlPos?: string;
  totalRawUsd?: string;
}

export interface IUserStateData {
  assetPositions?: Array<any>;
  crossMaintenanceMarginUsed?: string;
  crossMarginSummary?: IMarginSummary;
  marginSummary?: IMarginSummary;
  time: number;
  withdrawable?: string;
}

// 提现请求参数
export interface IWithdrawRequest {
  type: 1 | 2; // 1 - trade wallet address, 2 - strategy wallet address
  amount: string; // usdc数量（字符串格式）
  destination: string; // 提现到的目标钱包地址
}

// 带签名的提现请求参数
export interface IWithdrawRequestWithSignature extends IWithdrawRequest {
  signature?: string; // 签名（钱包登录用户使用）
  twitter_auth_code?: string; // Twitter授权码（三方登录用户使用）
}


// 获取用户钱包地址
export async function getUserWallet(telegramId?: string) {
  if (!telegramId) {
    throw new Error('telegramId is required for getUserWallet');
  }

  // 获取用户的JWT Token (会自动初始化用户如果token不存在)
  const accessToken = await getUserAccessToken(telegramId);

  const params = { telegram_id: telegramId };
  
  logger.info(`Getting user wallet with authentication for ${telegramId}`, {
    telegramId,
    hasToken: true
  });

  const response = await apiService.getWithAuth<IUserWalletData>(
    "/api/hyperliquid/getUserWallet", 
    accessToken, 
    params
  );
  
  // 标准化地址格式
  if (response && response.tradingwalletaddress) {
    response.tradingwalletaddress = normalizeAddress(response.tradingwalletaddress);
    
    logger.info(`Wallet address normalized for ${telegramId}`, {
      telegramId,
      normalizedTradingWallet: response.tradingwalletaddress,
      normalizedStrategyWallet: response.strategywalletaddress ? normalizeAddress(response.strategywalletaddress) : undefined
    });
    
    if (response.strategywalletaddress) {
      response.strategywalletaddress = normalizeAddress(response.strategywalletaddress);
    }
  }
  
  return response;
}

// 创建用户Hyperliquid钱包
export async function createUserHyperliquidWallet(telegramId: string): Promise<IUserWalletData | null> {
  if (!telegramId) {
    throw new Error('telegramId is required for createUserHyperliquidWallet');
  }

  // 获取用户的JWT Token (会自动初始化用户如果token不存在)
  const accessToken = await getUserAccessToken(telegramId);

  try {
    logger.info(`Creating Hyperliquid wallet for user ${telegramId}`, {
      telegramId,
      hasToken: true
    });

    // 调用后端API创建钱包 - 基于后端代码分析，这个API会自动创建并保存钱包
    // 实际上调用的是 getUserWallet，但后端会在不存在时自动创建
    const createWalletResponse = await apiService.getWithAuth<{
      code: number;
      data: {
        tradingwalletaddress?: string;
        strategywalletaddress?: string;
        maxfeerate?: string;
      };
      message: string;
    }>('/api/hyperliquid/getUserWallet', accessToken, { 
      telegram_id: telegramId 
    });

    if (createWalletResponse && createWalletResponse.code === 200 && createWalletResponse.data && createWalletResponse.data.tradingwalletaddress) {
      logger.info(`Hyperliquid wallet created successfully for user ${telegramId}`, {
        telegramId,
        tradingWallet: createWalletResponse.data.tradingwalletaddress,
        strategyWallet: createWalletResponse.data.strategywalletaddress
      });

      // 返回标准化的钱包数据
      const normalizedData: IUserWalletData = {
        tradingwalletaddress: normalizeAddress(createWalletResponse.data.tradingwalletaddress),
        strategywalletaddress: createWalletResponse.data.strategywalletaddress 
          ? normalizeAddress(createWalletResponse.data.strategywalletaddress)
          : ''
      };
      
      logger.info(`Wallet addresses normalized after creation for ${telegramId}`, {
        telegramId,
        originalTradingWallet: createWalletResponse.data.tradingwalletaddress,
        normalizedTradingWallet: normalizedData.tradingwalletaddress,
        originalStrategyWallet: createWalletResponse.data.strategywalletaddress,
        normalizedStrategyWallet: normalizedData.strategywalletaddress
      });
      
      return normalizedData;
    } else {
      logger.error(`Failed to create Hyperliquid wallet for user ${telegramId}`, {
        telegramId,
        response: createWalletResponse
      });
      return null;
    }
  } catch (error) {
    logger.error(`Error creating Hyperliquid wallet for user ${telegramId}`, {
      telegramId,
      error: (error as Error).message
    });
    return null;
  }
}

// 获取用户现货余额
export async function getUserHyperliquidBalance(walletType: 1 | 2, telegramId?: string) {
  if (!telegramId) {
    throw new Error('telegramId is required for getUserHyperliquidBalance');
  }

  // 获取用户的JWT Token (会自动初始化用户如果token不存在)
  const accessToken = await getUserAccessToken(telegramId);

  const requestBody: any = {
    type: walletType,
    telegram_id: telegramId
  };
  
  logger.info(`Getting user hyperliquid balance with authentication for ${telegramId}`, {
    telegramId,
    walletType,
    hasToken: true,
    requestBody: requestBody,
    apiEndpoint: "/api/hyperliquid/getUserBalance"
  });
  
  const response = await apiService.postWithAuth<{
    code: number;
    data: IUserBalanceResponse;
    message: string;
  }>("/api/hyperliquid/getUserBalance", accessToken, requestBody);

  // 详细记录API响应用于诊断
  logger.info(`Hyperliquid balance API response for ${telegramId}`, {
    telegramId,
    walletType,
    responseCode: response.code,
    responseMessage: response.message,
    hasData: !!response.data,
    balancesCount: response.data?.balances?.length || 0,
    balances: response.data?.balances || [],
    fullResponse: JSON.stringify(response, null, 2)
  });

  if (response.code === 200 && response.data) {
    // 找到USDC的余额
    const usdcBalance = response.data?.balances.find((balance: IBalanceItem) => balance.coin === "USDC");
    
    logger.info(`USDC balance search result for ${telegramId}`, {
      telegramId,
      walletType,
      usdcBalanceFound: !!usdcBalance,
      usdcBalance: usdcBalance || 'not found',
      allCoins: response.data.balances.map(b => b.coin)
    });

    if (usdcBalance) {
      // 返回简化的对象
      const simplifiedBalance: IUserBalanceData = {
        coin: usdcBalance.coin,
        total: usdcBalance.total || "0.0"
      };
      
      logger.info(`Returning USDC balance for ${telegramId}`, {
        telegramId,
        walletType,
        coin: simplifiedBalance.coin,
        total: simplifiedBalance.total,
        originalTotal: usdcBalance.total
      });
      
      return {
        code: 200,
        data: simplifiedBalance,
        message: response.message
      };
    } else {
      // 如果没有找到USDC余额，也要记录日志
      logger.warn(`No USDC balance found for ${telegramId}, returning default 0 balance`, {
        telegramId,
        walletType,
        availableCoins: response.data.balances.map(b => `${b.coin}: ${b.total}`),
        balancesCount: response.data.balances.length
      });
    }
  } else {
    logger.error(`Hyperliquid balance API failed for ${telegramId}`, {
      telegramId,
      walletType,
      responseCode: response.code,
      responseMessage: response.message,
      hasData: !!response.data
    });
  }

  // 如果没有找到USDC余额或请求失败，返回默认值
  logger.info(`Returning default 0 USDC balance for ${telegramId}`, {
    telegramId,
    walletType,
    reason: response.code !== 200 ? 'API_ERROR' : 'NO_USDC_BALANCE'
  });
  
  return {
    code: 200,
    data: {
      coin: "USDC",
      total: "0.0"
    },
    message: response.message || "No USDC balance found, returning default."
  };
}



// 提现接口
export async function withdrawApi(params: IWithdrawRequest) {
  const response = await apiService.post<any>("/api/hyperliquid/bridge", params);
  return response;
}

// 带签名的提现接口
export async function withdrawApiWithSignature(params: IWithdrawRequestWithSignature) {
  const response = await apiService.post<any>("/api/hyperliquid/bridgeWithSignature", params);
  return response;
}

// 获取openOrders
export async function getOpenOrdersApi(params?: Record<string, unknown>) {
    const response = await apiService.post(`/api/hyperliquid/getOpenOrderList`, params);
    return response;
}

// 获取ordersHistory
export async function getOrdersHistoryApi(params?: Record<string, unknown>) {
    const response = await apiService.post(`/api/hyperliquid/getHistoricalOrders`,params);
    return response;
}

// 获取positionsHistory
export async function getUserFillsApi(params?: Record<string, unknown>) {
  const response = await apiService.post(`/api/hyperliquid/getUserFills`,params);
  return response;
}

// 批量撤单接口 - 批量撤销多个订单
export async function batchCancelOpenOrdersApi(params?: Record<string, unknown>) {
  const response = await apiService.post('/api/hyperliquid/batchCancelOrder',params);
  return response;
}

// 平仓接口 - 关闭现有仓位，支持市价和限价平仓
export async function closePositionOrderApi(params?: Record<string, unknown>) {
  const response = await apiService.post('/api/hyperliquid/closeOrder',params);
  return response;
}

// 更新杠杆倍数接口 - 修改指定资产的杠杆倍数设置
export async function updateLeverageApi(params?: Record<string, unknown>) {
  const response = await apiService.post('/api/hyperliquid/leverage',params);
  return response;
}

// 批量独立TPSL订单接口 - 批量创建独立的止盈或止损订单
export async function orderWithTpslApi(params?: Record<string, unknown>) {
  const response = await apiService.post('/api/hyperliquid/batchOrdersTpsl',params);
  return response;
}

 // 获取可用余额
export async function getActiveAssetDataApi(params?: Record<string, unknown>) {
  const response = await apiService.post('/api/hyperliquid/getActiveAssetData',params);
  return response;
}

// 获取用户可用余额 (带认证)
export async function getUserActiveAssetData(walletType: 1 | 2, telegramId?: string) {
  if (!telegramId) {
    throw new Error('telegramId is required for getUserActiveAssetData');
  }

  // 获取用户的JWT Token
  const accessToken = await getUserAccessToken(telegramId);

  const requestBody: any = {
    type: walletType,
    telegram_id: telegramId
  };
  
  logger.info(`Getting user active asset data with authentication for ${telegramId}`, {
    telegramId,
    walletType,
    hasToken: true,
    requestBody: requestBody,
    apiEndpoint: "/api/hyperliquid/getActiveAssetData"
  });
  
  try {
    const response = await apiService.postWithAuth<any>(
      "/api/hyperliquid/getActiveAssetData", 
      accessToken, 
      requestBody
    );

    logger.info(`Active asset data API response for ${telegramId}`, {
      telegramId,
      walletType,
      responseCode: response?.code || 'no code',
      responseMessage: response?.message || 'no message',
      hasData: !!response?.data,
      fullResponse: JSON.stringify(response, null, 2)
    });

    return response;
  } catch (error) {
    logger.error(`Active asset data API failed for ${telegramId}`, {
      telegramId,
      walletType,
      error: (error as Error).message
    });
    throw error;
  }
}


// 更新逐仓保证金接口 - 调整指定资产的逐仓保证金
export async function updateMarginApi(params?: Record<string, unknown>) {
  const response = await apiService.post('/api/hyperliquid/isolatedMargin',params);
  return response;
}

// 按客户端订单ID撤单接口 - 使用客户端订单ID撤销订单
export async function closeTpslApi(params?: Record<string, unknown>) {
  const response = await apiService.post('/api/hyperliquid/cancelOrder',params);
  return response;
}

// 持仓 包含 止盈止损
export async function openPositionsApi(params?: Record<string, unknown>) {
  const response = await apiService.post('/api/hyperliquid/getTpslOrders',params);
  return response;
}

// 获取合约余额信息
export async function getUserContractBalance(walletType?: 1 | 2, telegramId?: string) {
  if (!telegramId) {
    throw new Error('telegramId is required for getUserContractBalance');
  }

  // 获取用户的JWT Token (会自动初始化用户如果token不存在)
  const accessToken = await getUserAccessToken(telegramId);

  const requestBody: any = {
    type: walletType || 1,
    telegram_id: telegramId
  };
  
  logger.info(`Getting user contract balance with authentication for ${telegramId}`, {
    telegramId,
    walletType: walletType || 1,
    hasToken: true
  });
  
  const response = await apiService.postWithAuth<{
    code: number;
    data: IUserStateData;
    message: string;
  }>("/api/hyperliquid/getUserState", accessToken, requestBody);

  if (response.code === 200 && response?.data) {
    return {
      code: 200,
      data: response.data,
      message: response.message
    };
  }

  // 如果请求失败，返回默认值
  return {
    code: 200,
    data: getDefaultUserStateData(),
    message: "successfully."
  };
}



// 获取提现钱包签名的nonce
export async function getBridgeNonce(params: object) {
  return await apiService.get(
    "api/hyperliquid/getBridgeNonce",
    params
  );
}

// 批准用户费率，没有返回值
export async function approveFeeApi(params: { type: number }) {
  try {
    await apiService.post("/api/hyperliquid/approveFee", params);
  } catch (err) {
    
  }
}


// 创建默认的 IUserStateData 对象
export function getDefaultUserStateData(): IUserStateData {
  return {
    assetPositions: [],
    crossMaintenanceMarginUsed: "0.0",
    crossMarginSummary: {
      accountValue: "0.0",
      totalMarginUsed: "0.0",
      totalNtlPos: "0.0",
      totalRawUsd: "0.0"
    },
    marginSummary: {
      accountValue: "0.0",
      totalMarginUsed: "0.0",
      totalNtlPos: "0.0",
      totalRawUsd: "0.0"
    },
    time: 0,
    withdrawable: "0.0"
  };
}
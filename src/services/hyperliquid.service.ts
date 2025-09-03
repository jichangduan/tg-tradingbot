import { apiService } from './api.service';

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
  const params = telegramId ? { telegram_id: telegramId } : {};
  const response = await apiService.get<IUserWalletData>("/api/hyperliquid/getUserWallet", params);
  return response;
}

// 获取用户现货余额
export async function getUserHyperliquidBalance(walletType: 1 | 2, telegramId?: string) {
  const requestBody: any = {
    type: walletType
  };
  
  if (telegramId) {
    requestBody.telegram_id = telegramId;
  }
  
  const response = await apiService.post<{
    code: number;
    data: IUserBalanceResponse;
    message: string;
  }>("/api/hyperliquid/getUserBalance", requestBody);

  if (response.code === 200 && response.data) {
    // 找到USDC的余额
    const usdcBalance = response.data?.balances.find((balance: IBalanceItem) => balance.coin === "USDC");

    if (usdcBalance) {
      // 返回简化的对象
      const simplifiedBalance: IUserBalanceData = {
        coin: usdcBalance.coin,
        total: usdcBalance.total
      };
      return {
        code: 200,
        data: simplifiedBalance,
        message: response.message
      };
    }
  }

  // 如果没有找到USDC余额或请求失败，返回默认值
  return {
    code: 200,
    data: {
      coin: "USDC",
      total: "0.0"
    },
    message: "successfully."
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
  const requestBody: any = {
    type: walletType || 1
  };
  
  if (telegramId) {
    requestBody.telegram_id = telegramId;
  }
  
  const response = await apiService.post<{
    code: number;
    data: IUserStateData;
    message: string;
  }>("/api/hyperliquid/getUserState", requestBody);

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
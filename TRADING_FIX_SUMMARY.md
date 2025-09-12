# TGBot 交易接口修复总结

## 问题原因
用户无法执行交易操作，返回 400 错误："Please reinitialize your wallet via TgBot /start command to enable trading"

**根本原因**: TGBot 交易请求缺少后端要求的 `userId` 字段（内部用户ID）

## 修复内容

### 1. 修复的文件
- ✅ `src/bot/handlers/long.handler.ts` - 做多交易
- ✅ `src/bot/handlers/short.handler.ts` - 做空交易  
- ✅ `src/bot/handlers/close.handler.ts` - 平仓交易
- ✅ `src/utils/auth.ts` - 添加新的用户数据获取函数

### 2. 关键修改

#### 修改前（错误）
```typescript
const tradingData = {
  symbol: symbol.toUpperCase(),
  leverage: parseInt(leverageStr.replace('x', '')),
  size: size,
  orderType: "market"
  // ❌ 缺少 userId 字段
};
```

#### 修改后（正确）
```typescript
const tradingData = {
  userId: userData.userId,                          // ✅ 使用内部用户ID
  symbol: symbol.toUpperCase(),
  leverage: parseInt(leverageStr.replace('x', '')),
  size: size,
  orderType: "market"
};
```

### 3. 新增功能
在 `src/utils/auth.ts` 中添加了 `getUserDataAndToken()` 函数：
- 一次调用获取用户数据和访问令牌
- 避免重复的 API 调用
- 提高性能和可靠性

### 4. API 调用规范

#### 请求头
```javascript
headers: {
  'Authorization': 'Bearer ' + accessToken,  // JWT 令牌认证
  'Content-Type': 'application/json'
}
```

#### 请求体
```javascript
// POST /api/tgbot/trading/long
{
  "userId": 112059,  // ✅ 内部用户ID（不是 telegram_id）
  "symbol": "BTC",
  "leverage": 4,
  "size": "calculated_size",
  "orderType": "market"
}
```

### 5. 数据流程
1. 用户发送 `/long BTC 4x 100`
2. TGBot 调用 `/api/tgbot/user/init` 获取用户数据
3. 提取内部 `userId` (112059) 和 `accessToken`
4. 构建交易请求，包含 `userId` 字段
5. 使用 JWT 认证调用交易接口
6. 后端正确识别用户，执行交易

## 预期效果
- ✅ 用户可以正常执行 `/long` 做多交易
- ✅ 用户可以正常执行 `/short` 做空交易
- ✅ 用户可以正常执行 `/close` 平仓操作
- ✅ 不再出现 "Please reinitialize wallet" 错误
- ✅ 符合后端 JWT 认证标准
- ✅ 提高了 API 调用效率

## 测试建议
1. 测试 `/long BTC 4x 100` 命令
2. 测试 `/short ETH 2x 50` 命令
3. 测试 `/close BTC` 命令
4. 验证错误处理和用户反馈

---
**修复日期**: 2024-12-09
**修复状态**: ✅ 完成
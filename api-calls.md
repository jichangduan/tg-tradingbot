# TGBot API 调用文档

*最后更新: 2025-09-03*

## 命令接口调用情况

### 1. `/start` - 用户初始化
- **接口**: `POST /api/tgbot/user/init`
- **认证**: API Key
- **参数**: `{telegram_id, username, first_name, invitation_code}`
- **状态**: ✅ 正常

### 2. `/wallet` - 钱包查询  
- **接口**: `GET /api/hyperliquid/getUserWallet`
- **认证**: 需要 JWT Token (`req.user`)
- **参数**: 无
- **状态**: ✅ **已修复** - hyperliquid.service.ts 已更新使用 `getWithAuth()` 方法

### 3. `/price` - 代币价格
- **接口**: `GET /api/birdeye/token_trending`  
- **认证**: API Key
- **参数**: 无
- **状态**: ✅ 正常

### 4. `/markets` - 市场数据
- **接口**: `GET /api/home/getLargeMarketData`
- **认证**: 无需认证
- **参数**: 无  
- **状态**: ✅ 正常

### 5. `/chart` - 图表生成
- **接口**: `POST /api/tgbot/hyperliquid/candles`
- **认证**: API Key
- **参数**: `{symbol, interval, limit}`
- **状态**: 🟡 需要测试

### 6. `/long` - 做多交易
- **接口**: `POST /api/tgbot/trading/long`
- **认证**: JWT Token
- **参数**: 交易参数
- **状态**: 🟡 需要测试

### 7. `/short` - 做空交易  
- **接口**: `POST /api/tgbot/trading/short`
- **认证**: JWT Token
- **参数**: 交易参数
- **状态**: 🟡 需要测试

### 8. `/close` - 平仓
- **接口**: `POST /api/tgbot/trading/close`
- **认证**: JWT Token
- **参数**: 平仓参数
- **状态**: 🟡 需要测试

### 9. `/positions` - 持仓查询
- **接口**: `GET /api/tgbot/trading/positions` 
- **认证**: JWT Token
- **参数**: 无
- **状态**: 🟡 需要测试

### 10. `/orders` - 订单查询
- **接口**: `GET /api/tgbot/trading/orders`
- **认证**: JWT Token  
- **参数**: 无
- **状态**: 🟡 需要测试

### 11. `/pnl` - 盈亏查询
- **接口**: `GET /api/tgbot/trading/pnl`
- **认证**: JWT Token
- **参数**: 无
- **状态**: 🟡 需要测试

### 12. `/invite` - 邀请功能
- **接口**: `GET /api/reward/inviteRecord`
- **认证**: JWT Token
- **参数**: 无
- **状态**: 🟡 需要测试

### 13. `/points` - 积分查询
- **接口**: 使用 invite 服务
- **认证**: JWT Token
- **参数**: 无
- **状态**: 🟡 需要测试

### 14. `/push` - 推送设置
- **接口**: `GET/POST /api/user/push-settings`
- **认证**: JWT Token
- **参数**: 推送配置
- **状态**: 🟡 需要测试

## Hyperliquid 相关接口 (后台服务)

### 钱包管理
- `GET /api/hyperliquid/getUserWallet` - 获取钱包地址
- `POST /api/hyperliquid/getUserBalance` - 获取余额
- `POST /api/hyperliquid/getUserState` - 获取账户状态

### 交易操作
- `POST /api/hyperliquid/closeOrder` - 平仓
- `POST /api/hyperliquid/leverage` - 调整杠杆
- `POST /api/hyperliquid/batchOrdersTpsl` - 止盈止损
- `POST /api/hyperliquid/getActiveAssetData` - 可用余额

### 查询操作  
- `POST /api/hyperliquid/getOpenOrderList` - 开放订单
- `POST /api/hyperliquid/getHistoricalOrders` - 历史订单
- `POST /api/hyperliquid/getUserFills` - 成交记录
- `POST /api/hyperliquid/getTpslOrders` - 持仓和止损

**认证要求**: 所有 Hyperliquid 接口都需要 JWT Token (`req.user`)

## 认证方式说明

### API Key 认证
- Header: `x-api-key: J0nWlQ3mOp9a8yR6KzXuVbL7TsI2dFx4`
- 适用: 公共数据接口

### JWT Token 认证  
- Header: `Authorization: Bearer <token>`
- 适用: 用户相关操作
- **问题**: 需要确定如何获取用户的 JWT Token

### 无认证
- 适用: 公开市场数据

## 测试结果总结 (2025-09-03)

### ✅ JWT Token 机制测试结果
1. **Token 获取正常** - `/api/tgbot/user/init` 成功返回 `accessToken`
2. **Token 格式正确** - JWT Token: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
3. **Token 缓存实现** - start.handler.ts 第301行有缓存到Redis的逻辑
4. **用户ID映射正常** - `telegram_id: 7547622528` → `userId: 111925`

### ✅ 已修复的问题
1. **hyperliquid.service.ts 认证问题** - ✅ 已更新使用 `apiService.getWithAuth()` 和 `apiService.postWithAuth()`
2. **JWT Token 获取机制** - ✅ 添加了 `getUserAccessToken()` 函数从Redis缓存获取Token
3. **API调用认证** - ✅ 所有Hyperliquid接口现在正确传递JWT Token
4. **错误处理优化** - ✅ 添加了清晰的错误提示，引导用户先执行 `/start`

### 🟡 待验证
- 所有标记为 🟡 的接口需要实际测试
- 交易接口的参数格式需要确认
- 推送和邀请功能的完整流程

## 修复摘要 (2025-09-03 完成)

### 核心修复内容
1. **添加JWT Token获取功能**：`getUserAccessToken()` 函数从Redis获取缓存的Token
2. **更新API调用方法**：
   - `getUserWallet()` → 使用 `apiService.getWithAuth()`
   - `getUserHyperliquidBalance()` → 使用 `apiService.postWithAuth()`  
   - `getUserContractBalance()` → 使用 `apiService.postWithAuth()`
3. **优化wallet.service.ts**：移除不必要的 `userService.initializeUser()` 调用
4. **改进错误处理**：添加清晰的Token缺失错误提示

### 部署说明
修复后的代码需要部署到服务器才能生效。部署后，`/wallet` 命令应该能够正常显示用户余额，不再出现403错误。
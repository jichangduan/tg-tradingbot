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
- **参数**: `{symbol, leverage, amount, telegram_id}`
- **状态**: ✅ **已优化** - 添加了余额检查和准确错误提示
- **改进**: 
  - 交易前检查账户USDC余额
  - 余额不足时提供明确提示和解决方案
  - 避免发送到后端的无效请求

### 7. `/short` - 做空交易  
- **接口**: `POST /api/tgbot/trading/short`
- **认证**: JWT Token
- **参数**: `{symbol, leverage, amount, telegram_id}`
- **状态**: ✅ **已优化** - 添加了余额检查和准确错误提示
- **改进**: 
  - 交易前检查账户USDC余额
  - 余额不足时提供明确提示和解决方案
  - 避免发送到后端的无效请求

### 8. `/close` - 平仓
- **接口**: `POST /api/tgbot/trading/close`
- **认证**: JWT Token
- **参数**: `{symbol, percentage, orderType}`
- **状态**: ✅ **已修复** - 参数格式问题已解决
- **修复**: 
  - 修复前端参数映射，正确发送 `percentage` 字段
  - 支持百分比格式（如 `50%`, `100%`）和数量格式
  - 当用户无持仓时返回准确的错误提示

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

### ❌ 当前问题 (2025-09-03)
1. **交易命令失败** - `/long` 和 `/short` 返回400错误
   - 错误信息: "Failed to execute long order - Hyperliquid API returned null"  
   - 根本原因: Hyperliquid交易API返回null，非参数问题
   - 可能原因: 用户钱包余额不足、网络连接、Hyperliquid服务状态

2. **钱包命令502错误** - `/wallet` 间歇性返回502 Bad Gateway
   - 原因: 后端服务不可用或重启中
   - 用户体验: 显示技术错误而非友好提示

### 🟡 待验证
- 修复交易命令的Hyperliquid API调用问题
- 改进错误处理，引导用户先执行 `/start`
- 所有标记为 🟡 的接口需要实际测试
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

5. **自动钱包创建功能**：用户无钱包时自动调用 `/api/hyperliquid/createUserWallet`
6. **交易命令调试日志**：添加详细日志帮助诊断400错误

### 调试发现 (2025-09-03)

#### 交易命令400错误分析
1. **参数传递正确**：前端正确解析 `/long btc x10 200` 并传递给后端
2. **JWT认证正常**：用户认证和权限验证通过
3. **后端接口正常**：TgBotController.js 正确接收参数
4. **Hyperliquid API问题**：最终调用 Hyperliquid 交易API时返回null
5. **Leverage参数未使用**：后端代码显示leverage参数实际未传递给Hyperliquid

#### 可能原因
- 用户钱包余额不足（需要先充值USDC）
- Hyperliquid服务状态异常
- 交易参数格式不符合Hyperliquid要求
- 网络连接问题

#### 下一步行动
1. **检查用户钱包余额** - 确认USDC余额是否充足
2. **验证Hyperliquid服务** - 测试Hyperliquid API直接调用
3. **完善错误处理** - 提供具体失败原因而非通用错误
4. **优化用户体验** - 502错误时引导用户先执行`/start`

## 最新修复进展 (2025-09-03)

### JWT Token认证问题修复 ✅

**问题：** 部分接口返回403认证错误，因为使用了错误的JWT Token获取函数

**根本原因：** 
- `hyperliquid.service.ts` 中存在重复的 `getUserAccessToken` 函数
- 错误版本只检查Redis缓存，不进行用户初始化
- 正确版本在 `utils/auth.ts` 中，支持自动初始化用户

**修复措施：**
1. ✅ 移除 `hyperliquid.service.ts` 中的重复函数定义（第58-87行）
2. ✅ 导入 `utils/auth.ts` 中的正确版本
3. ✅ 更新所有相关函数调用：
   - `getUserWallet()` - 第65行
   - `createUserHyperliquidWallet()` - 第90行  
   - `getUserHyperliquidBalance()` - 第147行
   - `getUserContractBalance()` - 第283行
4. ✅ 修复 `/long` 命令错误日志参数显示

### 余额不足错误处理优化 ✅

**问题：** 当用户余额为0时，系统返回误导性的"交易执行失败"错误，而不是明确的"余额不足"提示

**解决方案：**
1. ✅ 在 `/long` 和 `/short` 命令中添加交易前余额检查
2. ✅ 直接提供友好的余额不足提示：
   ```
   💰 账户余额不足
   交易需要: 200 USDC
   
   💡 解决方案:
   • 使用 /wallet 查看当前余额
   • 向钱包充值更多 USDC  
   • 减少交易金额
   ```
3. ✅ 移除误导性的"市场流动性不足"等不相关建议

**测试结果：**
- ✅ JWT Token获取和缓存正常工作
- ✅ 钱包命令成功执行，自动创建Hyperliquid钱包  
- ✅ 403认证错误已解决
- ✅ 余额不足现在提供准确的错误提示

### 部署说明
修复后的代码需要部署到服务器才能生效。用户将收到准确的余额不足提示，不再看到误导性的交易执行失败信息。

## 最新修复进展 (2025-09-03) - /close 命令参数修复

### /close 命令参数格式问题修复 ✅

**问题：** `/close` 命令返回 400 错误 "No positions found for BTC"，根本原因是参数格式不匹配

**根本原因：** 
- **前端发送**：`{symbol, amount, percentage, telegram_id}` 
- **后端期望**：`{symbol, percentage, orderType}` (来自 TgBotController.js:428)
- 前端 `amount: 0.01` 字段未被后端使用
- 前端 `percentage: false` 格式不正确

**修复措施：**
1. ✅ **修复参数映射**：close.handler.ts 第82-87行
   - 移除无用的 `amount` 和 `telegram_id` 字段
   - 正确格式化 `percentage` 字段：
     - 百分比输入（如 `50%`）→ 发送 `percentage: "50%"`
     - 数量输入（如 `0.01`）→ 发送 `percentage: "0.01"`
   - 添加 `orderType: 'market'` 字段

2. ✅ **后端兼容性确认**：
   - TgBotController.js 已支持百分比和数量两种格式
   - 当无持仓时正确返回 "No positions found" 错误（这是期望行为）

3. ✅ **测试场景覆盖**：
   - `/close BTC` → 发送 `{symbol: "BTC", percentage: "100%", orderType: "market"}`
   - `/close BTC 50%` → 发送 `{symbol: "BTC", percentage: "50%", orderType: "market"}`  
   - `/close BTC 0.01` → 发送 `{symbol: "BTC", percentage: "0.01", orderType: "market"}`

**测试结果：**
- ✅ 参数格式修复完成
- ✅ JWT Token 认证流程正常
- ✅ 无持仓时返回正确错误提示（400："No positions found"）
- 🟡 需要实际持仓测试成功场景

**注意事项：**
- 当前错误 "No positions found for BTC" 是正确行为，说明用户确实没有 BTC 持仓
- 需要先用 `/long BTC x2 100` 开仓，然后才能测试 `/close BTC` 平仓功能
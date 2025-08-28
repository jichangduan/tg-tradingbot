# 🚀 AIW3 TGBot 部署指南

## 📋 前置要求

### 系统要求
- Node.js >= 18.0.0
- npm或yarn包管理器

### 外部依赖  
- Telegram Bot Token
- AIW3 API访问权限和密钥

## 🤖 Telegram Bot 信息
- **Bot Name**: yuze_trading_bot
- **Bot Username**: @yuze_trading_bot
- **Token**: `8287517157:AAHLMiOfpc37V43biAa7UcQz10j9NHe6Bf0`

## 🔗 API 配置信息
- **API Base URL**: `https://api-test1.aiw3.ai`
- **API Key**: `J0nWlQ3mOp9a8yR6KzXuVbL7TsI2dFx4`
- **认证方式**: Bearer Token Authentication
- **超时设置**: 10秒

## 📦 快速部署

### 1. 克隆和安装
```bash
cd aiw3-tgbot
npm install
```

### 2. 环境配置
创建 `.env.development` 文件：
```bash
# Telegram Bot配置
TELEGRAM_BOT_TOKEN=8287517157:AAHLMiOfpc37V43biAa7UcQz10j9NHe6Bf0

# API配置
API_BASE_URL=https://api-test1.aiw3.ai
API_KEY=J0nWlQ3mOp9a8yR6KzXuVbL7TsI2dFx4
API_TIMEOUT=10000

# 环境标识
NODE_ENV=development
```

## 🔍 当前API使用详情

### 主要接口调用
1. **价格查询接口**
   - **路径**: `GET /api/birdeye/token_trending`
   - **完整URL示例**: `https://api-test1.aiw3.ai/api/birdeye/token_trending`
   - **用途**: `/price BTC` 命令的数据源（从trending列表中查找匹配token）
   - **查找策略**: 直接匹配、别名映射(BTC→WBTC)、模糊匹配

2. **健康检查接口**
   - **路径**: `GET /health`
   - **完整URL**: `https://api-test1.aiw3.ai/health`
   - **用途**: 应用启动时的API连通性检测

### 请求头配置
```http
Content-Type: application/json
User-Agent: AIW3-TGBot/1.0
Accept: application/json
x-api-key: J0nWlQ3mOp9a8yR6KzXuVbL7TsI2dFx4
```

### 问题状态 (已修复 ✅)
- **✅ 已修复**: API认证头格式错误已解决
- **✅ 已修复**: 更换为BirdEye trending API接口
- **✅ 已修复**: 实现智能symbol匹配逻辑
- **解决方案**: 使用 `/api/birdeye/token_trending` 接口 + 智能匹配
- **当前状态**: `/price BTC` 命令应该可以正常工作

### 3. 构建和启动
```bash
# 构建项目
npm run build

# 启动应用
npm start

# 开发模式（推荐用于调试）
npm run dev
```

## 🔍 进程管理

### 停止Bot
```bash
# 找到并停止node进程
pkill -f "node dist/index.js"

# 或者使用PM2管理（可选）
pm2 stop aiw3-tgbot
```

### 查看日志
```bash
# 实时查看控制台输出
npm start

# 查看错误日志（如果配置了文件日志）  
tail -f logs/tgbot.log
```

## 🐛 故障排除

### API权限问题 (已解决 ✅)
问题已通过修复认证头格式解决。如果仍有问题：

**排查步骤:**
1. 检查环境变量中的API_KEY是否正确
2. 确认API地址 `https://api-test1.aiw3.ai` 可访问
3. 验证请求头使用 `x-api-key` 而非 `Authorization`

### 其他常见问题
- **Bot Token无效**: 检查 `TELEGRAM_BOT_TOKEN` 环境变量
- **网络连接失败**: 检查API地址可访问性
- **构建失败**: 确保Node.js版本 >= 18
- **进程未启动**: 使用 `ps aux | grep node` 检查进程状态

---

## 🎯 验收检查

**基本功能测试:**
- [x] Bot启动无错误 ✅
- [x] API服务健康检查通过 ✅  
- [ ] `/start` 命令有响应 (待测试)
- [ ] `/price BTC` 返回价格信息 (待测试，预期成功)

**部署成功标志**: Bot能正常响应 `/price BTC` 命令并返回价格信息。

---

## 🔧 代码调用链路 (供后端排查)

### API调用流程
```
用户: /price BTC
  ↓
PriceHandler (src/bot/handlers/price.handler.ts:61)
  ↓ 
TokenService.getTokenPrice() (src/services/token.service.ts:32)
  ↓
TokenService.fetchTokenPriceFromApi() (src/services/token.service.ts:84)
  ↓ 调用trending API
HTTP GET https://api-test1.aiw3.ai/api/birdeye/token_trending
  ↓ 智能匹配算法
TokenService.findMatchingToken() (src/services/token.service.ts:125)
  ↓ 1. 别名映射: BTC → WBTC
  ↓ 2. 直接匹配: symbol === WBTC
  ↓ 3. 模糊匹配: name包含关键词
  ↓ 4. 扩展匹配: 包含USDT等后缀
  ↓
返回匹配的token数据
```

### 错误处理链路
```
API返回 HTTP 403
  ↓
ApiService.handleApiError() (src/services/api.service.ts:207)
  ↓ 状态码233行: message = '访问权限不足'
  ↓
TokenService.handleTokenError() (src/services/token.service.ts:315)
  ↓
PriceHandler.handleServiceError() (src/services/price.handler.ts:151)
  ↓
用户收到: "❌ 查询失败\n查询 BTC 价格失败: 访问权限不足"
```

### 关键配置位置
- **API基础配置**: `src/config/index.ts:35-41`
- **认证头设置**: `src/services/api.service.ts:46-54`  
- **接口调用**: `src/services/token.service.ts:88-90`

---

**文档版本**: v1.2.0 (精简版)  
**最后更新**: 2025-08-23  
**维护者**: AIW3 Backend Team
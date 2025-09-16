# TGBot 生产环境配置清单

## 主要配置修改

**环境标识**
- 测试环境: NODE_ENV=test
- 生产环境: NODE_ENV=production

**Telegram Bot Token**
- 测试环境: 8287517157:AAHLMiOfpc37V43biAa7UcQz10j9NHe6Bf0
- 生产环境: 8206714128:AAGXaS0IjjIDIdCBXZpZyvVHyy8K8LBLvs8

**Bot 用户名**
- 测试环境: yuze_trading_bot
- 生产环境: aiw3_tradebot

**AIW3 后台 API 地址**
- 测试环境: https://api-test1.aiw3.ai
- 生产环境: https://api.aiw3.ai

**AIW3 API Key**
- 测试环境: J0nWlQ3mOp9a8yR6KzXuVbL7TsI2dFx4
- 生产环境: 使用相同测试环境Key (已确认)

**Hyperliquid API**
- 测试环境: https://api-ui.hyperliquid-testnet.xyz
- 生产环境: https://api.hyperliquid.xyz

**Redis 配置**
- 测试环境: localhost (无密码)
- 生产环境: 沿用现有配置 (不需要修改)

**管理员 Chat ID**
- 测试环境: 未设置
- 生产环境: 沿用现有配置 (不需要修改)

**日志级别**
- 测试环境: info
- 生产环境: warn


## 需要切换的API接口

**AIW3后台服务** (24个接口都要换域名)
从 https://api-test1.aiw3.ai 改为 https://api.aiw3.ai

主要接口:
- /api/tgbot/user/init (用户初始化)
- /api/tgbot/trading/long (做多)
- /api/tgbot/trading/short (做空) 
- /api/tgbot/trading/close (平仓)
- /api/tgbot/trading/positions (持仓)
- /api/tgbot/trading/pnl (盈亏)
- /api/birdeye/token_trending (代币价格)
- /api/user/push-settings (推送设置)
- /api/reward/inviteRecord (邀请记录)
- 还有15个hyperliquid相关接口

**Hyperliquid直接调用**
从 https://api-ui.hyperliquid-testnet.xyz/info 改为 https://api.hyperliquid.xyz/info

**第三方API** (无需修改)
- Binance API: https://api.binance.com 
- CoinGecko API: https://api.coingecko.com
- QuickChart: https://quickchart.io
- Solana RPC: https://api.mainnet-beta.solana.com

## Docker 配置文件需要的环境变量

```
NODE_ENV=production
TELEGRAM_BOT_TOKEN=8206714128:AAGXaS0IjjIDIdCBXZpZyvVHyy8K8LBLvs8
API_BASE_URL=https://api.aiw3.ai
API_KEY=J0nWlQ3mOp9a8yR6KzXuVbL7TsI2dFx4
LOG_LEVEL=warn
PUSH_INTERVAL_MINUTES=20
```

## ✅ 配置已确认完成

所有生产环境配置已确定：
- AIW3生产后台域名: https://api.aiw3.ai
- API Key: 沿用测试环境Key
- Redis配置: 沿用现有配置
- 管理员Chat ID: 沿用现有配置

production分支已配置完成，可直接用于生产部署！
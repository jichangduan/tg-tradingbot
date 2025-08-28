# AIW3 Telegram Bot - Price Command

基于Node.js + TypeScript + Telegraf开发的AIW3交易系统Telegram Bot，当前实现`/price`命令用于查询加密货币价格。

## 🚀 快速开始

### 环境要求
- Node.js >= 18.0.0
- Redis >= 4.6.0
- TypeScript >= 5.1.0

### 安装依赖
```bash
npm install
```

### 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，配置必要的环境变量
```

### 开发模式启动
```bash
npm run dev
```

### 构建生产版本
```bash
npm run build
npm start
```

## 📋 功能特性

### 已实现功能
- ✅ `/price <symbol>` - 查询加密货币价格
- ✅ Redis缓存机制 (5分钟TTL)
- ✅ 完善的错误处理和用户提示
- ✅ 结构化日志记录

### 使用示例
- `/price BTC` - 查询BTC价格
- `/price ETH` - 查询ETH价格
- `/price SOL` - 查询SOL价格

## 🏗️ 技术架构

### 技术栈
- **运行时**: Node.js + TypeScript
- **Bot框架**: Telegraf
- **HTTP客户端**: Axios
- **缓存**: Redis
- **日志**: Winston

### 目录结构
```
src/
├── bot/                    # Telegram Bot核心
│   ├── handlers/           # 命令处理器
│   └── utils/              # Bot工具类
├── services/               # 业务服务层
├── config/                 # 配置管理
├── types/                  # TypeScript类型
└── utils/                  # 通用工具
```

## 🧪 测试

### 运行测试
```bash
npm test
```

### 监视模式
```bash
npm run test:watch
```

## 🔧 开发规范

- 每个TypeScript文件 < 350行
- 每个目录 < 8个文件
- 完整的TypeScript类型定义
- 单元测试覆盖率 > 80%

## 📚 文档

详细的开发文档请参考：
- [开发实施计划](../docs/development/tgbot_price_implementation_plan.md)
- [架构设计文档](../docs/architecture/tgbot_price_architecture.md)
- [后端任务交接](../docs/development/backend_task_handoff.md)

## 🤝 贡献

请参考项目根目录的 `CLAUDE.md` 了解开发规范和协作流程。

---

**版本**: v1.0.0  
**最后更新**: 2025-08-21
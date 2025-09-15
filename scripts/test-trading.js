#!/usr/bin/env node

/**
 * 双模式交易系统测试脚本
 * 
 * 用于测试交易状态管理、消息格式化和基本功能
 * 运行: node scripts/test-trading.js
 */

const { tradingStateService } = require('../dist/services/trading-state.service');
const { messageFormatter } = require('../dist/bot/utils/message.formatter');
const { logger } = require('../dist/utils/logger');

async function runTests() {
  console.log('Starting trading system tests...');
  
  // 测试用户ID
  const testUserId = '12345678';
  
  try {
    // 测试1: 交易状态管理
    console.log('Testing trading state management...');
    
    // 创建交易状态
    const state1 = await tradingStateService.createState(testUserId, 'long');
    console.log('State created successfully');
    
    // 更新状态
    const state2 = await tradingStateService.updateState(testUserId, {
      symbol: 'BTC',
      step: 'leverage'
    });
    console.log('State updated successfully');
    
    // 获取状态
    const state3 = await tradingStateService.getState(testUserId);
    console.log('State retrieved successfully:', state3 !== null);
    
    // 验证状态
    const validation = tradingStateService.validateStateForExecution(state2);
    console.log('State validation result:', validation);
    
    // 测试2: 消息格式化
    console.log('Testing message formatting...');
    
    // 代币选择提示
    const symbolPrompt = messageFormatter.formatTradingSymbolPrompt('long');
    console.log('Symbol prompt generated successfully');
    
    // 杠杆选择提示
    const leveragePrompt = messageFormatter.formatTradingLeveragePrompt('long', 'BTC', 45000, 100.5);
    console.log('Leverage prompt generated successfully');
    
    // 金额输入提示
    const amountPrompt = messageFormatter.formatTradingAmountPrompt('long', 'BTC', '3x', 100.5);
    console.log('Amount prompt generated successfully');
    
    // 订单预览
    const orderPreview = messageFormatter.formatTradingOrderPreview(
      'long', 'BTC', '3x', '100', 45000, 0.00667, 36000
    );
    console.log('Order preview generated successfully');
    
    // 测试3: 错误处理
    console.log('Testing error handling...');
    
    // 尝试获取不存在的状态
    const nonExistentState = await tradingStateService.getState('999999');
    console.log('Non-existent state handled correctly:', nonExistentState === null);
    
    // 清理状态
    await tradingStateService.clearState(testUserId);
    console.log('State cleanup successful');
    
    // 测试4: 性能测试
    console.log('Testing performance...');
    
    const startTime = Date.now();
    
    // 批量创建和清理状态
    for (let i = 0; i < 10; i++) {
      const userId = `test_${i}`;
      await tradingStateService.createState(userId, 'long');
      await tradingStateService.updateState(userId, { symbol: 'BTC', leverage: '2x' });
      await tradingStateService.clearState(userId);
    }
    
    const duration = Date.now() - startTime;
    console.log(`Batch operations completed in ${duration}ms`);
    
    console.log('All tests completed successfully!');
    
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// 仅在直接运行时执行测试
if (require.main === module) {
  runTests()
    .then(() => {
      console.log('Test script execution completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test script execution failed:', error);
      process.exit(1);
    });
}

module.exports = { runTests };
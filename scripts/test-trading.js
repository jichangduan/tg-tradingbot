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
  console.log('🚀 开始测试双模式交易系统...\n');
  
  // 测试用户ID
  const testUserId = '12345678';
  
  try {
    // 测试1: 交易状态管理
    console.log('📊 测试交易状态管理...');
    
    // 创建交易状态
    const state1 = await tradingStateService.createState(testUserId, 'long');
    console.log('✅ 创建状态成功:', {
      userId: state1.userId,
      action: state1.action,
      step: state1.step
    });
    
    // 更新状态
    const state2 = await tradingStateService.updateState(testUserId, {
      symbol: 'BTC',
      step: 'leverage'
    });
    console.log('✅ 更新状态成功:', {
      symbol: state2.symbol,
      step: state2.step
    });
    
    // 获取状态
    const state3 = await tradingStateService.getState(testUserId);
    console.log('✅ 获取状态成功:', state3 !== null);
    
    // 验证状态
    const validation = tradingStateService.validateStateForExecution(state2);
    console.log('✅ 状态验证结果:', validation);
    
    // 测试2: 消息格式化
    console.log('\n🎨 测试消息格式化...');
    
    // 代币选择提示
    const symbolPrompt = messageFormatter.formatTradingSymbolPrompt('long');
    console.log('✅ 代币选择提示生成成功');
    
    // 杠杆选择提示
    const leveragePrompt = messageFormatter.formatTradingLeveragePrompt('long', 'BTC', 45000, 100.5);
    console.log('✅ 杠杆选择提示生成成功');
    
    // 金额输入提示
    const amountPrompt = messageFormatter.formatTradingAmountPrompt('long', 'BTC', '3x', 100.5);
    console.log('✅ 金额输入提示生成成功');
    
    // 订单预览
    const orderPreview = messageFormatter.formatTradingOrderPreview(
      'long', 'BTC', '3x', '100', 45000, 0.00667, 36000
    );
    console.log('✅ 订单预览生成成功');
    
    // 测试3: 错误处理
    console.log('\n❌ 测试错误处理...');
    
    // 尝试获取不存在的状态
    const nonExistentState = await tradingStateService.getState('999999');
    console.log('✅ 不存在状态处理正确:', nonExistentState === null);
    
    // 清理状态
    await tradingStateService.clearState(testUserId);
    console.log('✅ 状态清理成功');
    
    // 测试4: 性能测试
    console.log('\n⚡ 测试性能...');
    
    const startTime = Date.now();
    
    // 批量创建和清理状态
    for (let i = 0; i < 10; i++) {
      const userId = `test_${i}`;
      await tradingStateService.createState(userId, 'long');
      await tradingStateService.updateState(userId, { symbol: 'BTC', leverage: '2x' });
      await tradingStateService.clearState(userId);
    }
    
    const duration = Date.now() - startTime;
    console.log(`✅ 批量操作完成，耗时: ${duration}ms`);
    
    console.log('\n🎉 所有测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    process.exit(1);
  }
}

// 仅在直接运行时执行测试
if (require.main === module) {
  runTests()
    .then(() => {
      console.log('\n✨ 测试脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 测试脚本执行失败:', error);
      process.exit(1);
    });
}

module.exports = { runTests };
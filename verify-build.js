#!/usr/bin/env node

/**
 * 验证构建文件完整性脚本
 * 模拟生产环境验证流程
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 TGBot Build Verification Script');
console.log('=====================================\n');

// 1. 检查构建目录结构
console.log('📁 Checking build directory structure...');
const requiredDirs = ['dist', 'dist/locales', 'dist/services', 'dist/bot'];
const requiredFiles = [
  'dist/index.js',
  'dist/services/i18n.service.js',
  'dist/locales/en.json',
  'dist/locales/zh-CN.json',
  'dist/locales/ko.json'
];

let allChecksPass = true;

// 检查目录
for (const dir of requiredDirs) {
  if (fs.existsSync(dir)) {
    console.log(`✅ ${dir} - exists`);
  } else {
    console.log(`❌ ${dir} - missing`);
    allChecksPass = false;
  }
}

console.log();

// 检查文件
console.log('📄 Checking required files...');
for (const file of requiredFiles) {
  if (fs.existsSync(file)) {
    const stats = fs.statSync(file);
    console.log(`✅ ${file} - exists (${Math.round(stats.size / 1024)}KB)`);
  } else {
    console.log(`❌ ${file} - missing`);
    allChecksPass = false;
  }
}

console.log();

// 2. 验证locale文件内容
console.log('🌍 Checking locale file contents...');
const locales = ['en', 'zh-CN', 'ko'];
const requiredKeys = ['welcome.title', 'language.current', 'system.success'];

for (const locale of locales) {
  const localeFile = `dist/locales/${locale}.json`;
  if (fs.existsSync(localeFile)) {
    try {
      const content = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
      const missingKeys = requiredKeys.filter(key => !content[key]);
      
      if (missingKeys.length === 0) {
        console.log(`✅ ${locale}.json - all keys present (${Object.keys(content).length} total)`);
      } else {
        console.log(`❌ ${locale}.json - missing keys: ${missingKeys.join(', ')}`);
        allChecksPass = false;
      }
    } catch (error) {
      console.log(`❌ ${locale}.json - invalid JSON: ${error.message}`);
      allChecksPass = false;
    }
  }
}

console.log();

// 3. 测试多语言服务加载
console.log('🧪 Testing multilingual service...');
try {
  // 动态加载 i18n 服务
  const { i18nService } = require('./dist/services/i18n.service.js');
  
  setTimeout(async () => {
    try {
      const stats = i18nService.getStats();
      console.log(`✅ I18nService loaded - supports: ${stats.supportedLocales.join(', ')}`);
      
      // 测试翻译加载
      const welcomeEn = await i18nService.__('welcome.title', 'en');
      const welcomeZh = await i18nService.__('welcome.title', 'zh-CN');  
      const welcomeKo = await i18nService.__('welcome.title', 'ko');
      
      if (welcomeEn.includes('Welcome') && welcomeZh.includes('欢迎') && welcomeKo.includes('환영')) {
        console.log('✅ Translation functionality verified');
      } else {
        console.log('❌ Translation functionality failed');
        allChecksPass = false;
      }
      
      console.log();
      
      // 最终结果
      console.log('🎯 Final Result');
      console.log('================');
      if (allChecksPass) {
        console.log('✅ BUILD VERIFICATION PASSED - Ready for production deployment');
        process.exit(0);
      } else {
        console.log('❌ BUILD VERIFICATION FAILED - Issues found');
        process.exit(1);
      }
      
    } catch (error) {
      console.log(`❌ Translation test failed: ${error.message}`);
      console.log();
      console.log('❌ BUILD VERIFICATION FAILED - Translation issues');
      process.exit(1);
    }
  }, 1000);
  
} catch (error) {
  console.log(`❌ I18nService loading failed: ${error.message}`);
  allChecksPass = false;
  
  console.log();
  console.log('❌ BUILD VERIFICATION FAILED - Service loading issues');
  process.exit(1);
}
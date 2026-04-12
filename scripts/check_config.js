// scripts/check_config.js - 检查配置状态（用于 workflow 条件判断）
const { getConfig } = require('./config');

const config = getConfig();

// 输出配置状态（供 GitHub Actions 使用）
// 使用 ::set-output 格式（兼容旧版）和 GITHUB_OUTPUT 环境变量
const emailEnabled = config.emailEnabled === 'on' ? 'true' : 'false';
const crawlerEnabled = config.crawlerEnabled === 'on' ? 'true' : 'false';
const wechatEnabled = config.wechatEnabled === 'on' ? 'true' : 'false';

// 输出到 GITHUB_OUTPUT（GitHub Actions 标准方式）
const fs = require('fs');
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `emailEnabled=${emailEnabled}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `crawlerEnabled=${crawlerEnabled}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `wechatEnabled=${wechatEnabled}\n`);
} else {
  // 如果没有 GITHUB_OUTPUT，输出到标准输出（用于调试）
  console.log(`emailEnabled=${emailEnabled}`);
  console.log(`crawlerEnabled=${crawlerEnabled}`);
  console.log(`wechatEnabled=${wechatEnabled}`);
}

// 输出到日志
console.log(`📊 配置状态:`);
console.log(`  邮箱发送: ${emailEnabled}`);
console.log(`  爬虫功能: ${crawlerEnabled}`);
console.log(`  微信推送: ${wechatEnabled}`);

process.exit(0);

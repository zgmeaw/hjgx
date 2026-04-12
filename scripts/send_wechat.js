// scripts/send_wechat.js - 发送微信推送通知
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { isWechatEnabled } = require('./config');

// 发送微信推送
async function sendWeChatPush() {
  const wxWorkerUrl = process.env.WX_WORKER_URL;
  const wxToken = process.env.WX_TOKEN;
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  // 如果未配置微信推送，跳过
  if (!wxWorkerUrl || !wxToken) {
    console.log('ℹ️ 未配置微信推送（WX_WORKER_URL 或 WX_TOKEN），跳过微信推送');
    return;
  }
  
  // 检查微信推送功能是否启用
  if (!isWechatEnabled()) {
    console.log('ℹ️ 微信推送功能已关闭，跳过微信推送');
    return;
  }
  
  if (!encryptKey) {
    console.error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于解密数据');
    process.exit(1);
  }
  
  // 解密函数
  function decryptData(encryptedData, key) {
    const crypto = require('crypto');
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted data format');
      }
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = Buffer.from(parts[1], 'hex');
      const keyHash = crypto.createHash('sha256').update(key).digest();
      const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return JSON.parse(decrypted.toString());
    } catch (e) {
      throw new Error(`解密失败: ${e.message}`);
    }
  }
  
  // 读取A记录（当天更新的帖子，加密的）
  // 使用北京时间生成日期，与 update.js 保持一致
  const now = new Date();
  const beijingTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const year = beijingTime.getFullYear();
  const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`; // YYYY-MM-DD (北京时间)
  const dailyFile = path.join(__dirname, `../data/daily_${today}.enc`);
  
  let postCount = 0;
  if (fs.existsSync(dailyFile)) {
    try {
      const encryptedData = fs.readFileSync(dailyFile, 'utf-8');
      const bloggers = decryptData(encryptedData, encryptKey);
      // 统计当天更新的所有帖子数量
      postCount = bloggers.reduce((sum, blogger) => sum + (blogger.posts ? blogger.posts.length : 0), 0);
      console.log(`✓ 读取到A记录，共 ${postCount} 条今日更新的帖子`);
    } catch (e) {
      console.error(`❌ 读取A记录失败: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log('ℹ️ 今日无更新数据，不发送微信推送');
    return;
  }
  
  // 如果没有内容，不发送
  if (postCount === 0) {
    console.log('ℹ️ 今日无新内容，不发送微信推送');
    return;
  }
  
  // 构建推送内容
  const title = '动态监控站 - 每日更新';
  const dateStr = new Date().toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    timeZone: 'Asia/Shanghai'
  });
  const content = `今日有 ${postCount} 条新内容\n\n${dateStr}\n\n请访问网站查看详情`;
  
  // 使用默认网站地址
  const siteUrl = 'https://hj.meaw.top';
  
  // 构建请求 URL（使用 GET 方式）
  // WX_WORKER_URL 应该是完整的 URL，例如：https://your-worker.workers.dev/wxsend
  // 如果只提供了基础 URL，自动添加 /wxsend 路径
  let apiUrl = wxWorkerUrl.trim();
  if (!apiUrl.endsWith('/wxsend') && !apiUrl.includes('/wxsend?')) {
    apiUrl = apiUrl.replace(/\/$/, '') + '/wxsend';
  }
  
  const url = new URL(apiUrl);
  url.searchParams.set('token', wxToken);
  url.searchParams.set('title', title);
  url.searchParams.set('content', content);
  url.searchParams.set('site', siteUrl);
  
  try {
    const result = await new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      
      client.get(url.toString(), (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
    
    console.log('✓ 微信推送发送成功');
    console.log(`  响应: ${result}`);
  } catch (error) {
    console.error('❌ 微信推送发送失败:', error.message);
    // 微信推送失败不影响整体流程，只记录错误
    process.exit(1);
  }
}

// 主函数
if (require.main === module) {
  sendWeChatPush().catch(console.error);
}

module.exports = { sendWeChatPush };

// scripts/send_email_manual.js - 手动触发邮件发送（发送所有博主最新帖子）
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { sendWeChatPush } = require('./send_email');

// 转义HTML特殊字符
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 转义JavaScript字符串中的特殊字符
function escapeJsString(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}


// 生成邮件HTML内容（简化版：只显示数量）
function generateEmailHTML(postCount) {
  const now = new Date().toLocaleString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai'
  });
  
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>动态监控日报</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 20px;
    margin: 0;
  }
  .email-container {
    max-width: 600px;
    margin: 0 auto;
    background: white;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .email-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 40px 20px;
    text-align: center;
  }
  .email-header h1 {
    font-size: 28px;
    margin-bottom: 10px;
    font-weight: 800;
  }
  .email-content {
    padding: 40px 20px;
    text-align: center;
  }
  .count-number {
    font-size: 48px;
    font-weight: 800;
    color: #667eea;
    margin: 20px 0;
  }
  .count-text {
    font-size: 18px;
    color: #2d3748;
    margin-bottom: 10px;
  }
  .date-text {
    font-size: 14px;
    color: #718096;
    margin-top: 20px;
  }
  .email-footer {
    text-align: center;
    padding: 20px;
    color: #718096;
    font-size: 12px;
    background: #f7fafc;
  }
</style>
</head>
<body>
<div class="email-container">
  <div class="email-header">
    <h1>🌊 动态监控站</h1>
    <p>${now}</p>
  </div>
  <div class="email-content">
    <div class="count-text">今日有</div>
    <div class="count-number">${postCount}</div>
    <div class="count-text">条新内容</div>
    <div class="date-text">请访问网站查看详情</div>
  </div>
  <div class="email-footer">
    <p>2025 | 手动发送</p>
  </div>
</div>
</body>
</html>`;

  return html;
}

// 发送邮件
async function sendEmail() {
  const sender = process.env.QQ_MAIL;
  const authCode = process.env.QQ_AUTH_CODE;
  
  if (!sender || !authCode) {
    console.error('❌ 缺少环境变量: QQ_MAIL 或 QQ_AUTH_CODE');
    process.exit(1);
  }
  
  // 解密函数
  function decryptData(encryptedData, key) {
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
  
  // 读取B记录（所有博主最新3条帖子，加密的）
  const latestFile = path.join(__dirname, '../data/bloggers_latest.enc');
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    console.error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于解密数据');
    process.exit(1);
  }
  
  let bloggers = [];
  if (fs.existsSync(latestFile)) {
    try {
      const encryptedData = fs.readFileSync(latestFile, 'utf-8');
      bloggers = decryptData(encryptedData, encryptKey);
      console.log(`✓ 读取到 ${bloggers.length} 个博主的最新数据`);
    } catch (e) {
      console.error(`❌ 读取B记录失败: ${e.message}`);
      console.log('ℹ️ 请先运行 Hourly Update 生成数据');
      process.exit(1);
    }
  } else {
    console.log('ℹ️ B记录文件不存在，请先运行 Hourly Update 生成数据');
    process.exit(1);
  }
  
  if (bloggers.length === 0) {
    console.log('ℹ️ 未获取到任何博主数据，不发送邮件');
    return;
  }
  
  // 统计所有帖子数量
  const postCount = bloggers.reduce((sum, blogger) => sum + (blogger.posts ? blogger.posts.length : 0), 0);
  
  // 生成邮件内容
  const html = generateEmailHTML(postCount);
  
  // 创建邮件传输器
  const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: {
      user: sender,
      pass: authCode
    }
  });
  
  // 邮件选项
  const now = new Date().toLocaleString('zh-CN', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai'
  });
  
  const mailOptions = {
    from: `"动态监控站" <${sender}>`,
    to: sender,
    subject: `动态监控站 - 最新动态 (${now})`,
    html: html
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✓ 邮件发送成功');
    console.log(`  消息ID: ${info.messageId}`);
  } catch (error) {
    console.error('❌ 邮件发送失败:', error.message);
    process.exit(1);
  }
  
  // 发送微信推送（如果启用）
  const dateStr = new Date().toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    timeZone: 'Asia/Shanghai'
  });
  await sendWeChatPush(postCount, dateStr);
}

// 主函数
if (require.main === module) {
  sendEmail().catch(console.error);
}

module.exports = { sendEmail, generateEmailHTML };


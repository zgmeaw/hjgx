// scripts/send_email.js - 发送邮件通知
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { isEmailEnabled } = require('./config');

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


// 生成邮件HTML内容（简化版：只显示数量）
function generateEmailHTML(postCount) {
  const today = new Date().toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
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
    <p>${today}</p>
  </div>
  <div class="email-content">
    <div class="count-text">今日有</div>
    <div class="count-number">${postCount}</div>
    <div class="count-text">条新内容</div>
    <div class="date-text">请访问网站查看详情</div>
  </div>
  <div class="email-footer">
    <p>2025 | 自动发送</p>
  </div>
</div>
</body>
</html>`;

  return html;
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

// 发送邮件
async function sendEmail() {
  // 检查定时邮箱功能是否启用
  if (!isEmailEnabled()) {
    console.log('ℹ️ 定时邮箱发送功能已关闭，跳过执行');
    return;
  }
  
  const sender = process.env.QQ_MAIL;
  const authCode = process.env.QQ_AUTH_CODE;
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!sender || !authCode) {
    console.error('❌ 缺少环境变量: QQ_MAIL 或 QQ_AUTH_CODE');
    process.exit(1);
  }
  
  if (!encryptKey) {
    console.error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于解密数据');
    process.exit(1);
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
    console.log('ℹ️ 今日无更新数据，不发送邮件和微信推送');
    return;
  }
  
  // 如果没有内容，不发送
  if (postCount === 0) {
    console.log('ℹ️ 今日无新内容，不发送邮件和微信推送');
    return;
  }
  
  // 生成邮件内容
  const html = generateEmailHTML(postCount);
  
  // 创建邮件传输器
  const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true, // 使用 SSL
    auth: {
      user: sender,
      pass: authCode
    }
  });
  
  // 邮件选项
  const todayStr = new Date().toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    timeZone: 'Asia/Shanghai'
  });
  
  const mailOptions = {
    from: `"动态监控站" <${sender}>`,
    to: sender, // 发给自己
    subject: `动态监控日报 - ${todayStr}`,
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
  
  // 注意：微信推送已独立到 send_wechat.js，不再在此处发送
}

// 主函数
if (require.main === module) {
  sendEmail().catch(console.error);
}

module.exports = { sendEmail, generateEmailHTML };


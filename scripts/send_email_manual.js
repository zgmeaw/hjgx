// scripts/send_email_manual.js - 手动触发邮件发送（发送所有博主最新帖子）
const nodemailer = require('nodemailer');
const { getBloggers } = require('./update');

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

// 生成邮件HTML内容（类似网页效果）
function generateEmailHTML(bloggers) {
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
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 20px;
    line-height: 1.6;
  }
  .email-container {
    max-width: 800px;
    margin: 0 auto;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .email-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 30px 20px;
    text-align: center;
  }
  .email-header h1 {
    font-size: 24px;
    margin-bottom: 10px;
    font-weight: 800;
  }
  .email-header p {
    font-size: 14px;
    opacity: 0.9;
  }
  .email-content {
    padding: 30px 20px;
  }
  .card {
    background: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 12px;
    margin-bottom: 24px;
    overflow: hidden;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }
  .card-header {
    padding: 20px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    background: rgba(255, 255, 255, 0.5);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .name-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .name {
    font-weight: 700;
    font-size: 18px;
    color: #2d3748;
  }
  .name::before {
    content: "👤";
    margin-right: 8px;
  }
  .homepage-link {
    display: inline-block;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(102, 126, 234, 0.2);
    border: 1px solid rgba(102, 126, 234, 0.3);
    text-align: center;
    line-height: 32px;
    text-decoration: none;
    color: #667eea;
    font-size: 16px;
    transition: all 0.3s;
  }
  .homepage-link:hover {
    background: rgba(102, 126, 234, 0.3);
    transform: scale(1.1);
  }
  .badge {
    background: linear-gradient(135deg, #ff6b9d 0%, #ff8fb3 100%);
    color: #fff;
    font-size: 12px;
    padding: 4px 12px;
    border-radius: 12px;
    font-weight: 700;
  }
  .post-list {
    padding: 0;
  }
  .post-item {
    display: flex;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .post-item:last-child {
    border-bottom: none;
  }
  .post-info {
    flex: 1;
    min-width: 0;
    margin-right: 16px;
  }
  .post-title {
    font-size: 16px;
    color: #2d3748;
    font-weight: 600;
    margin-bottom: 8px;
    line-height: 1.5;
  }
  .time {
    font-size: 13px;
    color: #718096;
  }
  .time.new {
    color: #ff6b9d;
    font-weight: 700;
  }
  .thumb {
    flex-shrink: 0;
    width: 100px;
    height: 100px;
    border-radius: 8px;
    overflow: hidden;
    background: #f7fafc;
    border: 2px solid rgba(0, 0, 0, 0.05);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .email-footer {
    text-align: center;
    padding: 20px;
    color: #718096;
    font-size: 12px;
    background: rgba(0, 0, 0, 0.02);
  }
  @media (max-width: 600px) {
    .post-item {
      flex-direction: column;
      align-items: flex-start;
    }
    .post-info {
      margin-right: 0;
      margin-bottom: 12px;
      width: 100%;
    }
    .thumb {
      width: 100%;
      height: 200px;
    }
  }
</style>
</head>
<body>
<div class="email-container">
  <div class="email-header">
    <h1>🌊 动态监控站</h1>
    <p>最新动态 - ${now}</p>
  </div>
  <div class="email-content">`;

  if (bloggers.length === 0) {
    html += `
    <div class="card">
      <div style="padding: 40px; text-align: center; color: #718096;">
        <p style="font-size: 16px;">暂无数据</p>
      </div>
    </div>`;
  } else {
    bloggers.forEach((blogger) => {
      const { nickname, posts, homepageUrl } = blogger;
      const newCount = posts.filter(p => p.isToday).length;
      
      // 只显示有帖子的博主
      if (posts.length === 0) {
        return;
      }
      
      html += `<div class="card">
        <div class="card-header">
          <div class="name-wrapper">
            <span class="name">${escapeHtml(nickname)}</span>
            <a href="${escapeHtml(homepageUrl || '#')}" target="_blank" class="homepage-link" title="访问博主主页">
              ↗
            </a>
          </div>
          ${newCount > 0 ? '<span class="badge">✨ 今日更新</span>' : ''}
        </div>
        <div class="post-list">`;

      posts.forEach(p => {
        const timeClass = p.isToday ? 'time new' : 'time';
        
        // 处理图片
        let imgHtml = '';
        if (p.images && Array.isArray(p.images) && p.images.length > 0) {
          const firstImg = p.images[0];
          if (firstImg && firstImg.trim() !== '') {
            let imgSrc = firstImg;
            if (!imgSrc.startsWith('data:image')) {
              imgSrc = imgSrc.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
            }
            imgHtml = `<div class="thumb">
              <img src="${imgSrc}" alt="${escapeHtml(p.title)}">
            </div>`;
          }
        }
        
        html += `
          <div class="post-item">
            <div class="post-info">
              <div class="post-title">${escapeHtml(p.title)}</div>
              <div class="${timeClass}">📅 ${escapeHtml(p.time || '未知时间')}</div>
            </div>
            ${imgHtml}
          </div>`;
      });
      
      html += `</div></div>`;
    });
  }

  html += `
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
  
  console.log('开始获取博主数据...');
  
  // 直接复用 update.js 中的 getBloggers 函数
  const bloggers = await getBloggers();
  
  if (bloggers.length === 0) {
    console.log('ℹ️ 未获取到任何博主数据，不发送邮件');
    return;
  }
  
  console.log(`✓ 获取到 ${bloggers.length} 个博主的数据`);
  
  // 生成邮件内容
  const html = generateEmailHTML(bloggers);
  
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
}

// 主函数
if (require.main === module) {
  sendEmail().catch(console.error);
}

module.exports = { sendEmail, generateEmailHTML };


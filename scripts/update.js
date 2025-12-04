// scripts/update.js —— 针对海角社区优化版
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 辅助函数：延迟
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getBloggers() {
  const linksPath = path.join(__dirname, '../links.txt');
  if (!fs.existsSync(linksPath)) {
    console.log('links.txt not found!');
    return [];
  }

  // 读取链接
  const urls = fs.readFileSync(linksPath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  console.log(`计划抓取 ${urls.length} 个博主`);

  const bloggers = [];
  
  // 启动浏览器配置
  const browser = await puppeteer.launch({
    headless: "new", // 新版 headless 模式
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080' // 模拟桌面分辨率，防止移动端布局差异
    ]
  });

  for (const url of urls) {
    console.log(`-------------------------------------------`);
    console.log(`正在访问: ${url}`);
    const page = await browser.newPage();
    
    // 设置高级 User-Agent 防止被识别为爬虫
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      // 1. 访问页面，增加超时时间
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      
      // 2. 尝试处理未登录弹窗 (海角常见的弹窗关闭按钮)
      // 等待几秒让弹窗可能弹出来
      await delay(3000);
      try {
        const closeSelectors = [
          '.ant-modal-close', 
          '.close-btn', 
          'button[aria-label="Close"]', 
          '.van-icon-cross' // 如果是移动端视图
        ];
        for (const selector of closeSelectors) {
          const btn = await page.$(selector);
          if (btn) {
            console.log(`检测到弹窗，尝试关闭: ${selector}`);
            await btn.click();
            await delay(1000);
          }
        }
      } catch (e) {
        console.log('弹窗处理跳过或无弹窗');
      }

      // 3. 提取昵称 (保持你原有的逻辑，稍作优化)
      let nickname = '未知用户';
      try {
        await page.waitForSelector('body'); // 确保body加载
        nickname = await page.evaluate(() => {
          // 尝试查找特定昵称元素，如果找不到则正则匹配全屏
          const nameEl = document.querySelector('.nickname, .user-name, h1');
          if (nameEl) return nameEl.innerText.trim();
          
          const text = document.body.innerText;
          const match = text.match(/(.+?)\s*\(ID:\s*\d+\)/);
          return match ? match[1].trim() : '未知用户';
        });
        console.log(`博主昵称: ${nickname}`);
      } catch (e) {
        console.log(`昵称提取失败: ${e.message}`);
      }

      // 4. 核心：等待帖子列表加载
      // 你提供了 class="titlerow"，这非常关键
      console.log('正在等待帖子列表 (.titlerow) 加载...');
      try {
        // 最多等待 15 秒
        await page.waitForSelector('.titlerow', { timeout: 15000 });
      } catch (e) {
        console.log('⚠️ 超时未找到 .titlerow，尝试截图调试...');
        // 调试：如果找不到帖子，保存截图和HTML，方便排查
        await page.screenshot({ path: `debug_error_${Date.now()}.jpg` });
        const html = await page.content();
        fs.writeFileSync(`debug_source_${Date.now()}.html`, html);
        console.log('已保存调试截图和HTML，请检查 artifact。');
      }

      // 5. 提取帖子数据
      const posts = await page.evaluate(() => {
        const todayStr = new Date().toISOString().slice(5, 10); // "12-03"
        const items = document.querySelectorAll('.titlerow');
        const results = [];

        items.forEach(item => {
          // 限制只取前 5 条，避免处理过多
          if (results.length >= 5) return;

          // --- 标题 & 链接 ---
          // 通常 titlerow 里面会有 a 标签或者本身就是链接
          const linkEl = item.querySelector('a') || item.closest('a');
          const titleEl = item.querySelector('.subject, h3, .title') || linkEl;
          
          if (!titleEl) return;

          const title = titleEl.innerText.trim();
          let link = linkEl ? linkEl.getAttribute('href') : '';
          
          // 补全链接
          if (link && !link.startsWith('http')) {
            link = window.location.origin + link;
          }

          // --- 时间 ---
          // 使用你提供的 createTime 类
          let timeEl = item.querySelector('.createTime');
          let rawTime = timeEl ? timeEl.innerText.trim() : '';
          
          // 简单的时间处理
          let isToday = rawTime.includes(todayStr);

          // --- 图片 ---
          // 使用你提供的 attachments 类
          let imgArr = [];
          const attachEl = item.querySelector('.attachments');
          if (attachEl) {
             const imgs = attachEl.querySelectorAll('img');
             imgs.forEach(img => {
                 let src = img.getAttribute('src') || img.getAttribute('data-src');
                 if (src) imgArr.push(src);
             });
          }

          if (title) {
            results.push({
              title,
              link,
              time: rawTime,
              isToday,
              images: imgArr
            });
          }
        });

        return results;
      });

      console.log(`抓取成功: 发现 ${posts.length} 条帖子`);
      if (posts.length > 0) {
        console.log(`最新一条: ${posts[0].title} | 时间: ${posts[0].time}`);
      }

      bloggers.push({ nickname, posts: posts.slice(0, 3) });

    } catch (err) {
      console.error(`❌ 处理 URL 失败: ${url}`);
      console.error(err);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return bloggers;
}

function generateHTML(bloggers) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  // 简单的 HTML 模板
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海角监控站</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<h1>海角博主动态监控站</h1>
<p style="text-align:center;color:#888">最后更新：${now}</p>
<div class="container">`;

  let hasNew = false;
  bloggers.forEach(({ nickname, posts }) => {
    const newCount = posts.filter(p => p.isToday).length;
    if (newCount > 0) hasNew = true;
    
    // 只有当有帖子时才显示，或者你想显示空博主也可以
    html += `<div class="card">
      <div class="card-header">
        <span class="name">${nickname}</span>
        ${newCount > 0 ? '<span class="badge">今日更新</span>' : ''}
      </div>
      <div class="post-list">`;

    if (posts.length === 0) {
      html += `<div class="empty">暂无获取到数据 (可能需要登录或反爬虫限制)</div>`;
    } else {
      posts.forEach(p => {
        const timeClass = p.isToday ? 'time new' : 'time';
        // 显示第一张图作为预览
        const imgHtml = p.images.length > 0 ? `<div class="thumb"><img src="${p.images[0]}" loading="lazy"></div>` : '';
        
        html += `
        <a href="${p.link}" target="_blank" class="post-item">
          <div class="post-info">
            <div class="title">${p.title}</div>
            <div class="${timeClass}">${p.time}</div>
          </div>
          ${imgHtml}
        </a>`;
      });
    }
    html += `</div></div>`;
  });

  html += `</div>
  <footer>Powered by Puppeteer | <a href="https://github.com/${process.env.GITHUB_REPOSITORY || ''}">Github Repo</a></footer>
  </body></html>`;

  fs.writeFileSync('index.html', html);
  console.log('HTML 生成完毕');
}

async function main() {
  const bloggers = await getBloggers();
  generateHTML(bloggers);
}

main().catch(console.error);
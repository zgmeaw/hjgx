// scripts/update.js —— 样式美化 + 链接修复版
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function getBloggers() {
  const linksPath = path.join(__dirname, '../links.txt');
  if (!fs.existsSync(linksPath)) return [];

  const urls = fs.readFileSync(linksPath, 'utf-8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  // 启动浏览器
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const bloggers = [];

  for (const url of urls) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      console.log(`正在抓取: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // 等待核心元素加载
      try {
        await page.waitForSelector('.titlerow', { timeout: 10000 });
      } catch(e) { console.log('未找到列表，可能加载失败或无数据'); }

      // 1. 获取昵称
      const nickname = await page.evaluate(() => {
        const el = document.querySelector('h1, .nickname, .user-name');
        return el ? el.innerText.trim() : '未知博主';
      });

      // 2. 获取帖子数据 (在浏览器上下文中执行)
      const posts = await page.evaluate(() => {
        const todayStr = new Date().toISOString().slice(5, 10); // "MM-DD"
        const rows = document.querySelectorAll('.titlerow');
        const data = [];

        rows.forEach(row => {
          if (data.length >= 3) return; // 只取前3条

          // --- 提取标题 & 链接 ---
          const linkEl = row.querySelector('a'); // titlerow 下通常直接就是 a 标签或者包含 a
          if (!linkEl) return;
          
          const title = linkEl.innerText.trim();
          let href = linkEl.getAttribute('href');
          
          // 关键修复：补全链接
          if (href && !href.startsWith('http')) {
            href = 'https://www.haijiao.com' + href;
          }

          // --- 提取时间 ---
          const timeEl = row.querySelector('.createTime');
          const time = timeEl ? timeEl.innerText.trim() : '';
          const isToday = time.includes(todayStr);

          // --- 提取图片 ---
          // 图片通常在 .attachments 容器里
          const imgArr = [];
          const attachContainer = row.querySelector('.attachments');
          if (attachContainer) {
            const imgs = attachContainer.querySelectorAll('img');
            imgs.forEach(img => {
              // 关键修复：优先取 data-src 或 src
              const src = img.getAttribute('src') || img.getAttribute('data-src');
              if (src && !src.includes('loading')) { // 过滤掉loading占位图
                imgArr.push(src); 
              }
            });
          }

          if (title) {
            data.push({ title, link: href, time, isToday, images: imgArr });
          }
        });
        return data;
      });

      bloggers.push({ nickname, posts, homeLink: url });
      console.log(`  -> 获取到 ${posts.length} 条数据`);

    } catch (err) {
      console.error(`  -> 错误: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return bloggers;
}

function generateHTML(bloggers) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>海角监控看板</title>
<link rel="stylesheet" href="style.css">
</head>
<body>

<header>
  <div class="header-content">
    <h1>海角动态监控</h1>
    <span class="update-time">更新于: ${now}</span>
  </div>
</header>

<main class="container">`;

  bloggers.forEach(({ nickname, posts, homeLink }) => {
    const hasNew = posts.some(p => p.isToday);
    const statusClass = hasNew ? 'status-new' : '';
    
    html += `
    <section class="blogger-card ${statusClass}">
      <div class="blogger-header">
        <a href="${homeLink}" target="_blank" class="blogger-name">${nickname}</a>
        ${hasNew ? '<span class="badge">今日更新</span>' : ''}
      </div>
      
      <div class="post-list">`;

    if (posts.length === 0) {
      html += `<div class="empty-state">暂无最新数据</div>`;
    } else {
      posts.forEach(p => {
        // 构建图片墙
        let imagesHtml = '';
        if (p.images && p.images.length > 0) {
          imagesHtml = `<div class="img-gallery">`;
          // 最多显示3张预览
          p.images.slice(0, 3).forEach(src => {
            imagesHtml += `<div class="img-box"><img src="${src}" referrerpolicy="no-referrer"></div>`;
          });
          imagesHtml += `</div>`;
        }

        html += `
        <article class="post-item">
          <div class="post-main">
            <a href="${p.link}" target="_blank" class="post-title">${p.title}</a>
            <div class="post-meta">
              <span class="time ${p.isToday ? 'time-today' : ''}">${p.time}</span>
            </div>
          </div>
          ${imagesHtml}
        </article>`;
      });
    }
    html += `</div></section>`;
  });

  html += `</main>
<footer>Powered by GitHub Actions</footer>
</body></html>`;

  fs.writeFileSync('index.html', html);
  console.log('HTML 更新完成');
}

async function main() {
  const data = await getBloggers();
  generateHTML(data);
}

main();
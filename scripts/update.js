// scripts/update.js —— 最终完美修复版
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 辅助函数：延迟等待
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getBloggers() {
  const linksPath = path.join(__dirname, '../links.txt');
  if (!fs.existsSync(linksPath)) {
    console.log('未找到 links.txt');
    return [];
  }

  const urls = fs.readFileSync(linksPath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  // 浏览器启动配置
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080'
    ]
  });

  const bloggers = [];

  for (const url of urls) {
    const page = await browser.newPage();
    // 伪装成桌面浏览器，防止被识别为爬虫或手机端
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      console.log(`正在抓取: ${url}`);
      // 增加超时时间，等待 DOM 加载
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // 尝试等待帖子列表出现 (容错处理)
      try {
        await page.waitForSelector('.titlerow', { timeout: 8000 });
      } catch (e) {
        console.log('  ⚠️ 等待 .titlerow 超时，尝试直接解析');
      }

      // 1. 获取博主昵称
      const nickname = await page.evaluate(() => {
        const el = document.querySelector('h1') || document.querySelector('.nickname') || document.querySelector('.user-name');
        return el ? el.innerText.trim() : '未知博主';
      });

      // 2. 核心：提取帖子数据
      const posts = await page.evaluate(() => {
        const todayStr = new Date().toISOString().slice(5, 10); // "MM-DD"
        // 查找所有帖子行
        const items = document.querySelectorAll('.titlerow');
        const results = [];

        items.forEach(item => {
          if (results.length >= 3) return; // 只取最近3条

          // --- 标题和链接 ---
          const linkEl = item.querySelector('a'); // titlerow 下面通常直接就是 a 标签
          if (!linkEl) return;

          const title = linkEl.innerText.trim();
          let href = linkEl.getAttribute('href'); // 通常是 /post/details?pid=...

          // --- 时间 ---
          // 查找 createTime，可能在 span 里
          const timeEl = item.querySelector('.createTime');
          let rawTime = timeEl ? timeEl.innerText.trim() : '';
          // 简单判断是否是今天 (比如包含 "12-03" 或 "小时前")
          const isToday = rawTime.includes(todayStr) || rawTime.includes('小时') || rawTime.includes('分钟');

          // --- 图片 ---
          // 查找 attachments 容器下的 img
          const imgArr = [];
          const attachEl = item.querySelector('.attachments');
          if (attachEl) {
            const imgs = attachEl.querySelectorAll('img');
            imgs.forEach(img => {
              // 海角通常用 data-src 做懒加载，src 可能是 loading 图
              let src = img.getAttribute('data-src') || img.getAttribute('src');
              if (src && !src.includes('loading') && !src.includes('lazy')) {
                imgArr.push(src);
              }
            });
          }

          if (title) {
            results.push({
              title,
              link: href, // 这里先存原始链接，出来再处理
              time: rawTime,
              isToday,
              images: imgArr
            });
          }
        });

        return results;
      });

      // 3. 数据后期处理（补全链接）
      const processedPosts = posts.map(p => {
        // 使用 URL 类智能补全链接
        try {
          // 如果 href 是 /post/details... 这种相对路径，会自动拼上域名
          p.link = new URL(p.link, 'https://www.haijiao.com').href;
        } catch (e) {
          p.link = 'https://www.haijiao.com' + p.link; // 兜底
        }
        return p;
      });

      bloggers.push({ nickname, posts: processedPosts, homeLink: url });
      console.log(`  -> 成功获取 ${processedPosts.length} 条帖子`);
      if (processedPosts.length > 0) {
        console.log(`     第一条: ${processedPosts[0].title} | ${processedPosts[0].link}`);
      }

    } catch (err) {
      console.error(`  -> 抓取失败: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return bloggers;
}

function generateHTML(bloggers) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  // HTML 头部
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
    <span class="update-time">更新时间: ${now}</span>
  </div>
</header>

<main class="container">`;

  // 循环生成博主卡片
  bloggers.forEach(({ nickname, posts, homeLink }) => {
    // 检查是否有今日新帖
    const hasNew = posts.some(p => p.isToday);
    
    html += `
    <section class="blogger-card">
      <div class="blogger-header">
        <a href="${homeLink}" target="_blank" class="blogger-name">${nickname}</a>
        ${hasNew ? '<span class="badge">🔥 今日更新</span>' : ''}
      </div>
      
      <div class="post-list">`;

    if (posts.length === 0) {
      html += `<div class="empty-state">暂无数据 / 需要登录</div>`;
    } else {
      posts.forEach(p => {
        // 图片墙 HTML
        let imagesHtml = '';
        if (p.images && p.images.length > 0) {
          imagesHtml = `<div class="img-gallery">`;
          // 显示前3张图
          p.images.slice(0, 3).forEach(src => {
            // 添加 referrerPolicy 防止防盗链导致图片裂开
            imagesHtml += `<div class="img-box"><img src="${src}" referrerpolicy="no-referrer" loading="lazy"></div>`;
          });
          imagesHtml += `</div>`;
        }

        // 帖子 HTML
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
<footer>Powered by Puppeteer & GitHub Actions</footer>
</body></html>`;

  fs.writeFileSync('index.html', html);
  console.log('HTML 文件生成完毕');
}

async function main() {
  const data = await getBloggers();
  generateHTML(data);
}

main();
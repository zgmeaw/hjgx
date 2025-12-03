// scripts/update.js —— 回退稳定版 + 仅修复链接和图片
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 辅助等待函数
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getBloggers() {
  const linksPath = path.join(__dirname, '../links.txt');
  if (!fs.existsSync(linksPath)) {
    console.log('links.txt not found!');
    return [];
  }

  const urls = fs.readFileSync(linksPath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  console.log(`计划抓取 ${urls.length} 个链接`);

  const browser = await puppeteer.launch({
    headless: "new",
    // 自动寻找浏览器路径，适配 GitHub Actions
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080']
  });

  const bloggers = [];

  for (const url of urls) {
    console.log(`正在访问: ${url}`);
    const page = await browser.newPage();
    
    // 设置 UA，模拟真实用户
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      // 1. 恢复 networkidle2，确保数据加载完成
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      
      // 2. 强制等待 .titlerow 出现 (这是之前成功的关键)
      try {
        await page.waitForSelector('.titlerow', { timeout: 20000 });
        console.log('检测到帖子列表 (.titlerow)');
      } catch (e) {
        console.log('等待超时，尝试直接抓取...');
      }

      // 3. 提取昵称
      let nickname = '未知用户';
      try {
        nickname = await page.evaluate(() => {
          const el = document.querySelector('.nickname, h1, .user-name');
          return el ? el.innerText.trim() : document.title;
        });
      } catch (e) {}

      // 4. 提取帖子 (修复链接和图片)
      const posts = await page.evaluate(() => {
        const todayStr = new Date().toISOString().slice(5, 10); // "12-03"
        const items = document.querySelectorAll('.titlerow');
        const results = [];

        items.forEach(item => {
          if (results.length >= 3) return; // 只取前3条

          // --- 标题 & 链接 ---
          const linkEl = item.querySelector('a'); 
          if (!linkEl) return;

          const title = linkEl.innerText.trim();
          let href = linkEl.getAttribute('href'); 
          
          // 【修复1】手动拼接完整域名
          if (href && href.startsWith('/')) {
            href = 'https://www.haijiao.com' + href;
          }

          // --- 时间 ---
          let timeEl = item.querySelector('.createTime');
          let rawTime = timeEl ? timeEl.innerText.trim() : '';
          let isToday = rawTime.includes(todayStr) || rawTime.includes('小时') || rawTime.includes('分');

          // --- 图片 ---
          let imgArr = [];
          const attachEl = item.querySelector('.attachments');
          if (attachEl) {
             const imgs = attachEl.querySelectorAll('img');
             imgs.forEach(img => {
                 // 【修复2】优先取 data-src，因为海角用懒加载
                 let src = img.getAttribute('data-src') || img.getAttribute('src');
                 if (src && !src.includes('loading')) {
                    imgArr.push(src);
                 }
             });
          }

          if (title) {
            results.push({
              title,
              link: href,
              time: rawTime,
              isToday,
              images: imgArr
            });
          }
        });
        return results;
      });

      console.log(`抓取成功: ${nickname} - ${posts.length} 条`);
      bloggers.push({ nickname, posts, homeLink: url });

    } catch (err) {
      console.error(`处理失败: ${url}`, err.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return bloggers;
}

function generateHTML(bloggers) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  // 这里使用了你之前觉得太丑的HTML结构，但为了先确保功能，我只改了 href 跳转
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海角监控</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<h1>海角监控站</h1>
<p>更新时间：${now}</p>
<ul class="feed">`;

  bloggers.forEach(({ nickname, posts }) => {
    html += `<h3>${nickname}</h3>`;
    posts.forEach(p => {
      // 图片显示逻辑
      let imgHtml = '';
      if(p.images.length > 0) {
        // referrerpolicy="no-referrer" 是为了解决图片403不显示的问题
        imgHtml = `<br><img src="${p.images[0]}" style="max-height:100px;border-radius:5px;margin-top:5px;" referrerpolicy="no-referrer">`;
      }
      
      html += `<li>
        <a href="${p.link}" target="_blank">
           [${p.time}] ${p.title} 
        </a>
        ${imgHtml}
      </li>`;
    });
  });

  html += `</ul><footer>Powered by GitHub Actions</footer></body></html>`;
  fs.writeFileSync('index.html', html);
}

async function main() {
  const bloggers = await getBloggers();
  generateHTML(bloggers);
}

main().catch(console.error);
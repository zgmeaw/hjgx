// scripts/update.js —— 语法修复 + 强力调试版
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function main() {
  const linksPath = path.join(__dirname, '../links.txt');
  if (!fs.existsSync(linksPath)) {
    console.log('错误: 未找到 links.txt');
    return;
  }

  const urls = fs.readFileSync(linksPath, 'utf-8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  console.log(`准备抓取 ${urls.length} 个链接...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const bloggers = [];

  for (const url of urls) {
    console.log(`\n>>> 正在访问: ${url}`);
    const page = await browser.newPage();
    
    // 开启页面控制台日志转发（关键调试信息）
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      // 1. 加载页面
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // 2. 尝试处理可能的弹窗
      try {
        const closeBtn = await page.$('.ant-modal-close, .close-btn, button[aria-label="Close"]');
        if (closeBtn) {
          await closeBtn.click();
          console.log('  已点击关闭弹窗');
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch(e) {}

      // 3. 等待数据加载
      try {
        // 尝试等待任意帖子链接出现
        await page.waitForSelector('a[href*="pid="]', { timeout: 15000 });
      } catch (e) {
        console.log('  ⚠️ 等待帖子链接超时，尝试直接解析...');
      }

      // 4. 提取数据
      const data = await page.evaluate(() => {
        const results = [];
        const todayStr = new Date().toISOString().slice(5, 10); // "MM-DD"

        // 查找所有可能的帖子容器 (titlerow 或 其他)
        let rows = Array.from(document.querySelectorAll('.titlerow'));
        
        // 如果没找到 .titlerow，尝试全局搜索带 pid 的链接
        if (rows.length === 0) {
          console.log('页面未找到 .titlerow，切换到暴力搜索模式');
          const links = Array.from(document.querySelectorAll('a[href*="pid="]'));
          rows = links.map(link => link.closest('li') || link.parentElement);
          rows = [...new Set(rows)]; // 去重
        }

        rows.forEach(row => {
          if (!row || results.length >= 3) return;

          // 找标题链接
          const linkEl = row.querySelector('a[href*="pid="]') || row.querySelector('a');
          if (!linkEl) return;

          const title = linkEl.innerText.trim();
          if (title.length < 2) return;

          // 找时间
          let timeEl = row.querySelector('.createTime, .time');
          let rawTime = timeEl ? timeEl.innerText.trim() : '未知时间';

          // 找图片
          let imgArr = [];
          const imgs = row.querySelectorAll('img');
          imgs.forEach(img => {
            let src = img.getAttribute('data-src') || img.getAttribute('src');
            if (src && !src.includes('loading') && src.length > 20) {
              imgArr.push(src);
            }
          });

          // 补全链接
          let href = linkEl.getAttribute('href');
          if (href && !href.startsWith('http')) href = 'https://www.haijiao.com' + href;

          results.push({
            title,
            link: href,
            time: rawTime,
            images: imgArr,
            isToday: rawTime.includes(todayStr) || rawTime.includes('小时')
          });
        });

        return results;
      });

      // 获取昵称
      const nickname = await page.evaluate(() => {
        const el = document.querySelector('h1, .nickname, .user-name');
        return el ? el.innerText.trim() : '海角博主';
      });

      console.log(`  -> 抓取结果: ${nickname} - ${data.length} 条`);

      // === 调试核心：如果抓取失败，截图并打印页面文本 ===
      if (data.length === 0) {
        console.log('  ⚠️ 数据为空，正在保存截图 debug_error.jpg ...');
        await page.screenshot({ path: 'debug_error.jpg', fullPage: true });
        
        const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
        console.log('  [页面文本快照]:', bodyText.replace(/\s+/g, ' '));
      } else {
        console.log(`     第一条: ${data[0].title}`);
      }

      bloggers.push({ nickname, posts: data });

    } catch (err) {
      console.error(`  ❌ 错误: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // 生成 HTML
  let html = `<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>海角监控</title><style>body{padding:20px;font-family:sans-serif;background:#f5f5f5} .card{background:#fff;padding:15px;margin-bottom:15px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.05)} a{text-decoration:none;color:#333;font-weight:bold;font-size:16px} a:hover{color:#e91e63} .time{font-size:12px;color:#999;margin-top:5px} .img-box{margin-top:10px;display:flex;gap:5px} .img-box img{width:80px;height:80px;object-fit:cover;border-radius:4px;background:#eee}</style>`;
  
  bloggers.forEach(b => {
    html += `<div class="card"><h3>${b.nickname}</h3>`;
    if(b.posts.length === 0) html += `<div style="color:red">暂无数据或抓取失败</div>`;
    
    b.posts.forEach(p => {
      let imgs = p.images.slice(0,3).map(src => `<img src="${src}" referrerpolicy="no-referrer">`).join('');
      html += `
      <div style="border-bottom:1px solid #eee;padding:10px 0;">
        <a href="${p.link}" target="_blank">${p.title}</a>
        <div class="time">${p.time}</div>
        <div class="img-box">${imgs}</div>
      </div>`;
    });
    html += `</div>`;
  });
  
  fs.writeFileSync('index.html', html);
  console.log('HTML 已更新');
}

main().catch(console.error);
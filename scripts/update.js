// scripts/update.js —— 暴力抓取 + 调试诊断版
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function getBloggers() {
  const linksPath = path.join(__dirname, '../links.txt');
  if (!fs.existsSync(linksPath)) return [];

  const urls = fs.readFileSync(linksPath, 'utf-8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const bloggers = [];

  for (const url of urls) {
    console.log(`\n>>> 正在访问: ${url}`);
    const page = await browser.newPage();
    
    // 开启页面控制台日志转发（关键！能在 Action 日志看到浏览器内部报错）
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      // 1. 加载页面
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      
      // 2. 尝试处理可能的弹窗（如果有）
      try {
        const closeBtn = await page.$('.ant-modal-close, .close-btn');
        if (closeBtn) {
          await closeBtn.click();
          console.log('  已点击关闭弹窗');
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch(e) {}

      // 3. 等待数据区
      try {
        // 等待任意一个链接出现，不仅仅是 titlerow
        await page.waitForSelector('a[href*="details?pid="]', { timeout: 15000 });
      } catch (e) {
        console.log('  ⚠️ 等待帖子链接超时，页面可能未加载完成');
      }

      // 4. 暴力提取数据
      const data = await page.evaluate(() => {
        const results = [];
        const todayStr = new Date().toISOString().slice(5, 10); // "MM-DD"

        // 策略A: 优先找 .titlerow (你指定的)
        let rows = Array.from(document.querySelectorAll('.titlerow'));
        
        // 策略B: 如果 A 没找到或很少，尝试找所有包含 'pid=' 的链接容器
        if (rows.length === 0) {
          console.log('未找到 .titlerow，切换到全局链接搜索模式');
          // 找到所有帖子链接
          const links = Array.from(document.querySelectorAll('a[href*="pid="]'));
          // 向上找父级容器作为 row
          rows = links.map(link => link.closest('li') || link.closest('div') || link.parentElement);
          // 去重
          rows = [...new Set(rows)];
        } else {
          console.log(`找到 ${rows.length} 个 .titlerow 元素`);
          // 调试：打印第一个 row 的 HTML，看看结构到底长啥样
          if(rows.length > 0) console.log('Row HTML片段:', rows[0].innerHTML.slice(0, 100));
        }

        rows.forEach(row => {
          if (!row || results.length >= 3) return;

          // 找链接
          const linkEl = row.querySelector('a[href*="pid="]') || row.querySelector('a');
          if (!linkEl) return;

          const title = linkEl.innerText.trim();
          if (title.length < 2) return; // 过滤空标题

          // 找时间
          let timeEl = row.querySelector('.createTime, .time, span.date');
          let rawTime = timeEl ? timeEl.innerText.trim() : '';
          
          // 找图片 (data-src 或 src)
          let imgArr = [];
          const imgs = row.querySelectorAll('img');
          imgs.forEach(img => {
            let src = img.getAttribute('data-src') || img.getAttribute('src');
            if (src && !src.includes('loading') && src.length > 20) {
              imgArr.push(src);
            }
          });

          // 修正链接
          let href = linkEl.getAttribute('href');
          if (href && !href.startsWith('http')) href = 'https://www.haijiao.com' + href;

          results.push({
            title,
            link: href,
            time: rawTime || '未知时间',
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
      
      // 如果依然是 0 条，截图！
      if (data.length === 0) {
        console.log('  ⚠️ 抓取数为0，正在截图 debug_error.jpg ...');
        await page.screenshot({ path: 'debug_error.jpg', fullPage: true });
        // 打印页面body文字，看看是否有 "登录" 或 "权限" 字样
        const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
        console.log('  页面前200字:', bodyText.replace(/\n/g, ' '));
      } else {
         console.log(`     首条: ${data[0].title}`);
      }

      bloggers.push({ nickname, posts: data });

    } catch (err) {
      console.error(`  ❌ 错误: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  
  // 生成 HTML (保持简单，先看数据)
  let html = `<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{padding:20px;font-family:sans-serif}img{max-width:100px;border-radius:5px;display:block;margin:5px 0}a{text-decoration:none;color:#d63031;font-size:16px;font-weight:bold}.item{border-bottom:1px solid #eee;padding:10px 0}.time{font-size:12px;color:#888}</style>`;
  
  bloggers.forEach(b => {
    html += `<h3>${b.nickname}</h3>`;
    if(b.posts.length===0) html += `<p style="color:red">⚠️ 未获取到数据，请检查Artifacts截图</p>`;
    b.posts.forEach(p => {
      let imgs = p.images.slice(0,3).map(src => `<img src="${src}" referrerpolicy="no-referrer">`).join('');
      html += `<div class="item"><a href="${p.link}" target="_blank">${p.title}</a><div class="time">${p.time}</div>${imgs}</div>`;
    });
  });
  
  fs.writeFileSync('index.html', html);
  console.log('HTML 已生成');
}

main();
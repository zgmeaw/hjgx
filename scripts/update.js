// scripts/update.js —— 增强调试版（多重选择器 + 日志，完美抓帖子）
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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

  console.log(`Found ${urls.length} URLs`);

  const bloggers = [];
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  for (const url of urls) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // 提取昵称（已成功）
    let nickname = '未知用户';
    try {
      nickname = await page.evaluate(() => {
        const text = document.body.innerText;
        const match = text.match(/(.+?)\s*\(ID:\s*\d+\)/);
        return match ? match[1].trim() : '未知用户';
      });
      console.log(`博主昵称: ${nickname}`);
    } catch (e) {
      console.log(`昵称提取失败: ${e.message}`);
    }

    // 增强帖子提取（多重选择器 fallback + 调试日志）
    const posts = await page.evaluate(() => {
      const today = new Date().toISOString().slice(5, 10);  // mm-dd 如 12-03
      let items = [];

      // fallback 1: .titlerow (你提供的)
      items = Array.from(document.querySelectorAll('.titlerow'));
      if (items.length > 0) console.log(`匹配到 ${items.length} 个 .titlerow`);

      // fallback 2: div.item in .list or .post-list
      if (items.length === 0) {
        items = Array.from(document.querySelectorAll('div.list div.item, .post-list .item, .threadlist tr'));
        console.log(`匹配到 ${items.length} 个 item/tr`);
      }

      // fallback 3: 任何含标题 a 的行
      if (items.length === 0) {
        items = Array.from(document.querySelectorAll('tr, div.row, div.post-row')).filter(row => row.querySelector('a'));
        console.log(`匹配到 ${items.length} 个标题行`);
      }

      return items.slice(0, 5).map(item => {
        // 标题：a.subject or a.threadtitle or any a in item
        let titleEl = item.querySelector('a.subject, a.threadtitle, a');
        if (!titleEl) return null;

        const title = titleEl.innerText.trim();
        let link = titleEl.href;
        if (link.startsWith('/')) link = 'https://www.haijiao.com' + link;

        // 时间：.createTime or .post-time or span with date text
        let timeEl = item.querySelector('.createTime, .post-time, span.date, span.gray, .time');
        if (!timeEl) timeEl = document.querySelector('.createTime');  // 页面级 fallback
        let rawTime = timeEl ? timeEl.innerText.trim() : '';
        let isToday = rawTime.includes(today);
        let displayTime = rawTime;
        if (isToday) {
          displayTime = rawTime.replace(today, `${new Date().getMonth() + 1}.${new Date().getDate()}`);
        }

        // 图片：.attachments img
        let imgContainer = item.querySelector('.attachments');
        const images = imgContainer ? Array.from(imgContainer.querySelectorAll('img')).map(img => img.src) : [];

        // 调试：打印第一条标题
        if (items.indexOf(item) === 0) console.log(`第一条标题: ${title.substring(0, 50)}... | 时间: ${rawTime} | 今天: ${isToday} | 图片数: ${images.length}`);

        return { title, link, time: displayTime || '未知', isToday, images };
      }).filter(p => p && p.title.length > 0);  // 过滤空标题
    });

    bloggers.push({ nickname, posts: posts.slice(0, 3) });
    await page.close();
    console.log(`成功: ${nickname} - ${posts.length} 条帖子`);
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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海角监控站</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;margin:20px auto;max-width:960px;background:#000;color:#eee;line-height:1.8}
h1{text-align:center;color:#ff79c6;margin:40px 0}
.b{background:#111;padding:22px;margin:20px 0;border-radius:16px;border:1px solid #333}
.n{font-size:25px;font-weight:bold;color:#ff79c6;display:flex;align-items:center;gap:12px}
.dot{font-size:36px;color:#ff5555}
.p{font-size:17.5px;margin:12px 0;display:flex;justify-content:space-between;flex-wrap:wrap;align-items:center}
.p a{color:#ff79c6;text-decoration:none;flex:1}
.p a:hover{text-decoration:underline}
.t{color:#ff5555;font-weight:bold;min-width:50px;text-align:right}
.g{color:#888;min-width:50px;text-align:right}
.img{opacity:0.8;max-width:50px;margin-left:10px;border-radius:4px}
footer{text-align:center;margin:80px 0;color:#666}
</style>
</head>
<body>
<h1>海角博主动态监控站</h1>
<p style="text-align:center;color:#888">最后更新：${now}</p>`;

  let hasNew = false;
  bloggers.forEach(({ nickname, posts }) => {
    const newCount = posts.filter(p => p.isToday).length;
    const dot = newCount > 0 ? '<span class="dot">●●● 新帖</span>' : '';
    if (newCount > 0) hasNew = true;

    html += `<div class="b"><div class="n">${dot}${nickname}</div>`;
    if (posts.length === 0) {
      html += '<div style="color:#888;font-style:italic">暂无最新帖子</div>';
    } else {
      posts.forEach(p => {
        const tc = p.isToday ? 't' : 'g';
        let imgHtml = p.images && p.images.length > 0 ? `<img src="${p.images[0]}" class="img" alt="预览" onerror="this.style.display='none'">` : '';
        html += `<div class="p"><a href="${p.link}" target="_blank">${p.title}</a> <span class="${tc}">${p.time}</span>${imgHtml}</div>`;
      });
    }
    html += '</div>';
  });

  html += `<footer>Powered by Puppeteer + GitHub Actions | 今日${hasNew ? '有' : '无'}新帖</footer></body></html>`;

  fs.writeFileSync('index.html', html);
}

async function main() {
  const bloggers = await getBloggers();
  generateHTML(bloggers);
  console.log(`完成！总博主 ${bloggers.length}，总帖子 ${bloggers.reduce((sum, b) => sum + b.posts.length, 0)}`);
}

main().catch(console.error);
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

      // 3. 提取昵称
      let nickname = '未知用户';
      try {
        await page.waitForSelector('body'); // 确保body加载
        nickname = await page.evaluate(() => {
          // 尝试多种方式查找昵称
          // 1. 查找常见的昵称选择器
          const commonSelectors = [
            '.nickname', '.user-name', '.username', 
            'h1', '.user-info .name', '.profile-name',
            'span[data-v-27fff83a]' // 根据你提供的HTML结构
          ];
          for (const selector of commonSelectors) {
            const nameEl = document.querySelector(selector);
            if (nameEl && nameEl.innerText.trim()) {
              const text = nameEl.innerText.trim();
              // 过滤掉明显不是昵称的内容
              if (text.length < 50 && !text.includes('登录') && !text.includes('注册')) {
                return text;
              }
            }
          }
          
          // 2. 尝试正则匹配 "昵称 (ID: 数字)" 格式
          const text = document.body.innerText;
          const match = text.match(/(.+?)\s*\(ID:\s*\d+\)/);
          if (match) {
            const matchedName = match[1].trim();
            if (matchedName.length < 50) {
              return matchedName;
            }
          }
          
          // 3. 尝试查找包含中文的span元素（可能是昵称）
          const spans = document.querySelectorAll('span');
          for (const span of spans) {
            const text = span.innerText.trim();
            // 检查是否是合理的昵称（2-20个字符，主要是中文）
            if (text.length >= 2 && text.length <= 20 && 
                /[\u4e00-\u9fa5]/.test(text) && 
                !text.includes('ID') && 
                !text.includes('登录') &&
                !text.includes('注册')) {
              return text;
            }
          }
          
          return '未知用户';
        });
        console.log(`博主昵称: ${nickname}`);
      } catch (e) {
        console.log(`昵称提取失败: ${e.message}`);
      }

      // 4. 核心：等待帖子列表加载
      // 使用 .title 选择器（实际HTML中使用的是 .title 而不是 .titlerow）
      console.log('正在等待帖子列表 (.title) 加载...');
      try {
        // 最多等待 15 秒
        await page.waitForSelector('.title', { timeout: 15000 });
      } catch (e) {
        console.log('⚠️ 超时未找到 .title，尝试使用备用选择器...');
        // 尝试备用选择器
        try {
          await page.waitForSelector('.titlerow', { timeout: 5000 });
          console.log('找到备用选择器 .titlerow');
        } catch (e2) {
          console.log('⚠️ 未找到任何帖子选择器，尝试截图调试...');
          await page.screenshot({ path: `debug_error_${Date.now()}.jpg` });
          const html = await page.content();
          fs.writeFileSync(`debug_source_${Date.now()}.html`, html);
          console.log('已保存调试截图和HTML，请检查 artifact。');
        }
      }

      // 5. 提取帖子数据
      const posts = await page.evaluate(() => {
        const todayStr = new Date().toISOString().slice(5, 10); // "12-03"
        // 优先使用 .title，如果没有则使用 .titlerow
        let items = document.querySelectorAll('.title');
        if (items.length === 0) {
          items = document.querySelectorAll('.titlerow');
        }
        const results = [];

        items.forEach(item => {
          // 限制只取前 3 条
          if (results.length >= 3) return;

          // --- 找到包含 title 的父容器 ---
          // 向上查找父容器，通常是一个列表项或卡片
          let container = item.parentElement;
          // 向上查找几层，找到包含完整帖子信息的容器
          let depth = 0;
          while (container && depth < 5) {
            // 检查这个容器是否包含 createTime
            const hasTime = container.querySelector('.createTime');
            if (hasTime) {
              break; // 找到了包含完整信息的容器
            }
            container = container.parentElement;
            depth++;
          }
          
          // 如果找不到合适的容器，使用 title 的直接父元素
          if (!container) {
            container = item.parentElement;
          }

          // --- 标题 ---
          const title = item.innerText.trim() || item.getAttribute('title') || '';
          if (!title) return;

          // --- 链接 ---
          // 尝试多种方式获取链接
          let link = '';
          // 1. title 本身可能是链接
          if (item.tagName === 'A') {
            link = item.getAttribute('href') || '';
          }
          // 2. title 内部有 a 标签
          else {
            const linkEl = item.querySelector('a');
            if (linkEl) {
              link = linkEl.getAttribute('href') || '';
            }
          }
          // 3. 在父容器中查找链接（优先查找包含 title 的链接）
          if (!link && container) {
            // 查找包含当前 title 元素的链接
            const containerLink = container.closest('a');
            if (containerLink) {
              link = containerLink.getAttribute('href') || '';
            }
            // 如果找不到，查找容器内的第一个链接
            if (!link) {
              const firstLink = container.querySelector('a');
              if (firstLink) {
                link = firstLink.getAttribute('href') || '';
              }
            }
          }
          // 4. 如果 title 的父元素是链接
          if (!link) {
            const parentLink = item.closest('a');
            if (parentLink) {
              link = parentLink.getAttribute('href') || '';
            }
          }
          
          // 补全链接（相对路径转绝对路径）
          if (link && !link.startsWith('http')) {
            if (link.startsWith('/')) {
              link = window.location.origin + link;
            } else if (link.startsWith('./') || link.startsWith('../')) {
              // 处理相对路径
              const baseUrl = window.location.href.split('/').slice(0, -1).join('/');
              link = new URL(link, baseUrl + '/').href;
            } else {
              link = window.location.origin + '/' + link;
            }
          }
          
          // 如果还是没有链接，尝试从标题元素构建（某些情况下链接可能在数据属性中）
          if (!link || link === '#') {
            const dataLink = item.getAttribute('data-href') || 
                           item.getAttribute('data-url') ||
                           (item.closest('[data-href]') && item.closest('[data-href]').getAttribute('data-href'));
            if (dataLink) {
              link = dataLink.startsWith('http') ? dataLink : window.location.origin + dataLink;
            }
          }
          
          // 如果还是没有链接，尝试从标题的 title 属性或其他属性中获取
          // 某些情况下，链接可能通过点击事件绑定，我们尝试从 onclick 或其他属性获取
          if (!link || link === '#') {
            // 查找可能包含链接的父元素
            let parent = item.parentElement;
            let checkDepth = 0;
            while (parent && checkDepth < 3) {
              const onclick = parent.getAttribute('onclick');
              if (onclick && onclick.includes('http')) {
                const urlMatch = onclick.match(/https?:\/\/[^\s"']+/);
                if (urlMatch) {
                  link = urlMatch[0];
                  break;
                }
              }
              // 检查是否有 data-* 属性包含链接
              for (const attr of parent.attributes) {
                if (attr.name.startsWith('data-') && attr.value && attr.value.includes('http')) {
                  const urlMatch = attr.value.match(/https?:\/\/[^\s"']+/);
                  if (urlMatch) {
                    link = urlMatch[0];
                    break;
                  }
                }
              }
              if (link && link !== '#') break;
              parent = parent.parentElement;
              checkDepth++;
            }
          }
          
          // 最后尝试：如果标题有 hjbox-linkcolor 类，可能是通过路由跳转
          // 这种情况下，链接可能不在href中，而是通过JavaScript路由
          // 我们可以尝试从容器中查找可能的帖子ID或路径信息
          if (!link || link === '#') {
            // 查找可能包含帖子ID的元素
            let searchEl = container || item;
            const possibleId = searchEl.getAttribute('data-id') || 
                              searchEl.getAttribute('data-post-id') || 
                              searchEl.getAttribute('id');
            if (possibleId && /^\d+$/.test(possibleId)) {
              // 如果当前页面是用户主页，尝试构建帖子链接
              const currentPath = window.location.pathname;
              if (currentPath.includes('/homepage/last/')) {
                // 海角社区可能的帖子链接格式
                link = window.location.origin + '/post/' + possibleId;
              }
            }
          }

          // --- 时间 ---
          // 在容器中查找 createTime
          let rawTime = '';
          if (container) {
            const timeEl = container.querySelector('.createTime');
            if (timeEl) {
              rawTime = timeEl.innerText.trim();
            }
          }
          // 如果容器中找不到，尝试在 title 附近查找
          if (!rawTime) {
            // 查找 title 的兄弟元素（向后查找）
            let sibling = item.nextElementSibling;
            let checkCount = 0;
            while (sibling && checkCount < 5) {
              if (sibling.classList.contains('createTime')) {
                rawTime = sibling.innerText.trim();
                break;
              }
              sibling = sibling.nextElementSibling;
              checkCount++;
            }
            // 如果向后找不到，尝试向前查找
            if (!rawTime) {
              sibling = item.previousElementSibling;
              checkCount = 0;
              while (sibling && checkCount < 3) {
                if (sibling.classList.contains('createTime')) {
                  rawTime = sibling.innerText.trim();
                  break;
                }
                sibling = sibling.previousElementSibling;
                checkCount++;
              }
            }
          }
          // 备用：尝试查找其他可能的时间元素
          if (!rawTime && container) {
            const altTimeSelectors = [
              '.time', '.post-time', '.date', '.post-date',
              '[class*="time"]', '[class*="Time"]', '[class*="date"]', '[class*="Date"]'
            ];
            for (const selector of altTimeSelectors) {
              const altTimeEl = container.querySelector(selector);
              if (altTimeEl) {
                const text = altTimeEl.innerText.trim();
                // 检查是否包含日期格式（如 12-03, 2024-12-03 等）
                if (text.match(/\d{1,2}[-/]\d{1,2}/) || text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/)) {
                  rawTime = text;
                  break;
                }
              }
            }
          }
          
          // 简单的时间处理
          let isToday = rawTime.includes(todayStr);

          // --- 图片 ---
          // 图片可能在容器中直接存在，也可能在 .attachments 中
          let imgArr = [];
          const extractImages = (element) => {
            if (!element) return [];
            const imgs = element.querySelectorAll('img');
            const imgSrcs = [];
            imgs.forEach(img => {
              let src = img.getAttribute('src') || 
                       img.getAttribute('data-src') || 
                       img.getAttribute('data-original') ||
                       img.getAttribute('data-lazy-src') ||
                       img.getAttribute('data-url');
              if (src) {
                // base64 图片直接使用
                if (src.startsWith('data:image')) {
                  imgSrcs.push(src);
                }
                // 补全其他图片链接
                else if (src.startsWith('//')) {
                  src = 'https:' + src;
                  imgSrcs.push(src);
                } else if (src.startsWith('/')) {
                  src = window.location.origin + src;
                  imgSrcs.push(src);
                } else if (src.startsWith('http')) {
                  imgSrcs.push(src);
                } else if (!src.startsWith('http')) {
                  src = window.location.origin + '/' + src;
                  imgSrcs.push(src);
                }
              }
            });
            // 过滤掉无效的图片（如占位符），但保留 base64
            return imgSrcs.filter(src => {
              if (src.startsWith('data:image')) return true;
              return !src.includes('placeholder') && !src.includes('blank') && src.length > 10;
            });
          };
          
          if (container) {
            // 优先在 .attachments 中查找
            const attachEl = container.querySelector('.attachments');
            if (attachEl) {
              imgArr = extractImages(attachEl);
            }
            // 如果 attachments 中没找到，尝试在整个容器中查找图片
            if (imgArr.length === 0) {
              imgArr = extractImages(container);
            }
            // 只取前3张图片
            imgArr = imgArr.slice(0, 3);
          }
          // 如果容器中找不到，尝试在 title 附近查找
          if (imgArr.length === 0) {
            let sibling = item.nextElementSibling;
            let checkCount = 0;
            while (sibling && checkCount < 5) {
              if (sibling.classList.contains('attachments')) {
                imgArr = extractImages(sibling);
                break;
              }
              // 如果兄弟元素本身是图片或包含图片
              if (sibling.tagName === 'IMG') {
                const src = sibling.getAttribute('src') || sibling.getAttribute('data-src');
                if (src) {
                  imgArr = extractImages(sibling.parentElement);
                  break;
                }
              }
              sibling = sibling.nextElementSibling;
              checkCount++;
            }
          }
          // 如果还是找不到，尝试向前查找
          if (imgArr.length === 0) {
            let sibling = item.previousElementSibling;
            let checkCount = 0;
            while (sibling && checkCount < 3) {
              if (sibling.classList.contains('attachments')) {
                imgArr = extractImages(sibling);
                break;
              }
              sibling = sibling.previousElementSibling;
              checkCount++;
            }
          }

          if (title) {
            results.push({
              title,
              link: link || '#',
              time: rawTime || '未知时间',
              isToday,
              images: imgArr
            });
          }
        });

        return results;
      });

      console.log(`抓取成功: 发现 ${posts.length} 条帖子`);
      if (posts.length > 0) {
        posts.forEach((post, idx) => {
          console.log(`帖子 ${idx + 1}:`);
          console.log(`  标题: ${post.title}`);
          console.log(`  链接: ${post.link}`);
          console.log(`  时间: ${post.time}`);
          console.log(`  图片数量: ${post.images.length}`);
          if (post.images.length > 0) {
            console.log(`  第一张图片: ${post.images[0]}`);
          }
        });
      } else {
        console.log('⚠️ 未获取到任何帖子，可能需要检查选择器');
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
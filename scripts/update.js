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
      console.log('正在等待帖子列表加载...');
      
      // 先等待页面基本加载完成
      await delay(3000);
      
      // 检查页面中是否有 .title 元素（不阻塞）
      let hasTitle = false;
      try {
        hasTitle = await page.evaluate(() => {
          return document.querySelectorAll('.title').length > 0;
        });
      } catch (e) {
        console.log('检查页面元素时出错:', e.message);
      }
      
      if (!hasTitle) {
        console.log('⚠️ 未找到 .title 元素，等待更长时间...');
        try {
          // 最多等待 8 秒
          await Promise.race([
            page.waitForSelector('.title', { timeout: 8000 }),
            new Promise((resolve) => setTimeout(resolve, 8000)) // 强制超时
          ]);
          hasTitle = await page.evaluate(() => {
            return document.querySelectorAll('.title').length > 0;
          });
          if (hasTitle) {
            console.log('✓ 找到 .title 选择器');
          }
        } catch (e) {
          console.log('⚠️ 等待超时，继续尝试提取数据...');
        }
      } else {
        console.log('✓ 页面中已存在 .title 元素');
      }
      
      // 额外等待一下，确保动态内容加载完成
      await delay(2000);

      // 5. 提取帖子数据 - 使用模拟点击获取链接
      console.log('开始提取帖子数据...');
      
      // 先检查一下页面中有哪些元素
      const pageInfo = await page.evaluate(() => {
        return {
          titleCount: document.querySelectorAll('.title').length,
          titlerowCount: document.querySelectorAll('.titlerow').length,
          url: window.location.href,
          bodyLength: document.body ? document.body.innerText.length : 0
        };
      });
      console.log('页面信息:', pageInfo);
      console.log('开始执行数据提取（最多等待30秒）...');
      
      // 使用超时保护，避免卡住
      const posts = await Promise.race([
        page.evaluate(() => {
          const todayStr = new Date().toISOString().slice(5, 10); // "12-03"
          // 优先使用 .title，如果没有则使用 .titlerow
          let items = document.querySelectorAll('.title');
          if (items.length === 0) {
            items = document.querySelectorAll('.titlerow');
          }
          const results = [];

          for (let idx = 0; idx < Math.min(items.length, 3); idx++) {
            try {
              const item = items[idx];
              
              // --- 找到包含 title 的父容器 ---
              let container = item.parentElement;
              let depth = 0;
              while (container && depth < 8) {
                try {
                  const hasTime = container.querySelector('.createTime');
                  const hasAttach = container.querySelector('.attachments');
                  if (hasTime || hasAttach) break;
                } catch (e) {}
                container = container.parentElement;
                depth++;
              }
              if (!container) container = item.parentElement;

              // --- 标题 ---
              const title = item.innerText.trim() || item.getAttribute('title') || '';
              if (!title) continue;

              // --- 链接：尝试多种方式获取pid ---
              let link = '';
              let pid = null;
              
              // 方法1: 从元素的数据属性中查找pid（简化版，避免卡住）
              try {
                let searchEl = container || item;
                for (let d = 0; d < 4; d++) {
                  if (!searchEl) break;
                  // 只检查关键属性，避免遍历所有属性
                  const attrs = ['data-pid', 'data-id', 'data-post-id', 'id', 'data-href', 'data-url'];
                  for (const attrName of attrs) {
                    const value = searchEl.getAttribute(attrName);
                    if (value) {
                      const pidMatch = value.match(/pid[=:](\d+)/i) || value.match(/[?&]pid=(\d+)/i) || value.match(/(\d{6,})/);
                      if (pidMatch) {
                        pid = pidMatch[1];
                        break;
                      }
                    }
                  }
                  if (pid) break;
                  searchEl = searchEl.parentElement;
                }
              } catch (e) {}
              
              // 方法2: 从Vue实例中获取（添加异常保护）
              if (!pid) {
                try {
                  if (item.__vue__) {
                    const vue = item.__vue__;
                    if (vue.$attrs && vue.$attrs.to) {
                      const to = String(vue.$attrs.to);
                      const pidMatch = to.match(/pid[=:](\d+)/i) || to.match(/[?&]pid=(\d+)/i) || to.match(/(\d{6,})/);
                      if (pidMatch) pid = pidMatch[1];
                    }
                  }
                } catch (e) {}
              }
              
              // 构建链接
              if (pid) {
                link = `https://www.haijiao.com/post/details?pid=${pid}`;
              }

              // --- 时间 ---
              let rawTime = '';
              try {
                if (container) {
                  const timeEl = container.querySelector('.createTime');
                  if (timeEl) {
                    rawTime = timeEl.innerText.trim();
                  }
                }
                if (!rawTime) {
                  let sibling = item.nextElementSibling;
                  let checkCount = 0;
                  while (sibling && checkCount < 5) {
                    if (sibling.classList && sibling.classList.contains('createTime')) {
                      rawTime = sibling.innerText.trim();
                      break;
                    }
                    sibling = sibling.nextElementSibling;
                    checkCount++;
                  }
                }
              } catch (e) {}
              
              // --- 图片 ---
              let imgArr = [];
              try {
                if (container) {
                  const attachEl = container.querySelector('.attachments');
                  if (attachEl) {
                    const imgs = attachEl.querySelectorAll('img');
                    for (let i = 0; i < Math.min(imgs.length, 3); i++) {
                      const img = imgs[i];
                      let src = img.getAttribute('src') || 
                               img.getAttribute('data-src') || 
                               img.getAttribute('data-original') ||
                               img.getAttribute('data-lazy-src');
                      if (src && src.trim() !== '') {
                        if (src.startsWith('data:image')) {
                          imgArr.push(src);
                        } else if (src.startsWith('//')) {
                          imgArr.push('https:' + src);
                        } else if (src.startsWith('/')) {
                          imgArr.push(window.location.origin + src);
                        } else if (src.startsWith('http')) {
                          imgArr.push(src);
                        }
                      }
                    }
                  }
                }
                imgArr = imgArr.filter(src => {
                  if (src.startsWith('data:image')) return true;
                  return !src.includes('placeholder') && !src.includes('blank') && src.length > 10;
                });
              } catch (e) {}

              if (title) {
                results.push({
                  title,
                  link: link || '#',
                  time: rawTime || '未知时间',
                  isToday: rawTime.includes(todayStr),
                  images: imgArr.slice(0, 1) // 只取第一张
                });
              }
            } catch (err) {
              // 如果单个帖子处理出错，跳过继续处理下一个
              console.error('处理帖子时出错:', err);
            }
          }

          return results;
        }),
        new Promise((resolve) => {
          // 30秒超时保护
          setTimeout(() => {
            console.log('⚠️ 提取数据超时（30秒），返回空结果');
            resolve([]);
          }, 30000);
        })
      ]);
      
      console.log(`✓ 数据提取完成，获取到 ${posts.length} 条帖子`);
      
      // 如果还是没有获取到链接，尝试通过模拟点击获取
      for (let i = 0; i < posts.length; i++) {
        if (posts[i].link === '#') {
          try {
            // 获取对应的title元素
            const titleElements = await page.$$('.title');
            if (titleElements[i]) {
              // 设置导航监听
              let capturedUrl = null;
              const responseHandler = (response) => {
                const url = response.url();
                if (url.includes('/post/details') && url.includes('pid=')) {
                  capturedUrl = url;
                }
              };
              page.on('response', responseHandler);
              
              // 在新标签页中打开（使用Ctrl+Click模拟）
              const [newPage] = await Promise.all([
                new Promise((resolve) => {
                  page.browser().on('targetcreated', (target) => {
                    resolve(target.page());
                  });
                }),
                titleElements[i].click({ modifiers: ['Control'] })
              ]);
              
              await delay(1000);
              
              if (newPage) {
                const newUrl = await newPage.url();
                if (newUrl.includes('/post/details')) {
                  posts[i].link = newUrl;
                }
                await newPage.close();
              }
              
              page.off('response', responseHandler);
              
              // 如果还是没获取到，尝试从URL参数中提取
              if (posts[i].link === '#' && capturedUrl) {
                posts[i].link = capturedUrl;
              }
            }
          } catch (err) {
            console.log(`  模拟点击获取链接失败: ${err.message}`);
          }
        }
      }

      console.log(`抓取成功: 发现 ${posts.length} 条帖子`);
      if (posts.length > 0) {
        posts.forEach((post, idx) => {
          console.log(`帖子 ${idx + 1}:`);
          console.log(`  标题: ${post.title}`);
          console.log(`  链接: ${post.link || '未获取到链接'}`);
          console.log(`  时间: ${post.time || '未获取到时间'}`);
          console.log(`  图片数量: ${post.images.length}`);
          if (post.images.length > 0) {
            const imgPreview = post.images[0].startsWith('data:image') 
              ? `base64图片 (${Math.round(post.images[0].length / 1024)}KB)`
              : post.images[0].substring(0, 80) + '...';
            console.log(`  第一张图片: ${imgPreview}`);
          } else {
            console.log(`  ⚠️ 未获取到图片，可能需要检查 .attachments 选择器`);
          }
        });
      } else {
        console.log('⚠️ 未获取到任何帖子，可能需要检查选择器');
      }
      
      // 如果链接或图片都没有获取到，输出调试信息
      const hasLink = posts.some(p => p.link && p.link !== '#');
      const hasImage = posts.some(p => p.images && p.images.length > 0);
      if (!hasLink || !hasImage) {
        console.log('\n⚠️ 调试信息:');
        if (!hasLink) {
          console.log('  - 未获取到任何链接，可能需要检查页面结构或使用JavaScript路由');
        }
        if (!hasImage) {
          console.log('  - 未获取到任何图片，可能需要检查 .attachments 元素的位置');
        }
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
  
  // 转义HTML特殊字符
  const escapeHtml = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
  
  // 美化 HTML 模板
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海角博主动态监控站</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <h1>🌊 海角博主动态监控站</h1>
  <p class="update-time">最后更新：${now}</p>
</header>
<div class="container">`;

  let hasNew = false;
  bloggers.forEach(({ nickname, posts }) => {
    const newCount = posts.filter(p => p.isToday).length;
    if (newCount > 0) hasNew = true;
    
    // 只有当有帖子时才显示
    if (posts.length === 0) {
      html += `<div class="card">
        <div class="card-header">
          <span class="name">${escapeHtml(nickname)}</span>
        </div>
        <div class="post-list">
          <div class="empty">暂无获取到数据 (可能需要登录或反爬虫限制)</div>
        </div>
      </div>`;
      return;
    }
    
    html += `<div class="card">
      <div class="card-header">
        <span class="name">${escapeHtml(nickname)}</span>
        ${newCount > 0 ? '<span class="badge">✨ 今日更新</span>' : ''}
      </div>
      <div class="post-list">`;

    posts.forEach(p => {
      const timeClass = p.isToday ? 'time new' : 'time';
      // 确保链接有效
      let link = p.link && p.link !== '#' && p.link.trim() !== '' ? escapeHtml(p.link) : '#';
      
      // 处理图片 - 支持base64和普通URL
      let imgHtml = '';
      if (p.images && Array.isArray(p.images) && p.images.length > 0) {
        const firstImg = p.images[0];
        if (firstImg && firstImg.trim() !== '') {
          // base64图片或普通URL都可以直接使用
          // 注意：base64图片可能很长，需要确保完整输出
          imgHtml = `<div class="thumb">
            <img src="${escapeHtml(firstImg)}" alt="${escapeHtml(p.title)}" loading="lazy" onerror="this.style.display='none'; this.parentElement.style.display='none';">
          </div>`;
        }
      }
      
      // 如果链接无效，添加提示
      const linkAttr = link !== '#' ? `href="${link}" target="_blank"` : 'href="#" onclick="return false;" style="cursor: not-allowed;" title="链接不可用"';
      
      html += `
        <a ${linkAttr} class="post-item">
          <div class="post-info">
            <div class="post-title">${escapeHtml(p.title)}</div>
            <div class="${timeClass}">📅 ${escapeHtml(p.time || '未知时间')}</div>
          </div>
          ${imgHtml}
        </a>`;
    });
    
    html += `</div></div>`;
  });

  html += `</div>
  <footer>
    <p>Powered by Puppeteer | <a href="https://github.com/${process.env.GITHUB_REPOSITORY || ''}" target="_blank">Github Repo</a></p>
  </footer>
  </body></html>`;

  fs.writeFileSync('index.html', html);
  console.log('HTML 生成完毕');
}

async function main() {
  const bloggers = await getBloggers();
  generateHTML(bloggers);
}

main().catch(console.error);
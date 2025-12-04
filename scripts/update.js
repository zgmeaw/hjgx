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
      
      // 简化提取逻辑，避免超时
      console.log('开始快速提取数据...');
      const posts = await page.evaluate(() => {
        const todayStr = new Date().toISOString().slice(5, 10); // "12-03"
        const items = document.querySelectorAll('.title');
        const results = [];

        for (let idx = 0; idx < Math.min(items.length, 3); idx++) {
          try {
            const item = items[idx];
            
            // --- 标题 ---
            const title = item.innerText.trim() || item.getAttribute('title') || '';
            if (!title) continue;

            // --- 找到包含 title 的父容器（简化查找）---
            let container = item.parentElement;
            let depth = 0;
            while (container && depth < 5) {
              try {
                if (container.querySelector('.createTime') || container.querySelector('.attachments')) {
                  break;
                }
              } catch (e) {}
              container = container.parentElement;
              depth++;
            }
            if (!container) container = item.parentElement;

            // --- 链接：快速查找pid（只检查最可能的位置）---
            let link = '';
            let pid = null;
            
            // 快速方法：只检查元素本身和直接父元素的常见属性
            try {
              const checkAttrs = (el) => {
                if (!el) return null;
                // 检查更多可能的属性
                const attrs = ['data-pid', 'data-id', 'data-post-id', 'id', 'data-href', 'data-url', 'data-link'];
                for (const attrName of attrs) {
                  const value = el.getAttribute(attrName);
                  if (value) {
                    // 先尝试直接匹配pid
                    const pidMatch = value.match(/pid[=:](\d+)/i) || value.match(/[?&]pid=(\d+)/i);
                    if (pidMatch) return pidMatch[1];
                    // 再尝试匹配6位以上数字
                    const numMatch = value.match(/(\d{6,})/);
                    if (numMatch) return numMatch[1];
                  }
                }
                return null;
              };
              
              // 检查元素本身、容器、父元素
              pid = checkAttrs(item) || checkAttrs(container) || checkAttrs(item.parentElement);
              
              // 如果还没找到，尝试从元素的文本内容或附近元素中查找
              if (!pid) {
                // 查找包含数字的兄弟元素
                let sibling = item.nextElementSibling;
                for (let c = 0; c < 3 && sibling; c++) {
                  pid = checkAttrs(sibling);
                  if (pid) break;
                  sibling = sibling.nextElementSibling;
                }
              }
            } catch (e) {}
            
            // 构建链接
            if (pid) {
              link = `https://www.haijiao.com/post/details?pid=${pid}`;
            }

            // --- 时间 ---
            let rawTime = '';
            if (container) {
              const timeEl = container.querySelector('.createTime');
              if (timeEl) rawTime = timeEl.innerText.trim();
            }
            
            // --- 图片：从帖子正文中查找第一个img标签（广泛搜索）---
            let imgSrc = '';
            
            // 方法1: 从 .attachments 中查找
            if (container) {
              const attachEl = container.querySelector('.attachments');
              if (attachEl) {
                const imgs = attachEl.querySelectorAll('img');
                for (const img of imgs) {
                  imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
                  if (imgSrc) break;
                }
              }
            }
            
            // 方法2: 在整个容器中查找所有img标签（优先base64）
            if (!imgSrc && container) {
              const imgs = container.querySelectorAll('img');
              // 先找base64图片
              for (const img of imgs) {
                const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
                if (src && src.startsWith('data:image')) {
                  imgSrc = src;
                  break;
                }
              }
              // 如果没找到base64，找其他图片
              if (!imgSrc) {
                for (const img of imgs) {
                  const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
                  if (src && src.length > 20 && !src.includes('placeholder') && !src.includes('blank')) {
                    imgSrc = src;
                    break;
                  }
                }
              }
            }
            
            // 方法3: 在title的父级和兄弟元素中广泛搜索
            if (!imgSrc) {
              // 向上查找父级
              let parent = item.parentElement;
              for (let d = 0; d < 5 && parent; d++) {
                const imgs = parent.querySelectorAll('img');
                // 优先base64
                for (const img of imgs) {
                  const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
                  if (src && src.startsWith('data:image')) {
                    imgSrc = src;
                    break;
                  }
                }
                if (!imgSrc) {
                  for (const img of imgs) {
                    const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
                    if (src && src.length > 20) {
                      imgSrc = src;
                      break;
                    }
                  }
                }
                if (imgSrc) break;
                parent = parent.parentElement;
              }
            }
            
            // 方法4: 在title的兄弟元素中查找
            if (!imgSrc) {
              let sibling = item.nextElementSibling;
              let checkCount = 0;
              while (sibling && checkCount < 10) {
                if (sibling.querySelectorAll) {
                  const imgs = sibling.querySelectorAll('img');
                  for (const img of imgs) {
                    const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
                    if (src && (src.startsWith('data:image') || src.length > 20)) {
                      imgSrc = src;
                      break;
                    }
                  }
                }
                if (imgSrc) break;
                sibling = sibling.nextElementSibling;
                checkCount++;
              }
            }
            
            // 处理图片链接（base64直接使用，其他补全）
            if (imgSrc && !imgSrc.startsWith('data:image') && !imgSrc.startsWith('http')) {
              if (imgSrc.startsWith('//')) {
                imgSrc = 'https:' + imgSrc;
              } else if (imgSrc.startsWith('/')) {
                imgSrc = window.location.origin + imgSrc;
              }
            }

            results.push({
              title,
              link: link || '#',
              time: rawTime || '未知时间',
              isToday: rawTime.includes(todayStr),
              images: imgSrc ? [imgSrc] : []
            });
          } catch (e) {
            // 跳过出错的帖子
          }
        }

        return results;
      });
      
      console.log(`✓ 数据提取完成，获取到 ${posts.length} 条帖子`);
      
      // 不再需要获取帖子链接，跳过此步骤
      console.log('跳过链接获取步骤（已移除该功能）');

      console.log(`抓取成功: 发现 ${posts.length} 条帖子`);
      if (posts.length > 0) {
        posts.forEach((post, idx) => {
          console.log(`帖子 ${idx + 1}:`);
          console.log(`  标题: ${post.title}`);
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
      
      // 检查图片获取情况
      const hasImage = posts.some(p => p.images && p.images.length > 0);
      if (!hasImage) {
        console.log('\n⚠️ 调试信息:');
        console.log('  - 未获取到任何图片，可能需要检查 .attachments 元素的位置');
      }

      // 从URL中提取博主ID，构建主页链接
      const homepageUrl = url; // 直接使用原始URL作为主页链接
      
      bloggers.push({ 
        nickname, 
        posts: posts.slice(0, 3),
        homepageUrl: homepageUrl
      });

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
  bloggers.forEach((blogger) => {
    const { nickname, posts, homepageUrl } = blogger;
    const newCount = posts.filter(p => p.isToday).length;
    if (newCount > 0) hasNew = true;
    
    // 只有当有帖子时才显示
    if (posts.length === 0) {
      html += `<div class="card">
        <div class="card-header">
          <div class="name-wrapper">
            <span class="name">${escapeHtml(nickname)}</span>
            <a href="${escapeHtml(homepageUrl || '#')}" target="_blank" class="homepage-btn" title="访问博主主页">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </a>
          </div>
        </div>
        <div class="post-list">
          <div class="empty">暂无获取到数据 (可能需要登录或反爬虫限制)</div>
        </div>
      </div>`;
      return;
    }
    
    html += `<div class="card">
      <div class="card-header">
        <div class="name-wrapper">
          <span class="name">${escapeHtml(nickname)}</span>
          <a href="${escapeHtml(homepageUrl || '#')}" target="_blank" class="homepage-btn" title="访问博主主页">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>
        ${newCount > 0 ? '<span class="badge">✨ 今日更新</span>' : ''}
      </div>
      <div class="post-list">`;

    posts.forEach(p => {
      const timeClass = p.isToday ? 'time new' : 'time';
      
      // 处理图片 - 支持base64和普通URL
      let imgHtml = '';
      if (p.images && Array.isArray(p.images) && p.images.length > 0) {
        const firstImg = p.images[0];
        if (firstImg && firstImg.trim() !== '') {
          // base64图片或普通URL都可以直接使用
          imgHtml = `<div class="thumb">
            <img src="${escapeHtml(firstImg)}" alt="${escapeHtml(p.title)}" loading="lazy" onerror="this.style.display='none'; this.parentElement.style.display='none';">
          </div>`;
        }
      }
      
      // 帖子项不再需要链接，只显示信息
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
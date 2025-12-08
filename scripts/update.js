
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 辅助函数：延迟
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 获取博主链接列表（优先从环境变量，否则从文件）
function getBloggerLinks() {
  // 优先从环境变量读取（GitHub Secrets）
  if (process.env.BLOGGER_LINKS) {
    console.log('从环境变量 BLOGGER_LINKS 读取链接');
    return process.env.BLOGGER_LINKS
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  }
  
  // 回退到 links.txt 文件
  const linksPath = path.join(__dirname, '../links.txt');
  if (fs.existsSync(linksPath)) {
    console.log('从 links.txt 文件读取链接');
    return fs.readFileSync(linksPath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  }
  
  console.log('⚠️ 未找到链接配置（环境变量 BLOGGER_LINKS 或 links.txt 文件）');
  return [];
}

async function getBloggers() {
  // 获取链接列表
  const urls = getBloggerLinks();
  
  if (urls.length === 0) {
    console.log('没有配置任何博主链接');
    return [];
  }

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
        const now = new Date();
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

          // --- 时间 ---
            let rawTime = '';
            if (container) {
              const timeEl = container.querySelector('.createTime');
              if (timeEl) rawTime = timeEl.innerText.trim();
            }
            
            // 判断是否是今天的帖子（从 "12-05" 格式中提取日期并与今天对比）
            let isToday = false;
            if (rawTime) {
              // 从时间字符串中提取 MM-DD 格式的日期（如 "12-05"）
              // 匹配格式：MM-DD 或 MM/DD（可能后面还有时间，如 "12-05 10:30"）
              const dateMatch = rawTime.match(/(\d{1,2})[-\/](\d{1,2})/);
              if (dateMatch) {
                const postMonth = parseInt(dateMatch[1]);
                const postDay = parseInt(dateMatch[2]);
                const todayMonth = now.getMonth() + 1; // getMonth() 返回 0-11
                const todayDay = now.getDate();
                
                // 直接比较月份和日期
                isToday = (postMonth === todayMonth && postDay === todayDay);
              }
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
                // 使用 outerHTML 或直接读取属性，确保获取完整的 base64 字符串
                let src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
                // 如果属性值看起来被截断，尝试从 outerHTML 中提取
                if (src && src.startsWith('data:image') && !src.endsWith('=') && !src.endsWith('==') && !src.endsWith('===')) {
                  // base64 应该以 =、== 或 === 结尾，如果没有，可能被截断了
                  // 尝试从 outerHTML 中提取完整的 base64
                  try {
                    const outerHTML = img.outerHTML;
                    const base64Match = outerHTML.match(/src=["'](data:image\/[^;]+;base64,[^"']+)["']/);
                    if (base64Match && base64Match[1]) {
                      src = base64Match[1];
                    }
                  } catch (e) {}
                }
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
            if (imgSrc) {
              if (imgSrc.startsWith('data:image')) {
                // 清理 base64 字符串：移除可能的乱码字符（非 base64 字符）
                // base64 只包含 A-Z, a-z, 0-9, +, /, = 字符
                const base64Match = imgSrc.match(/^(data:image\/[^;]+;base64,)([A-Za-z0-9+\/=\s]*)/);
                if (base64Match) {
                  // 移除末尾的非 base64 字符（乱码）
                  let base64Data = base64Match[2].replace(/[^A-Za-z0-9+\/=]/g, '');
                  // 确保 base64 字符串长度是 4 的倍数（必要时添加填充）
                  const remainder = base64Data.length % 4;
                  if (remainder > 0) {
                    base64Data += '='.repeat(4 - remainder);
                  }
                  imgSrc = base64Match[1] + base64Data;
                }
              } else if (!imgSrc.startsWith('http')) {
                if (imgSrc.startsWith('//')) {
                  imgSrc = 'https:' + imgSrc;
                } else if (imgSrc.startsWith('/')) {
                  imgSrc = window.location.origin + imgSrc;
                }
              }
            }

            results.push({
              title,
              time: rawTime || '未知时间',
              isToday: isToday,
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
  
  // 从环境变量读取网页密码
  const pagePassword = process.env.EMAIL_PASSWORD;
  if (!pagePassword) {
    throw new Error('❌ 必须设置环境变量 EMAIL_PASSWORD 用于网页密码保护');
  }
  
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
  
  // 转义JavaScript字符串中的特殊字符
  const escapeJsString = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  };
  
  // 从主页链接中提取博主ID
  const extractBloggerId = (url) => {
    if (!url) return null;
    // 匹配链接末尾的数字
    const match = url.match(/\/(\d+)(?:\?|$)/);
    return match ? match[1] : null;
  };
  
  // 生成Google搜索链接
  const generateGoogleSearchUrl = (bloggerId) => {
    if (!bloggerId) return '#';
    // 从环境变量读取搜索域名，如果没有设置则返回 #
    const searchDomain = process.env.GOOGLE_SEARCH_DOMAIN;
    if (!searchDomain) return '#';
    return `https://www.google.com/search?q=${bloggerId}&q=site%3A${encodeURIComponent(searchDomain)}`;
  };
  
  // 美化 HTML 模板（带密码保护）
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>动态监控站</title>
<link rel="stylesheet" href="style.css">
<style>
  .password-lock {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  }
  .password-form {
    background: white;
    padding: 40px;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    max-width: 400px;
    width: 90%;
    text-align: center;
  }
  .password-form h2 {
    margin-bottom: 20px;
    color: #2d3748;
    font-size: 24px;
  }
  .password-form p {
    margin-bottom: 20px;
    color: #718096;
  }
  .password-input {
    width: 100%;
    padding: 12px 16px;
    font-size: 16px;
    border: 2px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 12px;
    box-sizing: border-box;
    font-family: inherit;
  }
  .password-input:focus {
    outline: none;
    border-color: #667eea;
  }
  .password-btn {
    width: 100%;
    padding: 12px 24px;
    font-size: 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.3s;
  }
  .password-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }
  .password-error {
    color: #e53e3e;
    margin-top: 12px;
    font-size: 14px;
    display: none;
  }
  .main-content {
    display: none;
  }
  .main-content.unlocked {
    display: block;
  }
</style>
<script>
  function checkPassword() {
    const password = document.getElementById('page-password').value;
    const correctPassword = '${escapeJsString(pagePassword)}';
    
    if (password === correctPassword) {
      document.getElementById('password-lock').style.display = 'none';
      document.getElementById('main-content').classList.add('unlocked');
      // 保存到sessionStorage，刷新页面后仍然解锁
      sessionStorage.setItem('pageUnlocked', 'true');
    } else {
      document.getElementById('password-error').style.display = 'block';
      document.getElementById('page-password').value = '';
    }
  }
  
  // 页面加载时检查是否已解锁
  window.addEventListener('DOMContentLoaded', function() {
    if (sessionStorage.getItem('pageUnlocked') === 'true') {
      document.getElementById('password-lock').style.display = 'none';
      document.getElementById('main-content').classList.add('unlocked');
    }
    
    // 支持回车键提交
    const input = document.getElementById('page-password');
    if (input) {
      input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          checkPassword();
        }
      });
      input.focus();
    }
  });
</script>
</head>
<body>
<div class="password-lock" id="password-lock">
  <div class="password-form">
    <h2>🔒 网站已加密</h2>
    <p>请输入密码访问</p>
    <input type="password" id="page-password" class="password-input" placeholder="请输入密码" autofocus>
    <button onclick="checkPassword()" class="password-btn">解锁访问</button>
    <div id="password-error" class="password-error">❌ 密码错误，请重试</div>
  </div>
</div>
<div class="main-content" id="main-content">
<header>
  <h1>🌊 动态监控站</h1>
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
      const bloggerId = extractBloggerId(homepageUrl);
      const googleSearchUrl = generateGoogleSearchUrl(bloggerId);
      
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
            <a href="${escapeHtml(googleSearchUrl)}" target="_blank" class="search-btn" title="Google搜索">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
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
    
    const bloggerId = extractBloggerId(homepageUrl);
    const googleSearchUrl = generateGoogleSearchUrl(bloggerId);
    
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
          <a href="${escapeHtml(googleSearchUrl)}" target="_blank" class="search-btn" title="Google搜索">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
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
          // base64图片不需要转义，普通URL需要转义引号
          // 对于src属性，只需要转义引号，base64数据本身不应该被转义
          let imgSrc = firstImg;
          if (!imgSrc.startsWith('data:image')) {
            // 普通URL需要转义引号
            imgSrc = imgSrc.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
          }
          // base64图片直接使用，不转义
          imgHtml = `<div class="thumb">
            <img src="${imgSrc}" alt="${escapeHtml(p.title)}" loading="lazy" onerror="this.style.display='none'; this.parentElement.style.display='none';">
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
    <p>2025</a></p>
  </footer>
</div>
  </body></html>`;

  fs.writeFileSync('index.html', html);
  console.log('HTML 生成完毕');
}

// 加密函数
function encryptData(data, key) {
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyHash, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// 解密函数
function decryptData(encryptedData, key) {
  const parts = encryptedData.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted data format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = Buffer.from(parts[1], 'hex');
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return JSON.parse(decrypted.toString());
}

// 保存B记录：所有博主的最新3条帖子（用于手动发送和对比更新，加密保存）
function saveBloggersLatest(bloggers) {
  const latestFile = path.join(__dirname, '../data/bloggers_latest.enc');
  const dataDir = path.join(__dirname, '../data');
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    throw new Error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于数据加密');
  }
  
  // 确保 data 目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // 读取现有的B记录（如果存在，用于对比）
  let existingLatest = [];
  if (fs.existsSync(latestFile)) {
    try {
      const encryptedData = fs.readFileSync(latestFile, 'utf-8');
      existingLatest = decryptData(encryptedData, encryptKey);
    } catch (e) {
      console.log('⚠️ 读取现有B记录失败，将创建新记录');
    }
  }
  
  // 保存所有博主的最新3条帖子
  const latestData = bloggers.map(blogger => ({
    nickname: blogger.nickname,
    homepageUrl: blogger.homepageUrl,
    posts: blogger.posts.slice(0, 3).map(p => ({
      title: p.title,
      time: p.time,
      isToday: p.isToday,
      images: p.images
    }))
  }));
  
  // 加密保存
  const encrypted = encryptData(latestData, encryptKey);
  fs.writeFileSync(latestFile, encrypted, 'utf-8');
  console.log(`✓ 已加密保存 ${latestData.length} 个博主的最新帖子到 ${latestFile}`);
  
  return latestData;
}

// 保存A记录：当天有更新的博主数据（用于定时发送，加密保存）
function saveDailyUpdates(bloggers) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dailyFile = path.join(__dirname, `../data/daily_${today}.enc`);
  const dataDir = path.join(__dirname, '../data');
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    throw new Error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于数据加密');
  }
  
  // 确保 data 目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // 筛选出当天有更新的博主，只保存当天的帖子
  const todayUpdates = bloggers
    .filter(blogger => {
      const hasTodayPosts = blogger.posts.some(p => p.isToday);
      return hasTodayPosts && blogger.posts.length > 0;
    })
    .map(blogger => ({
      nickname: blogger.nickname,
      homepageUrl: blogger.homepageUrl,
      posts: blogger.posts
        .filter(p => p.isToday) // 只保存当天的帖子
        .map(p => ({
        title: p.title,
        time: p.time,
        isToday: p.isToday,
        images: p.images
      }))
    }));
  
  // 保存到文件（加密）
  if (todayUpdates.length > 0) {
    const encrypted = encryptData(todayUpdates, encryptKey);
    fs.writeFileSync(dailyFile, encrypted, 'utf-8');
    console.log(`✓ 已加密保存 ${todayUpdates.length} 个博主的今日更新到 ${dailyFile}`);
  } else {
    // 如果没有更新，删除当天的文件（如果存在）
    if (fs.existsSync(dailyFile)) {
      fs.unlinkSync(dailyFile);
      console.log(`✓ 今日无更新，已删除 ${dailyFile}`);
    } else {
      console.log('✓ 今日无更新');
    }
  }
  
  return todayUpdates.length > 0;
}

async function main() {
  const bloggers = await getBloggers();
  generateHTML(bloggers);
  // 保存B记录（所有博主最新3条帖子）
  saveBloggersLatest(bloggers);
  // 保存A记录（当天更新的帖子）
  saveDailyUpdates(bloggers);
}

// 如果直接运行此文件，执行主函数
if (require.main === module) {
main().catch(console.error);
}

// 导出函数供其他脚本使用
module.exports = { getBloggers, generateHTML, saveDailyUpdates, saveBloggersLatest };
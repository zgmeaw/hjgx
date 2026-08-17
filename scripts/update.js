const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 辅助函数：延迟
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 获取博主链接列表（从加密的 links.txt 文件读取）
function getBloggerLinks() {
  const linksPath = path.join(__dirname, '../links.txt');
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    console.error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于解密链接文件');
    return [];
  }
  
  if (!fs.existsSync(linksPath)) {
    console.log('⚠️ links.txt 文件不存在，请先通过网页管理界面添加链接');
    return [];
  }
  
  try {
    const fileContent = fs.readFileSync(linksPath, 'utf-8').trim();
    if (!fileContent) {
      console.log('⚠️ links.txt 文件为空');
      return [];
    }
    
    try {
      const decryptedData = decryptData(fileContent, encryptKey);
      if (Array.isArray(decryptedData)) {
        console.log('从加密的 links.txt 文件读取链接（已隐藏链接信息）');
        if (decryptedData.length > 0 && typeof decryptedData[0] === 'object' && decryptedData[0].url) {
          return decryptedData.filter(item => item && item.url && item.url.trim() !== '');
        } else {
          const converted = decryptedData
            .filter(link => link && link.trim() !== '')
            .map(url => ({ name: '', url: url.trim() }));
          const encrypted = encryptData(converted, encryptKey);
          fs.writeFileSync(linksPath, encrypted, 'utf-8');
          console.log('✓ 已转换链接格式为 {name, url}');
          return converted;
        }
      }
    } catch (e) {
      console.log('从 links.txt 文件读取链接（未加密格式，将自动加密，已隐藏链接信息）');
      const links = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(url => ({ name: '', url: url }));
      
      if (links.length > 0) {
        const encrypted = encryptData(links, encryptKey);
        fs.writeFileSync(linksPath, encrypted, 'utf-8');
        console.log('✓ 已自动加密 links.txt 文件');
      }
      
      return links;
    }
  } catch (error) {
    console.error('❌ 读取 links.txt 文件失败:', error.message);
    return [];
  }
  
  return [];
}

function saveBloggerLinks(links) {
  const linksPath = path.join(__dirname, '../links.txt');
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    console.error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于加密链接文件');
    return;
  }
  
  const formattedLinks = links
    .filter(item => item && item.url && item.url.trim() !== '')
    .map(item => ({
      name: item.name || '',
      url: item.url.trim()
    }));
  
  const encrypted = encryptData(formattedLinks, encryptKey);
  fs.writeFileSync(linksPath, encrypted, 'utf-8');
  console.log(`✓ 已保存 ${formattedLinks.length} 个链接到 links.txt（已加密）`);
}

async function getBloggers() {
  const linksData = getBloggerLinks();
  
  if (linksData.length === 0) {
    console.log('没有配置任何博主链接');
    return [];
  }

  const urls = linksData.map(item => item.url);
  console.log(`计划抓取 ${urls.length} 个博主`);

  const bloggers = [];
  const linksMap = new Map(linksData.map(item => [item.url, item.name]));
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080'
    ]
  });

  for (const url of urls) {
    console.log(`-------------------------------------------`);
    console.log(`正在访问博主 ${urls.indexOf(url) + 1}/${urls.length}`);
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      
      await delay(3000);
      try {
        const closeSelectors = [
          '.ant-modal-close', 
          '.close-btn', 
          'button[aria-label="Close"]', 
          '.van-icon-cross'
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

      let nickname = '未知用户';
      try {
        await page.waitForSelector('body');
        nickname = await page.evaluate(() => {
          const commonSelectors = [
            '.nickname', '.user-name', '.username', 
            'h1', '.user-info .name', '.profile-name',
            'span[data-v-27fff83a]'
          ];
          for (const selector of commonSelectors) {
            const nameEl = document.querySelector(selector);
            if (nameEl && nameEl.innerText.trim()) {
              const text = nameEl.innerText.trim();
              if (text.length < 50 && !text.includes('登录') && !text.includes('注册')) {
                return text;
              }
            }
          }
          
          const text = document.body.innerText;
          const match = text.match(/(.+?)\s*\(ID:\s*\d+\)/);
          if (match) {
            const matchedName = match[1].trim();
            if (matchedName.length < 50) {
              return matchedName;
            }
          }
          
          const spans = document.querySelectorAll('span');
          for (const span of spans) {
            const text = span.innerText.trim();
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

      console.log('正在等待帖子列表加载...');
      
      await delay(3000);
      
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
          await Promise.race([
            page.waitForSelector('.title', { timeout: 8000 }),
            new Promise((resolve) => setTimeout(resolve, 8000))
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
      
      await delay(2000);

      console.log('开始提取帖子数据...');
      
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

      console.log('开始快速提取数据...');
      const posts = await page.evaluate(() => {
        const now = new Date();
        const items = document.querySelectorAll('.title');
        const results = [];

        for (let idx = 0; idx < Math.min(items.length, 3); idx++) {
          try {
            const item = items[idx];

            const title = item.innerText.trim() || item.getAttribute('title') || '';
            if (!title) continue;

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

            let rawTime = '';
            if (container) {
              const timeEl = container.querySelector('.createTime');
              if (timeEl) rawTime = timeEl.innerText.trim();
            }
            
            let isToday = false;
            if (rawTime) {
              const dateMatch = rawTime.match(/(\d{1,2})[-\/](\d{1,2})/);
              if (dateMatch) {
                const postMonth = parseInt(dateMatch[1]);
                const postDay = parseInt(dateMatch[2]);
                const todayMonth = now.getMonth() + 1;
                const todayDay = now.getDate();
                isToday = (postMonth === todayMonth && postDay === todayDay);
              }
            }
          
            let imgSrc = '';

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
            
            if (!imgSrc && container) {
              const imgs = container.querySelectorAll('img');
              for (const img of imgs) {
                let src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
                if (src && src.startsWith('data:image') && !src.endsWith('=') && !src.endsWith('==') && !src.endsWith('===')) {
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
            
            if (!imgSrc) {
              let parent = item.parentElement;
              for (let d = 0; d < 5 && parent; d++) {
                const imgs = parent.querySelectorAll('img');
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
            
            if (imgSrc) {
              if (imgSrc.startsWith('data:image')) {
                const base64Match = imgSrc.match(/^(data:image\/[^;]+;base64,)([A-Za-z0-9+\/=\s]*)/);
                if (base64Match) {
                  let base64Data = base64Match[2].replace(/[^A-Za-z0-9+\/=]/g, '');
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
            // 跳过
          }
        }

        return results;
      });
      
      console.log(`✓ 数据提取完成，获取到 ${posts.length} 条帖子`);
      
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
      
      const hasImage = posts.some(p => p.images && p.images.length > 0);
      if (!hasImage) {
        console.log('\n⚠️ 调试信息:');
        console.log('  - 未获取到任何图片，可能需要检查 .attachments 元素的位置');
      }

      const homepageUrl = url;
      
      if (linksMap.has(homepageUrl) && (!linksMap.get(homepageUrl) || linksMap.get(homepageUrl).trim() === '')) {
        linksMap.set(homepageUrl, nickname);
      }
      
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
  
  const updatedLinks = linksData.map(item => ({
    name: linksMap.get(item.url) || item.name || '',
    url: item.url
  }));
  
  const hasNameUpdate = updatedLinks.some((item, index) => {
    const original = linksData[index];
    return original && (original.name || '').trim() !== (item.name || '').trim();
  });
  
  if (hasNameUpdate) {
    saveBloggerLinks(updatedLinks);
    console.log('✓ 已更新链接对应的博主名称');
  }
  
  return bloggers;
}

function generateHTML(bloggers) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  const escapeHtml = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const extractBloggerId = (url) => {
    if (!url) return null;
    const match = url.match(/\/(\d+)(?:\?|$)/);
    return match ? match[1] : null;
  };
  
  const generateGoogleSearchUrl = (bloggerId) => {
    if (!bloggerId) return '#';
    const searchDomain = process.env.GOOGLE_SEARCH_DOMAIN;
    if (!searchDomain) return '#';
    return `https://www.google.com/search?q=${bloggerId}&q=site%3A${encodeURIComponent(searchDomain)}`;
  };
  
  // 网页访问密码：优先使用 GitHub secret（EMAIL_PASSWORD），未设置时回退到默认密码
  const accessPasswordHash = crypto.createHash('sha256').update(process.env.EMAIL_PASSWORD || '1008611').digest('hex');

  // 美化 HTML 模板
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>动态监控站</title>
<link rel="stylesheet" href="style.css">
<style>
  .link-manager {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    z-index: 20000;
    overflow-y: auto;
  }
  .link-manager.active {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 20px;
  }
  .link-manager-content {
    background: white;
    border-radius: 16px;
    padding: 30px;
    max-width: 800px;
    width: 100%;
    margin-top: 50px;
    margin-bottom: 50px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }
  .link-manager-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  .link-manager-header h2 {
    margin: 0;
    color: #2d3748;
  }
  .link-list {
    margin-bottom: 20px;
  }
  .link-item {
    display: flex;
    align-items: center;
    padding: 12px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 10px;
    background: #f7fafc;
    gap: 10px;
  }
  .link-item .name-input {
    width: 150px;
    padding: 8px 12px;
    border: 1px solid #cbd5e0;
    border-radius: 6px;
    font-size: 14px;
  }
  .link-item .url-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #cbd5e0;
    border-radius: 6px;
    font-size: 14px;
  }
  .link-item button {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    margin-left: 5px;
  }
  .btn-delete {
    background: #e53e3e;
    color: white;
  }
  .btn-delete:hover {
    background: #c53030;
  }
  .btn-add {
    background: #48bb78;
    color: white;
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 20px;
  }
  .btn-add:hover {
    background: #38a169;
  }
  .btn-close {
    background: #718096;
    color: white;
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  .btn-close:hover {
    background: #4a5568;
  }
  .link-manager-actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }
  .btn-save {
    background: #667eea;
    color: white;
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
    flex: 1;
  }
  .btn-save:hover {
    background: #5568d3;
  }
  .link-manager-info {
    background: #edf2f7;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 14px;
    color: #4a5568;
    line-height: 1.6;
  }
  .github-token-section {
    margin-bottom: 20px;
    padding: 15px;
    background: #fff5e6;
    border: 1px solid #ffd700;
    border-radius: 8px;
  }
  .github-token-section label {
    display: block;
    margin-bottom: 8px;
    font-weight: 600;
    color: #2d3748;
  }
  .github-token-section input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #cbd5e0;
    border-radius: 6px;
    font-size: 14px;
    box-sizing: border-box;
  }
  .config-manager {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    z-index: 20000;
    overflow-y: auto;
  }
  .config-manager.active {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 20px;
  }
  .config-manager-content {
    background: white;
    border-radius: 16px;
    padding: 30px;
    max-width: 600px;
    width: 100%;
    margin-top: 50px;
    margin-bottom: 50px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }
  .config-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 15px;
    background: #f7fafc;
  }
  .config-item-label {
    flex: 1;
  }
  .config-item-label strong {
    display: block;
    margin-bottom: 5px;
    color: #2d3748;
  }
  .config-item-label small {
    display: block;
    color: #718096;
    font-size: 12px;
  }
  .config-toggle {
    position: relative;
    width: 60px;
    height: 30px;
    background: #cbd5e0;
    border-radius: 15px;
    cursor: pointer;
    transition: background 0.3s;
  }
  .config-toggle.active {
    background: #48bb78;
  }
  .config-toggle-slider {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 24px;
    height: 24px;
    background: white;
    border-radius: 50%;
    transition: transform 0.3s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }
  .config-toggle.active .config-toggle-slider {
    transform: translateX(30px);
  }
  .pw-gate {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .pw-gate.hidden { display: none; }
  .pw-gate-box {
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 20px;
    padding: 40px 36px;
    max-width: 400px;
    width: 100%;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }
  .pw-gate-box h1 { margin: 0 0 6px; font-size: 1.6rem; color: #fff; }
  .pw-gate-box .pw-sub { margin: 0 0 20px; color: rgba(255, 255, 255, 0.85); font-size: 14px; }
  .pw-gate-box input {
    width: 100%;
    padding: 12px 14px;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 10px;
    font-size: 15px;
    box-sizing: border-box;
    outline: none;
    text-align: center;
  }
  .pw-gate-box button {
    width: 100%;
    margin-top: 14px;
    padding: 12px;
    border: none;
    border-radius: 10px;
    background: #ff6b9d;
    color: #fff;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
  }
  .pw-gate-box button:hover { background: #ff8fb3; }
  .pw-error {
    display: none;
    margin: 12px 0 0;
    color: #ffd6d6;
    font-size: 13px;
  }
</style>
<script>
  // 链接管理功能
  let currentLinks = [];

  // 安全的 localStorage 封装（部分浏览器/隐私模式会禁用 localStorage，直接访问会抛异常导致按钮无响应）
  function safeGetItem(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function safeRemoveItem(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  
  function showLinkManager() {
    if (window.currentBloggerLinks && window.currentBloggerLinks.length > 0) {
      currentLinks = window.currentBloggerLinks.map(item => ({
        name: item.name || '',
        url: item.url || ''
      }));
    } else {
      currentLinks = [];
      document.querySelectorAll('.card').forEach(card => {
        const linkEl = card.querySelector('.homepage-btn');
        const nameEl = card.querySelector('.name');
        if (linkEl && linkEl.href && linkEl.href !== '#' && linkEl.href !== window.location.href + '#') {
          currentLinks.push({
            name: nameEl ? nameEl.innerText.trim() : '',
            url: linkEl.href
          });
        }
      });
      const seen = new Set();
      currentLinks = currentLinks.filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
    }
    
    if (currentLinks.length === 0) {
      currentLinks = [{ name: '', url: '' }];
    }
    
    const savedToken = safeGetItem('github_pat');
    const tokenSection = document.getElementById('github-token-section');
    if (savedToken) {
      if (tokenSection) tokenSection.style.display = 'none';
    } else {
      if (tokenSection) tokenSection.style.display = 'block';
    }
    
    renderLinkManager();
    document.getElementById('link-manager').classList.add('active');
  }
  
  function saveToken() {
    const tokenInput = document.getElementById('github-token');
    const token = tokenInput ? tokenInput.value.trim() : '';
    
    if (!token) {
      alert('⚠️ 请输入 Token！');
      return;
    }
    
    safeSetItem('github_pat', token);
    alert('✓ Token 已保存到浏览器！\\n\\n下次使用时将自动使用，无需再次输入。');
    
    const tokenSection = document.getElementById('github-token-section');
    if (tokenSection) tokenSection.style.display = 'none';
    if (tokenInput) tokenInput.value = '';
  }
  
  function hideLinkManager() {
    document.getElementById('link-manager').classList.remove('active');
  }
  
  function renderLinkManager() {
    const container = document.getElementById('link-list');
    container.innerHTML = '';
    
    currentLinks.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'link-item';
      div.innerHTML = \`
        <input type="text" class="name-input" value="\${item.name || ''}" id="name-\${index}" placeholder="博主名称" onchange="updateLinkName(\${index}, this.value)">
        <input type="text" class="url-input" value="\${item.url || ''}" id="url-\${index}" placeholder="链接地址" onchange="updateLinkUrl(\${index}, this.value)">
        <button class="btn-delete" onclick="deleteLink(\${index})">删除</button>
      \`;
      container.appendChild(div);
    });
  }
  
  function addLink() {
    currentLinks.push({ name: '', url: '' });
    renderLinkManager();
    const newInput = document.getElementById('url-' + (currentLinks.length - 1));
    if (newInput) newInput.focus();
  }
  
  function deleteLink(index) {
    currentLinks.splice(index, 1);
    renderLinkManager();
  }
  
  function updateLinkName(index, value) {
    if (currentLinks[index]) currentLinks[index].name = value.trim();
  }
  
  function updateLinkUrl(index, value) {
    if (currentLinks[index]) currentLinks[index].url = value.trim();
  }
  
  // 配置管理功能
  let currentConfig = {
    emailEnabled: 'on',
    crawlerEnabled: 'on',
    wechatEnabled: 'on'
  };
  
  function showConfigManager() {
    if (window.currentConfig) {
      currentConfig = { ...window.currentConfig };
    }
    updateConfigUI();
    document.getElementById('config-manager').classList.add('active');
  }
  
  function hideConfigManager() {
    document.getElementById('config-manager').classList.remove('active');
  }
  
  function updateConfigUI() {
    document.getElementById('toggle-email').classList.toggle('active', currentConfig.emailEnabled === 'on');
    document.getElementById('toggle-crawler').classList.toggle('active', currentConfig.crawlerEnabled === 'on');
    document.getElementById('toggle-wechat').classList.toggle('active', currentConfig.wechatEnabled === 'on');
  }
  
  function toggleConfig(type) {
    const key = type === 'email' ? 'emailEnabled' : (type === 'crawler' ? 'crawlerEnabled' : 'wechatEnabled');
    currentConfig[key] = currentConfig[key] === 'on' ? 'off' : 'on';
    updateConfigUI();
  }
  
  async function saveConfig() {
    const token = safeGetItem('github_pat') || '';
    
    if (!token || token.trim() === '') {
      const tokenInput = prompt('请输入 GitHub Personal Access Token（需要 repo 权限）：\\n\\n提示：Token 将保存到浏览器中，下次使用时无需再次输入。');
      
      if (!tokenInput || tokenInput.trim() === '') {
        alert('⚠️ 需要 Token 才能保存配置！');
        return;
      }
      
      safeSetItem('github_pat', tokenInput.trim());
    }
    
    const finalToken = safeGetItem('github_pat');
    
    try {
      const repoInfo = window.repoInfo || {};
      let owner = repoInfo.owner;
      let repo = repoInfo.repo;
      
      if (!owner || !repo) {
        const repoMatch = window.location.hostname.match(/([^.]+)\.github\.io/);
        if (repoMatch) {
          owner = repoMatch[1];
          const pathParts = window.location.pathname.split('/').filter(p => p);
          repo = pathParts[0] || 'hjgx';
        }
      }
      
      if (!owner || !repo) {
        owner = prompt('请输入 GitHub 用户名/组织名：');
        repo = prompt('请输入仓库名：');
        
        if (!owner || !repo) throw new Error('无法确定仓库信息');
      }
      
      const response = await fetch(\`https://api.github.com/repos/\${owner}/\${repo}/dispatches\`, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': \`token \${finalToken}\`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'update-config',
          client_payload: {
            config: currentConfig
          }
        })
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: '触发 workflow 失败' }));
        throw new Error(error.message || '触发 workflow 失败');
      }
      
      alert('✓ 配置已成功保存！\\n\\n配置将在几秒内生效。');
      hideConfigManager();
    } catch (error) {
      console.error('保存配置失败:', error);
      if (error.message.includes('Bad credentials') || error.message.includes('401')) {
        safeRemoveItem('github_pat');
        alert('❌ Token 无效或已过期，已清除保存的 Token。\\n\\n请重新输入正确的 Token。');
      } else {
        alert('❌ 保存配置失败: ' + error.message + '\\n\\n请检查：\\n1. Token 是否正确\\n2. Token 是否有 repo 权限\\n3. 网络连接是否正常');
      }
    }
  }
  
  async function saveLinks() {
    const validLinks = currentLinks.filter(item => item && item.url && item.url.trim() !== '');
    
    if (validLinks.length === 0) {
      alert('⚠️ 请至少添加一个链接！');
      return;
    }
    
    const formattedLinks = validLinks.map(item => ({
      name: (item.name || '').trim(),
      url: item.url.trim()
    }));
    
    let token = safeGetItem('github_pat');
    
    if (!token || token.trim() === '') {
      const tokenInput = prompt('请输入 GitHub Personal Access Token（需要 repo 权限）：\\n\\n提示：Token 将保存到浏览器中，下次使用时无需再次输入。\\n\\n如果不想输入 Token，可以取消并复制链接列表手动更新。');
      
      if (!tokenInput || tokenInput.trim() === '') {
        const linksText = formattedLinks.map(item => item.url).join('\\n');
        navigator.clipboard.writeText(linksText).then(() => {
          alert('✓ 链接已复制到剪贴板！\\n\\n请手动更新 links.txt 文件。');
        }).catch(() => {
          prompt('请复制以下链接列表：', linksText);
        });
        return;
      }
      
      token = tokenInput.trim();
      safeSetItem('github_pat', token);
    }
    
    try {
      await updateLinksViaGitHubAPI(token, formattedLinks);
      alert('✓ 链接已成功更新到 GitHub！\\n\\n文件将在几秒内自动更新，下次运行时会自动加密。\\n\\n提示：新添加的链接名称暂时为空，等下一次自动执行爬取任务时会自动补上对应的名字。');
      hideLinkManager();
    } catch (error) {
      console.error('GitHub API 更新失败:', error);
      if (error.message.includes('Bad credentials') || error.message.includes('401')) {
        safeRemoveItem('github_pat');
        alert('❌ Token 无效或已过期，已清除保存的 Token。\\n\\n请重新输入正确的 Token。');
      } else {
        alert('❌ 自动更新失败: ' + error.message + '\\n\\n请检查：\\n1. Token 是否正确\\n2. Token 是否有 repo 权限\\n3. 网络连接是否正常');
      }
    }
  }
  
  async function updateLinksViaGitHubAPI(token, linksArray) {
    const repoInfo = window.repoInfo || {};
    let owner = repoInfo.owner;
    let repo = repoInfo.repo;
    
    if (!owner || !repo) {
      const repoMatch = window.location.hostname.match(/([^.]+)\.github\.io/);
      if (repoMatch) {
        owner = owner || repoMatch[1];
        const pathParts = window.location.pathname.split('/').filter(p => p);
        repo = repo || pathParts[0] || 'hjgx';
      }
    }
    
    if (!owner || !repo) {
      owner = owner || prompt('请输入 GitHub 用户名/组织名：');
      repo = repo || prompt('请输入仓库名：');
      
      if (!owner || !repo) throw new Error('无法确定仓库信息，请手动输入');
    }
    
    return await triggerWorkflow(token, owner, repo, linksArray);
  }
  
  async function triggerWorkflow(token, owner, repo, linksArray) {
    const response = await fetch(\`https://api.github.com/repos/\${owner}/\${repo}/dispatches\`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': \`token \${token}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event_type: 'update-links',
        client_payload: {
          links: linksArray
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: '触发 workflow 失败' }));
      throw new Error(error.message || '触发 workflow 失败');
    }
    
    return { success: true };
  }

  // 确保函数在全局作用域可用（防止某些环境下内联 onclick 找不到函数）
  window.showLinkManager = showLinkManager;
  window.showConfigManager = showConfigManager;
  window.hideLinkManager = hideLinkManager;
  window.hideConfigManager = hideConfigManager;
  window.saveToken = saveToken;
  window.addLink = addLink;
  window.deleteLink = deleteLink;
  window.updateLinkName = updateLinkName;
  window.updateLinkUrl = updateLinkUrl;
  window.saveLinks = saveLinks;
  window.saveConfig = saveConfig;
  window.toggleConfig = toggleConfig;
</script>
</head>
<body>
<div class="pw-gate" id="pw-gate">
  <div class="pw-gate-box">
    <h1>🔒 访问验证</h1>
    <p class="pw-sub">请输入访问密码后进入</p>
    <input type="password" id="pw-input" placeholder="访问密码" autocomplete="off">
    <button onclick="pwCheck()">进入站点</button>
    <p class="pw-error" id="pw-error">❌ 密码错误，请重试</p>
  </div>
</div>
<script>
  // ===== 访问密码 =====
  // 密码在构建时注入（来自 GitHub secret EMAIL_PASSWORD，未设置时默认）
  var PW_HASH = '${accessPasswordHash}';

  function sha256(ascii) {
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var lengthProperty = 'length';
    var i, j;
    var result = '';
    var words = [];
    var asciiBitLength = ascii[lengthProperty] * 8;
    var hash = sha256.h = sha256.h || [];
    var k = sha256.k = sha256.k || [];
    var primeCounter = k[lengthProperty];
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) { isComposite[i] = candidate; }
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += String.fromCharCode(128);
    while (ascii[lengthProperty] % 64 - 56) ascii += String.fromCharCode(0);
    for (i = 0; i < ascii[lengthProperty]; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return;
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
    words[words[lengthProperty]] = (asciiBitLength);
    for (j = 0; j < words[lengthProperty];) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
              w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) { hash[i] = (hash[i] + oldHash[i]) | 0; }
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  function pwUnlock() {
    var gate = document.getElementById('pw-gate');
    if (gate) gate.classList.add('hidden');
  }

  function pwCheck() {
    var input = document.getElementById('pw-input');
    var err = document.getElementById('pw-error');
    var value = input ? input.value : '';
    if (sha256(value) === PW_HASH) {
      try { sessionStorage.setItem('pw_ok', '1'); } catch (e) {}
      pwUnlock();
    } else {
      if (err) err.style.display = 'block';
      if (input) { input.value = ''; input.focus(); }
    }
  }

  (function () {
    try {
      if (sessionStorage.getItem('pw_ok') === '1') { pwUnlock(); }
    } catch (e) {}
    var input = document.getElementById('pw-input');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) { pwCheck(); }
      });
    }
  })();
</script>
<div class="main-content" id="main-content">
<header>
  <h1>🌊 动态监控站</h1>
  <p class="update-time">最后更新：${now}</p>
  <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
    <button id="manage-links-btn" onclick="showLinkManager()" style="padding: 8px 16px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; cursor: pointer; font-size: 14px;">🔧 管理链接</button>
    <button id="manage-config-btn" onclick="showConfigManager()" style="padding: 8px 16px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; cursor: pointer; font-size: 14px;">⚙️ 功能配置</button>
  </div>
</header>
<div class="container">`;

  const currentBloggerLinks = bloggers.map(b => ({
    name: b.nickname || '',
    url: b.homepageUrl
  })).filter(item => item.url);
  
  const allLinksData = getBloggerLinks();
  const mergedLinks = allLinksData.map(item => {
    const blogger = bloggers.find(b => b.homepageUrl === item.url);
    return {
      name: blogger ? blogger.nickname : (item.name || ''),
      url: item.url
    };
  });
  
  const repoOwner = process.env.GITHUB_REPOSITORY_OWNER || '';
  const repoName = process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : '';
  
  const { getConfig } = require('./config');
  const currentConfig = getConfig();
  
  html += `<script>
    window.currentBloggerLinks = ${JSON.stringify(mergedLinks)};
    window.repoInfo = {
      owner: ${JSON.stringify(repoOwner)},
      repo: ${JSON.stringify(repoName)}
    };
    window.currentConfig = ${JSON.stringify(currentConfig)};
  </script>`;

  const parseDateFromTime = (timeStr) => {
    if (!timeStr || timeStr === '未知时间') return new Date(0);
    const dateMatch = timeStr.match(/(\d{1,2})[-\/](\d{1,2})/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1]);
      const day = parseInt(dateMatch[2]);
      const now = new Date();
      const year = now.getFullYear();
      const postDate = new Date(year, month - 1, day);
      if (postDate > now) {
        return new Date(year - 1, month - 1, day);
      }
      return postDate;
    }
    return new Date(0);
  };

  const sortedBloggers = [...bloggers].sort((a, b) => {
    const getLatestDate = (blogger) => {
      if (!blogger.posts || blogger.posts.length === 0) return new Date(0);
      let latestDate = new Date(0);
      blogger.posts.forEach(post => {
        const postDate = parseDateFromTime(post.time);
        if (postDate > latestDate) latestDate = postDate;
      });
      return latestDate;
    };
    
    const dateA = getLatestDate(a);
    const dateB = getLatestDate(b);
    return dateB.getTime() - dateA.getTime();
  });

  let hasNew = false;
  sortedBloggers.forEach((blogger) => {
    const { nickname, posts, homepageUrl } = blogger;
    const newCount = posts.filter(p => p.isToday).length;
    if (newCount > 0) hasNew = true;
    
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
      
      let imgHtml = '';
      if (p.images && Array.isArray(p.images) && p.images.length > 0) {
        const firstImg = p.images[0];
        if (firstImg && firstImg.trim() !== '') {
          let imgSrc = firstImg;
          if (!imgSrc.startsWith('data:image')) {
            imgSrc = imgSrc.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
          }
          imgHtml = `<div class="thumb">
            <img src="${imgSrc}" alt="${escapeHtml(p.title)}" loading="lazy" onerror="this.style.display='none'; this.parentElement.style.display='none';">
          </div>`;
        }
      }
      
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
  
  <!-- 链接管理界面 -->
  <div class="link-manager" id="link-manager">
    <div class="link-manager-content">
      <div class="link-manager-header">
        <h2>🔧 管理博主链接</h2>
        <button class="btn-close" onclick="hideLinkManager()">关闭</button>
      </div>
      <div class="link-manager-info">
        <strong>使用说明：</strong><br>
        1. 点击"添加链接"按钮添加新链接<br>
        2. 填写博主名称和链接地址<br>
        3. 新添加的链接名称可以为空，等下一次自动执行爬取任务时会自动补上<br>
        4. 点击"删除"按钮删除链接<br>
        5. 首次使用需要输入 GitHub Token，之后会自动保存到浏览器中<br>
        6. 点击"保存"按钮保存链接<br>
        <br>
        <strong>💡 提示：</strong>链接和名称会保存到 links.txt 文件（加密存储）。Token 仅存储在您的浏览器中，不会上传到服务器。
      </div>
      <div class="github-token-section" id="github-token-section" style="display: none;">
        <label for="github-token">GitHub Personal Access Token（首次使用需要输入）：</label>
        <input type="password" id="github-token" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx">
        <button class="btn-save-token" onclick="saveToken()" style="margin-top: 8px; padding: 8px 16px; background: #48bb78; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">保存 Token</button>
        <small style="display: block; margin-top: 8px; color: #718096; font-size: 12px;">💡 Token 仅存储在您的浏览器中，不会上传到服务器。创建 Token 时需勾选 "repo" 权限。</small>
      </div>
      <button class="btn-add" onclick="addLink()">➕ 添加链接</button>
      <div class="link-list" id="link-list"></div>
      <div class="link-manager-actions">
        <button class="btn-save" onclick="saveLinks()">💾 保存链接</button>
      </div>
    </div>
  </div>
  
  <!-- 配置管理界面 -->
  <div class="config-manager" id="config-manager">
    <div class="config-manager-content">
      <div class="link-manager-header">
        <h2>⚙️ 功能配置</h2>
        <button class="btn-close" onclick="hideConfigManager()">关闭</button>
      </div>
      <div class="link-manager-info" style="margin-bottom: 20px;">
        <strong>功能说明：</strong><br>
        1. 定时邮箱发送：控制每晚十点是否自动发送邮件<br>
        2. 爬虫功能：控制是否执行爬取任务（总开关）<br>
        3. 微信推送功能：控制是否发送微信推送消息<br>
        <br>
        <strong>💡 提示：</strong>配置会保存到加密文件中，修改后立即生效。
      </div>
      <div class="config-item">
        <div class="config-item-label">
          <strong>定时邮箱发送</strong>
          <small>控制每晚十点是否自动发送邮件通知</small>
        </div>
        <div class="config-toggle" id="toggle-email" onclick="toggleConfig('email')">
          <div class="config-toggle-slider"></div>
        </div>
      </div>
      <div class="config-item">
        <div class="config-item-label">
          <strong>爬虫功能</strong>
          <small>控制是否执行爬取任务（总开关）</small>
        </div>
        <div class="config-toggle" id="toggle-crawler" onclick="toggleConfig('crawler')">
          <div class="config-toggle-slider"></div>
        </div>
      </div>
      <div class="config-item">
        <div class="config-item-label">
          <strong>微信推送功能</strong>
          <small>控制是否发送微信推送消息</small>
        </div>
        <div class="config-toggle" id="toggle-wechat" onclick="toggleConfig('wechat')">
          <div class="config-toggle-slider"></div>
        </div>
      </div>
      <div class="link-manager-actions">
        <button class="btn-save" onclick="saveConfig()">💾 保存配置</button>
      </div>
    </div>
  </div>
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

function saveBloggersLatest(bloggers) {
  const latestFile = path.join(__dirname, '../data/bloggers_latest.enc');
  const dataDir = path.join(__dirname, '../data');
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    throw new Error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于数据加密');
  }
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const latestData = bloggers.map(blogger => ({
    nickname: blogger.nickname,
    homepageUrl: blogger.homepageUrl,
    posts: blogger.posts.slice(0, 3).map(p => ({
      title: p.title,
      time: p.time,
      isToday: p.isToday
    }))
  }));
  
  const encrypted = encryptData(latestData, encryptKey);
  fs.writeFileSync(latestFile, encrypted, 'utf-8');
  console.log(`✓ 已加密保存 ${latestData.length} 个博主的最新帖子（不含图片）到 ${latestFile}`);
  
  return latestData;
}

function saveDailyUpdates(bloggers) {
  const now = new Date();
  const beijingTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const year = beijingTime.getFullYear();
  const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;
  const dailyFile = path.join(__dirname, `../data/daily_${today}.enc`);
  const dataDir = path.join(__dirname, '../data');
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    throw new Error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于数据加密');
  }
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const todayUpdates = bloggers
    .filter(blogger => {
      const hasTodayPosts = blogger.posts.some(p => p.isToday);
      return hasTodayPosts && blogger.posts.length > 0;
    })
    .map(blogger => ({
      nickname: blogger.nickname,
      homepageUrl: blogger.homepageUrl,
      posts: blogger.posts
        .filter(p => p.isToday)
        .map(p => ({
        title: p.title,
        time: p.time,
        isToday: p.isToday,
        images: p.images
      }))
    }));
  
  if (todayUpdates.length > 0) {
    const encrypted = encryptData(todayUpdates, encryptKey);
    fs.writeFileSync(dailyFile, encrypted, 'utf-8');
    console.log(`✓ 已加密保存 ${todayUpdates.length} 个博主的今日更新到 ${dailyFile}`);
  } else {
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
  const { isCrawlerEnabled } = require('./config');
  if (!isCrawlerEnabled()) {
    console.log('ℹ️ 爬虫功能已关闭，跳过执行');
    return;
  }
  
  const bloggers = await getBloggers();
  generateHTML(bloggers);
  saveBloggersLatest(bloggers);
  saveDailyUpdates(bloggers);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { getBloggers, generateHTML, saveDailyUpdates, saveBloggersLatest };
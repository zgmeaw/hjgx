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
  
  // 美化 HTML 模板（已去除密码保护）
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
</style>
<script>
  // 链接管理功能
  let currentLinks = [];
  
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
    
    const savedToken = localStorage.getItem('github_pat');
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
    
    localStorage.setItem('github_pat', token);
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
    const token = localStorage.getItem('github_pat') || '';
    
    if (!token || token.trim() === '') {
      const tokenInput = prompt('请输入 GitHub Personal Access Token（需要 repo 权限）：\\n\\n提示：Token 将保存到浏览器中，下次使用时无需再次输入。');
      
      if (!tokenInput || tokenInput.trim() === '') {
        alert('⚠️ 需要 Token 才能保存配置！');
        return;
      }
      
      localStorage.setItem('github_pat', tokenInput.trim());
    }
    
    const finalToken = localStorage.getItem('github_pat');
    
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
        localStorage.removeItem('github_pat');
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
    
    let token = localStorage.getItem('github_pat');
    
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
      localStorage.setItem('github_pat', token);
    }
    
    try {
      await updateLinksViaGitHubAPI(token, formattedLinks);
      alert('✓ 链接已成功更新到 GitHub！\\n\\n文件将在几秒内自动更新，下次运行时会自动加密。\\n\\n提示：新添加的链接名称暂时为空，等下一次自动执行爬取任务时会自动补上对应的名字。');
      hideLinkManager();
    } catch (error) {
      console.error('GitHub API 更新失败:', error);
      if (error.message.includes('Bad credentials') || error.message.includes('401')) {
        localStorage.removeItem('github_pat');
        alert('❌ Token 无效或已过期，已清除保存的 Token。\\n\\n请重新输入正确的 Token。');
      } else {
        alert('❌ 自动更新失败: ' + error.message + '\\n\\n请检查：\\n1. Token 是否正确\\n2. Token 是否有 repo 权限\\n3. 网络连接是否正常');
      }
    }
  }
  
  async function updateLinksViaGitHubAPI(token, linksArray) {
    const repoInfo = window.repoInfo || {};
    let owner = repoInfo.owner;
    let repo = 

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 辅助函数：延迟
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 获取博主链接列表（从加密的 links.txt 文件读取）
// 返回格式：{name: string, url: string}[]
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
    
    // 尝试解密（如果文件是加密的）
    try {
      const decryptedData = decryptData(fileContent, encryptKey);
      // 如果解密成功，检查数据格式
      if (Array.isArray(decryptedData)) {
        console.log('从加密的 links.txt 文件读取链接（已隐藏链接信息）');
        // 检查是否是对象数组格式 {name, url}
        if (decryptedData.length > 0 && typeof decryptedData[0] === 'object' && decryptedData[0].url) {
          return decryptedData.filter(item => item && item.url && item.url.trim() !== '');
        } else {
          // 旧格式：字符串数组，转换为新格式
          const converted = decryptedData
            .filter(link => link && link.trim() !== '')
            .map(url => ({ name: '', url: url.trim() }));
          // 保存转换后的格式
          const encrypted = encryptData(converted, encryptKey);
          fs.writeFileSync(linksPath, encrypted, 'utf-8');
          console.log('✓ 已转换链接格式为 {name, url}');
          return converted;
        }
      }
    } catch (e) {
      // 如果解密失败，可能是未加密的文本格式（向后兼容）
      console.log('从 links.txt 文件读取链接（未加密格式，将自动加密，已隐藏链接信息）');
      const links = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(url => ({ name: '', url: url }));
      
      // 自动加密并保存
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

// 保存博主链接列表（加密保存）
function saveBloggerLinks(links) {
  const linksPath = path.join(__dirname, '../links.txt');
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    console.error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于加密链接文件');
    return;
  }
  
  // 确保格式正确
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
  // 获取链接列表（包含名称和URL）
  const linksData = getBloggerLinks();
  
  if (linksData.length === 0) {
    console.log('没有配置任何博主链接');
    return [];
  }

  // 提取URL列表用于爬取
  const urls = linksData.map(item => item.url);
  console.log(`计划抓取 ${urls.length} 个博主`);

  const bloggers = [];
  const linksMap = new Map(linksData.map(item => [item.url, item.name]));
  
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
    console.log(`正在访问博主 ${urls.indexOf(url) + 1}/${urls.length}`);
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
      
      // 如果链接对应的名称为空，更新为爬取到的名称
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
  
  // 更新链接名称（如果有新获取到的名称）
  const updatedLinks = linksData.map(item => ({
    name: linksMap.get(item.url) || item.name || '',
    url: item.url
  }));
  
  // 检查是否有名称更新
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
    // 从全局变量中读取链接（由服务器端注入）
    if (window.currentBloggerLinks && window.currentBloggerLinks.length > 0) {
      currentLinks = window.currentBloggerLinks.map(item => ({
        name: item.name || '',
        url: item.url || ''
      }));
    } else {
      // 如果没有，从页面中提取
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
      // 去重
      const seen = new Set();
      currentLinks = currentLinks.filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
    }
    
    // 如果没有找到链接，初始化一个空对象
    if (currentLinks.length === 0) {
      currentLinks = [{ name: '', url: '' }];
    }
    
    // 检查是否已保存 Token
    const savedToken = localStorage.getItem('github_pat');
    const tokenSection = document.getElementById('github-token-section');
    if (savedToken) {
      // 已保存 Token，隐藏输入框
      if (tokenSection) {
        tokenSection.style.display = 'none';
      }
    } else {
      // 未保存 Token，显示输入框
      if (tokenSection) {
        tokenSection.style.display = 'block';
      }
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
    
    // 保存到 localStorage
    localStorage.setItem('github_pat', token);
    alert('✓ Token 已保存到浏览器！\\n\\n下次使用时将自动使用，无需再次输入。');
    
    // 隐藏输入框
    const tokenSection = document.getElementById('github-token-section');
    if (tokenSection) {
      tokenSection.style.display = 'none';
    }
    
    // 清空输入框
    if (tokenInput) {
      tokenInput.value = '';
    }
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
    // 聚焦到新添加的URL输入框
    const newInput = document.getElementById('url-' + (currentLinks.length - 1));
    if (newInput) newInput.focus();
  }
  
  function deleteLink(index) {
    currentLinks.splice(index, 1);
    renderLinkManager();
  }
  
  function updateLinkName(index, value) {
    if (currentLinks[index]) {
      currentLinks[index].name = value.trim();
    }
  }
  
  function updateLinkUrl(index, value) {
    if (currentLinks[index]) {
      currentLinks[index].url = value.trim();
    }
  }
  
  // 配置管理功能
  let currentConfig = {
    emailEnabled: 'on',
    crawlerEnabled: 'on',
    wechatEnabled: 'on'
  };
  
  function showConfigManager() {
    // 从服务器获取当前配置（通过注入的方式）
    if (window.currentConfig) {
      currentConfig = { ...window.currentConfig };
    }
    
    // 更新界面显示
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
    // 获取用户输入的 Token
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
    
    // 通过 repository_dispatch 事件触发 workflow
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
        
        if (!owner || !repo) {
          throw new Error('无法确定仓库信息');
        }
      }
      
      // 通过 repository_dispatch 触发 workflow
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
      // 如果 Token 无效，清除保存的 Token
      if (error.message.includes('Bad credentials') || error.message.includes('401')) {
        localStorage.removeItem('github_pat');
        alert('❌ Token 无效或已过期，已清除保存的 Token。\\n\\n请重新输入正确的 Token。');
      } else {
        alert('❌ 保存配置失败: ' + error.message + '\\n\\n请检查：\\n1. Token 是否正确\\n2. Token 是否有 repo 权限\\n3. 网络连接是否正常');
      }
    }
  }
  
  async function saveLinks() {
    // 过滤空链接（至少要有URL）
    const validLinks = currentLinks.filter(item => item && item.url && item.url.trim() !== '');
    
    if (validLinks.length === 0) {
      alert('⚠️ 请至少添加一个链接！');
      return;
    }
    
    // 格式化链接数据（确保格式正确）
    const formattedLinks = validLinks.map(item => ({
      name: (item.name || '').trim(),
      url: item.url.trim()
    }));
    
    // 从 localStorage 获取 Token
    let token = localStorage.getItem('github_pat');
    
    // 如果没有保存的 Token，提示用户输入
    if (!token || token.trim() === '') {
      const tokenInput = prompt('请输入 GitHub Personal Access Token（需要 repo 权限）：\\n\\n提示：Token 将保存到浏览器中，下次使用时无需再次输入。\\n\\n如果不想输入 Token，可以取消并复制链接列表手动更新。');
      
      if (!tokenInput || tokenInput.trim() === '') {
        // 如果没有输入 Token，复制到剪贴板
        const linksText = formattedLinks.map(item => item.url).join('\\n');
        navigator.clipboard.writeText(linksText).then(() => {
          alert('✓ 链接已复制到剪贴板！\\n\\n请手动更新 links.txt 文件。');
        }).catch(() => {
          prompt('请复制以下链接列表：', linksText);
        });
        return;
      }
      
      // 保存 Token 到 localStorage
      token = tokenInput.trim();
      localStorage.setItem('github_pat', token);
    }
    
    // 使用 GitHub API 自动更新
    try {
      await updateLinksViaGitHubAPI(token, formattedLinks);
      alert('✓ 链接已成功更新到 GitHub！\\n\\n文件将在几秒内自动更新，下次运行时会自动加密。\\n\\n提示：新添加的链接名称暂时为空，等下一次自动执行爬取任务时会自动补上对应的名字。');
      hideLinkManager();
    } catch (error) {
      console.error('GitHub API 更新失败:', error);
      // 如果 Token 无效，清除保存的 Token
      if (error.message.includes('Bad credentials') || error.message.includes('401')) {
        localStorage.removeItem('github_pat');
        alert('❌ Token 无效或已过期，已清除保存的 Token。\\n\\n请重新输入正确的 Token。');
      } else {
        alert('❌ 自动更新失败: ' + error.message + '\\n\\n请检查：\\n1. Token 是否正确\\n2. Token 是否有 repo 权限\\n3. 网络连接是否正常');
      }
    }
  }
  
  async function updateLinksViaGitHubAPI(token, linksArray) {
    // 优先使用注入的仓库信息
    const repoInfo = window.repoInfo || {};
    let owner = repoInfo.owner;
    let repo = repoInfo.repo;
    
    // 如果注入的信息不完整，尝试从 URL 推断
    if (!owner || !repo) {
      // 假设页面托管在 GitHub Pages，URL 格式可能是：https://username.github.io/repo-name/
      const repoMatch = window.location.hostname.match(/([^.]+)\.github\.io/);
      if (repoMatch) {
        owner = owner || repoMatch[1];
        const pathParts = window.location.pathname.split('/').filter(p => p);
        repo = repo || pathParts[0] || 'hjgx'; // 默认仓库名
      }
    }
    
    // 如果还是无法确定，提示用户输入
    if (!owner || !repo) {
      owner = owner || prompt('请输入 GitHub 用户名/组织名：');
      repo = repo || prompt('请输入仓库名：');
      
      if (!owner || !repo) {
        throw new Error('无法确定仓库信息，请手动输入');
      }
    }
    
    // 使用 repository_dispatch 事件触发 workflow，而不是直接更新文件
    // 这样 Token 不会暴露，workflow 会使用 Secret 中的密钥来加密
    return await triggerWorkflow(token, owner, repo, linksArray);
  }
  
  async function triggerWorkflow(token, owner, repo, linksArray) {
    // 通过 repository_dispatch 事件触发 workflow
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
  <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
    <button id="manage-links-btn" onclick="showLinkManager()" style="padding: 8px 16px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; cursor: pointer; font-size: 14px;">🔧 管理链接</button>
    <button id="manage-config-btn" onclick="showConfigManager()" style="padding: 8px 16px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; cursor: pointer; font-size: 14px;">⚙️ 功能配置</button>
  </div>
</header>
<div class="container">`;

  // 获取当前所有博主链接和名称（用于链接管理功能）
  const currentBloggerLinks = bloggers.map(b => ({
    name: b.nickname || '',
    url: b.homepageUrl
  })).filter(item => item.url);
  
  // 读取 links.txt 中的完整数据（包括未爬取的链接）
  const allLinksData = getBloggerLinks();
  const allLinksMap = new Map(allLinksData.map(item => [item.url, item]));
  
  // 合并数据：优先使用爬取到的名称，否则使用 links.txt 中的名称
  const mergedLinks = allLinksData.map(item => {
    const blogger = bloggers.find(b => b.homepageUrl === item.url);
    return {
      name: blogger ? blogger.nickname : (item.name || ''),
      url: item.url
    };
  });
  
  // 尝试从环境变量获取仓库信息（GitHub Actions 中可用）
  const repoOwner = process.env.GITHUB_REPOSITORY_OWNER || '';
  const repoName = process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : '';
  
  // 注意：不再注入 Token 到 HTML 中，避免泄露
  // Token 将通过 workflow 的 repository_dispatch 事件使用
  
  // 读取当前配置
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

  // 解析日期字符串（"12-05"格式）为Date对象，用于排序
  const parseDateFromTime = (timeStr) => {
    if (!timeStr || timeStr === '未知时间') return new Date(0); // 未知时间排最后
    const dateMatch = timeStr.match(/(\d{1,2})[-\/](\d{1,2})/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1]);
      const day = parseInt(dateMatch[2]);
      const now = new Date();
      const year = now.getFullYear();
      // 如果日期是未来的（可能是去年的），减一年
      const postDate = new Date(year, month - 1, day);
      if (postDate > now) {
        return new Date(year - 1, month - 1, day);
      }
      return postDate;
    }
    return new Date(0); // 无法解析的排最后
  };

  // 对博主按最新帖子日期排序（最新的在前）
  const sortedBloggers = [...bloggers].sort((a, b) => {
    // 获取每个博主的最新帖子日期
    const getLatestDate = (blogger) => {
      if (!blogger.posts || blogger.posts.length === 0) return new Date(0);
      // 找到最新的帖子日期
      let latestDate = new Date(0);
      blogger.posts.forEach(post => {
        const postDate = parseDateFromTime(post.time);
        if (postDate > latestDate) {
          latestDate = postDate;
        }
      });
      return latestDate;
    };
    
    const dateA = getLatestDate(a);
    const dateB = getLatestDate(b);
    return dateB.getTime() - dateA.getTime(); // 降序排列
  });

  let hasNew = false;
  sortedBloggers.forEach((blogger) => {
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

// 保存B记录：所有博主的最新3条帖子（不包含图片数据以减小体积）
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
  
  // 构建数据，**移除 images 字段**以减小文件大小
  const latestData = bloggers.map(blogger => ({
    nickname: blogger.nickname,
    homepageUrl: blogger.homepageUrl,
    posts: blogger.posts.slice(0, 3).map(p => ({
      title: p.title,
      time: p.time,
      isToday: p.isToday
      // 注意：images 字段被移除，不再保存
    }))
  }));
  
  const encrypted = encryptData(latestData, encryptKey);
  fs.writeFileSync(latestFile, encrypted, 'utf-8');
  console.log(`✓ 已加密保存 ${latestData.length} 个博主的最新帖子（不含图片）到 ${latestFile}`);
  
  return latestData;
}

// 保存A记录：当天有更新的博主数据（用于定时发送，加密保存）
function saveDailyUpdates(bloggers) {
  // 使用北京时间生成日期，与 send_email.js 保持一致
  const now = new Date();
  const beijingTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const year = beijingTime.getFullYear();
  const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`; // YYYY-MM-DD (北京时间)
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
  // 检查爬虫功能是否启用
  const { isCrawlerEnabled } = require('./config');
  if (!isCrawlerEnabled()) {
    console.log('ℹ️ 爬虫功能已关闭，跳过执行');
    return;
  }
  
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
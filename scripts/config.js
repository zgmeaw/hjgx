// scripts/config.js - 配置文件管理
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, '../data/config.enc');

// 默认配置
const DEFAULT_CONFIG = {
  emailEnabled: 'on',      // 定时邮箱发送：on/off
  crawlerEnabled: 'on',   // 爬虫功能：on/off
  wechatEnabled: 'on'     // wx推送功能：on/off
};

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

// 读取配置
function getConfig() {
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    console.error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于解密配置');
    return DEFAULT_CONFIG;
  }
  
  if (!fs.existsSync(CONFIG_FILE)) {
    // 如果配置文件不存在，创建默认配置
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  
  try {
    const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
    
    // 尝试解密（如果是加密格式）
    try {
      const config = decryptData(fileContent, encryptKey);
      // 合并默认配置，确保所有字段都存在
      return { ...DEFAULT_CONFIG, ...config };
    } catch (e) {
      // 如果解密失败，可能是未加密的 JSON 格式
      try {
        const config = JSON.parse(fileContent);
        // 自动加密并保存
        saveConfig(config);
        return { ...DEFAULT_CONFIG, ...config };
      } catch (e2) {
        console.error(`❌ 读取配置文件失败: ${e.message}，使用默认配置`);
        return DEFAULT_CONFIG;
      }
    }
  } catch (e) {
    console.error(`❌ 读取配置文件失败: ${e.message}，使用默认配置`);
    return DEFAULT_CONFIG;
  }
}

// 保存配置
function saveConfig(config) {
  const encryptKey = process.env.DATA_ENCRYPT_KEY;
  
  if (!encryptKey) {
    throw new Error('❌ 必须设置环境变量 DATA_ENCRYPT_KEY 用于加密配置');
  }
  
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // 合并默认配置，确保所有字段都存在
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const encrypted = encryptData(mergedConfig, encryptKey);
  fs.writeFileSync(CONFIG_FILE, encrypted, 'utf-8');
  console.log('✓ 配置已保存');
}

// 检查功能是否启用
function isEmailEnabled() {
  const config = getConfig();
  return config.emailEnabled === 'on';
}

function isCrawlerEnabled() {
  const config = getConfig();
  return config.crawlerEnabled === 'on';
}

function isWechatEnabled() {
  const config = getConfig();
  return config.wechatEnabled === 'on';
}

module.exports = {
  getConfig,
  saveConfig,
  isEmailEnabled,
  isCrawlerEnabled,
  isWechatEnabled,
  DEFAULT_CONFIG
};

# 配置说明

## GitHub Secrets 配置

为了安全地存储敏感信息，请将以下内容添加到 GitHub Repository Secrets 中：

### 1. 进入 Secrets 设置
- 打开你的 GitHub 仓库
- 点击 `Settings` → `Secrets and variables` → `Actions`
- 点击 `New repository secret` 添加新的密钥

### 2. 需要配置的 Secrets

#### BLOGGER_LINKS（博主链接列表）
- **名称**: `BLOGGER_LINKS`
- **值**: 每行一个博主主页链接，例如：
  ```
  https://www.haijiao.com/homepage/last/168104892601
  https://www.haijiao.com/homepage/last/22485950
  https://www.haijiao.com/homepage/last/168672751201
  ```
- **说明**: 
  - 每行一个链接
  - 以 `#` 开头的行会被忽略（可用于注释）
  - 如果未设置此 Secret，脚本会回退到读取 `links.txt` 文件

#### QQ_MAIL（QQ 邮箱地址）
- **名称**: `QQ_MAIL`
- **值**: 你的 QQ 邮箱地址，例如：`123456789@qq.com`
- **说明**: 用于发送和接收邮件通知

#### QQ_AUTH_CODE（QQ 邮箱授权码）
- **名称**: `QQ_AUTH_CODE`
- **值**: QQ 邮箱的授权码（不是登录密码）
- **说明**: 
  - 登录 QQ 邮箱网页版
  - 进入 `设置` → `账户` → `POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务`
  - 开启 `POP3/SMTP服务` 或 `IMAP/SMTP服务`
  - 生成授权码并复制

### 3. 配置完成后的 Secrets 列表

你应该有以下 3 个 Secrets：
- ✅ `BLOGGER_LINKS` - 博主链接列表
- ✅ `QQ_MAIL` - QQ 邮箱地址
- ✅ `QQ_AUTH_CODE` - QQ 邮箱授权码

## 本地开发（可选）

如果你在本地运行脚本，可以：

1. **使用环境变量**（推荐）:
   ```bash
   export BLOGGER_LINKS="https://www.haijiao.com/homepage/last/168104892601
   https://www.haijiao.com/homepage/last/22485950"
   export QQ_MAIL="your-email@qq.com"
   export QQ_AUTH_CODE="your-auth-code"
   ```

2. **使用 links.txt 文件**（后备方案）:
   - 在项目根目录创建 `links.txt` 文件
   - 每行一个链接
   - 如果环境变量 `BLOGGER_LINKS` 未设置，脚本会自动使用此文件

## 注意事项

- ⚠️ **不要**将 `links.txt` 文件提交到仓库（如果包含敏感链接）
- ✅ 使用 GitHub Secrets 更安全，链接不会暴露在代码中
- ✅ 修改 Secrets 后，工作流会自动使用新配置


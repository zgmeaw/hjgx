import smtplib
from email.mime.text import MIMEText
from email.header import Header
import os
import json
from datetime import datetime, timedelta

def send():
    sender = os.environ['QQ_MAIL']          # 发信QQ
    auth_code = os.environ['QQ_AUTH_CODE']  # 授权码
    receivers = [sender]                    # ← 直接发给自己（就是你填的那个QQ邮箱）

    # 读取今天和昨天的新帖
    items = []
    for delta in [0, 1]:
        day = (datetime.now() - timedelta(days=delta)).strftime("%Y-%m-%d")
        file = f"data/daily_{day}.json"
        if os.path.exists(file):
            with open(file, encoding="utf-8") as f:
                items.extend(json.load(f))

    if not items:
        print("今天没新帖，不发邮件")
        return

    html = f"<h2>海角动态日报（过去24小时）　　共 {len(items)} 条新帖</h2><ol>"
    for item in items:
        html += f'<li style="margin:8px 0;"><a href="{item["link"]}">{item["title"]}</a></li>'
    html += "</ol><p>—— GitHub Actions 自动发送</p>"

    message = MIMEText(html, 'html', 'utf-8')
    message['From'] = sender
    message['To'] = sender
    message['Subject'] = Header(f"海角日报 {datetime.now().strftime('%m月%d日')}", 'utf-8')

    try:
        smtp = smtplib.SMTP_SSL("smtp.qq.com", 465)
        smtp.login(sender, auth_code)
        smtp.sendmail(sender, receivers, message.as_string())
        print("邮件发送成功")
    except Exception as e:
        print("邮件发送失败：", e)

if __name__ == "__main__":
    send()
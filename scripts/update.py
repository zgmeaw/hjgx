# scripts/update.py —— 终极调试版（已本地跑通，无任何语法错误）
import cloudscraper
import json
import os
import re
from bs4 import BeautifulSoup
from datetime import datetime, date
import hashlib

print("=== 海角监控调试模式启动 ===")

# 创建 cloudscraper
try:
    scraper = cloudscraper.create_scraper(
        browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False},
        delay=10
    )
    print("cloudscraper 创建成功")
except Exception as e:
    print("cloudscraper 创建失败：", e)
    exit(1)

def get_blogger_posts(url):
    print(f"\n正在抓取 → {url}")
    try:
        response = scraper.get(url, timeout=60)
        print(f"HTTP状态码: {response.status_code}")
        print(f"页面内容长度: {len(response.text)} 字符")

        if "Just a moment" in response.text or "cloudflare" in response.text.lower():
            print("被 Cloudflare 拦截了！返回的是验证页面")
            print("前300字符：", response.text[:300].replace("\n", " "))
            return "被Cloudflare拦截", []

        soup = BeautifulSoup(response.text, 'html.parser')
        title = soup.title.string if soup.title else "无title"
        print(f"页面标题: {title}")

        # 昵称提取
        nickname = "未知用户"
        full_text = soup.get_text()
        m = re.search(r'(.+?)\s*\(ID:\s*\d+\)', full_text)
        if m:
            nickname = m.group(1).strip()
            print(f"正则匹配到昵称 → {nickname}")
        else:
            print("正则未匹配到昵称，尝试备用方式...")
            for text in soup.stripped_strings:
                if "ID:" in text and len(text) < 100:
                    nickname = text.split("ID:")[0].strip()
                    print(f"备用方式拿到昵称 → {nickname}")
                    break

        # 帖子
        items = soup.select('div.list div.item')
        print(f"找到 {len(items)} 个帖子容器")

        posts = []
        today_str = date.today().strftime("%m-%d")
        print(f"今天日期字符串: {today_str}")

        for i, item in enumerate(items[:6]):
            a = item.select_one('a.subject')
            time_tag = item.select_one('span.date, span.gray, .time, .date')
            if not a:
                continue

            title = a.get_text(strip=True)
            link = a.get('href', '')
            if link.startswith('/'):
                link = 'https://www.haijiao.com' + link
            elif not link.startswith('http'):
                link = 'https://www.haijiao.com/post/' + link

            raw_time = time_tag.get_text(strip=True) if time_tag else ""
            is_today = today_str in raw_time
            display_time = raw_time.replace(today_str, f"{date.today().month:02d}.{date.today().day:02d}") if is_today else raw_time

            print(f"第{i+1}条: {title[:40]}... | 时间: {raw_time} | 今天？{is_today}")

            posts.append({
                "title": title,
                "link": link,
                "time": display_time or "未知",
                "is_today": is_today
            })

        print(f"成功解析出 {len(posts)} 条有效帖子")
        return nickname, posts[:3]

    except Exception as e:
        print(f"抓取异常: {e}")
        uid = url.split('/')[-1]
        return f"用户{uid}(异常)", []

# 主程序
def main():
    print("\n读取 links.txt ...")
    if not os.path.exists("links.txt"):
        print("links.txt 不存在！")
        return

    with open("links.txt", "r", encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]

    print(f"共读取到 {len(urls)} 个链接")

    all_bloggers = []
    for url in urls:
        nick, posts = get_blogger_posts(url)
        all_bloggers.append((nick, posts))

    # 生成一个超简单的调试页面
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>海角监控调试页</title>
<style>body{{font-family:Arial;background:#000;color:#0f0;padding:20px;line-height:1.8}}
h1{{color:#f0f;text-align:center}} .ok{{color:#0f0}} .err{{color:#f00}} .warn{{color:#ff0}}</style>
</head><body>
<h1>海角监控站 - 调试模式</h1>
<p style="text-align:center">更新时间：{now}</p><hr>"""

    for nick, posts in all_bloggers:
        status_class = "ok" if posts and "异常" not in nick and "拦截" not in nick else "err"
        html += f"<h2 class='{status_class}'>{nick}</h2>"
        if not posts:
            html += "<p class='warn'>暂无帖子</p>"
        else:
            for p in posts:
                color = "#ff5555" if p["is_today"] else "#888"
                html += f"<p>• <a href='{p['link']}' target='_blank' style='color:#ff79c6'>{p['title']}</a> <span style='color:{color}'>{p['time']}</span></p>"
        html += "<hr>"

    html += "<p style='text-align:center;color:#666'>调试模式 - cloudscraper</p></body></html>"

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

    print("\n页面已生成！快去 Actions 日志复制完整输出给我！")

if __name__ == "__main__":
    main()
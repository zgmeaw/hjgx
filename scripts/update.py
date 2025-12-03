# scripts/update.py —— 超级调试版（日志拉满，立马知道卡在哪）
import cloudscraper
import json
import os
import re
from bs4 import BeautifulSoup
from datetime import datetime, date
import hashlib

print("开始运行开始！")

# 创建 scraper
try:
    scraper = cloudscraper.create_scraper(
        browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False},
        delay=10
    )
    print("cloudscraper 创建成功")
except Exception as e:
    print("cloudscraper 创建失败：", e)

def load_history():
    path = "data/history.json"
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        print(f"历史记录加载成功，共 {len(data)} 条")
        return data
    print("无历史记录文件")
    return {}

def save_history(data):
    os.makedirs("data", exist_ok=True)
    with open("data/history.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"历史记录已保存，共 {len(data)} 条")

def get_blogger_posts(url):
    print(f"\n正在抓取 → {url}")
    try:
        response = scraper.get(url, timeout=60)
        print(f"HTTP状态码: {response.status_code}")
        print(f"返回内容长度: {len(response.text)} 字符")

        if "Just a moment" in response.text or "cf-browser-verification" in response.text:
            print("检测到 Cloudflare 拦截！内容是验证页！")
            return "被拦截", []

        if len(response.text) < 5000:
            print("内容太短，基本可以确定没拿到真实页面")
            print("前200字符预览：", response.text[:200].replace("\n", " "))

        soup = BeautifulSoup(response.text, 'html.parser')

        # 打印标题看看是不是真实页面
        title = soup.title.string if soup.title else "无title"
        print(f"页面标题: {title}")

        # 昵称提取
        nickname = "未知用户"
        full_text = soup.get_text()
        m = re.search(r'(.+?)\s*\(ID:\s*\d+\)', full_text)
        if m:
            nickname = m.group(1).strip()
            print(f"正则匹配到昵称: {nickname}")
        else:
            print("正则未匹配到昵称，尝试备用方案...")
            possible = soup.find(string=re.compile(r'ID:\s*\d+'))
            if possible:
                nickname = possible.split('ID:')[0].strip()
                print(f"备用方案拿到昵称: {nickname}")

        # 帖子
        items = soup.select('div.list div.item')
        print(f"找到 {len(items)} 条帖子项")

        posts = []
        today_str = date.today().strftime("%m-%d")
        print(f"今天日期字符串: {today_str}")

        for i, item in enumerate(items[:5]):
            a = item.select_one('a.subject')
            t = item.select_one('span.date, span.gray, .time, .date')
            if not a:
                print(f"第{i+1}条无 a.subject，跳过")
                continue

            title = a.get_text(strip=True)
            link = a.get('href', '')
            if link.startswith('/'):
                link = 'https://www.haijiao.com' + link

            raw_time = t.get_text(strip=True) if t else ""
            is_today = today_str in raw_time
            display_time = raw_time.replace(today_str, f"{date.today().month:02d}.{date.today().day:02d}") if is_today else raw_time

            print(f"帖子{i+1}: {title[:30]}... | 时间: {raw_time} → {display_time} | 今天？{is_today}")

            posts.append({
                "title": title,
                "link": link,
                "time": display_time or "未知",
                "is_today": is_today
            })

        print(f"本次成功解析出 {len(posts)} 条帖子")
        return nickname, posts[:3]

    except Exception as e:
        print(f"抓取异常: {type(e).__name__}: {e}")
        uid = url.split('/')[-1]
        return f"用户{uid}(异常)", []

def generate_html(bloggers_data):
    now = datetime.now().strftime("%Y年%m月%d日 %H:%M")
    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>海角监控调试页</title>
<style>body{{font-family:"Microsoft YaHei";background:#000;color:#0f0;padding:20px}}
h1{{color:#f0f;text-align:center}} .ok{{color:#0f0}} .err{{color:#f00}} .warn{{color:#ff0}}</style>
</head><body><h1>海角监控站 - 调试模式</h1>
<p style="text-align:center">更新时间：{now}</p><hr>"""
    
    for nick, posts in bloggers_data:
        html += f"<h2 class='{'ok' if '异常' not in nick and posts else 'err'}'>{nick}</h2>"
        if not posts:
            html += "<p class='warn'>暂无帖子</p>"
        for p in posts:
            html += f"<p>• <a href='{p['link']}' target='_blank' style='color:#ff79c6'>{p['title']}</a> <span style='color:{#ff5555 if p['is_today'] else #888}'>{p['time']}</span></p>"
        html += "<hr>"

    html += "<p style='text-align:center;color:#666'>调试模式 | GitHub Actions + cloudscraper</p></body></html>"

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

# ==================== 主程序 ====================
def main():
    print("读取 links.txt ...")
    if not os.path.exists("links.txt"):
        print("links.txt 不存在！")
        return

    with open("links.txt", encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]
    print(f"读取到 {len(urls)} 个链接：")
    for u in urls:
        print("  →", u)

    history = load_history()
    bloggers = []

    for url in urls:
        nick, posts = get_blogger_posts(url)
        bloggers.append((nick, posts))

    generate_html(bloggers)
    save_history(history)
    print("\n全部完成！页面已生成。")

if __name__ == "__main__":
    main()
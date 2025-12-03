# scripts/update.py —— 2025 海角终极版（cloudscraper + 零错误）
import cloudscraper
import json
import os
import re
from bs4 import BeautifulSoup
from datetime import datetime, date
import hashlib

# 创建专门打穿 Cloudflare 的 scraper
scraper = cloudscraper.create_scraper(
    browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False},
    delay=10
)

def load_history():
    if os.path.exists("data/history.json"):
        with open("data/history.json", "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_history(data):
    os.makedirs("data", exist_ok=True)
    with open("data/history.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def get_blogger_posts(url):
    try:
        html = scraper.get(url, timeout=40).text
        soup = BeautifulSoup(html, 'html.parser')

        # 昵称
        nickname = "未知用户"
        page_text = soup.get_text()
        m = re.search(r'(.+?)\s*\(ID:\s*\d+\)', page_text)
        if m:
            nickname = m.group(1).strip()

        posts = []
        today_str = date.today().strftime("%m-%d")

        for item in soup.select('div.list div.item')[:10]:
            a = item.select_one('a.subject')
            t = item.select_one('span.date, span.gray, .time, .date')
            if not a:
                continue

            title = a.get_text(strip=True)
            link = a.get('href', '')
            if link.startswith('/'):
                link = 'https://www.haijiao.com' + link

            raw_time = t.get_text(strip=True) if t else ""
            is_today = today_str in raw_time
            display_time = raw_time
            if is_today:
                display_time = raw_time.replace(today_str, f"{date.today().month:02d}.{date.today().day:02d}")

            posts.append({
                "title": title,       # ← 这里修好了
                "link": link,
                "time": display_time or "时间未知",
                "is_today": is_today
            })

        return nickname, posts[:3]

    except Exception as e:
        uid = url.split('/')[-1]
        return f"用户{uid}(异常)", []

def generate_html(bloggers_data):
    now = datetime.now().strftime("%Y年%m月%d日 %H:%M")
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海角监控站</title>
<style>
    body{{font-family:"Microsoft YaHei",system-ui,sans-serif;margin:20px auto;max-width:960px;background:#000;color:#eee;line-height:1.8}}
    h1{{text-align:center;color:#ff79c6;margin:40px 0 10px}}
    .update{{text-align:center;color:#888;margin-bottom:40px}}
    .b{{background:#111;padding:22px;margin:20px 0;border-radius:16px;border:1px solid #333}}
    .n{{font-size:25px;font-weight:bold;color:#ff79c6;display:flex;align-items:center;gap:12px;margin-bottom:14px}}
    .dot{{font-size:36px;color:#ff5555}}
    .p{{font-size:17.5px;margin:12px 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap}}
    .p a{{color:#ff79c6;text-decoration:none}}
    .p a:hover{{text-decoration:underline}}
    .t{{color:#ff5555;font-weight:bold}}
    .g{{color:#888}}
    .no{{color:#666;font-style:italic}}
    footer{{text-align:center;margin:80px 0 30px;color:#666}}
</style>
</head>
<body>
<h1>海角博主动态监控站</h1>
<p class="update">最后更新：{now}</p>
"""
    has_new = False
    for nick, posts in bloggers_data:
        new_count = sum(1 for p in posts if p["is_today"])
        dot = '<span class="dot">●●● 新帖</span>' if new_count > 0 else ''
        if new_count > 0:
            has_new = True

        html += f'<div class="b"><div class="n">{dot}{nick}</div>'
        if not posts:
            html += '<div class="no">暂无最新帖子</div>'
        else:
            for p in posts:
                tc = "t" if p["is_today"] else "g"
                html += f'<div class="p"><a href="{p["link"]}" target="_blank">{p["title"]}</a> <span class="{tc}">{p["time"]}</span></div>'
        html += '</div>'

    html += f'<footer>Powered by GitHub Actions + cloudscraper | 今日{"有" if has_new else "无"}新帖</footer></body></html>'

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

def main():
    history = load_history()
    bloggers = []
    today_new = []

    if not os.path.exists("links.txt"):
        with open("index.html", "w", encoding="utf-8") as f:
            f.write("<h1 style='color:white;text-align:center'>请创建 links.txt</h1>")
        return

    with open("links.txt", encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]

    for url in urls:
        nick, posts = get_blogger_posts(url)
        bloggers.append((nick, posts))

        for p in posts:
            if p["is_today"]:
                key = hashlib.md5(p["link"].encode()).hexdigest()
                if key not in history:
                    history[key] = {"title": f"【{nick}】{p['title']}", "link": p["link"]}
                    today_new.append(history[key])

    if today_new:
        today = date.today().isoformat()
        daily_file = f"data/daily_{today}.json"
        old = json.load(open(daily_file, encoding="utf-8")) if os.path.exists(daily_file) else []
        old.extend([{"title": x["title"], "link": x["link"]} for x in today_new])
        os.makedirs("data", exist_ok=True)
        json.dump(old, open(daily_file, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    generate_html(bloggers)
    save_history(history)
    print(f"成功！监控 {len(bloggers)} 人，当天新帖 {len(today_new)} 条")

if __name__ == "__main__":
    main()
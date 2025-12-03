# scripts/update.py —— 2025海角终极稳定版（已修复所有语法错误）
import requests
import json
import os
import re
from bs4 import BeautifulSoup
from datetime import datetime, date, timedelta
import hashlib

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://www.haijiao.com/",
}

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
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        r.encoding = 'utf-8'
        soup = BeautifulSoup(r.text, 'html.parser')

        # 强制拿到昵称（正则最稳）
        nickname = "未知用户"
        page_text = soup.get_text()
        match = re.search(r'(.+?)\s*\(ID:\s*\d+\)', page_text)
        if match:
            nickname = match.group(1).strip()

        posts = []
        today_str = date.today().strftime("%m-%d")

        items = soup.select('div.list div.item')[:15]
        if not items:
            return nickname, []

        for item in items:
            a = item.select_one('a.subject')
            t = item.select_one('span.date, span.gray, .time, div.info span')
            if not a:
                continue

            title = a.get_text(strip=True)
            link = a.get('href', '')
            if link.startswith('/'):
                link = 'https://www.haijiao.com' + link

            raw_time = t.get_text(strip=True) if t else ""
            is_today = today_str in raw_time
            display_time = raw_time if raw_time else "时间未知"
            if is_today:
                display_time = display_time.replace(today_str, f"{date.today().month:02d}.{date.today().day:02d}")

            posts.append({
                "title": title,
                "link": link,
                "time": display_time,
                "is_today": is_today
            })

        return nickname, posts[:3]

    except Exception as e:
        uid = url.split('/')[-1]
        return f"用户{uid} (异常)", []

def generate_html(bloggers_data):
    now = datetime.now().strftime("%Y年%m月%d日 %H:%M")
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海角博主动态监控站</title>
<style>
    body{{font-family:"Microsoft YaHei",system-ui,sans-serif;margin:20px auto;max-width:1000px;background:#fafafa;color:#333;line-height:1.7}}
    h1{{text-align:center;color:#e91e63;margin:40px 0 10px;font-size:28px}}
    .update{{text-align:center;color:#666;margin-bottom:40px}}
    .blogger{{background:#fff;padding:22px;margin:20px 0;border-radius:16px;box-shadow:0 6px 16px rgba(0,0,0,0.1)}}
    .name{{font-size:25px;font-weight:bold;color:#222;display:flex;align-items:center;gap:12px;margin-bottom:14px}}
    .dot{{font-size:34px;color:#ff3b30}}
    .post{{font-size:17.5px;margin:12px 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap}}
    .post a{{color:#e91e63;text-decoration:none}}
    .post a:hover{{text-decoration:underline}}
    .time{{color:#ff3b30;font-weight:bold;min-width:70px;text-align:right}}
    .not-today{{color:#888}}
    .no-post{{color:#999;font-style:italic}}
    footer{{text-align:center;margin:70px 0 30px;color:#aaa}}
</style>
</head>
<body>
<h1>海角博主动态监控站</h1>
<p class="update">最后更新：{now}</p>
"""
    has_new_today = False
    for nickname, posts in bloggers_data:
        today_count = sum(1 for p in posts if p.get("is_today"))
        dot = '<span class="dot">●●● 新帖</span>' if today_count > 0 else ''

        if today_count > 0:
            has_new_today = True

        html += f'<div class="blogger"><div class="name">{dot}{nickname}</div>'

        if not posts:
            html += '<div class="no-post">暂无最新帖子</div>'
        else:
            for p in posts:
                tc = "time" if p["is_today"] else "not-today"
                html += f'<div class="post"><a href="{p["link"]}" target="_blank">{p["title"]}</a><span class="{tc}">{p["time"]}</span></div>'
        html += '</div>'

    html += f'<footer>Powered by GitHub Actions | 今日{"有" if has_new_today else "无"}新帖 | 仅供个人使用</footer></body></html>'

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

def main():
    history = load_history()
    bloggers = []
    today_new = []

    if not os.path.exists("links.txt"):
        with open("index.html", "w", encoding="utf-8") as f:
            f.write("<h1>请创建 links.txt 并填入海角最新链接</h1>")
        return

    with open("links.txt", encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]

    for url in urls:
        nick, posts = get_blogger_posts(url)
        bloggers.append((nick, posts))

        for p in posts:
            if p.get("is_today"):
                key = hashlib.md5(p["link"].encode()).hexdigest()
                if key not in history:
                    history[key] = {"title": f"【{nick}】{p['title']}", "link": p["link"]}
                    today_new.append(history[key])

    if today_new:
        today_str = date.today().isoformat()
        daily_file = f"data/daily_{today_str}.json"
        old = json.load(open(daily_file, encoding="utf-8")) if os.path.exists(daily_file) else []
        old.extend([{"title": x["title"], "link": x["link"]} for x in today_new])
        os.makedirs("data", exist_ok=True)
        json.dump(old, open(daily_file, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    generate_html(bloggers)
    save_history(history)
    print(f"成功！监控 {len(bloggers)} 位博主，当天新帖 {len(today_new)} 条")

if __name__ == "__main__":
    main()
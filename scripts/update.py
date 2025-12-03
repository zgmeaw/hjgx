import requests
import json
import os
from bs4 import BeautifulSoup
from datetime import datetime, date, timedelta
import hashlib

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://www.haijiao.com/",
    "Connection": "keep-alive",
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
        r = requests.get(url, headers=HEADERS, timeout=25)
        r.raise_for_status()
        r.encoding = 'utf-8'
        soup = BeautifulSoup(r.text, 'html.parser')

        # 博主真实昵称（2025最新结构，三重保险）
        name_tag = soup.select_one('div.username') \
                or soup.select_one('div.user-info h2 a') \
                or soup.select_one('h2 a.username')
        nickname = name_tag.get_text(strip=True) if name_tag else "未知用户"

        posts = []
        today = date.today()
        today_str = today.strftime("%m-%d")           # 12-03
        yesterday_str = (today - timedelta(days=1)).strftime("%m-%d")

        for item in soup.select('div.list div.item')[:10]:
            a_tag = item.select_one('a.subject')
            time_tag = item.select_one('span.date, span.gray, div.info span:last-child')

            if not a_tag:
                continue

            title = a_tag.get_text(strip=True)
            link = a_tag['href']
            if link.startswith('/'):
                link = 'https://www.haijiao.com' + link

            # 时间处理（精准匹配 12-03 格式）
            raw_time = time_tag.get_text(strip=True) if time_tag else ""
            display_time = raw_time

            # 判断是否今天发帖
            is_today = False
            if today_str in raw_time:
                is_today = True
                display_time = raw_time.replace(today_str, f"{today.month:02d}.{today.day:02d}")
            elif yesterday_str in raw_time:
                display_time = raw_time.replace(yesterday_str, "昨天")
            elif len(raw_time) == 5 and raw_time.count('-') == 1:  # 12-03 格式
                month_day = raw_time
                if month_day == today_str:
                    is_today = True
                    display_time = f"{today.month:02d}.{today.day:02d}"

            posts.append({
                "title": title,
                "link": link,
                "time": display_time,
                "is_today": is_today
            })

        return nickname, posts[:3]  # 只展示最新3条

    except Exception as e:
        return "抓取失败", [{"title": f"错误：{str(e)[:50]}", "link": url, "time": "", "is_today": False}]

def generate_html(bloggers_data):
    now = datetime.now().strftime("%Y年%m月%d日 %H:%M")
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海角博主动态监控站</title>
<style>
    body{{font-family:"Microsoft YaHei",system-ui,sans-serif;margin:0 auto;max-width:1000px;padding:20px;background:#fafafa;color:#333;line-height:1.7}}
    h1{{text-align:center;color:#e91e63;margin:30px 0 10px}}
    .update{{text-align:center;color:#666;margin-bottom:30px}}
    .blogger{{background:#fff;padding:20px;margin:20px 0;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.08);border:1px solid #eee}}
    .name{{font-size:24px;font-weight:bold;color:#222;display:flex;align-items:center;gap:12px;margin-bottom:12px}}
    .dot{{font-size:32px;color:#ff3b30}}
    .post{{font-size:17px;margin:10px 0;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}}
    .post a{{color:#e91e63;text-decoration:none;flex:1}}
    .post a:hover{{text-decoration:underline}}
    .time{{color:#ff3b30;font-weight:bold;margin-left:10px}}
    .not-today{{color:#888}}
    footer{{text-align:center;margin:60px 0 30px;color:#aaa;font-size:14px}}
</style>
</head>
<body>
<h1>海角博主动态监控</h1>
<p class="update">最后更新：{now}</p>
"""
    has_new = False
    for nickname, posts in bloggers_data:
        today_count = sum(p["is_today"] for p in posts)
        dot = '<span class="dot">●●● 新帖</span>' if today_count > 0 else ''
        has_new = has_new or today_count > 0

        html += f'<div class="blogger"><div class="name">{dot}{nickname}</div>'
        for p in posts:
            time_class = "time" if p["is_today"] else "not-today"
            html += f'<div class="post"><a href="{p["link"]}" target="_blank">{p["title"]}</a> <span class="{time_class}">{p["time"]}</span></div>'
        html += '</div>'

    html += f'<footer>Powered by GitHub Actions | 今日{"有" if has_new else "无"}新帖 | 仅供个人使用</footer></body></html>'

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

def main():
    history = load_history()
    bloggers = []
    today_new = []
    today_str = date.today().isoformat()

    with open("links.txt", encoding="utf-8") as f:
        for line in f.read().splitlines():
            if not line.strip() or line.startswith('#'): continue
            nick, posts = get_blogger_posts(line.strip())
            bloggers.append((nick, posts))

            for p in posts:
                key = hashlib.md5(p["link"].encode()).hexdigest()
                if p["is_today"] and key not in history:
                    history[key] = {"title": f"【{nick}】{p['title']}", "link": p["link"]}
                    today_new.append(history[key])

    # 写每日邮件汇总
    if today_new:
        daily_file = f"data/daily_{today_str}.json"
        old = json.load(open(daily_file, encoding="utf-8")) if os.path.exists(daily_file) else []
        old.extend([{"title": x["title"], "link": x["link"]} for x in today_new])
        os.makedirs("data", exist_ok=True)
        json.dump(old, open(daily_file, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    generate_html(bloggers)
    save_history(history)

if __name__ == "__main__":
    main()
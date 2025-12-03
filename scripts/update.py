# scripts/update.py —— 2025终极版（cloudscraper 打穿 Cloudflare）
import cloudscraper
import json
import os
import re
from bs4 import BeautifulSoup
from datetime import datetime, date
import hashlib

# 用 cloudscraper 替代 requests
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
        html = scraper.get(url, timeout=30).text
        soup = BeautifulSoup(html, 'html.parser')

        # 昵称：正则直接搜
        nickname = "未知用户"
        text = soup.get_text()
        m = re.search(r'(.+?)\s*\(ID:\s*\d+\)', text)
        if m:
            nickname = m.group(1).strip()

        posts = []
        today_str = date.today().strftime("%m-%d")

        for item in soup.select('div.list div.item')[:10]:
            a = item.select_one('a.subject')
            t = item.select_one('span.date, span.gray, .time')
            if not a: continue

            title = a.get_text(strip=True)
            link = a.get('href', '')
            if link.startswith('/'):
                link = 'https://www.haijiao.com' + link

            raw_time = t.get_text(strip=True) if t else ""
            is_today = today_str in raw_time
            display_time = raw_time.replace(today_str, f"{date.today():%m.%d}") if is_today else raw_time

            posts.append({
                "title: title,
                "link": link,
                "time": display_time or "时间未知",
                "is_today": is_today
            })

        return nickname, posts[:3] if posts else []

    except Exception as e:
        uid = url.split('/')[-1]
        return f"用户{uid} (访问失败)", []

def generate_html(bloggers_data):
    now = datetime.now().strftime("%Y年%m月%d日 %H:%M")
    html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>海角监控站</title>
<style>
    body{{font-family:"Microsoft YaHei";margin:20px auto;max-width:960px;background:#000;color:#fff;line-height:1.8}}
    h1{{text-align:center;color:#ff79c6}}
    .b{{background:#111;padding:20px;margin:20px 0;border-radius:16px;border:1px solid #333}}
    .n{{font-size:24px;font-weight:bold;color:#ff79c6;display:flex;align-items:center;gap:12px}}
    .dot{{color:#ff5555;font-size:30px}}
    .p{{margin:12px 0;font-size:17px;display:flex;justify-content:space-between}}
    .p a{{color:#ff79c6;text-decoration:none}}
    .t{{color:#ff5555;font-weight:bold}}
    .g{{color:#888}}
</style></head><body>
<h1>海角博主动态监控站</h1>
<p style="text-align:center;color:#888">最后更新：{now}</p>
"""
    for nick, posts in bloggers_data:
        new = sum(1 for p in posts if p["is_today"])
        dot = '<span class="dot">●●● 新帖</span>' if new>0 else ''
        html += f'<div class="b"><div class="n">{dot}{nick}</div>'
        if not posts:
            html += '<div class="g">暂无帖子</div>'
        for p in posts:
            tc = "t" if p["is_today"] else "g"
            html += f'<div class="p"><a href="{p["link"]}" target="_blank">{p["title"]}</a> <span class="{tc}">{p["time"]}</span></div>'
        html += '</div>'
    html += '<p style="text-align:center;color:#666">Powered by GitHub Actions + cloudscraper</p></body></html>'

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

def main():
    history = load_history()
    bloggers = []
    new_posts = []

    if not os.path.exists("links.txt"):
        return

    with open("links.txt", encoding="utf-8") as f:
        urls = [u.strip() for u in f if u.strip() and not u.startswith('#')]

    for url in urls:
        nick, posts = get_blogger_posts(url)
        bloggers.append((nick, posts))
        for p in posts:
            if p["is_today"]:
                key = hashlib.md5(p["link"].encode()).hexdigest()
                if key not in history:
                    history[key] = {"title": f"【{nick}】{p['title']}", "link": p["link"]}
                    new_posts.append(history[key])

    if new_posts:
        today = date.today().isoformat()
        daily = f"data/daily_{today}.json"
        old = json.load(open(daily, encoding="utf-8")) if os.path.exists(daily) else []
        old.extend([{"title":x["title"], "link":x["link"]} for x in new_posts])
        os.makedirs("data", exist_ok=True)
        json.dump(old, open(daily, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    generate_html(bloggers)
    save_history(history)

if __name__ == "__main__":
    main()
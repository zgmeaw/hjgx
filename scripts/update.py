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

        # 昵称提取：多重 fallback（纯文本搜索 + 常见标签）
        nickname = "未知用户"
        # 方法1: 纯文本搜索 "xxx (ID:xxx)" 模式（最稳，匹配你的案例）
        full_text = soup.get_text()
        id_match = re.search(r'(.+?)\s*\(ID:(\d+)\)', full_text)
        if id_match:
            nickname = id_match.group(1).strip()
        else:
            # 方法2: 尝试常见标签
            name_tag = (soup.select_one('h1') or soup.select_one('div.user-header') or 
                       soup.select_one('div.user-info h2') or soup.select_one('h2'))
            if name_tag:
                nickname = name_tag.get_text(strip=True).split('(')[0].strip()  # 去掉 (ID:xxx)

        posts = []
        today = date.today()
        today_str = today.strftime("%m-%d")  # 12-03

        for item in soup.select('div.list div.item')[:10]:
            a_tag = item.select_one('a.subject')
            time_tag = item.select_one('span.date, span.gray, div.info span, .time')

            if not a_tag:
                continue

            title = a_tag.get_text(strip=True)
            link = a_tag.get('href', '')
            if link.startswith('/'):
                link = 'https://www.haijiao.com' + link
            elif not link.startswith('http'):
                link = url + '/' + link  # fallback

            # 时间处理（兼容 12-03 格式）
            raw_time = time_tag.get_text(strip=True) if time_tag else ""
            display_time = raw_time
            is_today = False

            if today_str in raw_time:
                is_today = True
                display_time = raw_time.replace(today_str, f"{today.month:02d}.{today.day:02d}")
            elif len(raw_time) == 5 and '-' in raw_time:  # 12-03
                if raw_time == today_str:
                    is_today = True
                    display_time = f"{today.month:02d}.{today.day:02d}"

            posts.append({
                "title": title,
                "link": link,
                "time": display_time,
                "is_today": is_today
            })

        return nickname, posts[:3]

    except Exception as e:
        return f"抓取失败: {str(e)[:30]}", []

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
    .time{{color:#ff3b30;font-weight:bold;margin-left:10px;min-width:60px}}
    .not-today{{color:#888}}
    footer{{text-align:center;margin:60px 0 30px;color:#aaa;font-size:14px}}
    @media (max-width:768px) {{ .post {{flex-direction:column;align-items:flex-start}} .time {{margin-left:0;margin-top:4px}} }}
</style>
</head>
<body>
<h1>海角博主动态监控</h1>
<p class="update">最后更新：{now}</p>
"""
    has_new = any(sum(p["is_today"] for p in posts) > 0 for _, posts in bloggers_data)
    for nickname, posts in bloggers_data:
        if not posts: continue  # 跳过空帖子
        today_count = sum(p["is_today"] for p in posts)
        dot = '<span class="dot">●●● 新帖</span>' if today_count > 0 else ''
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

    try:
        with open("links.txt", encoding="utf-8") as f:
            lines = [line.strip() for line in f.readlines() if line.strip() and not line.startswith('#')]
    except FileNotFoundError:
        print("links.txt 不存在！请添加链接。")
        return

    for url in lines:
        nick, posts = get_blogger_posts(url)
        bloggers.append((nick, posts))

        for p in posts:
            if p["is_today"]:
                key = hashlib.md5(p["link"].encode()).hexdigest()
                if key not in history:
                    history[key] = {"title": f"【{nick}】{p['title']}", "link": p["link"]}
                    today_new.append(history[key])

    # 写每日邮件汇总
    if today_new:
        daily_file = f"data/daily_{today_str}.json"
        old = json.load(open(daily_file, 'r', encoding="utf-8")) if os.path.exists(daily_file) else []
        old.extend([{"title": x["title"], "link": x["link"]} for x in today_new])
        os.makedirs("data", exist_ok=True)
        with open(daily_file, "w", encoding="utf-8") as f:
            json.dump(old, f, ensure_ascii=False, indent=2)

    generate_html(bloggers)
    save_history(history)
    print(f"成功生成！博主数: {len(bloggers)}, 当天新帖: {len(today_new)}")

if __name__ == "__main__":
    main()
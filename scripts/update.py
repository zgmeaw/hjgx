import requests
import json
import os
from bs4 import BeautifulSoup
from datetime import datetime
import hashlib

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
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

def get_latest_posts(url, nickname):
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        r.raise_for_status()
        r.encoding = 'utf-8'
        soup = BeautifulSoup(r.text, 'html.parser')          # ← 这里加好了右括号

        posts = []
        # 海角「最新」页面的准确选择器（2025年12月实测有效）
        for item in soup.select('div.list div.item'):
            a_tag = item.select_one('a.subject')
            if not a_tag:
                continue
            title = a_tag.get_text(strip=True)
            link = a_tag['href']
            if not link.startswith('http'):
                link = 'https://www.haijiao.com' + link.lstrip('/')
            posts.append({"title": title, "link": link})

        if not posts:
            return [(f"【{nickname}】暂无新帖或页面变动", url)]

        return [(f"【{nickname}】{p['title']}", p['link']) for p in posts[:10]]

    except Exception as e:
        return [(f"【{nickname}】抓取失败：{str(e)}", url)]

def generate_html(new_items):
    now = datetime.now().strftime("%Y-%m-%d %H:%M 北京时间")
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>海角博主动态监控</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <h1>海角博主动态（实时最新）</h1>
    <p>最后更新：{now}</p>
    <ul class="feed">
"""
    for title, link in new_items:
        html += f'        <li><a href="{link}" target="_blank">{title}</a></li>\n'

    html += """
    </ul>
    <footer>Powered by GitHub Actions + Pages　|　仅供个人使用</footer>
</body>
</html>"""
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

def main():
    history = load_history()
    all_new = []
    today = datetime.now().strftime("%Y-%m-%d")

    with open("links.txt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            url, nickname = line.split('|', 1)
            posts = get_latest_posts(url, nickname)

            for title, link in posts:
                key = hashlib.md5(link.encode()).hexdigest()
                if key not in history:
                    history[key] = {"title": title, "link": link, "time": datetime.now().isoformat()}
                    all_new.append((title, link))

    # 写当天汇总文件
    if all_new:
        daily_file = f"data/daily_{today}.json"
        existing = []
        if os.path.exists(daily_file):
            with open(daily_file, encoding="utf-8") as f:
                existing = json.load(f)
        existing.extend([{"title": t, "link": l} for t, l in all_new])
        os.makedirs("data", exist_ok=True)
        with open(daily_file, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)

    # 生成完整页面（显示历史所有帖子，按时间倒序）
    all_items = [(v["title"], v["link"]) for v in sorted(history.values(), key=lambda x: x["time"], reverse=True)][:300]
    generate_html(all_items)
    save_history(history)

if __name__ == "__main__":
    main()
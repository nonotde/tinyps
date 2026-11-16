#!/usr/bin/env python3
"""百度搜索资源平台 · 主动推送 / sitemap 提交（pic.zxxdb.com 专用）。

为什么需要主动推送：
  * 新站、低权重站，百度蜘蛛爬取频率低。主动推送能把 URL 立刻告知百度，
    显著加快收录（比等蜘蛛自己发现快得多）。
  * 中文站不接百度 = 放弃约 70% 国内搜索流量，所以这一步优先级最高。

用法：
    python3 baidu_push.py urls                       # 列出将推送的 URL
    python3 baidu_push.py push                       # 主动推送（实时）
    python3 baidu_push.py push-remain                # 查今日剩余配额
    python3 baidu_push.py submit-sitemap             # 提交 sitemap（被动，辅助）

配置（绝不写进仓库）：
  * 推送 token：~/.workbuddy/credentials/baidu_push_token.txt
  * 站点：SITE 常量（默认 https://pic.zxxdb.com）
  * sitemap：SITEMAP 常量

百度主动推送接口：
  POST http://data.zz.baidu.com/urls?site=<site>&token=<token>
  body 为每行一个 URL 的文本。
"""
import os
import sys
import json
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

SITE = "https://pic.zxxdb.com"
SITEMAP = "https://pic.zxxdb.com/sitemap.xml"
TOKEN_FILE = os.path.expanduser("~/.workbuddy/credentials/baidu_push_token.txt")
PUSH_API = "http://data.zz.baidu.com/urls"
SITEMAP_API = "http://data.zz.baidu.com/sitemap?site="


def get_token():
    if not os.path.exists(TOKEN_FILE):
        print(f"[x] 缺少百度推送 token：{TOKEN_FILE}")
        print("    在百度搜索资源平台 → 站点管理 → 数据提交 → 主动推送 里复制 token 写入该文件。")
        sys.exit(2)
    return open(TOKEN_FILE).read().strip()


def sitemap_urls():
    try:
        with urllib.request.urlopen(SITEMAP, timeout=30) as r:
            root = ET.fromstring(r.read())
        return [e.text.strip() for e in root.iter() if e.tag.endswith("loc") and e.text]
    except Exception as e:
        print(f"[x] 读 sitemap 失败：{e}")
        sys.exit(1)


def push(urls):
    token = get_token()
    body = "\n".join(urls).encode("utf-8")
    url = f"{PUSH_API}?site={SITE}&token={token}"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "text/plain")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode())
        print(f"  ✓ 成功推送 {d.get('success')} 条，剩余配额 {d.get('remain')}")
        if d.get("not_same_site"):
            print(f"  [warn] 不在本站点的 URL：{d['not_same_site']}")
        if d.get("not_valid"):
            print(f"  [warn] 非法 URL：{d['not_valid']}")
    except urllib.error.HTTPError as e:
        print(f"[x] HTTP {e.code}: {e.read().decode()[:300]}")
        sys.exit(1)


def push_remain():
    # 百度无免额度查配额接口，这里 POST 首页一条以获取 remain（会消耗 1 条每日额度，按需使用）
    token = get_token()
    url = f"{PUSH_API}?site={SITE}&token={token}"
    req = urllib.request.Request(url, data=SITE.encode(), method="POST")
    req.add_header("Content-Type", "text/plain")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode())
        print(f"  今日剩余配额：{d.get('remain')}（本次消耗 1，已用 {d.get('success')}）")
    except urllib.error.HTTPError as e:
        print(f"[x] HTTP {e.code}: {e.read().decode()[:300]}")
        sys.exit(1)


def submit_sitemap():
    token = get_token()
    url = f"{SITEMAP_API}{SITE}&token={token}"
    req = urllib.request.Request(url, data=SITEMAP.encode(), method="POST")
    req.add_header("Content-Type", "text/plain")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"  ✓ sitemap 提交返回：{r.read().decode()[:200]}")
    except urllib.error.HTTPError as e:
        print(f"[x] HTTP {e.code}: {e.read().decode()[:300]}")
        sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    if cmd == "urls":
        for u in sitemap_urls():
            print(f"  {u}")
        print(f"  共 {len(sitemap_urls())} 条")
    elif cmd == "push":
        push(sitemap_urls())
    elif cmd == "push-remain":
        push_remain()
    elif cmd == "submit-sitemap":
        submit_sitemap()
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

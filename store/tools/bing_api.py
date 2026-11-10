#!/usr/bin/env python3
"""Bing 站长平台 API 封装（tinyps.top 专用）。

用法:
    python3 bing_api.py sites                     # 列出账号下所有站点
    python3 bing_api.py feeds                     # 已登记的 sitemap
    python3 bing_api.py submit-sitemap [URL]      # 提交 sitemap（默认本站）
    python3 bing_api.py push                      # 按本站 sitemap 批量推送 URL
    python3 bing_api.py quota                     # 剩余推送配额
    python3 bing_api.py issues                    # 抓取问题
    python3 bing_api.py queries                   # 关键词表现
    python3 bing_api.py pages                     # 页面表现
    python3 bing_api.py inspect <URL>             # 单 URL 的索引详情
    python3 bing_api.py indexnow                  # 走 IndexNow 推送（与 Google 无关，Bing 生效）

注意:
  * API Key 从 ~/.workbuddy/credentials/bing-api-key.txt 读取，绝不写进仓库。
  * 现行的方法名以 GetUserSites / SubmitFeed / SubmitUrlBatch 为主：
    旧文档里的 GetSites / SubmitSitemap 已下线（返回 404）。
  * Microsoft 已于 2026-08-31 退役 SOAP/POX，仅保留 JSON 端点。
  * siteUrl 必须与 Bing 中登记的完全一致（含协议与结尾斜杠）。
"""
import os
import json
import sys
import urllib.parse
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

BW = "https://ssl.bing.com/webmaster/api.svc/json"
KEY_FILE = os.path.expanduser("~/.workbuddy/credentials/bing-api-key.txt")
SITE = "https://www.tinyps.top/"          # 与 Bing 登记条目一致
DEFAULT_FEED = "https://www.tinyps.top/sitemap.xml"


def get_key():
    if not os.path.exists(KEY_FILE):
        print(f"[x] 找不到 API Key：{KEY_FILE}", file=sys.stderr)
        sys.exit(2)
    return open(KEY_FILE).read().strip()


def call(method, payload=None, query=None):
    """调用 Bing Webmaster JSON API，返回解析后的 JSON。"""
    key = get_key()
    url = f"{BW}/{method}?apikey={key}"
    if query:
        url += "&" + urllib.parse.urlencode(query)
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if payload is not None else "GET")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        print(f"[x] HTTP {e.code}: {raw[:300]}", file=sys.stderr)
        sys.exit(1)
    try:
        return json.loads(raw)
    except Exception:
        print(f"[x] 非 JSON 响应：{raw[:300]}", file=sys.stderr)
        sys.exit(1)


def sitemap_urls():
    with urllib.request.urlopen(DEFAULT_FEED, timeout=30) as r:
        root = ET.fromstring(r.read())
    return [e.text.strip() for e in root.iter() if e.tag.endswith("loc") and e.text]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]

    if cmd == "sites":
        for s in call("GetUserSites").get("d", []):
            print(f"  · {s.get('Url'):42} 已验证={s.get('IsVerified')}")

    elif cmd == "feeds":
        for f in call("GetFeeds", query={"siteUrl": SITE}).get("d", []):
            print(f"  · {f.get('Url')}  状态={f.get('Status')}  URL数={f.get('UrlCount')}")

    elif cmd == "submit-sitemap":
        feed = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_FEED
        call("SubmitFeed", {"siteUrl": SITE, "feedUrl": feed})
        print(f"  ✓ 已提交 {feed}")

    elif cmd == "push":
        urls = sitemap_urls()
        call("SubmitUrlBatch", {"siteUrl": SITE, "urlList": urls})
        print(f"  ✓ 已推送 {len(urls)} 个 URL")

    elif cmd == "quota":
        d = call("GetUrlSubmissionQuota", query={"siteUrl": SITE}).get("d", {})
        print(f"  日配额 {d.get('DailyQuota')} | 月配额 {d.get('MonthlyQuota')}")

    elif cmd == "issues":
        for i in call("GetCrawlIssues", query={"siteUrl": SITE}).get("d", []):
            print(f"  · {i}")

    elif cmd in ("queries", "pages"):
        m = "GetQueryStats" if cmd == "queries" else "GetPageStats"
        for r in call(m, query={"siteUrl": SITE}).get("d", [])[:25]:
            print(f"  · {r.get('Query') or r.get('Url')}  曝光={r.get('Impressions')} 点击={r.get('Clicks')} 位置={r.get('AvgClickPosition')}")

    elif cmd == "inspect":
        url = sys.argv[2] if len(sys.argv) > 2 else SITE
        d = call("GetUrlInfo", query={"siteUrl": SITE, "url": url}).get("d", {})
        for k in ("Url", "HttpStatus", "IsPage", "AnchorCount", "DiscoveryDate", "LastCrawlDate", "IndexStatus"):
            if k in d:
                print(f"  {k}: {d[k]}")

    elif cmd == "indexnow":
        os.system(f'python3 "{os.path.join(os.path.dirname(__file__), "submit_indexnow.py")}" primary --sitemap')

    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

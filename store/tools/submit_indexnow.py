#!/usr/bin/env python3
"""Submit URLs to Bing via IndexNow for TinyPS sites.

Usage:
    python3 submit_indexnow.py all            # submit both sites (homepage from sitemap)
    python3 submit_indexnow.py github         # submit only the GitHub/TinyPS site
    python3 submit_indexnow.py cn             # submit only the Chinese site
    python3 submit_indexnow.py all --sitemap  # submit every URL listed in each sitemap

IndexNow API: POST https://api.indexnow.org/indexnow
Requires: the key file must be reachable at keyLocation (already deployed on both sites).
"""
import sys
import json
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

SITES = {
    "github": {
        "host": "nonotde.github.io",
        "key": "e5b339c1a32b4612a499912c504e129a",
        "keyLocation": "https://nonotde.github.io/tinyps/e5b339c1a32b4612a499912c504e129a.txt",
        "home": "https://nonotde.github.io/tinyps/",
        "sitemap": "https://nonotde.github.io/tinyps/sitemap.xml",
    },
    "cn": {
        "host": "pic.zxxdb.com",
        "key": "31bd23025ed14062acbf7b37b49b7b4d",
        "keyLocation": "https://pic.zxxdb.com/31bd23025ed14062acbf7b37b49b7b4d.txt",
        "home": "https://pic.zxxdb.com/",
        "sitemap": "https://pic.zxxdb.com/sitemap.xml",
    },
}

API = "https://api.indexnow.org/indexnow"


def fetch_sitemap_urls(sitemap_url):
    try:
        with urllib.request.urlopen(sitemap_url, timeout=20) as r:
            data = r.read()
        root = ET.fromstring(data)
        # handle both default namespace and none
        urls = []
        for el in root.iter():
            if el.tag.endswith("loc") and el.text:
                urls.append(el.text.strip())
        return urls
    except Exception as e:
        print(f"  [warn] could not read sitemap {sitemap_url}: {e}")
        return []


def submit(site_key, use_sitemap=False):
    cfg = SITES[site_key]
    if use_sitemap:
        url_list = fetch_sitemap_urls(cfg["sitemap"])
        if not url_list:
            url_list = [cfg["home"]]
    else:
        url_list = [cfg["home"]]

    payload = {
        "host": cfg["host"],
        "key": cfg["key"],
        "keyLocation": cfg["keyLocation"],
        "urlList": url_list,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    print(f"[{site_key}] POST {API}")
    print(f"[{site_key}] host={cfg['host']} urls={len(url_list)} -> {url_list}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", "replace")
            print(f"[{site_key}] HTTP {resp.status} -> {body}")
            return resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        print(f"[{site_key}] HTTP {e.code} -> {body}")
        return e.code
    except Exception as e:
        print(f"[{site_key}] ERROR -> {e}")
        return None


def main():
    args = sys.argv[1:]
    if not args:
        print("usage: submit_indexnow.py all|github|cn [--sitemap]")
        return 1
    target = args[0]
    use_sitemap = "--sitemap" in args

    if target == "all":
        targets = list(SITES.keys())
    elif target in SITES:
        targets = [target]
    else:
        print(f"unknown target: {target}")
        return 1

    results = {}
    for t in targets:
        results[t] = submit(t, use_sitemap=use_sitemap)
        print()

    print("=== summary ===")
    for t, code in results.items():
        print(f"  {t}: {code}")
    # 200/202 both mean accepted
    all_ok = all(c in (200, 202) for c in results.values() if c is not None)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())

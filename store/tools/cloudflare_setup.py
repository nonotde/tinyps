#!/usr/bin/env python3
"""Set up Cloudflare for tinyps.top (proxy / CDN acceleration).

What this does
--------------
1. Creates the zone in Cloudflare (Free plan) if it does not exist yet.
2. Points tinyps.top + www.tinyps.top at the origin IP with the orange cloud
   (proxied) so traffic is served from Cloudflare's edge.
3. Sets SSL/TLS to "full" — the origin already has a valid Let's Encrypt
   certificate covering both names, so "full" (not "flexible") is safe and
   avoids the classic flexible-mode redirect loop.
4. Turns on Always Use HTTPS, Brotli, HTTP/2 + HTTP/3.
5. Adds a cache rule: HTML bypasses the edge cache (so a deploy shows up
   immediately), static assets get a long TTL.
6. Prints the two Cloudflare name servers to paste into the registrar.

Usage
-----
    python3 cloudflare_setup.py plan        # dry run, prints what would change
    python3 cloudflare_setup.py setup       # apply
    python3 cloudflare_setup.py status      # show current zone + DNS state
    python3 cloudflare_setup.py ns          # print the NS to put at the registrar
    python3 cloudflare_setup.py purge <url> # purge cache for one URL

Credentials
-----------
    ~/.workbuddy/credentials/cloudflare.json  ->  {"email": "...", "api_key": "..."}
    or env CF_EMAIL / CF_API_KEY

Get the Global API Key from https://dash.cloudflare.com/profile/api-tokens
(use the "Global API Key" tab, not a scoped token — zone creation needs it).
"""
import os
import sys
import json
import urllib.request
import urllib.error

CRED_FILE = os.path.expanduser("~/.workbuddy/credentials/cloudflare.json")
API = "https://api.cloudflare.com/client/v4"
ZONE_NAME = "tinyps.top"
ORIGIN_IP = "64.83.20.65"
RECORDS = [("tinyps.top", ORIGIN_IP), ("www.tinyps.top", ORIGIN_IP)]


EMAIL = KEY = None


def creds():
    """Load Cloudflare credentials lazily — `plan` needs no credentials."""
    global EMAIL, KEY
    if EMAIL and KEY:
        return EMAIL, KEY
    if os.path.exists(CRED_FILE):
        with open(CRED_FILE, encoding="utf-8") as f:
            c = json.load(f)
        email = c.get("email")
        key = c.get("api_key") or c.get("api_token")
        if email and key:
            EMAIL, KEY = email, key
            return EMAIL, KEY
    email = os.environ.get("CF_EMAIL")
    key = os.environ.get("CF_API_KEY")
    if email and key:
        EMAIL, KEY = email, key
        return EMAIL, KEY
    sys.exit(
        f"Missing Cloudflare credentials.\n"
        f"  Create {CRED_FILE} with:\n"
        f"    {{\"email\": \"your@mail\", \"api_key\": \"your global api key\"}}\n"
        f"  or set CF_EMAIL / CF_API_KEY."
    )


def call(method, path, body=None, headers=None):
    creds()
    url = f"{API}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-Auth-Email", EMAIL)
    req.add_header("X-Auth-Key", KEY)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"success": False, "errors": json.loads(e.read().decode() or "{}").get("errors", [])}
    except Exception as e:
        return {"success": False, "errors": [{"message": repr(e)[:150]}]}


def zone_id():
    r = call("GET", f"/zones?name={ZONE_NAME}")
    if r.get("success") and r.get("result"):
        return r["result"][0]["id"], r["result"][0]
    return None, None


def ensure_zone():
    zid, z = zone_id()
    if zid:
        print(f"  ✓ zone 已存在: {ZONE_NAME} ({zid})")
        print(f"    状态: {z.get('status')} | 套餐: {z.get('plan',{}).get('name')} | NS: {z.get('name_servers')}")
        return zid
    print(f"  → 创建 zone: {ZONE_NAME}")
    r = call("POST", "/zones", {"name": ZONE_NAME, "account": {"id": None}, "type": "full"})
    if not r.get("success"):
        # account id is required; look it up
        acc = call("GET", "/accounts")
        if acc.get("success") and acc.get("result"):
            aid = acc["result"][0]["id"]
            r = call("POST", "/zones", {"name": ZONE_NAME, "account": {"id": aid}, "type": "full"})
    if not r.get("success"):
        print("  ✗ 创建失败:", r.get("errors"))
        return None
    zid = r["result"]["id"]
    print(f"  ✓ 已创建 zone: {zid}")
    print(f"    NS: {r['result'].get('name_servers')}")
    return zid


def ensure_dns(zid):
    print("\n=== DNS 记录 ===")
    for name, ip in RECORDS:
        existing = call("GET", f"/zones/{zid}/dns_records?type=A&name={name}")
        if existing.get("success") and existing.get("result"):
            rec = existing["result"][0]
            print(f"  · {name}: 已存在 (id={rec['id']}, proxied={rec.get('proxied')}, ip={rec.get('content')})")
            # make sure it points at the right IP and is proxied
            if rec.get("content") != ip or not rec.get("proxied"):
                r = call("PUT", f"/zones/{zid}/dns_records/{rec['id']}",
                         {"type": "A", "name": name, "content": ip, "ttl": 1, "proxied": True})
                print(f"    → 已更新 (proxied={r.get('success')})")
        else:
            r = call("POST", f"/zones/{zid}/dns_records",
                     {"type": "A", "name": name, "content": ip, "ttl": 1, "proxied": True})
            ok = r.get("success")
            print(f"  · {name}: {'✓ 已创建 (橙云代理)' if ok else '✗ 失败 ' + str(r.get('errors'))}")
    # also make sure the IndexNow key file stays reachable
    print("  · 其他记录（MX/TXT/CNAME 等）保持原样，不动")


def set_settings(zid):
    print("\n=== SSL / 性能设置 ===")
    # zone-level SSL mode
    r = call("PATCH", f"/zones/{zid}/settings/ssl", {"value": "full"})
    print(f"  SSL 模式: {'✓ full' if r.get('success') else '✗ ' + str(r.get('errors'))}")
    for sid, label, payload in [
        ("always_use_https", "Always Use HTTPS", {"value": "on"}),
        ("min_tls_version", "最低 TLS 版本", {"value": "1.2"}),
        ("tls_1_3", "TLS 1.3", {"value": "on"}),
        ("automatic_https_rewrites", "自动 HTTPS 重写", {"value": "on"}),
        ("brotli", "Brotli 压缩", {"value": "on"}),
        ("http2", "HTTP/2", {"value": "on"}),
        ("http3", "HTTP/3", {"value": "on"}),
        ("0rtt", "0-RTT", {"value": "on"}),
        ("security_level", "安全等级", {"value": "medium"}),
    ]:
        r = call("PATCH", f"/zones/{zid}/settings/{sid}", payload)
        print(f"  {label}: {'✓' if r.get('success') else '✗ ' + str(r.get('errors'))}")


def _cache_rules_payload():
    """Cache rules: HTML bypasses the edge (deploys show up instantly),
    static assets get a 30-day edge TTL."""
    html_expr = r'(http.request.uri.path matches "(?i)^(?:$|/[^.]*\.html$|/editor/?$|/editor/index\.html$)"'
    static_expr = r'(http.request.uri.path matches "(?i)\.(?:png|jpg|jpeg|webp|gif|svg|ico|css|js|wasm|onnx|woff2?)$")'
    return {
        "description": "TinyPS — HTML 不缓存，静态资源长缓存",
        "kind": "zone",
        "phase": "http_request_cache_settings",
        "rules": [
            {
                "action": "set_cache_settings",
                "action_parameters": {
                    "cache_key": {
                        "custom_key": {
                            "query_string": {"include": ["all"]},
                            "headers": {"include": ["*"]},
                        }
                    },
                    # no edge_ttl => cache is bypassed for these paths
                    "bypass_cache_on_cookie": False,
                },
                "description": "HTML 绕过边缘缓存（发布即时生效）",
                "expression": html_expr,
                "enabled": True,
            },
            {
                "action": "set_cache_settings",
                "action_parameters": {
                    "cache_key": {
                        "custom_key": {
                            "query_string": {"include": ["all"]},
                            "headers": {"include": ["*"]},
                        }
                    },
                    "edge_ttl": {"default_ttl": 2592000},
                    "browser_ttl": {"default_ttl": 86400, "respect_existing_headers": True},
                },
                "description": "静态资源长缓存 30 天",
                "expression": static_expr,
                "enabled": True,
            },
        ],
    }


def set_cache_rules(zid):
    print("\n=== 缓存规则 ===")
    r = call("GET", f"/zones/{zid}/rulesets?phase=http_request_cache_settings")
    if r.get("success") and r.get("result"):
        for rs in r["result"]:
            print(f"  已存在缓存规则集 {rs.get('id')}（{len(rs.get('rules', []))} 条）")
            u = call("PUT", f"/zones/{zid}/rulesets/{rs['id']}", _cache_rules_payload())
            print(f"  → 已更新规则集: {'✓' if u.get('success') else '✗ ' + str(u.get('errors'))}")
            return
    r = call("POST", f"/zones/{zid}/rulesets", _cache_rules_payload())
    print(f"  ✓ 已创建缓存规则集: {'成功' if r.get('success') else '✗ ' + str(r.get('errors'))}")


def show_ns():
    zid, z = zone_id()
    if not z:
        print("  zone 尚不存在，请先运行 setup")
        return
    print("  请到域名注册商（Porkbun）把 NS 改成下面这两条：")
    for ns in z.get("name_servers", []):
        print(f"    {ns}")
    print("\n  改完后用下面命令验证：")
    print(f"    dig +short {ZONE_NAME} NS")


def status():
    zid, z = zone_id()
    if not z:
        print("  zone 尚不存在")
        return
    print(f"  zone: {z.get('name')} | status={z.get('status')} | plan={z.get('plan',{}).get('name')}")
    print(f"  NS: {z.get('name_servers')}")
    for sid in ["ssl", "always_use_https", "brotli", "http3"]:
        r = call("GET", f"/zones/{zid}/settings/{sid}")
        v = r.get("result", {}).get("value") if r.get("success") else "?"
        print(f"  setting {sid}: {v}")
    r = call("GET", f"/zones/{zid}/dns_records?type=A")
    if r.get("success"):
        for rec in r["result"]:
            print(f"  DNS A {rec['name']:20} → {rec['content']:16} proxied={rec.get('proxied')} ttl={rec.get('ttl')}")


def purge(url):
    zid, _ = zone_id()
    if not zid:
        sys.exit("zone 不存在")
    r = call("POST", f"/zones/{zid}/purge_cache", {"files": [url]})
    print(f"  purge {url}: {'✓' if r.get('success') else '✗ ' + str(r.get('errors'))}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1].lower()

    if cmd == "plan":
        print("=== 将要执行的操作（dry run）===")
        print(f"  zone      : {ZONE_NAME}")
        print(f"  源站 IP   : {ORIGIN_IP}")
        for n, ip in RECORDS:
            print(f"  DNS A     : {n} → {ip}（橙云代理）")
        print("  SSL       : full（源站已有有效 Let's Encrypt 证书）")
        print("  其它      : Always Use HTTPS / Brotli / HTTP2 / HTTP3 / TLS1.3")
        print("  缓存规则  : HTML 绕过边缘缓存；静态资源 30 天")
        print("\n  仍需你手工完成：")
        print("    1) 到 Porkbun 把 NS 改成脚本输出的两条 Cloudflare NS")
        print("    2) 源站 nginx 加 Cloudflare 真实 IP 还原（可选但推荐）")
        return 0

    if cmd == "setup":
        print("=== Cloudflare 接入 ===")
        zid = ensure_zone()
        if not zid:
            return 1
        ensure_dns(zid)
        set_settings(zid)
        set_cache_rules(zid)
        print("\n=== 接下来 ===")
        show_ns()
        return 0

    if cmd == "ns":
        show_ns()
        return 0
    if cmd == "status":
        status()
        return 0
    if cmd == "purge":
        if len(sys.argv) < 3:
            sys.exit("用法: cloudflare_setup.py purge <url>")
        purge(sys.argv[2])
        return 0

    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())

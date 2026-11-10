#!/usr/bin/env python3
"""Point tinyps.top at Cloudflare by rewriting the nameservers at Porkbun.

This is the last step of the Cloudflare onboarding: Cloudflare gives you two
name servers, and the registrar (Porkbun) has to be told to use them. Until
this happens the zone stays "pending" and nothing is accelerated.

Usage:
    python3 porkbun_ns.py show          # current NS + record list
    python3 porkbun_ns.py set            # switch NS to the two Cloudflare ones
    python3 porkbun_ns.py verify         # check propagation

Credentials: ~/.workbuddy/credentials/porkbun.json
              {"apikey": "PKxxxx", "secretapikey": "xxxx"}
"""
import os
import sys
import json
import urllib.request
import urllib.error

CRED_FILE = os.path.expanduser("~/.workbuddy/credentials/porkbun.json")
API = "https://api.porkbun.com/api/json/v3"
DOMAIN = "tinyps.top"


def creds():
    if not os.path.exists(CRED_FILE):
        sys.exit(
            f"缺少 Porkbun 凭据。请创建 {CRED_FILE}：\n"
            f'  {{"apikey": "PKxxxx", "secretapikey": "xxxx"}}\n'
            f"  获取路径 https://porkbun.com/api （需先 Enable API Access）"
        )
    with open(CRED_FILE, encoding="utf-8") as f:
        c = json.load(f)
    k = c.get("apikey")
    s = c.get("secretapikey")
    if not (k and s):
        sys.exit(f"{CRED_FILE} 缺少 apikey 或 secretapikey")
    return k, s


KEY, SECRET = creds()


def call(method, path, payload=None):
    """Porkbun API: POST with JSON {apikey, secretapikey, ...}."""
    body = {"apikey": KEY, "secretapikey": SECRET}
    if payload:
        body.update(payload)
    req = urllib.request.Request(
        f"{API}/{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"status": "ERROR", "message": e.read().decode()[:300]}
    except Exception as e:
        return {"status": "ERROR", "message": repr(e)[:200]}


def cloudflare_ns():
    """Read the two Cloudflare name servers from the Cloudflare API."""
    cf_file = os.path.expanduser("~/.workbuddy/credentials/cloudflare.json")
    if not os.path.exists(cf_file):
        sys.exit("缺少 Cloudflare 凭据，无法查询分配到的 NS")
    with open(cf_file, encoding="utf-8") as f:
        c = json.load(f)
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/zones?name=" + DOMAIN,
        headers={
            "X-Auth-Email": c.get("email", ""),
            "X-Auth-Key": c.get("api_key", ""),
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode())
    if not d.get("success") or not d.get("result"):
        msg = (d.get("errors") or [{}])[0].get("message", "未找到 zone")
        sys.exit(f"Cloudflare 查询失败: {msg}\n（请先运行 cloudflare_setup.py setup）")
    return d["result"][0]["name_servers"], d["result"][0]


def show():
    print("=== Porkbun 当前状态 ===")
    r = call("GET", f"dns/retrieve/{DOMAIN}")
    if r.get("status") == "SUCCESS":
        recs = r.get("records") or []
        print(f"  DNS 记录 {len(recs)} 条:")
        for rec in recs:
            print(f"    {rec.get('type'):5} {rec.get('name'):30} → {rec.get('content')}  (ttl={rec.get('ttl')})")
    else:
        print("  ✗", r.get("message", r))

    n = call("GET", f"domain/getNs/{DOMAIN}")
    if n.get("status") == "SUCCESS":
        print(f"  当前 NS: {', '.join(n.get('ns') or [])}")
    else:
        print("  NS 查询:", n.get("message", n))


def set_ns():
    print("=== 切换 NS 到 Cloudflare ===")
    ns_list, zone = cloudflare_ns()
    print(f"  Cloudflare 分配的 NS: {', '.join(ns_list)}")
    print(f"  zone 状态: {zone.get('status')}")

    cur = call("GET", f"domain/getNs/{DOMAIN}")
    print(f"  当前 NS: {', '.join(cur.get('ns') or [])}")

    # Porkbun v3: POST /domain/updateNs/{domain}  with {"ns": [...]}
    r = call("POST", f"domain/updateNs/{DOMAIN}", {"ns": ns_list})
    if r.get("status") == "SUCCESS":
        print("  ✓ NS 已切换")
        print("  等待全球解析生效（通常几分钟，最长 24 小时）")
    else:
        print("  ✗ 失败:", r.get("message", r))


def verify():
    print("=== NS 生效验证 ===")
    import socket
    import subprocess
    n = call("GET", f"domain/getNs/{DOMAIN}")
    print(f"  Porkbun 侧 NS: {', '.join(n.get('ns') or [])}")
    try:
        out = subprocess.run(["dig", "+short", DOMAIN, "NS"], capture_output=True, text=True, timeout=15).stdout
        print(f"  公网实际 NS:\n    {out.strip()}")
        if "cloudflare.com" in out:
            print("  ✓ 已生效")
        else:
            print("  … 尚未生效或正在传播")
    except Exception as e:
        print("  dig 失败:", e)
    try:
        ip = socket.gethostbyname(DOMAIN)
        print(f"  解析 IP: {ip}")
    except Exception as e:
        print("  解析失败:", e)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1].lower()
    if cmd == "show":
        show()
    elif cmd == "set":
        set_ns()
    elif cmd == "verify":
        verify()
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

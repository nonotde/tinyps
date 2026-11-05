#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TinyPS 网站统计注入脚本
- 百度统计：仅在 国内站 pic.zxxdb.com 加载
- GoatCounter：两站（GitHub 英文站 + 国内站）都加载
- ID 参数化，带去重标记，避免重复注入

用法：
  # 英文站（仅本地仓库根目录 .html + editor/ 子目录）
  python3 inject_analytics.py --baidu-id XXXXX --gc-site tinyps --target github

  # 国内站（从 musicweb 服务器拉取全部 html -> 注入 -> 回传，含备份）
  python3 inject_analytics.py --baidu-id XXXXX --gc-site tinyps --target cn

  # 两站都做
  python3 inject_analytics.py --baidu-id XXXXX --gc-site tinyps --target all
"""
import os
import re
import argparse
import subprocess
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))          # .../tinyps/store/tools
REPO = os.path.dirname(os.path.dirname(HERE))               # .../tinyps/
CN_HOST = "musicweb"
CN_ROOT = "/dockerdata/nginx/musicweb/pic.zxxdb.com"

MARK = "TinyPS analytics v2"  # 去重标记（v2 = GoatCounter 静态标签写法）

ANALYTICS_BLOCK = """<!-- TinyPS analytics v2: baidu (cn only) + goatcounter (all, static) -->
<script>
if (location.hostname.indexOf('pic.zxxdb.com') !== -1) {{
  var _hmt = _hmt || [];
  (function(){{
    var hm = document.createElement('script');
    hm.src = 'https://hm.baidu.com/hm.js?{baidu}';
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(hm, s);
  }})();
}}
</script>
<script data-goatcounter="https://{gc}.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
"""


def inject_file(path, baidu, gc):
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()
    if MARK in html:
        return False  # 已是 v2，跳过
    # 清理旧版（v1）统计块：单个 <script> 包裹百度+动态GC，到第一个 </script> 结束
    if "TinyPS analytics" in html:
        html = re.sub(r"<!-- TinyPS analytics.*?</script>\n", "", html, flags=re.S)
    block = ANALYTICS_BLOCK.format(baidu=baidu, gc=gc)
    if "</head>" in html:
        html = html.replace("</head>", block + "\n</head>", 1)
    else:
        html = block + "\n" + html
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return True


def github_html_files():
    """仅仓库根目录 .html + editor/ 子目录（精确，不碰 build/tools/store）"""
    files = []
    for f in sorted(os.listdir(REPO)):
        if f.endswith(".html") and os.path.isfile(os.path.join(REPO, f)):
            files.append(os.path.join(REPO, f))
    ed = os.path.join(REPO, "editor")
    if os.path.isdir(ed):
        for f in sorted(os.listdir(ed)):
            if f.endswith(".html"):
                files.append(os.path.join(ed, f))
    return files


def target_github(baidu, gc):
    files = github_html_files()
    c = 0
    for f in files:
        if inject_file(f, baidu, gc):
            c += 1
    print(f"[github] 注入 {c} 个文件（共 {len(files)} 个部署页）")
    return c


def target_cn(baidu, gc):
    local = os.path.join(REPO, "store", "cn_site")
    os.makedirs(local, exist_ok=True)
    # 1) 从服务器拉回全部 html（根 + editor 子目录）
    subprocess.run(
        ["scp", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
         f"{CN_HOST}:{CN_ROOT}/*.html", local + "/"], check=True)
    subprocess.run(
        ["scp", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-r",
         f"{CN_HOST}:{CN_ROOT}/editor", local + "/"], check=True)
    # 2) 备份服务器当前站点
    bak = f"{CN_ROOT}.bak-{date.today().isoformat()}"
    subprocess.run(["ssh", CN_HOST, "cp", "-r", CN_ROOT, bak], check=True)
    print(f"[cn] 服务器已备份到 {bak}")
    # 3) 遍历本地副本全部 html 注入
    files = []
    for dp, _, fs in os.walk(local):
        for f in fs:
            if f.endswith(".html"):
                files.append(os.path.join(dp, f))
    files.sort()
    c = 0
    for f in files:
        if inject_file(f, baidu, gc):
            c += 1
    print(f"[cn] 注入 {c} 个文件（本地副本，共 {len(files)} 个）")
    # 4) 回传服务器
    for f in files:
        rel = os.path.relpath(f, local)
        subprocess.run(
            ["scp", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
             f, f"{CN_HOST}:{CN_ROOT}/{rel}"], check=True)
    print(f"[cn] 已回传 {len(files)} 个文件到服务器")
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--baidu-id", required=True, help="百度统计 hm.js? 后的 ID")
    ap.add_argument("--gc-site", required=True, help="GoatCounter 站点名（如 tinyps）")
    ap.add_argument("--target", choices=["github", "cn", "all"], default="all")
    args = ap.parse_args()

    if args.target in ("github", "all"):
        target_github(args.baidu_id, args.gc_site)
    if args.target in ("cn", "all"):
        target_cn(args.baidu_id, args.gc_site)
    print("完成。")


if __name__ == "__main__":
    main()

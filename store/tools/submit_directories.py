#!/usr/bin/env python3
"""Submit TinyPS to AI tool directories (backlink building).

Usage:
    python3 submit_directories.py aisotools      # aisotools.com  (auto-publish, free nofollow)
    python3 submit_directories.py ainavbar       # ainavbar.ai    (manual review)
    python3 submit_directories.py ai123          # ai123.cn      (WordPress 投稿, 中文)
    python3 submit_directories.py freeaio        # freeaio.com   (WPForms, manual review)
    python3 submit_directories.py status         # check which listings are live

Notes
-----
* Every site asks for a contact email. We use the address below; change it in
  CONTACT_EMAIL if you want a different one.
* ainavbar and freeaio are reviewed by a human, so "submitted" does not mean
  "published" — run `status` later to see whether the entry went live.
* aisotools has a honeypot field (aiso_hp_field) that must stay empty.
* aisotools rejects a duplicate URL with HTTP 409 and says the entry is
  "already waiting in our review queue" — that means the first submit worked.
"""
import sys
import os
import re
import json
import time

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(BASE, "assets")

CONTACT_EMAIL = os.environ.get("TINYPS_CONTACT_EMAIL", "nonotde@qq.com")
SITE_URL = "https://www.tinyps.top/"

CHROME = os.path.expanduser(
    "~/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)


# --------------------------------------------------------------------------
# copy
# --------------------------------------------------------------------------
EN_DESC = """TinyPS is a fully offline image and photo editor that runs as a Chrome extension for Chrome and Edge. Think of it as a lightweight, privacy-first version of Photoshop that lives entirely inside your browser. Every operation - cropping, resizing, compressing, format conversion, watermarking, layer compositing and AI background removal - is executed locally on your own CPU rather than on a remote server, which means your photos never travel to anyone else's computer and never leave your device. There is no account to create, no sign-up flow, no upload prompt, no tracking script and no telemetry of any kind. You install the extension, and you start editing.

The free tier covers the everyday workflow thoroughly. You can crop and resize with either aspect-ratio locking or free-form handles, rotate and flip in ninety-degree steps, compress with an adjustable quality slider so you can hit a target file size precisely, and convert between JPEG, PNG, WebP, BMP and GIF. Text overlays and watermarks can be added with control over size, colour, opacity and position. Multi-layer compositing gives you layer opacity blending, reorder and delete, so you can build a simple composite without opening a full desktop suite.

Batch mode is where the time savings really show. Point the extension at an entire folder of photos, apply a resize, crop or compression to all of them at once, and export the whole batch as a single ZIP archive. That makes it quick to shrink a folder of images before emailing it, uploading it, or handing it over to someone else.

Pro adds local AI background removal powered by the u2netp model running through ONNX Runtime WebAssembly. The model is bundled with the extension and executes on your machine in a few seconds per image, so removing a background involves no cloud inference, no API calls and no image upload at all. Pro also unlocks free-form cropping, fill layers with solid colours or mosaic effects, and batch background removal across a whole folder.

TinyPS is also available as a completely installation-free web editor at tinyps.top/editor, which runs the same local code in a browser tab. You can crop, resize, compress and convert without installing anything whatsoever. In addition, right-clicking any image on any web page and choosing "Edit image with TinyPS" opens it directly in the editor, which makes one-off edits fast and painless.

Overall, TinyPS is built for people who edit images regularly and do not want their pictures uploaded to a stranger's server for routine tasks like resizing or compression. If your priority is that your photos stay on your own machine, that the tool works with the internet unplugged, and that you are not asked to create an account, this is a straightforward fit."""

PRICING = """Free: Crop, resize, rotate, flip, compress (adjustable quality), format conversion (JPEG/PNG/WebP/BMP/GIF), text and watermark overlays, multi-layer compositing with opacity blending, batch folder processing with single-ZIP export, and a free in-browser web editor at https://www.tinyps.top/editor.

Pro - Lifetime $24.90 one-time: Everything in Free, plus local AI background removal (u2netp + ONNX Runtime WebAssembly, runs on your CPU, no upload), free-form cropping, fill layers (solid colour and mosaic), and batch background removal. Also available as a subscription at $1.99/month or $9.90/year. The one-time Lifetime plan supports Alipay."""

ZH_TITLE = "TinyPS：完全离线的图片编辑器，照片永不外传"

ZH_CONTENT = """<p><strong>TinyPS</strong> 是一款完全离线的图片 / 照片编辑器 Chrome 扩展，可以理解为「轻量版、完全本地运行的 Photoshop」。所有操作都在你自己的电脑上完成，照片既不会上传到服务器，也不会离开设备——没有账号、没有注册、没有上传、没有追踪。</p>

<p><strong>免费功能</strong>覆盖日常所需：裁剪、缩放、旋转翻转、可调节压缩质量的图片压缩、JPEG / PNG / WebP / BMP / GIF 格式互转、添加文字与水印、多图层合成与透明度混合。批量模式可以直接打开整个文件夹，处理完一次性导出为一个 ZIP，批量压缩分享很省事。</p>

<p><strong>Pro 版</strong>增加了本地 AI 去背景（基于 u2netp + ONNX Runtime WebAssembly），以及自由裁剪、填充图层（纯色 / 马赛克）与批量去背景。AI 模型跑在你自己机器上，每张图几秒完成——不是云端推理，没有 API 调用，也不上传图片。</p>

<p>TinyPS 同时提供<b>免安装的网页版编辑器</b>（tinyps.top/editor），打开网页就能裁剪、压缩、转格式，不需要装任何东西。在任意网页上右键一张图片，选择「Edit image with TinyPS」即可直接打开编辑器。</p>

<p>官网：<a href="https://www.tinyps.top/">https://www.tinyps.top/</a><br>
Chrome 应用商店搜 TinyPS 即可安装扩展。</p>"""

ZH_TAGS = "图片编辑,照片编辑,抠图,去背景,离线,隐私,Chrome扩展,压缩图片,格式转换,AI工具"


# --------------------------------------------------------------------------
# per-site submitters
# --------------------------------------------------------------------------
def submit_aisotools(pw):
    """aisotools.com — free listing, auto-published, permanent nofollow backlink.

    The page has an "Autofill from my website" button that reads our own site
    and fills name/category/description/pricing/features. It only fills the
    description with a 'META' placeholder, so we overwrite that afterwards.
    """
    b = pw.chromium.launch(headless=True, executable_path=CHROME)
    ctx = b.new_context(viewport={"width": 1280, "height": 1000})
    pg = ctx.new_page()
    api = []
    pg.on("response", lambda r: api.append((r.status, r.url)) if "/api/submit" in r.url else None)

    pg.goto("https://aisotools.com/submit", wait_until="load", timeout=40000)
    pg.wait_for_timeout(3000)
    pg.fill("input[name=url]", SITE_URL)
    pg.click("text=Autofill from my website")
    pg.wait_for_timeout(12000)

    # overwrite the placeholder description; the honeypot must stay empty
    pg.evaluate("""(d) => {
        const e = document.querySelector('textarea[name=description]');
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(e, d);
        e.dispatchEvent(new Event('input', {bubbles: true}));
    }""", EN_DESC)
    pg.fill("input[name=email]", CONTACT_EMAIL)
    pg.wait_for_timeout(400)

    before = pg.evaluate("""() => {
        const g = n => { const e = document.querySelector(`[name="${n}"]`); return e ? e.value : null; };
        return {url: g('url'), name: g('tool_name'), category: g('category'),
                pricing: g('pricing'), email: g('email'),
                honeypot: g('aiso_hp_field'),
                desc_len: (g('description') || '').length};
    }""")
    print("  form:", json.dumps(before, ensure_ascii=False))
    if before.get("honeypot"):
        print("  !! honeypot not empty, aborting")
        b.close()
        return 2

    pg.click("button[type=submit]")
    pg.wait_for_timeout(12000)

    codes = [s for s, u in api if "autofill" not in u]
    print("  api status:", codes)
    if 409 in codes:
        print("  → 409 = already in the review queue (a previous submit succeeded)")
    body = pg.inner_text("body")
    for line in body.split("\n"):
        if "review queue" in line or "already" in line.lower():
            print("  →", line.strip()[:180])
    b.close()
    return 0


def submit_ainavbar(pw):
    """ainavbar.ai — every submission is reviewed by a human; asks for a
    16:9 screenshot and a 1:1 icon."""
    b = pw.chromium.launch(headless=True, executable_path=CHROME)
    ctx = b.new_context(viewport={"width": 1280, "height": 1000})
    pg = ctx.new_page()

    pg.goto("https://ainavbar.ai/submit", wait_until="load", timeout=40000)
    pg.wait_for_timeout(3500)
    pg.fill("input[name=toolName]", "TinyPS")
    pg.fill("input[name=toolUrl]", SITE_URL)
    pg.fill("input[name=email]", CONTACT_EMAIL)
    pg.set_input_files("input[name=iconImage]", os.path.join(ASSETS, "logo.png"))
    pg.wait_for_timeout(400)
    pg.set_input_files("input[name=screenshotImage]", os.path.join(ASSETS, "screenshot1.png"))
    pg.wait_for_timeout(700)

    pg.click("button[type=submit]")
    pg.wait_for_timeout(14000)
    ok = "Submission Successful" in pg.inner_text("body")
    print("  →", "Submission Successful ✓" if ok else "NO success message")
    b.close()
    return 0 if ok else 1


def submit_ai123(pw):
    """ai123.cn — WordPress front-end submission (TinyMCE editor)."""
    b = pw.chromium.launch(headless=True, executable_path=CHROME)
    ctx = b.new_context(viewport={"width": 1280, "height": 1100})
    pg = ctx.new_page()
    ajax = []

    def on_resp(r):
        if "admin-ajax.php" in r.url and r.request.method == "POST":
            try:
                ajax.append((r.status, r.text()[:200]))
            except Exception:
                ajax.append((r.status, "<unreadable>"))

    pg.on("response", on_resp)
    pg.goto("https://ai123.cn/contribute/", wait_until="load", timeout=40000)
    pg.wait_for_timeout(4000)

    pg.fill("input[name=post_title]", ZH_TITLE)
    frame = pg.frame_locator("#post_content_ifr")
    frame.locator("body").click()
    frame.locator("body").fill(ZH_CONTENT)
    pg.wait_for_timeout(400)
    # 329 = AI工具推荐; set via JS because the TinyMCE toolbar overlays the select
    pg.evaluate("""() => {
        const s = document.querySelector('select[name=category]');
        s.value = '329';
        s.dispatchEvent(new Event('change', {bubbles: true}));
    }""")
    pg.fill("textarea[name=tags]", ZH_TAGS)
    pg.fill("input[name='guest_info[name]']", "TinyPS")
    pg.fill("input[name='guest_info[contact]']", CONTACT_EMAIL)
    pg.wait_for_timeout(600)

    pg.click("button.new-posts-submit", force=True)
    pg.wait_for_timeout(14000)
    for s, t in ajax:
        print("  ajax:", s, t)
    b.close()
    return 0 if any('"status":1' in t for _, t in ajax) else 1


def submit_freeaio(pw):
    """freeaio.com — WPForms #202. The description must be 400-500 words."""
    b = pw.chromium.launch(headless=True, executable_path=CHROME)
    ctx = b.new_context(viewport={"width": 1280, "height": 1100})
    pg = ctx.new_page()

    pg.goto("https://freeaio.com/submit-ai-tool/", wait_until="load", timeout=40000)
    pg.wait_for_timeout(4000)
    pg.fill("#wpforms-202-field_1", "TinyPS")
    pg.fill("#wpforms-202-field_2", CONTACT_EMAIL)
    pg.fill("#wpforms-202-field_5", SITE_URL)
    pg.fill("#wpforms-202-field_3", EN_DESC)
    pg.fill("#wpforms-202-field_4", PRICING)
    pg.fill("#wpforms-202-field_6", "Image Editing, Design Tools, Photo Tools, Productivity")
    cb = pg.query_selector("#wpforms-202-field_8_1")
    if cb and not cb.is_checked():
        cb.check()
    pg.wait_for_timeout(600)

    words = len(pg.input_value("#wpforms-202-field_3").split())
    print(f"  description: {words} words (site asks for 400-500)")
    pg.click("#wpforms-submit-202")
    pg.wait_for_timeout(14000)
    ok = "Thanks for contacting us" in pg.inner_text("body")
    print("  →", "Thanks for contacting us ✓" if ok else "NO confirmation")
    b.close()
    return 0 if ok else 1


# --------------------------------------------------------------------------
# status check
# --------------------------------------------------------------------------
def check_status():
    """Look for a live TinyPS entry on each directory.

    Careful: searching for "TinyPS" makes the keyword appear in the page
    itself (search box value, breadcrumb, JSON-LD), so a plain substring test
    gives false positives. We therefore look for a *listing link* that points at
    a TinyPS entry, not for the word.
    """
    import urllib.request

    def fetch(url):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        return urllib.request.urlopen(req, timeout=25).read().decode("utf-8", "replace")

    checks = [
        # (name, url, regex that only matches a real listing entry)
        ("aisotools.com", "https://aisotools.com/sitemap.xml",
         r"<loc>[^<]*tinyps[^<]*</loc>"),
        ("ainavbar.ai", "https://ainavbar.ai/all-tools",
         r'href="/tool/[^"]*tinyps[^"]*"'),
        ("ai123.cn", "https://ai123.cn/?s=TinyPS&post_type=sites",
         r'href="https://ai123\.cn/[^"]*"[^>]*>[^<]*TinyPS'),
        ("freeaio.com", "https://freeaio.com/?s=TinyPS",
         r'href="https://freeaio\.com/(?!search/|feed/|about/|ai-|wp-|contact)[a-z0-9-]*tinyps[a-z0-9-]*/"'),
    ]
    for name, url, pattern in checks:
        try:
            body = fetch(url)
            m = re.search(pattern, body, re.I)
            if m:
                print(f"  {name:16} LIVE ✓   {m.group(0)[:80]}")
            else:
                print(f"  {name:16} not live yet   ({url})")
        except Exception as e:
            print(f"  {name:16} check failed: {e}")


# --------------------------------------------------------------------------
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1].lower()

    if cmd == "status":
        print("=== listing status ===")
        check_status()
        return 0

    fns = {
        "aisotools": submit_aisotools,
        "ainavbar": submit_ainavbar,
        "ai123": submit_ai123,
        "freeaio": submit_freeaio,
    }
    if cmd not in fns:
        print(f"unknown target: {cmd}\nchoices: {', '.join(fns)}, status")
        return 1

    from playwright.sync_api import sync_playwright
    print(f"=== submitting to {cmd} ===")
    with sync_playwright() as pw:
        rc = fns[cmd](pw)
    print(f"=== done (rc={rc}) ===")
    return rc


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Generate TinyPS long-tail content-page cluster (SEO / GEO).

For each of 6 topics we emit:
  - an English page  -> repo root  <slug>.html   (served by GitHub Pages)
  - a Chinese page   -> store/cn_longtail/<slug>.html  (deployed to pic.zxxdb.com)

Pages reuse the site's dark design system, link to each other (cluster),
link back to the main site, and carry per-page FAQ + JSON-LD FAQPage.

Usage:
    python3 gen_longtail.py            # generate both EN (root) and CN (store/cn_longtail)
"""
import os
import html
import json

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tinyps/ root
EN_DIR = REPO                       # English pages go to repo root
CN_DIR = os.path.join(REPO, "store", "cn_longtail")
os.makedirs(CN_DIR, exist_ok=True)

EN_BASE = "https://nonotde.github.io/tinyps"
CN_BASE = "https://pic.zxxdb.com"

PUB_DATE = "2026-11-05"

CSS = """<style>
:root{--bg:#14161a;--bg2:#1d2026;--txt:#e8eaed;--txt3:#9aa0a8;--acc:#4da3ff;--accBg:rgba(77,163,255,.12);--border:#2c313a;--radius:12px}
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.8 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--txt)}
.wrap{max-width:880px;margin:0 auto;padding:0 20px}
a{color:var(--acc);text-decoration:none}
header{padding:24px 0;display:flex;align-items:center;justify-content:space-between}
.logo{font-size:20px;font-weight:700;display:flex;align-items:center;gap:10px}
.logo .mark{width:30px;height:30px;border-radius:8px;object-fit:cover;display:inline-block}
nav a{margin-left:18px;color:var(--txt3);font-size:14px}
nav a:hover{color:var(--acc)}
.crumb{color:var(--txt3);font-size:13px;margin:6px 0 26px}
.crumb a{color:var(--txt3)}
.crumb a:hover{color:var(--acc)}
h1{font-size:32px;line-height:1.35;margin-bottom:14px}
.lead{color:var(--txt3);font-size:17px;margin-bottom:28px}
h2{font-size:22px;margin:30px 0 12px}
p{margin:12px 0;color:#cdd2d8}
p.note{color:var(--txt3);font-size:14px}
ol.steps{margin:12px 0 12px 22px;color:#cdd2d8}
ol.steps li{margin:8px 0}
ul.dots{margin:12px 0 12px 20px;color:#cdd2d8}
ul.dots li{margin:8px 0}
.cta{background:var(--accBg);border:1px solid rgba(77,163,255,.35);border-radius:var(--radius);padding:20px 22px;margin:28px 0;text-align:center}
.cta h3{font-size:18px;margin-bottom:10px}
.cta .btn{display:inline-block;background:var(--acc);color:#fff;border-radius:8px;padding:10px 22px;font-weight:600;margin:6px 6px 0}
.cta .btn.outline{background:transparent;border:1px solid var(--border);color:var(--txt)}
table.cmp{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}
table.cmp th,table.cmp td{border:1px solid var(--border);padding:9px 12px;text-align:left}
table.cmp th{background:var(--bg2);color:var(--txt)}
table.cmp td.ok{color:#5fd38a}
table.cmp td.no{color:#ff7a7a}
.related{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:18px 22px;margin:34px 0}
.related h3{font-size:16px;margin-bottom:10px}
.related a{display:block;padding:5px 0;color:var(--acc)}
.faq{margin:26px 0 10px}
.faq .q{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;margin-bottom:12px}
.faq .q h3{font-size:16px;margin-bottom:6px;color:var(--txt)}
.faq .q p{color:var(--txt3);font-size:14px;margin:0}
footer{border-top:1px solid var(--border);padding:24px 0 40px;color:var(--txt3);font-size:13px;margin-top:30px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
footer a{margin-right:14px}
</style>"""

# ---------------------------------------------------------------------------
# 6 long-tail topics. Each has EN + ZH: title, desc, h1, lead, sections[(h2,body)],
# faq[(q,a)]. body may contain simple markup via the small helpers below.
# ---------------------------------------------------------------------------

def steps(items):
    return "<ol class='steps'>" + "".join(f"<li>{i}</li>" for i in items) + "</ol>"

def bullets(items):
    return "<ul class='dots'>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"

TOPICS = [
{
 "slug": "remove-background-without-uploading",
 "en": {
   "title": "Remove Image Background Without Uploading — 100% Local & Private",
   "desc": "Remove backgrounds from images without uploading them to any server. TinyPS runs AI background removal entirely on your device — private, offline, no account needed.",
   "h1": "Remove Image Background Without Uploading a Single Pixel",
   "lead": "Most background removers upload your photo to a cloud, process it on someone else's server, then send it back. TinyPS does the opposite: the AI model runs in your browser, so your image never leaves your computer.",
   "sections": [
     ("How to remove a background offline",
      "It takes about 20 seconds and zero uploads:" +
      steps(["Install the TinyPS extension for Chrome or Edge (or open the free online editor — no install).",
             "Open your image inside TinyPS.",
             "Click “Remove background”. The u2netp model runs locally via WebAssembly.",
             "Export a PNG with transparency, or drop it onto another layer to keep editing."])),
     ("Why “no upload” actually matters",
      "When a tool uploads your photo, it stores it, may train on it, and becomes a target for breaches. With TinyPS the file stays on your device:" +
      bullets(["No cloud account, no API key, no queue.",
               "Confidential screenshots, IDs and product shots never touch a server.",
               "EXIF location and metadata are not leaked to a third party.",
               "Works on a plane, in a basement, anywhere — fully offline."])),
     ("Free vs Pro",
      "Background removal is a Pro feature. The free editor still covers crop, resize, compress, convert and batch export. Pro is a one-time $24.90 (Alipay supported), or $1.99/mo, $9.90/yr."),
     ("TinyPS vs online background removers",
      "<table class='cmp'><tr><th>Capability</th><th>TinyPS</th><th>Typical online tool</th></tr>"
      "<tr><td>Image uploaded to server</td><td class='no'>No</td><td class='ok'>Yes</td></tr>"
      "<tr><td>Runs offline</td><td class='ok'>Yes</td><td class='no'>No</td></tr>"
      "<tr><td>Account required</td><td class='no'>No</td><td class='ok'>Usually</td></tr>"
      "<tr><td>One-time price</td><td class='ok'>$24.90</td><td class='no'>Subscription</td></tr></table>"),
   ],
   "faq": [
     ("Does TinyPS upload my image when removing the background?",
      "No. The u2netp segmentation model runs entirely on your device through ONNX Runtime WebAssembly. There is no cloud API call and your photo never leaves your computer."),
     ("Is background removal included in the free version?",
      "Background removal is a Pro feature. The free tier covers all core editing, compression, format conversion and batch ZIP export."),
     ("What formats can I export after removing the background?",
      "You can export PNG (with transparency), JPEG, WebP, BMP or GIF, plus a single ZIP of multiple pages."),
   ],
 },
 "zh": {
   "title": "本地去背景不上传——100% 在设备上，隐私更安全",
   "desc": "不把照片传到任何服务器就能去除背景。TinyPS 的 AI 去背景模型完全在你的设备上运行，离线可用、无需账号。",
   "h1": "本地去背景，照片一个像素都不上传",
   "lead": "大多数去背景工具会把你的照片上传到云端，在别人的服务器上处理再传回来。TinyPS 反过来：AI 模型在你的浏览器里运行，照片永远不会离开你的电脑。",
   "sections": [
     ("如何离线去除背景",
      "大约 20 秒，零上传：" +
      steps(["给 Chrome 或 Edge 安装 TinyPS 扩展（或打开免费的在线编辑器，免安装）。",
             "在 TinyPS 里打开你的图片。",
             "点击「去除背景」。u2netp 模型通过 WebAssembly 在本地运行。",
             "导出带透明背景的 PNG，或拖到别的图层继续编辑。"])),
     ("「不上传」为什么重要",
      "工具一旦上传你的照片，就可能存储它、用它训练，并成为数据泄露的目标。TinyPS 让文件始终留在你的设备上：" +
      bullets(["无云账号、无 API Key、无需排队。",
               "机密截图、证件照、产品图绝不会碰到服务器。",
               "EXIF 定位和元数据不会泄露给第三方。",
               "飞机上、地下室、任何地方都能离线用。"])),
     ("免费版与 Pro",
      "去背景属于 Pro 功能。免费编辑器仍覆盖裁剪、缩放、压缩、格式转换与批量导出。Pro 终身买断 $24.9（支持支付宝），或月付 $1.99、年付 $9.9。"),
     ("TinyPS 与在线去背景工具对比",
      "<table class='cmp'><tr><th>能力</th><th>TinyPS</th><th>常见在线工具</th></tr>"
      "<tr><td>图片上传到服务器</td><td class='no'>否</td><td class='ok'>是</td></tr>"
      "<tr><td>离线可用</td><td class='ok'>是</td><td class='no'>否</td></tr>"
      "<tr><td>需要账号</td><td class='no'>否</td><td class='ok'>通常要</td></tr>"
      "<tr><td>买断价</td><td class='ok'>$24.9</td><td class='no'>订阅制</td></tr></table>"),
   ],
   "faq": [
     ("TinyPS 去背景时会把我的图片上传吗？",
      "不会。u2netp 分割模型通过 ONNX Runtime WebAssembly 完全在你的设备上运行，没有任何云端 API 调用，照片永远不会离开你的电脑。"),
     ("免费版包含去背景吗？",
      "去背景属于 Pro 功能。免费版涵盖所有基础编辑、压缩、格式转换与批量 ZIP 导出。"),
     ("去背景后能导出哪些格式？",
      "可导出 PNG（带透明）、JPEG、WebP、BMP、GIF，以及把多页一次性打包成 ZIP。"),
   ],
 },
},
{
 "slug": "offline-image-editor",
 "en": {
   "title": "Offline Image Editor — Edit Photos With No Internet",
   "desc": "A fully offline image editor that runs in your browser: crop, resize, compress, convert and add text with zero uploads and no internet required.",
   "h1": "Offline Image Editor: Edit Photos With No Internet",
   "lead": "If your work involves sensitive pictures, a web tool that phones home is a problem. TinyPS is an offline image editor that runs entirely in your browser — no server, no sync, no leak.",
   "sections": [
     ("What “offline image editor” means here",
      "TinyPS loads as a Chrome/Edge extension and also as a free in-browser editor. Once open, every operation — crop, rotate, resize, layers, text, filters, compression, conversion — happens on your device. You can pull the network cable and keep editing."),
     ("Why edit offline",
      bullets(["Privacy: nothing is sent to a server, ever.",
               "Reliability: no server outage, no rate limit, no queue.",
               "Speed: local processing is instant for normal images.",
               "Cost: core editing is free, no per-image credits."])),
     ("How to start editing offline",
      steps(["Install TinyPS from the Chrome Web Store or Edge Add-ons (or open the online editor).",
             "Open an image — from your disk, or right-click any web image and choose “Edit image with TinyPS”.",
             "Edit with layers, crop, resize, compress or convert.",
             "Export to JPEG/PNG/WebP/BMP/GIF, or a ZIP of all pages."])),
     ("Offline vs “free online editor” that still uploads",
      "Many “free editors” run in a tab but upload your file to process it. TinyPS processes locally even in its online editor mode, so the offline guarantee holds."),
   ],
   "faq": [
     ("Can TinyPS really run with no internet?",
      "Yes. Editing, compression and conversion need no network. The only traffic is your Pro license check when you activate a paid feature."),
     ("Do I have to install anything to edit offline?",
      "You can install the extension for the best experience, or use the free online editor which also runs locally in your browser."),
     ("Which formats does the offline editor support?",
      "JPEG, PNG, WebP, BMP and GIF — including formats Chrome cannot export natively, via built-in encoders."),
   ],
 },
 "zh": {
   "title": "离线图片编辑器——不联网也能修图",
   "desc": "一款完全离线的浏览器图片编辑器：裁剪、缩放、压缩、格式转换、加文字，零上传、无需联网。",
   "h1": "离线图片编辑器：不联网也能修图",
   "lead": "如果你的工作涉及敏感图片，一个会联网回传的网页工具就是隐患。TinyPS 是一款完全在浏览器里运行的离线图片编辑器——无服务器、无同步、无泄露。",
   "sections": [
     ("这里说的「离线图片编辑器」是什么",
      "TinyPS 以 Chrome/Edge 扩展形式加载，也有免费的浏览器内编辑器。打开后，裁剪、旋转、缩放、图层、文字、滤镜、压缩、转换每一步都在你的设备上完成。拔掉网线也能继续编辑。"),
     ("为什么要在离线状态修图",
      bullets(["隐私：任何文件都不会发往服务器。",
               "可靠：没有服务器宕机、没有限流、不用排队。",
               "速度：普通图片本地处理即时完成。",
               "成本：核心编辑免费，没有按张计费。"])),
     ("如何开始离线编辑",
      steps(["从 Chrome 网上应用店或 Edge 外接程序安装 TinyPS（或打开在线编辑器）。",
             "打开一张图片——从磁盘，或在任意网页图片上右键选「用 TinyPS 编辑图片」。",
             "用图层、裁剪、缩放、压缩或转换进行编辑。",
             "导出为 JPEG/PNG/WebP/BMP/GIF，或多页打包成 ZIP。"])),
     ("离线 vs「免费在线编辑器但仍上传」",
      "很多「免费编辑器」在标签页里运行却会把文件上传处理。TinyPS 即使在在线编辑器模式下也本地处理，离线保证始终成立。"),
   ],
   "faq": [
     ("TinyPS 真的可以完全不联网吗？",
      "可以。编辑、压缩、转换都不需要网络，唯一的网络请求是你激活付费功能时的 Pro 许可证校验。"),
     ("离线编辑必须安装东西吗？",
      "装扩展体验最好，也可以用免费的在线编辑器，它同样在你的浏览器里本地运行。"),
     ("离线编辑器支持哪些格式？",
      "JPEG、PNG、WebP、BMP、GIF——包含 Chrome 原生无法导出的格式（自研编码器）。"),
   ],
 },
},
{
 "slug": "batch-image-editor-no-upload",
 "en": {
   "title": "Batch Image Editor That Doesn't Upload Your Files",
   "desc": "Batch edit, resize and compress many images at once — locally, with no uploads. TinyPS processes every file on your device and exports a ZIP.",
   "h1": "Batch Image Editor That Doesn't Upload Your Files",
   "lead": "Need to resize 50 product photos or compress a folder of screenshots? Batch tools usually push your files to a server. TinyPS processes them all on your device and hands you one ZIP — nothing uploaded.",
   "sections": [
     ("Batch editing, locally",
      "TinyPS opens multiple images as separate pages. Apply per-page settings — resize, crop, compress, convert — then export them all as a single ZIP. All of it runs in your browser."),
     ("Common batch jobs you can do privately",
      bullets(["Resize a whole folder to a fixed width for a website.",
               "Compress screenshots before emailing them.",
               "Convert PNGs to WebP to save space.",
               "Add a watermark or text layer across many images."])),
     ("How to batch edit without uploading",
      steps(["Open TinyPS and load all the images you want.",
             "Set resize / crop / compression per page (or repeat the same setting).",
             "Review each page in the thumbnail strip.",
             "Click export and TinyPS bundles everything into one ZIP on your device."])),
     ("Why local batch beats cloud batch",
      "Cloud batch tools see every file you process. With TinyPS the folder never leaves your machine, which matters for client work, IDs and unreleased product shots."),
   ],
   "faq": [
     ("Does TinyPS upload my images during batch export?",
      "No. Every page is processed on your device and the ZIP is built locally in your browser."),
     ("Is batch editing free?",
      "Yes. Multi-page batch editing and ZIP export are part of the free core editor."),
     ("How many images can I batch at once?",
      "It depends on your device memory, but typical batches of dozens to a few hundred images work fine locally."),
   ],
 },
 "zh": {
   "title": "批量图片编辑器，文件不上传",
   "desc": "一次性批量编辑、缩放、压缩多张图片——全程本地，不上传。TinyPS 在设备上处理每张图并导出 ZIP。",
   "h1": "批量图片编辑器，文件一个都不上传",
   "lead": "要缩放 50 张产品图、压缩一整文件夹截图？批量工具通常会把你的文件推到服务器。TinyPS 在设备上处理全部图片，最后给你一个 ZIP——什么都不上传。",
   "sections": [
     ("本地批量编辑",
      "TinyPS 把多张图片作为独立页面打开。设置每页的缩放、裁剪、压缩、转换，再一次性导出为单个 ZIP，全程在你的浏览器里完成。"),
     ("你可以私密完成的常见批量任务",
      bullets(["把一整个文件夹缩放成网站用的固定宽度。",
               "发邮件前压缩一批截图。",
               "把 PNG 批量转成更省空间的 WebP。",
               "给多张图片统一加上水印或文字图层。"])),
     ("如何不上传地批量编辑",
      steps(["打开 TinyPS，载入所有要处理的图片。",
             "为每页设置缩放/裁剪/压缩（或统一用同一设置）。",
             "在缩略图条里逐页检查。",
             "点导出，TinyPS 在设备上把全部内容打包成一个 ZIP。"])),
     ("本地批量为什么优于云端批量",
      "云端批量工具会看到你处理的每一张文件。TinyPS 让文件夹始终不离开你的机器，对客户稿、证件照、未发布产品图尤为重要。"),
   ],
   "faq": [
     ("TinyPS 批量导出时会上传我的图片吗？",
      "不会。每一页都在你的设备上处理，ZIP 也在浏览器本地生成。"),
     ("批量编辑免费吗？",
      "免费。多页批量编辑与 ZIP 导出都属于免费核心功能。"),
     ("一次能批量处理多少张？",
      "取决于你的设备内存，本地处理几十到几百张通常都没问题。"),
   ],
 },
},
{
 "slug": "private-photo-editor-no-signup",
 "en": {
   "title": "Private Photo Editor — No Sign-up, No Tracking",
   "desc": "A private photo editor that needs no account and tracks nothing. Edit, compress and convert images locally with TinyPS — your files stay yours.",
   "h1": "Private Photo Editor: No Sign-up, No Tracking",
   "lead": "Most editors ask you to register, then watch what you do. TinyPS is a private photo editor with no account, no analytics on your images, and no uploads — just open a file and edit.",
   "sections": [
     ("No account, by design",
      "You can use the entire free editor without creating an account. The only thing that ever touches the network is an optional Pro license check when you unlock a paid feature — and that is your key, not your photos."),
     ("What “private” covers",
      bullets(["No registration or email required to edit.",
               "No tracking pixels or behavioral analytics on your images.",
               "No cloud storage of your files.",
               "Open-source-friendly local processing you can verify."])),
     ("How to edit privately",
      steps(["Open TinyPS (extension or free online editor) — no login.",
             "Load your image from disk or a right-click on any web image.",
             "Edit, compress or convert entirely on your device.",
             "Export and the file stays on your machine."])),
     ("Private vs “free but tracked” editors",
      "Free is not the same as private. A tracked editor may still profile you and store your uploads. TinyPS keeps the file local and the session anonymous."),
   ],
   "faq": [
     ("Do I need to sign up to use TinyPS?",
      "No. The free editor needs no account. You only enter a license key if you choose to activate Pro."),
     ("Does TinyPS track what I edit?",
      "No. There is no image analytics and no behavioral tracking. Editing happens locally."),
     ("Where are my photos stored?",
      "On your own device. TinyPS does not upload or store your images on any server."),
   ],
 },
 "zh": {
   "title": "隐私图片编辑器——免注册、不追踪",
   "desc": "一款无需账号、零追踪的隐私图片编辑器。用 TinyPS 本地编辑、压缩、转换图片，文件始终是你的。",
   "h1": "隐私图片编辑器：免注册、不追踪",
   "lead": "多数编辑器要求你注册，然后盯着你的一举一动。TinyPS 是一款隐私图片编辑器：无账号、不对你的图片做分析、不上传——打开文件就能编辑。",
   "sections": [
     ("从设计上就不要账号",
      "整个免费编辑器无需注册即可使用。唯一会碰到网络的，是你解锁付费功能时一次可选的 Pro 许可证校验——而且那是你的密钥，不是你的照片。"),
     ("「隐私」包含什么",
      bullets(["编辑无需注册或邮箱。",
               "不对你的图片做追踪像素或行为分析。",
               "不在云端存储你的文件。",
               "本地处理，可验证、可放心。"])),
     ("如何隐私地编辑",
      steps(["打开 TinyPS（扩展或免费在线编辑器）——无需登录。",
             "从磁盘载入图片，或在任意网页图片上右键。",
             "在你的设备上完成编辑、压缩或转换。",
             "导出，文件留在你的机器上。"])),
     ("隐私 vs「免费但仍被追踪」的编辑器",
      "免费不等于隐私。被追踪的编辑器仍可能给你画像并存储上传内容。TinyPS 让文件留在本地、会话保持匿名。"),
   ],
   "faq": [
     ("用 TinyPS 需要注册吗？",
      "不需要。免费编辑器无需账号，只有你选择激活 Pro 时才输入许可证密钥。"),
     ("TinyPS 会追踪我编辑了什么吗？",
      "不会。没有图片分析，也没有行为追踪，编辑都在本地发生。"),
     ("我的照片存在哪里？",
      "在你的设备上。TinyPS 不在任何服务器上传或存储你的图片。"),
   ],
 },
},
{
 "slug": "compress-images-locally",
 "en": {
   "title": "Compress Images Locally — Shrink Files Without Uploading",
   "desc": "Compress and shrink images locally with a quality slider, lossless passthrough and metadata stripping — no uploads, fully private.",
   "h1": "Compress Images Locally — Shrink Files Without Uploading",
   "lead": "Online compressors make you upload a file just to make it smaller. TinyPS compresses images on your device: drag a quality slider, strip metadata, and export — nothing leaves your computer.",
   "sections": [
     ("Local compression features",
      bullets(["Quality slider for JPEG/WebP.",
               "True lossless passthrough — untouched images are not re-encoded (0% quality loss).",
               "Metadata stripping to remove EXIF (location, camera).",
               "Target file size mode that shrinks to a goal you set."])),
     ("How to compress without uploading",
      steps(["Open your image in TinyPS.",
             "Open the compression panel and move the quality slider.",
             "Optionally strip metadata and set a target size.",
             "Export — the smaller file is built on your device."])),
     ("Why local compression is safer",
      "An online compressor receives a copy of your original, which may contain location or private content. Local compression keeps the original on your machine and only you see it."),
     ("Compression vs conversion",
      "You can also convert formats (PNG to WebP, etc.) which often shrinks files further. Both run locally in TinyPS."),
   ],
   "faq": [
     ("Does image compression upload my file?",
      "No. TinyPS compresses entirely on your device; the original never leaves your computer."),
     ("What is lossless passthrough?",
      "If an image is already small or you change nothing, TinyPS skips re-encoding so there is literally zero quality loss."),
     ("Can I remove EXIF / location data?",
      "Yes. The compression panel can strip metadata so exported files carry no location or camera info."),
   ],
 },
 "zh": {
   "title": "本地压缩图片——缩小文件不上传",
   "desc": "用质量滑杆、无损直通与去除元数据在本地压缩图片——不上传、完全隐私。",
   "h1": "本地压缩图片——缩小文件不上传",
   "lead": "在线压缩工具为了把文件变小，却先让你把文件上传。TinyPS 在设备上压缩图片：拖动质量滑杆、去除元数据、导出——什么都不离开你的电脑。",
   "sections": [
     ("本地压缩功能",
      bullets(["JPEG/WebP 质量滑杆。",
               "真·无损直通——未改动的图片不重新编码（零质量损失）。",
               "去除元数据，删掉 EXIF（定位、相机信息）。",
               "目标体积模式，按你设定的目标自动缩小。"])),
     ("如何不上传地压缩",
      steps(["在 TinyPS 里打开你的图片。",
             "打开压缩面板，拖动质量滑杆。",
             "按需去除元数据、设定目标体积。",
             "导出——更小的文件在你的设备上生成。"])),
     ("为什么本地压缩更安全",
      "在线压缩器会收到你原图的副本，其中可能含定位或隐私内容。本地压缩让原图留在你的机器上，只有你能看到。"),
     ("压缩与格式转换",
      "你也可以转换格式（如 PNG 转 WebP），往往能进一步缩小。两者都在 TinyPS 本地完成。"),
   ],
   "faq": [
     ("图片压缩会上传我的文件吗？",
      "不会。TinyPS 完全在你的设备上压缩，原图永远不会离开你的电脑。"),
     ("什么是无损直通？",
      "如果图片已经很小或你没改动，TinyPS 会跳过重新编码，做到字面意义上的零质量损失。"),
     ("能去掉 EXIF / 定位信息吗？",
      "可以。压缩面板能去除元数据，导出的文件不带定位或相机信息。"),
   ],
 },
},
{
 "slug": "free-photo-editor-chrome-extension",
 "en": {
   "title": "Free Photo Editor Chrome Extension — Local & No Watermark",
   "desc": "A free photo editor Chrome extension that runs locally with no watermark: crop, resize, compress, convert and remove backgrounds — all in your browser.",
   "h1": "Free Photo Editor Chrome Extension — Local, No Watermark",
   "lead": "TinyPS is a free photo editor Chrome extension that does real editing on your device — no watermark on exports, no forced account, no credits. Pro adds a few advanced tools if you ever want them.",
   "sections": [
     ("What the free extension does",
      bullets(["Crop, rotate, resize with preset ratios.",
               "Layers, text, filters and canvas tools.",
               "Compress and convert JPEG/PNG/WebP/BMP/GIF.",
               "Multi-page batch and ZIP export.",
               "No watermark on any export."])),
     ("Install in seconds",
      steps(["Open the Chrome Web Store page for TinyPS.",
             "Click Add to Chrome.",
             "Right-click any web image and choose “Edit image with TinyPS”, or open the extension.",
             "Start editing — no sign-up."])),
     ("Free vs Pro, plainly",
      "Free covers everyday editing and export. Pro (one-time $24.90, Alipay supported; or $1.99/mo, $9.90/yr) adds free-form crop, fill layers and AI background removal."),
     ("Why a local extension beats a tab tool",
      "A local extension works offline, adds a right-click menu, and never uploads your image. Tab-only tools often upload files and show watermarks on free exports."),
   ],
   "faq": [
     ("Is TinyPS really free?",
      "Yes — the core editor is free forever, with no watermark and no account required."),
     ("Do exports have a watermark?",
      "No. TinyPS never adds a watermark, on free or Pro."),
     ("Which browsers are supported?",
      "Chrome and Edge (Chromium-based). An online editor version also works in any modern browser."),
   ],
 },
 "zh": {
   "title": "免费的 Chrome 图片编辑扩展——本地、无水印",
   "desc": "一款在本地运行、无水印的免费 Chrome 图片编辑扩展：裁剪、缩放、压缩、格式转换、去背景，全在浏览器里。",
   "h1": "免费的 Chrome 图片编辑扩展——本地、无水印",
   "lead": "TinyPS 是一款在设备上做真正编辑的免费 Chrome 图片编辑扩展——导出无水印、不强制账号、不计费。Pro 仅在你需要时增加少量高级工具。",
   "sections": [
     ("免费扩展能做什么",
      bullets(["裁剪、旋转、按比例缩放。",
               "图层、文字、滤镜与画布工具。",
               "压缩并转换 JPEG/PNG/WebP/BMP/GIF。",
               "多页批量与 ZIP 导出。",
               "任何导出都无水印。"])),
     ("几秒装好",
      steps(["打开 TinyPS 的 Chrome 网上应用店页面。",
             "点击「添加至 Chrome」。",
             "在任意网页图片上右键选「用 TinyPS 编辑图片」，或打开扩展。",
             "开始编辑——无需注册。"])),
     ("免费与 Pro，直说",
      "免费覆盖日常编辑与导出。Pro（终身买断 $24.9，支持支付宝；或月付 $1.99、年付 $9.9）额外提供自由裁剪、填充图层与 AI 去背景。"),
     ("本地扩展为什么优于标签页工具",
      "本地扩展可离线工作、带右键菜单、绝不上传图片。仅标签页的工具常上传文件，且免费导出带水印。"),
   ],
   "faq": [
     ("TinyPS 真的免费吗？",
      "真的——核心编辑器永久免费，无水印、无需账号。"),
     ("导出会有水印吗？",
      "不会。TinyPS 在免费或 Pro 下都不添加水印。"),
     ("支持哪些浏览器？",
      "Chrome 与 Edge（基于 Chromium）。在线编辑器版也可在任何现代浏览器使用。"),
   ],
 },
},
]

def render(topic, lang, base):
    d = topic[lang]
    slug = topic["slug"]
    url = f"{base}/{slug}.html"
    sections_html = ""
    for h2, body in d["sections"]:
        sections_html += f"<h2>{html.escape(h2)}</h2>\n{body}\n"
    faq_html = "<div class='faq'>\n"
    faq_json = []
    for q, a in d["faq"]:
        faq_html += f"<div class='q'><h3>{html.escape(q)}</h3><p>{html.escape(a)}</p></div>\n"
        faq_json.append({
            "@type": "Question",
            "name": q,
            "acceptedAnswer": {"@type": "Answer", "text": a},
        })
    faq_html += "</div>\n"

    # Related guides (cluster interlinking) — all other topics
    related_html = "<div class='related'><h3>" + ("More TinyPS guides" if lang == "en" else "更多 TinyPS 指南") + "</h3>\n"
    for t in TOPICS:
        if t["slug"] == slug:
            continue
        td = t[lang]
        related_html += f"<a href='{t['slug']}.html'>{html.escape(td['h1'])}</a>\n"
    related_html += "</div>\n"

    home_rel = "index.html"
    cta = ("<div class='cta'><h3>Try TinyPS — edit locally, nothing uploaded</h3>"
           "<a class='btn' href='https://chromewebstore.google.com/detail/knlnllmbmcjglhnphedilklcnmhbggen'>Install for Chrome</a>"
           "<a class='btn outline' href='editor/'>Open free online editor</a></div>"
           if lang == "en" else
           "<div class='cta'><h3>试试 TinyPS——本地编辑，什么都不上传</h3>"
           "<a class='btn' href='https://chromewebstore.google.com/detail/knlnllmbmcjglhnphedilklcnmhbggen'>前往 Chrome 商店安装</a>"
           "<a class='btn outline' href='editor/'>打开免费在线编辑器</a></div>")

    nav = ("<nav><a href='index.html'>Home</a><a href='privacy.html'>Privacy</a>"
           "<a href='install.html'>Install</a><a href='support.html'>Support</a></nav>"
           if lang == "en" else
           "<nav><a href='index.html'>首页</a><a href='privacy.html'>隐私</a>"
           "<a href='install.html'>安装</a><a href='support.html'>支持</a></nav>")

    crumb = ("<div class='crumb'><a href='index.html'>TinyPS</a> › Guides</div>"
             if lang == "en" else
             "<div class='crumb'><a href='index.html'>TinyPS</a> › 指南</div>")

    faq_ld = json.dumps({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faq_json,
    }, ensure_ascii=False)
    article_ld = json.dumps({
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": d["h1"],
        "description": d["desc"],
        "inLanguage": "en" if lang == "en" else "zh-CN",
        "datePublished": PUB_DATE,
        "dateModified": PUB_DATE,
        "author": {"@type": "Organization", "name": "TinyPS"},
        "publisher": {"@type": "Organization", "name": "TinyPS"},
        "mainEntityOfPage": {"@type": "WebPage", "@id": url},
    }, ensure_ascii=False)

    doc = f"""<!DOCTYPE html>
<html lang="{'en' if lang=='en' else 'zh-CN'}">
<head>
<meta charset="utf-8">
<title>{html.escape(d['title'])}</title>
<meta name="description" content="{html.escape(d['desc'])}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:title" content="{html.escape(d['title'])}">
<meta property="og:description" content="{html.escape(d['desc'])}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{html.escape(d['title'])}">
<meta name="twitter:description" content="{html.escape(d['desc'])}">
{CSS}
</head>
<body>
<div class="wrap">
<header>
  <div class="logo"><img class="mark" src="assets/logo.png" alt="TinyPS logo">Tiny<span style="color:var(--acc)">PS</span></div>
  {nav}
</header>
{crumb}
<h1>{html.escape(d['h1'])}</h1>
<p class="lead">{html.escape(d['lead'])}</p>
{sections_html}
{cta}
{related_html}
<div class="faq-wrap">
<h2 id="faq">{"Frequently asked questions" if lang=='en' else "常见问题"}</h2>
{faq_html}
</div>
<footer>
  <div>© 2026 TinyPS</div>
  <div>
    <a href="index.html">{"Home" if lang=='en' else "首页"}</a>
    <a href="privacy.html">{"Privacy" if lang=='en' else "隐私"}</a>
    <a href="install.html">{"Install" if lang=='en' else "安装"}</a>
    <a href="support.html">{"Support" if lang=='en' else "支持"}</a>
  </div>
</footer>
</div>
<script type="application/ld+json">
{article_ld}
</script>
<script type="application/ld+json">
{faq_ld}
</script>
</body>
</html>
"""
    return doc


def main():
    for t in TOPICS:
        # English -> repo root
        en_path = os.path.join(EN_DIR, t["slug"] + ".html")
        with open(en_path, "w", encoding="utf-8") as f:
            f.write(render(t, "en", EN_BASE))
        # Chinese -> store/cn_longtail
        cn_path = os.path.join(CN_DIR, t["slug"] + ".html")
        with open(cn_path, "w", encoding="utf-8") as f:
            f.write(render(t, "zh", CN_BASE))
        print("generated:", t["slug"], "(en + zh)")
    print(f"\nTotal topics: {len(TOPICS)} -> {len(TOPICS)*2} pages")
    print("EN pages in repo root; CN pages in store/cn_longtail/")


if __name__ == "__main__":
    main()

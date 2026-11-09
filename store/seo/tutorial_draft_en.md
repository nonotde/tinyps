# How to Edit and Compress Images 100% Offline (No Upload, No Account, No Privacy Risk)

*Every time you upload a photo to an "online photo editor," that image leaves your machine. Here's how to do the same work — cropping, compressing, converting, even AI background removal — entirely on your own device.*

---

## The privacy problem nobody talks about

Most "free online Photoshop" tools work like this: you pick a file, it uploads to their server, they process it, and they send it back. The processing is the part you see. The part you *don't* see is what happens next — the image may be indexed, cached, or retained, and in some cases used to train models. For product photos, ID scans, or client artwork, that's a real risk.

There's a simpler model: **run the editor in your browser, but never send the file anywhere.** No server. No account. No tracking. Your photo stays in your tab and is discarded when you close it.

This article walks through the common editing tasks you can do fully offline, and how a browser-based tool like [TinyPS](https://nonotde.github.io/tinyps/) handles each one.

---

## What "offline image editing" actually means

It means the code that crops, resizes, compresses, and runs the AI model executes **locally** — in JavaScript and WebAssembly on your CPU. The only network requests are the ones you explicitly make (e.g., loading an image from a URL you typed, or activating a paid license). The image pixels never travel.

This isn't a niche concern. Privacy laws in many regions require "minimum necessary" handling of personal data, and "we didn't upload your file" is the strongest compliance story there is.

---

## Task 1: Compress without losing quality

When you re-save a file you *didn't* change, a good offline tool copies the bytes as-is — no re-encoding, so zero quality loss. For files you did change:

- Aim at a target file size (e.g., "under 300 KB")
- Strip metadata (EXIF) in one click
- Control quality with a single slider

For a webshop, this is the classic win: take a 5 MB product shot, push it to 300 KB, and the page loads faster with no visible difference.

---

## Task 2: Convert formats locally

Convert between JPEG, PNG, WebP, BMP, and GIF — and, more recently, **export to AVIF** using a local WASM encoder that loads lazily so it doesn't slow startup. You can also batch-export every page to a single ZIP with no external tools.

A practical note: AVIF export is great for delivery, but not every browser can *open* AVIF as a source yet, so keep WebP as your safe default for now.

---

## Task 3: AI background removal, on your CPU

Background removal used to mean uploading to a cloud API. Now it runs in the browser: a model like `u2netp`, executed via ONNX Runtime WebAssembly, produces a transparent PNG or WebP in a few seconds — offline. No API key, no per-image fee, no upload.

This is ideal for marketplace listings (闲鱼, eBay), white-background ID photos, or memes: the cutout happens locally in seconds, and the source material never leaves your machine.

---

## Task 4: Watermarks and multi-layer compositing

For social posts or branded assets, you want layers: paste a logo as its own layer, add a text layer for price or captions, reorder and adjust opacity without touching the original. Set watermark text opacity (default 100%), and new text inherits the previous text's rotation so a series of labels stays consistent.

---

## Task 5: Crop with precision

Use preset crops (1:1, 4:3, 16:9, 3:2, 9:16) for free; free cropping lives behind the Pro tier. A useful free-crop mode lets you choose **keep-inside vs keep-outside**: keep-outside deletes what's *inside* the box (great for slicing a whole horizontal/vertical strip or punching a transparent hole), while keep-inside keeps the selection. There's also free rotation (drag the center handle around the image center, with 90° magnetic snap) for straightening a slightly tilted scan.

---

## Why this matters for speed, too

Local processing is only as fast as your computer, but for typical photos compression and conversion are instant, and background removal usually finishes in a few seconds. No upload wait, no server queue.

---

## Try it

If you want a concrete, no-signup way to test this, [TinyPS](https://nonotde.github.io/tinyps/) is a free Chrome extension that does all of the above offline. The free tier covers layers, crop presets, resize, rotate, compress, convert, filters, text, and batch export; AI background removal and free crop are part of TinyPS Pro. Install it, open your first photo, and edit entirely offline — no registration, no upload, zero risk.

---

*Written for developers and creators who care about keeping their images private. If this was useful, share it with someone still uploading sensitive photos to random web forms.*

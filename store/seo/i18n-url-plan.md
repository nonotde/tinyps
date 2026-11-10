# 中文首页独立 URL 改造方案（/zh/ 子目录）

> 状态：待用户确认后实施　|　日期：2026-11-10

## 一、问题诊断

当前首页是**单 URL + 客户端 JS 切换**：`https://www.tinyps.top/` 一套 URL，语言由
`localStorage.getItem('tinyps_lang') || 'en'` 决定，默认英文，点「中文」按钮只改 DOM 不改 URL。

带来四个具体问题：

| # | 问题 | 影响 |
|---|---|---|
| 1 | **Googlebot 抓到的只有 EN 版** | 中文内容与中文查询词没有对应着陆页，「图片压缩 中文」这类词无法命中 |
| 2 | **首页无法配 hreflang** | Google 要求每种语言有独立 URL，同 URL 的 hreflang 会被直接忽略 |
| 3 | **Baidu 对 JS 渲染支持弱** | 中文搜索生态里收录更差。国内站下线后 Baidu 是中文流量主要入口 |
| 4 | **canonical 自指 + 单 URL 混两种语言** | 索引质量判断信号混乱；分享链接给中文用户时对方看到的可能是英文 |

已完成的次级页双语化（install/activate/support/privacy/terms 各有 `-zh` 版本 + hreflang）
只解决了**内页**，首页这个缺口仍在。

## 二、方案选型

| 方案 | 结构 | 评价 |
|---|---|---|
| **A. `/zh/` 子目录** | `/` = EN，`/zh/` = ZH | **推荐**。零新增基础设施（复用现有证书、DNS、nginx），hreflang 规范可用，URL 语义清晰 |
| B. `zh.tinyps.top` 子域名 | 独立主机名 | 隔离最彻底，但要加 DNS + 证书 SAN + nginx 虚拟主机，运维面变大；小站无必要 |
| C. `?lang=zh` 参数 | 同路径带参数 | 参数 URL 会被当独立页面，除非 canonical 严格收敛；hreflang 表达别扭；Baidu 对参数处理差。**不推荐** |
| D. 维持现状 | 现状 | 中文内容继续无法单独索引 |

**选 A。** 理由：现有 5 组次级页已用「base + `-zh`」命名，中文首页放 `/zh/` 与之相容；
不引入新域名/证书；`try_files $uri $uri/` 天然支持目录索引，nginx 基本不用改。

## 三、目标 URL 结构

```
https://www.tinyps.top/                      EN 首页（保留，默认）
https://www.tinyps.top/editor/               在线编辑器（自带 10 语言 i18n，不拆分）
https://www.tinyps.top/install.html          EN
https://www.tinyps.top/activate.html         EN
https://www.tinyps.top/support.html          EN
https://www.tinyps.top/privacy.html          EN
https://www.tinyps.top/terms.html            EN
https://www.tinyps.top/<6 个长尾页>.html      EN（首期不拆，二期可选）

https://www.tinyps.top/zh/                   ZH 首页（新增）
https://www.tinyps.top/zh/install.html       ZH（由 install-zh.html 迁入）
https://www.tinyps.top/zh/activate.html      ZH
https://www.tinyps.top/zh/support.html       ZH
https://www.tinyps.top/zh/privacy.html       ZH
https://www.tinyps.top/zh/terms.html         ZH
```

迁移成本极低：这些 URL 全部**尚未被索引**（GSC 全部 NEUTRAL、Bing UrlCount=0），
今天才提交，随时可改。

## 四、改动清单（7 步）

1. **写渲染脚本** `tools/build_i18n_home.py`：以 `_deploy/index.html` + 中英字典为单一数据源，
   产出两份静态页面（`/` 英文静态 + `/zh/` 中文静态），**避免两份内容日后走样**。
2. **ZH 首页静态化**：`/zh/` 输出纯中文 HTML（无 JS 切语言），头部加
   `hreflang zh-Hans → /zh/`、`en → /`、`x-default → /`；EN 首页加对应三条。
3. **语言切换改为真实链接**：EN 页「中文」→ `<a href="/zh/">`；ZH 页「EN」→ `<a href="/">`。
   移除 `tinyps_lang` 的 localStorage 自动切换（保留会让 /zh/ 的访客被弹回英文版）。
4. **迁移 5 个中文次级页**到 `/zh/*.html`；旧的 `/xxx-zh.html` 加 **301** 到新位置
   （这批地址今天提交过 GSC/Bing，301 比留着孤儿页干净）。
5. **nginx**：仅需两条 301（`/install-zh.html` 等 5 条）；`/zh/` 目录用现有
   `try_files $uri $uri/ =404` + `index index.html` 即可命中，**无需改 location**。
6. **sitemap 重建为 19 条**（首页 + 编辑器 + 5 EN + 5 ZH + 6 长尾），GSC `sitemaps.submit`
   与 Bing `SubmitFeed` 重新提交，`SubmitUrlBatch` + IndexNow 推送全部 URL。
7. **验证**：浏览器逐个点击校验（EN/ZH 首页各 8 个入口）、hreflang 双向检查、
   18/19 页 200 + canonical、301 生效、sitemap 合法。

## 五、风险与回滚

| 风险 | 处理 |
|---|---|
| 旧 `/xxx-zh.html` 外链失效 | 全部 301 到 `/zh/` 新址 |
| 两份首页内容日后走样 | 用同一渲染脚本从同一字典生成，不手工维护两份 |
| `/zh/` 与 `/` 内容重复被判重复 | 各自 self-canonical + 互指 hreflang + 正文语言不同 |
| 分享 `/zh/` 链接被 localStorage 弹回英文 | 第 3 步移除自动切换 |
| 改坏了 | nginx 配置与页面文件均已备份（`.bak_<时间戳>`），回滚即恢复上一版 |

## 六、预期效果与节奏

| 指标 | 现状 | 预期 |
|---|---|---|
| GSC 首页着陆页数 | 1（EN） | 2（EN + ZH 各自独立） |
| 中文查询词可见性 | 几乎为零 | 拆分后 1–2 周内开始出现曝光 |
| 可配 hreflang 的页面 | 10 个次级页 | 11 个（含首页） |

节奏：实施约 30–60 分钟；Google 重新抓取 1–3 天；中文词曝光数据通常 2–4 周后才看得出趋势
（SEO 是复利，不要指望第一周就有量）。

## 七、可选二期：中文长尾页

git 历史中 `store/cn_longtail/` 还留着 6 个中文长尾页（remove-background / offline-image-editor /
batch-image-editor / private-photo-editor / compress-images-locally / free-photo-editor）。
若一并恢复到 `/zh/`，则中文长尾词（如「批量压缩图片」「不上传去背景」）也能各自拥有着陆页，
sitemap 增至 25 条。建议首期上线后观察 2–4 周再决定，避免一次改动过大难以归因。

## 八、需要你拍板的两点

1. **是否移除语言记忆（localStorage）**：移除后回访用户每次都从英文版开始，需点一次「中文」。
   我建议移除（对 SEO 与链接分享都更干净）。
2. **是否顺带做二期（中文长尾页）**：我建议首期只做首页 + 5 组次级页，观察一段时间再决定。

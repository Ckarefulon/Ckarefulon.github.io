# vendor · 第三方库（本地存放，不走 CDN）

站点是纯静态托管（GitHub Pages + Netlify），反馈页在断网、被墙或 GitHub 本身不稳时
都必须能打开。所以第三方库一律**下载到本地**，不引 CDN。

| 目录 | 库 | 版本 | 用途 | 引入位置 |
|---|---|---|---|---|
| `marked/` | [marked](https://github.com/markedjs/marked) | 15.0.7 | 反馈详情/回复的完整 Markdown 解析（GFM：表格、任务列表、删除线、自动链接） | `feedback/index.html` |
| `dompurify/` | [DOMPurify](https://github.com/cure53/DOMPurify) | 3.2.4 | 给 marked 的输出做 XSS 消毒 | `feedback/index.html` |
| `github-markdown/` | [github-markdown-css](https://github.com/sindresorhus/github-markdown-css) | 5.8.1 | GitHub 官方的 Markdown 渲染样式（GFM），详情正文与预览共用 | `feedback/index.html` |

其余目录（`jszip` / `lucide` / `supabase` / `tailwindcss`）是各页面的既有依赖，与反馈无关。

## 更新方式

```powershell
node .tests/_fetch-vendor.mjs                          # marked / DOMPurify
node --use-system-ca .tests/build-github-markdown-css.mjs   # github-markdown.css
```

第二个脚本会**自己下载** light/dark 两份再合成，不需要中间文件。
升级版本时改脚本里的版本号，再跑一次，然后把各页面的 `?v=` 缓存版本号一起改掉。

`github-markdown.css` 是**生成产物**（`_light.css`/`_dark.css` 只是中间物，已不保留），
不要手改；改样式请改生成脚本里那几条适配规则。

## 为什么不用 CDN

沙箱里实测：`cdn.jsdelivr.net` 无法访问，`unpkg.com` 可以。依赖 CDN 等于把反馈页的
可用性绑在一个第三方域名的可达性上 —— 反馈页恰恰是「站点出问题时用来报问题」的页面，
它自己不能先挂。本地 vendor 的体积代价是 39 KB + 22 KB + 48 KB，可接受。

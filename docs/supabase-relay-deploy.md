# 部署：让浏览器不再直连 supabase.co

## 为什么需要这一步

反馈页原本由浏览器直接请求 `https://<ref>.supabase.co/functions/v1/feedback`。
问题不在 Supabase 慢 —— 实测响应 539–1607ms，很正常 —— 而是**有些网络按域名拦掉
`*.supabase.co`**：

| 探测 | 结果 |
| --- | --- |
| DNS | 正常（172.64.149.246 / 104.18.38.10） |
| TCP 443 | 通，224ms |
| TLS，带正确域名 | **ECONNRESET**，271ms |
| TLS，换成假域名 | 握手成功，739ms |

即 TCP 一连上、TLS 刚发 ClientHello 就被重置。用户看到的就是「一直转圈，
最后报网络异常」。站点静态文件能打开（那是另一个域名），所以页面本身没问题。

## 做法

浏览器只跟自己的域名说话，由服务器去连 Supabase：

```
浏览器  ──/api/sb/functions/v1/feedback──▶  你的站点（Netlify Function）
                                              │
                                              └──▶  supabase.co
```

前端默认就发 `/api/sb/…`（见 `feedback/feedback-app.js` 的 `relayBase()`）。
中继不可用时自动回退直连，所以：

- **没配中继** → 行为和以前一样（本地开发、别的平台部署都不受影响）
- **配了中继** → 被拦网络里也能用

## Netlify 侧要做的事

仓库里已经准备好了，需要你在 Netlify 控制台确认两件事：

1. **打开 Functions 支持**
   站点 → Site configuration → Build & deploy → Functions
   确认 Functions 目录是 `netlify/functions`（`netlify.toml` 里已声明，通常自动识别）。

2. **确认站点是从这个仓库自动部署的**
   如果不是（比如是手动拖文件夹），把 `netlify.toml` 和 `netlify/functions/` 一起传上去，
   或者把站点接回 Git 仓库。

改完重新部署即可，不需要设置任何环境变量（默认就去固定那个项目）。

### 可选环境变量

| 变量 | 用途 |
| --- | --- |
| `SUPABASE_PROJECT_URL` | 换目标项目地址时用；不设就用代码里的默认值 |

## 怎么确认生效

部署后打开 `https://<你的域名>/feedback/`，在开发者工具 Network 里看：

```
/api/sb/functions/v1/feedback?action=list&first=30   → 200   ← 中继在起作用
```

如果这条一直是 404、而紧接着出现一条 `https://<ref>.supabase.co/...` 的请求，
说明中继没被识别（Functions 没启用，或 `netlify.toml` 没生效），前端正在走回退。

## 安全边界（写在中继里）

中继本质是个代理，写松了等于给全站开公共出口。当前限制：

| 限制 | 说明 |
| --- | --- |
| 目标主机写死 | 只认 `SUPABASE_PROJECT_URL` 或代码里的默认项目，调用方改不了 |
| 路径白名单 | 只放行 `/functions/v1/`、`/rest/v1/`、`/auth/v1/` |
| 方法限制 | 只允许 `GET` / `POST` / `OPTIONS` |
| 拒绝路径穿越 | 含 `..` / `.` 的路径（含 `%2e%2e` 编码）一律 404 |
| 不转发敏感头 | 丢掉调用方的 `Host`、`x-forwarded-*`、`x-nf-*`、`connection` |

自检：`node .tests/sb-relay.test.js`（23 项，不联网，fetch 全程打桩）。

## 其它平台

- **Cloudflare Pages**：可把 `netlify/functions/sb-relay.js` 的逻辑搬到
  `functions/api/sb/[[path]].js`，路由用 `_routes.json` 或 `_redirects`。
- **GitHub Pages**：纯静态，跑不了后端，只能继续走直连回退（也就是现状）。

## 顺带说明：上一轮的 GitHub 镜像

`assets/services/core/github-mirror.js` 解决的是**另一件事**：用户主动点
「在 GitHub 中打开/回复」时的跳转，跟本页加载、提交无关。
两者互不依赖，可以各自独立启用或移除。

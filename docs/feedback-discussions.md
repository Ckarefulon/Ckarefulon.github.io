# 反馈广场 → GitHub Discussions

顶栏的反馈图标进入 `/feedback/` 广场：浏览、看详情、回复、新建，全程在站内，
不用去 GitHub（本机 `github.com` 被 hosts 阻断，跳过去体验很差）。

## 数据流

```
顶栏 <a href="/feedback/?new=1">  （纯图标，与主题键同尺寸）
  │
  ▼
/feedback/  广场（列表 / 详情 / 新建弹窗）
  │  GET  ?action=list   列表
  │  GET  ?action=detail 详情 + 回复
  │  POST               新建 / 回复（action=comment）
  ▼
Supabase Edge Function `feedback`
  │
  ├─→ GitHub GraphQL（Discussion 读写）
  └─→ Supabase REST（feedback_submissions，记「谁提的」）
```

GitHub 的 REST **没有**创建 Discussion 的接口，只有 GraphQL 的 `createDiscussion`，
而 GraphQL 只接受 PAT / installation token，不能放前端。所以必须服务端中转。

## 身份：GitHub 上匿名，站内可追溯

这是本方案的核心取舍。

| 位置 | 看到什么 |
| --- | --- |
| GitHub 上的讨论作者 | `你的App名[bot]` —— 站点代发，不冒用维护者身份 |
| GitHub 上其他人的作者 | 真实 GitHub 账号（别人自己发的） |
| 站内列表 / 详情 | bot 内容标「站点代发」；真人显示 `@login` |
| 站内（登录用户） | 自己提过的会标「我提的」 |
| 数据库 `feedback_submissions` | `discussion_number ↔ user_id ↔ username` |

**用户名绝不写进 GitHub 正文**。提交时函数用用户自己的 JWT 调
`/auth/v1/user` 确认是谁，再写一行 `feedback_submissions`。
GitHub 上的人只能看到一个 bot，站内却查得到来源。

游客也能提交，只是 `user_id` 为空、站内不留痕。

## 五个分类

类型固定为 `bug / feature / question / chat / others`，与 GitHub 里的分类名逐一对应。

函数按「分类 slug 或名字」不区分大小写匹配，所以你 GitHub 里建的是
`Bug` / `Feature` / `Question` / `Chat` / `Others` 就能直接对上，**不用额外配置**。

**是的，GitHub 里的 Category 要写成这五种**（名字或 slug 对上即可）。少数情况例外：

- 想用别的名字（比如把 Bug 叫「故障」）→ 配 `DISCUSSIONS_CATEGORIES`：
  ```json
  {"bug":"故障","feature":"想法"}
  ```
- 某个分类没建 → 自动落到第一个可用分类，响应里 `degraded: true`，界面会提示。

## 配置

> **所有名字都不能以 `GITHUB_` 开头。** 那是 GitHub 保留前缀，
> 在仓库 Settings 里根本建不出这种 Secret / Variable。

### 必填

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| Secret | `DISCUSSIONS_TOKEN` | PAT，Discussions 读写 |

### 强烈建议（让作者显示为 bot）

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| Secret | `APP_ID` | App 的 numeric ID |
| Secret | `APP_PRIVATE_KEY` | App 私钥（PEM） |
| Variable | `APP_INSTALLATION_ID` | 可选，省一次查询 |

配了 App 就**强制走 App**：配置出错会直接报错，不会静默退回 PAT
（否则内容会挂到维护者名下，正是要避免的事）。

### 可选

| 类型 | 名称 | 默认 |
| --- | --- | --- |
| Variable | `FEEDBACK_REPO` | `Ckarefulon/Ckarefulon.github.io` |
| Variable | `DISCUSSIONS_CATEGORIES` | 自动匹配 |

## 一步步建 GitHub App

1. GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App
2. Name 填你喜欢的（决定 bot 显示名，如 `ckarefulon-feedback` → 作者显示 `ckarefulon-feedback[bot]`）
3. Homepage URL 填 `https://ckarefulon.github.io`
4. **Webhook**：取消勾选 Active（不需要）
5. **Repository permissions** → 设 `Discussions: Read and write`，
   另设 `Metadata: Read-only`（GitHub 要求的最低项）
6. Create GitHub App → 记下 **App ID**
7. 页面下方 **Private keys** → Generate a private key，下载 `.pem`
8. **Install App** → 只选 `Ckarefulon.github.io` 这一个仓库
9. 回到仓库 Settings → Secrets and variables → Actions：
   - Secret `APP_ID` = App ID
   - Secret `APP_PRIVATE_KEY` = `.pem` 全文
   - （可选）Secret `DISCUSSIONS_TOKEN` = PAT，作为兜底

### APP_PRIVATE_KEY 怎么填

把 GitHub 下载的 `.pem` 用文本编辑器打开，**整份内容**（含
`-----BEGIN PRIVATE KEY-----` 与 `-----END PRIVATE KEY-----` 两行）粘贴进去。

函数对格式做了容错，以下都能正确识别：

- 标准多行 PEM
- Windows 换行（CRLF）
- 被转义成单行的 `\n` / `\r\n`（CI、dotenv 常见）
- 首尾带引号、带 BOM、带多余空格
- 主体里混入非 Base64 字符（会被自动清洗）

不支持的只有两种，都会给出明确提示：

| 情况 | 提示 |
| --- | --- |
| 只填了文件名 / 路径 | `无法作为 PKCS#8 私钥导入`，请粘贴全文 |
| 是 `BEGIN RSA PRIVATE KEY`（PKCS#1） | 请改用 App 页面下载的原版 `.pem`（应为 `BEGIN PRIVATE KEY`） |

> 以前这几种情况会抛 `ASN.1 DER message is incomplete: expected 1, actual 0 at DER byte 0`
> 这类底层报错，看不出该改什么。现在都会翻成上面这种能直接照做的中文提示。

配好后 push 到 main，`.github/workflows/deploy-supabase.yml` 会自动下发密钥并部署。

> 私钥是多行 PEM，粘进 GitHub Secret 时**原样粘贴**即可（换行会保留）。
> 函数里也兼容把换行写成 `\n` 的形式。

## 数据库

`supabase/migrations/20261116000001_feedback_submissions.sql` 建表 `feedback_submissions`，
随 `supabase db push` 自动应用，RLS 设为：

- 本人可读自己的记录
- 本人可插入
- 不允许客户端 UPDATE / DELETE（历史不可篡改）

## 加速设计

| 手段 | 效果 |
| --- | --- |
| 进页立刻预热（`GET` 无 action） | 冷启动 + 分类解析挪到用户浏览时 |
| 首次聚焦输入框再补一次 | 命中浏览器缓存 |
| 函数内缓存 repositoryId / categoryId（10 分钟） | 提交只发一条 `createDiscussion` |
| `Access-Control-Max-Age: 7200` | 预检缓存 2 小时 |
| 函数零外部依赖（不用 esm.sh / supabase-js） | 冷启动更短；Supabase 走 REST 直连 |

## 防滥用（函数内置）

- 读：每 IP 每分钟 90 次；写：每分钟 5 次
- 同标题+正文 10 分钟内不重复建；同回复不重复发
- 隐藏蜜罐字段 `hp`，被填写则静默丢弃
- 正文 4–8000 字

## 自检

```bash
# 函数逻辑（43 项，不联网，GitHub/Supabase 都是桩）
node .tests/feedback-function.test.js

# 真实 HTTP 端到端（5 项）：起一个真服务当 Edge Function，让浏览器真的发请求。
# 专抓「路径写错 → 404」「预检失败」这类只有真网络才暴露的问题。
TEST_CDP_PORT=9337 node .tests/feedback-http.test.js

# 广场交互（25 项：图标→自动新建→列表→详情→回复→JWT）
#   先起调试浏览器：
#   msedge --headless=new --remote-debugging-port=9337 --user-data-dir=%TEMP%\edge-fb about:blank
TEST_CDP_PORT=9337 node .tests/feedback-page.test.js

# 全站 22 页冒烟：图标链接都在、都能跳到 /feedback/
TEST_CDP_PORT=9337 node .tests/feedback-sitewide.test.js
```

截图与结果在 `.tests/feedback-shots/`。

## 踩过的坑

**函数名必须和前端请求路径一致。** 函数目录名就是 URL 里的函数名：
`supabase/functions/feedback/` → `/functions/v1/feedback`。
曾经目录叫 `feedback-submit` 而前端请求 `/functions/v1/feedback`，结果 OPTIONS 直接 404，
真实请求根本没发出去。`feedback-http.test.js` 就是为了守住这一点。

**`if:` 里不能引用 `secrets`。** GitHub Actions 不允许
（见 [官方说明](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)），
写成 `if: ${{ secrets.X != '' }}` 会导致 workflow 校验失败或该步骤永远跳过。
正确做法是在 job 级 `env` 里先求值成布尔字符串，`if` 只读那个 env。

**Secret / Variable 名不能以 `GITHUB_` 开头。** 那是 GitHub 保留前缀，
在仓库 Settings 里根本建不出这种名字。

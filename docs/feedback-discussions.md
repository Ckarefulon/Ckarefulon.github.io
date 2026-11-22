# 反馈广场 → GitHub Discussions

顶栏的反馈图标进入 `/feedback/` 广场：浏览、看详情、回复、新建，全程在站内，
不用去 GitHub（本机 `github.com` 被 hosts 阻断，跳过去体验很差）。

## 数据流

```
顶栏 <a href="/feedback/?new=1&from=%2F当前页%2F">  （纯图标，与主题键同尺寸）
  │   href 由 nav.js 就地拼好：把「从哪一页点进来的」写进 ?from=
  ▼
/feedback/  广场（列表 / 详情 / 新建弹窗）
  │  GET  /api/sb/functions/v1/feedback?action=list    列表
  │  GET  /api/sb/functions/v1/feedback?action=detail  详情 + 回复
  │  POST /api/sb/functions/v1/feedback                新建（title / body / page）/ 回复
  ▼
同源中继（Netlify Function，见 docs/supabase-relay-deploy.md）
  │  浏览器只跟自己的域名说话；中继不可用时前端自动回退直连
  ▼
Supabase Edge Function `feedback`
  │
  ├─→ GitHub GraphQL（Discussion 读写）
  └─→ Supabase REST（feedback_submissions，记「谁提的」+「从哪一页提的」）
```

## 标题

讨论必须有标题（GitHub 的 `createDiscussion` 不接受空标题）。两档来源：

| 情形 | 最终标题 |
| --- | --- |
| 用户填了标题 | `[Bug] 用户写的标题`（自己已写 `[xxx]` 前缀则不重复加） |
| 留空 | `[Bug] 正文第一行`（超 60 字截断加 `…`） |

标题和正文互补：**只填了其中一个也能提交**，另一个自动补齐（只填标题时正文
就用标题内容）。两者都空才拒。`completeTitleBody()` 在函数端与前端各有一份，
`buildTitle()` 逐字同口径，所以提交成功后列表里立刻插入的那条不会「跳字」。
响应里的 `title` 就是最终标题。

## 来源页面（from）

**从 21.12.2765 起，来源页面写在 GitHub 正文最上面**（issue #18）：
一条反馈「在哪一页出的问题」比什么都重要，正文第一段就是它。
站内详情页把它单独摆在标题下方，正文里不再重复。

从哪一页点顶栏反馈图标进来，那一页的路径会自动填进「来源页面」：

1. `nav.js` 在**每一页**把 `#siteFeedbackBtn` 的 href 就地改成
   `/feedback/?new=1&from=<encodeURIComponent(路径)>`。仍是普通链接 ——
   右键新标签、复制链接、中键打开都照旧可用（不改成 JS 跳转）。
2. **口径就是浏览器地址栏里那条路径**：大小写原样保留，`/Tools/KGenesis/` 就是
   `/Tools/KGenesis/`，绝不做任何自动小写或按登记表改名。唯一的归一化是
   `/xxx/index.html` → `/xxx/`（与 `.htaccess` 的 301 一致）。
3. 反馈页读 `?from=`，读不到就退回 `document.referrer`（同源、且不是 `/feedback/` 才认）。
4. 结果写进 `#fbPage` 输入框（**只填空值**，不覆盖用户改过的内容），并缓存进
   localStorage 30 分钟 —— 刷新或换标签草稿还在时来源不丢。
5. 提交时作为 `page` 字段上传：函数同时写进 `feedback_submissions.page`
   **和 GitHub 正文开头的 `**来源页面**：` 一行**。

在广场上点「新建」，来源就是 `/feedback/`。只记路径，`?query` / `#hash` 会被丢掉。

## 一并提交什么（issue #18）

新建表单多了「一并提交」勾选区，用户自己决定哪些环境信息跟着走：

| 勾选项 | 内容 |
| --- | --- |
| 视口与屏幕 | `视口: 1200x800 @dpr 1.5（屏幕 2560x1440）` |
| 浏览器标识 | `UA: …` 与 `语言: …` |
| 完整页面地址 | `页面: https://…` |
| 当前主题 | `主题: dark` |
| 来源网址 | `来源: <document.referrer>` |

默认勾前三项。**一项都不勾，正文里连「环境信息」折叠块都不会出现** ——
不是留个空块。勾法会跟草稿一起存，点「恢复上次内容」连勾选状态一起回来；
但每次新开弹窗都复位成默认。

## 图片附件（issue #11）

新建和编辑都能带图，最多 4 张、单张 10 MB，格式限 **PNG / JPEG / GIF / WebP**。
可以点「选择图片」，也可以直接把图拖进弹窗。

图片存在 **GitHub 自己的附件通道**上，和你在网页里往 Discussion 拖一张图完全一样，
不占 Supabase 存储、不用建桶。正文里落成普通的 `![名字](url)`。

### 为什么用的是未文档化端点

GitHub 至今没有公开「给 issue / PR / discussion 上传附件」的 REST 或 GraphQL API
（社区提了近六年，官方标 not planned）。网页拖图走的是：

```
POST https://uploads.github.com/user-attachments/assets
     ?repository_id=<数字 id>&name=<文件名>&content_type=<MIME>
```

实测（2026-11-22，本机跑通）的几条边界：

| 事实 | 影响 |
| --- | --- |
| App installation token 与 PAT 都能用 | 不需要浏览器 cookie |
| 只认 png / jpeg / gif / webp | SVG、PDF、txt 全部 422，前端也一并拦掉 |
| **资源在被帖子引用之前是 404** | 所以顺序必须是「先上传 → 再创建/编辑帖子」，反了会得到死链 |
| 引用之后变成 302 → S3 CDN | 这就是正常状态，不是出错 |
| 单张上限 10 MB | 前端先校验，不用等服务端 422 |
| 上传不可撤销、资源无法删除 | 只在正文定稿时才传 |

**因为这个端点没文档，所以它随时可能变。** 代码里的应对是：上传失败**不阻断提交** ——
正文照发，只把「第 N 张图没能上传（原因）」如实回给前端。用户那段字不能因为图而丢掉。

### 图片在正文里的位置

`buildBody` 里图片排在**正文之后、环境信息之前**。这个顺序不能改：
前端详情页的 `stripMeta` 是在 `> 由站点反馈广场提交` 那一行截断的，
图排在签名之后会被当成附加信息整段剥掉，详情页里一张也看不见。

### 一个取舍

图片只在内存里，**不进 localStorage**。base64 动辄几 MB，塞进草稿会直接把存储配额打爆。
所以「恢复上次内容」不恢复图片 —— 这是有意的，不是漏了。

## 帖子操作与互动（issue #33）

详情页对维护者显示「编辑 / 关闭（或重新打开）/ 删除」，帖子和每条回复下面各有一排表情。

| 操作 | GraphQL | 备注 |
| --- | --- | --- |
| 编辑 | `updateDiscussion` | 就地展开编辑框，标题与正文分开改 |
| 关闭 / 重新打开 | `closeDiscussion` / `reopenDiscussion` | 关闭原因固定 `RESOLVED` |
| 删除 | `deleteDiscussion` | 前端二次确认，后端也强制要求 `confirm:true` |
| 表情 | `addReaction` / `removeReaction` | 七种，同一图标再点一次即取消 |

### 「支持（upvote）」为什么没做

GitHub 的 `addUpvote` **按凭证类型拒绝**：只要是以 GitHub App 或 token 身份发起的，
一律 `FORBIDDEN`（Resource not accessible by integration），没有任何权限能解锁，
换成 user-to-server token 也一样。只有真人用浏览器点那个箭头才有效。

所以这里不做 upvote，只做表情。按用户要求，表情按钮**只显示图标本身，图标上不叠文字**。
`upvoteCount` 仍然读得到，但它是个改不动的数字 —— 别把它做成按钮。

### canManage 为什么由后端给

前端**不能**拿站点用户名去比 GitHub 登录名：`user_profiles.username` 与 GitHub 账号名
没有强绑定，比不中按钮就永远不出现。所以详情接口在服务端验完 JWT 后直接回一个
`canManage` 布尔值，前端只照着显隐。

它只是 UI 开关，不是安全边界 —— 真正的写权限在 token 那侧，函数里每个写动作都要过
`resolveIdentity()`。副作用：详情响应因此改成 `Cache-Control: private`（按人变化，不能公共缓存）。

## 弹窗的几个易错细节

- **关闭叉必须贴在右上角**。它靠 `.fbModalTitle { margin-right: auto }` 把位置顶开，
  **不能**让 `.fbRestoreBtn` 用 `margin-right: auto` 顶：那个按钮没草稿时是
  `hidden`（`display:none`），一旦它不在，关闭叉就会被挤到标题旁边、看着像居左。
- **提交提示不能跨表单残留**。每次开/关弹窗都把 `modalSession` 加一，提交回调回来时
  对不上号就丢弃结果。否则「先点提交、在请求还没回来时关掉弹窗、再打开一份新表单」，
  旧请求返回后会把「已提交，谢谢！」写进新表单（提示还会带着「查看讨论 #N」链接）。

## 首屏加载与筛选（issue #37 / #39）

- 首屏请求 **20 条**，「加载更多」也是每次 20 条。
- 状态筛选收在类型胶囊**最前面的一个下拉框**里（六项横铺一屏太占地方）：
  按钮文字会写成「状态 3/6」这样，让人知道正被过滤。
  默认勾「已反馈 / 已跟进 / 已计划」，「已完成 / 重复 / 不计划」不勾，
  也就是默认只看没了结的。点外面或按 Esc 收起。
- **筛选后一条都没有、但后面还有没拉过的讨论时，自动再翻几页**（上限 4 页），
  免得用户对着空列表以为真没有。
- ⚠️ **后端没返回 `state` 时（旧函数版本）状态筛选整体失效**，不会把列表清空 ——
  以前缺值被当成「已反馈」，既会误标，也会让已关闭的被筛掉。

## 跟进状态（issue #37）

状态由 Edge Function 算（只有它能读到评论作者），前端只负责显示与筛选。
判定顺序就写在一个函数 `followState()` 里：

| 状态 | 条件 |
| --- | --- |
| `complete` | 讨论已关闭，关闭原因 `RESOLVED`（或没给原因） |
| `duplicate` | 讨论已关闭，关闭原因 `DUPLICATE` |
| `not_planned` | 讨论已关闭，关闭原因 `OUTDATED` |
| `planned` | 未关闭，且维护者留言里有「已链接到 Issue」 |
| `followed` | 未关闭，维护者发过言 |
| `open` | 其余 |

**关闭优先于评论**：关闭后自动留言里本身就带维护者名字，若先看评论会把状态骗成「已跟进」。

「已链接到 Issue」的判定与 `.github/workflows/discussion-issue-link.yml` 的留言
格式一致（`已链接到 Issue #N`）。列表里每条只读前 50 条评论 —— 真到 50 条以上的
讨论极少，为它把所有评论翻一遍不值得。

> **改了这一块记得 `supabase functions deploy feedback`。**
> 前端会看列表里有没有 `state` 字段：没有就认为后端还是旧版，状态标签与筛选都退让
> （不画标签、不过滤），不会假装成「已反馈」。所以函数没部署时页面不会全空，
> 但也看不到真实状态 —— 这一步必须走部署。

## 维护者 / 管理员（issue #38）

维护者登录名由后端下发（`maintainer` 字段），默认 `Ckarefulon`，可用
`FEEDBACK_MAINTAINER` 改。前端据此：

- 在他名字后面加「管理员」标签；
- 用同一个名字判断「已跟进 / 已计划」。

两边共用同一个来源，不各写一份。


> **为什么要有中继**：部分网络按域名拦 `*.supabase.co`（TCP 通、TLS 带正确 SNI
> 立刻被 RST），浏览器直连只会转圈到超时。把请求改成同源、由服务器去连就绕开了。
> 实测 Supabase 本身不慢（539–1607ms），所以这不是性能问题。

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
| 数据库 `feedback_submissions` | `discussion_number ↔ user_id ↔ username ↔ page` |

**用户名绝不写进 GitHub 正文**。提交时函数用用户自己的 JWT 调
`/auth/v1/user` 确认是谁，再写一行 `feedback_submissions`。
GitHub 上的人只能看到一个 bot，站内却查得到来源。

游客也能提交，只是 `user_id` 为空、站内不留痕。

## 五个分类

类型固定为 `bug / feature / question / chat / others`，与 GitHub 里的分类名逐一对应。

**界面上默认选中 Bug**，函数侧在 `type` 缺失或写了不认识的值时也按 `bug` 处理。
（以前默认 Others —— 大多数人提的都是「哪里坏了」，落到 Others 里就没人看了。）

函数按「分类 slug 或名字」不区分大小写匹配，所以你 GitHub 里建的是
`Bug` / `Feature` / `Question` / `Chat` / `Others` 就能直接对上，**不用额外配置**。

**是的，GitHub 里的 Category 要写成这五种**（名字或 slug 对上即可）。少数情况例外：

- 想用别的名字（比如把 Bug 叫「故障」）→ 配 `DISCUSSIONS_CATEGORIES`：
  ```json
  {"bug":"故障","feature":"想法"}
  ```
- 某个分类没建 → 自动落到第一个可用分类，响应里 `degraded: true`，界面会提示。

## Markdown 渲染（issue #32）

详情页与回复都用**完整 GFM**解析，口径对齐 GitHub：标题、有序/无序/嵌套列表、任务列表、
引用、表格、代码块（带语言）、行内代码、粗体/斜体/删除线、图片、链接、分隔线。

实现是本地引入的两个库，**不走 CDN**：

| 库 | 版本 | 位置 | 职责 |
| --- | --- | --- | --- |
| marked | 15.0.7 | `assets/vendor/marked/` | 语法解析（GFM） |
| DOMPurify | 3.2.4 | `assets/vendor/dompurify/` | XSS 消毒 |

几个必须知道的细节：

- **为什么不用 CDN**：反馈页恰恰是「站点出问题时用来报问题」的页面，不能把它的可用性
  绑在第三方域名的可达性上。体积代价 39 KB + 22 KB。
- **任务列表的勾选框**：marked 输出 `<input type=checkbox disabled>`。DOMPurify 默认会
  把 `input` 当危险标签删掉 —— 那样 `- [x] 已完成` 只剩一个空格。所以 `FORBID_TAGS`
  里**故意不写 `input`**，改用 `uponSanitizeElement` 钩子把 input 限死成「禁用勾选框」，
  其它类型的 input（文本框、提交按钮）仍然当场删除。
- **marked v15 不再给任务项加 `task-list-item` 类**，CSS 只能用 `li:has(> input[type="checkbox"])`
  定位；老类名的规则保留着，给不支持 `:has` 的老浏览器兜底。
- **代码块是裸 `<pre><code>`**，不带任何类名。老的手写实现用的是 `.fbCode`，
  只写 `.fbCode` 会让新解析器下的代码块完全没有背景和边框 —— 所以 `.fbPostBody pre`
  这一层必须给样式。
- **表格要压掉站点全局样式**：全局给 `table` 设了 `min-width:680px` 和 sticky 表头，
  Markdown 表格不改就会在窄屏整段横向溢出。规则里 `min-width:0` + `display:block` 覆盖掉。
- **库没加载成功时**自动退回旧的极简渲染（只认粗体/行内代码/代码块/链接），
  宁可少渲染也不能把整页打挂。

自检钩子：`window.__fbMarkdown(text)`（正式渲染）与 `window.__fbMarkdownFallback(text)`。

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
| Variable | `FEEDBACK_MAINTAINER` | `Ckarefulon` |
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

把 GitHub 下载的 `.pem` 用文本编辑器打开，**整份内容**粘贴进去即可，包含首尾
`-----BEGIN …-----` / `-----END …-----` 两行。

**两种私钥格式都支持**，不用手动转换：

| 格式 | 首行 | 说明 |
| --- | --- | --- |
| PKCS#8 | `-----BEGIN PRIVATE KEY-----` | 常见 |
| PKCS#1 | `-----BEGIN RSA PRIVATE KEY-----` | 同样可用 |

PKCS#1 在函数里会自动包一层 PKCS#8 头再签名（DER 包装是逐字节等价的，
有测试用公钥验签并比对包装结果与原生 PKCS#8 完全一致）。
2048 / 3072 / 4096 位都验证过。

其他格式容错也都做了：

- 标准多行 PEM
- Windows 换行（CRLF）
- 被转义成单行的 `\n` / `\r\n`（CI、dotenv 常见）
- 首尾带引号、带 BOM、带多余空格
- 主体里混入非 Base64 字符（会被自动清洗）

只有这两种会给出提示：

| 情况 | 提示 |
| --- | --- |
| 只填了文件名 / 路径 | `无法作为 RSA 私钥导入`，请粘贴全文 |
| 内容被截断 | `Base64 部分无法解码`，请确认是完整 `.pem` |

> 以前这些情况会抛 `ASN.1 DER message is incomplete: expected 1, actual 0 at DER byte 0`
> 这类底层报错，看不出该改什么。现在都会翻成能直接照做的中文提示。

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

实测瓶颈：列表请求 TTFB 830–1190ms，**响应体只有 0–1ms** —— 时间几乎全花在
Edge Function 现场去 `api.github.com/graphql` 往返。

| 手段 | 效果 |
| --- | --- |
| 进页立刻预热（`GET` 无 action） | 冷启动 + 分类解析挪到用户浏览时 |
| **首屏只拉 7 条**（之后每批 20 条） | 一进页面不用等三十条渲染完 |
| 列表 30 秒内存缓存（仅游客第一页） | 反复进出页面不再打 GitHub |
| 列表/详情 `Cache-Control` | 浏览器再省一趟（回退/前进不用重新拉） |
| 函数内缓存 repositoryId / categoryId（10 分钟） | 提交只发一条 `createDiscussion` |
| `Access-Control-Max-Age: 7200` | 预检缓存 2 小时 |
| 函数零外部依赖（不用 esm.sh / supabase-js） | 冷启动更短；Supabase 走 REST 直连 |

缓存不套用的情形：已登录用户（要看「我提的」标记）、翻页、所有写操作。

## 防滥用（函数内置）

- 读：每 IP 每分钟 90 次；写：每分钟 5 次
- 同标题+正文 10 分钟内不重复建；同回复不重复发
- 隐藏蜜罐字段 `hp`，被填写则静默丢弃
- 正文 4–8000 字

## 自检

```bash
# 函数逻辑（86 项，不联网，GitHub/Supabase 都是桩）：
#   含「标题优先用用户填的 / 留空退回首行 / 只有一个就互相补」
#       「来源页面写在正文最上面」「六种跟进状态」「维护者可配置」
#       「type 缺省为 bug」「编辑/关闭/重开/删除/表情」「图片上传与失败降级」
node .tests/feedback-function.test.js

# 同源中继（23 项，不联网，fetch 打桩）：白名单、方法限制、路径穿越、失败回退信号
node .tests/sb-relay.test.js

# 真实 HTTP 端到端（5 项）：起一个真服务当 Edge Function，让浏览器真的发请求。
# 专抓「路径写错 → 404」「预检失败」这类只有真网络才暴露的问题。
TEST_CDP_PORT=9337 node .tests/feedback-http.test.js

# 广场交互（含首屏 20 条 / 状态标签与筛选 / 管理员标签 / 标签列对齐 /
#   窄屏图标 / 附带项勾选 / 标题正文互补 / Markdown 库与消毒）：
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

**多行私钥千万别用 `while read <<EOF` 批量下发。**
这是最难发现的一个坑：按行读 heredoc 时，`APP_PRIVATE_KEY` 这种多行 PEM 会被拆散 ——

```bash
# ❌ 错的：只会下发第一行 "-----BEGIN PRIVATE KEY-----"，主体全丢
while IFS='=' read -r key value; do
  supabase secrets set --yes "$key=$value"
done <<EOF
APP_PRIVATE_KEY=$APP_PRIVATE_KEY
EOF

# ✓ 对的：每个键单独调用，值用引号原样传
supabase secrets set --yes "APP_PRIVATE_KEY=$APP_PRIVATE_KEY"
```

症状是：Secret 在仓库里明明填得完全正确，函数却报「私钥为空或无法识别」。
workflow 现在改成逐键单独下发，并在下发后**校验私钥是否含 BEGIN/END 两行**，
不完整就直接让这一步失败，不必等到用户点反馈才发现。

已经下发过坏值的话，删掉再走一次：

```bash
supabase secrets unset --yes APP_PRIVATE_KEY
# 然后重新跑 workflow，或手动
supabase secrets set --yes "APP_PRIVATE_KEY=$(cat your-app.private-key.pem)"
```

# 云同步数据丢失/覆盖：成因与整改方案

> 状态：**地基已落地，Study/Focus 已作为样板接入**
> 涉及表：`public.user_data`、`public.user_data_history`（新增）
> 涉及前端：`assets/services/sync/sync-core.js`（新增）、`Study/Focus/focus-sync.js`（新增）

---

## 一、先说结论

你说的「逻辑混乱、容易丢、容易被覆盖」不是错觉，是**结构性缺陷**，能定位到 6 个具体成因。其中第 1 条最致命，能单独解释「数据莫名变成别的站点的数据 / 变成空」这类事故。

整改方向不是「再修一次上传逻辑」，而是**换掉那套逻辑本身**：

- 写入从「整份盲写」改成「带版本号的乐观并发（CAS）」
- 冲突从「后写者赢」改成「合并或拒绝」
- 事故从「不可恢复」改成「服务端自动历史 + 一键恢复」
- 全局从「最后加载者赢」改成「唯一内核 + 各站点声明式注册」

---

## 二、6 个根本成因（逐条对应代码位置）

### 成因 1（致命）`window.cloudSyncManager` 是「最后加载者赢」的全局变量

四份互相独立、**数据模型完全不同**的实现都在往同一个全局上赋值：

| 文件 | 读写的本地 key | 行 |
|---|---|---|
| `assets/services/sync/cloud-sync-manager.js` | `cube_memory_progress`、`smartCubePracticeStats` | 426 |
| `Cube/Analyzer/analyzer-cloud.js` | `cubeAnalyzerDataV2`、`cubeAnalyzerSettingsV2` | 320 |
| `Study/Merit/merit-store.js` | `merit` | 758 |
| `Tools/Relay/relay-app.js` | `relay_text`、`relay_*` | 208 |

而 `nav/nav.js` 的手动「上传 / 下载」按钮**只认这一个全局**：

```js
// nav/nav.js:1216
window.cloudSyncManager.uploadLocalToCloud().then(...)
```

**后果**：`uploadLocalToCloud()` 内部会调它自己的 `buildLocalPayload()`，按它自己那套 key 读数据，但 `site_scope` 用的是**当前页面**的作用域。

所以在 `/Study/Merit/` 或 `/Cube/Analyzer/` 这类页面上点「上传」：
- 如果当时代码里挂的是 Cube 那份实现 → 它读 `cube_memory_progress`（在这页是空的）→ 以 `site_scope = Study-Merit` 上传
- 结果：**把 Cube 的表单结构写进了 Merit 的云端行**，Merit 真正的数据被整份覆盖

这就是「数据丢失/覆盖」最直接、最隐蔽的来源。而且它不报错，用户只看到「上传成功」。

### 成因 2 全部是整份盲写，没有任何版本号

所有写入都是同一个模式：

```js
.from('user_data').upsert({ user_id, site_scope, data: 整份, updated_at }, { onConflict: 'user_id,site_scope' })
```

没有 `rev`、没有 `if-match`、没有 CAS。两个标签页 / 两台设备同时改，**后写者的整份数据把先写者整份抹掉**。先写者的那部分改动永久消失，云端也没有任何历史可回退。

### 成因 3 `updated_at` 由客户端时钟赋值

```js
updated_at: new Date().toISOString()
```

设备时间不准，写进去的时间就是错的，所有「谁更新」的判断全部失真。而且这个字段本该由服务端裁决。

### 成因 4 「本地为空就上传空」会静默清空云端备份

`assets/services/sync/cloud-sync-manager.js` 的 `scheduleUpload`：

```js
// 本地为空：警示后照常上传 —— 用户可能有意清空本地数据，覆盖权在用户
var warn = (...) ? "本地暂无数据，已按本地上传并覆盖云端备份" : "";
proceed(warn);
```

**只弹一句 Warning 就照传**。触发条件非常容易命中：
- 页面刚打开、数据尚未水合完成
- 换设备后本地确实为空
- 用户误点「清空」

一次自动保存就能把云端备份抹成空。

### 成因 5 覆盖前快照是「单份 + 只在本机」

`nav/nav.js` 的 `prepareLocalOverwrite` 把快照写进 `localStorage` 的**单一固定键**：

```js
var PRE_OVERWRITE_PREFIX = "__siteNav_preOverwrite_v1:";
```

- 下一次覆盖会把上一次快照顶掉 → 只存得下一次
- 换设备完全无效（快照在本机）
- 配额满时直接放弃覆盖（这点是对的，但也说明它很脆弱）

### 成因 6 四套不同的脏标记 / 自动上传时序，且没有跨标签页互斥

各站点各自包装 `storageManager.setJson`、各自防抖、各自维护 `cloudDataDirty` 标志。没有任何跨标签页协调。开着两个标签页时，两边的自动保存会互相覆盖。

---

## 三、整改方案

### 3.1 数据层（已有迁移脚本）

`supabase/migrations/20261115000001_user_data_sync_hardening.sql`

| 能力 | 实现 |
|---|---|
| 版本号 | `user_data.rev`，**服务端触发器自增**，客户端永远不写 |
| 服务端时间 | `updated_at` 由 `BEFORE` 触发器强制 `now()`，客户端传什么都覆盖掉 |
| 内容指纹 | `data_hash` 由触发器算 `md5(data::text)`，用于「无需下载即可判断变没变」 |
| 自动历史 | `AFTER` 触发器把每次**真实内容变化**写入 `user_data_history`，按 hash 去重 |
| 历史配额保护 | 单份 >2MB 只留 4 份，否则留 12 份，自动清理最旧的 |
| 乐观并发 | `user_data_save(scope, data, expected_rev, ...)`：rev 不符 → 返回 `conflict` + 云端现状，**不写** |
| 轻量状态 | `user_data_get(scope, with_data)`：只返回 `rev/hash/bytes`，几百字节 |
| 历史入口 | `user_data_history_list` / `user_data_history_get` / `user_data_history_restore` |

**关键设计**：触发器是表级的，所以**即使前端还没改造，旧代码的写入也会自动获得版本号和历史**。故障窗口在迁移执行的那一刻就被关上了。

### 3.2 前端层：唯一内核 `sync-core.js`

一台服务器上只放一个同步实现。各站点不再自己发包，而是**声明自己怎么读写**：

```js
SyncCore.registerProfile('Study-Focus', {
  buildPayload()      { /* 读本地，返回 { data: {...} } */ },
  applyPayload(block) { /* 写回本地 + 重绘 */ },
  isEmpty(block)      { /* 可选：什么叫「空」 */ },
  merge(local, cloud) { /* 可选：冲突时怎么并集，强烈建议提供 */ },
});
```

内核负责的四件事：

1. **空闸门（硬拦截）**
   本地判空 + 云端有内容 → 直接拒绝，返回 `blocked`。
   要清空必须显式 `allowEmpty: true`（由用户操作触发），**自动保存永远不可能是空的**。

2. **CAS 写入 + 冲突合并**
   `save()` 带 `expected_rev`；服务端返回 `conflict` 时：
   - 有 `merge` → 解开云端那份、与本机合并、用云端最新 rev 重试（最多 3 次）
   - 无 `merge` → **直接拒绝并告知用户**，绝不用本地盖掉对方的改动

3. **跨标签页互斥**
   `navigator.locks` 按 scope 加独占锁，同一时刻只有一个标签页能写；不支持的老浏览器退化为仅靠 CAS，不会更糟。

4. **写前快照**
   本地 3 份环形快照（`localStorage`，配额满静默降级）+ 云端 12 份历史，互为兜底。

### 3.3 全局变量治理

旧代码 `window.cloudSyncManager = xxx` 的赋值被 `defineProperty` 拦截：

- 当前站点**已注册 profile** → 旧实现被彻底绕开，存进 `__cloudSyncManagerLegacy`，`console.info` 提示一次
- 当前站点**未注册 profile** → 保持旧实现可用，改造可以一站一站来，不用大爆炸式切换
- 未注册时门面返回 `null` → nav 按钮显示「未就绪」，**不会再去跑一份读错 key 的实现**

---

## 四、剩下的工作：按站点接入

地基已完成，剩下的都是「照着样板填 profile」。优先级按数据敏感度排：

| 优先级 | 站点 | scope | 关键点 |
|---|---|---|---|
| ✅ 已完成 | Study/Focus | `Study-Focus` | 样板，含并集合并 |
| P0 | Cube/Formula、Classic | `Cube-Formula` | 数据量大、有压缩壳，必须实现 `merge` |
| P0 | Cube/Analyzer | `Cube-Analyzer` | 已有 `recoverMissingFromCloud` 思路，直接接进来 |
| P1 | Study/Merit | `Study-Merit` | 已有 `mergeCloud`，映射成 profile.merge 即可 |
| P1 | Study/Timer、Question | `Study-Timer` / `Study-Question` | 已有 mut 合并逻辑，照抄 |
| P2 | Tools/Relay | `Tools-Relay` | 纯文本，用「取更新时间晚的」策略 |
| P2 | Cube/Cross | `Cube-Cross` | 按 `mut` 合并 |
| P3 | Tools/Pulse | `Tools-Pulse` | 已走 Edge Function，需单独评估 |

每个站点的接入模板（以 Focus 为参照）：

1. 页面 `index.html` 在 `auth-manager.js` 之后加 `sync-core.js`
2. 页面 `index.html` 在业务脚本之后加一个 `<site>-sync.js`
3. 业务脚本末尾暴露「内存真相源」与「重绘入口」
4. `<site>-sync.js` 里 `registerProfile`，把旧的 `push/pull` 重定向到 `SyncCore`

---

## 五、需要你在 Supabase 控制台做的事

迁移脚本已写好，需要执行一次。**两种方式选一**：

### 方式 A：命令行（推荐，可复现）

```bash
cd <仓库根>
supabase db push
```

### 方式 B：网页控制台（图形界面最省事）

1. 打开 https://supabase.com/dashboard/project/sekbhrzxblaxvgspyjxa/sql/new
2. 把 `supabase/migrations/20261115000001_user_data_sync_hardening.sql` 全文粘进去
3. 点 **Run**

脚本是幂等的（`IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS`），重复执行安全。

执行后自检两条 SQL，确认触发器装上了：

```sql
select tgname from pg_trigger where tgrelid = 'public.user_data'::regclass and not tgisinternal;

select proname from pg_proc
where proname in ('user_data_save','user_data_get','user_data_history_list',
                  'user_data_history_get','user_data_history_restore');
```

预期：第一条返回 `trg_user_data_before_write` 与 `trg_user_data_after_write`；第二条返回 5 行。

> ⚠️ 迁移执行前，`sync-core.js` 会检测到 RPC 不存在并**自动降级**到旧的直连 upsert（仍带 `site_scope`，不会串站点，但没有版本保护）。所以：**先执行迁移，保护才生效。**

---

## 六、怎么验证真的不丢了

### 自动化（已通过 19/19）

```bash
node .tests/sync-core-test.js
```

覆盖：空闸门、CAS 冲突合并、无合并策略时拒绝覆盖、门面隔离、旧实现抢赋值被拒、压缩壳解包、迁移缺失时的降级。

### 手工复现（浏览器）

1. 打开 `/Study/Focus/`，随便记两条自习
2. 复制该标签页的 URL，开第二个标签页
3. 在两个标签页里各记一条不同的记录
4. 回第一个标签页，等自动保存
5. 刷新两个页面 → **两条记录都应该在**

改造前的表现：只剩一条，另一条永久消失。

### 事故后恢复

```js
// 控制台
await SyncCore.history(20)          // 列出最近 20 个云端历史点
await SyncCore.restoreHistory(id)   // 恢复到指定历史点
```

---

## 七、变更清单

**新增**
- `supabase/migrations/20261115000001_user_data_sync_hardening.sql`
- `assets/services/sync/sync-core.js`
- `Study/Focus/focus-sync.js`
- `.tests/sync-core-test.js`
- `docs/cloud-sync-architecture.md`（本文）

**修改**
- `Study/Focus/index.html` — 引入 `sync-core.js` 与 `focus-sync.js`
- `Study/Focus/focus-app.js` — 末尾暴露 `__focusData` / `__focusRerender`，同步职责移出

**未修改**（保持原样，改造期间照常工作）
- `nav/nav.js`、`assets/services/sync/cloud-sync-manager.js`
- `Cube/Analyzer/analyzer-cloud.js`、`Study/Merit/merit-store.js`、`Tools/Relay/relay-app.js`
- 其余站点页面

之所以不一次性全改：`nav.js` 的手动按钮是各站点共用入口，大幅改动风险高。当前做法是「新内核接管已接入站点，旧实现服务未接入站点」，两者通过 `defineProperty` 严格隔离，可以逐个站点验证、逐步推进。

# 公式与案例数据（Cube/algs）

`Cube/algs/` 是**全站唯一的数据源**：公式和案例状态都在这里，Cube 下各页面共用。

```
Cube/algs/
├─ index.json      库清单（每个库一行：id / name / desc / group / count）
├─ oll.json        OLL 57 条
├─ pll.json        PLL 21 条（含换位箭头）
├─ cmll.json       CMLL 42 条
└─ …               共 134 个库
```

## index.json

```json
{
  "_schema": { "version": 1, "notation": {...}, "caseData": {...} },
  "libraries": [
    { "id": "oll", "name": "OLL", "desc": "顶面定向", "group": "CFOP", "count": 57 }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 库标识，**同时就是文件名**（`oll` → `oll.json`） |
| `name` | 显示名 |
| `desc` | 一句短说明，显示在名称后面（如「顶面定向」） |
| `group` | 归组（CFOP / Roux / COLL / ELL / VLS / F2L / 1LLL / OLLCP / ZBLL / Other） |
| `count` | 条数，列表还没展开时用它显示总数 |

## 库文件

```json
{
  "id": "pll",
  "name": "PLL",
  "desc": "顶层排列",
  "cases": [
    {
      "name": "Aa",
      "alg": "x R' U R' D2 R U' R' D2 R2 x'",
      "faces": "yyyyyyyyyobobbbbbbggbggggggbrrrrrrrrrogoooooo",
      "arrows": ["U0>U2", "U2>U8", "U8>U0"]
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `alg` | **复原公式**（解掉该案例）。手写公式优先，其余由原始打乱公式取逆得到 |
| `faces` | 45 字符串，按 `faceOrder`（U/B/F/L/R）每面 9 格，行优先。**由公式真实算出**，保证图与公式一致 |
| `arrows` | **只有 PLL 有**。`"U0>U2"` 单向、`"U1<>U7"` 双头；`U0..U8` = 顶面九格的行优先编号 |

### faces 的三种口径

| 库 | 口径 | 用途 |
|---|---|---|
| F2L / AF2L | **槽位示意**：直接用原始 `fl`，顶层基本全灰，只标相关的那对块 | 看出那对块在槽位的什么位置 |
| OLL / CMLL / COLL / AntiPLL | **只标顶面**：顶面本色 `y`，其他一律灰 `l` | 只看顶面定向 |
| 其余（PLL、ZBLL…） | **完整颜色**：每格标它所属面的颜色 | 要看整圈换位 |

颜色字母：`r` 红 `o` 橙 `b` 蓝 `g` 绿 `w` 白 `y` 黄，`l` = 未指定（灰）。

**OLL 的朝向**：公式取逆算出来的原始朝向就是正确的，**不要加任何 U 轴旋转**。
（曾经试着按旧示意图转 U/U2/U' 对齐，结果把九宫格转歪了 —— 比如 OLL 4 本来是
「中心+左上」，转 U' 后变成「中心+左下」。）

**视角**：F2L / AF2L 用立体斜视图（`view:'iso'`），其余用展开图（`view:'net'`）。
见 `Cube/Analyzer/assets/cube-case-data.js` 的 `VIEW_OF_TYPE`。

不存打乱公式（`setup`）—— 需要时对 `alg` 取逆即可。

## 当前内容

134 个库、**4972 条**，全部带复原公式与状态。

| 分组 | 库 | 说明 |
|---|---|---|
| CFOP | OLL 57 / PLL 21 / F2L 41 / AF2L 54 | 主流程 |
| Roux | CMLL 42 / SBLS 65 / EO4A 9 | |
| COLL | COLL 40 / AntiPLL 22 | |
| ELL | ELL 25 | |
| VLS | VHLS 32 / WV 27 / SV 27 / VLS×7 | |
| F2L | CLS 97 | |
| 1LLL | 1LLL 01…57 | 各 40~72 条 |
| OLLCP | OLLCP 1…57 | 各 6 条 |
| ZBLL | ZBLLU/L/T/H/Pi/S/AS | |

其中 **OLL / CMLL / COLL / AntiPLL 只标顶面**（其余是灰格），**PLL 带 21 条换位箭头**。
所有 `faces` 都由对应公式真实算出，图与公式严格一致。

## 谁在读它

| 页面 | 读法 |
|---|---|
| Cube/Formula | 先读 `index.json`，**展开某个库时才读 `<id>.json`** |
| Cube/Formula/Classic | 同上（按需） |
| Cube/Analyzer | 直接读 `oll.json` / `pll.json` / `f2l.json` / `advancedf2l.json` / `cmll.json`，不走索引 |

**注意 AF2L 的归类**：Analyzer 只有 `OLL / PLL / F2L / CMLL` 四个 case 大类，
高级前两层（AF2L）的案例是以 `caseType:'F2L'` + `caseName:'AF2L xx'` 的形式产出的
（见 `solve-analyzer.js` 的 `STANDARD_CASES.F2L`）。所以：

- 页面上**不要**为 AF2L 单独加一个分类按钮，它本来就属于 F2L 这一类；
- 取图时 F2L 查不到、且名字以 `AF2L` 开头，要再去 `advancedf2l.json` 里找一次。

首屏只加载索引（18KB），不会一次拉 134 个文件。

## 记法约定（用户定）

- **保留 `X'2` / `X2'`**：表示两次该方向（`U'2 = U' U'`），与 `X2` 同为 180°，但保留原写法。
- **不用 `Xw`**：小写就是双层，`r` 就是 `r`。源数据里若有 `Fw` 这类写法，生成时已统一转成小写。
- 中层 `M E S`、转体 `x y z` 照旧。

## 校验

```powershell
node .tests/db-json.test.cjs
```

检查索引与文件一一对应、条数一致、每条公式能被站点解析器解析、`faces` 长度与字符合法、
箭头只在 PLL、`desc` 不空、无残留 `setup`、无 `Xw` 写法、重点记法正确。

当前：**134 库 / 4972 案例 / 0 问题**。

## 生成

数据由 `.stash/build-algs.cjs` 从原始案例库生成（一次性）。
产物是上面的 JSON，之后**直接改 JSON 即可**，不需要再跑构建脚本。

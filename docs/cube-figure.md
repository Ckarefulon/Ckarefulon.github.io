# 魔方示意图（cube-figure）

`Cube/assets/cube-figure/cube-figure.js` —— **状态 → 矢量图**，零依赖，不碰 DOM 之外的东西。

Analyzer 的 Case 卡片用它画缩略图；Formula 那边按算法出图的功能暂未接入。

```
Cube/assets/cube-figure/cube-figure.js   出图模块
Cube/assets/case-faces/                  案例状态数据（构建源，见该目录 README）
```

## 用法

```html
<script src="/Cube/assets/cube-figure/cube-figure.js" defer></script>
```

```js
// 状态（54 字符面位串，与 mathlib.SOLVED_FACELET 同口径）
CubeFigure.render(el, { state: mathlib.SOLVED_FACELET });
CubeFigure.render(el, { state: facelet, view: 'iso', size: 96 });
img.src = CubeFigure.dataURI({ state: facelet, view: 'iso' });
var s = CubeFigure.svg({ state: facelet });

// 只要某些面也行（case 数据就是这种形态）
CubeFigure.svg({ state: { U: 'yyyyyyyyy', F: 'ggggggggg', R: 'rrrrrrrrr' } });

// 换位箭头
CubeFigure.svg({ state, arrows: [['U0', 'U2'], ['U2', 'U8'], ['U8', 'U0']] });
CubeFigure.svg({ state, arrows: ['U0>U2', 'U2>U8'] });      // 字符串写法
CubeFigure.svg({ state, arrows: [['U1', 'U7', '<>']] });    // 双头
CubeFigure.svg({ state, arrows: CubeFigure.arrowCycle('U0 U2 U8') });
```

| 选项 | 说明 |
|---|---|
| `state` | 必填。/ 54 字符面位串、54 长度数值数组、`{U,D,F,B,R,L}` 面对象 |
| `view` | `'net'`（默认，紧凑展开图）或 `'iso'`（斜三面） |
| `size` | 边长像素，net 默认 75、iso 默认 96 |
| `palette` | `'site'`（默认）或自定义对象 |
| `arrows` | 换位箭头，指向用「面字母 + 该面第几格（0..8，行优先）」 |
| `arrowColor` | 默认 `#5d4ea8` |
| `background` / `title` | 可选底色 / 无障碍标题 |

## 两种视角

- **net** — 中间一个 3×3 面 + 四周 12 条块 = 48 个色块。Analyzer 的 Case 卡片用它。
  一个块 = 4 个 `13.125` 的 1/4 片，片内偏 `4.375`；四角按 `RADII` 表给圆角，
  这样整张图看起来是「一块整面 + 四周散块」。几何常量全在 `CubeFigure.NET` 里。
- **iso** — 上面 + 前左面 + 前右面 = 27 张贴纸。正交投影 + 轻微透视
  （yaw −34°、俯视 28.5°、透视 0.14），参数在 `CubeFigure.ISO` 里，`perspective: 0` 即纯正交。

## 箭头

有单头（`A>B`）和双头（`A<>B`）两种。几何规格：

| 量 | 值 | 说明 |
|---|---|---|
| 尾端（平口） | 压在起点色块中心 | 偏差 ≤0.006 |
| 尖端 | 越过目标色块中心 **2.128** | 看起来「对准中心」的是尖端往回退这点距离 |
| 头长 / 头半宽 | 6.95 / 2.5 | 以「一个色块边长 = 17.5」为基准 |
| 杆半厚 | 0.95 | 同上 |

尺寸都按「一个色块边长」等比缩放，换视角不会变胖变瘦。

**可用范围**：`net` 只画得出 U 九格 + 四个侧面首行（`F`/`B`/`L`/`R` 的 `0..2`），
其余引用静默跳过；`iso` 用 `U`/`F`/`R`（另外三面在背面）。

## 口径约定

- 面位串按 `URFDLB` 六面顺序，与 `cube-net.js`、`mathlib` 一致。
- 颜色字母：**大写**是面字母（取调色板的面表），**小写**是颜色字母
  （`r/o/b/g/w/y/l`，取调色板的 `letters` 表）。`l`（未指定灰）与面字母 `L` 必须分开。
- 认不出的格子刷灰，认不出的整体输入也不抛错。

## 自检

```
http://127.0.0.1:9527/.tests/cube-figure.test.html
```

核对：两种视角都出图、三种输入口径输出等价、箭头尾端与尖端位置、全站配色一致、
坏输入不抛异常。当前：**18 张图 · 口径等价 3/3 · 箭头几何 2/2 · 0 问题**。

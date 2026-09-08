# 紫青设计系统 / ZiQing Design System

> 紫色做气质，青色做点睛，中性色做主体。

---

## Brand Essentials

### 设计理念

紫青设计系统以「高级、简约、冷静、干净、轻微未来感」为核心气质，构建于深紫黑与冷灰的克制基底之上，以微量青色电光作为视觉呼吸点。系统拒绝过度装饰，强调信息层级与功能秩序，让界面在沉静中保有科技灵光。

### 颜色系统

颜色体系由三股力量构成，各司其职、边界清晰：

- **主品牌色 — 紫色 `#5d4ea8`**：承担气质与稳定感，是品牌识别的核心锚点。紫色贯穿主要操作按钮、选中态、品牌标识等关键位置，传递科技感与层次感。
- **高亮点缀色 — 青色 `#24f0ea`**：仅以小面积形式出现，用于聚焦态光晕、状态指示、微动效高光等场景，制造「电光」般的灵动感与仪式感。青色必须克制使用，绝不可大面积填充。
- **中性色 — 带紫调的冷灰系统**：构成界面的主体背景、边框、文字层级。冷灰中融入微妙紫调，使中性区域与品牌色在视觉上自然融合，避免割裂感。

#### 状态色

系统内置完整的语义状态色体系：success（成功/青色系）、warning（警告/黄色）、danger（危险/红色）、info（信息/蓝色）、pending（待处理/灰色）。

#### Portable Aliases

设计系统通过一组可移植别名令牌对外暴露颜色能力，业务侧应始终引用别名而非原始色阶：

| 别名令牌 | 用途 |
| --- | --- |
| `--color-background` | 页面背景色 |
| `--color-foreground` | 主要文字色 |
| `--color-card` | 卡片容器背景 |
| `--color-card-foreground` | 卡片内文字色 |
| `--color-primary` | 主品牌色（紫色） |
| `--color-primary-foreground` | 主色上的文字色 |
| `--color-accent` | 高亮点缀色（青色） |
| `--color-accent-foreground` | 点缀色上的文字色 |
| `--color-muted` | 弱化背景色 |
| `--color-muted-foreground` | 弱化文字色 |
| `--color-border` | 边框色 |
| `--color-input` | 输入框背景 |
| `--color-ring` | 聚焦环颜色 |
| `--color-success` / `--color-warning` / `--color-danger` / `--color-info` | 状态语义色 |

### 暗色与亮色模式

**默认主题：暗色模式**
深紫黑空间（`#0f0d18` 为底）中，紫色与冷灰构建层次，青色以微光形式出现在聚焦、状态、hover 等交互节点。整体氛围沉静而有科技仪式感。

**亮色模式**
冷白空间（`#f7f8fc` 为底）中，雾紫与冷灰构成主体，青色收敛为更深的青绿（`#14c9c4`），仅在聚焦与成功状态中以克制方式出现。亮色模式保持同样的冷静气质，但更适合长文本阅读场景。

两种模式共享同一套 portable aliases，切换时令牌值自动映射，业务代码无需变更。

---

## Usage Guide

### 颜色令牌使用规范

1. **优先使用语义别名**：始终引用 `--color-primary`、`--color-accent`、`--color-background` 等 portable aliases，避免直接使用 `--dsk-purple-500` 等原始色阶，确保主题切换时自动适配。
2. **青色克制原则**：`--color-accent`（青色）仅用于聚焦环、状态指示、hover 微光、成功徽章等小面积场景，禁止作为按钮底色、卡片背景、大面积填充使用。
3. **文字层级**：主要文字使用 `--color-foreground`，次要说明使用 `--color-muted-foreground`，禁用或极弱化文字使用 `--color-foreground-subtle`。
4. **边框与分隔**：常规边框使用 `--color-border`，极细分隔线使用 `--dsk-border-subtle`。

### 组件使用注意事项

- **按钮 Button**：默认主按钮为紫色填充；青色仅出现在 hover 边框微光、focus ring 与 loading 状态中，不可作为按钮默认底色。
- **卡片 Card**：卡片背景为中性色，支持顶部或左侧的细装饰线（紫色或青色）；hover 时的青色边缘微光需极其克制，避免玻璃拟态或彩色填充。
- **输入框 Input**：默认边框为中性色，聚焦态出现青色边框与极淡光晕；错误态切换为红色系。
- **对话框 Dialog**：保持简洁，顶部不使用渐变或彩色标题栏；危险操作对话框的按钮居左排列。
- **标签 Tag**：无青色背景的标签变体；标签分为默认灰、紫色主色、淡色软背景三种风格。
- **徽章 Badge**：成功态使用青色点/药丸，支持呼吸动效；其余状态对应各自语义色。徽章始终小面积，不做大色块背景。

### 暗色 / 亮色切换方式

在根元素（`<html>` 或 `<body>`）上设置 `data-theme` 属性：

```html
<!-- 暗色模式（默认，可省略） -->
<html data-theme="dark">

<!-- 亮色模式 -->
<html data-theme="light">
```

切换时仅需修改 `data-theme` 属性值，所有颜色令牌将自动重新映射。布局、尺寸、圆角等非色彩令牌在两种模式下保持一致。

---

## Component Inventory

| 组件 | 类型 | 说明 |
| --- | --- | --- |
| **Button 按钮** | action | 提供 primary / secondary / ghost / danger 四种变体，支持 sm / md / lg 三种尺寸与 loading、disabled 状态。主操作为紫色填充，青色仅用于交互反馈。 |
| **Card 卡片** | container | 信息容器组件，支持 default / elevated / bordered / accent-line 四种变体。可配置顶部或左侧装饰线，hover 时有极克制的青色微光边缘。 |
| **Input 输入框** | form | 表单输入组件，支持 default / error 变体与 sm / md / lg 尺寸。聚焦态呈现青色边框与淡光晕，错误态切换为红色提示。 |
| **Dialog 对话框** | overlay | 模态对话框组件，支持 default / danger 变体与 sm / md / lg 尺寸。默认按钮居右，危险操作按钮居左；遮罩为半透明深色加模糊效果。 |
| **Tag 标签** | status | 分类/状态标签组件，支持 default（灰）/ primary（紫）/ soft（淡）三种变体，sm / md 两种尺寸，可配置关闭按钮。 |
| **Badge 徽章** | status | 状态指示组件，支持 success / warning / danger / info / pending 五种语义状态，dot / pill 两种形态。成功态为青色，支持呼吸动效。 |

# 紫青设计系统 / ZiQing Design System

> 紫色做气质，青色做点睛，中性色做主体 —— 高级、简约、冷静、干净的未来感设计语言。

---

## 设计理念

紫青设计系统以「80% 中性 / 15% 紫色 / 5% 青色」的色彩黄金比例为核心，构建兼具科技气质与视觉秩序的界面体验。

### 紫色 — 气质之核

紫色是品牌的主色与灵魂，承载**气质、科技、稳定**的语义。它出现在主要操作按钮、关键链接、品牌标识等核心交互区域，赋予产品沉稳而不失先锋的调性。紫色的深度与广度，让界面在暗色环境中既有存在感又不刺眼。

### 青色 — 点睛之光

青色是系统的高亮点缀色，传递**光感、灵动、仪式感**。它以小面积、精准的方式出现在状态高亮、焦点环、成功提示等处，如同黑暗中的微光，为界面注入呼吸感与未来感。青色永远克制使用，确保每一次出现都具备足够的视觉权重。

### 中性色 — 秩序之体

中性色是界面的主体与基石，负责**阅读、秩序、承载内容**。冷调中性色带有微妙的紫色底韵，与主品牌色自然融合，确保大面积内容区域舒适易读，同时维持整体视觉的统一与高级感。

---

## Token 概览

设计系统通过 CSS 自定义属性（CSS Variables）组织设计令牌，并提供 portable alias 别名以保证跨框架兼容。

### 颜色令牌

| 别名变量 | 说明 |
| --- | --- |
| `--color-primary` | 主品牌色（紫色），用于主要操作与品牌表达 |
| `--color-primary-foreground` | 主色上的文字颜色 |
| `--color-accent` | 高亮点缀色（青色），用于焦点、高亮、成功状态 |
| `--color-accent-foreground` | 点缀色上的文字颜色 |
| `--color-background` | 页面背景色 |
| `--color-foreground` | 正文文字颜色 |
| `--color-muted` | 弱化背景色 |
| `--color-muted-foreground` | 次要文字颜色 |
| `--color-card` | 卡片背景色 |
| `--color-card-foreground` | 卡片文字颜色 |
| `--color-border` | 边框颜色 |
| `--color-input` | 输入框背景色 |
| `--color-ring` | 焦点环颜色 |
| `--color-success` / `--color-warning` / `--color-danger` / `--color-info` | 状态色 |

### 圆角令牌

| 别名变量 | 值 | 适用场景 |
| --- | --- | --- |
| `--radius-sm` | 6px | 小型控件、标签 |
| `--radius-md` | 8px | 按钮、输入框 |
| `--radius-lg` | 12px | 卡片、弹窗 |
| `--radius-xl` | 16px | 大型容器 |
| `--radius-full` | 9999px | 胶囊、圆形元素 |

### 字体令牌

| 别名变量 | 说明 |
| --- | --- |
| `--font-sans` | 无衬线字体栈（Inter / 系统默认 / PingFang SC / 微软雅黑） |
| `--font-mono` | 等宽字体栈（SF Mono / Cascadia Mono / Consolas） |

### 阴影令牌

| 别名变量 | 适用场景 |
| --- | --- |
| `--shadow-sm` | 轻量阴影，小型悬浮元素 |
| `--shadow-md` | 中等阴影，卡片、下拉菜单 |
| `--shadow-lg` | 深度阴影，弹窗、模态框 |

---

## 组件列表

| 组件 | 描述 |
| --- | --- |
| **Button** | 按钮组件，支持主色、辅色、幽灵、虚线等多种变体与尺寸 |
| **Card** | 卡片容器，用于承载内容区块，自带边框与悬浮态 |
| **Input** | 输入框组件，支持多种状态与尺寸，聚焦时青色光晕 |
| **Dialog** | 对话框/模态框组件，带遮罩层与进入退出动效 |
| **Tag** | 标签组件，用于分类标记、状态展示，支持多种颜色变体 |
| **Badge** | 徽标组件，用于红点提示、数字角标、状态指示 |

---

## 使用方式

### 1. 引入令牌文件

在项目入口处引入 `colors_and_type.css`，即可使用全部设计令牌：

```html
<link rel="stylesheet" href="path/to/colors_and_type.css">
```

或在 CSS 中导入：

```css
@import 'path/to/colors_and_type.css';
```

### 2. 使用组件样式

引入组件样式文件以获得完整组件样式：

```html
<link rel="stylesheet" href="path/to/components.css">
```

### 3. 使用 portable alias 令牌

在自定义样式中直接使用别名变量，确保主题切换时自动响应：

```css
.my-button {
  background: var(--color-primary);
  color: var(--color-primary-foreground);
  border-radius: var(--radius-md);
  padding: 8px 16px;
}
```

---

## 暗色 / 亮色模式

紫青设计系统**默认采用暗色模式**，通过 `:root` 作用域下的 CSS 变量定义深色主题。

### 切换至亮色模式

在根元素（`<html>` 或 `<body>`）上添加 `data-theme="light"` 属性即可切换为亮色模式：

```html
<html data-theme="light">
  <!-- 亮色主题 -->
</html>
```

### 动态切换

通过 JavaScript 动态切换主题：

```javascript
// 切换为亮色
document.documentElement.setAttribute('data-theme', 'light');

// 切换为暗色（移除属性即恢复默认）
document.documentElement.removeAttribute('data-theme');
```

所有颜色令牌均会随主题自动更新，无需额外修改组件样式。

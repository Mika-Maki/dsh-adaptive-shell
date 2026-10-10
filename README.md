# dsh-adaptive-shell

DeepSeek Harness Web 界面的**自适应 + Miracle 视觉**层：按屏幕尺寸与比例匹配手机 / 平板 / 桌面，
给输入框和页头补安全区、窄屏收紧留白、触摸设备放大控件，并把配色换成 Miracle 设计语言。

一句话：**桌面一个像素都不动；手机上 56px 图标栏完全收起（侧栏入口移到会话页头）、输入框不再被地址栏和 Home 指示条吃掉、刘海不再压住页头、窄屏留白收紧、按钮变成能用手指点的尺寸；配色是 Miracle 的暖白纸感 + 墨蓝色阶 + 蓝紫品牌色。**

> **v2 的核心不是"加了什么"，而是"永远不可能把你锁住"。** 见下面的[两次事故](#两次事故与它们留下的铁律)。

## 目录

- [它改了什么](#它改了什么)
- [两次事故与它们留下的铁律](#两次事故与它们留下的铁律)
- [Miracle 视觉层](#miracle-视觉层)
- [形态判定规则](#形态判定规则)
- [设置项](#设置项)
- [与 dsh-codex-efforting 的兼容契约](#与-dsh-codex-efforting-的兼容契约)
- [依赖的 shell 公开标记](#依赖的-shell-公开标记)
- [已知限制](#已知限制)
- [静态自检](#静态自检)
- [安装 / 卸载](#安装--卸载)

## 它改了什么

全部在浏览器半（`client.js`）。不新增宿主能力、不改任何 shipped 包、不 monkey-patch 服务。

**1. 运行时判定** —— 测视口，在 `<html>` 上打标记：

| 属性 | 取值 | 含义 |
|---|---|---|
| `data-dsh-adaptive` | `1` | 运行时活着（所有 CSS 的第一道门） |
| `data-dsh-adaptive-form` | `phone` / `tablet` / `desktop` | 形态 |
| `data-dsh-adaptive-orient` | `portrait` / `landscape` | 方向 |
| `data-dsh-adaptive-density` | `compact` / `comfortable` | 纵向余量 |
| `data-dsh-adaptive-narrow` | `1` | 宽度 < 1024（镜像 shell 自己的侧栏断点），决定窄屏专属的规则是否生效 |
| `data-dsh-adaptive-touch` | `1` | 粗指针（触摸设备） |
| `data-dsh-adaptive-compat` | `1` | 允许对推理卡片做窄屏收敛 |
| `data-dsh-adaptive-miracle` | `1` | Miracle 令牌层已生效（诊断用） |

外加 `--dsh-adaptive-vw / -vh / -ratio` 三个诊断变量。**任何一步失败都不落标记 ⇒ 全部 CSS 失效 ⇒ 界面等于出厂。**

**2. 文档基础**

- 补 `<meta name="viewport">`：`viewport-fit=cover`（否则 `env(safe-area-inset-*)` 恒为 0）、
  `interactive-widget=resizes-content`（键盘弹出时重排而不是盖住输入框）；移除 `maximum-scale` / `user-scalable`。
  卸载时逐字还原。
- **不动文档高度。** v1 用过 `100dvh`：手机浏览器地址栏收放会让容器在手势中途改高度，是已知会丢失触摸滚动的写法。出厂的 `100%` 链保持原样。

**3. 几何（只有 padding 与最小尺寸）**

- 输入框：窄屏 + 手机形态下左右 8px、底部 4px，各自叠加 `env(safe-area-inset-*)`（刘海、横屏侧边、Home 指示条）。
- 会话页头：叠加 `env(safe-area-inset-top/left/right)`；矮屏（紧凑档）再压一次，把高度让给内容。
- 触摸设备：输入框 / 会话页头 / 右侧面板里的 `button` 最小 36px。
- 桌面级窗口（宽度 ≥1024）**一条规则都不命中**。

**4. Miracle 视觉** —— 一层 `ctx.theme.overrideTokens`，独立开关。

**5. 手机上完全收起图标栏**

shell 在窄屏收起侧栏时保留 56px 图标栏 —— 390px 屏幕上那是约 14% 的宽度花在空栏上。
手机形态（且宽度 <1024）下把这一条轨道清零，宽度还给对话；对应的**侧栏开关移到 `conversation.header.leading`**
（shell 自己留的空席位，位于**会话列内部**）。

这不是一次"顺手加的功能"，而是 v1 锁死事故的对症修正：**打开某个状态的控件，绝不能住在那个状态里、也绝不能被自己打开的东西盖住。**
放在会话列内部的按钮满足这一点 —— 侧栏展开时它依然可见可点。

收起时轨道 0→ 图标栏消失；展开时按 shell 原有行为（中栏被挤压，和出厂点图标栏上的开关完全一致）。

**6. Motion（Miracle 动效纪律）**

动效只做 Miracle 允许的四件事里的两件，而且**只动合成层属性**：

| 位置 | 动作 | 属性 |
|---|---|---|
| 侧栏抽屉 | 位移（从左侧滑入/滑出） | `transform` |
| 主会话 | 位移（按**同一位移量**同步右移/复位） | `transform` |
| 页头侧栏按钮 | 按下位移（缩放反馈） | `transform` |

- **一条时间线**：抽屉与主会话在同一状态下**声明完全相同的 `transition`**（不只是"看起来差不多"），所以不可能出现一个先到、另一个后补。
- **两向同时结束**：进出用**同一个时长令牌**、两条不同曲线（入场减速落位 / 出场加速离开）。性格来自曲线，不来自时钟。
- **令牌集中**：`--dshas-motion-enter/exit/drawer/press` 只在**一处**声明，页面里只引用；样式表里没有就地写的时长或曲线常量。
- **两态之间只变 `transform`**：抽屉的盒子属性（`position` / `width` / `z-index` / `box-shadow` / `will-change`）声明在**两态之外**，切态不动盒子。
  —— 这是"点开后先弹出、随后又修正一次位置"的根因：盒子在两态不同，浏览器会在滑动结束后再落一次布局。
- **不用 `@keyframes`**：全部是状态驱动的 transition，终点状态由 CSS 决定，所以**不存在"卡在动画中间态"**这回事（不需要定时器兜底，因为根本没有 JS 动画状态）。
- **`prefers-reduced-motion`**：整条时间线降级为瞬时，且**落到正确的终点状态**。
- **300ms tap 延迟**：手机浏览器在未声明 `touch-action` 的元素上会把 `click` 延迟约 300ms —— 那正是"点击后延迟弹出"。按钮声明 `touch-action: manipulation` 后立即触发。
- `will-change: transform` **只出现在侧栏列**（让图层在切换前就存在，避免首帧画在终点）。它**绝不**放在主会话列上 —— 那会让主会话成为 `position:fixed` 的包含块，也就是即使抽屉关着也会破坏第三方浮层。

**7. 空闲预取（"预渲染"里插件真能做的那一半）**

面板是**按需**加载的：模块脚本要下载 → factory 执行（顺带注入该面板的样式）→ 面板挂载，全发生在**第一次点开它的那一次点击**上。

客户端模块加载器**没有公开的预热接口**（materialize 只发生在首次 import），但 shell 把引导清单发布在 `globalThis.__DSH_BOOT__`，
所以模块 URL 是可读的。本插件在**空闲时**给下列面板放一次性 `prefetch` 提示，把"下载"这段从点击上挪走：

`ui-sidebar` · `ui-sidebar-right` · `ui-jobs` · `ui-subagent` · `ui-agent-team`

安全边界（自检逐条守着）：只走**有深度上限**的遍历；只接受**同源、`/assets/` 下、`.js` 结尾**的 URL（畸形或恶意载荷无法让本文档去取别的任何东西）；
只在空闲时放一次；不执行任何模块、不改任何别的插件的状态；卸载即摘除。

**8. 即时按下反馈**

`:active` 在触摸设备上生效很晚（某些 iOS 版本在没有 touch 处理器的页面上根本不生效），所以按下状态由**按钮自己**的 pointer 事件驱动 ——
不是全局监听，也仍然不改事件本身。这是"点下去像没反应"的感知延迟那一半；另一半是抽屉自身的启动成本（见[已知限制](#已知限制)）。

**9. 两种手势，各归其位（这一条是用户校正出来的）**

| 对象 | 手势 | 机制 |
|---|---|---|
| 转录里的行：思考、命令块、工具调用、折叠卡片 | **高度展开** | 折叠根两行网格 `0fr→1fr`；命令块与折叠根另有一层 JS 高度接管（测出前后真实高度再推开），因为收起那一帧原语已把 body 卸载 |
| 浮在会话**之上**的卡片：右侧面板（后台任务/子 Agent/团队）、dock 浮窗、对话框 | **曲线缩放展开** | `transition:transform` + `@starting-style`，`transform-origin` 贴它锚定的一边 |
| 被点击的行头 | 按下几何反馈 | `scale(.996)`，跑在 press 令牌上 |

**不重叠**：转录的行**不做**缩放（行属于流，必须推动流）；浮层卡片**不做**高度展开（它不是流的一部分）。之前把两种手势给同一个元素，读起来就是噪音。

**10. 转录卡片：一处定义，一套配方**

思考、命令块、工具行、折叠后的过程组 —— **同一个面、同一个圆角、同一条 hairline**，全部读三个令牌：

```
--dshas-card-surface   → var(--dsw-alias-bg-layer-1)   （App 自己的抬升层，不是自造色）
--dshas-card-hairline  → var(--dsw-alias-border-l1)
--dshas-card-radius    → var(--dsw-radius-md)
```

一条规则承载四类标记，改方案只改一处。填充取**应用自己的层**，这是"与整体符合"的关键：早先用 `bg-layer-2`（暖灰）是自造色块，在纸面上就是一块补丁。

**唯一随嵌套变化的是内边距**：内部行 6/10，容纳它们的组 8/12。

进行中是唯一允许出现品牌色的状态，且两类"运行中"行由**同一条声明**上色。

**11. 手机上的设置页（这一轮的核心修复）**

设置不是侧栏页，而是一个**居中模态**：

```
.panel   width:800px; max-width:calc(100vw - 48px); height:min(800px, …)
  .nav   width:188px（固定）
  .content → .options
```

在 390px 手机上：面板只剩 **342px**，扣掉固定 188px 的导航列，**内容列约 150px** —— 这就是"比例不对"的真身。

它的类名是构建哈希，所以三个元素用**结构关系**命中（唯一稳定锚点是内容里的 `settings.section` 席位包装）：

| 元素 | 关系 |
|---|---|
| 分区导航 | 紧邻在"持有该席位者"**之前**的兄弟 |
| 面板 | 子元素是那个导航的元素 |
| 内容区 | 席位**直接**所在的元素 |

手机上的结果：面板**满幅**（`height:100%`，在 `inset:0` 的覆盖层内，因此不引入任何 viewport 单位）、分区列变成**横向条**（`overflow-x:auto` + `overflow-y:hidden`，纵向手势不会被它吃掉）、内容区拿到安全区内边距。

全部是**关系而非名字**：结构变了就自动不再匹配、回到出厂版式 —— 这是本插件一贯选择的失败方向。

**12. 手机上的设置页（按真实标记重做）**

先前的做法是**从样式表反推结构**，结果两条规则命中了错的节点，把分区挤成竖条。现在改为**读它自己的渲染代码**，于是拿到了不经猜测的钩子：

```
div[data-shortcut-modal="settings"][role=dialog][aria-modal=true]
  <nav>                 → [ 标题, 列表 ]
  div.content           → [ header, div.options ← settings.section 席位 ]
```

手机上：

| 目标 | 处理 |
|---|---|
| 面板 | `flex-direction:column` + 满幅满高、圆角 0（用百分比高度，**不引入 viewport 单位**） |
| 分区 `nav` | 变**顶部横向条**，仅横向滚动（纵向手势仍归面板，不会被吃掉） |
| 分区标题 | 隐藏（content header 已有标题） |
| 分区项 | **`flex:none` 固定自身宽度** ← 这是"竖条"的成因：被压窄后中文逐字换行 |
| 内容区 | 安全区内边距 |

`data-shortcut-modal` 是专用属性，两条 `>` 关系是该标记结构里真实存在的；结构一变即自动不匹配、退回出厂版式。

**13. 诊断：谁在抢我的定义（`tools/inspect.mjs`）**

```bash
node tools/inspect.mjs <dsh web 打印的令牌>
```

它驱动一个无头浏览器打开真实页面，然后对每类卡片、每个本插件设置的属性，打印**计算值** + **所有命中该元素的、设置了该属性的规则**（含特异性、以及是"我"还是"壳"）。产出长这样：

```
思考标题行 → background-color=rgba(0,0,0,0)
   background-color 竞争者: 600 [我] html[data-dsh-adaptive-miracle="1"] [data-variant="think"] [data-disclosure-row]
   overflow        竞争者: 100 [壳] .lcKema_row
```

两个真实教训催生了它：卡片令牌曾**声明在 `html` 上而调色板在 `body` 上**（整条 `background`/`border` 静默作废，而样式表看起来完全正确）；思考展开后标题行被壳的**吸顶条**刷成页面底色且特异性高过我。两次都是"规则正确但输了层叠"，肉眼看不出来。

**14. 设置行** —— 只在 `settings.general.item`（加法席位）里加 8 行。

## 两次事故与它们留下的铁律

### 事故一：整页点不动、滑不动

**原因**：遮罩的显隐只看"形态是不是 phone/tablet"，而"侧栏是浮层还是真列"由 shell 自己的断点决定。
在 `宽度 ∈ (1024, 1152] 且很矮`的窗口里，插件判 `phone` 挂上遮罩，shell 却认为侧栏是普通列、压根没进抽屉模式 ⇒
遮罩判定为"抽屉开着" ⇒ 全屏吃掉指针事件。

**修法**：新增 `narrow` 标记镜像 shell 断点；遮罩 `pointer-events` 基础态 `none`，只有带 `narrow` 门的正向规则才 `auto`。

### 事故二：一次点击就把自己关在门外（v1 真正的设计错误）

**原因**：遮罩盖住中栏，而**唯一的开关按钮（汉堡）就在中栏里、位于遮罩之下** ⇒ 遮罩一起来就再也点不到它。
同时遮罩不是对话滚动容器的后代，**手指在它上面拖动不会滚动后面的正文** ⇒ "整个会话无法滑动"。刷新才恢复。
另外"新建工作区按钮浮在对话上"就是同一个状态：抽屉展开态浮在中栏之上。

**修法（v2 的设计起点）**：不再"修好这个遮罩"，而是**把整类失败从设计上删掉**：

| 铁律 | 自检怎么守 |
|---|---|
| **不渲染任何覆盖层**，永久不提 `pointer-events` | 断言全表没有 `pointer-events` 声明 |
| **不做任何定位**（`position` / `inset` / `z-index`） | 断言这些属性一个都不出现 |
| **只允许一条结构规则**：窄屏手机上清零收起状态的图标栏轨道 | 断言"引用框架标记的规则"恰好是那两条，且必须同时带 `narrow` + `phone` + `[data-sidebar-collapsed]` 三重门；`!important` 全表只允许出现在那一条轨道上 |
| **打开某状态的控件不在该状态里，也不在任何东西下面** | 断言侧栏开关注册进 `conversation.header.leading`（会话列内部），而不是 `shell.overlay` 或侧栏 |
| **唯一的事件监听是被动观察者**：手机上点侧栏之外收回抽屉 | 断言监听只在"窄屏+手机+抽屉确实打开"时挂上、离开即摘；断言全表**从不**调用 `preventDefault` / `stopPropagation`；断言只用 `click`（气泡阶段），不在事件派发中途改布局；**断言"来自本插件自己按钮的那一次 click"不算点外** —— 观察者是借由这次点击的状态变化才挂上的，不管住它就会自己触发自己（点开即秒关，侧栏永远打不开） |
| **两态之间只变 `transform`** | 断言抽屉的两条状态规则里**没有任何盒子属性**；断言 `will-change` 只出现在侧栏列；断言主会话列从不被提升（否则固定浮层即使抽屉关着也会坏） |
| **预取不越界**：只读引导清单、只放同源 `assets/*.js` 提示、深度有上限、不执行模块、不改别人状态 | 断言只给点名的面板放提示；断言跨源 URL、非 `.js`、`/assets/` 之外的路径一律不提示；断言载荷缺失/畸形时不抛异常也不产生任何提示；断言卸载后提示被摘除 |
| **动效只动合成层、且令牌集中命名** | 断言全表无 `@keyframes`、无 `animation`；断言每条 `transition` 要么是 `none`，要么完全由 `--dshas-motion-*` 构成；断言抽屉与主会话的 `transition` **字面相同**；断言进出同用时长令牌、曲线不同 |
| **不动文档高度** | 断言没有 viewport 高度声明；`height` 只出现在插件自己的控件上 |

剩下的能力面只有：padding、一条只会被清空的网格轨道、最小尺寸、颜色 —— **这些做错了也不会锁住任何人**。
踩坏结构的代价被压缩到"图标栏没消失"或"图标栏还在"，而不是"整页动不了"。

## Miracle 视觉层

用 `ctx.theme.overrideTokens(source, { token: { light, dark } })` 实现 —— shell 自己的一等机制：一个角色 → 双配色层，
叠在当前主题之上，一次调用整体摘除，shipped 主题文件一个字都不改。

| shell 令牌 | Miracle 角色 | 亮色 | 暗色 |
|---|---|---|---|
| `--dsw-alias-bg-base` | paper 页面底 | `#FBFAF6` | `#12141F` |
| `--dsw-alias-bg-layer-1` | surface 可点的面 | `#FFFFFF` | `#1B1E2E` |
| `--dsw-alias-bg-layer-2` | sunk 凹陷面 | `#F4F3ED` | `#242839` |
| `--dsw-alias-label-primary` | ink 主文字 | `#161B38` | `#EEF0F8` |
| `--dsw-alias-label-secondary` | inkSoft 次级 | `#454C70` | `#C4C9DD` |
| `--dsw-alias-label-tertiary` | muted 标签 | `#7B83A6` | `#8B92AD` |
| `--dsw-alias-brand-primary` | 品牌强调 | `#5570D8` | `#7E96F0` |
| `--dsw-radius-sm/md/lg/xl` | 柔和圆角 | `10 / 14 / 20 / 24px` | 同值 |
| `--dsw-shadow-*` / `--dsw-elevation-*` | 带墨色的克制阴影 | 墨蓝低透明度 | 近零 |

三条 Miracle 规则被编码并由自检守着：**不用纯黑纯白**；**暗色下交互色提亮而不是压暗**；**阴影带色相、暗色近零，层级改由"面比底亮"承担**。

## 形态判定规则

```js
width  <= 600                              -> phone
height <= 480 && width / height <= 2.4     -> phone      // 手机横屏（844x390）
width  <= 1024                             -> tablet
否则                                        -> desktop
orient  = height > width ? portrait : landscape
density = height <= 560 ? compact : comfortable
narrow  = width < 1024                     // 独立于 form，镜像 shell 的侧栏断点
```

`ratio <= 2.4` 专门挡"又矮又宽的桌面窗口"（1280×470 ⇒ desktop）。
测量用 `documentElement.clientWidth/clientHeight` 而不是 `window.inner*`：后者会在地址栏收放、软键盘弹出时跳动，导致判定反复横跳。

## 设置项

设置 → 通用，最底部 7 行（order 40–46）：

| 行 | 默认 | 作用 |
|---|---|---|
| 自适应界面 | 开 | 总开关。关掉立刻摘掉所有标记 ⇒ 回到出厂 |
| 形态覆盖 | 自动 | 强制 手机 / 平板 / 桌面 |
| 紧凑纵向间距 | 自动 | 矮屏压缩页头（仅窄屏生效） |
| 触摸尺寸 | 开 | 粗指针设备上放大控件 |
| 推理卡片宽度收敛 | 开 | 窄屏限制 `.efs-card` 宽度 |
| Miracle 视觉 | 开 | 叠加 / 摘除 Miracle 令牌层 |
| 侧栏推开主会话（同步运动） | 开 | 抽屉与主会话同频位移。**代价**：展开期间，混用"固定定位 + 视口坐标"的第三方浮层（如推理卡片）会偏移一个侧栏宽度；装了那类插件时建议关掉 |
| 当前判定 | — | **只读**：`手机 / 窄屏 / 390x844 / 鼠标尺寸 / 侧栏收起 / 配色 miracle`。读不到显示 `—` |

最后一行是给报 bug 用的：它让布局问题可以**引用真实数字**而不是描述屏幕。

偏好存 `localStorage["dsh-adaptive-shell/preferences"]`（按浏览器，不按 profile）。

## 与 dsh-codex-efforting 的兼容契约

1. 除 `max-width` 那一条，不写任何 `.efs-*` 规则，不碰 `conversation.input.model` 席位。
2. 绝不给 `[data-composer-card]` 的祖先加 `transform / filter / perspective / contain / backdrop-filter / will-change / container-type`（会把 fixed 卡片的包含块挪走）。
3. 绝不改祖先的 `container-type`（`45cqw` 的分辨基准）。
4. 绝不加 `overflow:hidden`。
5. 不用任何 z-index。
6. 窄屏收敛：`.efs-card{max-width:calc(100vw - 24px)}`（它自己的 clamp 在视口窄于约 364px 时必然越界；用 `max-width` 修，因为轨道和滑块都是百分比定位）。可关。

## 依赖的 shell 公开标记

只读地用三个（**不使用任何 CSS-Module 哈希类名**）：

| 标记 | 用途 |
|---|---|
| `[data-composer-card]` | 用 `div:has(> …)` 定位消费输入框变量的那个元素，覆盖 padding |
| `[data-conversation-header-leading]` | 定位会话页头 `<header>`，加安全区 |
| `[data-sidebar-right-panel]` | 只用于触摸尺寸 |
| `[data-shell-overlay]` / `[data-sidebar-collapsed]` | **CSS 里只出现在那一条图标栏规则上**（三重门）；另外 JS 只读地用于诊断行显示侧栏状态 |

**如果 shell 改了这些标记**：选择器失配 ⇒ 规则静默失效 ⇒ 界面回到出厂。不崩、不闪、不半成品。

## 已知限制

- **左抽屉首次打开仍有一小段延迟**：那是 shell 在点击那一刻重新渲染/布局它自己的展开态子树，**插件无法替另一个插件预渲染 React 子树**，也没有公开的预热接口。唯一剩下的手段是"空闲时开合一次"去替它把这次成本付掉 —— 但那会**在你看不见的地方改动你的侧栏状态**，正是前面两次事故的同类动作，所以我默认不做。你要的话说一声，我做成显式开关再给你。
- **面板预取只省下载**：脚本下载被挪走了，但 factory 执行（含样式注入）与挂载仍在首次点开时发生 —— 加载器不提供更早的入口。
- **主会话是"被推开"而不是"被压缩"**：它的布局宽度、缩放比例与渲染分辨率全程不变，只是整体位移一个侧栏宽度。因此展开期间它右侧会有一部分移出视口（被框架裁剪）。
- **"同步运动"的代价**：主会话上的 `transform` 使它成为 `position:fixed` 后代的包含块 ⇒ 展开期间，第三方"固定定位 + 视口坐标"浮层会偏移一个侧栏宽度。默认开着同步运动，可在设置里关掉（关掉后抽屉照常滑动，主会话保持不动）。
- **侧栏开关只在会话页头**：手机上非会话面板（如插件页）没有它，回会话由那些面板自己的返回控件负责。
- **平板保留 56px 图标栏**（空间够），也不显示额外按钮。
- **紧凑纵向间距只在窄屏生效**，桌面级窗口不会被压缩。
- **不覆盖桌面壳**（`data-platform=darwin` / `data-windows-titlebar`）：所有规则都带门。

## 静态自检

```bash
node test/smoke.mjs
```

真跑 `client.js`（`node:vm` + 最小 `window`/`document`/`MutationObserver`/`matchMedia` 桩），126 项断言：

- 加载器声明、导出、`inject`、无 Harness Client 包 import；
- 形态判定 11 个边界 + 分类器纯函数；
- **锁死类失败的断言**：无 `pointer-events` / `overflow` / `filter` / `contain` 等属性；结构规则全部在**钉死的白名单**上；帧子元素**绝不被移出流**（否则中栏会掉进 0 宽轨道、会话消失）；定位只出现在抽屉盒子上；`will-change` 只在侧栏列；`touch-action` 只能是 `manipulation`；无 viewport 高度声明；裸色值为 0；
- 令牌与门：每个选择器都以 `html[data-dsh-adaptive` 开头、每个针对 shipped 元素的规则都带门、每个引用的令牌都由 shipped 包定义、无 `!important`、无哈希类名；
- 三次干跑（390×844 / 1100×460 / 1440×900）：标记、席位、令牌层、卸载还原；
- **专项回归**：`1100×460` 必须判 phone、必须无 narrow、必须无覆盖层、必须**不**给侧栏开关。

它**不**做渲染、不做布局、不声称视觉正确。

## 安装 / 卸载

```bash
# 安装（需要一次页面刷新）
plugin_manager action=install_bundle target=/root/DSHplugs/dsh-adaptive-shell

# 卸载（正规路径，会同时清 package.json / bundles / lock / node_modules）
plugin_manager action=remove_bundle target=dsh-adaptive-shell
```

只关功能不停用插件：设置页关掉**自适应界面**（结构全关）或**Miracle 视觉**（只回配色）。

> 之前我用"手删 node_modules 里的软链"当卸载 —— **那是错的**：包仍在 `package.json` 与 `bundles` 里，下次启动照样加载。必须走 `remove_bundle`。

## License

MIT

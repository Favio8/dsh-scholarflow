# 变更页标题导航的陈旧 DOM 读取：一次可达性纠正

日期：2026-10-13。审 `8eeb1d4`（源码输入时隐藏预览不再逐键重渲染）引入的风险时，发现 `src/client/draft.tsx`
的标题导航在切换视图**之前**就抓取预览 DOM 节点。已按最小改动修复，但**可达性比初判窄得多**：这条 UI 在
v1.20 的 chrome 下近乎不可达。本记录同时纠正初判。

## 改动

标题导航原来先抓节点、再切视图：

```js
const heading = root.current?.querySelector(`[data-sf-heading-offset="…"]`)
onReturnEditor?.(); requestAnimationFrame(() => { heading?.scrollIntoView(...); heading?.focus() })
```

`onReturnEditor`（`plugin.tsx:340`）会 `setView('preview')` + `navigateTab('Draft')`，两者都在 rAF 之前
完成批处理；但旧写法在这**之前**就查了 DOM，于是拿到的是冻结预览里的节点——预览在 `active` 为 false 期间
不重渲染，新出现的标题在 DOM 里并不存在。现改为在 rAF 内、切换提交之后再查。对所有已渲染路径行为不变。

## 可达性（这才是重点）

- 标题列表（`nav[aria-label="正文标题导航"]`）位于「正文管理」块内，`draft.tsx:715` 的条件是
  `hidden = tool !== 'Changes' || suggestionsOnly && !recoverable && !project.document.externalChange`。
- `tool` 来自 `plugin.tsx:292`：`tab === 'Review' || tab === 'Changes'` → `'Changes'`；History 仅在"运行记录"
  视图下为 `'History'`。
- 全仓库**没有任何** `navigateTab('Changes')` 或 `setTab('Changes')`：`navigateTab` 的调用目标只有
  Overview／Research／Draft／Review／Settings／History。
- `suggestionsOnly` 在 Review 页为 true，因此还需要 `recoverable`（宿主存在未提交缓冲的冲突态）才能显形。
- `project.document.externalChange` 在 `src/` 内**只有读取与类型声明，没有任何赋值**，恒为 false。

结论：该列表只能在"宿主脏缓冲冲突 + 停在 AI检查页"时露出。正常路径下它是隐藏的。初判的
"编辑视图 → 大纲面板 → 点标题"路径不成立：大纲面板会替换正文区域，面板内也没有这个列表。

## 因此

- **不**声称修复了用户可见缺陷：这是一处当前近乎不可达分支里的潜在缺陷。
- 保留这一行修复：它无行为风险，并消除了"从陈旧 DOM 抓节点"这个模式本身。
- 没有为它新增 e2e：无法诚实驱动不可达 UI；而写一个断言"该列表不可见"的测试，会在将来合法接通该页时失败。
- 顺带记录两处同源事实，留给后续决定：`tab === 'Changes'` 无任何入口；`externalChange` 无任何赋值。二者都是
  界面删减与 SF-163 之后的残留分支，是否保留「正文管理」入口需要产品确认。
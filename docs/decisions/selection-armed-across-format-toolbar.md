# 逐选区排版在重渲染后不再失去武装

日期：2026-10-13。恢复 v1.16 已声明的「格式操作后保留选区」；这一轮第一次拿到该条款在真实运行下的证据与根因。

## 症状

在预览里选中一段文字，用工具栏的「中文字体」下拉设好字体后，「字号」下拉立刻变成 disabled；读者必须把同一段文字重新选一次才能继续。`v15-writing-fixes.mjs` 长期卡在这一步。

## 排查：先用探针，再改代码

原先的判断是「指针落到原生 `<select>` 会折叠文档选区」，据此准备把工具栏容器的 `onMouseDown` 从 `button` 扩到 `select`。挂上 `selectionchange` 探针（每次事件记录 DOM 选区长度、`document.activeElement` 的标签与 `aria-label`、以及它是否在 `.sf-format-tools` 内）后，实测否定了这个判断。一次拖选跨过加粗边界的完整记录：

```
sync-range     24→26   sync-range 24→28   sync-range 24→29   sync-range 24→31
sync-no-range  active=SUMMARY(写作进度详情) sel=8   inTools=false
sync-no-range  active=SUMMARY(写作进度详情) sel=10  inTools=false
sync-no-range  active=SUMMARY(写作进度详情) sel=11  inTools=false
sync-range     24→41   …  24→47
```

三件事因此确定：

1. **下拉从未拿到焦点**（`activeElement` 一直是进度药丸的 `summary`，`inTools:false`），所以「下拉抢焦点」不是成因，改 `onMouseDown` 解决不了。
2. 那三条 `sync-no-range` 的 **`sel` 是非空的（8／10／11）**：拖选正跨过 `**强调文字**` 边界时，`captureSelection` 对中间态映射失败，而 `sync()`（`src/client/draft.tsx:527`）**无条件**清掉 `editRange`。
3. `editRange` 一掉，两个逐选区下拉立刻 disabled——这正是「设完字体就必须重选一次文字」的来源。`sync` 里原有的 `.sf-format-tools` 焦点守卫覆盖的是按钮路径（按钮已用 `preventDefault` 保住选区），管不到映射失败。

所以真因是「**映射失败被当成取消选择**」，而不是「下拉抢焦点」。

## 决定

`sync()` 的空分支增加一个条件：**只有 DOM 选区真的为空才当作取消选择**。

```js
if (!range) { if (!document.activeElement?.closest('.sf-format-tools') && !window.getSelection()?.toString()) setEditRange(undefined); return }
```

理由：非空选区不构成「用户放弃选择」的证据，而它恰好出现在用户仍于工具栏里连续操作时；映射失败只是这一次读不出来，不代表刚才武装的范围失效。原有的焦点守卫保留——删掉它会让按钮路径在映射失败时也失去保护。

## 不做

- **不改容器的 `onMouseDown`。** 对原生 `<select>` 的 mousedown 做 `preventDefault` 有连带阻止下拉展开的风险（原生下拉是浏览器 UI，Playwright 观察不到），而实测已证明它不是成因。
- **不动 `capture()`。** 它挂在预览页的 `onMouseUp`/`onKeyUp` 上，那时选区真的是空的，清空是正确的；它在中途抛错时只显示消息、不清范围。
- 不动改写候选与选区卡片的生命周期：它们读的是同一份 `editRange`，本次只是不再在映射失败时把它丢掉。

## 验证

`v15-writing-fixes` 新增断言：设完字体后 `select[aria-label="选中文字字号"]` 仍为 enabled。修复前该下拉实测 disabled 并超时 20 秒；修复后通过，并连带过了原先卡住的整段——`selected font and size survive saving and reopening`（重载后 `楷体` 与 18.67px 仍在）与 `switching from editor to preview clears the ordinary selection`。

回归（同一构建，安装版 DSH 隔离 TEST_ONLY profile）：`v19-ai-review --phase=all` 7/7、`v17-layout` 6/6、`v16-writing-fixes` 前 5 项、`v18 --phase=layout/status/navigation` 10/10，均无回归。

`v15` 在这之后的资料／书目／导出段仍带 v1.15 时代的定位（`.sf-materials-panel [data-sf-source-id]`、按钮名 `确认同一文献`；当前是 `.sf-reference-row`／`确认是同一篇论文`），与本修复无关，另行清理。回归总表见 [实现与验证状态](../../../docs/implementation-verification-status.md)。

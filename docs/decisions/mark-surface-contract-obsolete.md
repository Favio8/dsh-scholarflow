# 标注截图与 draft-mark 套件停留在 SF-163 之前的设计

日期：2026-10-13。调查 `pnpm render:surfaces` 必失败的根因。**没有**修改标注实现，也**没有**替产品重新发明标注契约。

## 现象

`pnpm render:surfaces` 在 `scripts/render-surfaces.mjs:569` 抛 TypeError：`stack.querySelector('.sf-source-mirror')`
返回 `null`，紧接着的 `.querySelector('.sf-mark-inline')` 因此炸掉。`tests/e2e/draft-mark.mjs` 的 7 条断言里有 3 条
所依赖的 DOM 也不再存在。两者都不是 v1.20 或 `8eeb1d4` 引入的。

## 根因

SF-163 把源面板标注从"镜像文字 + 中间节点渐变"改成"覆盖在原生 textarea 上的定位芯片"。
`src/client/source-mirror.ts:41` 的 `paintSourceMark` 现在按视觉行生成 `<div class="sf-source-paper"><i/></div>`，
把状态写进 `layer.dataset.state`，置空 `host.dataset.marked`，并**删除** `host.dataset.mirrored`。
模块本身仍是活代码（`src/client/range-mark.tsx` 仍在 import `paintSourceMark`），死掉的只是两个消费者的 DOM 契约与
设计断言：

| 位置 | 断言内容 | 现状 |
| --- | --- | --- |
| `render-surfaces.mjs:423/434/436` | 探针 `.sf-source-mirror .sf-mark-inline` | 选择器已不存在 |
| `render-surfaces.mjs:569`、`auditMark:877/878` | 三段文本分割 `split.whole` / `split.slice` | 新实现没有文字副本，契约随设计一起消失 |
| `auditMark:880/881/882` | `mirror.height` / `hidden` / `events` | 没有镜像元素 |
| `auditMark:884/885/886` | `markedLook.colour` 必须透明（正文让位） | SF-163 明确"原生 textarea 字形与选区不动"，方向相反 |
| `auditMark:889/890/891` | 组合输入时镜像必须退让 | 同上，与现行设计相反 |
| `auditMark:893` | `image` 必须等于 `tokenImage`（渐变字形） | 旧渐变字形设计已不在这条路径上 |
| `auditMark:895/896/897`、`draft-mark.mjs` flow/gradient 两条 | `flow` / `settled` / `held`、渐变在 200% 缩放的可读性 | 描述旧的流动渐变标记 |
| `auditMark:869-874/879` | 芯片数量、行数、间隙、高度、是否越出内容框、与实测矩形对齐 | **仍然成立**（芯片几何） |
| `draft-mark.mjs:113/117/124/170/180/220/232/235` | `.sf-source-mirror`、`.sf-mark-inline`、`dataset.flow`、`dataset.mirrored`、`visibility` | 选择器与状态载体都已改变 |

另外 `src/client/source-mirror.ts` 的 `mirrorMetrics` 已无任何引用，`splitPaneText` 只剩
`tests/unit/source-mirror.test.ts` 在用：产品路径不再走这两个导出，它们目前只被测试自己支撑。

## 本次处理

- **不**修标注实现，也**不**新造标注视觉断言。SF-163 之后"标注该长什么样、组合输入期间该显示什么、是否还保留
  渐变"属于产品决定，不是缺陷修复；凭空写断言等于用测试固化一个未经确认的设计。
- `pnpm render:surfaces` 从 `package.json` 撤回：它在标注段崩溃、整轮产出不可用，继续挂着只会让人以为这是可跑的
  门禁。`scripts/audit-appearance.mjs` 只 import `extractCss` / `pageHtml` / `prepareSurfaceMarkup`，不经过
  `surfaces()` / `renderSurfaces()`，因此**不受影响**。
- `scripts/render-surfaces.mjs` 与 `tests/e2e/draft-mark.mjs` 保留文件，头部写明现状与复通前提。

## 复通前需要先定的产品问题

1. 芯片的视觉合同：颜色与透明度 token、渐变是否保留、200% 缩放与双主题下的可读性判据。
2. 组合输入期间的期望行为。SF-163 说原生字形不动，但缺一条可测断言。
3. 状态载体：`layer.dataset.state` 是否为唯一入口，`dataset.flow` 是否还需要。
4. 上面三条定完，再把 `checkDraftMark` / `auditMark` / `draft-mark.mjs` 按新合同重写，并清掉 `mirrorMetrics`、
   `splitPaneText` 两个无产品引用的导出及其单元测试。
# 源码输入不再重复渲染隐藏预览

日期：2026-10-13。恢复现有 SF-134／AT-134 性能合同，不改变产品需求或冻结基线。用户在查看 CPU 诊断与两文件修复范围后明确授权修改产品源码、验证及提交。

## 证据与根因

前一轮 `196c713` 的三次桌面结果是 20.4／30.9／31.6ms，后两次超过 26.51ms，见 [v1.20 收尾记录](chrome-consolidation-v1.20.md)。本轮改用 renderer CPU profile 定位，不继续重复同一门禁。

诊断命令：`node tests/e2e/workbench-performance.mjs --desktop --profile-typing`。产物 `.dsh-tmp/workbench-performance/1791866567529/typing.cpuprofile`。约 61.98 秒采样窗口中，`projectMarkdown` 包含子调用约 8.26 秒（其中解析约 6.51 秒）；三个调用上下文的 `MarkdownView` 合计约 5.53 秒；垃圾回收约 2.59 秒；`applyGutterRows` 约 1.08 秒。嵌套耗时不能相加为总 CPU 时间。采样轮 p95 31.1ms／输入 61.480 秒仅作诊断，不能当作无 profiler 的验收结果。

源码编辑时预览仅由 `hidden` 隐藏，React 仍逐键重新生成整篇预览及其子树。`MarkdownView.render` 又先生成 root 的 children，随后在 root 分支重复渲染同一批节点，第一批结果被丢弃。两段真实 React 夹具的 `afterBlock` 实际调用 **4 次**，应为 **2 次**；修复前新增回归测试在此失败。

本次确认并消除的是隐藏预览的无效渲染及根节点重复遍历，不能将所有历史波动归因于此。全文 AST 解析仍是可观察的开销，但当前选区、章节和字数继续读取实时投影。

## 实现

- `src/client/markdown.tsx`：根节点仅在带 annotations 的分支遍历一次；`MarkdownView` 用 React.memo 包装，仅在前后两次 `active === false` 时跳过更新。重新显示必定读取全部当前 props。
- `src/client/draft.tsx`：根据实际正文可见性、工具页和编辑／预览视图传入 active。隐藏时保留已挂载的 article／段落 DOM，避免拆卸造成滚动状态丢失。
- 没有改解析器、缓冲、保存、引用、排版持久化、阈值或用户项目。没有新增运行时依赖、缓存框架或第二份正文。

## 验证

`preview-rendering.mjs` 的真实 React／Chromium 检查 **3/3**：每段一次遍历；连续五次隐藏输入不再遍历且保留同一 article／段落节点；返回预览后显示最新中文、emoji、加粗及第二段文字。初验产物：`.dsh-tmp/preview-rendering/1791866856385/report.json`。补上实际隐藏／显示容器后，滚动位置仍为 50px；最终产物：`.dsh-tmp/preview-rendering/1791867264257/report.json`。该次补验覆盖了先前未实际测量的滚动保留，不是重复性能验收。

安装版 Electron、同一构建、独立 TEST_ONLY profile、串行冷启动，未启用 profiler：

| journal 目录 | p95 ms | 输入耗时 s | 脚本至清理前 s | 长任务／帧间隔 >100ms | 结果 |
|---|---:|---:|---:|---:|---|
| `1791866890903` | 16.1 | 47.518 | 86.275 | 0／0 | 通过，退出 0 |
| `1791866993818` | 17.2 | 47.880 | 85.799 | 0／0 | 通过，退出 0 |

文件均为 `.dsh-tmp/workbench-performance/<目录>/journal.json`。每轮 14,400 汉字稿件、744 个实际输入样本，43ms 名义间隔未变，AT-134 阈值仍为 **24.1×1.1 = 26.51ms**。无 Chrome／并发测试，保留原用户 Harness，系统 CPU 忙碌度 31.25%／32.97%；不是绝对空闲机器。两轮 journal 各 **13/13**，输入完整、pageerror 为 0；滚轮、跨段选区、侧栏开合／拖动、200% 缩放、保存和两主题截图通过。新增安装态断言验证输入期间隐藏预览文字未变，返回预览时末段已追上当前源码。

第二轮用于排除此前观测到的冷启动波动；之后停止重复性能验收。**本机构建的 AT-134 打字性能结论：通过。** 不代表其他硬件或任意规模稿件都已验证。

最终构建为 4,538,442 字节（相比修复前增加 142 字节，约 0.0031%），SHA-256 `fefc61e01d84b5e69f192f4b6aa8a922b12157146092b81c752b6dbb93f960b3`。构建、类型检查与 **663/663** 分层测试通过；两份新增／修改 e2e 的 `node --check` 通过。

相关安装态回归：

- `v15-writing-fixes` **7/7**：连续选区、字体字号保存恢复、编辑／预览切换、书目与 Word 导出。证据 `.dsh-tmp/v15-writing-fixes/1791867171635/report.json`。
- `v19-ai-review --phase=all` **7/7**：候选原稿保护、恢复、不重复生成、一次采用／保留、停止和失败重试，以及 390px 导航。证据 `.dsh-tmp/v19-ai-review/1791867212341/report-all.json`。模型为固定测试替身，零真实模型调用。

额外执行的 `pnpm render:surfaces` **未通过**：`scripts/render-surfaces.mjs:569` 在 `checkDraftMark` 中读取不存在的 `.sf-source-mirror` 后调用 `querySelector`。当前 `src/client/source-mirror.ts` 的 SF-163 实现只绘制背景 chips，已不创建旧的文字镜像；渲染脚本仍要求旧镜像、透明源码文字和彩虹字形。上述脚本、source-mirror、source-measure、gutter-rows 相对 `196c713` 均无变化，故记录为既有静态门禁与 v1.15 合同不一致，不归因于本次 memo，也不改回旧产品行为来迎合它。原始错误 `.dsh-tmp/typing-performance-surfaces.log` 保留；**不能宣称完整 AT-134 镜像／换行静态门禁已通过**，本文“通过”严格限定本次打字性能及上列实际回归。

产品源码修复、上述测试、构建完成；包未发布。已运行的用户 Harness 仍需保存后重启，才能加载新的客户端构建。用户论文、profile、原始资料未修改。

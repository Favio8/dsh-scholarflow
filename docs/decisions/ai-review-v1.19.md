# 一键 AI 检查与修订

日期：2026-10-12。合同为文档工作区 PRD／SPEC v1.19，用户已授权实施。包版本保持 1.0.0。

## 实现与用途

- SF-179：`review-run-ui.ts` 使用 shared/runs.ts 的 succeeded／completed-with-issues。修正此前成功返回报告却被当作未完成的问题，测试执行器不再使用不存在的 completed 状态。规则检查与未完成 AI 检查分别呈现，执行结束及明确采用不冒充论文事实全部通过。
- SF-180／181：顶部保留正文视图、五节点和更多；删除重复资料／检查入口。检查页只有 AI检查标题、短用途说明和主按钮，计数、规则标签、长列表、单条修订和运行历史进入查看详情。预览就绪后只提供采用修改／保留原稿；实际缺少原文才提示补充资料。
- SF-182：`review-assistant.tsx` 串联既有规则、模型审查及段落修订服务。`core/review/improvements.ts` 按 AST 校验的普通段落分组，将同段全部问题交给一次生成；修订按文稿顺序展示，引用采用主稿同一显示规则。现有 pending Proposal 恢复后可继续，未保存候选不算成功。
- SF-183：`review.applyImprovements` 在项目锁内验证同项目、当前正文版本、已展示候选哈希、原文／选区、引用、依赖原材料与修复问题依据；全部验证后通过既有文稿事务一次提交新正文、书目、前稿快照、排版映射和全部采用状态。所有段落共享一个新修订；重叠、过期、拒绝、跨项目或改变问题依据时整批不写入。采用后的规则复查失败仍如实返回已保存结果。
- SF-184：停止中止当前真实调用，已完成候选保持。重载只读恢复；继续复用当前有效报告及已有候选，仅生成缺少的段落。拒绝保留原稿，编辑缓冲变化时采用被禁用。检查及候选观察在操作结束后读取稳定快照，避免把正常保存过程中的读取冲突显示成永久错误。

没有增加新的正文事实源、Agent Loop、通用权限框架或付费上限。两个新增 Remote 均限定操作者并复用 resolveStore。基线文档位于上一级 docs，v1.0–v1.18 保持冻结，入口索引已更新。

## 定向证据

生产构建与类型检查通过。新增 `tests/integration/review-improvements.test.ts` 的 8 个用例覆盖真实终态、三问题分两段、候选恢复、一次事务与重放、拒绝、过期／篡改／重叠／跨项目、未改段排版移动，以及已有全文不误报缺资料。既有问题修复的 7 个集成用例、节点投影的 7 个用例及启动合同 3 项也分别验证；没有运行无关的本机全量业务回归。

`tests/e2e/v19-ai-review.mjs` 使用安装的 Windows DSH 0.2.0-rc.2 Host、生产客户端、本机 Chrome 和 `.dsh-tmp/v19-ai-review/1791783450439/` 的独立 TEST_ONLY profile。

模型调用采用明确的 TEST_ONLY 固定适配器；审查／生成执行实际调用 core 的 executeModelReview／executeGeneration，真实保存计划、运行状态、报告、修订和检查点，以 shared/runs.ts 校验终态。保留安装 Host 的实际 HTTP envelope 与 applicationResult 合同，不伪造成功状态。批量采用、拒绝、资料查看与项目恢复调用真实 Host Remote。没有付费模型调用，没有修改用户论文；这些证据不代表真实模型论文质量评审。

| 合同 | 报告与观察 |
|---|---|
| AT-179–182 | report-all.json：默认一个主动作、详情折叠、重复导航消失；一次检查的真实 completed-with-issues 生成两段预览，同段两问题只调用一次，原稿未改、引用显示为正常编号 |
| AT-183 | report-all.json：重开预览不重放模型，普通采用按钮一次保存两段到同一修订；保留原稿一次拒绝整批；report-guard.json：按文稿顺序预览，未保存编辑保留且采用禁用 |
| AT-184 | report-stop.json：第二段调用真实取消，第一段候选保留；重开无模型调用；继续只生成缺少的一段；report-continue.json：终止测试进程后仍能恢复已保存候选并继续；report-scope.json：等待审查返回时切到另一项目，旧结果不触发修订生成，也不进入新项目界面 |
| 失败与布局 | report-failure.json：真实 failed 终态在当前页提供重试并保留规则结果；report-layout.json／report-guard.json：390px 工具栏不溢出，修改预览改为一列且可读 |

报告合计 10 项浏览器检查通过，page errors 为 0。默认与预览截图已查看。最初测试适配器省略实际 HTTP envelope，随后改为保留真实 envelope；停止测试按真实 applicationResult 转译取消异常，避免测试进程先退出。测试逐步恢复未完成步骤，没有为测试修改业务终态合同。

## 安装

本机 desktop profile 以 junction 链接本仓库，生产 dist 随构建更新。隔离安装 Host 已验证新增接口及客户端。当前用户 Desktop 未被强制关闭；本轮新增 Host Remote，需要重启 DSH 载入新 Host／客户端。未改写用户资料、论文、模型配置或 profile 控制文件，未发布 npm 包。

# 五节点流程状态与页面导航

日期：2026-10-12。合同：文档工作区 `../docs/ScholarFlow_PRD_v1.18.md` 与配套 SPEC；用户已明确授权实施。包版本保持 1.0.0。

## 实现

- SF-175：`src/client/flow-navigation.tsx` 绘制节点、连接线和小字状态，复用暖纸 tokens。工作台工具栏以 grid 布局连接正文视图、流程导航、资料／检查和更多；内容宽度不超过 850px 时流程单独占第二行，440px 以下采用紧凑间距。
- SF-176／178：`src/client/flow-status.ts` 将真实 WritingTask、当前 ledger／document 及 review.inspect 结果投影为五节点。图标表示执行状态，下划线表示正在查看的位置。任务完成不等于审查完成，unknown／实际问题继续显示待处理；未保存编辑、正文版本或资料依赖更新使已有报告显示需复查。
- SF-177：`src/client/plugin.tsx` 共享导航和章节结构打开状态。大纲节点、目录入口、返回正文与原工具按钮保持同步；正文组件继续挂载，编辑／预览选择和未保存缓冲保留。访问节点不启动模型、不保存正文、不完成阶段。
- SF-178：WritingProgress 的既有 onTask 回调共享当前任务及已保存要求，ReviewExport 共享其已有报告读取，ModelReview 发布运行／暂停／停止／失败状态。沿用工作台 binding 检查隔离迟到快照，切换会话重建对应观察组件。不新增任务轮询、后端协议、持久化文件或状态机。

## 验证

`pnpm typecheck` 和生产 `pnpm build` 通过。`node --test tests/unit/flow-status.test.ts tests/integration/review-presentation.test.ts` 的 8 个测试通过：空稿、当前要求／大纲、选用资料状态、暂停／停止／失败、历史待补不污染新正文、真实规则检查的 unknown、正文变更失效、全通过报告和未保存编辑分别验证。

`tests/e2e/v18-flow-navigation.mjs` 使用 Windows 的真实安装 DSH 0.2.0-rc.2 Host、生产客户端及独立 TEST_ONLY profile。浏览器为本机 Chrome，未调用付费模型，未修改用户论文。模型响应和活动任务 status 使用明确的 TEST_ONLY RPC seam；项目保存、章节结构、规则检查、任务记录与报告依赖检查走真实 Host，不把模拟响应当成模型质量验收。

证据目录：`.dsh-tmp/v18-flow/1791778351502/`。

| 合同 | 实际证据 |
|---|---|
| AT-175 | `report-layout.json`：1640px 工具栏同行，740px／390px 内容区第二行，五节点可见，右侧操作中心一致且连续，scrollWidth 等于内容宽度；宽、窄、紧凑与深色截图 |
| AT-176 | `report-all.json`：实时研究／证据／大纲／正文阶段，查看资料时正文仍运行；暂停／停止真实呈现；初稿完成没有令检查变绿；`report-review-failure.json`：有报告的失败／暂停／停止仍显示真实终态 |
| AT-177 | `report-all.json`：五节点定位、目录与返回同步、旧资料按钮同步、Enter 导航；未保存正文经全部节点切换仍保留，主稿哈希不变，无生成／检查／主稿写入动作 |
| AT-178 | `report-all.json`：保存的任务阶段经已有轮询更新，检查后台执行，规则未知仍为琥珀色；未保存、保存及页面冷重载后均正确提示报告需复查；`report-scope.json`：检查响应挂起时切到另一论文项目，释放旧响应后新项目正文／检查仍待开始／待检查，没有混入旧项目状态 |

首次完整浏览器检查完成 7 项后在窄栏发现末节点因 flex:0 被压成零宽，连接线把按钮挤出边界；将末节点改为保持自身宽度后，仅恢复布局阶段并通过。新增检查失败／暂停／停止测试和切换项目后的迟到响应各另运行一次。各报告合计 10 个不同的浏览器检查通过，页面错误为 0；没有重复已成功的导航／编辑／阶段检查或运行无关全量测试。

## 安装与当前窗口

Desktop profile 的 `node_modules/dsh-scholarflow` junction 指向本仓库，生产 dist 已更新，隔离真实 Host 已加载并验证当前构建。当前正在运行的用户 Desktop 未被强制关闭或重启；重新启动 DSH 后载入新客户端。没有改写用户论文、资料或 profile 配置。

v1.0–v1.17 设计文档保持冻结；v1.18 PRD／SPEC 同目录互相引用，文档区与代码仓库 AGENTS 入口已更新。文档工作区没有独立 git 仓库，基线保留在上一级 docs；源码、README、代码仓库索引、测试和此实现记录通过代码仓库提交。

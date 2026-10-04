# ScholarFlow

DeepSeek Harness 学术项目工作区插件。当前版本 **0.1.0-dev**，尚未完成 V1 产品验收。

已在 DSH **0.2.0-rc.2 / Windows** 真实验证：插件启动、ScholarFlow Mode、工作台侧栏入口、
复用宿主会话面板、宿主设置保存与重启恢复、中文工作区身份、会话沙箱写入与只读拒绝。
ScholarFlow 的预设提供九个受控学术工具，并限制继承工具、安装同步守卫。
工具按实际 Agent 绑定项目；普通 Mode 的工具和提示词保持独立，空白会话切换后能恢复。
生产启动不再自动调用模型执行 G0 探针。

已实现初始化预览／取消／确认、输出碰撞检查、项目 ledger、短期写锁、版本校验、
事务恢复确认和外部改稿检测。配置缺省值只作用于读取，未知键显示警告，不覆盖用户 YAML。
已接入资料清单／明确登记、TXT/MD/文字 PDF/DOCX 受限解析，以及来源、定位证据、
支持范围论点和小大纲的确认与恢复。扫描 PDF 无 OCR，图表／公式内容不冒充已核验。
已接入 Markdown 手工编辑与渲染预览、带 UTF-16 源码位置的浏览器选区、不可变建议、
差异接受／拒绝、版本冲突拒绝和新修订撤销。已实现确定性审查、带理由的问题处理、
审查过期判断，以及同版本 Markdown／BibTeX／质量报告工作草稿快照与下载。
有限模型阶段已通过真实 DeepSeek 提供方测试：按确认大纲生成单节候选后接受、第二重复段落缩写后接受、
取消并保存运行终态。规则测试的模拟适配器仍明确标记 TEST_ONLY。
章节位置通过带源位置的 Markdown 标题 AST 校验；重复标题与层级冲突阻止生成。
新节插入不删除原稿，重写已有本节时保留标题、子节与相邻章节。候选显示实际段落论点映射、
引用和缺口，接受后记录当前正文锚点；映射不提升论点支持状态。正文可导航标题和查看章节保存状态。
手工段落关联／重新定位／解除需明确确认；同文重复段落不会被猜测重连，旧稿建议不能覆盖新稿。
要求可从已解析材料保守提取，冲突需选择并记录理由，篇幅统计口径需确认。
项目文风和确认记忆提供版本校验编辑；六个工作区页面支持键盘切换和窄屏布局。
外部记忆变更需要明确确认后才进入模型上下文。未提交正文按会话暂存到宿主，
刷新和重连可恢复；恢复旧缓冲不会绕过主稿版本校验。
工作台可主动刷新，空闲时同步其他会话的项目状态；保留本会话未提交编辑。
已接入需预览确认的 Crossref 单次元数据查询、候选纳入／排除理由和 DOI 核验。
不下载全文，身份匹配不会自动生成证据或覆盖既有来源；请求和冲突结果保留检查点。
已接入设置页中的私有 Skill 库：Host 本地目录与公开 GitHub 候选导入、原文与完整文件树
预览、不可变摘要版本、脚本静态保存。GitHub 固定 commit，遇到限流、链接或截断响应停止。
安装不改项目绑定，也不写普通 Skill 目录。Overview 可确认固定版本、作用阶段和优先顺序，
支持显式更新／禁用；新项目提供四份内置规则供明确选择。旧锁格式在确认迁移时完整归档。
写作阶段冻结实际 Skill 说明和限定文本参考，保存运行快照；选区菜单筛选兼容的改写项。
会话工具只读取本项目调用阶段的启用项。卸载先检查本机已登记项目和历史运行引用，
有引用或状态未知时拒绝；确认后仅移入私有回收区，保留完整资源字节。
项目本地 Skill 可从 .scholarflow/skills/namespace/id/ 读取，完整资源和 scholarflow.json 路由侧车
共同形成固定摘要。当前工作区的专用字节读取通道拒绝链接、硬链接、敏感文件及范围外路径；
不放开原始资料读取器对元数据的限制。项目资源改变时旧绑定拒绝加载，确认新摘要后才能重新启用。
已有运行冻结实际说明；附带二进制资源和脚本仍静态保存，不执行。项目资源复制／编辑入口尚待完成。
正文页提供持久运行历史；新运行以 run.json / input.json 为事实源，旧存储可预览后明确迁移，保留原字节与迁移档案。
写作支持暂停、确认恢复、结束中断记录与关联新运行重试；已保存候选复用、预算保留，已接受建议不重放。存活进程不能被新执行器接管。
已验证的 DeepSeek 文本阶段对临时服务错误最多自动重试两次，遵守提供方等待窗口；认证／配置错误不自动重试。其他提供方的内部重试仍需独立审计。
完整工作流、模型辅助审查、多查询检索阶段和全部 V1 验收仍在开发。
大纲支持手工编辑、父子关系、篇幅目标、证据缺口、重排和删除；预览保存草稿与确认分开，保留历史及正文，旧章节候选需更新。
此页面不会将集成验证当成完整产品交付。

## 开发与验证

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
# 可选：真实安装环境，独立 DSH_HOME，不改 desktop profile
node tests/e2e/installed-host-smoke.mjs
# 可选：使用现有 Host 凭据服务发起有限真实模型测试（会产生提供方费用）
node tests/e2e/installed-host-smoke.mjs --live-model
# 可选：真实 Crossref 查询和 DOI 核验，不调用模型，不读取模型凭据
node tests/e2e/installed-host-smoke.mjs --live-research
# 可选：真实公开 GitHub Skill 导入，不调用模型，不执行导入资源
node tests/e2e/installed-host-smoke.mjs --live-skills
```

构建生成 dist/host.js、dist/agent.js 和 dist/client.js；安装源码链接前必须先构建。
客户端复用宿主 React；加载 factory 内声明局部 CommonJS 对象，避免 exports is not defined。
构建产物和依赖不入 Git，pnpm pack 会先构建。

## 实现依据与证据

- 产品基线：../docs/ScholarFlow_PRD_v1.0.md
- 实现合同：../docs/ScholarFlow_Design_SPEC_v1.0.md
- 最新真实宿主验证：[G0 installed Host](docs/g0-installed-host-2026-10-04.md)
- 项目持久化验证：[M1 project store](docs/m1-project-store-2026-10-04.md)
- 本地证据链验证：[M2 local evidence](docs/m2-local-evidence-2026-10-04.md)
- 编辑、审查与交付验证：[Editing and delivery](docs/editing-delivery-2026-10-05.md)
- 私有库导入边界：[Private Skill storage](docs/decisions/private-skill-storage.md)
- 历史验证：[integration-verification](docs/integration-verification.md)
- 版本范围：[compatibility](docs/compatibility.md)

Core 不依赖 DSH、React 或模型 SDK。Markdown 为唯一正文，原始资料只读；
AI 修改须先生成建议、由用户接受后再受控写入。无证据和未做实验不能宣称完成。

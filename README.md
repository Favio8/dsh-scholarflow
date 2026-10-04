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
有限模型阶段已通过真实 DeepSeek 提供方测试：全文候选拒绝、第二重复段落缩写后接受、
取消并保存运行终态。规则测试的模拟适配器仍明确标记 TEST_ONLY。
要求可从已解析材料保守提取，冲突需选择并记录理由，篇幅统计口径需确认。
项目文风和确认记忆提供版本校验编辑；六个工作区页面支持键盘切换和窄屏布局。
外部记忆变更需要明确确认后才进入模型上下文。未提交正文按会话暂存到宿主，
刷新和重连可恢复；恢复旧缓冲不会绕过主稿版本校验。
工作台可主动刷新，空闲时同步其他会话的项目状态；保留本会话未提交编辑。
完整工作流、模型辅助审查、在线检索、私有 Skill 库和全部 V1 验收仍在开发。
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
- 历史验证：[integration-verification](docs/integration-verification.md)
- 版本范围：[compatibility](docs/compatibility.md)

Core 不依赖 DSH、React 或模型 SDK。Markdown 为唯一正文，原始资料只读；
AI 修改须先生成建议、由用户接受后再受控写入。无证据和未做实验不能宣称完成。

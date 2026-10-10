# AGENTS.md — dsh-scholarflow 代码仓库

本目录是 **ScholarFlow** 的代码仓库：一个 **DSH（DeepSeek Harness）插件**，由 git 追踪并已连接 GitHub 远端。

## 仓库信息

- 远端：<https://github.com/Favio8/dsh-scholarflow.git>（`origin`）
- 主分支：`main`（跟踪 `origin/main`）
- 仓库定位：本目录只放代码，是项目唯一的源码仓库。

## 核心规则

### 规则一：本目录负责代码，不负责文档

- 本目录（`dsh-scholarflow/`）用于存放插件源代码、脚本、配置与测试。
- **PRD 等开发过程中的设计文档不放这里**，统一放在上一级目录 `../docs/`，参见 `../AGENTS.md`。
- 本仓库内的 `docs/` 只放**代码仓库自身必需**的说明性文档：`README.md`、`integration-verification.md`（G0 验证记录）、`compatibility.md`、`decisions/`（实现期 ADR 落地记录）。产品与设计基线不在此处复制，避免两份事实源漂移。

### 规则二：开工前必读设计基线

实现任何功能前，先读上一级目录的当前基线文档（v1.10），并按版本链（v1.0 → v1.10）理解其条款，规则见 `../AGENTS.md` 规则三：

- `../docs/ScholarFlow_PRD_v1.10.md` — 产品范围与交互的唯一依据（按版本链 v1.0→v1.10 读，最新版只写新增或替代条款）
- `../docs/ScholarFlow_Design_SPEC_v1.10.md` — 数据结构、状态机、接口与测试约束的唯一依据

重点章节（章节号取自 v1.0 SPEC；后续版本若修订这些条款，以版本链中最新的修订为准）：SPEC 第 0.1 节（先实现的最小纵向切片）、第 2 节（`G0` 门禁）、第 3 节（分层职责）、第 4 节（建议仓库结构）、第 4.1 节（技术选择）、第 21／22 节（API 与工具合同）、第 28 节（测试设计）、第 29 节（实施 Backlog）、第 33 节（实现红线）。

**`G0` 门禁：** DSH 真实插件类型、Slot 与 Remote 协议必须以固定版本的官方源码与类型为准。不得把“DSH 有插件机制”推导成“任意布局、任意会话切换和任意权限都能直接实现”；未经验证的集成点先用最小原型证实，并留下验证记录。

### 规则三：先跑通最小纵向闭环

不要先铺满所有页面再接假数据。第一阶段只跑通 SPEC 第 0.1 节的最小切片：

```text
当前 DSH Workspace → ScholarFlow 新会话 → 确认初始化 → 注册一份本地资料
→ 提取带定位的证据 → 建立论点和一份小大纲 → 生成一段有引用的 Markdown
→ 渲染选区改写 → 预览并接受差异 → 保存、关闭、恢复 → 导出正文与审查报告
```

没有证据层时，不得实现一个泛化 Writer 并宣布完成。示例、Mock 和测试固定数据必须显式标记，不能冒充真实在线检索结果；未支持的格式与接口应返回明确的能力不足。

### 规则四：目录职责（按 SPEC 第 4 节）

```text
src/shared/     # 请求、响应、持久数据的运行时校验；types / errors / events
src/core/       # 领域层：project store materials research evidence outline
                #         writing editing review skills pipeline export
src/host/       # DSH 宿主集成：bridge gateway tools providers parsers persistence
src/client/     # 客户端：bridge workspace settings editor agent-panel stores locales
presets/        # 三类论文任务默认值、writing、review
academic-skills/  agent-preset/  skills/  templates/  tests/  examples/  docs/
```

这是**最终责任分层，不要求预建空类、空目录或未使用的抽象**。单一 Source 服务足够时不先拆工厂；工具注册文件不得包含领域规则的另一份副本。

### 规则五：架构红线

- **Core 层不依赖 DSH、React 或具体模型 SDK**（ADR-002）：文件语义、证据、补丁与状态机必须可独立测试。
- 主稿以 **Markdown 为唯一正文事实源**（ADR-004）；Markdown 结构解析必须走带源位置的 AST 路径，**禁止用正则做整篇结构解析**。
- 结构化项目数据使用小型 JSON ledger（ADR-005）；多文件变更必须有事务日志与恢复规则。
- 原始材料默认**只读**，输出写入范围需显式确认（ADR-006）：不重排资料、不隐式覆盖已有论文。
- AI 修改必须先 **Proposal → 用户接受 → 受控写入**（ADR-009），保留引用与人工编辑。
- Pipeline 状态机决定执行，**模型不得自报完成**（ADR-010）；检索失败、无证据、预算耗尽都要有明确终态。
- 外部 Skill 仅作说明性执行，**不执行其附带脚本**（ADR-008）；安装不等于启用（ADR-007）。
- 真实性、权限、跨项目隔离等硬性规则**不能被 Profile / Skill 覆盖**（ADR-014），不设 `allow_fabricated_results` 之类可被打开的开关。
- **不修改 DSH 核心，不接管普通会话，不创建第二套 Agent Loop 或聊天系统**（ADR-011／ADR-012）；默认复用宿主已有的模型、会话与授权能力。
- 技术栈以 TypeScript 为主，前端遵循宿主当前框架与组件约定，优先复用宿主 UI primitives。

### 规则六：git 使用规范

- 所有改动通过 git 提交，保持 `main` 与远端同步（`git push`）。
- 提交信息使用英文，格式 `emoji type: description`。type 取 `feat` / `fix` / `docs` / `refactor` / `test` / `chore`。
  - `✨ feat: add project initialization with collision checks`
  - `🐛 fix: reject stale selection edits before applying changes`
  - `✅ test: cover project isolation and skill import validation`
  - `♻️ refactor: separate domain services from DSH integration`
- 提交前先确认 `git status` 与 `git diff`；不提交构建产物、依赖目录与密钥文件。
- 不自动创建额外仓库、不发布 npm 包、不推送用户的其他项目。

### 规则七：验收与报告口径

- 所有 P0 需求必须有实现与对应的测试；缺陷级别用 `B0/B1/B2`，不与产品优先级 `P0/P1/P2` 混用。
- 测试分层按 SPEC 第 28 节：`tests/unit`、`integration`、`e2e`、`contracts`、`fault-injection`、`fixtures`。
- 覆盖 SPEC 第 33 节的完成检查与实现红线；原文件与全局 Skill 不得被污染，中断必须可恢复。
- **文档生成、代码实现、测试通过、发布成功必须作为不同状态分别报告**，不得混为一谈。
- 任何一项数据保护、跨项目隔离、错误目标修改、伪造学术结果的发布阻断测试失败，都不能作为正式 V1 交付。

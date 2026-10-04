# dsh-scholarflow

ScholarFlow —— DSH（DeepSeek Harness）**学术项目工作区插件**。

> **当前状态：G0 技术验证阶段骨架。** 下面写的是本仓库**现在真实具备**的能力，不是规划承诺。

## 已实现（本仓库当前代码）

- 一个零依赖的 DSH host-plane bundle（[`package.json`](package.json)、[`cordis.patch.yml`](cordis.patch.yml)、
  [`src/host/index.js`](src/host/index.js)、[`src/host/impl.js`](src/host/impl.js)），
  已在本机 desktop profile 完成安装、启用、停用验证；回滚脚本见
  [`scripts/rollback-profile.ps1`](scripts/rollback-profile.ps1)。
- **一个可被 roster 认可的 Mode 声明**：`cordis.patch.yml` 里一行
  `@deepseek-ai/dsh-agent-preset`（`id: scholarflow`）。实测该 Mode 出现在
  `agentPresets` roster 中、未改动其他 Mode 的默认值；但**它目前不声明任何真实能力**。
- **G0 验证探针**（`src/host/impl.js` 中的 `runProbes`）：在本机真实宿主上实测了
  Mode 注册、工作区身份、文件读写与边界、设置命名空间投影、模型调用与取消、生命周期。
  这些探针是**验证脚手架，不是产品功能**。

## 未实现（规划项 —— 不要当作已具备的能力）

以下**全部尚未实现**：ScholarFlow 工作台与 Agent 面板（客户端半体尚未编写）、
插件设置页（受宿主 `node_modules` 解析阻塞，见下）、FileGateway 受控写入、
AgentExecutor 受控阶段、私有 Academic Skill 库、项目 ledger／事务／
Proposal／差异接受／Review／导出，以及依赖它们的任何产品流程。

- **最小客户端半体**（[`src/client/index.js`](src/client/index.js)）：在宿主受支持的
  typed Slot 上注册一个 `main` 工作台面板、一个 `sidebar.panellist` 侧栏入口和一个
  `settings.section` 设置页。三处内容均为显式标注的「G0 骨架 · 非产品功能」占位，
  **不查询宿主私有 DOM、不覆盖全局样式**（CSS 全部限定在 `.sf-` 前缀下）。

本插件当前**不注册**任何 Host 工具，也不写入任何项目文件。Host 侧除 Mode 行声明与
G0 验证探针外没有其他行为。

## G0 验证进度（详见 `docs/integration-verification.md`）

| 项 | 状态 |
|---|---|
| G0-01 安装 | ✅ 已实测通过 |
| G0-02 Mode | ✅ 已实测通过（UI 选择器未验） |
| G0-03 身份 | ⚠️ 部分通过（workspaceId／根路径／sessionIds 已取得） |
| G0-04 UI | ⚠️ 客户端半体已编写，且实测**已被服务并注入页面启动图**；渲染／三栏共存／截图未验证 |
| G0-05 设置 | ⚠️ 机制已走通：schemastery `Config` 已被 loader 读取并物化默认值；
  **设置页投影仍未出现**（`describe()` 为 0），已排除 4 个原因，剩余待查 |
| G0-06 模型 | ✅ 已实测通过（真实模型调用 + 可取消） |
| G0-07 文件 | ⚠️ 读／边界／订阅通过，**并已自建 Core 边界策略（19/19 离线测试通过）**；写入被沙箱拒绝，真实会话下的许可待验 |
| G0-08 Skill 隔离 | ✅ 已实测通过（A/B 两 scope 互不可见，全局 catalog 无夹具泄漏） |
| G0-09 会话恢复 | ✅ 已实测通过（`storageDomain` 跨进程读回；域名不得含连字符） |
| G0-10 生命周期 | ⚠️ loader 行移除 ✅、**AT-25 停用/启用后用户数据逐字节未变 ✅**；`ctx.effect` 清理回调与卸载未验 |

## G0 验证记录

- [`docs/integration-verification.md`](docs/integration-verification.md) —— G0-01～G0-10 逐条结论，
  每条区分「已实测 / 官方文档说明 / 仍未知」。
- [`docs/compatibility.md`](docs/compatibility.md) —— 验证所用 DSH 版本与插件协议版本。
- [`docs/decisions/`](docs/decisions/) —— 实现期决策记录。

## 产品与设计基线

产品与设计基线**不在本仓库**，避免两份事实源漂移：

- `../docs/ScholarFlow_PRD_v1.0.md` —— 产品范围与交互
- `../docs/ScholarFlow_Design_SPEC_v1.0.md` —— 数据结构、状态机、接口与测试约束

## 开发红线（摘自设计基线，实现时不可绕过）

不修改 DSH 核心；不接管普通会话；不创建第二套 Agent Loop 或聊天系统；
不用 `querySelector` 劫持宿主 DOM、不做全局 CSS 覆盖、不做猴子补丁；
Core 层不依赖 DSH／React／模型 SDK；Markdown 结构解析必须走带源位置的 AST；
原始材料只读；AI 修改必须经 Proposal → 用户接受 → 受控写入；不伪造检索结果与引用。

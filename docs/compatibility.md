# 兼容性记录（ScholarFlow × DSH）

> 本文件记录**验证时使用的真实版本与协议事实**，以及尚未验证的范围。
> 未实测的平台与能力一律标「未验证」，不写「全平台支持」。
>
> 事实来源：2026-10-04 在本机真实 DSH 上的实测。逐条证据见
> [`integration-verification.md`](integration-verification.md)。

## 1. 验证矩阵

| 项 | 值 | 状态 |
|---|---|---|
| DSH 版本 | **0.2.0-rc.2** | 已实测 |
| DSH 形态 | **Desktop（Electron 44.0.0）** | 已实测 |
| DSH 安装运行时 | node **24.18.1**（插件进程内实测） | 已实测 |
| 官方 bundle 版本 | 全部 `0.2.0-rc.2` | 已实测 |
| OS | Windows 11（`NT 10.0.26200.0`），x64 | 已实测 |
| profile | `desktop`（产品表面）、`scholarflow-g0`（宿主平面验证夹具） | 已实测 |
| 插件协议 | 见第 2 节 | 已实测 |
| DSH Web 独立部署 | — | **未验证** |
| macOS / Linux | — | **未验证** |
| 远程（非 loopback）浏览器 | — | **未验证** |
| DSH 其他版本 | — | **未验证**（本项目只对 `0.2.0-rc.2` 负责） |

> 官方仓库自述处于快速迭代预览阶段，因此**不以浮动 `latest` 作为测试依据**；
> 升级 DSH 后必须重跑 G0 相关项。

## 2. 插件协议事实（均为【已实测】）

### 2.1 打包与加载

| 事实 | 形式 |
|---|---|
| bundle 声明 | `package.json` → `dsh.bundle.patch` 指向本包的 Cordis patch 文件 |
| 客户端半体声明 | `package.json` → `dsh.client`（`{ inject: [...client modules], platform: 'web' }`） |
| patch 文件语法 | 顶层数组；`- insert: [{ id, name, config }]` 追加 loader 行 |
| host 半体入口 | `exports['.']`（本项目 G0 为 `src/host/index.js`）；模块导出 `name` / `inject` / `apply(ctx, config)` |
| client 半体入口 | `exports['./client']`；文件形状 `window.__ModuleLoader__.load({ id, factory })`，`factory` 内 `exports.inject` + `exports.apply(ctx)` |
| profile 组合顺序 | 各 bundle 的 patch 层 → profile `cordis.patch.yml` → `--patch` 覆盖层 |
| 安装方式 | 本地绝对路径经 pnpm 生成 `link:` 依赖；**离线可完成** |
| profile 生效方式 | `desktop` 为 **live profile**：安装／启用／停用返回 `application:"applied"`，**无需重启** |
| profile 组合归属 | **`desktop` 由 Electron 应用独占管理**：`dsh desktop --dump-config` 被拒绝（`error: profile "desktop" is managed exclusively by the Electron application`）。因此 desktop 的组合树无法用 CLI 转储，只能经 `plugin_manager` 或应用内界面观察。 |
| **bundle 选择须实测** | `dsh.profile.bundles` 可能在会话期间变化（本项目实测到过一次不明原因的移除）。任何依赖 desktop 生效的结论，执行前必须先读一次 profile 组合。 |

### 2.2 运行期约束

| 约束 | 内容 |
|---|---|
| **不得依赖裸标识符导入（但依赖可声明）** | 初始实测 `schemastery`、`zod`、`cordis`、`@deepseek-ai/dsh-tools` 全部 `ERR_MODULE_NOT_FOUND`。**根因已查明**：`link:` 安装不会安装被链接包的依赖，且 profile 的 `node_modules` 存在指向已删除 npx 缓存的悬空 junction。**在本包内 `pnpm add` 后两端均可导入**（实测 `zod 4.6.5`、`schemastery 3.18.0`，`probe:module-resolution` 返回 `resolved`）。宿主自身能力仍应经 `ctx` 取得。 |
| **服务注册晚于 `apply`** | `apply` 时刻 20 个候选服务可用；约 2 s 后 **28 个可用**。晚到者含 `workspaceRegistry`、`workspaceController`、`workspaceFiles`、`sessionController`、`sessionSkillCatalog`、`webServer`、`credentials`、`pluginManager`。需用 `inject` 声明硬依赖，或在组合稳定后重读。 |
| **卸载回调** | `ctx.on('dispose', fn)` **不触发**；使用 `ctx.effect(() => disposer)`（本机所有可工作插件的写法）。 |
| **模块缓存** | loader 以解析后 URL 为模块键且不带查询串；`hmr` 配置为 `root: []`（不监听）。改动 host 代码需重启进程，或使用 ADR-002 的 mtime 版本化入口。 |
| **插件自有持久化** | 推荐 `ctx.storageDomain.open(DomainSpec)`；`DomainTableSpec.valueSchema` 需 **zod**（已装 v4）。实测跨进程持久成功。**约束：域名不得含连字符** —— `sf-probe-5` 返回 `malformed-medium`，而 `sf_probe6`／`scholarflowprobe`／`sfprobe4` 均正常。`layout` 默认 `single`（介质为 `<DSH_HOME>/storages/<name>.json`），`per-record` 为同名目录，两者都可用。 |
| **`ctx.fs` 写入沙箱** | 写 `DSH_HOME` 与**工作区**均返回 `FS_SANDBOX_DENIED`；仅 OS 临时目录实测可写。`writeText`/`editText` 有 `sandboxPolicy` 参数，尚待确定合法取值。**注：该结论来自无会话/权限上下文的 CLI 验证进程**；desktop 真实会话下的许可范围尚未测。 |
| **`ctx.fs` 不做授权** | `fs.resolve` 会成功解析 `..` 越界、`C:\Windows\win.ini`、`CON`、同前缀兄弟目录；包含关系须用 `fs.contains`（实测行为正确）。 |
| **`ctx.fs` 无 mkdir** | 目录创建只能经 `node:fs`；而 `node:fs` **不受 `ctx.fs` 沙箱约束**——沙箱不是操作系统级隔离。 |
| **`fs.readBytes` 语义** | `maxBytes` 是**整文件大小上限**，不是单次切片长度（9.7 KB 文件传 64 → `FS_TOO_LARGE`）。 |
| **`Config` 需要 schemastery** | 纯 JSON Schema 与 zod schema 声明 `Config` 都**不产生**设置命名空间且无报错；换 schemastery 后 loader 立即读取并物化默认值（`apply` 收到 `{g0ProbeMarker:"", defaultProjectType:"course-paper"}`）。官方 schema 投影为 schemastery 内部 `{uid, refs, dict}` 形态。 |
| **设置命名空间** | `settings.describe()` 的 `ns` ＝ profile loader entry id。本项目已声明 schemastery `Config`（loader 确认读取并物化默认值）并注册 `settings.configure({auto:true})`，但**投影始终为 0**；已排除 7 个假设。本机可工作的第三方插件改为自建 `settings.section` 页面（path B），SPEC §11.1 允许该做法。 |
| **入口壳须转发全部导出** | `Config` 等 loader 识别的导出若未从入口模块转发，会**静默丢失**（无报错、无诊断）。 |
| **Mode 注册** | 组合树中一行 `@deepseek-ai/dsh-agent-preset`，`config` 为 `PresetDefinition { id, name?, description?, order?, plugins[] }`；或 `ctx.agentPresets.register(definition)`。 |
| **Mode 选择限制** | `select(agent, preset)` 仅限「before a session starts its first turn」；`recompose` 仅限 blank Agent。 |
| **模型复用** | `ctx.llm.stream(GenerateOptions)` 支持 `signal: AbortSignal`；取消以终止 chunk `{type:'finish', reason:{kind:'aborted'}}` 可观测。实测路由 `deepseek-official` / `deepseek-flash`。 |

### 2.3 客户端可用内建（零导入、无 JSX）

`ctx`（`get`/`on`/`provide`/`effect`）、`React`（`createElement`/`useState`/`useEffect`）、
`host.call`（Client→Host 私有 RPC）、`styles.insert`、`console`。

客户端服务：`slots.inject(key, cb)`、`slots.register`、`slots.registerFactory`、
`layout.selectPanel/openRightbar/closeRightbar/toggleSidebar`。

### 2.4 与 SPEC 假设不一致的实测项（需产品／设计确认）

1. **SPEC §8.1 的写入边界默认不成立**（`ctx.fs` 拒绝写工作区与 `DSH_HOME`）。
2. **SPEC §8.1 期望的边界检查必须自建**（`fs.resolve` 不授权；`fs.contains` 可用）。
3. **SPEC §4.1「以 TypeScript 为主」在 G0 未落地**（本机无 TS 工具链，见 ADR-001）。
4. **SPEC §6.4／§16.1 依赖的插件设置与私有库位置需要构建步骤**才能声明 `Config`
   与落盘（`DSH_HOME` 写入被拒，schemastery 不可导入）。

以上 4 条是**设计假设与宿主现实的差距**，按工作区规则应先记录再确认，
不得由实现者自行选定默认答案。

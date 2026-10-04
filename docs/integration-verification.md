# ScholarFlow 集成验证记录（G0 门禁）

> 记录 SPEC §2.2「G0 必须确认的能力」G0-01～G0-10 的**真实环境验证**结果。
>
> 这是**验证记录**，不是设计文档，也不是能力清单。每条结论都能追溯到实际执行过的
> 调用、返回值或日志。无法实测的一律写「仍未知」，不写推测。

## 0. 阅读约定

### 0.1 证据等级

| 标记 | 含义 |
|---|---|
| **【已实测】** | 在本机真实 DSH 上执行并观察到结果，附返回值或日志字段。 |
| **【官方文档说明】** | 官方发布包／自述材料的说明，本项目尚未运行验证。 |
| **【仍未知】** | 无可靠来源，或实测未覆盖。**不得**当作已实现能力写进 README 或产品文档。 |

### 0.2 报告口径

**文档生成 / 代码实现 / 测试通过 / 安装成功是四个独立状态**，逐条分列，不合并表述。

### 0.3 环境基线

| 项 | 值 | 来源 |
|---|---|---|
| 测试日期 | 2026-10-04 | 会话时间（Asia/Shanghai）；日志为 UTC |
| DSH 版本 | **0.2.0-rc.2** | exe 文件版本信息（ProductVersion `0.2.0.0`／FileVersion `0.2.0-rc.2`）；`runtime/primary-runtime/runtime.json` 的 `desktopVersion` |
| 官方 bundle 版本 | 全部 `0.2.0-rc.2` | `plugin_manager list_bundles` |
| 宿主运行时（插件内实测） | node **24.18.1**、electron **44.0.0**、v8 15.2.124.13-electron.0、modules 149、win32/x64 | 插件在宿主进程内读取 `process.versions` 并写入日志 |
| OS | Windows 11，`Microsoft Windows NT 10.0.26200.0` | `[System.Environment]::OSVersion` |
| 系统 Node / pnpm / npm | `v24.15.0` / `11.5.2` / `11.12.1` | `node -v`、`pnpm -v`、`npm -v` |
| 安装实际使用的 pnpm | `11.7.0` | `install_bundle` 返回的 pnpm 输出 |
| `DSH_HOME` | `<USER_HOME>\.dsh` | 环境变量 |
| **G0-01 目标 profile** | `desktop`（`<USER_HOME>...` 略） | 活进程命令行参数 |
| **宿主平面验证 profile** | `scholarflow-g0`（由随包 `web` 模板创建） | 见 0.4 |

> `runtime/versions.json` 写 `node 24.18.1`，`primary-runtime/runtime.json` 写 `node 24.21.0`。
> 两处不一致，故 **均记录**；插件进程内实测值为 `24.18.1`，即**实际运行时**以实测为准。

### 0.4 验证方法与写入范围

| 手段 | 用途 | 对用户环境的影响 |
|---|---|---|
| `plugin_manager` + desktop profile | G0-01 安装／启用／停用；最终产品表面确认 | 改动 desktop profile 组合（已备份、可回滚） |
| `cordis_inspect_query`（Host Service／Event／Config／Tool，Client Service／Event／Builtin／Slots／Theme） | 取得**活的**服务签名、事件契约、Slot 拓扑、客户端内建 | 只读 |
| `dsh <profile> --patch <overlay>` 独立进程（profile `scholarflow-g0`） | 宿主平面逐项验证：每次启动都是干净进程，代码改动立即生效，不重启用户桌面宿主 | 仅新建该 profile 目录；不触碰 desktop |
| 插件内自测探针 | 日志写入 `<DSH_HOME>/scholarflow-g0/lifecycle.jsonl`（验证进程可用 `SCHOLARFLOW_G0_LOG` 分流） | 仅写日志文件 |

**未修改 DSH 安装目录、未打补丁、未做猴子补丁、未用 `querySelector` 定位宿主私有 DOM。**

### 0.5 本机第三方插件参照物（【已实测】）

`$DSH_HOME/plugins/dsh-routing-suite/` 下有可工作的第三方插件，用作打包与客户端契约的对照样本：

- `injector-dist` ＝ `@dsh-external/dsh-super-injector@0.3.3`，是已被 `web` profile 启用的 bundle；
- `preset/*.tgz` ＝ `dsh-router-standard`／`dsh-router-spec`，其 `preset/` 目录已落入
  `$DSH_HOME/.agent-presets/` 并被 `agentPresets` roster 认可；
- `mode-boost` ＝ 零导入的 host-plane 插件（`lib/index.js` ＋ `package.json`）。

---

## G0-01 安装：本地打包的 bundle 能安装、启用、停用

| 状态 | 结果 |
|---|---|
| 文档生成 | 已完成 |
| 代码实现 | 已完成：最小 host-plane bundle（`package.json`、`cordis.patch.yml`、`src/host/index.js`、`src/host/impl.js`），零运行时依赖 |
| 安装成功 | **是**【已实测】 |
| 启用／停用 | **是**【已实测】 |
| 卸载／回滚 | 路径就绪，**尚未执行**（并入 G0-10） |

### 01.1 打包契约【已实测】

来源：本机可工作的第三方 bundle `@dsh-external/dsh-super-injector`。

```jsonc
// package.json
{
  "type": "module",
  "exports": { ".": { "default": "./lib/index.js" }, "./client": { "default": "./lib/client.js" } },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },        // 声明本包的 Cordis patch 层
    "client": { "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"],
                "platform": "web" }                      // 客户端半体声明
  },
  "peerDependencies": { "cordis": ">=4.0.0-rc <5" }
}
```

```yaml
# cordis.patch.yml —— patch 顶层为数组；insert 追加 loader 行
- insert:
    - id: <row-id>
      name: <module-specifier>
      config: {}
```

宿主 `clientModules` 服务自述为「incremental `dsh.client` scan + wire composition + bundle route
+ index injection rows」，与 `dsh.client` 字段相互印证。

### 01.2 实测步骤

| # | 动作 | 结果 |
|---|---|---|
| 1 | 备份 profile 控制文件到 `%USERPROFILE%\.dsh\backups\g0-20261004-183353\` | 备份 4 个文件并记录 SHA-256（`package.json`、`cordis.patch.yml`、`cordis.yml`、`pnpm-workspace.yaml`；`pnpm-lock.yaml` 不存在） |
| 2 | `plugin_manager install_bundle(target=<仓库路径>)` | `changed:true`、`enabled:true`、**`application:"applied"`（无需重启）**、`exitCode:0`；pnpm 输出 `+ dsh-scholarflow link:D:/.../dsh-scholarflow`；`Done in 322ms using pnpm v11.7.0`；`registries:[null]` |
| 3 | 读 `profiles/desktop/package.json` | `dependencies` 新增 `link:` 依赖；`dsh.profile.bundles` 新增 `dsh-scholarflow` |
| 4 | `host Config.listConfigs(name="dsh-scholarflow")` | `{"id":"include:scholarflow","patchId":"scholarflow","name":"dsh-scholarflow","status":"absent"}` |
| 5 | 读生命周期日志 | `{"event":"apply","pid":29104,...}`，pid 与 DSH 主进程一致 |
| 6 | `set_bundle(enabled=false)` | `changed:true`、`application:"applied"` |
| 7 | 再查 Config | `entries: []`、`total: 0`（loader 行已移除） |
| 8 | `set_bundle(enabled=true)` | `application:"applied"`；日志再次出现 `apply` |

> `status:"absent"` ＝ 该行**没有可投影的 Config schema**，不是「未加载」。
> 同一目录中官方行（如 `include:llm`、`include:settings`）同为 `absent`。

### 01.3 关键发现

1. **【已实测】desktop 是 live profile。** 安装／停用／启用均返回 `application:"applied"`，不需要重启进程。
2. **【已实测】本地路径安装走 pnpm `link:`，离线可完成**（322 ms，未访问 registry）。
3. **【已实测】`ctx.on('dispose', fn)` 不是本宿主的卸载回调。** 停用后 loader 行确实消失
   （`total: 0`），但该回调**没有触发**。本机两个可工作插件全部使用 `ctx.effect(() => disposer)`。
   → 本项目统一使用 `ctx.effect(...)`。
4. **【已实测】宿主 ESM 模块缓存会让「改代码不生效」。** 修改入口后重新启用，执行的是**旧模块实例**。
   loader 以解析后的 URL 为模块键，同一路径命中 Node ESM 缓存；且 `hmr` 行配置为 `root: []`（不监听任何根）。
   本机 `@dsh-external/dsh-mode-boost` 源码注释记录了同一陷阱。→ 见 ADR-002。

### 01.4 尚未验证

- **【仍未知】** 卸载（`removeBundle`）与「卸载后不删用户数据」—— 并入 G0-10。
- **【仍未知】** desktop 之外 profile 的安装结论一致性（本项只在 `desktop` 实测）。
- **【仍未知】** peer 版本越界时的拒绝行为（`cordis >=4.0.0-rc <5` 被接受，未测越界值）。

---

## G0-02 Mode：新会话中可选 ScholarFlow，且不影响其他模式默认值

| 状态 | 结果 |
|---|---|
| 文档生成 | 已完成 |
| 代码实现 | 已完成：在 `cordis.patch.yml` 声明一个 `@deepseek-ai/dsh-agent-preset` 行 |
| 测试通过 | **是**（注册、可见、默认值隔离）；**UI 选择器未验**（并入 G0-04） |
| 安装成功 | 是（随 G0-01 bundle 生效） |

### 02.1 注册路径【已实测】

**Mode ＝ 组合树中的一行 `@deepseek-ai/dsh-agent-preset`，其 `config` 是一个 `PresetDefinition`。**

两条互相印证的来源：

1. 官方 `preset-standard` 在组合树中的形态（`dsh scholarflow-g0 --dump-config`）：

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard          # 全局默认 Mode
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config: { ... }
```

2. 活服务 `agentPresets` 的引用类型声明：

```ts
export interface PresetDefinition {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly plugins: readonly (Omit<EntryOptions,'id'|'disabled'> & {
    id?: string; disabled?: EntryOptions['disabled'] | JsExpr
  })[]
}
```

另一条可用路径（尚未实测）：`ctx.agentPresets.register(definition)`，
其文档说明返回**该声明插件拥有的 disposer**（「activated or its diagnostic settles」），
天然满足 G0-10 的停用清理。

### 02.2 实测结果（验证 profile，两次独立启动一致）

| 观测 | 值 |
|---|---|
| `agentPresets.remoteExportList()` 的 presetIds | `["standard","ptc","minimal","cordis","scholarflow"]` |
| 其中 `isDefault: true` 的 | **仅 `["standard"]`** |
| ScholarFlow roster 行 | `{id:"scholarflow", name:"ScholarFlow", description:"…", order:50, isDefault:false}` |
| `compositionInventory()` 中 ScholarFlow | `broken: null`（未损坏） |
| 其子行 | `[{moduleName:"@deepseek-ai/dsh-persona", enabled:true, fiberState:2}]`，`fiberState 2 = ACTIVE` |

→ **注册成功、可选、且未改动任何其他 Mode 的默认值。**

### 02.3 选择限制【已实测（来自服务契约描述）】

- `select(agent, agentPreset)`：「**Select a preset before a session starts its first turn.**」
- `recompose(ctx, id)`：「Rebind a **blank** Agent; the caller owns the blank-session check.」
- `mount(ctx, id)` / `composedPreset(ctx)`：绑定并读取某个活 Agent 使用的 preset。
- `serviceFor(agent, name)`：「Read a service supplied **inside an Agent's isolated preset group**」
  —— 即 preset 组内服务按 preset 隔离。

→ 这**实测印证了 PRD §6.1**：已有内容的普通会话不能原地更换 Mode，必须新建会话。

### 02.4 尚未验证

- **【仍未知】** Mode 选择器 UI 中是否实际出现 ScholarFlow（需要客户端与截图，并入 G0-04）。
- **【仍未知】** 真正用 `scholarflow` 模式启动一个会话后，其工具面与提示的实际差异（G0-08）。
- **【仍未知】** `ctx.agentPresets.register(...)` 程序化注册与声明式行注册的行为差异。

---

## G0-03 身份：从宿主取得真实 workspaceId、根路径、sessionId

| 状态 | 结果 |
|---|---|
| 文档生成 | 已完成 |
| 代码实现 | 已完成探针；`WorkspaceBinding` 适配实现为**部分** |
| 测试通过 | **部分通过** |

### 03.1 实测结果

`workspaceRegistry.list()`【已实测】返回 **7 个真实工作区**，每项含：

```jsonc
{
  "id": "98929289-a9f5-4cbc-8740-06c6a8d54781",   // 宿主生成的 UUID
  "title": "dsh-scholarflow-ai",
  "createdAt": "2026-10-04T09:13:37.029Z",
  "updatedAt": "2026-10-04T10:22:10.982Z",
  "sessionCount": 2,                               // 来自 workspace.sessionIds
  "path": "D:\\...\\dsh-scholarflow-ai"            // canonical root
}
```

`Workspace` 类型（活服务引用类型）：
`{ id, path, title, createdAt, updatedAt, sessionIds, setTitle, attachSession, insertSessionBefore, detachSession, status() }`

| 结论 | 证据 |
|---|---|
| **`workspaceId` 是宿主管理的 UUID，不是路径字符串** | `id` 与 `path` 是两个独立字段，符合 SPEC §5.1 |
| **canonical root 可取得** | `path` 字段；`create()` 文档说明路径经 `fs.realpath` 规范化 |
| **sessionId 可取得** | `workspace.sessionIds`；另有 `sessions` / `sessionController` 服务 |
| **未初始化信号可判定** | `resolveByPath(<测试工作区>)` 返回 `undefined`，文档说明「an existing unowned directory returns `undefined`」 |
| **`rootFingerprint` 是本项目自加** | SPEC §5.2 要求；宿主无对应字段，需由我们计算（如 canonical path 的 SHA-256） |

### 03.2 记录到的限制（对 FileGateway 有直接影响）

- **【已实测】`workspaceRegistry.list()` 向任意 host 插件暴露全部工作区绝对路径。**
  实测日志包含 7 个用户目录路径。→ 宿主**不会**按插件限制可见范围，
  因此 SPEC §8.1「基于 canonical root 与真实路径关系做检查」必须由本项目 FileGateway
  **自己实现**，不能依赖服务侧收窄。
- **【已实测】** 用户指定的测试工作区 `<USER_HOME>\Desktop\科技论文写作` 目前**不是已登记工作区**
  （`resolveByPath` 为 `undefined`），故「项目尚未初始化」与「目录不属于本工作区」两种情况需要
  由我们区分并给出不同提示。

### 03.3 尚未验证

- **【仍未知】** 在一次真实会话中取得 **`sessionId` → `workspaceId` → `projectId`** 的完整绑定链，
  以及服务端每次写请求重新校验该链（SPEC §5.2）的实现细节。
- **【仍未知】** 同一项目被复制成两份时的 `PROJECT_ID_CONFLICT` 处理。

---

## G0-04 UI：专属工作台与 Agent 面板可同时存在，原侧栏不受影响

| 状态 | 结果 |
|---|---|
| 文档生成 | 部分（本节记录已取得的契约） |
| 代码实现 | **未开始**（客户端半体尚未编写） |
| 测试通过 | **否 —— 未实现**；扩展点契约已确认，**客户端半体打包已实测被服务与注入** |

### 04.1 已取得的契约【已实测】

**客户端 Slot 拓扑**（`client.Slots.listSubTree`，本机 desktop 会话实测）关键座位：

| Slot | kind | scope | 用途 |
|---|---|---|---|
| `main` | keyed | root | 「Central panel selected by sidebar entry id」；`keyDomain` 开放，当前仅占 `conversation` |
| `sidebar` | single | root | 整个左列（`replaceRisk: shadows-shipped-ui`，**不得替换**） |
| `sidebar.panellist` | list | root | 「Global panel icons」，注册形参 `{id, order, label}` |
| `settings.section` | list | root | 「One settings page per list entry」，注册形参 `{id, order, label}` |
| `sidebar.right.tab.*` | keyed | **session** | 右侧栏的 tab 容器 |
| `sidebar.chat.conversation` | single | **session** | 「Session-scoped Conversation occurrence hosted by one Sidebar chat tab」 |
| `conversation.view` | list | session | 「Registered Conversation target Views, rendered one at a time」 |
| `conversation.hero.agentPreset` | single | session-maybe | 「Agent-preset control staged for a New Session」＝ Mode 选择器座位 |
| `shell.overlay` | list | root | 帧级浮层 |

**客户端服务**（`client.Service.listService`【已实测】）：

```ts
ctx.slots.inject(key, () => SlotInjectionEffect): () => void
ctx.slots.register / ctx.slots.registerFactory
ctx.layout.selectPanel(panelId: MainPanelId | null): void
ctx.layout.openRightbar(track: boolean, fullscreen: boolean): void
ctx.layout.closeRightbar(): void
ctx.layout.toggleSidebar(): void
```

**客户端半体可用内建**（`client.Builtin.listBuiltins`【已实测】）——零导入、无 JSX：

| 内建 | 签名 |
|---|---|
| `ctx` | `get(name)` / `on(name, fn)` / `provide(name, value)` / `effect(cb, label?)` |
| `React` | `createElement` / `useState` / `useEffect`（「exposed without JSX transformation」） |
| `host` | `call(method, args?) => Promise<JsonValue>`（Client → 本包 Host 的私有 RPC） |
| `styles` | `insert(css) => () => void`（包自带样式，随运行清理） |
| `console` | `log` / `error` |

**客户端半体加载形状**（本机可工作插件 `injector-dist/lib/client.js`【已实测】）：

```js
window.__ModuleLoader__.load({
  id: '<package name>',
  factory: (require) => {
    const inject = ['slots']
    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: '<id>', order: 50, label: () => '…',
        component: () => ({ render() { /* 自有 DOM */ return { dispose() {} } } }),
      })), '<label>')
    }
    exports.apply = apply; exports.inject = inject
    return module.exports
  },
})
```

→ **PRD §8.2 的目标布局（原侧栏 | 工作台 | Agent）在契约层面成立**：
工作台进 `main`（新 key）＋ 侧栏入口进 `sidebar.panellist`，Agent 面板复用宿主既有的
`sidebar.chat.conversation`／右侧栏，不去动 `sidebar` 本身。

### 04.2 `main` 座位的实测细节（**扩展点已确认可用**）

对活座位 `main` 做精确探测（`client.Slots.listSubTree(root="main")`）【已实测】：

| 观测 | 值 |
|---|---|
| `kind` | `keyed`（keyed 座位） |
| 注册形参 | `{ key: string, required: true }`，说明：「Your cell key: the entry renders where the owner dispatches this exact key. **Registering an already-occupied key replaces that occupant.**」 |
| `keyDomain` | `open: any string the owner dispatches (no compile-time key set)` |
| **当前占用者** | `plugins`、`conversation`、`schedules`（`active: true`） |
| 座位说明 | 「Central panel selected by sidebar entry id. The reserved `conversation` key hosts the Conversation; **other keys receive no Session binding.**」 |
| 组件可用 props | `useResource`、`useWorkspaces`、`usePanelInfo`、`useSessions`、`useSessionStatus`、`useSessionRetainInfo`（React hooks） |
| `replaceRisk` | `shadows-shipped-ui`（替换已占用的 key 会遮蔽官方 UI） |

**结论：**

1. **第三方插件可以新增 `main` key。** 证据不是类型定义，而是**已有两个非 `conversation`
   的占用者（`plugins`、`schedules`）**，且 keyDomain 明确开放。
2. 因此 PRD §8.2 的「原侧栏 | 工作台 | Agent 面板」三栏在**扩展点层面成立**：
   ScholarFlow 工作台取一个自己的 `main` key，Agent 面板继续用官方 `conversation`，
   `sidebar` 完全不动。
3. **注意：非 `conversation` 的 key 不获得 Session 绑定** —— 工作台需要自己经
   `useSessions`/`host.call` 取得当前会话，这一点要在 M1 设计里明确。

### 04.4 客户端半体打包已实测（模块被服务并注入页面）

已编写最小客户端半体 `src/client/index.js`，并声明 `package.json` 的
`exports['./client']` 与 `dsh.client.platform = 'web'`。把本插件**作为真实依赖**安装进
验证 profile 后启动宿主，取服务端返回的页面 HTML，**实测到**：

```html
href="plugins/??…,dsh-scholarflow/client.js,…&rev=aa1c2d240a40"
```

即 **`dsh-scholarflow/client.js` 已出现在浏览器启动图的模块清单中**（该 HTML 里
`scholarflow` 共出现 5 次）。这说明：

1. `dsh.client` 字段确实被 `clientModules` 扫描（与该服务自述一致，见 ADR-003）；
2. `exports['./client']` 被解析并作为客户端模块提供；
3. 客户端半体进入浏览器启动图，**不需要构建工具** —— 手写
   `window.__ModuleLoader__.load({ id, factory })` 包装即可（形状取自本机可工作插件）。

**这不等于 UI 已验证。** 模块被加载 ≠ 面板渲染正确、≠ 与原侧栏共存、≠ 截图通过。
渲染、三栏共存与窄屏行为仍必须在**有浏览器的 desktop 表面**确认。

半体目前注册三处，每处单独 `try/catch` 以免一个错误假设拖垮整体：

| 座位 | 注册 | 状态 |
|---|---|---|
| `main`（keyed） | `{ name:'main', key:'scholarflow', component }` | **推断形状**，未渲染验证 |
| `sidebar.panellist` | `{ name:'sidebar.panellist', id, order, label, component }` | **推断形状**，未渲染验证 |
| `settings.section` | `{ name:'settings.section', id, order, label, component }` | 形状有本机先例（G0-05 path B） |

### 04.5 尚未验证（阻塞项）

- **【仍未知】** `ctx.slots.register` 对 keyed 座位的精确调用形状
  （本机可工作客户端半体展示的是 list 座位：`register({ name, id, order, label, component })`；
  keyed 座位应为 `{ name, key, component }`，属**推断**，需实测确认）。
- **【仍未知】** `layout.selectPanel()` 接受的 `MainPanelId` 是否为闭合联合类型。
- **【仍未知】** 窄屏行为、切换 Tab 保留滚动与脏缓冲。
- **阻塞：** 需要编写客户端半体 → 在 desktop profile 生效 → **需要用户重启 desktop 宿主** →
  并按 SPEC 要求取**截图**。本会话没有浏览器／截图工具，截图须由用户配合。

---

## G0-05 设置：设置页可显示并保存本插件命名空间

| 状态 | 结果 |
|---|---|
| 文档生成 | 已完成（含阻塞结论） |
| 代码实现 | 已完成：schemastery `Config`，loader 已识别；**设置页仍未投影** |
| 测试通过 | **否 —— 已排除 3 个原因，剩 1 个待定** |

### 05.1 机制【已实测】

`settings` 服务（活契约）：

```ts
describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]
update(ns: string, patch: object, expectedRevision?: number): Promise<void>
replace(ns: string, section: object, expectedRevision?: number): Promise<void>
mutate(ns: string, ops: SettingsPathOp[], expectedRevision?: number): Promise<void>
configure(presentation: { auto?: boolean }, owner?: Fiber): () => void
prepareDocument(): Promise<string>          // 返回 profile patch 路径
```

`SettingsDescriptor = { ns, autoGenerate, schema, value, revision, base?, user?, applies:'live', secrets? }`，
其中 **`ns` 就是 profile loader 的 entry id**（实测样例为 `session-log-deepseek` 等，
**不带 `include:` 前缀**）。

### 05.2 实测结果与逐项排除

`settings.describe()` 始终返回 **19** 个命名空间，其中属于本插件的始终 **0** 个。
官方命名空间被投影出的 `schema` 是 **schemastery 的内部序列化形态**：

```json
{"uid":4058,"refs":{"4057":{"type":"boolean","meta":{"default":true}},
 "4058":{"type":"object","meta":{"default":{}},"dict":{"enabled":4057}}}}
```

按因果顺序逐项排除（每一步都单独实测）：

| # | 假设 | 实测结果 | 结论 |
|---|---|---|---|
| 1 | 需要 schema 库，且不可导入 | 初始 `schemastery`/`zod` 均 `ERR_MODULE_NOT_FOUND` | 是**原因之一**，但可修复 |
| 2 | 依赖可在本包内安装解决 | `pnpm add zod` → `zod 4.6.5`；`pnpm add schemastery@^3.18.0` → `schemastery 3.18.0`；重跑后 `probe:module-resolution` 显示 **两者均 `resolved`** | ✅ 已解决。**先前失败是 `link:` 安装不装依赖的副作用，不是宿主协议限制** |
| 3 | 纯 JSON Schema 不被接受 | 换成 zod、再换成 schemastery 后行为逐次重测 | ✅ 需要 **schemastery**（Cordis 原生），zod 不被投影 |
| 4 | 入口壳没有转发 `Config` | `src/host/index.js` 只转发了 `name`/`inject`/`apply` | ✅ **本项目自身的 bug**，已修：壳必须转发**全部** loader 相关导出，否则能力静默丢失、无任何诊断 |
| 5 | 需要显式页面策略 | `settings.configure({auto:true})` 调用成功（`settings-policy-registered`） | ✅ 已注册，但 `describe()` 仍为 0 —— 不是这个原因 |
| 6 | **行必须来自 bundle／可寻址 entry** | 把插件行从 `--patch` 覆盖层移入 profile 自己的 `cordis.patch.yml` | ⏳ **仍为 0；待定** |

**第 4 项已由正面证据确认**：修好转发后，`apply` 收到了 schemastery 物化出来的默认值：

```json
{"event":"apply","config":{"g0ProbeMarker":"","defaultProjectType":"course-paper"}}
```

→ **`Config` 确实被 loader 读取并生效**，所以问题不在 schema、不在 Config 本身，
而在 **Settings 的投影条件**。`SettingsDescriptor` 带 `base?`/`user?`、
`PluginInfo` 带 `readOnlyReason: 'management-required' | 'unaddressable'`，
最可能的解释是：**只有 bundle 管理的（可寻址）entry 才会被投影为设置页**，
而验证 profile 里本插件的行是手工 patch insert，属于 `unaddressable`。

### 05.3 结论与下一步

- **【已实测】** 插件声明 schemastery `Config` 是可行的，且默认值会被物化并传入 `apply`。
- **【已实测】** `settings.configure({auto:true})` 可正常注册页面策略。
- **【已实测】「只有 bundle 管理的 entry 才被投影」这一假设已被推翻。**
  在验证 profile 中把本插件**作为真实依赖安装**（`dsh plugin --profile scholarflow-g0 add <路径>`，
  随后 `dsh.profile.bundles` 含 `dsh-scholarflow`），`apply` 仍收到物化默认值，
  但 `settings.describe()` 依旧 `ownCount: 0`。所以 bundle/可寻址性**不是**原因。
- **【仍未知】** 设置页投影的准确前置条件。已排除的原因（每项单独实测）：

  | 假设 | 结果 |
  |---|---|
  | schema 库不可导入 | 已解决（见 ADR-004） |
  | 纯 JSON Schema 作为 `Config` | 不投影 |
  | zod schema 作为 `Config` | 不投影 |
  | 入口壳未转发 `Config` | 是 bug，已修；修后 loader 读取并物化默认值 |
  | 缺 `settings.configure({auto:true})` | 调用成功注册策略，投影仍为 0 |
  | 行非 bundle 安装 | 已按真实 bundle 安装，投影仍为 0 |
  | 行 `config` 为空对象 | 改为**非空** `config`（`g0ProbeMarker: from-bundle-patch`），`apply` 收到该值，**投影仍为 0** |
  | 模块用 top-level `await` 求值（入口 mtime 壳 + 动态 schema 导入），可能与已发布插件不同 | 改为**纯静态导入、零 TLA** 的入口后重跑：`ownCount` 仍为 **0**，`apply` 仍收到默认值 |

- **【已实测的关键对照】本机可工作的第三方插件 `@dsh-external/dsh-super-injector` 根本没有声明
  `Config`**，它是自己在 `settings.section` 槽里注册了一个**自有设置页**，并通过自己的 HTTP 路由
  （`ctx.webServer.register`）持久化。这说明**「Config → 自动设置页」并不是第三方插件实际走的路**，
  至少不是唯一可用的路。
- **【已实测】已排除 8 个假设，均无法解释投影为 0**，因此：
  - **不再继续黑盒猜测**；这一条转为 M1 的已知开放问题（附完整已排除清单）。
  - **需要产品／设计裁决**：SPEC §2.2 的 G0-05 措辞是「设置页能显示并保存**本插件命名空间**」，
    而 §11.1 又明确允许「若目标 DSH 版本提供的是插件专属配置页而不是独立 Settings section，
    可使用等价的官方页面入口，但必须可从设置／插件配置直达，不能退化成只能改 YAML」。
    本机可工作的第三方插件正是走后者。→ **「自有 `settings.section` 页面 + 自有
    `storageDomain` 持久化」是否满足 G0-05，需要用户确认，不由实现者自行认定。**
    可用的两块证据都已具备：设置页已注册（04.4），持久化已实测跨进程可用（09.4）。

  **因此属主裁决前，G0-05 记为「机制部分走通、投影未出现、待裁决」。**
- **因此 G0-05 的实际结论分两半：**
  1. **可用的实现路径已确认（path B）**：插件在 `settings.section` 注册自有页面（`settings.section`
     是本机第三方插件实测使用的座位），设置项自己负责持久化。SPEC §11.1 明确允许这种做法
     （「若目标 DSH 版本提供的是插件专属配置页而不是独立 Settings section，可使用等价的官方页面入口」）。
     本项目的客户端半体已注册该页面（见 04.4）。
  2. **宿主 `Config` → 自动命名空间这一条仍未走通**，且已排除 7 个假设，说明它可能依赖
     我们尚未观察到的条件（例如只有官方 bundle 自带的 entry 才可投影，或需要 `configEditor`
     先建立可编辑文档）。**该条不再继续黑盒猜测**，转为 M1 的已知开放问题。

### 05.4 尚未验证

- **【仍未知】** desktop profile 中 `settings.describe()` 是否包含本插件命名空间，以及
  `settings.update()` 是否把值写入 profile patch。
- **【仍未知】** 远程（非 loopback）浏览器下设置页的写入能力差异（SPEC §6.4／R-03）。
- **【仍未知】** `settings.section` 槽与自动表单的实际渲染效果（`autoGenerate` 语义）。

---

## G0-06 模型：使用现有会话／模型执行受控阶段并可取消

| 状态 | 结果 |
|---|---|
| 文档生成 | 已完成 |
| 代码实现 | 已完成探针：**真实** `ctx.llm.stream` 适配，未伪造任何 response |
| 测试通过 | **是**（含取消） |

### 06.1 实测结果（三次独立启动一致）

| 观测 | 值 |
|---|---|
| 可用 provider 路由（`llm.listProviders()`） | `["deepseek-official","deepseek-account"]` |
| 选用 | `deepseek-official` / `deepseek-flash`（由注册表实测取得，非硬编码） |
| 受控调用结果 | `realModelResponse: true`、`textPreview: "READY"`、`textLength: 5`、`finish: "stop"` |
| 用量 | `{inputTokens:50, outputTokens:13, cacheReadTokens:0, cacheWriteTokens:0, totalTokens:63}` |
| **取消** | 在首个 `text-delta` 后 `controller.abort()` → 终态 `finishReason: "aborted"` |
| 取消时延 | 1050 ms / 1286 ms / 1389 ms（含模型实际输出 145～443 个 chunk） |

### 06.2 结论

- 宿主模型与凭据可**直接复用**（未要求用户另填 Key），符合 ADR-012。
- 受控阶段可执行，**且可取消**；取消通过终止 chunk `{type:'finish', reason:{kind:'aborted'}}`
  **可观测**，这正是 SPEC §10.3／§27 所需的可取消语义。
- `GenerateOptions` 提供 `signal?: AbortSignal` 与 `sessionId?`，是 AgentExecutor 的真实接入点。

### 06.3 尚未验证

- **【仍未知】** 通过 `agentLoop.createAgent` / `agents.create` 建**真实会话内**受控阶段
  （本次用的是 `llm.stream` 直接适配，未创建 Agent）。
- **【仍未知】** 预算／检查点（SPEC §10.5／§10.6）在真实 Agent 上的落点。
- **【仍未知】** SPEC §18.6 所需的「限制或移除通用 `write/edit/bash`」在 preset 工具面上的实际能力
  （`tools.restrict` / `tools.guard` 已确认存在，未实测）。

---

## G0-07 文件：授权读写、路径限制、文件变更订阅可用

| 状态 | 结果 |
|---|---|
| 文档生成 | 已完成 |
| 代码实现 | 已完成探针（读、边界、写、订阅） |
| 测试通过 | **读／边界／订阅：通过；写：受限（重要约束）** |

### 07.1 实测结果

对用户指定的测试工作区 `<USER_HOME>\Desktop\科技论文写作`（**只读**）与其内真实文件：

| 能力 | 结果 |
|---|---|
| `fs.resolve(root)` | 成功；`fs.processPath` 返回中文路径**完整无损**（日志以 UTF-8 复核） |
| `fs.stat(target)` | 返回字段 `{size, type, version}` |
| `fs.readBytes(target, undefined, 8MiB)` | 成功读出 **9714 字节**，首字节 `23 23 20 e8ae...` ＝ `## 报告笔记` |
| `fs.readBytes(target, undefined, 64)` | **`FS_TOO_LARGE`** → `maxBytes` 是**文件大小上限**，不是单次切片长度 |
| `fs.watch(target, cb, signal)` | 修改文件后收到 **1 次通知**；返回值是**函数**（可取消订阅） |
| `fs.writeText(target, text)` | 返回 `{after, before, operation, version}` → 版本号即乐观并发凭据 |

### 07.2 路径限制【已实测，重要】

`fs.resolve` **只做路径规范化，不做任何授权**：

| 尝试（cwd 设为测试工作区） | 结果 |
|---|---|
| `..\..\Windows\win.ini` | **解析成功** → `<USER_HOME>\Windows\win.ini` |
| `C:\Windows\win.ini` | **解析成功** |
| `CON`（保留设备名） | **解析成功** → `<root>\CON` |
| `<root>-other`（同前缀兄弟目录） | **解析成功** |

但 **`fs.contains(parent, child)` 行为正确**：自身 `true`、外部文件 `false`、
同前缀兄弟目录 **`false`**。

→ **结论：SPEC §8.1 要求的边界必须由本项目 FileGateway 自己实现，**
且应使用 `fs.contains`（而非 `startsWith`）作为包含关系判定。`fs.resolve` 不可作为授权依据。

### 07.3 写入限制【已实测，阻塞性约束】

`ctx.fs.writeText` 的实际许可范围：

| 目标位置 | 结果 |
|---|---|
| OS 临时目录 `%TEMP%\scholarflow-g0-fs\policy.txt` | **允许**，返回 `{after,before,operation,version}` |
| `<DSH_HOME>\scholarflow\policy.txt` | **`FS_SANDBOX_DENIED`** |
| `<DSH_HOME>\scholarflow-g0-policy.txt` | **`FS_SANDBOX_DENIED`** |
| **测试工作区内** `<root>\.scholarflow-g0-probe\policy.txt` | **`FS_SANDBOX_DENIED`** |

→ **SPEC §8.1「正常项目操作仅允许写 `.scholarflow/` 和用户确认的输出目录」在默认情况下并不成立。**
host-plane 插件在无会话／权限上下文时，`ctx.fs` 写入被沙箱默认拒绝。
`writeText` / `editText` 有第 5 个参数 `sandboxPolicy`，这是需要进一步确定的正式通路
（由插件提供策略是否被允许、或必须由宿主侧配置）。

### 07.4 记录到的安全事实（诚实限制）

- **【已实测】`ctx.fs` 的沙箱不是操作系统级隔离。** 沙箱只拦 `ctx.fs`；插件可直接使用
  `node:fs`（本探针用 `fs.mkdirSync` 成功在受保护目录内创建了目录，随后 `ctx.fs` 写入才被拒）。
  → 这与 PRD §12.1 的表述一致（隔离不等于「其它有文件权限的插件绝对读不到」），
  但**必须在文档与实现中明说**，不得宣称强隔离。
- **【已实测】`ctx.fs` 没有 mkdir API**，目录创建只能靠 `node:fs`（见上一条）。
- **探针自身副作用已清理：** 为探测写入策略，在用户工作区内创建过一个**空目录**
  `.scholarflow-g0-probe`（`node:fs` 创建），随后被沙箱拒绝写入；该目录**已被删除并核验**，
  用户测试工作区恢复为原有 7 项内容，无任何文件被修改或新增。

### 07.5 尚未验证

- **【仍未知】** `sandboxPolicy` 参数的合法取值与来源（谁有权授予工作区写权限）。
- **【仍未知】** `FsWriteIntent`（`expected` 参数）的冲突检测语义：并发写、外部编辑器修改后的拒绝行为。
- **【仍未知】** 符号链接越界、UNC 路径、大小写差异下的 `contains` 行为。
- **【仍未知】** 换行（CRLF）与编码往返是否无损。

---

## G0-08 Skill 隔离：A、B 两项目与普通模式的 catalog、注入提示互不相同

| 状态 | 结果 |
|---|---|
| 文档生成 | 已完成 |
| 代码实现 | 已完成：两个预设各挂一个私有 `skill-filesystem`，指向各自的 `TEST_ONLY` 夹具 |
| 测试通过 | **是**（catalog 隔离）；注入文本差异**未验** |

### 08.1 已取得的机制线索【已实测】

在官方 `preset-cordis` 行的组合树中，preset **自带** `skill-filesystem` 行并配置私有根：

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - !!js >-
        …join(dirname(createRequire(baseUrl).resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills')
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
```

相关活服务：`skills`（`registerProvider` / `register` / `list(options: SkillViewOptions)` /
`snapshot(options)` / `get(name, options)`）、`sessionSkillCatalog`（启动约 2 s 后可用）、
`systemPrompt`（`section` / `context` / `tools` / `assemble`）。

→ **「Mode 私有 Skill catalog」在架构上是被官方预设自己使用的方式**，
不是本项目发明的补丁；且 `agentPresets.serviceFor(agent, name)` 的存在说明
preset 组内服务是**按 preset 隔离**的。这对 D-10／SF-022 是有利证据。

### 08.2 实测结果（A/B 对照，**通过**）

`skills` 服务的活动契约**直接给出了隔离机制**（原文）：

> 「A registration files into the layer of its calling context's scope: **host rows and
> repository plugins land in the global layer, while a plugin mounted by an agent preset's
> standing composition lands in that preset's layer.** A read merges the global layer with
> the viewing scope's chain — the nearest layer's entry wins a duplicate name outright.」

`registerProvider` 进一步确认：「a scoped context (an agent preset's standing mount) registers
**for that scope alone**, an unscoped context registers globally.」

**实验**：验证 profile 挂两个预设，各自带一个 `skill-filesystem` 行，
分别指向 `%TEMP%\sf-g0-skills\skill-a` 与 `…\skill-b`（显式 `TEST_ONLY` 夹具，
name 为 `sf-test-skill-a` / `sf-test-skill-b`）。用 `agentPresets.acquireScope(id)`
取每个预设的 `scopeKey`，再分别读取 catalog：

| 视图 | 观察到的技能 |
|---|---|
| **无 scope（全局）** | `["diagnose-windows-sandbox-acl"]` —— **两个夹具都不出现** |
| `scope = scholarflow` | `["agently-mail","diagnose-windows-sandbox-acl","grill-me","sf-test-skill-a"]` |
| `scope = scholarflow-b` | `["agently-mail","diagnose-windows-sandbox-acl","grill-me","sf-test-skill-b"]` |

探针计算字段：

- `globalLeakedFixture: false` → **没有全局发布**（PRD D-10／SF-022 的核心要求成立）
- `crossScopeLeak: false` → **A 看不到 B 的夹具，B 也看不到 A 的**
- `complete: true` → 三处都是完整目录，不是「发现未完成」的中间态
- 两个预设的子行全部 `fiberState: 2 (ACTIVE)`（persona、skill-filesystem、tool-skill）

**结论：**

1. **Mode 私有 Skill catalog 是被官方认可的架构**，本项目不需要发明隔离补丁
   （官方 `preset-cordis` 自己就这么挂）。
2. **跨 Mode／跨项目的 catalog 隔离已实测成立。**
3. 两个 scope 都多出 `agently-mail`、`grill-me`，而**无 scope 的读取反而更窄**：
   读是「全局层 + 该 scope 的链」，用户级 provider 只在带 scope／cwd 的读取里参与。
   → **不能用无 scope 读取的结果代表「普通会话能看到的全部」**，这是一个与直觉相反的细节。

### 08.3 尚未验证

- **【仍未知】** `systemPrompt.assemble()` 在三种上下文中的**注入文本**差异
  （catalog 隔离已证明，提示词注入尚未逐字比对）。
- **【仍未知】** 宿主的 `agent-instructions`（workspace 指令注入）在专属 Mode 下如何收窄。
- **【仍未知】** 项目级（`<workspace>/.scholarflow/skills/`）与库级（`<DSH_HOME>`）在同一 scope
  内的层级优先级实测。

---

## G0-09 会话恢复：重启后仍能恢复项目绑定

| 状态 | 结果 |
|---|---|
| 文档生成 | 已完成 |
| 代码实现 | 已完成：`storageDomain` 域写入 + 跨进程读回探针 |
| 测试通过 | **是（storage 路径）**；文件直写路径仍被沙箱拒绝 |

### 09.1 实测结果

| 路径 | 实测结果 |
|---|---|
| `ctx.fs.writeText` 直接落盘绑定文件（`<DSH_HOME>/scholarflow/`、工作区） | **`FS_SANDBOX_DENIED`**（见 G0-07.3）——该路径被否决 |
| `storageDomain.open(spec)` + `table.put()` | 初测 `malformed-medium`；**根因已查明并解决，见 09.4** |

`storageDomain` 路径的实测依据（活契约）：

- `open` 的文档明确会「reject a name that is already open (`already-open`)、解析 backend route、
  要求其 `kv` facet（`facet-unsupported`）、**backend `version-mismatch`/`malformed-medium` pass through**」；
- `DomainSpec = { name, version, layout?, compatibleVersions?, invalidRecords?, global?, tables }`，
  且 `DomainTableSpec.valueSchema` 的类型是 **`ZodType<V>`**（所以此路径确实需要 zod，
  已安装 `zod 4.6.5` 并可直接导入）。

初测失败的排查过程（保留作为证据链）：

- **未生成任何介质文件** → 排除「已有介质损坏」，指向 unit 投影阶段失败；
- 曾把 zod 从 4.6.5 换到 3.25.0 以排除主版本偏差，但 **zod v3 在该安装方式下反而无法解析**
  （`ERR_MODULE_NOT_FOUND`），该假设**未能验证**，随后恢复 zod 4.6.5；
- 最终用 8 个变体分离出真正原因：**域名含连字符**（见 09.4）。

### 09.2 已确认的跨进程持久事实（宿主自有状态）

`workspaceRegistry` 已被实测为**真正的跨进程持久**：两次独立启动（不同 pid）读到
完全相同的 7 个工作区、相同的 `id`/`createdAt`/`updatedAt`。
这证明宿主的工作区注册表不是内存 Map，可作为 `sessionId → workspaceId` 绑定的**权威来源**。

### 09.3 尚未验证

- **【仍未知】** `storage` hub 的 `mount(form, facility)` 与 `dsh-storage-json` 后端的关系
  （直接 `open` 已够用，因此该方向优先级降低）。
- **【仍未知】** 损坏／schema 过新时的只读降级行为（SPEC §9.4／§27.5；`invalidRecords:
  'backup-and-skip'` 存在于契约中但未实测）。

---

### 09.4 已解决：`storageDomain` 路径**通过**（本轮新增）

原先的 `malformed-medium` **是本项目自己写错了 spec**，不是宿主缺陷。用 8 个受控变体逐一分离变量后得到：

| 变体 | 域名 | `layout` | 结果 |
|---|---|---|---|
| plain-single | `scholarflowprobe` | 默认 | ✅ 打开，写入并读回 |
| per-record | `scholarflow-g0-probe` | `per-record` | ❌ `malformed-medium` |
| with-compatible-versions | `sfprobe2` | 默认 | ✅ |
| with-global | `sfprobe3` | 默认 | ✅ |
| **per-record-valid-name** | `sfprobe4` | `per-record` | ✅ **打开** |
| **single-hyphen-name** | `sf-probe-5` | 默认 | ❌ **`malformed-medium`** |
| single-underscore-name | `sf_probe6` | 默认 | ✅ |
| single-single-name | `sfprobe7` | `single` | ✅ |

**结论（已实测）：真正被拒绝的是「域名里的连字符」。**

- `sf-probe-5` 失败而 `sf_probe6`（下划线）成功、`scholarflowprobe` 成功 →
  域名需使用**字母／数字／下划线**这类允许字符集；
- `layout: 'per-record'` **不是**原因 —— 换成合法域名后 `per-record` 正常打开（`sfprobe4`）；
- 4 个变体建出的介质位于 `<DSH_HOME>/storages/`：`single` 为 `<name>.json` 文件，
  `per-record` 为 `<name>` 目录，与 `storage-json` 的 `root: dshHomePath('storages')` 一致。

**跨进程持久化（G0-09 的核心要求）已实测通过** —— 两次独立进程：

| 启动 | pid | 观察 |
|---|---|---|
| bootOne | 34192 | `tableSize: 1`、`priorEntries: []`、`crossProcessEvidence: false` |
| **bootTwo** | **11068** | `tableSize: 2`、**`priorEntries` 含 bootOne 写入的 `sessionId: "sess-34192"`**、**`crossProcessEvidence: true`** |

→ **绑定的持久化不依赖内存 Map**：后一个进程读回了前一个进程写入的记录。
本项目自有的 `projectId` 类绑定可以采用 `storageDomain`（`DomainSpec` + `zod` 表 schema），
约束是**域名只用允许字符集**（建议 `scholarflow_projects` 这类命名）。

**探针副产物已清理**：`<DSH_HOME>/storages/` 下 7 个探针介质（含 `per-record` 目录）
已逐个核对绝对路径后删除；官方 `workspace.json`、`session_projcache.json` 保持原样未动。

### 09.5 尚未验证

- **【仍未知】** 损坏／schema 过新时的只读降级行为（SPEC §9.4、§27.5）——`invalidRecords: 'backup-and-skip'`
  已存在于 `DomainSpec` 契约中，未实测。
- **【仍未知】** 绑定记录与「当前会话/工作区」的一致性校验（SPEC §5.2：服务端每次写请求重新验证
  `sessionId → workspaceId → projectId`）。

---

## G0-10 生命周期：停用后清理监听、任务与 UI 注册

| 状态 | 结果 |
|---|---|
| 文档生成 | 部分 |
| 代码实现 | 已用 `ctx.effect` 注册清理；**dispose 触发本身未验** |
| 测试通过 | **部分**：loader 行移除 ✅、**AT-25 停用不删数据 ✅**；清理回调与卸载未验 |

### 10.1 已实测

- `set_bundle(enabled=false)` → `application:"applied"`，且 `Config.listConfigs` 中该行消失
  （`total: 0`）→ **loader 行确实被移除**。
- **AT-25（发布阻断级）已实测通过：停用再启用后用户数据逐字节未变。**
  在 desktop profile 上执行 `set_bundle(false)` → `set_bundle(true)`，
  对用户测试工作区 `C:\Users\19949\Desktop\科技论文写作` 做**递归 SHA-256 全量比对**：
  禁用前与恢复后 **16 项全部一致**（含 `.workbuddy/` 7 个文件、`作业要求/` 3 张图片、
  1 个 1.5 MB PDF、2 个 Markdown），无新增、无删除、无修改。
  插件自有目录 `<DSH_HOME>/scholarflow`、`<DSH_HOME>/scholarflow-g0` 也未被删除。
- `ctx.on('dispose', fn)` **不触发**；`ctx.effect(() => disposer)` 是本机所有可工作插件采用的写法
  → 本项目已改用 `ctx.effect`，但**其 disposer 是否在停用时执行尚未观察到**（受 ESM 缓存限制，
  需先让新代码在一次干净进程中生效，再在 desktop 停用）。
- **【过程教训，已实测】bundle 选择状态必须验证，不能假设。**
  本轮开始时发现 desktop profile 的 `dsh.profile.bundles` **已不含** `dsh-scholarflow`
  （即插件实际未被加载），而依赖 `link:` 仍在。`set_bundle(false)` 因此返回 `changed:false`。
  已用 `set_bundle(true)` 恢复（`package.json` mtime 19:05:35）。
  **未确定**它是何时、因何被移除的；已排除两项：本 profile 下两笔第三方安装失败日志
  （`EricWang1358/dsh-web-studyhub` 的 flashcard 包）创建于 **2026-10-03**，早于本次会话。
  → 后续任何依赖 desktop 生效的结论，动手前都要先读一次 profile 组合。

### 10.2 尚未验证

- **【仍未知】** 停用后 `ctx.effect` 的 disposer 实际执行、无残留监听（需配合 `invariants` 或前后对比）。
- **【仍未知】** `removeBundle`（真正卸载）的实际行为，以及卸载后用户数据是否仍完整。
- **【仍未知】** 正在执行的任务在停用时的安全中断与状态保存（SPEC §27.1）。

---

## 附录 A：G0 期间产生的副作用与清理

| 副作用 | 处置 |
|---|---|
| desktop profile 组合新增 `dsh-scholarflow` bundle | **保留**（G0-01 验收对象）；安装前已备份 4 个控制文件并记录 SHA-256；回滚脚本见 `scripts/rollback-profile.ps1` |
| 新建 profile `scholarflow-g0`（由随包 `web` 模板创建） | 保留作为宿主平面验证夹具；可删除且不影响其他 profile |
| `<DSH_HOME>/scholarflow-g0/lifecycle.jsonl` 等验证日志 | 保留（本项目自有诊断文件，不含用户材料内容） |
| `<DSH_HOME>/scholarflow/`（空目录） | 由探针的 `mkdirSync` 创建（写入随后被沙箱拒绝）。这是 SPEC §16.1 规划的插件私有库父目录，保留为空目录；**G0 结束时复核一次内容** |
| desktop profile 的 bundle 选择曾被移除后恢复 | 已用 `set_bundle(true)` 恢复并按 SHA-256 复核用户数据未受影响；原因未确定，已记入 10.1 |
| `%TEMP%\scholarflow-g0-fs\` 与 `%TEMP%\g0-*.jsonl` | 保留为临时验证产物 |
| 用户工作区中探测用空目录 `.scholarflow-g0-probe` | **已删除并核验**，工作区恢复原状（7 项，无新增／修改） |
| `<DSH_HOME>/scholarflow/`（探测用空目录） | **已删除并核验** |
| 真实模型调用 | provider `deepseek-official` / model `deepseek-flash`，共约 6 次小请求（每次 ≤512 maxTokens，其中 3 次中途取消），用量已记录在日志中 |

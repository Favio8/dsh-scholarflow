# ADR-003：宿主插件的导入、服务与客户端约束（G0 实测）

- **日期：** 2026-10-04
- **状态：** 已实测事实 + 由此确定的实现约束
- **相关：** `docs/integration-verification.md`；SPEC §3、§21、§23、§31.2

## 背景（实测）

在 `scholarflow-g0` 验证 profile 中，从被 `link:` 的插件包内动态 `import()` 以下裸标识符，
**全部失败**，错误码 `ERR_MODULE_NOT_FOUND`：

| 标识符 | 结果 |
|---|---|
| `schemastery` | `ERR_MODULE_NOT_FOUND` |
| `zod` | `ERR_MODULE_NOT_FOUND` |
| `cordis` | `ERR_MODULE_NOT_FOUND` |
| `@deepseek-ai/dsh-tools` | `ERR_MODULE_NOT_FOUND` |
| `@deepseek-ai/dsh-client-ui-slots` | `ERR_MODULE_NOT_FOUND` |

原因：`$DSH_HOME/profiles/node_modules/@deepseek-ai/*` 是指向
`<USER_HOME>\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\...` 的 junction，
而该 npx 缓存目录**已被删除**（悬空链接）。宿主自身的包解析走 app.asar 内部，
不经过 profile 的 `node_modules`。

同时实测：**插件 `apply` 执行时组合尚未完成。** 同一份候选服务清单：

- `apply` 时刻：20 个可用、10 个不可用
- 启动后 2000 ms：**28 个可用**，仅 `slots`（客户端服务）与 `invariants` 不可用

晚到的服务包括 `workspaceRegistry`、`workspaceController`、`workspaceFiles`、
`sessionController`、`sessionSkillCatalog`、`webServer`、`credentials`、`pluginManager`。

本机可工作的第三方插件 `@dsh-external/dsh-mode-boost` 与之吻合：它是**零导入**插件，
只通过 `ctx` 使用宿主能力，并用内联 JSON Schema 代替 `defineTool`。

客户端半体实测可用内建（`client Builtin.listBuiltins`）：

| 内建 | 签名 | 说明 |
|---|---|---|
| `ctx` | `get(name)` / `on(name, fn)` / `provide(name, value)` / `effect(cb, label?)` | 受限 Cordis Context，**无 require** |
| `React` | `createElement(type, props, ...children)` / `useState` / `useEffect` | 「React runtime exposed without JSX transformation」 |
| `host` | `call(method, args?) => Promise<JsonValue>` | Client → 本包 Host 半体的私有 JSON RPC |
| `styles` | `insert(css) => () => void` | 包自带样式，随客户端运行清理 |
| `console` | `log` / `error` | 带包标记的浏览器日志 |

## 决定（约束）

1. **本项目插件不得依赖任何裸标识符导入。** 宿主能力一律通过 `ctx` 取得；
   需要等待的服务用 `inject` 声明硬依赖，或在 `ctx.get(name)` 上做 `undefined` 检查。
   → 因此 `src/core/` 的领域层必须保持零宿主依赖（与 SPEC ADR-002 一致）；
   Core 需要第三方库（如 Markdown AST 解析器）时，必须把依赖**打进插件自身的产物**
   （M1 引入构建时通过打包解决），不能指望宿主 `node_modules`。
2. **不在 `apply` 时刻做服务存在性判断。** 需要晚到服务的能力必须
   `inject` 该服务（Cordis 会推迟激活），或显式在组合稳定后重读。
   G0 探针改为在 `apply` 与 `+2s/+6s/+12s` 各读一次并**分别记录**。
3. **客户端半体以零依赖、无 JSX 的形式交付：**
   打包形状为 `window.__ModuleLoader__.load({ id, factory })`，
   `factory` 内 `exports.inject` / `exports.apply(ctx)`，
   组件用 `React.createElement`（不引入构建期 JSX），
   Client→Host 用 `host.call(...)`，样式用 `styles.insert(...)`（包自带、随运行清理，
   **不做全局 CSS 覆盖**）。
4. **设置页需要插件声明 `Config`。** 实测 `settings.describe()` 返回 19 个命名空间，
   命名空间即 **profile loader entry id**，而本项目插件因未声明 `Config` 而**不在其中**。
   由于 `schemastery` / `zod` 均不可导入，Config 的可用形式须在 G0-05 中实测确定
   （可能接受纯 JSON Schema 对象），不得预先假定。

## 后果

- 正面：插件分发面极小（零运行时依赖），与宿主耦合点为 `ctx` 提供的服务，正是 SPEC §3.2
  期望的 Host Adapter 形态；也避免用户必须安装额外依赖。
- 负面：M1 必须自带打包步骤（把 Markdown 解析器等依赖内联），否则无法使用第三方库。
  G0 阶段不引入构建（见 ADR-001）。
- 审查点：任何 `import` 直接写宿主包名或第三方库名的代码，都会在真实 profile 中
  `ERR_MODULE_NOT_FOUND`；代码审查必须拦截。

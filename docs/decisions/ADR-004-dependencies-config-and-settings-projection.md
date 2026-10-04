# ADR-004：依赖解析、`Config` 与设置页投影（G0 实测）

- **日期：** 2026-10-04
- **状态：** 前三项已实测确定；第四项仍开放
- **相关：** ADR-001（G0 无 TS 构建）、ADR-003（导入与服务约束）、SPEC §6.4／§8、§16

## 背景与实测

### 1. `link:` 安装不安装依赖 —— 原先的「不可导入」判断已被推翻

初始实测：插件内 `import('schemastery')`、`import('zod')`、`import('cordis')`、
`import('@deepseek-ai/dsh-tools')` 全部 `ERR_MODULE_NOT_FOUND`。
ADR-003 当时据此推断「第三方库必须打进产物」。

**该推断被后续实测推翻**：在本包内执行 `pnpm add zod` / `pnpm add schemastery@^3.18.0`
之后，同一探针返回 `zod: "resolved"`、`schemastery: "resolved"`。

根因是**安装方式**而非宿主协议：

- profile 的 `node_modules/@deepseek-ai/*` 是指向已删除 npx 缓存的悬空 junction；
- `pnpm add <本地路径>` 只建立 `link:`，**不会**安装被链接包的 `dependencies`；
- 宿主自身从 app.asar 内解析包，不经过 profile 的 `node_modules`。

## 决定

1. **依赖正常声明在 `package.json` 的 `dependencies` 中**（当前为 `schemastery@^3.18.0`、
   `zod@^4.6.5`），不假设「必须内联打包」。
2. **本地（`link:`）开发必须在本包目录执行一次 `pnpm install`**；
   `pnpm-lock.yaml` 入库以保证可复现。正式分发若走 tarball／registry，
   由 pnpm 安装依赖，无需打包器。
3. **`Config` 必须用 schemastery，不能用纯 JSON Schema 或 zod。**
   实测：纯 JSON Schema 与 zod schema 都**不产生设置命名空间且无任何报错**；
   换成 schemastery 后 loader 立即读取并物化默认值 —— `apply` 收到的
   `config` 为 `{g0ProbeMarker:"", defaultProjectType:"course-paper"}`。
   `settings.describe()` 投影出的官方 schema 也正是 schemastery 的内部
   `{uid, refs, dict}` 形态。
4. **入口壳必须转发全部 loader 相关导出。**
   `src/host/index.js` 最初只转发 `name`/`inject`/`apply`，导致 `Config` 从未到达 loader。
   这是**静默能力丢失**：没有报错、没有诊断，只表现为「设置页不存在」。
   → 已修为同时转发 `Config`。后续新增任何 loader 识别的导出都必须同步转发。

## 后果

- 正面：M1 不需要为了使用第三方库（如 Markdown AST 解析器）先建一套内联打包；
  只需正常声明依赖 + 锁定 lockfile。这是对 ADR-001「G0 不引入构建」的**放宽而非推翻** ——
  TypeScript 编译仍是 M1 待评估项，但依赖管理已不再受阻。
- 负面与风险：
  - `link:` 开发体验脆弱（忘了 `pnpm install` 就会静默少依赖）；
  - 用户用 `link:` 方式安装本插件时，其依赖不会被自动安装。**M1 必须决定分发形态**
    （tarball／registry／自带依赖），并把这一点写进 README。
- **仍开放（第 4 项）**：`settings.describe()` 投影设置页的确切前置条件仍未确定。
  已排除：schema 库缺失、schema 类型错误、缺少 `settings.configure({auto:true})`
  （该调用已成功注册但投影仍为 0）。
  待验证假设：**只有 bundle 管理／可寻址的 entry 才会被投影**，
  而验证 profile 里本插件的行是手工 patch insert（可能属于 `unaddressable`）。
  决定性验证须在 desktop profile（本插件经 `dsh.profile.bundles` 安装）完成，
  且需要一次重启以加载含 `Config` 转发的新代码。

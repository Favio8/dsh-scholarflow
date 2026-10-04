# ADR-002：宿主模块缓存与验证用热重载手段

- **日期：** 2026-10-04
- **状态：** G0 阶段手段；M1 需重新评估
- **相关：** `docs/integration-verification.md` G0-01；`src/host/index.js`

## 背景（实测）

DSH 0.2.0-rc.2 的 profile loader 以**解析后的 URL** 作为 ES 模块键，导入插件入口时不附带
cache-busting 查询串。实测过程：

1. 把 `src/host/index.js` 从 `ctx.on('dispose', ...)` 改为 `ctx.effect(...)`；
2. 停用再启用 bundle（`plugin_manager set_bundle`，两次都返回 `application: "applied"`）；
3. `apply` 重新执行了，但**新增的 `ctx.effect` 分支没有执行** —— 运行的是缓存中的旧模块实例。

同时实测 profile 的 `hmr` 行配置为 `config: { root: [] }`，即**没有监听任何根目录**，因此
`hmr` 也不会为被 `link:` 的包做热重载。

本机第三方插件 `@dsh-external/dsh-mode-boost` 的源码注释记录了同一陷阱
（其子模块导入写作 `./core.js?v=2`，注释明确写着「the ESM cache keys by URL」）。

## 决定

G0 阶段采用两条并列手段，**都不修改 DSH 本身**：

1. **入口壳 + mtime 版本的实现模块。**
   `src/host/index.js` 是稳定的入口壳，它在顶层用
   `impl.js` 的 `mtimeMs` 作为查询串动态导入 `src/host/impl.js`：
   `import('./impl.js?rev=<mtime>')`。这样仅改动 `impl.js` 就能在**不重启** DSH 进程的前提下，
   通过「停用→启用 bundle」加载到新代码。
   壳自身若失败，降级为一个只写日志的惰性插件，**绝不因为验证脚手架而破坏 profile**。

2. **一次性验证 profile + CLI 独立进程。**
   `dsh <profile> --from-default-profile web` 创建一个专用的 `scholarflow-g0` profile，
   用 `dsh scholarflow-g0 --patch <overlay> --no-open --port 0` 在**独立进程**中启动，
   通过 `--patch` 直接从工作副本加载插件。每次启动都是干净进程，宿主平面代码改动立即生效，
   且**完全不触碰用户正在使用的 desktop profile**。

## 后续结果（2026-10-04，同日追加）

本轮又验证了一层：**入口壳的 top-level `await` 并不是 G0-05 设置页不投影的原因。**
把入口从「mtime 版本化动态导入 impl」改为**纯静态导入、零 TLA**，重跑后
`settings.describe()` 的 `ownCount` 仍为 **0**，而 `apply` 仍能收到 schemastery 物化的默认值。

因此：

- **手段 1（入口壳 + mtime 版本化实现模块）已在本次改动中移除。** 它的用途是
  「在 desktop 的活进程里不重启就加载宿主平面新代码」。G0 阶段的实际迭代走的是
  手段 2（CLI 独立进程），而 desktop 侧的代码更新最终仍需一次进程重启（已实测：
  重新启用 bundle 无法替换已加载的模块实例）。移除后入口变为静态 `export`，
  与已发布插件形态一致，副作用面更小。
- `impl.js` 的 `zod` / `schemastery` 也**改为静态导入**：两者都已是声明依赖（ADR-004），
  缺失时插件应当**大声失败**，而不是静默降级掉设置能力 —— 后者正是本次排查中最难诊断的一环。
- **若 M1 需要活进程内热重载**，恢复手段 1 只需改回 `src/host/index.js` 一个文件，
  本文开头记录了完整做法与实测依据。

## 后果

- **正面：** G0-01～G0-10 的宿主平面迭代不再需要反复重启用户的桌面宿主（每次重启都会打断用户
  正在进行的会话）。实测一次 CLI 启动约 1～2 秒，登录探针约 0.6 秒完成。
- **负面与约束：**
  - 入口壳引入了一层间接与一次 `fs.statSync`；这是**验证期手段，不是产品架构**。
  - 两个进程共享同一个 `DSH_HOME`，因此验证进程写下的日志按
    `SCHOLARFLOW_G0_LOG` 环境变量分流，避免与 desktop profile 的记录混在一起。
  - 用 `--patch` 从工作副本加载，**绕过**了包安装路径；因此 bundle 打包与安装契约仍必须在
    desktop profile 上单独验证（G0-01 已如此做）。
- **触发重评：** M1 引入正式构建与重载流程后，删除入口壳，入口回到构建产物；
  CLI 验证 profile 是否保留，取决于 M1 之后是否仍需要独立宿主平面回归。
- **未修改 DSH：** 以上手段全部位于本项目代码与 `$DSH_HOME` 的 profile 目录内，未触碰
  DSH 安装目录、未打补丁、未做猴子补丁。

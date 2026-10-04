# ADR-001：G0 骨架直出零依赖 ESM JavaScript，暂不引入 TypeScript 构建链

- **日期：** 2026-10-04
- **状态：** G0 阶段临时决定，M1 开始时重新评估
- **相关：** SPEC §4.1（以 TypeScript 为主）、SPEC §4（目录结构）、本仓库 `AGENTS.md` 规则四／规则五

## 背景

SPEC §4.1 要求「以 TypeScript 为主」。但 G0 门禁（SPEC §2.2）的唯一目标是**证实宿主集成点**，
不要求产品级工程化。本机实测：

- `tsc` 不在 `PATH`；`Get-Command tsc` 无结果。
- `~/.dsh/profiles/node_modules` 下不存在 `typescript`。
- `~/.dsh/profiles/node_modules/@deepseek-ai/*` 是指向
  `<USER_HOME>\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\...` 的 junction，
  而该 npx 缓存目录**已不存在**（悬空链接）。
- 因此「能否在不联网的前提下取得 TypeScript 工具链」尚未证实。若强行引入，G0-01
  「本地打包的 bundle 能安装」会因为构建工具缺失而失败，与被验证的宿主能力无关。

## 决定

G0 阶段插件以**零依赖 ESM JavaScript** 写在 `src/host/`，`package.json` 的入口直接指向
`src/host/index.js`。

本仓库 `.gitignore` 已把 `lib/` 视为构建产物，因此本决定**不改动 `.gitignore`**，`lib/`
保留给 M1 的 TypeScript 构建输出。

## 后果

- **正面：** G0 安装链路不依赖网络、不依赖任何构建工具，故障面最小；被验证的正是宿主真实的
  模块加载路径。与本机已有的第三方插件先例（`@dsh-external/dsh-mode-boost` 以
  `lib/index.js` ＋ `package.json` 交付）形态一致。
- **负面：** 没有静态类型检查；SPEC §4 期望的 `src/**/*.ts` 布局被推迟。
- **触发重评：** M1 开始时先尝试引入 `typescript`（或使用宿主已提供的构建链）。
  成功则把 `src/host/*.js` 迁移为 `.ts`，入口回到 `lib/`，并在本文追加结果记录。
- **不变的红线：** 即使当前是 JS，`Core` 层仍不得依赖 DSH／React／模型 SDK；
  后续 `src/core/` 的领域逻辑必须可离线独立测试。

# 模型审查字段名漂移与五节点图标（v1.20 收尾）

日期：2026-10-12。两件事，都不是新需求：一个是真 bug，一个是既有图标的启用。

## 一、AI 检查永远不出结果：提示词与 schema 字段名漂移

用户报告「AI 审查之后不能出现结果」。界面显示「一次格式修复后审查输出仍不满足合同，未更新报告。」——那不是配置问题，是代码路径。

### 证据

读真实项目 `C:\Users\19949\Desktop\科技论文写作test1\.scholarflow\runs\` 下各 model-review 检查点：

```
run_b846afae…  formatAttempts=2  hasOutput=false   ← 失败
run_f06b7b54…  formatAttempts=1  hasOutput=true    rechecks=3  键 = issueId ✓
run_8c0eee6d…  formatAttempts=1  hasOutput=true    rechecks=0  （空数组，用不到字段名）
```

失败运行的 `repair` 字段原文：

```
rechecks.0.issueId: Invalid input: expected string, received undefined
rechecks.0: Unrecognized key: "oldIssueId"
```

### 根因

| 位置 | 写的名字 |
|---|---|
| `src/shared/review.ts` schema | `issueId` |
| `src/core/review/model.ts` 两处提示词 | 「给定**旧 issueId**」「有**旧 issueId**」 |

中文散文里的「旧 issueId」被模型直译为 `oldIssueId`。schema 用 `.strict()`，多一个键整份输出作废；`formatAttempts` 只有 2 次，两次都猜错就抛 `MODEL_REVIEW_INVALID`。

这是**概率性**失败：同一项目有一次就返回对了 `issueId`。空 rechecks 也天然绕开。所以它不会每次都发生，但一旦发生就是整轮白跑两次付费调用。

### 为什么那一轮修复救不回来

`model-run.ts` 的 repair 提示只说「问题和复查使用给定身份」，从未点名字段名。第二次调用收到的只有 Zod 报错文本，模型仍从中文自然语言里重新猜了一遍。

### 修复

1. **单一来源。** `recheckFields` / `findingFields` 提到 `shared/review.ts` 顶层，schema 与提示词都从它们构造，并导出 `modelReviewKeys`。提示词里不再手写任何字段名，构造上不可能漂移。
2. **显式否定错误拼法。** 提示词写「键名拼作 issueId（不是 oldIssueId、不是 issue_id、不是旧问题 ID）」。
3. **非空示例。** 两处 `JSON 形状示例` 原来 `rechecks: []` 是空数组，模型没有任何非空参照。改为给出一条带全部五个键的示例。
4. **repair 针对 strict 失败。** `unrecognized_keys` 单独识别，生成「你多写了字段 X，必须删除。允许的字段名只有：…」——这类错误模型无法靠重读字段列表自查。
5. **诊断透出。** `checkpointSchema` 增加 `contractFailure`（只有字段路径与解析器消息，无模型原文、无正文），`MODEL_REVIEW_INVALID` 的 message 带上它。界面「查看原因」直接显示，用户不必翻磁盘。

### 测试

新增 `tests/unit/model-review-prompt-keys.test.ts`：提示词提到的每个键都必须是真键、每个真键都必须被提到、示例必须非空、示例里不得出现 schema 之外的键、且断言当年那个 `oldIssueId` 的输出**仍然**被拒绝（repair 提示是按 `unrecognized_keys` 写的，这个失败模式必须保持这个 code）。

写这个测试时它先抓到了自己：`不是 oldIssueId` 里的 `oldIssueId` 被当作「声明的字段名」。断言收窄到只扫 JSON 示例——散文里那个词是**被否定的**，正则分不清「声明」和「禁止」。

同时改了 `tests/integration/model-review.test.ts` 里一句绑死在旧提示词字面上的断言。它的意图是「legacy 两检查 scope 拿到的是两检查 prompt 而不是五检查那个」，所以改成点名两个检查名、**并排除三个只属于跨节检查的名字**——比原来那句更严。

## 二、五节点状态标记从字符改为 SVG

`flow-navigation.tsx` 原本用 `'✓'` / `'!'` / `'Ⅱ'` 三个字符渲染状态。这三个字符经过宿主解析出的字体渲染，形状随机器变化，10px 下读起来像笔误而不像状态。

没有引入外部图标库：`workbench-chrome.tsx` 的 `WorkbenchIcon` 已经是 Feather 风格 stroke SVG 集，且含 `check` / `warning` / `loading` / `stop`——和本 chrome 其它所有图标同一套语言、同一 `currentColor` 主题通道。混用外部素材只会带来风格不一致、图标字体或 SVG 加载链，以及和主题色脱钩。

映射：`completed→check`、`attention`/`stale`→`warning`、`running→loading`（新增旋转动画）、`paused→stop`、`pending→空`。`WorkbenchIcon` 的 `size` 增加 `12`。

顺带修一处对比度：`running` 是 accent 实心底，图标原先继承 muted 灰，蓝底上读不清，改为 `var(--sf-surface)`。

实测（Chromium，3x DPR）：六种状态全部渲染为真 SVG，路径正确、尺寸在环内、描边色随状态 token 变化。

## 遗留

- 失败的 run 不会自动复活——它的检查点记着 `formatAttempts=2`。需走新 run，界面已有「重试」。
- `creation-wizard.tsx:614` 的步骤指示器仍在用 `✓` 字符，不在本次范围内，未动。

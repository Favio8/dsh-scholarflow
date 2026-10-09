# 课程论文结构与学术排版导出的实现决定

日期：2026-10-09。对应 PRD/SPEC v1.7（SF-093～SF-101）。本文记录实现期的取舍、开源参考的借鉴范围，以及明确不做的事。

## 1. 触发与范围

2026-10-09 用户反馈：「当前的这个模版格式还是比较少，且不符合实际的课程论文的要求」。经确认范围：结构预设（章节模板）与导出排版（Word/LaTeX）一起改；扩 schema 增加子章节与前置后置部分；排版默认采用开源通用中文学术规范；三类论文统一应用该默认，英文项目只应用中性的页码与可选目录。

## 2. 开源参考与借鉴范围

检索日期：2026-10-09。下列项目用于理解"一篇真实的中文课程论文长什么样"，未复用其代码；本插件不引入任何新的运行时依赖。

| 参考 | 借鉴范围 | 本项目取舍 |
|---|---|---|
| [Gostyan/docx-skill-4-cn-paper](https://github.com/Gostyan/docx-skill-4-cn-paper)（438★，MIT） | 页面（A4 11906×16838、四边 1418 twips）、字体槽位（宋体/Times New Roman + Cambria Math）、字号阶梯（正文 24 半磅、H1 32、H2 28、H3 24、图表题注 22）、首行缩进 480 twips、三线表（12/6/6）、公式三列无边框表格、图表题注位置、GB/T 7714-2015 条目格式与 Reference 悬挂缩进、摘要后与参考文献前分页 | 不引入 `temml`/`mathmlToDocx` 公式转换链；公式编号按文档顺序由本插件生成，Word 公式内容保留 TeX 表达式（既有行为，formatNotes 说明） |
| [Doryoku1223/lunwen-skill](https://github.com/Doryoku1223/lunwen-skill)（652★） | 章节模式（绪论=背景/现状/目的意义/结构；实现章=功能→流程→代码→截图；测试章=环境/方法/用例/结果/分析）、摘要与 Abstract 各占一页、关键词单独成段顶格、参考文献悬挂缩进 | 不引入其 intake/分析工具链；课程论文的子章节拆分按 R1–R3 写作指南而非其毕业论文模板 |
| [Keldos-Li/typora-latex-theme](https://github.com/Keldos-Li/typora-latex-theme)（5980★）、[yzbrlan/fudan-thesis-latex-template](https://github.com/yzbrlan/fudan-thesis-latex-template) | 仅作风格参照：本科生轻量级课程论文的中文 LaTeX 观感 | 不做成 Typora 主题，也不做学校专属模板；学校模板走 `typographyFromText` 识别，不内置任何一所学校的封皮 |

写作结构依据沿用 R1–R3（Purdue OWL Argumentative Essays / UNC Scientific Reports / Purdue OWL Book Reviews）与 R5（Baxter & Jack 2008），见 `03-preset-library.md` §1。

## 3. 关键取舍

**schemaVersion 维持 1。** 新预设带 `subsections`，旧版插件读到时 `.strict()` 拒绝并单独报告跳过。这是既有合同对损坏条目的既有答案（`library.ts` 的"报告而非修复"），不为它发明降级路径。反向兼容靠字段缺省：`subsections` 缺省 `[]`、`leadShare` 缺省 0，展平结果与今天逐字节等价。

**父章保留一个大纲行。** `sectionTarget()` 要求子章节的父标题存在于正文，父章不占行则 `SECTION_PARENT_REQUIRED` 永久阻塞。父章权重 0 时 `allocate()` 的 floor pass 自然把它压到 50 字并移出加权池，算法零改动。为此 `writingSection.allocationWeight` 由 `positive` 放宽为 `nonnegative`；展平后全零权重在"章内占比合计为 1"下不可能出现，无需额外守卫。

**前置后置部分排在正文之后生成，但文档顺序仍在前。** 摘要只能总结已写完的正文。明确拒绝在导出层合成摘要：那既违背 Markdown 唯一事实源（ADR-004），又等于无依据生成，直接撞学术真实性硬规则。排序决策写入 `task.notes`，使其可审计。

**统计口径必须拆。** `writing_length` 是整篇 0.9–1.1 倍约束；摘要进正文后 2000 字目标上限 2200、实际 2300 必然超限，每篇短课程论文都会挂一条篇幅问题。因此 `wordStats` 增 `bodyOnly`，审查、长度比较与长度修正全部改用正文口径。整篇与正文两个数都在质量报告可查。

**题注编号绝不发明。** 编号从主稿原文读取；识别不到时按原样导出并在 `formatNotes` 报告。没有相邻图表的题注段落保持普通段落——丢弃它会丢字。

**heading 编号 9 级全部显式 decimal。** 任一层回落到默认样式，OOXML 会把二级标题渲染成"二.4"。这是开源实现明确警告过的坑。

**封面改为独立 section。** 替代 v1.2 §16"封面为第一个 section，其后插分页符"这一句。用 `pageBreakBefore` 而非插入 `PageBreak` run，避免产生空段。

**docx 的 `updateFields` 在顶层 `features` 下。** `settings: { updateFields: true }` 在 docx 9.8.1 中被静默忽略，目录域不会提示更新；正确写法是 `features: { updateFields: true }`。

**不引入 `gbt7714`/`biblatex`。** 完整 GB/T 7714 参考文献需要这两个包之一。LaTeX 侧为手写 `thebibliography` 近似悬挂缩进，DOCX 侧为精确 `w:ind/@w:hanging`；文献类型标签由登记 `kind` 推断而非出版信息核验。两者都在 `formatNotes` 与 `referenceNotes` 中说明。这是"能力不足要明说"，不是缺陷隐瞒。

**`STRUCTURES` 离线兜底不改。** 它是预设库读取失败时的兜底路径，改它会在无声中改变失败路径的行为。

**`layoutOf` 必须真的读 spec。** 首版实现直接返回 `DEFAULT_LAYOUT`、忽略传入的 `TypographySpec`，导致"标题不编号"的要求拿到编号。已修正，并有单测覆盖。

## 4. 明确不做

- 不做公式转 Word 原生 OOXML 公式（保留 TeX 表达式，notes 说明）。
- 不做图片资源的复制与路径重写（导出器对图片仍报告"未验证"，图以文字引用形式导出）。
- 不做学校模板封皮内置；学校模板经 `typographyFromText`/`coverFromText` 识别。
- 不新增第四种论文类型，不改 `paperType` 枚举。
- 不改 Pipeline 状态机阶段定义，不改 Proposal→接受→受控写入契约。
- SF-101（新增课程论文内置预设）为可选项，未实现；实现时须同批修改契约测试的数量断言并说明。

## 5. 证据与未验证项

已在安装版 DeepSeek Harness 上跑通 `node tests/e2e/course-paper-export.mjs`：脚本自建链接本工作副本的隔离 profile、建项目、登记两个来源、写入覆盖全部排版决策的稿件，走插件自己的交付链路导出，再把 OOXML 读回来断言 16 项布局事实，16/16 通过。

仍未验证：实际页数（本机无 LibreOffice，脚本记录实际页数未测量而不编造）、TeX Live 编译、用户在真实宿主上的目视确认。SPEC v1.2 §16.3 的导出成功不等于排版合格因此只满足到 XML 属性一层。

## 6. 风险与回滚

导出回归风险最高：标题编号、分页、页脚改变所有既有 DOCX 导出行为。全部可通过 `TypographySpec` 字段关闭；`scan.ts` 为纯函数无副作用；回滚=改 `layout.ts` 的 `DEFAULT_LAYOUT` 开关值。结构侧回滚=还原四个预设 JSON 与 `presets.ts`，parity 测试立即变红提示不可部分回滚。

# Chrome 归并为两条常驻带（v1.20）

日期：2026-10-12。落地 PRD／SPEC v1.20 的 SF-185–189，替代 `layout-fixes-v1.17.md` 的工具栏呈现位置与 `flow-navigation-v1.18.md` 的五节点独占整行。

2026-10-13 后续性能修复：用户明确授权后，修掉隐藏预览逐键重渲染和根节点重复遍历；两次独立桌面打字 p95 **16.1／17.2ms**，均低于 26.51ms，当前打字性能结论改为**通过**。分层测试 663/663、预览渲染 3/3、v15 7/7、v19 7/7 通过。额外 `render:surfaces` 仍在旧镜像标注定位失败，未计入通过。详细根因、前后证据和范围见 [打字性能修复记录](typing-hidden-preview-performance.md)；下文旧三轮失败保留为修复前证据。

## 问题

正文容器 `.sf-paper-content{flex:1;min-height:0}`（`src/client/paper-workspace.tsx:112`）是 `.sf-paper-project` column flex 里唯一可压缩的子项，其余全部 `flex-shrink:0`。从工作台顶到正文第一行固定占高：

| 层 | px | 位置 |
|---|---|---|
| 项目条 | 56 | `paper-workspace.tsx:91` |
| 视图切换＋五节点 | 48（窄态 90–100） | `flow-navigation.tsx:16,33` |
| 写作进度带 | 42 | `writing-progress.tsx:148` |
| 格式工具栏 | 46（wrap 时 80） | `format-toolbar.tsx:60` |
| 目录带 | 28 | `writing-progress.tsx:182` |
| 面板题注 | 34 | `paper-workspace.tsx:125` |
| 滚动区内边距＋纸页边距＋页眉 | 177 | `paper-workspace.tsx:137,143`、`draft.tsx:632` |

合计约 390px，条件横幅最多再加 102px。窗口变矮时被压缩的永远是正文。

用户截图里“7/7 节”被上一条压住是误读：`.sf-paper-toolbar` 与 `.sf-writing-progress` 同为 `--sf-plane-1` 且都无下边框（`paper-workspace.tsx:105-106` 的注释说明这是刻意的），两条色带并成一条，看起来像重叠。本版把两者并入同一网格行，问题自然消失。

## 决定

1. 工作条 grid 扩为 `auto minmax(0,1fr) auto auto`，写作进度以药丸形态作为第三列。药丸只输出状态点、状态文字和一个 details；全部操作与错误进入 details。
2. `WritingProgress` 增加 `variant` 参数，只切呈现，不动轮询、动作与迟到结果隔离。
3. 格式工具栏与目录带合并为 `.sf-draft-tools-bar` 单行，格式左对齐，排版／目录／阅读比例／保存右对齐。`FormatToolbar` 增加 `variant="bar"`。
4. 面板题注不再作为常驻高度层，题注内容上移进编辑栏；分栏视图下题注恢复为分区标签。
5. 五节点窄态改为 `overflow-x:auto` 横向滚动，取消 `grid-row:2`。
6. `.sf-editor-notice` 多条合并为一条可展开汇总。

## 不做

- 不动纸页内边距、`.sf-paper-page{min-height:900px}`、`210mm` 页宽与 `--sf-*-size` 排版变量。这些是导出保真的一部分，动它们要连带回归 `word-academic-layout` 与导出测试，收益（≈118px）不足以换取该风险，留待单独排期。
- 不动五节点的数量、顺序、状态语义与键盘可达性，也不删任何功能入口。

## 代价

- `WritingProgress` 的操作从常驻变为二级，需要一次点击才能到达暂停／停止。因此药丸在有错误或待处理项时改用告警色并把徽标改成「需处理」，问题不会只藏在折叠层之后。
- 编辑栏窄栏下元素较多，需 `min-width:0` 与 `overflow-x:clip` 兜底；390px 下段落类型与字号收进「排版」面板而不是换行。
- `.sf-pane-caption` 归零后，`workbench-performance.mjs` 中依赖它定位保存按钮的断言需同步更新。
- `v18-flow-navigation.mjs` 的 layout 阶段断言 `narrow.flow.y > narrow.views.y`（换行），本版改为断言横向滚动，需更新。

## 自审中发现并修掉的缺陷

首轮实现通过了类型检查、构建、658 项测试与外观审计，但那些都不检查浮层是否被祖先裁掉。补做逐面板的命中测试后：

1. **目录下拉不可用。** 编辑栏的 `overflow:hidden` 把 `.sf-chapter-nav > div` 整块裁掉了，`document.elementFromPoint` 命中的不是面板里的按钮。改用 `overflow-x:clip; overflow-y:visible`——`clip` 不建立滚动容器，所以行内溢出仍被挡住，向下的面板存活；`hidden` 会连带把另一个轴变成裁剪。
2. **提示汇总的浮层必被裁。** 该条位于 `.sf-editor-surface` 内，而它 `overflow:hidden`；挂在下面的面板会被自己所在的容器切掉。改为就地展开，不使用浮层。
3. **进度药丸的浮层溢出视口约 314px。** 药丸在工具栏右缘，面板却向左锚定，越过右边界，右侧按钮点不到。改为 `right:0` 向左生长。
4. **药丸把错误藏进了折叠层。** 原设计下 `role="alert"` 的错误只在打开详情后可见，`task-details.mjs` 用的 `textContent` 断言仍会通过——这正是静态检查漏掉的那类问题。改为告警色 + 「需处理」。
5. **新写的 v17 断言必挂。** 它拿 `.sf-toolbar-progress` 的 `left` 与导航右缘比较，而无任务时该网格列宽度为 0、矩形退化成 `(0,0,0)`。改为先判断该列是否有实际宽度再断言。

前四项是我引入的；第五项是我为修一个本已损坏的测试而重写时新引入的。`v17-layout.mjs` 与 `v18-flow-navigation.mjs` 在改动前就已失效（它们定位 `.sf-paper-actions`，v1.19 已删除该元素）。这两个脚本、它们共用的启动对话框处理，以及本版新补的断言都已在安装态跑通，见下节。

## 验证（2026-10-12，安装 DSH 隔离 TEST_ONLY profile）

验证对象是本次构建产物 `dist/client.js`（4,538,263 字节，sha256 `dc137619…`）。全部运行在安装版 DeepSeek Harness 的隔离 TEST_ONLY profile 中，未调用模型、未产生费用、未读取用户项目。

| 项 | 结果 |
|---|---|
| 类型检查 / 构建 / 分层测试 | 0 错误 / 0 错误 / **663/663** |
| AT-185 常驻带数（1440 / 740 / 390） | 正好 **2** 条：项目条 57px、工作条 56px |
| AT-188 五节点横向滚动 | 740px 容器 397 / 内容 442；390px 容器 63 / 内容 317；三种宽度 `scrollWidth ≤ width`，右侧更多工具不被遮挡 |
| AT-185 药丸动作可达 | 运行中「暂停／停止」、暂停「继续生成」、完成「核对清单」与「运行记录」都在药丸下拉内可点；「运行记录」直达「运行与恢复」页 |
| AT-186/187 编辑栏单行 | `flex-wrap:nowrap`；全部控件竖向中心差 **0px**；横向溢出 **0px**；加粗／斜体／排版／目录／阅读比例齐备；目录内含「调整章节结构」并可打开结构面板 |
| AT-187 面板题注 | 编辑与预览两种单视图下题注高度均为 **0px** |
| AT-189 提示条 | 「正文版本发生变化，当前编辑已保留」合并为 **51px** 一行，操作「查看与处理」保留 |

以下边界与未验项都不当作已通过：

1. **≥2 条提示同时出现的情况在本机无法触达。** 另外两个来源（会话改写消息、待保存决定）各需一次模型调用，因此「三条合并成一条」只验到单条形态与它的一行高度；`.sf-notice-more` 的折叠与展开未在真实 DOM 上执行过。
2. **分栏视图不可达。** v1.15 起「分屏」已不在正文工具栏，`view` 只取 `edit`／`preview`，所以 `.sf-editor-grid:not([data-view=edit]):not([data-view=preview]) .sf-pane-caption{display:flex}` 目前是死分支——题注在可达范围内恒为隐藏。这不是本版引入的，保留该规则是为了分栏回归时标签仍在。
3. **启动对话框的关闭是异步的。** 点完「继续」后节点会保持挂载、按钮转为 disabled，直到宿主真正把它移除（本机实测关闭窗口最长约 30 秒）。三个脚本与它们共用的 `dismissOnboarding` 因此改为「轮询等出现 → 仅在 enabled 时点击 → 等按钮真正消失」；原写法会点在关闭中的节点上白等整个 click 超时，或在对话框挂载前就判定 shell 已就绪而让遮罩吞掉下一次点击。
4. **AT-134 打字性能已在后续定向修复后通过。** 本节原三轮 **20.4／30.9／31.6ms** 中后两次失败，当时不能归因为产品代码；后续 CPU 采样确认隐藏预览存在无效计算，用户授权修复后两次为 **16.1／17.2ms**。旧 902ms／72.3 秒干扰数据和三轮失败原样保留，不覆盖历史。详见 [性能修复记录](typing-hidden-preview-performance.md)。
5. **收尾保存已验证，包括性能失败路径。** 汇总断言移到保存与主题截图之后，失败仍非零退出。保存使用 `.sf-format-toolbar`，完成时断言「已保存」且保存按钮消失；已移除的「分屏」改为当前「预览」。三轮保存与两主题截图均成功，退出码依次为 **0／1／1**，无清理 `ProtocolError`。
6. **`task-details.mjs` 已通过 9/9。** 2026-10-13 按当前合同修复向导、返回正文、药丸、检查页标题与已保存状态定位；保留旧 guided 问题动作语义，不冒充新版首稿核对清单或模型检查。逐条合同映射与本机 journal 见末节。
7. **工具栏下拉打断逐选区排版（B2，本版后续已修）。** 逐选区的「中文字体／字号」绑定活的 edit range；`sync()` 在选区映射失败时会把它当成取消选择而清掉，两个下拉随即 disabled，表现为「设完字体再设字号必须重新选一次文字」，与 SF-168／AT-168 的「连续操作作用于当前真实选区」冲突。已在缺陷修复记录 [逐选区排版在重渲染后不再失去武装](selection-armed-across-format-toolbar.md) 中定位（含探针否证）并修复。

## 验证时同步修掉的测试脚本缺陷

都在 `tests/e2e/` 下，不是产品代码。列出来是因为它们决定了上表能不能跑出来；根因都是 v1.16～v1.19 的界面迁移，与本版无关，只是本版第一次真的把这些脚本跑起来。

- **启动对话框**（`v15`／`v16`／`v17`／`v18`／`v19`／`task-details`／`workbench-performance` 共用）。原写法在 shell 刚绘出时只检查一次就点击，或点完立刻重读；探针（`.dsh-tmp/probe-dialog2.mjs`／`probe-dialog3.mjs`，不入库）实测「继续」约 1 秒出现且可用，点击后节点保持挂载、按钮转 disabled 最长约 30 秒才被移除。现改为「轮询等出现 → 仅在 enabled 时点击 → 等按钮真正消失」。
- **`v18 --phase=navigation` 的「更多菜单 → 资料」**：资料自 v1.16 起不在更多菜单里。改为断言该菜单仍含写作要求／项目设置／版本历史、不再含资料与 AI检查，并实地打开项目设置页。
- **`v16` 的两处入口**：`资料`（v1.16 移出更多菜单）与 `检查`（v1.16 移除，现由五节点进入）改用流程节点。
- **`v15` 的排版字段**：v1.16 把逐选区字段收进「排版」面板，需先展开，脚本据此先点「排版」（`全文排版` 如今是面板标题而非按钮）。面板里的字段绑定活的 edit range，而拖选的偏移来自渲染后的 prose，样式一应用就可能映射失败——产品侧「映射失败被当成取消选择」已在 [选区武装记录](selection-armed-across-format-toolbar.md) 修复；测试侧改为**从源码窗格用键盘选中**（偏移是纯数字，不受重渲染影响），并把「设完字体后字号仍可用」写成断言。
- **`v15`／`task-details` 的药丸定位**：核对清单与详情现在在 `.sf-progress-details` 之下，需先展开药丸；v15 另需在读完后收起，因为药丸面板悬在编辑栏上会拦截后续点击。
- **`v19` 的确认文案等待时间**：`保留原稿`／`采用修改` 的确认要等两次宿主往返加一次刷新，而这里用的是 matcher 默认 **5 秒**，是全脚本唯一低于其它步骤 20 秒的地方；高负载下偶发失败（本次复现一次，随后同一构建连跑两次均通过）。已对齐到 20 秒。

### 三个曾跑不通的段落（根因都在 v1.16／v1.19 的界面迁移，已按当前入口重写）

`ModelReview` 的实时分支（`检查全文` 按钮、`.sf-review-action`、暂停／停止）自 v1.19 起**只以 `historyOnly` 渲染**（`src/client/review-export.tsx:80`、`:83`），实时入口是 AI检查页的「一键检查并完善」。也就是说那套入口已经不存在，两个脚本的审查段，加上 `v15` 的资料段，都不是换定位能修的，已按当前入口重写：

- **`v16-writing-fixes`**（现 **7/7**）：一个 AI检查动作 → 宿主先跑规则再准备并启动一次模型审查；实测调用序列为 `inspect → improvements → run → prepareModel → startModel → inspect → improvements`，顺序也在断言里（SF-167）。模型那一半在本 profile 没有凭据，而**让宿主自然失败会让等待取决于提供方超时**（实测一次停在「正在检查」超过一分钟），所以桩只提供两件事；被断言的都是真实那半——规则结果留在页面上、只有一条参考文献问题、没有内部字段也没有下拉（SF-171）。
- **`v18 --phase=all`**（现 **10/10**）：审查阶段的桩有三处要对齐当前实现——run 状态必须是真实终态（`reviewRunFinished` 只认 `succeeded`／`completed-with-issues`，写 `completed` 会被判「未完成」，节点因此挂上「可重试」并覆盖后面要验的报告驱动状态）；`review.improvements` 也要桩（否则助手会真的去跑修订建议生成，本 profile 下失败并把 `reviewActivity` 钉在 `failed`）；释放后的节点状态按**宿主自己的**报告断言（`src/client/review-export.tsx:52` 会用 `review.inspect` 覆盖客户端状态，而本 profile 的宿主没跑模型，所以落到「待检查」——伪造的 run 不该给导航化妆）。`review-failure` 阶段（`--phase=review-failure`，单独 **2/2**）的触发标签用 `.or()` 兼容「一键检查并完善」／「重试」，终态标签按 `src/client/flow-status.ts:73` 取「可重试／已暂停／已停止」。
- **`v15-writing-fixes`**（现 **7/7**）：「资料与引用」已移出更多菜单，资料页改由五节点进入；原本「手动关联两条来源 → 一条书目」的段落改为断言当前合同——两条不同来源保持两条书目、不发生误合并，导出各出现一次。（同 DOI 或相似题名的第二次登记会被 `SOURCE_ALREADY_REGISTERED` 拒绝，手动关联 UI 已随 v1.16 取消。）
- 顺带记录：`ModelReview` 的实时分支仍是**不可达 UI**。它不影响「一键检查并完善」真实跑规则与模型检查，但把这段当作可复用组件的读者需要知道它只以历史形态被渲染。

### 桩要绕开的一个连接层约束

`route.fulfill` 只填 `result` 不够：DSH 的连接层校验整个信封，实测先报 `invalid server-response envelope`，补上真实 status／headers 后又报 `rpcId mismatch for …: sent …, got …`。因此两个脚本的模型桩改成：先用一次**便宜的**真实调用（`project.inspect`）抓下 status／headers 与信封自身字段当骨架，再回填该请求自己的 `rpcId`／`method` 并替换 `result`——这样就不必 `route.fetch()` 那个会真的去够模型端点的请求。

## 2026-10-13 两项收尾复测

本次只修改 `tests/e2e/task-details.mjs`、`tests/e2e/workbench-performance.mjs` 及验证记录，`src/**` 无修改。先执行 `pnpm build` 成功，两份脚本 `node --check` 成功。此次产物 `dist/client.js` 为 **4,538,300 字节**，SHA-256 `c944b8c7809c03015f7c461c301375cc3af019f9576458701b6f19196c494c72`；与上节历史产物分开记录。没有新增产品实现、真实模型调用、费用或包发布。CI 不执行以下 e2e。

### task-details：9/9 PASS 与合同对应

脚本刻意构造没有 mode 的历史任务，schema 默认 guided。[PRD v1.10](../../../docs/ScholarFlow_PRD_v1.10.md)／[SPEC v1.10](../../../docs/ScholarFlow_Design_SPEC_v1.10.md) 明确保留该路径；SF-162 的新版首稿清单不能替代它。SF-185 仅改变药丸呈现。此前 `.sf-material-list` 是失效选择器，零选中会空过；「不含 TEST_ONLY.txt 的扫描页」也是从未出现的文本，现改为目标行确实移除、计数 5→4 和其他问题完全不变。

| PASS 项 | 当前合同与实际断言 |
|---|---|
| new tasks discover files without selecting reference materials | 显式选择资料、原文件只读；向导确实发现两份 TEST_ONLY 文件，复选框数为 2 且选中数为 0。使用 `.sf-material-checklist`，不允许空列表冒充通过 |
| paste requirement action opens editable requirements | SF-153／AT-153 与旧 guided 补文动作：指定文件的「补充要求文字」打开写作要求，文本框真实可编辑 |
| retry action really parses a member and moves only that issue to handled | PRD v1.2 §4.3／SPEC v1.2 §9、SF-152：宿主重新解析为 ready；目标行从 needs 移除、任务中变 handled；其他问题逐项不变 |
| fulltext retry respects offline selection and preserves unresolved status | 原网络显式授权合同与 SF-185：真实宿主拒绝离线取全文；错误实际可见；折叠后仍显示「需处理」和告警标记；问题仍 needs-action |
| remove action deselects the member without deleting the original | SF-148／152／153：任务选用中移除该文件；原文件全文字节内容仍与夹具一致 |
| defer action preserves draft and records the unresolved quality impact | SF-055／056 的 guided 兼容：问题 handled，但 impact 明确「不视为通过」；主稿与原夹具全文相同 |
| review action opens the actual review workspace | SF-180／181：打开真实 AI检查页，标题与「一键检查并完善」可见可用；只验导航，不点击模型动作、不声称模型检查通过 |
| consecutive host writes are adopted without creating a false human edit buffer | PRD v1.2 §4.3 的宿主写入不误判人工编辑、SF-177／187：两次宿主保存后编辑器逐字一致；`editor.bufferRead` 为无缓冲或 cleared；显示已保存且没有脏稿保存按钮 |
| detail actions cause no client exception | 上述全部当前入口操作的 pageerror 数为 0 |

来源：[PRD v1.2](../../../docs/ScholarFlow_PRD_v1.2.md)、[SPEC v1.2](../../../docs/ScholarFlow_Design_SPEC_v1.2.md)、[PRD v1.14](../../../docs/ScholarFlow_PRD_v1.14.md)、[PRD v1.18](../../../docs/ScholarFlow_PRD_v1.18.md)、[PRD v1.19](../../../docs/ScholarFlow_PRD_v1.19.md)、[PRD v1.20](../../../docs/ScholarFlow_PRD_v1.20.md)。实现核对：`src/client/writing-progress.tsx:39–141`、`src/host/bridge/writing-controller.ts:407–450`、`src/core/editing/buffer.ts:8–14`。

本机证据：`.dsh-tmp/task-details/1791865777290/journal.json`，9 项均 `ok:true`。修订中两次失败 journal（`1791865697129`／`1791865733694`）保留：分别是旧返回栏标题和误以为保存后按钮 disabled 的测试假设，均已改成真实当前语义，不计为通过。启动对话框沿用已修复 helper；本脚本不调用模型，因此无需添加模型桩。

### AT-134：不通过，三次原始测量全部保留

复现：同一次构建，逐次执行 `node tests/e2e/workbench-performance.mjs --desktop`，等上一轮 Electron 退出后才开始下一轮。Windows 11、Core Ultra 5 336H（12 逻辑处理器）、约 32 GiB 内存、Node 24.15.0、安装版 Harness。用户确认安静窗口并关闭浏览器；测量期间无 Chrome，无并发构建或其他测试。仍有 5 个既存用户 Harness 进程（未擅自终止），加本轮测试的 5 个进程。前后 PID／CPU 秒／内存保留在 journal；既存进程三轮合计增量约 4.2／4.7／5.0 CPU 秒，整机平均 CPU 忙碌度约 34.2%／38.7%／40.2%，不能描述为绝对空闲机器。

| 轮次／本机目录 | p95 ms | 输入耗时 s | 脚本至清理前 s | 长任务数／帧间隔 >100ms | AT-134／退出码 |
|---|---:|---:|---:|---:|---|
| `1791865817517` | 20.4 | 53.147 | 92.846 | 0／0 | 通过／0 |
| `1791865917912` | 30.9 | 60.203 | 102.042 | 3／1 | 不通过／1 |
| `1791866029110` | 31.6 | 58.927 | 99.855 | 4／3 | 不通过／1 |

每轮均在 14,400 汉字稿件末尾输入 744 字符，保留原 43ms 延迟参数（名义延迟合计 31.992 秒）；744 个 input→requestAnimationFrame 样本全部收到，输入完整、pageerror 为 0，采样后窗口可见且有焦点。脚本总耗时包含启动、导航、输入、交互与截图，计至清理前。新增 CPU／进程采集在输入窗口前后执行，没有在按键热路径启动采样进程；等待最后一帧后再收集全部输入样本。p95 算法和 **24.1×1.1 = 26.51ms** 阈值未变。

三轮只有第一轮达标；后两轮超过阈值约 16.6%／19.2%。结论是**本机 AT-134 门禁不通过**，不以第一轮通过覆盖失败，也不再仅用“输入超过30秒”排除数据：该驱动还包含逐键协议往返，名义延迟并不是总耗时上限。尚未隔离宿主、编辑器、自动化驱动与系统调度的贡献，**未确认产品根因或归因于 v1.20**；后续产品诊断／修复需另行授权，本轮未修改源码或放宽阈值。

三个 journal 均位于 `.dsh-tmp/workbench-performance/<上述目录>/journal.json`，SHA-256 依次为：

- `54fb670628112c4075905867602ff747660a0cd060925f5dd410c5fc3be6293d`
- `2d48d1676341164c3a353d1dfcb88fdb969151d913229e7c28b7b7cbd474c17c`
- `39b48c850dc47e75bb12dba2a0a699a15ff11fe698aef7681bef542d68e9a09b`

### 收尾与非计时布局

汇总断言移至收尾保存和两主题截图之后；失败仍抛错并非零退出，三轮均确认保存后显示「已保存」、保存按钮消失，两主题截图完成。`分屏` 自 SF-170 已删除，因此截图及布局准备改用 `预览`；不把已隐藏的 `.sf-pane-caption` 当作当前可见工具条做几何断言。正文编辑栏的独立验证沿用上表 v15／v16／v18，本次 layout-only 明确只验证项目条。

`node tests/e2e/workbench-performance.mjs --layout-only`：**8/8 布局检查通过**，浅／深主题 × 320／420／720／1440px，横向溢出均为 0、被裁控件均为空、格式文本可用宽 71px ≥ 最大文字宽 66.60px，选择框高度 44／44／44／34px。journal：`.dsh-tmp/workbench-performance/1791866138505/journal.json`（另含产物大小与耗时两条观测，共 10 条 `ok:true`），耗时 23.876 秒，不含 AT-134 阈值。未重复既有 v15～v19 全部回归；本 ADR 第 1、2 项边界仍保留，未做包发布或真人观感验收。

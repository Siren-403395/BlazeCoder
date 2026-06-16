# BlazeCoder — 开发历程与设计文档

> 一份把 **开发步骤、开发思路、架构设计、Harness/Context 设计** 串起来的总览文档。
> 开发步骤部分由真实 git 历史(111 个提交,2026-06-13 ~ 06-15)还原;架构与设计部分
> 与 [`ARCHITECTURE.md`](ARCHITECTURE.md)(设计依据)、[`PROGRESS.md`](PROGRESS.md)(任务追踪)、
> [`CONTEXT_HARNESS_EXPLORATION.md`](CONTEXT_HARNESS_EXPLORATION.md)(优化扫描)互为补充。

---

## 0. 一句话

BlazeCoder 是一个**读写真实文件、执行真实命令**的 AI 编程智能体:终端 TUI 与桌面 GUI 两套界面跑在同一个**与宿主无关、全套单测覆盖**的内核上,由 DeepSeek V4 Pro 驱动,每一次落地都过一道**有序权限闸门**。它不是一个固定的提示词链,而是一个 `取上下文 → 动手 → 验证` 的自主循环。

---

## 1. 开发历程(从 git log 还原)

整个项目在 **3 天内、111 个提交**中成型,但并非线性堆砌——它有清晰的阶段划分和一次关键转向。

### 阶段一:Web 起步(`df550cd` → `c052c2c`)

项目最初是一个**面向浏览器的编程智能体**:`df550cd Initial commit: research-driven coding-agent monorepo`,随后是一整套 Web 前端建设——Tailwind v4 + Motion + Phosphor + Geist 工具链、设计系统(tokens/primitives/hooks)、Cursor 风格的右栏对话面板、DeepSeek 流式渲染、会话历史/恢复、深度思考(reasoning)通道。

```
4edfa80  Web 工具链 + jsdom 测试
16e628d  Web 设计系统:tokens / 原语 / hooks / 纯函数 lib 层
f50b569  重建 web 面板、布局壳、App 组合
33f499c  流式 + 会话恢复契约;流式驱动 agent loop
75e1b2c  DeepSeek 流式 deltas + tool calls
956e180  实时流式渲染 + 会话历史
c052c2c  深度思考模式:开关 + 流式 reasoning 通道 + 可折叠思考块
```

> 关键背景:`ARCHITECTURE.md` 是这一阶段产出的**一次大规模一手资料研究**(逐条引用 Anthropic/Claude Code 官方文档),它定义了内核契约。这份研究后来证明是整个项目的"地基设计"。

### 阶段二:关键转向 —— 砍掉浏览器栈,转 CLI(`5c9bc2c`)

```
5c9bc2c  Phase 0: subtract the browser stack, retarget to a CLI agent
```

这是全项目最重要的一次决策。`ARCHITECTURE.md §0` 记录了理由:浏览器形态(Fastify+SSE 服务端 + React 客户端 + esbuild 预览)被**整体废弃**,只保留与形态无关的内核设计(§§1–3),`apps/server`、`apps/web`、`build_preview` 工具全部删除。`GeneratedProject` 虚拟文件图被**真实文件系统**取代。这把一个"workflow"(线性 Intent→Planner→CodeGen→Review→Preview 链,无法自我纠错)重构成了一个"agent"(能读环境反馈、循环修复的自主循环)。

### 阶段三:CLI 地基 —— Phase 0~5(`8916594` → `ff9b312`)

经典的分阶段建设:

| 提交 | 阶段 | 内容 |
|---|---|---|
| `8916594` | Phase 1 | 真实文件系统 workspace + Claude-Code-parity 工具 |
| `e378b4e` | Phase 1 加固 | 对抗式 review 修掉 12 个发现 |
| `e7aa898` | Phase 2 | Ink TUI 前端(进程内,无 HTTP) |
| `364c81b` | Phase 3a | 真实命令沙箱——Bash 能跑了 |
| `a232bfe` | Phase 3b | `/effort` 思考档位梯子,替代二元开关 |
| `525202a` | Phase 3c | 会话恢复(`--continue` / `--resume`) |
| `24bcb9d` | Phase 4a | headless 模式(`-p`)用于脚本/CI |
| `ff9b312` | Phase 5 | 打包 + 进程级 e2e + 文档 |

### 阶段四:子系统化的优先级 Backlog —— P0/P1/P2(`3aee3c2` → `7aaf66b`)

这是项目从"能用"走向"对标 Claude Code"的核心工作流。蓝图是 [`INTEGRATION_SPEC.md`](INTEGRATION_SPEC.md)(`blazecoder ⇽ claude-code-best` 集成规格),执行追踪在 [`PROGRESS.md`](PROGRESS.md)。每个任务都按 **子系统 + 优先级 + 依赖** 编号:

- **子系统**:`tools` / `prompts` / `context` / `perm`(权限) / `harness` / `orch`(编排) / `ext`(扩展)
- **优先级**:`P0`(最高杠杆 parity)→ `P1`(强增强)→ `P2`(锦上添花)
- **依赖**:如 `perm-2 (deps: perm-1)`、`harness-3 (deps: harness-2, ext-1)`

```
P0-tools-1    共享 TOOL_NAMES 常量,修掉 prompt↔registry 名称漂移
P0-prompts-2  分段可组合的系统提示词构建器
P0-context-1  类型感知 token 估算 + 权威 real input_tokens
P0-context-2  白名单式工具结果清除 + 压缩后文件回灌
P0-perm-1/2/3 权限规则语法 → behavior-priority 引擎 → 分层持久化设置
P0-harness-1  网关重试/退避/超时 + api_retry 事件
P0-harness-2  loop 里的类型化 transition/Terminal 状态机
P0-orch-2     runSubagent 接成模型可调的 Task 工具(禁嵌套)
...P1 / P2 同构展开(steering、反应式压缩、技能、钩子、输出风格、命令风险分类...)
```

> 贯穿规则(写在 `PROGRESS.md` 顶部):**每个任务 = 实现 → 单测/集成/e2e 绿 → 提交;不留向后兼容垫片,旧实现就地退役。**

### 阶段五:两套 UI 一个内核 + 产品化(`cc60148` → `1208342`)

```
cc60148  provider 适配器架构 + 引导式 onboarding(退役 .env)
ab54d71  用满 DeepSeek-V4-Pro:1M 上下文 + 放开 384K 输出
65c4164  抽出 @host —— 每个 UI host 共享的 Node/OS 接线
83dab06  Electron GUI host —— TUI 的兄弟适配器,跑在 @host 上(+5064 行)
fa8b0c8  把桌面 GUI 整合进 zephyrcode 命令家族(--gui)
1208342  改名:zephyrcode → blazecoder(116 文件)
```

命名演进:(初始)→ `ca` / `zephyrcode` → **`blazecoder`**(包作用域 `@zephyrcode/*` 也随之迁移)。

### 贯穿始终的两个实践

1. **对抗式自审 + 加固**:几乎每个大特性后面都跟着一个 `fix: harden X after adversarial review` 提交(Phase 1 加固、`/compact` 加固、config+onboarding 加固、三项优化加固、desktop+loop 加固……)。先实现,再用对抗视角自我攻击,然后补防御。
2. **研究先行**:`CONTEXT_HARNESS_EXPLORATION.md` 是后期一次"对抗式多智能体扫描"——25 个候选优化,24 个**因为前提经不起读代码的检验而被否决**,结论是该子系统已成熟。这种"先验证前提,再动手"的纪律是项目的底色。

---

## 2. 开发思路 / 方法论

把上面的历程抽象出来,核心方法论有六条:

1. **研究驱动,以 Claude Code 为参照系。** 内核设计不是拍脑袋,而是从 Anthropic/Claude Code 一手文档逐条提炼(见 `ARCHITECTURE.md` 的内联引用)。代码里反复出现 "reference clone" / "Claude-Code-parity" / "ported from the reference",但**刻意 scrub 掉品牌**(产品身份是 blazecoder,绝不自称 Claude/DeepSeek),并把所有阈值改成 DeepSeek 真实窗口的尺寸,而非照抄 200K/1M。
2. **敢于做减法。** 最关键的一步是 Phase 0 删掉整个浏览器栈。识别出"线性链是 workflow 不是 agent"后,果断重定形态,而不是在错误的地基上加功能。
3. **优先级 + 依赖图驱动。** 不是"想到哪做到哪",而是把工作切成带优先级(P0/P1/P2)和显式依赖的子系统任务,先做高杠杆 parity。
4. **端口与适配器,内核纯净。** `agent-core` 只依赖注入的接口(`ports.ts`)+ Node 内建 + shared 类型;没有任何 UI/HTTP/DeepSeek import 进入循环。这让内核能用内存假实现跑全套单测。
5. **对抗式自审。** 每个特性都假设它有问题,主动攻击后再加固。这是质量来源,也是为什么后期的优化扫描能诚实地否决掉自己 96% 的候选。
6. **不留技术债垫片。** 旧实现就地退役,不做"为兼容而兼容"的 re-export / 重命名保留。每步都是 implement → 测试绿 → 提交。

---

## 3. 架构设计

### 3.1 分层与依赖方向

```
   @blazecoder/shared      类型、校验、密钥模式(零依赖)
          ▲
   @blazecoder/core        智能体内核:循环、工具、权限、上下文引擎
          ▲                与宿主无关,全套单测覆盖
   @blazecoder/host        Node/OS 接线:文件系统、provider、配置、会话、钩子
          ▲
     ┌────┴─────┐
 @blazecoder/   @blazecoder/
    cli            desktop      ← 对等的 UI 适配器,互不依赖
  (Ink TUI)      (Electron)        desktop 永不引入 cli / Ink
```

- 内核发布名 `@blazecoder/core`(目录 `packages/agent-core`)。
- 两个 UI 适配器是**对等兄弟、无交叉依赖**,这条结构性约束由一个 **guard 测试**强制(`packages/desktop/test/guard.test.ts`)——谁敢在桌面包里 import cli/Ink,CI 就红。这是本项目最关键的架构卖点。
- pnpm workspaces + Turborepo 单仓,包边界清晰、分层被强制。

### 3.2 端口与适配器(Ports & Adapters)

`agent-core` 通过 `ports.ts` 定义全部外部依赖的接口;真实实现由 host 注入:

| 端口(接口) | 真实适配器(host) | 测试假实现 |
|---|---|---|
| `ModelGateway` | `DeepSeekGateway`(OpenAI 兼容、SSE 流式) | `StubGateway`(离线) |
| `Workspace` | `FileSystemWorkspace`(realpath 边界 + symlink 检查) | `InMemoryWorkspace` |
| `Sandbox` | `LocalProcessSandbox`(子进程 + 超时 + 进程组 kill) | — |
| `SessionStore` | `FileSessionStore`(按项目隔离) | 内存 |
| `MemoryStore` | `FileMemoryStore`(沙箱在 `/memories`) | 内存 |
| `Clock` / `Logger` | 系统实现 | `FixedClock` / silent |

### 3.3 两套 UI 一个内核 + 事件驱动

两个 host 都依赖 `@blazecoder/host`、互不依赖。它们消费同一个 **`EventSink`**(`(AgentEvent) => void`)。UI 状态是一个纯 `(UiState, AgentEvent) => UiState` reducer(TUI 的 `state.ts` 与桌面渲染层互为兄弟),可脱离 Ink/Electron 单测。进程内运行,**没有 HTTP 服务、没有 SSE**——CLI 直接 import `AgentRuntime` 消费其事件流。

---

## 4. Harness 设计

> Harness = 把语言模型变成可用编程智能体的那层"机械":循环、工具接口、执行、权限、持久化。设计哲学:**循环本身要"笨",把投资放在 agent-computer interface 上。**

### 4.1 那个故意做"笨"的循环

`packages/agent-core/src/loop/agentLoop.ts`:

```
while (true):
  ① 检查 AbortSignal(取消即收尾)
  ② contextManager.maybeCompact()   —— 必要时压缩
  ③ assembleRequest()               —— system + 项目规则 + 历史 + 工具 schema
  ④ gateway.stream() / complete()   —— 调模型,流式 emit deltas
  ⑤ 解析:有工具调用 → 继续;无 → finish(模型自决完成)
  ⑥ executor.executeTurn()          —— 过权限引擎执行工具
  ⑦ steering.drain()                —— 折入运行中插话
```

几个设计要点:

- **单一 `finish()` 出口**:每条退出路径都从一个 `Terminal` 推导出对外的 `subtype`,并为停在工具调用轮的转录补上**合成 tool_result**(否则 resume 时 API 会因孤儿 tool_use 而拒绝)。`P0-harness-2` 把它做成了类型化 transition/Terminal 状态机。
- **默认不设上限**:轮数与花费上限都是**可选的安全网**(`AGENT_MAX_TURNS` / `AGENT_MAX_BUDGET_USD`),默认关闭——编程智能体不该在项目中途被截断。真正的兜底是用户的 Esc、上下文溢出/压缩抖动终止、以及拒绝循环提示。
- **运行中插话(steering)**:`SteeringQueue` 在每轮工具后排空,把用户消息折进下一轮对话,无需打断。
- **自愈分支**:输出截断恢复(`max_tokens` 无工具调用 → 提示模型分小块续写,最多 3 次)、Stop hook 阻塞续跑(最多 3 次)、拒绝循环防护(`DenialTracker` 连续被拒 → 提示换思路)。

### 4.2 模型网关(流式 + 韧性)

`DeepSeekGateway`(OpenAI 兼容):工具参数碎片按 `index` 跨多个 SSE delta 累积、流结束后一次性 emit;空闲超时(默认 90s)检测连接卡死;`withRetry` 对 429/5xx 指数退避、4xx 立即失败、**已开始流式输出则标 `NonRetryable`** 防止重试重复 emit;采集 cache hit/miss token 遥测。Thinking 模式按 V4 契约"只在工具调用轮保留 reasoning"。

### 4.3 工具执行器

`tools/executor.ts`:同一轮里**只读工具并发、写工具串行**,结果按原始调用顺序返回。每个工具有超时安全网;输出超过工具自声明的 `maxResultSizeChars` 时,**落盘到 `.blazecoder/tool-results/` 并保留头尾预览**,不淹没上下文。工具处理器**返回 `isError:true` 而非 throw**(throw 会杀掉整个 run;isError 让循环存活并自我纠错)——这是一条 load-bearing 的生存规则。

> 近期修正(见 §7):执行器的超时原先用固定 120s 一刀切包住每个工具,会把 Bash 自声明的最长 600s 截断、还可能留孤儿进程。现已让工具通过 `maxTimeoutMs` 自声明上限,安全网设在其之上 + grace,确保工具自己的清理先发生。

### 4.4 权限引擎 —— 8 道有序闸门

`permissions/engine.ts`,behavior-first 优先级(**deny > allow > ask**,与规则来自哪个文件无关):

```
① 钩子(PreToolUse 可 deny / 强制 ask / 决定性 allow)
② 受保护路径(.git/.ssh/.aws/... 除 bypass 外永不自动放行)
③ deny 规则(任意来源,一票否决)
④ allow 规则(+ 毁灭性命令绊线:把"自动 allow"升级成"问")
⑤ ask 规则
⑥ 模式判定(default / acceptEdits / auto / plan / bypass)
⑦ 只读 / 控制工具自动放行
⑧ 经 PermissionBroker 询问人类
```

- **毁灭性命令绊线**(`commandRisk.ts`):一个窄分类器识别不可逆命令(`rm -rf` 根/家目录、fork bomb、`dd`/`mkfs`、对 `/`~ 递归 chmod/chown、`find / -delete` 等),**即使有永久 allow 规则或钩子放行也强制人工确认**。它只会把 auto-allow 升级为 ask,**永不削弱 deny**。是确定性、独立于模型的防御。
- **密钥防护**:`secretsHook` 注册在最前,拒绝读写已知密钥/凭据文件。
- **改前必读**:Read 记下文件 mtime+size;Edit 与覆盖式 Write 拒绝未读过/磁盘上已变过的文件。
- **plan 模式**:只读探索,所有非只读工具拒绝;模型用 `ExitPlanMode` 工具提交计划,经审批后切到工作模式并把计划声明的命令类别变成 session 级 allow 规则(见 §7)。

### 4.5 子智能体隔离

`Task` 工具派出子智能体,跑在**全新上下文窗口** + 隔离的读账本里,共享父级真实 workspace,只回传提炼后的报告。**结构上禁止嵌套**(`filter()` 永远剔除 Task,加 depth 守卫)。这是最强的 context 杠杆(见 §5)。

---

## 5. Context 设计

> 核心原则:**上下文窗口是首要稀缺资源**。注意力是 n² 预算,token 越多召回越差("context rot")。后端要策展出"最小高信号 token 集",前端只渲染预算仪表。

### 5.1 Token 账本

`context/sessionContext.ts`:字符启发式估算(散文 ~4 char/token,JSON 密集的工具结果 ~2 char/token),但这只是**首轮前的 bootstrap 兜底**——真正驱动压缩闸门的是服务端权威的 `lastRealInputTokens`(`P0-context-1`)。`/context` 命令按块(系统/工具/规则/记忆/历史/工具输出)如实拆解占用,而非一个笼统占比。

### 5.2 分级压缩(最便宜的先做)

`context/compaction.ts`,镜像 Claude Code 的"先清旧工具输出,再摘要":

```
窗口 = 1,048,576 token;留 ~64K 给输出 → 有效输入窗 ~984K
clearAt   = 70% 有效窗
compactAt = clearAt 之后再留 24K 缓冲

Stage 1  清除旧的可再生工具结果(Read/Bash/Grep/Glob),保留最近 4 条原文 —— 无 LLM 调用
Stage 2  仍超预算 → LLM 摘要历史头部 + 从磁盘回灌近期文件
Stage 3  防抖断路器:连续 3 次摘要释放 <5% 窗口 → 抛 CompactionThrashError 停手
```

- **哪些工具结果可清**由各工具的 `compactable` 标志派生(`P2 refactor`),新增一个 bulky 只读工具会自动参与,无需改压缩模块。
- **反应式压缩**(`P2-harness-6`):provider 因"太长"拒绝请求时,当场压缩一次并重试该轮;二次溢出才终止。

### 5.3 摘要作为类型化契约 + 文件回灌

`context/rehydration.ts`:摘要**不是自由发挥**,而是按固定结构产出——用户意图、所有用户消息(逐字保留,不丢需求)、关键技术决策、改过的文件、错误与修复、待办、当前状态、下一步(逐字引用,防漂移),**显式丢弃**逐字工具输出与中间推理。摘要后从磁盘**重新读取近期改动文件并注入最新内容**,清空读账本,强制下次编辑前重读——防止模型拿过期内容去 Edit。当模型维护的 session-notes 足够充实时,直接拿它当摘要(零 LLM 成本)。

### 5.4 双层记忆

- **项目层(CLAUDE.md 的类比)**:每轮把项目 `/memories/MEMORY.md` 索引(上限 ~4000 字)注入为**系统提示词之后的合成 user 消息**(顾问性、保持系统提示词可缓存、跨压缩存活)。
- **模型主动记忆(`memory` 工具)**:`view/create/str_replace/insert/delete/rename`,沙箱在 `/memories`,跨压缩、跨会话存活。

### 5.5 缓存纪律与子智能体杠杆

`P2-context-6` 做了缓存纪律:稳定前缀 + cache-token 遥测 + 压缩日志。`buildLoopConfig` 把系统提示词/项目规则在一次 run 内**快照固定**,使 `[system][规则][history]` 成为可被 DeepSeek 自动前缀缓存命中的稳定前缀。**子智能体**(§4.5)是最强的 context 杠杆:把大块探索/原始输出隔离在子上下文里,主上下文只收提炼报告。

---

## 6. 设计权衡(诚实记录)

- **单 provider**:架构号称"加模型=一个文件",但目前 `PROVIDERS` 只有 DeepSeek,且 `thinkingBudget: "high"|"max"` 这类 DeepSeek 专有概念泄漏进了本应中立的 `ports.ts`。多 provider 泛化性**尚未被第二个实现验证**。
- **`LocalProcessSandbox` 不是真沙箱**:直接执行,`auto` 模式安全完全依赖那个正则命令分类器(可被深度间接/`$(...)` 绕过)。真正的 OS 级隔离(sandbox-exec/bwrap/容器)是预留端口,尚未实现。
- **Token 估算是字符启发式**:由真实 `input_tokens` 兜底,但首轮前与 `/context` 展示仍是启发式。
- **优化扫描的结论**:`CONTEXT_HARNESS_EXPLORATION.md` 的对抗式扫描否决了 24/25 个候选微优化——该子系统已成熟,继续投入更应朝**新能力**(如 plan 模式补全、更丰富的 steering)而非微优化。

---

## 7. 近期演进(跨平台 + 工作树改动)

> 以下为最近一轮针对 **Windows 适配** 与两项内核改进的工作。除注明外均为加法、不触及核心架构,全仓测试与 typecheck 保持绿。

- **Windows 安装脚本**:新增 `install.ps1`(对标 `install.sh`),生成 `blazecoder.cmd` 启动器并写入用户 PATH。
- **毁灭性命令分类器补 Windows 签名**:`commandRisk.ts` 增加 `del /s`、`rd /s`、`format X:`、PowerShell `Remove-Item -Recurse` 对盘符根/系统目录(`C:\`、`C:\Windows`、`%SystemRoot%` 等)的识别,并给 Windows/PowerShell 常用命令补风险标签。补充 28 个测试。
- **OS 感知提示词**:每轮环境块声明当前 OS 与 shell(`platformEnvironmentLines`),提示模型在 Windows 上别发 POSIX 命令、改用 Read/Grep/Glob 工具。
- **测试套件 Windows 兼容**:把测试假实现 `InMemoryWorkspace` 的 `/` 虚拟根改为始终走 posix 路径语义(给 `boundary.ts` 加可选 `PathApi`,默认平台、虚拟 FS 传 posix);symlink 用例在无权限环境自动跳过;`authStore` 权限位断言仅在非 Windows 校验;命令钩子测试改用 `node -e` 跨平台输出 JSON;e2e 用 `tsup.CMD` + `process.execPath`。**真实运行用的 `FileSystemWorkspace` 在 Windows 上本就正常,失败仅在测试层。**
- **Harness ①:执行器超时分层修复**:`Tool` 加 `maxTimeoutMs`,Bash 声明 600s,执行器安全网设在工具自声明上限 + 5s grace 之上——修掉"Bash 长命令被 120s 误杀 + 孤儿进程"。
- **Harness ③:plan 模式退出闭环**:新增模型可调的 `ExitPlanMode` 工具 + 引擎特判(plan 内走审批、批准后翻转模式并把 `allowedCommands` 变 session allow 规则)。复用现有审批通道,零 UI 改动。Shift+Tab 入口与指示器同步作为明确的后续 UI 接线留待处理(避免引入 TUI/GUI 模式失步)。

---

## 8. 速查:关键文件地图

| 关注点 | 文件 |
|---|---|
| 主循环 | `packages/agent-core/src/loop/agentLoop.ts` |
| 循环配置快照 | `packages/agent-core/src/loop/config.ts` |
| 权限引擎(8 闸门) | `packages/agent-core/src/permissions/engine.ts` |
| 命令风险/毁灭性分类 | `packages/agent-core/src/permissions/commandRisk.ts` |
| 分级压缩 | `packages/agent-core/src/context/compaction.ts` |
| 摘要契约 + 文件回灌 | `packages/agent-core/src/context/rehydration.ts` |
| token 账本 / 上下文组装 | `packages/agent-core/src/context/sessionContext.ts` |
| 工具执行器 | `packages/agent-core/src/tools/executor.ts` |
| 端口接口 | `packages/agent-core/src/ports.ts` |
| 系统提示词构建 | `packages/agent-core/src/prompts.ts` |
| 子智能体隔离 | `packages/agent-core/src/orchestration/subagent.ts` |
| DeepSeek 网关 | `packages/host/src/adapters/deepseekGateway.ts` |
| 运行时接线 | `packages/host/src/runtime.ts` |
| Provider 抽象 | `packages/host/src/providers/` |
| 设计依据(研究) | `docs/ARCHITECTURE.md` |
| 任务追踪(P0/P1/P2) | `docs/PROGRESS.md` |
| 优化扫描(已否决项) | `docs/CONTEXT_HARNESS_EXPLORATION.md` |

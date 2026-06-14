<!-- 语言切换 / language switch -->
<p align="center">
  <a href="README.md"><b>简体中文</b></a>
  &nbsp;·&nbsp;
  <a href="README.en.md">English</a>
</p>

<div align="center">

<h1>✶ BlazeCoder</h1>

<p><b>一个读写真实文件、执行真实命令的 AI 编程智能体</b></p>

<p>终端 TUI 与桌面 GUI 两种界面，同一个智能体内核。<br>
由 DeepSeek V4 Pro 驱动，权限闸门把守每一次落地。</p>

<p>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A5%2020-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="tests" src="https://img.shields.io/badge/tests-548%20passing-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="context" src="https://img.shields.io/badge/context-1M%20tokens-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="output" src="https://img.shields.io/badge/output-384K-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="model" src="https://img.shields.io/badge/model-deepseek--v4--pro-e8a64d?style=flat-square&labelColor=2b2b2b">
</p>

<!-- TODO: 这里非常适合放一段终端演示 GIF（asciinema / vhs 录制），比任何文字都有说服力。 -->

</div>

<br>

```bash
git clone https://github.com/Siren-403395/BlazeCoder.git && cd Siren-403395 && ./install.sh
```

<div align="center"><sub>一条命令：构建 → 装上 PATH → 引导你粘贴 API Key。</sub></div>

```bash
blazecoder           # 在当前目录启动终端 TUI
blazecoder --gui     # 启动桌面 GUI（Electron），同一个智能体
```

---

## 🔥 它是什么

- 在**你的工作目录**里直接改文件、跑 shell，每一步都过**权限闸门**，不是沙箱玩具。
- 由 **DeepSeek V4 Pro** 驱动，走 provider 适配器架构，接入 Gemini / Claude 只是加一个文件。
- **两套界面，一个内核**：终端 TUI 与桌面 GUI 是对等的兄弟适配器，共用同一份 runtime。
- **100 万 token** 上下文窗口，长会话不轻易触发压缩。

## ⚡ 亮点

<table>
<tr>
<td valign="top" width="50%">

**两套界面，一个内核**

终端 TUI（Ink）与桌面 GUI（Electron）是对等的兄弟适配器，跑在同一个智能体 runtime 上。两者都依赖 `@blazecoder/host`，GUI 永不引入 TUI/Ink（有守卫测试盯着）。

</td>
<td valign="top" width="50%">

**100 万窗口，输出放到 384K**

跑在 DeepSeek V4 Pro 约 1,048,576 token 的完整上下文里，输出交给模型 384K 的硬上限，只在物理溢出时才收缩，不设人为小限。

</td>
</tr>
<tr>
<td valign="top" width="50%">

**不设上限的智能体循环 + 真正的安全底线**

取上下文 → 动手 → 验证，默认**不设轮数或花费上限**（要的话用环境变量开）。外加一个 `auto` 全自治模式，仍守住受保护路径、密钥防护与毁灭性命令绊线。

</td>
<td valign="top" width="50%">

**Provider 适配器架构：加一个文件接一个模型**

每个模型后端都活在同一个 `Provider` 接口之后（鉴权、URL、请求体、流式、工具 schema、思考字段），引导 / 配置 / runtime 全程模型无关。加 Gemini / Claude 就是一个文件 + 注册表一行。今天内置 DeepSeek V4 Pro。

</td>
</tr>
</table>

## 🖥️ 两套界面，一个内核

<table>
<tr>
<td valign="top" width="50%">

**终端 TUI（Ink）**

- 已落定的对话提交进 Ink `<Static>`，滚进终端原生历史，无重绘、无闪烁
- 写 / 改文件时渲染 git 风格的带行号 diff 块（绿加红减、`+N -M` 统计、超长折叠）
- 多行输入 + 软换行；`@` 引用文件、`/` 命令面板、Tab 补全、↑↓ 历史
- 思考深度嵌在输入框上边框；`Shift+Tab` 实时切换权限模式（normal ⇄ auto）
- 会话内选择器：恢复会话 / 挑技能 / 切输出风格

</td>
<td valign="top" width="50%">

**桌面 GUI（Electron）**

- 渲染层是一个纯 `(UiState, AgentEvent) -> UiState` reducer（TUI `state.ts` 的兄弟），全程 headless 单测
- 对话 / 工具时间线带流式输出、可折叠的思考轨迹、子智能体行
- 检查器 + diff 查看器：工具入参 / 出参 / 计时，文件改动渲染带行号的 git diff
- 权限弹窗带持久化范围（拒绝 / 本次 / 永久 local·project·user）
- 侧栏列历史会话与改动文件，顶栏有项目 / 模型 / 模式 / 思考深度 / 可点的上下文仪表

</td>
</tr>
</table>

<sub>两个 host 都依赖 <code>@blazecoder/host</code>、<b>互不依赖</b>。GUI 渲染层永不 value-import TUI/Ink，由一个守卫测试强制保证。</sub>

## 💬 示例会话

```console
❯ 给 src/utils.ts 加一个防抖函数，并补上测试

  ✶ 拆解任务…
  ☐ 实现 debounce()
  ☐ 补单元测试
  ☐ 跑 pnpm test 验证

  ✔ Read   src/utils.ts

  ⚠ 权限：Bash  pnpm test
    读 / 写 / 网络：写（运行测试）
    [y] 本次允许   [a] 永久允许（本地，不提交）   [A] 永久允许（提交进项目规则）   [n] 拒绝
  ❯ a

  ✔ Write  src/utils.ts
    src/utils.ts                                              +14 -0
    ┌─ 11 ┊ export function debounce<T extends (...a: any[]) => void>(
    │  12 ┊   fn: T, ms: number,
    │  13 ┊ ) { /* … +N more lines */ }
    └─ +14 -0
  ✔ Write  test/utils.test.ts                                +28 -0
  ✔ Bash   pnpm test                                         通过

  已加 debounce()，覆盖了立即触发、连续调用与取消三种边界，测试全绿。
```

## 🧰 能力清单

**循环与上下文**

<table>
<thead><tr><th>能力</th><th>说明</th></tr></thead>
<tbody>
<tr><td><b>不设上限的循环</b></td><td>取上下文 → 调模型 → 执行工具 → 结果回填，默认无轮数 / 花费上限，跑到模型完成或你打断为止</td></tr>
<tr><td><b>可选的安全上限</b></td><td>工具轮数（<code>AGENT_MAX_TURNS</code>）与累计花费（<code>AGENT_MAX_BUDGET_USD</code>）上限默认关闭，仅在你显式配置时生效</td></tr>
<tr><td><b>运行中插话</b></td><td>运行时直接输入即可，无需打断；循环在每轮工具后排空队列，把消息折进下一轮对话</td></tr>
<tr><td><b>子智能体边界</b></td><td><code>Task</code> 子智能体跑在全新上下文里且不可嵌套；无人值守的子智能体有 50 轮兜底上限，主循环则不设限</td></tr>
<tr><td><b>100 万 token 窗口</b></td><td>跑在 DeepSeek V4 Pro 约 1,048,576 token 的完整窗口里，长会话不轻易触发压缩</td></tr>
<tr><td><b>输出放满 384K</b></td><td>输出交给模型 384K 的完整预算，只在物理溢出时才收缩，不设人为小限</td></tr>
<tr><td><b>思考深度 = effort</b></td><td><code>low</code> / <code>high</code> / <code>ultra</code> 映射到三种原生思考档位，只控推理深度，从不动输出长度</td></tr>
<tr><td><b>分级压缩</b></td><td>窗口吃紧时先就地清掉可再生的旧工具输出（不调模型），仍超预算才把历史头部摘要成一个密集块</td></tr>
<tr><td><b>防抖断路器</b></td><td>当再摘要也释放不出有意义的空间时就停手，而非无限空转</td></tr>
<tr><td><b>响应式压缩</b></td><td>遇到上下文溢出被拒时，压缩一次并自动重试该轮</td></tr>
<tr><td><b><code>/compact</code> 与 <code>/context</code></b></td><td>可按需手动压缩；按块如实拆解窗口占用（系统 / 工具 / 项目规则 / 记忆 / 历史 / 工具输出），而非一个笼统占用比</td></tr>
<tr><td><b>压缩后文件回灌</b></td><td>摘要后从磁盘重新读取近期改动文件并注入最新内容，清空读账本，强制下次编辑前重读</td></tr>
</tbody>
</table>

**权限与安全**

<table>
<thead><tr><th>能力</th><th>说明</th></tr></thead>
<tbody>
<tr><td><b>有序权限闸门</b></td><td>每次工具调用过固定的 8 步闸门（钩子 → 受保护路径 → deny → allow → ask → 模式判定 → 只读自动放行 → 人工询问），每个决定都带机器可读的理由</td></tr>
<tr><td><b>5 种权限模式</b></td><td><code>default</code>（写 / 命令前都问） · <code>acceptEdits</code>（自动批改、命令仍问） · <code>auto</code>（全自治，安全底线仍在） · <code>plan</code>（只读，非只读工具全拒） · <code>bypass</code>（<code>--yolo</code>，全放行）</td></tr>
<tr><td><b>毁灭性命令绊线</b></td><td>一个窄分类器识别不可逆命令（对根 / home / 系统目录 <code>rm -rf</code>、fork bomb、<code>dd</code>/<code>mkfs</code>、对 <code>/</code>~ 递归 chmod/chown 等），即使有「永久允许」规则或钩子放行也强制人工确认</td></tr>
<tr><td><b>密钥防护</b></td><td>一个独立于模型与权限模式的确定性防护，拒绝读写已知密钥 / 凭据文件（<code>.env</code>、<code>.pem</code>、<code>id_rsa</code>、<code>.ssh/</code>、<code>.aws/</code> …），也拒绝写看起来像 API key / 私钥的内容</td></tr>
<tr><td><b>受保护路径</b></td><td>VCS 内部、密钥、shell rc、工具配置（<code>.git/</code>、<code>.ssh/</code>、<code>.aws/</code>、<code>.netrc</code> …）在任何 allow 规则之前检查，除 bypass 外永不自动放行</td></tr>
<tr><td><b>改前必读</b></td><td>Read 记下文件 mtime+size；Edit 与覆盖式 Write 拒绝未读过、或读取后在磁盘上变过的文件，绝不盲改 / 覆盖外部改动</td></tr>
<tr><td><b>规则语法</b></td><td><code>Bash(git push:*)</code>、<code>Read(src/**)</code> 这样的规则，按工具分派匹配器；prefix/通配的 allow 规则永不匹配链式命令（<code>a && b</code>），deny / ask 则匹配任意子命令</td></tr>
<tr><td><b>分层设置</b></td><td>权限规则从三个范围合并（全局用户 / 可提交项目 / gitignore 本地），一律 deny 胜 allow 胜 ask；命令钩子仅对受信任工作区加载</td></tr>
<tr><td><b>Bash 风险分级</b></td><td>每条命令都被分级为读 / 写 / 网络 / 毁灭性并带理由，结果直接展示在询问弹窗上</td></tr>
<tr><td><b>拒绝循环防护</b></td><td>同类调用被反复拒绝后，循环会提示模型换一种思路，而不是死磕</td></tr>
</tbody>
</table>

**工具与扩展**

<table>
<thead><tr><th>能力</th><th>说明</th></tr></thead>
<tbody>
<tr><td><b>内置工具集</b></td><td>Read / Write / Edit / Glob / Grep / Bash，读写真实文件、跑真实命令；Glob 与 Grep 纯 Node 实现，不依赖 ripgrep</td></tr>
<tr><td><b>TodoWrite 任务列表</b></td><td>维护一份实时会话任务列表（同时只有一项进行中），展示给你看，并在标记 3+ 项完成前提示先跑验证</td></tr>
<tr><td><b><code>Task</code> 子智能体委派</b></td><td>派出专门子智能体（builder / 只读 explorer / 自定义）在全新上下文里干活，只回传提炼后的报告；子智能体结构上禁止再嵌套</td></tr>
<tr><td><b><code>Skill</code> 技能</b></td><td>SKILL.md 定义的可复用提示词配方（支持 <code>$ARGUMENTS</code>/<code>${SKILL_DIR}</code>）成为模型可调（也可 <code>/名称</code> 调）的工具，可 inline 展开或 fork 成受限子智能体</td></tr>
<tr><td><b>被动自动记忆</b></td><td>每轮自动把项目 <code>/memories/MEMORY.md</code> 索引（上限 4000 字）注入上下文，无需花一次工具调用就能回忆既往工作</td></tr>
<tr><td><b><code>memory</code> 工具</b></td><td>沙箱在 <code>/memories</code> 的模型主动记忆（view/create/str_replace/insert/delete/rename），持久笔记跨压缩、跨会话存活</td></tr>
<tr><td><b>WebSearch / WebFetch</b></td><td>可选只读联网工具，藏在 WebClient 端口之后，仅在配置显式开启（<code>AGENT_WEB=1</code>）时注册</td></tr>
<tr><td><b>输出风格</b></td><td>放入即生效的 markdown 风格文件重塑模型作答方式，会话内可用 <code>/output-style</code> 实时切换</td></tr>
<tr><td><b>settings.json 命令钩子</b></td><td>PreToolUse / PostToolUse 钩子 shell out 到任意命令（deny/ask/改写入参），加校验、格式化、审计日志；项目级钩子仅对受信任工作区加载，带全局总开关</td></tr>
<tr><td><b>工具输出落盘</b></td><td>每个工具可声明自己的最大输出尺寸；超限输出落盘到 <code>.blazecoder/tool-results</code>，只留头尾预览供回读，不淹没上下文</td></tr>
</tbody>
</table>

## 🏗️ 架构

智能体循环刻意做得很「笨」：装上下文、调模型、执行工具、结果回填、重复。

```
                    ┌─────────────────────────────────────────┐
                    │                                          │
                    ▼                                          │
   你  ──▶ [ 取上下文 ] ──▶ [ 调模型 ] ──▶ 有工具调用？
              ▲                                  │
              │                            有    │   无
   插话       │                  ┌──────────────┴───────┐
  （运行中    │                  ▼                      ▼
   直接输入） │           [ 权限闸门 ]            [ 完成 / 回复 ]
              │                  │
              │          allow / ask / deny
              │                  ▼
              └────────  [ 执行工具，结果回填 ]
                                 │
                  （默认不设上限 · 1M 窗口吃满时自动压缩）
```

端口与适配器：内核与宿主无关，进程内运行，没有 HTTP 服务。

```
   @blazecoder/shared      类型、校验、密钥模式（无依赖）
          ▲
   @blazecoder/core        智能体内核：循环、工具、权限、上下文引擎。
          ▲                与宿主无关，全套单测覆盖
   @blazecoder/host        Node/OS 接线：文件系统、provider、配置、会话
          ▲
     ┌────┴─────┐
 @blazecoder/   @blazecoder/
    cli            desktop      ← 对等的 UI 适配器
  (Ink TUI)      (Electron)        desktop 永不引入 cli / Ink
```

<sub>内核的发布名是 <code>@blazecoder/core</code>（目录为 <code>packages/agent-core</code>）。两个 UI 适配器是对等兄弟、无交叉依赖边，这条结构性约束由守卫测试强制保证，是本项目最关键的架构卖点。</sub>

## ⚙️ 配置

凭据由引导流程（`./install.sh`、首次启动、或 `blazecoder --setup`）写入 `~/.blazecoder/config.json`。**你不用手动编辑任何文件，也没有 `.env`。**

下面这些环境变量都是可选覆盖项，给 CI 与高级用法用，真实环境变量永远优先。思考深度（`low` / `high` / `ultra`）映射到 DeepSeek 的三种原生思考档位，**只控推理深度，不碰输出长度**。

**权限模式**

<table>
<thead><tr><th>模式</th><th>行为</th></tr></thead>
<tbody>
<tr><td><code>default</code></td><td>任何写文件 / 跑命令前都询问</td></tr>
<tr><td><code>acceptEdits</code></td><td>自动批准改文件，命令仍询问</td></tr>
<tr><td><code>auto</code></td><td>全自治、不打断；受保护路径、密钥防护、毁灭性命令绊线仍生效</td></tr>
<tr><td><code>plan</code></td><td>只读，所有非只读工具一律拒绝</td></tr>
<tr><td><code>bypass</code></td><td><code>--yolo</code>，全部放行（危险，仅限可信 CI）</td></tr>
</tbody>
</table>

**可选环境变量**

<table>
<thead><tr><th>变量</th><th>默认</th><th>作用</th></tr></thead>
<tbody>
<tr><td><code>DEEPSEEK_API_KEY</code></td><td>（引导保存的）</td><td>覆盖已存 Key（CI / 临时）；完全没配置则用离线 stub</td></tr>
<tr><td><code>BLAZECODER_MODEL</code></td><td><code>deepseek-v4-pro</code></td><td>覆盖当前模型 id</td></tr>
<tr><td><code>AGENT_MAX_TURNS</code> · <code>AGENT_MAX_BUDGET_USD</code></td><td>不设＝不限</td><td>可选的工具轮数 / 花费上限，默认关闭</td></tr>
<tr><td><code>AGENT_MAX_OUTPUT_TOKENS</code></td><td>不设＝模型上限 384K</td><td>可选输出上限；不设即放满，按窗口动态收缩</td></tr>
<tr><td><code>AGENT_WEB</code> · <code>AGENT_FAKE_MODEL</code></td><td>关 · 关</td><td>开启联网工具 · 用离线 stub 模型（无需 Key 即可体验整套界面）</td></tr>
</tbody>
</table>

凭据存放在 `~/.blazecoder/config.json`（权限 600，原子写入）；会话与跨会话记忆按项目隔离在 `~/.blazecoder/projects/<项目key>/` 下，互不串。权限设置文件（`.blazecoder/settings.json` 可提交、`settings.local.json` 建议 gitignore）随仓库走。

## 🚦 命令行参数

<table>
<thead><tr><th width="34%">参数</th><th>作用</th></tr></thead>
<tbody>
<tr><td><code>blazecoder</code></td><td>在当前目录启动终端 TUI</td></tr>
<tr><td><code>--gui</code> · <code>--desktop</code></td><td>启动桌面 GUI（Electron），而非终端界面</td></tr>
<tr><td><code>--cwd &lt;dir&gt;</code></td><td>智能体操作的工作目录（默认当前目录）</td></tr>
<tr><td><code>--effort &lt;级别&gt;</code></td><td>思考深度：<code>low</code> | <code>high</code> | <code>ultra</code>（默认 high）</td></tr>
<tr><td><code>-c</code>, <code>--continue</code></td><td>恢复最近一次会话</td></tr>
<tr><td><code>--resume [id]</code></td><td>按 id 恢复会话；省略 id 则列出最近会话</td></tr>
<tr><td><code>-p</code>, <code>--print &lt;文本&gt;</code></td><td>无界面跑一条 prompt 并打印结果（脚本 / CI）</td></tr>
<tr><td><code>--output-format &lt;格式&gt;</code></td><td>headless 输出：<code>text</code> | <code>json</code> | <code>stream-json</code></td></tr>
<tr><td><code>--setup</code></td><td>连接 / 切换模型 provider 与 API Key，然后退出</td></tr>
<tr><td><code>-v</code> · <code>-h</code></td><td>版本号 · 帮助</td></tr>
</tbody>
</table>

<sub>会话内还有斜杠命令：<code>/effort</code>、<code>/resume</code>、<code>/skill</code>、<code>/output-style</code>、<code>/context</code>、<code>/usage</code>、<code>/compact</code>、<code>/changes</code>、<code>/clear</code>、<code>/help</code>。</sub>

## 🧩 扩展

放文件即生效，无需重新构建。用户级（`~/.blazecoder/…`）始终加载；项目级（`<仓库>/.blazecoder/…`）需要先**信任该工作区**。

<details>
<summary><b>技能 Skill</b> &nbsp;<code>&lt;仓库&gt;/.blazecoder/skills/&lt;名称&gt;/SKILL.md</code></summary>

<br>

```markdown
---
name: review-pr
description: 审查工作区改动里的 bug 与风格
context: inline          # inline（正文原样返回）| fork（作为子智能体运行）
allowedTools: [Read, Grep, Bash]   # 仅 fork 用
---
审查 `git diff` 中关于 $ARGUMENTS 的部分。技能文件位于 ${SKILL_DIR}。
```

</details>

<details>
<summary><b>子智能体 Sub-agent</b> &nbsp;<code>&lt;仓库&gt;/.blazecoder/agents/&lt;名称&gt;.md</code></summary>

<br>

```markdown
---
name: explorer
description: 只读的代码库探索者
tools: [Read, Grep, Glob]
maxTurns: 12
---
你是一个专注的代码库探索者。简洁汇报发现，绝不修改文件。
```

</details>

<details>
<summary><b>输出风格 Output style</b> &nbsp;<code>&lt;仓库&gt;/.blazecoder/output-styles/&lt;名称&gt;.md</code></summary>

<br>

```markdown
---
name: terse
description: 一句话作答
keepCodingInstructions: true   # true 在基础提示词上追加；false 则替换
---
用尽量少的字回答。
```

</details>

<details>
<summary><b>权限规则 & 命令钩子</b> &nbsp;<code>settings.json</code>（用户 / 项目 / 本地）</summary>

<br>

```jsonc
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": ["Read(**)", "Bash(git status:*)"],
    "ask":   ["Bash(git push:*)"],
    "deny":  ["Read(.env)"]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "prettier --write $FILE", "timeout": 30000 }] }
    ]
  }
}
```

命令钩子会执行任意 shell，所以项目级钩子只对**受信任工作区**加载；`BLAZECODER_DISABLE_HOOKS=1` 是全局总开关。

</details>

<details>
<summary><b>加一个模型 Provider</b> &nbsp;<code>packages/host/src/providers/&lt;名称&gt;.ts</code></summary>

<br>

每个模型后端都活在同一个 `Provider` 接口之后（鉴权头、base URL、请求体、流式格式、工具 schema、思考字段）。接入 Gemini / Claude 就是写一个 provider 文件、再把它加进 `registry.ts` 的 `PROVIDERS` 数组一行，引导流程会自动把它列出来。

</details>

## 🛠️ 开发

pnpm + Turborepo 单仓。

```bash
pnpm install
pnpm --filter @blazecoder/cli build    # 产出 packages/cli/dist/blazecoder.js
pnpm desktop                           # 桌面 GUI 开发模式（Vite HMR + Electron）

pnpm typecheck    # 全部包
pnpm test         # 单元 + 集成 + e2e（548 个）
pnpm build        # 构建全部
```

工作区布局：`packages/{shared, agent-core, host, cli, desktop}`。`agent-core` 用内存假实现跑全套单测；终端用户跑 `blazecoder --gui`（加载已构建的 GUI），`pnpm desktop` 是带热更新的开发命令（需要图形显示）。

## 📄 许可证

<a href="LICENSE"><b>MIT</b></a> © 2026 Zephyr Huang &nbsp;·&nbsp; <a href="README.en.md">English</a>

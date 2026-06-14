<!-- 语言切换 / language switch -->
<p align="center">
  <a href="README.md"><b>简体中文</b></a>
  &nbsp;·&nbsp;
  <a href="README.en.md">English</a>
</p>

<div align="center">

<h1>✶ zephyrcode</h1>

<p><b>一个跑在你终端里的 AI 编程智能体</b></p>

<p>在终端里读写真实文件、执行真实命令，由 DeepSeek 驱动。<br>
不是沙箱玩具，能干前端、后端、脚本，任何活儿。</p>

<p>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A5%2020-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="tests" src="https://img.shields.io/badge/tests-341%20passing-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="context" src="https://img.shields.io/badge/context-1M%20tokens-e8a64d?style=flat-square&labelColor=2b2b2b">
  <img alt="model" src="https://img.shields.io/badge/model-deepseek--v4--pro-e8a64d?style=flat-square&labelColor=2b2b2b">
</p>

</div>

<!-- TODO: 这里非常适合放一段终端演示 GIF（asciinema / vhs 录制），比任何文字都有说服力。 -->

```bash
git clone https://github.com/zephyr4123/zephyrcode.git && cd zephyrcode && ./install.sh
```

<div align="center"><sub>一条命令：构建 → 装上 PATH → 引导你粘贴 API Key。然后在任意目录敲 <code>zephyrcode</code> 即可。</sub></div>

<br>

<table>
<tr>
<td valign="top" width="50%">

**它是什么**

- 一个**模型驱动的循环**：取上下文 → 动手 → 验证，直到模型不再调用工具
- 在**你的工作目录**里直接改文件、跑 shell，全程**权限闸门**把守
- 端口与适配器架构：内核 `agent-core` 与宿主无关，**进程内**运行，没有 HTTP 服务
- **模型适配器架构**：当前内置 DeepSeek V4 Pro，接入 Gemini / Claude 等只需加一个 provider 文件

</td>
<td valign="top" width="50%">

**一眼速览**

- 上下文 **100 万 token**，输出放到模型上限 **384K**，不设小限
- 内置 Read / Write / Edit / Glob / Grep / Bash / TodoWrite / memory + 子智能体 `Task` + 技能 `Skill`
- 技能、子智能体、输出风格、命令钩子全部**放文件即生效**
- 被动记忆、会话恢复、按项目隔离、思考深度可调

</td>
</tr>
</table>

```
prompt → [模型] → 工具调用 (Read / Edit / Bash …) → 结果回填 → [模型] → … → 完成
```

---

## 快速开始

**前置要求**

- Node.js **≥ 20**
- pnpm（安装脚本会用 `corepack` 自动启用，没有则提示你装）
- 一个 DeepSeek API Key（[在这里申请](https://platform.deepseek.com)；留空则用离线 stub 模型）

**安装并运行**

```bash
git clone https://github.com/zephyr4123/zephyrcode.git zephyrcode
cd zephyrcode
./install.sh           # 构建 + 装 launcher 到 ~/.local/bin + 引导你连接模型

zephyrcode             # 在当前目录启动交互式 TUI
zephyrcode --setup     # 随时重新连接 / 切换模型与 Key
zephyrcode --help      # 查看所有参数
zephyrcode --update    # git pull + 重新构建到最新
```

**首次运行会引导你连接模型**

安装脚本（或第一次启动 `zephyrcode`）会弹出引导：**选模型 → 粘贴 API Key**（输入全程掩码，不回显）。Key 会写进 `~/.zephyrcode/config.json`（权限 600），**再也不用手动建 `.env`**。

**没有 API Key 也能先跑起来**

```bash
AGENT_FAKE_MODEL=1 zephyrcode    # 离线 stub 模型，整套 TUI 都能体验，不需要 key
```

> 当前可选模型只有 `deepseek-v4-pro`。要换 provider 或改 Key，随时跑 `zephyrcode --setup`。
> launcher 记着你 clone 的位置；挪了目录就重新跑一次 `./install.sh`。

---

## 核心能力

<table>
<thead><tr><th>能力</th><th>说明</th></tr></thead>
<tbody>
<tr><td><b>工具</b></td><td>Read · Write · Edit · Glob · Grep · Bash · TodoWrite · memory（内置）；<code>Task</code> 子智能体、<code>Skill</code> 技能（模型可调）；WebSearch / WebFetch（默认关，<code>AGENT_WEB=1</code> 开）</td></tr>
<tr><td><b>权限</b></td><td>4 种模式 + 规则语法（<code>Bash(git push:*)</code>、<code>Read(src/**)</code>）；内置密钥黑名单；改文件前必须先读（read-before-edit）</td></tr>
<tr><td><b>上下文</b></td><td>100 万 token 窗口；按预算分级压缩（先落盘、再清旧工具输出、最后才摘要），带防抖断路器</td></tr>
<tr><td><b>记忆</b></td><td>被动记忆：每轮自动把 <code>/memories/MEMORY.md</code> 索引注入上下文；外加模型主动读写的 <code>memory</code> 工具</td></tr>
<tr><td><b>思考深度</b></td><td><code>low</code> / <code>high</code> / <code>ultra</code> 对应 DeepSeek 原生思考档位；说一句 “ultrathink” 把当轮拉满。<b>只控思考，不限输出</b></td></tr>
<tr><td><b>会话</b></td><td>按项目持久化；<code>--resume</code> / <code>--continue</code> 恢复；状态按项目隔离，互不串</td></tr>
<tr><td><b>扩展</b></td><td>技能、子智能体、输出风格、命令钩子全部放 Markdown / JSON 文件即生效，无需改代码</td></tr>
</tbody>
</table>

---

## 用法

<table>
<thead><tr><th width="38%">命令行参数</th><th>作用</th></tr></thead>
<tbody>
<tr><td><code>--cwd &lt;dir&gt;</code></td><td>智能体操作的工作目录（默认当前目录）</td></tr>
<tr><td><code>--effort &lt;级别&gt;</code></td><td>思考深度：<code>low</code> | <code>high</code> | <code>ultra</code>（默认 high）</td></tr>
<tr><td><code>-c</code>, <code>--continue</code></td><td>恢复最近一次会话</td></tr>
<tr><td><code>--resume [id]</code></td><td>按 id 恢复会话；省略 id 则列出最近会话</td></tr>
<tr><td><code>-p</code>, <code>--print &lt;文本&gt;</code></td><td>无界面跑一条 prompt 并打印结果（脚本 / CI）</td></tr>
<tr><td><code>--output-format &lt;格式&gt;</code></td><td>headless 输出：<code>text</code> | <code>json</code> | <code>stream-json</code></td></tr>
<tr><td><code>--yolo</code></td><td>headless 下自动批准工具调用（危险，仅限可信 CI）</td></tr>
<tr><td><code>--update</code> · <code>-v</code> · <code>-h</code></td><td>更新到最新 · 版本号 · 帮助</td></tr>
</tbody>
</table>

<table>
<thead><tr><th width="38%">会话内斜杠命令</th><th>作用</th></tr></thead>
<tbody>
<tr><td><code>/resume</code></td><td>选择并恢复一段历史会话</td></tr>
<tr><td><code>/effort &lt;low｜high｜ultra&gt;</code></td><td>设置思考深度</td></tr>
<tr><td><code>/skill</code></td><td>挑一个项目技能并运行</td></tr>
<tr><td><code>/output-style [名称]</code></td><td>切换输出风格（下一轮生效；<code>default</code> 还原）</td></tr>
<tr><td><code>/usage</code> · <code>/context</code></td><td>token 用量与花费 · 上下文窗口占用</td></tr>
<tr><td><code>/clear</code> · <code>/help</code> · <code>/exit</code></td><td>新开会话（旧的留盘） · 帮助 · 退出</td></tr>
</tbody>
</table>

**按键**：<kbd>@</kbd> 引用文件 · <kbd>/</kbd> 命令面板 · <kbd>Tab</kbd> 补全 · <kbd>↑</kbd><kbd>↓</kbd> 补全/历史 · <kbd>Enter</kbd> 发送（运行中则排队插话）· <kbd>Esc</kbd> 打断 · <kbd>Ctrl+C</kbd> 退出。
需要批准工具时：<kbd>y</kbd> 本次允许 · <kbd>a</kbd> 永久允许（本项目，gitignore）· <kbd>A</kbd> 永久允许（提交进项目规则）· <kbd>n</kbd> 拒绝。

**示例会话**

```text
❯ 给 utils.ts 加一个防抖函数，并补测试

  ✔ Read   src/utils.ts
  ✔ Write  src/utils.ts
  ✔ Write  test/utils.test.ts
  ✔ Bash   pnpm test      通过

  已加 debounce()，补了几个边界用例，测试全绿。
```

---

## 配置

凭据由引导流程（`./install.sh`、首次启动、或 `zephyrcode --setup`）写入 `~/.zephyrcode/config.json`，**你不用手动编辑任何文件，也没有 `.env`**。下面这些环境变量是可选的覆盖项（给 CI / 高级用法），真实环境变量永远优先。

<table>
<thead><tr><th>变量</th><th>默认</th><th>作用</th></tr></thead>
<tbody>
<tr><td><code>DEEPSEEK_API_KEY</code></td><td>（用引导保存的）</td><td>覆盖已存 Key（CI / 临时）。完全没配置则用离线 stub</td></tr>
<tr><td><code>ZEPHYRCODE_MODEL</code></td><td><code>deepseek-v4-pro</code></td><td>覆盖当前模型 id</td></tr>
<tr><td><code>AGENT_CONTEXT_TOKENS</code></td><td><code>1048576</code></td><td>上下文窗口（DeepSeek-V4-Pro 约 1M）</td></tr>
<tr><td><code>AGENT_MAX_OUTPUT_TOKENS</code></td><td>不设＝模型上限 384K</td><td>可选输出上限；不设即放满，按窗口动态收缩</td></tr>
<tr><td><code>AGENT_MAX_TURNS</code> · <code>AGENT_MAX_BUDGET_USD</code></td><td><code>24</code> · <code>1.0</code></td><td>单次运行的工具轮数 / 花费上限</td></tr>
<tr><td><code>AGENT_WEB</code> · <code>AGENT_FAKE_MODEL</code></td><td>关 · 关</td><td>开启联网工具 · 用离线 stub 模型</td></tr>
</tbody>
</table>

**状态存放位置**（按项目隔离，会话之间不串）：

```text
~/.zephyrcode/
  config.json                       全局凭据：provider + Key + 模型（权限 600，引导写入）
  settings.json                     用户级权限规则 + 钩子
  skills/  agents/  output-styles/  用户级扩展（始终加载）
  projects/<项目key>/               <项目名>-<cwd 的 sha256 前 8 位>
    sessions/                         该项目的会话记录
    memory/                           该项目的跨会话记忆

<你的仓库>/.zephyrcode/
  settings.json                     项目级权限规则 + 钩子（可提交）
  settings.local.json               本地覆盖（建议 gitignore）
  skills/  agents/  output-styles/  项目级扩展（仅受信任工作区加载）
```

API Key 留在全局，项目相关的一切要么随仓库走，要么在按项目隔离的状态目录里。

---

## 扩展

放文件即生效，无需重新构建。用户级（`~/.zephyrcode/…`）始终加载；项目级（`<仓库>/.zephyrcode/…`）需要先**信任该工作区**。

<details>
<summary><b>技能 Skill</b> &nbsp;<code>&lt;仓库&gt;/.zephyrcode/skills/&lt;名称&gt;/SKILL.md</code></summary>

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
<summary><b>子智能体 Sub-agent</b> &nbsp;<code>&lt;仓库&gt;/.zephyrcode/agents/&lt;名称&gt;.md</code></summary>

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
<summary><b>输出风格 Output style</b> &nbsp;<code>&lt;仓库&gt;/.zephyrcode/output-styles/&lt;名称&gt;.md</code></summary>

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

命令钩子会执行任意 shell，所以项目级钩子只对**受信任工作区**加载；`ZEPHYRCODE_DISABLE_HOOKS=1` 是全局总开关。

</details>

---

## 架构

pnpm + Turborepo 单仓，端口与适配器（ports &amp; adapters）：

```text
packages/
  shared/      跨层共享的类型（文件 / 事件 / 会话 schema、安全原语）
  agent-core/  可移植、被单测覆盖的内核，只依赖注入的端口：
               循环 · 上下文（压缩/记忆）· 工具 · 权限/钩子 · 会话
               · 工作区（真实 FS + 边界 + read-before-edit 账本）
               · 技能/子智能体/输出风格 · 思考深度
  cli/         应用层：Ink TUI + headless 模式 + Node/OS 适配器
               （DeepSeek 网关、本地进程沙箱），进程内接到 agent-core
docs/ARCHITECTURE.md
```

`agent-core` 里**没有任何** TUI / HTTP / DeepSeek 引用，一切都通过端口（`ModelGateway`、`Workspace`、`Sandbox`、`SessionStore`、`MemoryStore`、`Clock`、`Logger`）跨界，所以它能用内存假实现跑全套单测，也能在 CLI 里**进程内**运行，换/加模型只是加一个 provider（自带适配器）。

---

## 开发

```bash
pnpm install
pnpm --filter @coding-agent/cli zephyrcode    # 用 tsx 直接跑 TUI（免构建）
pnpm --filter @coding-agent/cli build         # 产出 packages/cli/dist/zephyrcode.js

pnpm typecheck    # 全部包
pnpm test         # 单元 + 集成 + e2e（341 个）
pnpm build        # 构建全部
```

- **单元**：`agent-core` 每个模块 + shared 安全原语 + TUI reducer
- **集成**：脚本化模型 + 内存假实现跑通整条循环；headless 跑通
- **e2e**：构建真实 bundle，驱动真实的 `node dist/zephyrcode.js` 进程（参数、配置、退出码、headless 输出）

新增内核能力：**新工具** = 在 `agent-core/src/tools/builtin/` 加一个 `Tool` 并注册；**新护栏** = 一个 `PreToolUse` / `PostToolUse` 钩子（不动循环）；**新模型 provider** = 在 `cli/src/providers/` 加一个 provider 文件（自带 `ModelGateway` 适配器）再注册进 registry，引导流程会自动把它列出来。

---

## 路线图

- 更多模型 provider：Gemini、Claude 等（provider registry 已就绪，加一个文件即可）
- OS 级命令沙箱（macOS `sandbox-exec` / Linux `bwrap`），接在现有 `Sandbox` 端口后面
- MCP 服务器/工具接入（工具调用契约已与传输无关）

---

<div align="center">

<sub>灵感来自 Anthropic 的 <a href="https://www.anthropic.com/claude-code">Claude Code</a>，由 <a href="https://www.deepseek.com">DeepSeek</a> 驱动。<br>
zephyrcode 是独立项目，与 Anthropic、DeepSeek 无隶属或背书关系。</sub>

<br><br>

许可证 <a href="LICENSE"><b>MIT</b></a> © 2026 Zephyr Huang &nbsp;·&nbsp; <a href="README.en.md">English</a>

</div>

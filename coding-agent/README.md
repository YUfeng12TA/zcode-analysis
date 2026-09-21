# DeskCoder —— 桌面 AI 编程助手（Electron）

> 基于对 **ZCode Desktop v3.12.3** 的逆向分析文档（`../README.md`、`../机制图谱.md`）中描述的架构模式，**从零自研实现**的桌面 coding agent 原型。
> 本仓库**不包含 ZCode 的任何代码**——架构参考（Electron 分层、agent 循环、工具调度、OpenAI 兼容网关）均为通用工程模式。

## 功能

- **Agent 工具调度循环**：LLM 生成 → 需要工具则执行 → 结果回填 → 继续，直到产出最终回答（上限 20 轮）
- **流式输出**：逐 token 渲染回复
- **内置工具集**（自研）：
  - `list_dir` / `read_file` / `write_file` / `edit_file`（文件操作，带路径越界防护）
  - `glob` / `grep`（项目搜索，grep 优先用 ripgrep）
  - `run_command`（在工作目录内执行命令：测试、构建、git）
- **模型兼容**：OpenAI Chat Completions 接口（OpenAI / DeepSeek / Moonshot / 智谱 / vLLM / Ollama 等均可，填 baseURL + key + model）
- **会话**：多会话切换，本地 JSON 持久化（用户数据目录）
- **UI**：深色聊天界面，工具调用卡片（可折叠查看参数与结果），模型设置面板

## 架构

```
coding-agent/
├─ main/
│  ├─ index.js        Electron 主进程：窗口、IPC、会话调度、设置持久化
│  ├─ agent.js        Agent 引擎：模型调用 + 工具调度主循环
│  ├─ llm.js          LLM 客户端（OpenAI 兼容，流式 SSE + function calling）
│  └─ tools/          工具集（files.js 文件/搜索、exec.js 命令执行、index.js 注册表）
├─ preload.js         contextBridge 安全桥（渲染进程不暴露 Node）
├─ renderer/          前端（原生 HTML/CSS/JS，无构建步骤）
└─ test/agent-smoke.js  Agent 循环冒烟测试（mock LLM，不联网）
```

与 ZCode 对照（均为**自研简化实现**）：

| 机制 | ZCode（逆向观察） | DeskCoder（自研） |
|---|---|---|
| 壳 | Electron 主进程 + host/preload/scheduler 多进程 | Electron 主进程 + preload 桥 |
| Agent 循环 | `toolCall`/`startTool`/`runTool` 调度 | `llm.chatCompletion` + `executeTool` 循环 |
| 工具 | MCP、playwright、node-pty、rg/ugrep | files/glob/grep/run_command（child_process） |
| 模型网关 | `getModelConfigHeaders` + 自研端点 | OpenAI 兼容 baseURL 可配置 |
| 前端 | React 19 + Redux | 原生 JS（零依赖） |

## 运行

前置：Node.js ≥ 18（本机验证 22.x）。

```bash
npm install
npm start
```

首次安装 Electron 若慢，可设置镜像：

```bash
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com
```

## 配置

启动后在 **设置** 面板填入：

- **API Base URL**：你的服务商 OpenAI 兼容端点，如 `https://api.deepseek.com/v1`、`https://api.openai.com/v1`
- **API Key**：对应密钥（保存在本机用户数据目录的 `settings.json`，仅本机可用）
- **模型**：如 `deepseek-chat`、`gpt-4o-mini`
- **工作目录**：Agent 操作的文件范围（默认用户主目录；所有文件工具做路径越界防护）

## 验证

```bash
npm run test:agent   # Agent 循环冒烟（工具调度/回填/越界防护/中止，不联网）
npm run smoke        # Electron 主进程加载冒烟（不弹窗）
```

## 安全说明

- 渲染进程无 Node 权限（contextIsolation + preload 白名单 API）
- 文件工具限制在工作目录内（路径穿越防护）
- 命令执行限时（默认 60s，上限 5min）、输出限量（60KB）
- LLM 输出仅经受控 Markdown 渲染器渲染（先转义再生成标签，链接仅 http/https）
- API Key 仅存本机用户数据目录，不写入代码或日志

## 已知限制（诚实标注）

- 无持久终端（PTY）：`run_command` 为一次性执行，不模拟 ZCode 的 node-pty 长驻终端
- 无 computer-use 浏览器自动化、无 MCP 协议接入、无遥测——均超出本原型范围
- 会话历史仅存会话内，未做跨会话向量检索
- 多轮工具调用上限 20 轮，防止死循环

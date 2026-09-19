# ZCode 逆向分析（成分 · 结构 · OSS/快照上传机制）

> **仓库 description 字段文案**（GitHub 仓库页 description 输入框直接粘贴）：
> `ZCode Desktop v3.12.3 逆向分析：全栈成分 · 结构测绘 · OSS/仓库快照上传机制溯源（仅分析文档，不含原始代码）`

> 对 **ZCode Desktop v3.12.3**（闭源商业软件，`F:\Program Files\ZCode`）的逆向技术分析与机制研究。
> 本仓库**只含分析文档与机制源码摘录，不含 ZCode 原始可运行代码**——所有"原始代码"指向官方安装路径，由读者自行安装。

---

## 这是什么

ZCode 是一个 **Electron 桌面 AI 编程助手**（对标 Cursor / Claude Code 客户端）。本仓库聚焦三件事：

1. **全栈成分**：它用了哪些语言、框架、native 内核；
2. **结构测绘**：从 asar 解包还原的分层结构与调用关系；
3. **OSS / 仓库快照上传机制**：完整溯源"本地代码会不会被上传、怎么传、默认开没开"。

---

## 全栈技术栈（成分）

| 层 | 语言 | 框架 / 库 |
|---|---|---|
| 壳 | C/C++（Chromium） | Electron（`ZCode.exe`） |
| agent 引擎 | JS（esbuild 单文件 bundle，pnpm monorepo `zcode-cli`） | @modelcontextprotocol/sdk、playwright-core、undici、node-pty、ssh2、sharp、ws、hono |
| 前端 | TSX（Vite 压缩产物） | React 19.2.4 + Redux Toolkit、Framer Motion、ECharts/zrender/recharts、Radix UI、Tailwind/shadcn、unified/remark/rehype（md）、shiki、mermaid、@lexical、@xterm、@xyflow、@rrweb、zod |
| 主进程 / host / preload / scheduler | TS → ESM | Electron 各进程 + RPC 桥 |
| native 内核 | C/C++ | node-pty（`conpty.node`×3 PTY）、sharp（图像）——第三方预编译 `.node` |
| 内核工具 | Rust | ripgrep（`rg.exe`）、ugrep（`ugrep.exe`）+ cua-helper（computer-use 助手） |
| 可观测 | JS | OpenTelemetry（trace）+ @arms/rum-electron（阿里 ARMS RUM） |

**用到的语言**：TypeScript/JavaScript（前后端主体）· C/C++（native）· Rust（rg/ugrep 二进制）· WASM（部分 chunk）· SQL（sqlite 会话库）。

---

## 结构（自 `resources/app.asar` 解包还原）

```
ZCode.exe (Electron/Chromium, win32-x64)
├─ out/renderer    React 19 前端（Vite 分包，4081 文件）
├─ out/main        Electron 主进程（20 chunk）
├─ out/host        渲染隔离服务宿主 + RPC 桥（15 chunk）
├─ out/preload     6 个 .cjs（各 WebView ctx 注入：cua 权限/嵌入式浏览器/资源管理）
├─ out/scheduler   任务/波次调度
├─ resources/glm/zcode.cjs   agent 引擎（3583 行压缩，11MB）← 机制分析主体
├─ resources/tools  ripgrep + ugrep + cua-helper
└─ app.asar.unpacked  27 个 native .node（node-pty/sharp，全第三方）
```

---

## OSS / 仓库快照上传机制（核心）

> 完整源码摘录见 [`snippet/repo-snapshot-upload.md`](snippet/repo-snapshot-upload.md)。

**结论（源码实测，非推断）**：

- **触发门（双开关 AND，默认关）**——引擎函数 `isRepoSnapshotIndexingSwitchChecked`：
  ```js
  e?.repoSnapshotIndexingEnabled === true && e.repoSnapshotIndexingUserConfigured === true
  ```
  两开关默认全 `false` → **出厂不采集、不上传，须用户显式 opt-in**。
- **上传的是加密制品，非明文代码**——schema 族含 `encrypted_artifact` / `encryption_aad` / `manifest_hash`（防篡改 SHA）。
- **走预签名通道，不直连 OSS 桶**——`upload_target` + `upload_key` 由 **ZCode 服务端签发**，客户端按一次性预签名 PUT。
- **按仓库维度命名**——`repo_snapshot_<owner>/<id>`，针对具体仓库，非全机扫描。
- **快照可回注 prompt**——`resolveRepoSnapshotPromptProvider` 把已索引仓库结构喂给模型。

⚠ **服务端边界**：桶域名、AK/SK、签名算法都在 ZCode 后端服务，**不在可逆向的客户端产物里**。客户端源码里 grep 不到实际的 OSS PUT 动作——只能定位到"触发 + 加密 + 预签名字段"，不能拿到完整可运行的上传代码。

---

## 其它机制速览

| 机制 | 入口 | 默认 |
|---|---|---|
| computer-use 浏览器自动化 | 46 动作枚举（`navigate/click/playwright/recording/…`） | 入口默认隐藏 |
| 模型调用网关 | `getModelConfigHeaders`（11 处），注入 `o11yHeaders` | 走 `zcode-plan/anthropic` |
| MCP 协议 | `listTools` 17 / `callTool` 12 | 连外部 MCP server 时启用 |
| 工具调度（agent 主循环） | `toolCall` 1238 / `startTool` 7 | 每轮必选工具 |
| 遥测可观测 | OpenTelemetry 606 / ARMS 9 | 默认关占多（`default(!1)` 19 > `!0` 17） |
| 附件下载/上传 | `local-download-upload`（默认）/ `remote-download` | 默认本地暂存，不推远端 |

---

## 诚实标注

- 全部锚点为 **esbuild 压缩产物**（变量名混淆、行被挤长），按 **grep 关键词**复核，不按行号。
- **无 source map**（0 个 `.map`），无法还原到原始 `.tsx`/`.ts`。
- native `.node` 未做 IDA 级反汇编（全第三方预编译）。
- 本仓库不主张对 ZCode 任何代码的所有权，仅供安全研究与学习。详见 [`LEGAL.md`](LEGAL.md)。

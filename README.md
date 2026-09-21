# ZCode 逆向破解源码（原版 v3.14.0）

> ZCode Desktop **v3.14.0**（`F:\Program Files\ZCode`），自 `resources/app.asar` 解包还原。
> 生成日期 2026-09-21。本目录全部是**解包后的原始编译产物（原版，未做 js-beautify 美化）**。

## 这是什么

ZCode 是一个 **Electron 桌面 AI 编程助手**（对标 Cursor/Claude Code 客户端），内置：
- **agent CLI 引擎**（模型调用 + 工具调度 + computer-use 浏览器自动化）
- **React 19 前端**（聊天 UI、代码预览、diff、Markdown 渲染、图表）
- **MCP 协议支持**（`@modelcontextprotocol/sdk`）
- **仓库快照加密上传 + 会话分享**（默认关，双开关 AND 门）
- **OpenTelemetry + ARMS RUM 遥测**（可观测性）
- **网页远程控制通道**（v3.14 新增：WebSocket relay + 设备指纹）

## 目录结构（全原版 v3.14.0）

```
Zcode源码/
├── backend/zcode.cjs          15438 行原版（源 resources/glm/zcode.cjs，15MB，+3.4M vs v3.12.3）
├── main/                      Electron 主进程（22 文件，原版 2.0M）
├── host/                      host 进程（18 文件，原版 2.7M，新增 tasksStorageWorker.js）
├── preload/                   7 个 .cjs（原版 4.1M）
├── scheduler/                 3 文件（原版 985K，新增 broker 分片）
├── metadata/                  build-meta.json
├── frontend/                  React 19 前端（原版 52M，4121 文件）
│   ├── index.html             主入口
│   └── assets/                Vite 分包（全压缩原版）
├── deobfuscated/              ★ 全量解混淆（main 22 + host 18 + preload 7 + scheduler 3 + renderer）
└── reference/
    ├── node_modules\          455 个第三方依赖包（原版压缩产物）
    └── package.json           全栈依赖清单
```

## 全栈技术栈

| 层 | 语言 | 框架/库 |
|---|---|---|
| 壳 | C/C++（Chromium） | Electron |
| 后端 | TypeScript/JS → ESM（压缩） | Node.js、undici、@zcode/* monorepo |
| agent 引擎 | JS（esbuild 单文件 bundle） | zcode.cjs、MCP SDK、playwright-core、node-pty、ssh2、sharp、ws、hono |
| 前端 | TSX（Vite 压缩） | React 19 + Redux、Framer Motion、ECharts、Radix UI、Tailwind、shadcn、unified/remark、shiki、mermaid、@lexical、@xterm、@xyflow、@rrweb、zod |
| native | C/C++ | node-pty（conpty.node×3）、sharp |
| 可观测 | JS | OpenTelemetry + ARMS RUM |

## 如何读（压缩产物破解法）

由于变量名混淆 + 行被挤长，**按关键词 grep 而非按行号读**。

| 要查什么 | grep 关键词 |
|---|---|
| 仓库快照上传 | `repoSnapshotIndexing` / `REPO_SNAPSHOT_UPLOAD_TARGET` / `repo_snapshot_` |
| 双开关 AND 门 | `repoSnapshotIndexingEnabled` + `repoSnapshotIndexingUserConfigured` |
| computer-use 动作 | `"navigate","back"` / `playwright` / `domSnapshot` |
| 模型调用 | `getModelConfigHeaders` / `zcode-plan/anthropic` / `o11yHeaders` |
| 远程控制通道 | `webRemoteControlManager` / `relayWsUrl` / `relayProtocol` / `deviceMid` |
| 附件/会话上传 | `attachmentUpload` / `conversationShareArtifactUploadDataSchema` |
| MCP 协议 | `@modelcontextprotocol` |

## 关键机制（源码 grep 可复核）

### 仓库快照加密上传
`backend/zcode.cjs` 搜 `repoSnapshotIndexingEnabled`：
```js
e?.repoSnapshotIndexingEnabled === true && e.repoSnapshotIndexingUserConfigured === true
```
双开关 AND 门，默认全 false。上传走加密制品 + 预签名通道（详见 `snippet/repo-snapshot-upload.md`）。

### 网页远程控制（v3.14.0 新增）
`main/index.js` 搜 `webRemoteControlManager`（9 处）：
- 通过 **WebSocket relay**（`relayWsUrl`）连接 `cdn.zcode-ai.com` / `studio.zcode-ai.com`
- 认证：`deviceMid`（设备指纹）+ `X-Device-ID` header
- `mobileRemoteControlUrl`：移动端远程会话控制
- 默认需 `webRemoteControlExternalRelayDevice` 配 deviceSid 才连

### 模型调用网关
`backend/zcode.cjs` 搜 `getModelConfigHeaders`（11 处），端点 `zcode.z.ai/api/v1/zcode-plan/anthropic`。

### 自动更新
- `updater disabled for this product flavor`（production 默认关 electron-updater）
- `autoDownloadAndInstallUpdates` 默认 `false`

## 诚实标注

- 全部是**原版压缩产物**，未美化——变量名混淆，按 grep 关键词读。
- **无 source map**，无法还原到原始 `.tsx`/`.ts`。
- native `.node` 未做二进制逆向（全第三方预编译）。
- 远程控制通道端点域名在运行时下发，静态源码里只见 relay 机制骨架。

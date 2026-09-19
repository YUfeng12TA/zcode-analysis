# ZCode 逆向破解源码（原版）

> **全量解混淆产物在 `deobfuscated/`（2730 文件，68M）；全机制图谱 + 内核 native 清单见 `机制图谱.md`。**

> ZCode Desktop v3.12.3（`F:\Program Files\ZCode`），自 `resources/app.asar`（307MB）解包还原。
> 生成日期 2026-09-19。本目录全部是**解包后的原始编译产物（原版，未做 js-beautify 美化）**。

## 这是什么

ZCode 是一个 **Electron 桌面 AI 编程助手**（对标 Cursor/Claude Code 客户端），内置：
- **agent CLI 引擎**（模型调用 + 工具调度 + computer-use 浏览器自动化）
- **React 19 前端**（聊天 UI、代码预览、diff、Markdown 渲染、图表）
- **MCP 协议支持**（`@modelcontextprotocol/sdk`）
- **仓库快照加密上传 + 会话分享**（默认关，双开关 AND 门）
- **OpenTelemetry + ARMS RUM 遥测**（可观测性）

本目录是**编译后产物的原始还原**（无 source map，上限 = 解包原始字节，非原始 `.tsx`/`.ts` 源码）。
所有代码都是 **esbuild/rollup 打包后的压缩产物**——变量名被混淆、行被挤长，但结构、字符串、import 图仍可 grep 重建。

## 目录结构（全原版）

```
Zcode源码/
├── READ.md                    ← 本文件
├── backend/zcode.cjs          3583 行原版（源 F:\Program Files\ZCode\resources\glm\zcode.cjs，11MB）
├── main\                      Electron 主进程（20 文件，原版 3.0M）
│   ├── index.js               主入口（原版 1368 行）
│   └── chunk-*.js             19 个 chunk
├── host\                      host 进程（15 文件，原版 3.8M）
├── preload\                   Electron preload（6 个 .cjs，原版 2.5M）
│   ├── index.cjs / browserVideoRecorder.cjs / codingPlanWebview.cjs
│   ├── cuaPermissionPanel.cjs / embeddedBrowserJavaScriptDialog.cjs / resourceManager.cjs
├── scheduler\                 调度器（1 文件，2.1M）
├── metadata\                  build-meta.json（构建元数据）
├── frontend\                  React 前端（原版 52M，含 4081 文件）
│   ├── index.html             主入口（引用 assets/index-Bz4oM8b0.js）
│   ├── resource-manager.html  独立面板
│   └── assets/                Vite 分包（index/业务/第三方库 chunk，全部压缩原版）
└── reference\
    ├── node_modules\          455 个第三方依赖包（284M，原版压缩产物）
    └── package.json           全栈依赖清单（react/@zcode/*/@modelcontextprotocol 等）
```

## 全栈技术栈（已测绘）

| 层 | 语言 | 框架/库 |
|---|---|---|
| 壳 | C/C++（Chromium） | Electron（`ZCode.exe`） |
| 后端 | TypeScript/JS → ESM（压缩） | Node.js（electron 内置）、undici（HTTP）、@zcode/* 自研 monorepo |
| agent 引擎 | JS（esbuild 单文件 bundle） | `zcode.cjs`、@modelcontextprotocol/sdk、playwright-core、node-pty、ssh2、sharp、ws、hono |
| 前端 | TSX（Vite 压缩产物） | React 19.2.4 + Redux Toolkit、Framer Motion、ECharts/zrender/recharts、Radix UI、Tailwind、shadcn、unified/remark/rehype（md）、shiki（高亮）、mermaid、@lexical（编辑器）、@xterm（终端）、@xyflow（画布）、@rrweb（会话回放）、zod |
| native | C/C++ | node-pty（PTY，conpty.node×3）、sharp（图像处理）——27 个 .node 全是第三方预编译 |
| 可观测 | JS | OpenTelemetry（trace）+ @arms/rum-electron（阿里 RUM） |

**用到的语言汇总**：TypeScript/JavaScript（前后端主体）、C/C++（native）、WASM（部分 chunk）、Rust（computer-use 引擎 zcode-cua 内可能含，待确认）、SQL（sqlite 会话存储）。

## 如何读（压缩产物破解法）

由于变量名混淆 + 行被挤长，**按关键词 grep 而非按行号读**。`backend/zcode.cjs` 里内容集中在少数巨行上：

| 要查什么 | grep 关键词（在 `backend/zcode.cjs` 里搜） |
|---|---|
| 仓库快照上传 | `repoSnapshotIndexing` `REPO_SNAPSHOT_UPLOAD_TARGET` `repo_snapshot_` |
| 双开关 AND 门（默认关） | `repoSnapshotIndexingEnabled`（配合 `repoSnapshotIndexingUserConfigured`） |
| computer-use 浏览器动作 | `"navigate","back","forward"` `playwright` `domSnapshot` `recordingStart` |
| 模型调用网关 | `getModelConfigHeaders` `zcode-plan/anthropic` `o11yHeaders` |
| 附件/会话上传 | `attachmentUpload` `conversationShareArtifactUploadDataSchema` |
| MCP 协议 | `@modelcontextprotocol`（在 `reference/node_modules/`） |

读前端：`frontend/assets/index-Bz4oM8b0.js`（Vite 入口）→ 顺着 `import` 读 `src-*`/`chunk-*` 业务 chunk。组件名被压缩混淆，但 jsx 嵌套结构与业务字符串可读。

## 关键机制（源码 grep 可复核）

### 仓库快照加密上传（之前问的"OSS 上传"）

`backend/zcode.cjs` 里搜 `repoSnapshotIndexingEnabled`：判定为
```js
e?.repoSnapshotIndexingEnabled === true && e.repoSnapshotIndexingUserConfigured === true
```
双开关 AND 门，默认 `default(false)`——**出厂不采集/不上传，须用户显式 opt-in**。
快照走 `encrypted_artifact + encryption_aad + manifest_hash + upload_key/upload_target` 的加密制品体系，预签名 URL + 过期时间，非明文直传 OSS。

### computer-use 浏览器自动化引擎

`backend/zcode.cjs` 搜 `"navigate","back"`：一个 46 动作枚举（`click/fill/type/cuaKeypress/drag/screenshot/playwright/recordingStart/claimTab/markDeliverable/...`），双模式 `desktop-continuous` / `web-remote-replayable`。

### 模型调用网关

`backend/zcode.cjs` 搜 `getModelConfigHeaders`：多处，注入 `o11yHeaders`；端点 `https://zcode.z.ai/api/v1/zcode-plan/anthropic`（zai 内置计划，Anthropic Messages API）。

## 诚实标注

- **全部是原版压缩产物，未做美化**——变量名混淆、行被挤长（`zcode.cjs` 3583 行里真正内容集中在少数巨行），读起来比美化版累，但保留了解包原始字节。
- **无 source map**（0 个 `.map`），无法还原到原始 `.tsx`/`.ts`，当前是逆向上限。
- **native `.node` 未做二进制逆向**（27 个全是 node-pty/sharp 第三方预编译）。
- **`@zcode/*` 自研 monorepo** 没有独立 `.ts` 源码（as 里只有编译后 JS，`workspace:*` 引用），其逻辑已编译进 `main/`/`host/`/`backend/`。
- 第三方依赖在 `reference/node_modules/`（455 包，原版压缩），非 ZCode 自研。

# ZCode 逆向

> **全量解混淆产物在 `deobfuscated/`（2730 文件，68M）；全机制图谱 + 内核 native 清单见 `机制图谱.md`。**



## 这是什么

ZCode 是一个 **Electron 桌面 AI 编程助手**


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


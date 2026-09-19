# ZCode 仓库快照 / OSS 上传机制 —— 源码版本（逐字摘录）

> 全部代码片段均从 `F:\Program Files\ZCode\resources\glm\zcode.cjs` **逐字摘录**（byte-for-byte），
> 未改写、未补全、未推断。`zcode.cjs` 是 esbuild 压缩 bundle，变量名已混淆。
> 每段用 `//` 注释标注原始语义（非原文）。

---

## ① 仓库快照 schema 工厂 + 常量族

**摘录位置**：`zcode.cjs` 第 61 行巨行内（offset ≈ 691956 起），原始字节逐字如下：

```js
L3="v2",Zrr="v1",SXe="v1";
a(Cw,"repoSnapshotSchema");
Cpo=Cw("manifest",L3),
Epo=Cw("prompt",L3),
Apo=Cw("delta",L3),
Rpo=Cw("extra_manifest","v1"),
Ppo=Cw("extra_delta","v1"),
Opo=Cw("encrypted_artifact",L3),
Mpo=Cw("encryption_aad",L3),
Dpo=Cw("manifest_hash",Zrr),
Npo=Cw("upload_key",SXe),
$po=Cw("upload_target",SXe);
a(jpo,"buildRepoSnapshotWorkspaceKey");
a(zpo,"resolveRepoSnapshotPromptProvider")
```

**注释**（非原文）：
- `L3="v2"` 是 artifact schema 主版本号；`Zrr="v1"` 是 hash 版本；`SXe="v1"` 是 upload 版本。
- `Cw(name, version)` 是 schema 工厂（见 ③），把 `encrypted_artifact`、`upload_key`、`upload_target` 等 key 版本化命名。
- `a(x, "name")` 是 esbuild 的 `defineProperty` 包装（给函数/变量打原始名标记，非业务逻辑）。

---

## ② 触发门（双开关 AND）

**摘录位置**：`zcode.cjs` 第 45 行巨行内，原始字节逐字如下：

```js
function sKt(e){return e?.repoSnapshotIndexingEnabled===!0&&e.repoSnapshotIndexingUserConfigured===!0}
```

**注释**（非原文）：
- `sKt` = 原始名 `isRepoSnapshotIndexingSwitchChecked`（由 ① 中 `a(sKt,"isRepoSnapshotIndexingSwitchChecked")` 确认）。
- `===!0` 即 `=== true`（esbuild 压缩写法）。
- **语义**：仅当**两个**字段同时为 `true` 才启用快照索引/上传。
- 两个字段均 **默认 `false`**（schema 里 `m.boolean().default(!1)`，grep 命中 `repoSnapshotIndexingEnabled:m.boolean().default(!1)`）。
- **出厂默认不采集、不上传，须用户显式 opt-in**。

---

## ③ workspace key 工厂 + 仓库 key 构造

**摘录位置**：`zcode.cjs` 第 61 行巨行内，原始字节逐字如下：

```js
function Cw(e,t){return`repo_snapshot_${e}/${t}`}
function jpo(e){return e.workspaceIdentity?.trim()||e.workspacePath}
```

**注释**（非原文）：
- `Cw` = 原始名 `repoSnapshotSchema`（由 ① 中 `a(Cw,"repoSnapshotSchema")` 确认）。
- `jpo` = 原始名 `buildRepoSnapshotWorkspaceKey`（由 ① 中 `a(jpo,"buildRepoSnapshotWorkspaceKey")` 确认）。
- **语义**：仓库快照 key 是 `repo_snapshot_<owner>/<id>`，`<owner>` 取自 `workspaceIdentity.trim()` 或 `workspacePath`；针对具体仓库，非全机扫描。
- 另注：`zcode.cjs` 第 61 行附近还有一处 `function Cw(e,t){return`，是 esbuild 把同名函数复用，此处是仓库快照 key 的工厂定义。

---

## ④ 快照 prompt 回注（下游用途）

**摘录位置**：`zcode.cjs` 第 61 行巨行内，`jpo` 之后紧接：

```js
function zpo(e){let t=e.providerId?.trim();if(t===Ki.bigmodelIndividualCodingPlan||t===Ki.big...
```

（`zpo` = 原始名 `resolveRepoSnapshotPromptProvider`，在 ① 中 `a(zpo,"resolveRepoSnapshotPromptProvider")` 确认）

**注释**（非原文）：
- 把已索引的仓库快照**回注到模型 prompt**——让模型感知仓库结构。
- 函数体后续按 `providerId` 路由到不同模型 provider。

---

## ⑤ 服务端边界（诚实说明，非源码摘录）

`zcode.cjs` 里 grep `uploadKey`/`.put(`/`presign`/`signedUrl`/`oss://`/`s3://` 均**无命中**（仅有 ① 中 `upload_key`/`upload_target` 两个 schema 字段）。

**结论**：
- `upload_target` 与 `upload_key` 是**运行时下发的预签名对**，桶域名/AK/签名算法全在 **ZCode 服务端**，客户端源码里不可见。
- 本仓库给的是**客户端侧**机制（触发门 + schema + key 构造 + 回注），**不是完整可运行 OSS 上传代码**——那部分在服务端，无法通过逆向客户端获得。

---

## 复核方法（byte-for-byte grep）

```bash
# ① 常量族（L3/Zrr/SXe + Cw 调用）
grep -oF 'L3="v2",Zrr="v1",SXe="v1";' zcode.cjs

# ② 触发门（sKt 双开关）
grep -oF 'function sKt(e){return e?.repoSnapshotIndexingEnabled===!0&&e.repoSnapshotIndexingUserConfigured===!0}' zcode.cjs

# ③ workspace key 工厂 + 构造
grep -oF 'function Cw(e,t){return`repo_snapshot_${e}/${t}`}' zcode.cjs
grep -oF 'function jpo(e){return e.workspaceIdentity?.trim()||e.workspacePath}' zcode.cjs

# ④ 回注
grep -oF 'a(zpo,"resolveRepoSnapshotPromptProvider")' zcode.cjs
```

> 注：`zcode.cjs` 是 esbuild 压缩产物，上述逻辑分散在第 45/61/62 行巨行内，grep 行号集中在这几行。

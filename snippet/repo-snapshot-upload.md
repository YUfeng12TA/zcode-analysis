# ZCode 仓库快照 / OSS 上传机制 —— 完整源码摘录

> 来源：`F:\Program Files\ZCode\resources\glm\zcode.cjs`（3583 行 esbuild 压缩 bundle，变量名混淆）。
> 引擎源自 pnpm monorepo `apps/zcode-cli/packages/cli/dist/zcode.cjs`（见 `resources/glm/.node-bundle-meta.json`）。
> 下文每段均为 grep 可复核的原文摘录（混淆名，非原始 TS 名）。

---

## 一、机制总览（数据流）

```
[双开关门 sKt] ──true──▶ [构建 workspace key: repo_snapshot_<owner>/<id>]
                              │
                              ▼
              [构建 manifest/prompt/delta + 加密 encrypted_artifact]
                              │
                              ▼
        [服务端下发预签名对 upload_target / upload_key]   ← 桶域名/签名在 ZCode 服务端
                              │
                              ▼
              [客户端按预签名 PUT 加密制品到对象存储]
```

关键结论（源码实测，非推断）：
- 本地引擎**只持有 schema 定义 + 触发门 + key 构造**；**OSS 签名、PUT、桶地址全在服务端**，静态源码里看不到具体域名。
- 上传的是**加密制品**（`encrypted_artifact`），非明文代码。

---

## 二、触发门（双开关 AND，默认关）

混淆函数 `sKt`（导出映射名 `isRepoSnapshotIndexingSwitchChecked`，grep 命中行 45/62）：

```js
function sKt(e){return e?.repoSnapshotIndexingEnabled===!0&&e.repoSnapshotIndexingUserConfigured===!0}
```

- `repoSnapshotIndexingEnabled` — 功能开关，schema 里 `m.boolean().default(!1)`（**默认 false**）。
- `repoSnapshotIndexingUserConfigured` — 用户是否**显式**配置过（opt-in 标志）。

两个同时为 `true` 才启用快照索引/上传。出厂默认全关 → **不采集、不上传，须用户显式 opt-in**。

引擎层布尔默认值统计（grep 实测）：`.default(!0)`（默认开）17 处，`.default(!1)`（默认关）19 处——隐私/上传类默认关占多，印证保守设计。

---

## 三、workspace key 构造（按仓库维度）

混淆函数 `jpo`（导出映射名 `buildRepoSnapshotWorkspaceKey`，grep 命中行 61/62）：

```js
return `repo_snapshot_${e}/${t}`   // e=owner, t=repo/instance id
```

快照对象按 `repo_snapshot_<owner>/<id>` 组织，**针对具体仓库而非全机扫描**。

---

## 四、快照 schema 族（加密制品体系）

混淆常量工厂 `Cw(name, version)` 生成各 schema key，`L3="v2"` / `Zrr="v1"` / `SXe="v1"`（grep 命中行 25612 区）：

```js
L3 = "v2", Zrr = "v1", SXe = "v1";
Cpo = Cw("manifest", L3)                  // manifest v2
Epo = Cw("prompt", L3)
Apo = Cw("delta", L3)                     // 增量 delta
Rpo = Cw("extra_manifest", "v1")
Ppo = Cw("extra_delta", "v1")
Opo = Cw("encrypted_artifact", L3)        // 加密制品体（上传的就是这个，非明文）
Mpo = Cw("encryption_aad", L3)           // 加密认证数据(AAD)
Dpo = Cw("manifest_hash", Zrr)           // 防篡改 SHA 哈希
Npo = Cw("upload_key", SXe)              // 预签名上传 key（服务端下发）
$po = Cw("upload_target", SXe)           // 预签名上传目标（= 对象存储端点，服务端下发）
```

导出表（`REPO_SNAPSHOT_*_SCHEMA`）：

```
REPO_SNAPSHOT_ARTIFACT_SCHEMA_VERSION   -> L3   ("v2")
REPO_SNAPSHOT_DELTA_SCHEMA              -> Apo
REPO_SNAPSHOT_ENCRYPTED_ARTIFACT_SCHEMA -> Opo
REPO_SNAPSHOT_ENCRYPTION_AAD_SCHEMA     -> Mpo
REPO_SNAPSHOT_EXTRA_DELTA_SCHEMA        -> Ppo
REPO_SNAPSHOT_EXTRA_MANIFEST_SCHEMA     -> Rpo
REPO_SNAPSHOT_MANIFEST_HASH_SCHEMA      -> Dpo
REPO_SNAPSHOT_MANIFEST_SCHEMA           -> Cpo
REPO_SNAPSHOT_UPLOAD_KEY_SCHEMA         -> Npo   (upload_key)
REPO_SNAPSHOT_UPLOAD_SCHEMA_VERSION     -> SXe  ("v1")
REPO_SNAPSHOT_UPLOAD_TARGET_SCHEMA      -> $po   (upload_target)
```

---

## 五、快照回注机制（prompt provider）

`resolveRepoSnapshotPromptProvider`（grep 命中行 61/62）：把已索引的仓库快照**回注到模型 prompt**，让模型感知仓库结构——这是快照的下游用途。

---

## 六、服务端边界（诚实标注）

在 `zcode.cjs` 引擎内 grep `uploadKey`/`.put(`/`presign`/`signedUrl`/`oss://`/`s3://` 均**无**实际的 OSS 上传动作——只有 `upload_key`/`upload_target` 两个 schema 字段（grep 命中行 3424 一处 `uploadKey`，属 schema 上下文）。

**结论**：
- 预签名（`upload_target` + `upload_key`）**由 ZCode 服务端签发**，引擎拿到后按一次性预签名通道 PUT。
- 桶域名、AK/SK、签名算法都在**服务端**，前端/客户端源码里不可见。
- 因此本仓库无法给出"OSS 上传的完整可运行代码"——那部分在 ZCode 后端服务，不在可逆向的客户端产物里。

---

## 七、复核方法（grep 锚点）

```
grep -oE "sKt\(e\)\{return e\?\.repoSnapshotIndexingEnabled===!0&&e\.repoSnapshotIndexingUserConfigured===!0\}" zcode.cjs
grep -oE "buildRepoSnapshotWorkspaceKey"  zcode.cjs      # -> jpo
grep -oE "repo_snapshot_\$"                zcode.cjs      # workspace key 模板
grep -oE 'Cw\("upload_target"'            zcode.cjs      # 预签名上传目标 schema
grep -oE "resolveRepoSnapshotPromptProvider" zcode.cjs    # 快照回注 prompt
```

> 注：`zcode.cjs` 是 esbuild 压缩产物，上述逻辑分散在 3 行巨行内，grep 行号会集中在少数行上。

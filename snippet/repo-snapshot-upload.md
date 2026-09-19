# ZCode 仓库快照上传机制 —— 源码摘录（repo snapshot upload）

> 来源：F:\Program Files\ZCode\resources\glm\zcode.cjs（3583 行 esbuild 压缩，变量名混淆）。
> 以下为 grep 可复核的原文片段（变量名是 esbuild 混淆名，非原始 TS 名）。
> 本片段是"机制骨架"，非完整可运行源码——完整逻辑分散在 3 行压缩巨行里，无法干净截取。

## ① 双开关 AND 门（默认关）——上传的唯一触发闸

混淆函数 `sKt`（原始名 `isRepoSnapshotIndexingSwitchChecked`）：
```js
function sKt(e){return e?.repoSnapshotIndexingEnabled===!0&&e.repoSnapshotIndexingUserConfigured===!0}
```
语义：仅当 **两个** 条件同时为 true 才启用仓库快照索引/上传：
- `repoSnapshotIndexingEnabled === true`（功能开关，`default(false)`）
- `repoSnapshotIndexingUserConfigured === true`（用户显式配置过）
→ 出厂默认全 false，**不采集、不上传**；须用户显式 opt-in。

## ② 仓库快照 schema 族（加密制品体系）—— REPO_SNAPSHOT_* 导出

混淆常量工厂 `Cw(name, version)` 生成各 schema key，`L3="v2"` / `SXe="v1"`：
```js
L3 = "v2", Zrr = "v1", SXe = "v1";
Cpo = Cw("manifest", L3)                       // manifest v2
Epo = Cw("prompt", L3)
Apo = Cw("delta", L3)                          // 增量 delta
Rpo = Cw("extra_manifest", "v1")
Ppo = Cw("extra_delta", "v1")
Opo = Cw("encrypted_artifact", L3)             // 加密制品体（上传的就是这个，非明文）
Mpo = Cw("encryption_aad", L3)                // 加密认证数据(AAD)
Dpo = Cw("manifest_hash", Zrr)                 // 防篡改 SHA 哈希
Npo = Cw("upload_key", SXe)                    // 预签名上传 key
$po = Cw("upload_target", SXe)                 // 预签名上传目标(=你问的 OSS/对象存储)
```
上传目标 `$po`(upload_target) 与 `Npo`(upload_key) 是**运行时下发的预签名对**，静态源码里看不到具体桶域名。

## ③ 快照 workspace key 构造 —— 按仓库维度命名

混淆函数 `jpo`（原始名 `buildRepoSnapshotWorkspaceKey`）：
```js
return `repo_snapshot_${e}/${t}`   // e=owner, t=repo/instance id
```
上传对象按 `repo_snapshot_<owner>/<id>` 组织，针对具体仓库而非全机扫描。

## ④ 默认值（引擎层 boolean default 统计）
```
.default(!0)  17 处   // 默认开
.default(!1)  19 处   // 默认关（占多）
```
仓库快照属"默认关"族——印证隐私优先设计。

## 复核方法
grep -oE "sKt\(e\)\{return e\?\.repoSnapshotIndexingEnabled" zcode.cjs
grep -oE "Cw\(\"upload_target\"" zcode.cjs
grep -oE "repo_snapshot_" zcode.cjs

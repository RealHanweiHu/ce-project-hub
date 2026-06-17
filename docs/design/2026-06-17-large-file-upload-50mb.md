# 设计文件上传放宽至 50MB 改造方案

> **For agentic workers:** 用 superpowers:subagent-driven-development 或 executing-plans 按任务执行。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 让用户能上传单个 ≤ 50MB 的设计文件（CAD/BIM/PDF 图纸），同时不引入内存 OOM、不被 nginx 静默 413。

**Background:** 当前上传上限硬编码为 16MB，且在**客户端、服务端两处**重复定义；下载走服务端穿透代理。详见现状勘察结论（本文「现状」节）。

**结论先行：50MB 量级无需重构架构。** 维持现有「私有 MinIO 桶 + `/storage/*` 服务端流式代理」不变，**不转 OSS、不上 presigned 直传**。改造仅为抬高限制 + 一处内存硬化 + 一处外部 nginx 配置确认。

**Tech Stack:** TypeScript、Express、multer、React、MinIO（S3 兼容）。

---

## 现状（勘察结论）

| 位置 | 现状 | 文件 |
|---|---|---|
| 服务端上限 | `MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024` | `server/routers/files.ts:139` |
| 服务端缓冲 | `multer.memoryStorage()`（整文件进内存） | `server/routers/files.ts:142` |
| 服务端错误返回 | `LIMIT_FILE_SIZE` → 413，消息含 `max 16 MB` | `server/routers/files.ts:255` |
| 客户端上限 | `MAX_FILE_SIZE = 16 * 1024 * 1024` | `client/src/components/views/ProjectDetailView.tsx:41` |
| 下载链路 | `obj.body.pipe(res)` 流式转发（**内存 OK，无需改**） | `server/_core/storageProxy.ts` |
| express body limit | `json`/`urlencoded` 限 `50mb`——**不影响 multipart 上传**，无需改 | `server/_core/index.ts:49` |
| 反代 nginx | ERP 的 nginx 反代到 `127.0.0.1:3001`，`client_max_body_size` 在**本仓库外** | DEPLOY.md / scripts/deploy-ecs.sh |

**容量评估**：ECS `/dev/vda3` 79G、可用 57G。按 50MB/个算，纯文件可存 ~1100 个，短期不构成瓶颈（2026-06-17 实测桶内仅 2 文件 / 46KB）。

**内存评估**：50MB 进内存，单次可接受；并发 N 次 = 50MB×N。内部工具并发低，`memoryStorage` 仍可用，但建议借此机会换 `diskStorage` 做硬化（见 Task 2，可选）。

---

## 文件结构（修改一览）

- Modify `server/routers/files.ts` — `MAX_FILE_SIZE_BYTES` 16→50MB。
- Modify `client/src/components/views/ProjectDetailView.tsx` — `MAX_FILE_SIZE` 16→50MB + 前端提示文案。
- （可选）Modify `server/routers/files.ts` — `memoryStorage` → `diskStorage`，上传后流式推存储并清理临时文件。
- **External（非代码）** — 确认/调高 ERP nginx 的 `client_max_body_size ≥ 50m`。

**判定口径（务必一致）：客户端与服务端的字节阈值必须相等**，否则要么前端放行后端拒（坏体验），要么前端误拦。

---

## Task 1: 抬高客户端 + 服务端上限到 50MB

**Files:**
- Modify: `server/routers/files.ts:139`
- Modify: `client/src/components/views/ProjectDetailView.tsx:41`（及其错误提示文案）

- [ ] **Step 1:** 服务端 `const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;`。错误消息复用 `MAX_FILE_SIZE_BYTES / 1024 / 1024`，自动变 50，无需手改字符串。
- [ ] **Step 2:** 客户端 `const MAX_FILE_SIZE = 50 * 1024 * 1024;`，同步更新任何写死「16MB」的提示文案。
- [ ] **Step 3:** 验证：传一个 ~40MB 文件成功落桶 + DB 有记录 + `/storage/{key}` 能下回；传一个 >50MB 文件，前端拦截 + 即使绕过前端、后端也返回 413。

## Task 2（可选硬化）: memoryStorage → diskStorage

> 仅当担心并发上传内存峰值时做。50MB + 低并发场景下，Task 1 已足够；此任务为稳健性加分。

**Files:**
- Modify: `server/routers/files.ts:141-144`（multer 配置）+ 上传处理函数（`file.buffer` → `file.path` 读流）

- [ ] **Step 1:** multer 改 `multer.diskStorage({ destination: os.tmpdir() })`，保留 `limits.fileSize`。
- [ ] **Step 2:** 上传处理里把 `storagePut(storageKey, file.buffer, ...)` 改为读 `file.path` 的流/buffer 推送；`storagePut` 已支持 `Buffer | Uint8Array | string`，若改传流需扩展其签名。
- [ ] **Step 3:** `finally` 中 `fs.unlink(file.path)` 清理临时文件（含失败路径），避免临时盘堆积。
- [ ] **Step 4:** 验证：上传后 `os.tmpdir()` 无残留；内存峰值不随文件大小线性涨。

## Task 3（外部配置）: nginx client_max_body_size

> **这是最容易踩的静默坑**：nginx 默认 `client_max_body_size 1m`，超限直接返回 413，**且不进 app 日志**，表现为「大文件传到一半失败、后端无错」。当前 16MB 能传成功，说明已配过 ≥16m，但升到 50MB 可能再次撞顶。

- [ ] **Step 1:** 在 ERP nginx 对应 `server`/`location` 块确认 `client_max_body_size 50m;`（建议留余量设 `64m`）。
- [ ] **Step 2:** `nginx -t && nginx -s reload`。
- [ ] **Step 3:** 经**线上域名**（非 `localhost:3001` 直连）传一个 ~45MB 文件验证，确保 nginx 这层放行。

---

## 不做什么（明确边界）

- **不转 OSS** — 57G 容量充裕，50MB 不触发自建存储的运维痛点（备份/带宽/扩容）。OSS 留待文件量级或可用性要求显著上升时再议。
- **不上 presigned 直传 / 签名下载** — 那是 500MB+ 大文件场景的架构，50MB 用现有穿透代理足矣，避免过度工程。
- **不加 Range / 断点续传** — 50MB 单次下载秒级完成，无需分段。

## 后续触发条件（何时回头重构）

若出现以下任一，再启动 presigned 直传 + OSS 的重构（参见对话记录中的「正确修法」四级表）：
- 单文件量级升到 500MB+（如完整 BIM 模型）。
- 上传并发上来，app 内存/带宽成瓶颈。
- 文件总量逼近 ECS 磁盘，或备份 `miniodata` 卷的时间/空间成本变高。

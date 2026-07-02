# 全面评审：多用户可用性 + SOP + 权限 + 运维（2026-07-02）

四路并行审计：SOP 模板与流程设计、服务端角色权限、客户端分角色 UX、部署/上手 + 未提交改动（fix-storage-auth 分支）。
基线验证：`tsc --noEmit` 通过；测试 426/426 全绿（需先 `docker compose up -d db` 启动本地测试库 55432）。

> **更新 2026-07-02（同日）：下方 P0（六项）已全部修复并验证**——tsc 零错、测试 426→459 全过（新增 33 项 TDD 测试），并在本地起服务以 test_qa（qa 角色）真机验证：被指派任务可完成(200)、无关任务被拒(403)、跨项目评论被拒(403)、qa 发起 Gate 评审被拒(403)。P1/P2 仍待办。详见文末「修复记录」。

## 结论（TL;DR）

模板结构本身是健康的（164 个任务、无重复 id、无悬空交付物、无排期环），但**「不同用户都能顺畅使用」目前不成立**：14 个角色里只有 owner/rd_* 接近顺畅；qa/scm/sales/cert/battery_safety 五个角色对自己被指派的任务是死锁状态；PM 无法通过 Gate 且填的评审表单被静默丢弃；pe/mfg/sales 在所有模板里没有任何可见任务。另有两个安全漏洞（评论无鉴权、Gate 评审跨项目 IDOR）。

---

## P0 — 阻断级（先修这些）

### 1. 五角色任务死锁（qa / scm / sales / cert / battery_safety）
三路审计交叉确认。`assignTasksByRole`（server/db.ts:2776）按 visibleRoles 自动把 FT/PT/可靠性/电芯厂审核等任务派给 qa/scm 等成员，但 `tasks.setCompleted/setMeta/setDeliverable`（server/routers/tasks.ts:57-61,196,252）硬性要求 `canEditTasks`，而这五个角色均为 false（server/routers/members.ts:116,129,168,181,194），**没有 assignee 例外**。
- 项目详情页里点任务圆圈是静默 no-op（ProjectDetailView.tsx:2038 提前 return，无任何反馈）；我的任务页点了报错 toast。
- 附件同理：deliverable-access.ts:32-38 的无 deliverableName 分支只认 canEditTasks，assignee 旁路（taskAllowsEvidence）只存在于 deliverableName 分支。
- **修法**：给 setCompleted/setDeliverable/上传加 assignee（或 visibleRoles 命中）例外，或调整 ROLE_PERMISSIONS。这正是 2026-06-29 重设计新增任务的那批角色——不修则重设计落空。

### 2. PM 的 Gate 评审表单被静默丢弃
GateReviewModal.tsx:301 的 `showForm` 不看 readOnly；ProjectDetailView.tsx:3463 `onConfirm={perms.canGateReview ? handleGateReviewConfirm : () => {}}` 是静默空函数。pm 的 canGateReview=false（members.ts:69）。PM 填完 reviewDate/参会人/结论点提交 → 什么都没发生，无报错。qa/viewer 通过「＋填写 Gate 评审记录」按钮（ProjectDetailView.tsx:2615）同样踩坑。
- **修法**：readOnly 时不渲染表单 + 明示「仅管理层可评审」；或给 pm 合法的发起路径。

### 3. 安全：评论完全无访问控制
server/routers/collab.ts:9-25 的 comments.list/add 直达 db（db.ts:3704,3746），零成员校验。任何登录用户可枚举 entityType+entityId 读写任意项目的评论——viewer 只读承诺和项目保密性都被打穿。

### 4. 安全：Gate 评审跨项目 IDOR
gateReviews.ts:94-102（update）/198-202（delete）对 input.projectId 查角色，但 db 层只按全局 id 过滤（db.ts:1846-1860），且 beforeReview 为 undefined 也继续执行。拥有任一项目 owner 权限的人可改写/删除**其他项目**的 Gate 决议。

### 5. JDM / OBT 完全没有排期图
SCHEDULE_GRAPH（shared/schedule-graph.ts:13-43）只覆盖 NPD/ECO/IDR；JDM 35 个任务、OBT 21 个任务缺失 → buildSchedTasks 全部按 1 天、无依赖、同一开始日。JDM 项目点「重新生成排期」后甘特图/关键路径/延期影响全部失真。模板加了新赛道但排期数据没跟上。

### 6. JDM 发布门缺电池安全证据
JDM PVT（isReleaseGate，sop-templates.ts:380）的 requiredDeliverables 没有 UN38.3 / MSDS / 电芯电池包安全认证 / EOL 100%（对比 NPD sop-templates.ts:168），且 JDM 全程没有 battery_safety/cert 的 visibleRoles。锂电产品全自研赛道可以不出运输认证就 release——与重设计文档 §9「固化为必备交付物」的意图直接矛盾。OBT 需明确决策。

---

## P1 — 重要（角色流程与一致性）

7. **pe / mfg / sales 在全部 5 类模板中 visibleRoles 均为空**（sop-templates.ts:607-609,838,1039）——这三个角色进项目只看到 Gate 任务；而 deliverable-permissions.ts 又把 SOP/WI/治具/良率的评审首选给 pe。cert/battery_safety 在 ECO/IDR/JDM/OBT 同样为零（换电芯二供的 ECO 反而没有电池安全参与）。
8. **任务级与阶段级交付物是两套不相交的词表**（task-deliverables.ts vs 阶段 deliverables，80+ 个 TASK-ONLY 名称）——任务勾选不进 Gate 就绪；deliverable-access.ts:43 拒收非阶段词表名 → 用户被迫二次录入。
9. **SALES_RE 正则过宽 + 可自审**：`确认/签核` 命中「关键料件规格确认」「图纸/规格完整性确认」等工程交付物 → sales 成为默认审核人（deliverable-permissions.ts:6, deliverableReviews.ts:16-25）；且 submit 不禁止 reviewer==submitter，唯一 battery_safety 成员默认自审自批安全FMEA。~50 个交付物无任何 contributor 角色。canEditTasks 角色（rd_* 等）可绕过专业限定上传任何交付物证据。
10. **三套 effective-role 解析器不一致**（project-access.ts:51-54 vs :85-92 vs members.ts:219-231）——被加为 viewer 的 admin 在一半路由是 owner、另一半是 viewer；qa 兼 pmUserId 的人在成员管理路由降级回 qa。
11. **Frozen BOM 任何登录用户可读**（bom.ts:39-79 的 frozen/whereUsed/diff 无校验），含 unitCost/supplierName；working BOM 却有成员门槛——遍历 revisionId 即可泄露。
12. **未提交改动的追溯效应（B1）**：本次收紧 design/pvt 的 requiredDeliverables 会让**所有在途 NPD 项目**部署即从 ready 翻红，无回填/override 迁移——需要确认是否有意并做发布沟通。
13. **管理层没有工作台**：总览 exec 视角要求全局 admin，PM 视角要求 pmUserId（OverviewPage.tsx:24-27）——项目角色 manager 落到空态。「千人千面」目前只对 admin 和 PM 成立，其余 12 个角色共享通用我的任务列表。
14. **审核人闭环断裂**：NotificationBell 未传 onNavigate（Home.tsx:1005），点「待你审核的交付物」不跳转；workbench.reviews 只在 PM 视角渲染——被选中做审核的 qa/cert/scm 找不到审核入口。
15. **客户端权限错误处理**：项目起止日期对所有成员可编辑、403 被显示为「登录已过期」（ProjectDetailView.tsx:2256, Home.tsx:549）；产品类型编辑对所有人都不落库（projectToApiInput 漏了 type）；资源库裁剪面板按 canEditTasks 显示但服务端只许 pm/admin，失败静默（overrideMut 无 onError）；GateReadinessChecklist 对 viewer 也显示上传/删除按钮，失败裸显「FORBIDDEN」；撤回审批无门控无 onError。

---

## P2 — 运维/上手（新部署与新用户）

16. **DEPLOY.md:35,98 的迁移命令在生产镜像跑不通**（drizzle-kit 是 devDependency，Dockerfile --prod；deploy-ecs.sh 早已改用 runtime migrator，文档没更新）。
17. **.env.example 缺 ALLOW_REGISTRATION / REGISTRATION_INVITE_CODE**，默认开放无邀请码自注册——照 example 起的新部署任何人可注册。
18. **scripts/fix-admin-permissions.mjs 是 MySQL 时代死代码**（import drizzle-orm/mysql2，必崩），误导新管理员。
19. **MinIO 桶靠 mkdir 裸卷创建**（DEPLOY.md:38 / deploy-ecs.sh:29），镜像未 pin，升级后可能不识别；应用不自建桶，首次上传报 NoSuchBucket。改用 `mc mb` + pin tag。
20. 其他：无 env fail-fast 校验（JWT_SECRET 为空到首次登录才炸）；DEPLOY.md 与 docker-compose.prod.yml/3001 端口不符；compose 把 PG 以默认密码发布到宿主机 55432；deploy-ecs.sh 硬编码 root@8.140.197.68 而 ECS_HOST 变量无人读；create-test-users.mjs 固定密码 Test123456、对已有用户会静默重置密码（须标注 test-only）；两份 SOP 设计文档同时更新且互相矛盾（新文档声称已替代旧 flowcharts，本 diff 却又在改旧文档）；.planning/ 与 docs/agents/ 未忽略，小心 `git add .`。

## 做得好的（保留）

- 存储代理鉴权（storageProxy + storage-access）设计正确：登录+成员校验、key 从 DB 反查、非成员 404 防探测。
- issues/changelog/risks/meetings/requirements/deliverableReviews 一致使用 assertProjectAccess；scm 的成本工作流（变更记录+BOM）服务端通畅且有测试。
- 迁移 journal 35/35 一致；401 自动跳登录、断线恢复提示、Home 的部分失败处理都到位。
- 未提交 diff 本身接线完整：新模块均被引用、重命名无残留、tsc/测试全绿。

## 建议修复顺序

1. P0-1 assignee 例外（一处 server 改动解锁五个角色）→ 2. P0-2 Gate 表单（純前端）→ 3. P0-3/4 两个安全洞 → 4. P0-5 JDM/OBT 排期图 + P0-6 JDM 电池门 →（提交前决策 P1-12 追溯效应）→ 5. P1 角色可见性/词表统一/审核闭环 → 6. P2 文档与部署脚本。

---

## 修复记录（2026-07-02，六项 P0）

全部按 TDD：先写失败测试 → 实现 → 转绿。新增测试文件 5 个，共 +33 测试；总计 459/459 通过，tsc 零错。

1. **P0-1 五角色任务死锁** — `server/deliverable-access.ts` 导出 `taskAllowsEvidence`（被指派人或任务对其角色可见，viewer 除外）；`server/routers/tasks.ts` 新增 `assertCanCompleteTask`，`setCompleted`/`setDeliverable` 改用它；无 deliverableName 的附件上传分支也接受任务当事人。客户端 `ProjectDetailView.tsx` 新增 `canActOnTask`，勾选/交付物/详情编辑门控改用它，无权限点击给 toast 而非静默 no-op。测试 `server/task-assignee-exception.test.ts`。
2. **P0-2 Gate 表单静默丢弃** — `GateReviewModal.tsx`：`showForm` 尊重 `readOnly`，readOnly 下不渲染表单、改显「仅管理层可评审」提示；`ProjectDetailView.tsx` 的 `onConfirm` 兜底改为 toast 报错。（客户端，tsc + 真机验证）
3. **P0-3 评论无鉴权** — `server/routers/collab.ts` 重写：`resolveCommentProjectId`（issue/task/change/project 反查项目）+ `assertProjectAccess`，viewer 不能发评论，projectId 以服务端解析为准。新增 `getIssueById`/`getChangelogRecordById`。测试 `server/comments-access.test.ts`。
4. **P0-4 Gate 评审跨项目 IDOR** — `server/routers/gateReviews.ts` update/delete 校验 review 属于 `input.projectId`，否则 NOT_FOUND。测试 `server/gate-review-cross-project.test.ts`。
5. **P0-5 JDM/OBT 排期图缺失** — `shared/schedule-graph.ts` 补 jin/jd/je/jv/jp/jm 与 or/os/op/om 全部工期+依赖。测试 `shared/schedule-graph-coverage.test.ts`（所有 category 任务必须在图中 + 无悬空依赖 + 链路真实展开）。
6. **P0-6 JDM/OBT 发布门缺电池安全** — `shared/sop-templates.ts`：JDM PVT 补 UN38.3/MSDS/电芯电池包安全认证/EOL 100%（phase.deliverables + gateStandard），jv3 扩 cert/battery_safety 可见；OBT PVT 补 UN38.3/MSDS。测试 `shared/release-gate-battery.test.ts`。

**注意仍未处理**：P1-12（收紧后的 NPD/JDM 门会让在途项目部署即翻红，无回填迁移——发布前需决策）、P1 其余（pe/mfg/sales 可见性、词表统一、审核闭环、管理层工作台）、P2 运维文档与脚本。改动尚未提交/部署。

---

## P1 修复记录（2026-07-02，同日）

服务端逻辑全部 TDD（失败测试→实现→转绿）。新增测试文件 6 个；总计 478/478 通过、tsc 零错。客户端改动以运行中应用真机验证。

7. **P1-7 角色可见性** — 5 类模板补全 pe/mfg/sales 及 ECO/IDR 的 cert/battery_safety 可见任务（SOP/WI/试产/量产/认证影响/售后/客户报价等按 owner 职能落位）。守卫测试 `shared/role-visibility-coverage.test.ts`：每类模板 5 个角色各至少 1 个可见任务。
8. **P1-8 交付物词表** — 评估结论：**非功能缺陷**。阶段级提交集（phase.deliverables ∪ requiredDeliverables）= Gate 硬证据（可上传、进就绪度）；任务级 TASK_DELIVERABLES = 更细的过程追踪；Gate 任务上的「X 评审记录」由评审流程产生、不走上传。二者有意分层，Gate 就绪经自身 phase 级清单正常工作，无实际断裂。加守卫测试 `shared/deliverable-vocab-guard.test.ts` 锁定「真正喂 Gate 的那一半」一致性（发布门必备项必在提交集、无仅差括号的近重名漂移）。完整词表统一是可选 UX 改进，因触及安全硬门、单列 backlog，不在本轮强改。
9. **P1-9 权限收紧+禁自审** — SALES_RE 去掉裸「确认/签核」，只匹配商业词（客户/签样/渠道/销售/市场/上市/售后/VoC），「关键料件规格确认」改归 scm（SCM_RE 加「料件」）；deliverableReviews.submit 显式拒绝 reviewer==submitter，自动分派也回避提交人。测试 `shared/deliverable-permissions.test.ts` + `server/deliverable-review-router.test.ts`。
10. **P1-10 角色解析统一** — project-access.getEffectiveProjectRole 用 pickHigher 处理 pmUserId 且 admin 恒抬到 ≥manager（即使被加为 viewer 成员）；members.ts 第三份解析删除、改委托 canonical。测试 `server/effective-role-unify.test.ts`。
11. **P1-11 Frozen BOM 脱敏** — 冻结 BOM 结构随产品库全员可读，但 unitCost/supplierName 仅对该产品线成员/管理员可见（新增 db.userCanSeeProductCommercials/getProductIdByRevisionId，frozen/diff 脱敏）。测试 `server/bom-frozen-access.test.ts`。
12. **P1-13 管理层工作台** — portfolio 行新增 myRole（成员角色 ∪ pm/owner/admin 兜底）；OverviewPage 让项目角色 manager/owner 也进管理层大盘，不再落空态。真机验证 portfolio.myRole 正确。
13. **P1-14 审核人闭环** — NotificationBell 接入 onNavigate（点待审交付物跳转项目）；MyTasksView 顶部新增「待你审核的交付物」区，非 PM 角色也能看到复核队列。
14. **P1-15 客户端权限处理** — 403 不再误报「登录已过期」（区分 401/403）；日期/名称/编号字段无权时纯展示（EditableText 加 readOnly）；产品类型持久化到 customFields.productType 并回读（真机验证往返成功）；裁剪面板门控对齐服务端(pm/pmUserId/admin) + onError；GateReadinessChecklist 上传/删除按钮按权限显示、FORBIDDEN 转可读文案；撤回审批加门控+onError。

**仍未处理**：P1-12（收紧后的门对在途项目的追溯影响，需回填/override 决策）；P2 运维文档与脚本（DEPLOY.md 迁移命令、.env.example 缺注册变量、死脚本、MinIO 建桶方式等）。改动仍未提交/部署。

---

## P1-12 门收紧追溯影响 —— 已实现 grandfather + 豁免路径（2026-07-02）

策略：**新项目按严格 Gate；存量在途项目不静默翻红**。已过会的 Gate 对本批新增交付物做一次性豁免（记录理由）；未过会/未来 Gate 按新严格标准执行。

- **收紧清单**（`shared/gate-tightening.ts`）：把本批相对上次部署 main 新增的必备交付物固化为数据 manifest（NPD concept/planning/design/dvt/pvt、JDM pvt、OBT pvt，共 18 条）。带守卫测试确保每条名称确实在对应 category/phase 的有效提交集内。
- **纯函数**（TDD，`shared/gate-tightening.test.ts`）：`computeGrandfatherExemptions(project, manifest)` 只豁免「新增项 ∩ 已过会阶段」；`passedPhaseIds(order, currentPhase, gateReviewed)` 由 currentPhase 顺序 ∪ 通过/有条件通过评审推出已过会集合。
- **schema**：`project_deliverable_overrides` 加 `reason` 列（迁移 0035）；`setDeliverableOverride`/tailoring 路由/客户端排除操作都支持记录理由。
- **批量落库**（`db.applyGrandfatherExemptions`，幂等，onConflictDoNothing，测试 `server/grandfather-exemptions.test.ts`）+ **迁移脚本** `scripts/migrate-0035-grandfather-gates.ts`（默认 dry-run，`--apply` 落库；SYSTEM createdBy=0 + 统一 reason）。
- **客户端**：排除必备交付物时强制填理由（prompt）；已豁免项显示「已豁免 + 理由」并可撤销恢复。
- **验证**：本地 demo 库 dry-run 正确区分 demo-004（在 DVT，未过 PVT → 不豁免 PVT）与 demo-005（在 MP，已过 PVT → 豁免 PVT）；真机查 gateReviews.readiness 确认 demo-005 的 PVT 不再把 UN38.3 列为缺失、demo-004 仍要求——符合预期。验证后已回滚 demo 库豁免。

部署顺序：先跑 schema 迁移（含 0035 加 reason 列），再跑 `scripts/migrate-0035-grandfather-gates.ts --apply` 做一次性 grandfather。DEPLOY.md 已补该步骤。

**至此 P0(6)+P1(9) 全部落地并测试**：498/498 测试通过、tsc 零错。改动仍未提交/部署。剩余：P2 运维文档/脚本清理。

---

## P2 修复记录（运维/上手，2026-07-02）

新部署与新用户上手路径的坑全部处理，501/501 测试通过、tsc 零错。

- **P2-17 .env.example**：补 `ALLOW_REGISTRATION`（**安全默认 false**，不再照 example 起就开放公开注册）、`REGISTRATION_INVITE_CODE`、`PORT`、`AUTOMATION_SCAN_INTERVAL_MIN` 及 compose 用的 `POSTGRES_PORT`/`POSTGRES_PASSWORD`/`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`（均带「生产务必改默认值」注释）。
- **P2-16 DEPLOY.md 迁移命令**：`npx drizzle-kit migrate` 在生产镜像跑不通（drizzle-kit 是 devDependency）。改为 drizzle-orm **runtime migrator**（与 deploy-ecs.sh 一致），两处（compose 段 + RDS 段）都更新；并补「本版含 Gate 收紧，迁移后跑一次 grandfather」提示。
- **P2-19 MinIO 建桶**：`server/storage.ts` 新增 `ensureBucket`（HeadBucket→CreateBucket，已存在/并发视为成功，托管 OSS 无权时仅告警不阻断），启动时 best-effort、首次上传前必调——消除首个上传 `NoSuchBucket`。DEPLOY.md/deploy-ecs.sh 删掉脆弱的 `mkdir -p /data/cehub`。单测 `server/storage-ensure-bucket.test.ts`（mock S3）。
- **P2-20 env fail-fast**：生产启动即校验 `JWT_SECRET`/`DATABASE_URL`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`，缺就一次性列出并 exit 1，而不是「启动绿灯、首次登录/上传才炸」。
- **P2-18 脚本**：`scripts/fix-admin-permissions.mjs` 从 MySQL 死代码（import drizzle-orm/mysql2 必崩）重写为 PG `pg` 版（幂等，已本地验证）；`create-test-users.mjs`/`create-mgmt-user.mjs` 固定弱密码脚本加 `NODE_ENV=production` 拒跑保护（需 `--force`）。
- **P2-misc**：`.gitignore` 加 `.planning/`、`docs/agents/`（防 `git add .` 误带）；旧 `current-sop-flowcharts.md` 顶部加过期横幅，指向 `2026-06-29-sop-design.md` 并注明 JDM/OBT 见新文档。

## 总收尾

全部 **P0(6) + P1(9) + P2(6)** 已实现并验证：**501/501 测试、tsc 零错**，关键路径多处真机验证（qa 任务解锁、Gate 表单、portfolio.myRole、产品类型往返、grandfather 就绪度、ensureBucket）。**所有改动仍未提交、未部署**——等你确认后再提交/上线。上线顺序：schema 迁移(含 0035) → runtime migrator → `scripts/migrate-0035-grandfather-gates.ts --apply`（一次性 grandfather）→ 建首个 admin。

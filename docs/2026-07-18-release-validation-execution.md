# CE Project Hub 上线验证执行记录（2026-07-18）

> 对应清单：`docs/2026-07-17-release-validation-checklist.md`
>
> 当前结论：`NO-GO`。本记录为进行中结果，不代表全部用例已经执行。

## 1. 候选版本与环境

| 字段 | 本轮值 |
|---|---|
| Commit / 分支 | `10969ee` / `main` |
| 工作区 | 67 项未提交变更；候选版本尚未冻结 |
| tracked diff SHA-256 | `98b66a949d09d753bdbd7d3483382927a39a6c739f4613d2c1ce3e00b1bb9171` |
| status SHA-256 | `2a0501d180aa7bf02e16fb8c7bf767af60ec8be9d7dbcc90eeea93e53c63ce91` |
| Node / pnpm | Node `v25.8.1` / pnpm `11.7.0` |
| OS | macOS `26.5.1`，Darwin arm64 |
| 应用 | `http://127.0.0.1:3000`，开发服务绑定隔离测试库 |
| 数据库 | 本地 Docker PostgreSQL 16；一次性库 `cehub_test_20260718` |
| 已应用迁移 | `80` 条 |
| 浏览器 | Playwright Chromium headless shell，1440×960 |

生产与现有本地开发库未作为测试目标。所有写入型命令显式绑定 `cehub_test_20260718`。

## 2. 构建与自动化门禁

| ID | 状态 | 实际结果 | 证据 / 后续 |
|---|---|---|---|
| CODE-01 | 通过 | `.env` 原指向本地 `cehub`，未直接使用；新建并显式使用带 `test` 标识的一次性隔离库 | 测试命令显式设置 `TEST_DATABASE_URL=.../cehub_test_20260718` |
| CODE-02 | 通过 | `pnpm check` 退出码 0 | TypeScript 无错误 |
| CODE-03 | 失败 | 全量测试：213 个文件中 207 通过、6 失败；1161 项中 1148 通过、9 失败、4 跳过；另有 2 个 suite setup 失败 | 隔离复跑 6 个失败文件后保持相同结果；见 BUG-001～004 |
| CODE-04 | 通过（有观察） | `pnpm build` 成功；Vite 2716 modules，服务端 bundle 成功 | 存在 >700kB chunk warning；`ProjectDetailView` 约 896kB，需进入性能/拆包评估 |
| CODE-05 | 阻塞 | `git diff --check` 通过，但工作区有 67 项未提交变更，候选范围不可稳定复现 | 冻结 Commit 或批准并归档完整 diff 后重跑 |
| CODE-06 | 进行中 | 空库成功应用 80 条迁移；再次执行 `drizzle-kit migrate` 成功且迁移记录仍为 80；schema integrity 测试通过 | 空库与二次 no-op 已通过；尚需存量脱敏快照升级和完整 schema 对账 |

## 3. 浏览器主路径

| ID / 子项 | 状态 | 实际结果 | 证据 / 缺陷 |
|---|---|---|---|
| SMK-01 / 普通用户错误密码 | 通过 | 保持在登录页并显示“用户名或密码错误”；401 仅来自预期登录失败请求 | 无账号存在性泄露 |
| SMK-01 / 普通用户登录 | 通过 | 登录后进入 Overview；首页、项目数据和同步状态正常；无非预期 4xx/5xx 或 Console error | `output/playwright/smk-01-login-overview.png` |
| SMK-01 / 刷新保持会话 | 通过 | 刷新后仍为已登录状态并加载管理层总览 | 同一浏览器上下文验证 |
| SMK-01 / 退出与受保护页 | 通过 | 点击退出后会话失效；直接访问项目深链只显示登录门禁 | 页面保留原 URL，没有自动跳转 `/login`，不影响访问控制结论 |
| SMK-01 / owner | 通过 | 独立 owner 账号登录、刷新、账户角色“拥有者”、系统管理入口、退出与受保护深链均符合预期 | `output/playwright/smk-01-owner-account.png`；无非预期 4xx/5xx 或 Console error |
| 项目深链 | 通过 | `/?view=projects&projectId=qa-login-project` 精确打开目标项目，数据与 seed 一致 | `output/playwright/smk-project-detail.png` |
| 任务列表与详情 | 通过（有观察） | 任务页加载 53 项任务；点击“市场调研与竞品分析”后详情覆盖层打开，负责人、截止日、状态、职责和交付物可见 | `output/playwright/smk-task-list.png`、`output/playwright/smk-task-after-click.png`；见 BUG-006 |
| SMK-02 / owner 管理入口 | 通过 | owner 访问 `/admin`，用户、权限、钉钉配置、自动化和工作日历正常加载；跨项目深链可访问 | `output/playwright/smk-02-owner-admin.png`、`output/playwright/smk-02-owner-cross-project.png` |
| SMK-02 / member 管理入口 | 失败 | 普通 member 访问 `/admin` 后被重定向到首页，API 正确拒绝且未泄露管理数据；但出现 React render 警告和多次权限错误 | `output/playwright/smk-02-member-admin.png`；见 BUG-007 |
| SMK-02 / member 跨项目深链 | 失败 | 服务端连续返回 403 且未泄露项目数据，但等待 5 秒后页面仍停在“加载项目详情...”，无友好 403/404 或恢复路径 | `output/playwright/smk-02-member-cross-project.png`；见 BUG-008 |
| SMK-02 / external、viewer 与完整项目角色 | 未测 | 尚未建立完整账号/角色矩阵 | 后续继续执行；父用例保持进行中/失败 |

## 4. 当前缺陷与阻塞项

| 缺陷 ID | 建议等级 | 现象 | 影响 |
|---|---|---|---|
| BUG-001 | P0 | Release 自动化存在 1 个失败测试与 2 个 suite setup 外键失败：`releasedBy/createdBy` 引用不存在用户 | Release 门禁无法证明通过；需先区分产品逻辑与测试夹具回归 |
| BUG-002 | P1 | health digest / personal daily digest 共 6 个稳定失败，站内通知未产生或报告“没有渠道实际送达” | 摘要通知可能不发、错误标记或测试契约已与实现漂移 |
| BUG-003 | P1 | `project-delete-quiesce-cas.test.ts` 稳定抛出“已有删除操作正在进行” | 删除并发租约恢复路径未通过 |
| BUG-004 | P1 | automation engine 删除竞态用例期望 4 次 active 检查，实际 5 次 | 行为或测试契约发生变化，需确认是否仅冗余调用还是时序回归 |
| BUG-005 | P2 | 仓库登录验证器仍查找旧文案“项目管理”和“任务详情”，当前 UI 已改为图标导航与“详情已打开” | QA 自动化工具产生假失败，需更新定位与断言 |
| BUG-006 | P1 | 任务详情视觉上是模态覆盖层，但可访问性树中 `role=dialog` 数量为 0 | 键盘/读屏无法可靠识别弹窗边界；对应 UX-15 |
| BUG-007 | P1 | 普通 member 直达 `/admin` 会触发 `Cannot update a component while rendering a different component`，并在跳回首页前发起多次无权 API 请求 | 权限最终有效，但无权限体验与 React 状态更新不稳定；对应 AUTH-07/UX-07 |
| BUG-008 | P1 | 普通 member 访问无权项目深链时收到 5 次 403，页面持续停留在“加载项目详情...” | 用户无法区分加载、无权限与不存在，也没有返回/重试路径；对应 SMK-02/UX-02 |

## 5. 当前发布判定

- `NO-GO`：CODE-03 自动化失败且有 4 项跳过。
- `NO-GO`：候选版本尚未冻结，CODE-05 阻塞。
- 浏览器普通用户登录、会话、项目深链和任务详情主路径已取得正向证据，但不能抵消上述门禁失败。

## 6. 下一批执行顺序

1. SMK-02：补 external、viewer 与完整项目角色入口/权限矩阵。
2. SMK-03：NPD 项目创建、Kickoff、阶段/任务/排期持久化。
3. SMK-04：任务审批驳回、返工、重提及并发裁决。
4. CODE-06：存量脱敏快照升级与迁移数据对账。

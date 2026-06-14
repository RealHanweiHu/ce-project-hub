# 钉钉日程 + 视频会议集成 设计文档

- 日期：2026-06-14
- 状态：待你 ① 复核 spec ② 准备钉钉应用凭据 → 再实现
- 关系：替代/升级「自动排期 spec」§6 的轻量周会推送，把周会做成**真钉钉日程（每周循环）+ 视频会议链接**；钉钉未配置时**自动降级**回轻量群推。

## 1. 目标

项目创建后，按该项目的 `meetingConfig`，在**钉钉日历**上建一个**每周循环日程**（覆盖项目周期），日程自带**钉钉视频会议链接**；组织者=项目 PM，参会人=项目成员。每个项目可各自配置时间（见排期 spec 的 meetingConfig）。

## 2. 你必须先准备的前提（外部，我做不了）

1. 钉钉开发者后台建**企业内部应用** → 拿 **AppKey(Client ID) / AppSecret(Client Secret) / CorpId**。
2. 给应用授权：**日历（日程）读写** + **通讯录个人信息读取**（用于按手机号查 userId）。
3. 把三个值给我，放进 `.env.production`（**绝不进 git**）。
4. 团队成员在钉钉通讯录里、且我们系统里登记了**与钉钉一致的手机号**（见 §4）。

未提供凭据时：周会**自动降级**为轻量群推（不阻断、不报错）。

## 3. 关键决策

- **用户→钉钉 userId**：按**手机号**自动反查（钉钉无按邮箱直查的稳定接口）。查到后**缓存**到用户记录，避免每次调用。
- **循环日程**：一条 `RRULE FREQ=WEEKLY` 覆盖 项目开始日→targetDate（无 targetDate 则默认 13 周），优于每周推一条。
- **视频会议**：建日程时开启在线会议（钉钉视频会议），日程自带入会链接。
- **降级**：钉钉未配置 / PM 无法解析 userId / 调用失败 → 回退轻量群推；**绝不阻断建项目**。

## 4. 数据模型（附加式迁移 0011，与排期同批或单独）

- `users` 增：
  - `mobile varchar(32)` —— 成员手机号（管理员/用户填；自动映射的查询键）
  - `dingtalkUserId varchar(64)` —— 反查到的钉钉 userId 缓存
- `projects` 增：
  - `dingtalkEventId varchar(128)` —— 已建日程 id（用于改/删）
  - 注：`meetingConfig` 由排期 spec 定义并新增，本 spec 复用、不重复建列。

## 5. 模块设计

### `server/_core/dingtalk.ts` — 凭据与 token
- `getAccessToken()`：`POST https://api.dingtalk.com/v1.0/oauth2/accessToken`（AppKey+AppSecret）→ token（~7200s）；进程内缓存 + 过期前刷新。
- 未配 AppKey → 返回 null（上层据此降级）。

### 用户映射
- `resolveDingtalkUserId(user)`：有缓存 `dingtalkUserId` → 用；否则有 `mobile` → 调通讯录 `user/getbymobile`（access_token）→ 拿 userId → **回写缓存**；都没有 → null。

### `server/_core/dingtalkCalendar.ts` — 日程
- `upsertWeeklyMeeting(project, pmUserId, attendeeUserIds, config)`：
  - 组织者日历建/改循环日程：`POST/PUT https://api.dingtalk.com/v1.0/calendar/users/{pmUserId}/calendars/primary/events`（header `x-acs-dingtalk-access-token`）。
  - body：summary=config.title；首次 start/end 由 config.weekday+time+durationMin 推算；`recurrence` 周循环至 targetDate；`attendees`=参会人 userId；开启在线会议（视频会议）。
  - 返回 eventId → 存 `project.dingtalkEventId`。
- `cancelMeeting(project)`：`DELETE …/events/{eventId}`（项目归档/关周会时）。
- 注：钉钉 OpenAPI 具体字段名（recurrence/online meeting 结构）实现时对照官方文档核定；本 spec 定到接口与流程层。

### 接入点
- **建项目**后：若 `meetingConfig.enabled` 且 token 可用且 PM 有 userId → `upsertWeeklyMeeting`；否则降级群推 / 跳过。
- **改 meetingConfig**（周会编辑器保存）→ 有 eventId 则更新、无则新建。
- **关周会 / 归档项目** → cancelMeeting。

## 6. 降级与错误处理

- 所有钉钉调用包 try/catch：失败 → warn + 落 `automation_runs`(status=error) + **回退轻量群推**，不阻断主流程。
- token 过期/401 → 刷新重试一次。
- PM 或全部参会人都解析不到 userId → 退化为「仅群推 + 文字提醒」。

## 7. 配置

- env：`DINGTALK_APP_KEY`、`DINGTALK_APP_SECRET`、`DINGTALK_CORP_ID`（生产 `.env`，gitignore）。
- 复用现有 `NOTIFY_WEBHOOK_*`（降级群推用）。

## 8. 测试

- 单测（stub fetch，无需真凭据）：token 缓存/刷新；`mobile→userId` 映射（含缓存命中）；RRULE/起止时间构造；降级路径（无 AppKey → 走群推）。
- 真 E2E：需你提供 AppKey/Secret + 一个有手机号的测试成员，我才能在你钉钉里真建一条日程验证（建后会删）。这步**依赖你 provision**。

## 9. 不在本期范围

- 钉钉侧改动反向同步回系统；会议室预定；非每周的复杂周期；多组织。

## 10. 与排期 spec 的衔接

- 排期 spec §6 的「轻量群推」保留为**降级兜底**；本 spec 在钉钉已配置时接管为真日程。
- meetingConfig（每项目独立、PM 可编辑）两份 spec 共用同一字段。

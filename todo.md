# CE Project Hub TODO

## 已完成功能

- [x] 完整 UI 框架：左侧固定导航 + 主内容区，stone/amber 色系，Playfair Display + JetBrains Mono 字体
- [x] 四大视图：仪表盘、项目管理、SOP 流程库、备份与恢复
- [x] 三类项目 SOP 模板：NPD（P1-P7）、ECO（5阶段）、IDR（4阶段），新建项目三步向导
- [x] 甘特图视图：可双击编辑阶段日期，自动保存
- [x] Gate 评审前置锁定：Gate 未通过则后续阶段任务锁定
- [x] Gate 评审历史记录：支持多轮重审，时间轴展示
- [x] 问题追踪（Issue List）：P0-P3 等级、8类类别、5种状态
- [x] 仪表盘 P0/P1 告警卡片
- [x] 变更记录（Change Log / ECR）：9种类型，记录拍板人、成本/进度影响
- [x] 全局搜索（Ctrl+K）：搜索项目/任务/问题/SOP
- [x] 项目模板克隆
- [x] 数据导出/导入备份：JSON 文件备份与恢复
- [x] 后端框架升级：tRPC + MySQL + Manus Auth 全栈模板
- [x] 数据库 Schema：projects 表已推送到远程数据库
- [x] 后端 API 路由：projects.ts（list/create/update/delete/bulkImport）
- [x] 前端 Home.tsx：使用 tRPC API 替代 localStorage，添加登录认证流程
- [x] 修复 storageProxy.ts TypeScript 类型错误（req.params[0] → req.path）
- [x] 修复 rowToProject 字段映射（projectNumber → code，补充 type 字段）
- [x] TypeScript 零错误（pnpm check 通过）

## 团队协作权限功能（已完成）

- [x] 设计职位角色体系（owner/manager/pm/rd_hw/rd_sw/rd_mech/qa/scm/viewer）
- [x] 扩展数据库 Schema：project_members 表（projectId, userId, role, jobTitle, invitedAt）
- [x] 推送数据库迁移（pnpm db:push）
- [x] 后端 tRPC members 路由：invite/list/myRole/updateRole/remove
- [x] 前端项目详情页「成员」标签页：成员列表、邀请弹窗、角色修改、权限说明表
- [x] 权限钉子 useProjectPermission：根据当前用户角色返回 canEdit/canManage/canGateReview 等
- [x] 各视图应用权限控制：只读用户隐藏编辑按鈕，viewer 无法修改任务状态
- [x] 项目列表显示共享项目（合并自己创建 + 作为成员加入的项目）
- [x] 后端权限校验：project.get/update/delete 根据角色矩阵授权

## 甘特图权限控制（已完成）

- [x] 读取 GanttView 组件，了解拖拽/编辑交互结构
- [x] 为 GanttView 添加 readOnly prop，禁用双击编辑/日期修改面板
- [x] 在 ProjectDetailView 中根据 canEditProjectInfo 传入 readOnly prop
- [x] 只读时显示角色权限提示（"仅 Owner / 管理层 / PM 可修改阶段日期"）

## 项目创建权限 + 任务岗位可见性（已完成）

- [x] 数据库 user 表添加 canCreateProject 字段（默认 false，admin/owner 可授权）
- [x] SOP 任务数据结构添加 visibleRoles 字段（空数组=所有人可见）
- [x] 后端 projects.create 接口校验用户 canCreateProject 权限
- [x] 后端新增 auth.me 返回 canCreateProject 标志
- [x] 前端项目列表：无权限用户隐藏「新建项目」按鈕，显示权限说明
- [x] SOP 任务模板为每个任务配置默认 visibleRoles（按岗位分配）
- [x] 项目详情页任务列表按当前用户角色过滤（仅显示 visibleRoles 包含当前角色的任务）
- [x] 任务编辑支持修改 visibleRoles（暂时跳过，待用户确认需求后实现）

## 成员页权限说明表可见性（已完成）

- [x] 将「权限说明」表格限制为仅 canManage=true 的用户可见（owner/manager/pm）

## 管理员后台页面（已完成）

- [x] 将当前 Owner 账户提升为 admin（通过数据库操作）
- [x] 实现 /admin 路由和管理员后台页面
- [x] 用户列表：显示所有用户的姓名、邮筱、系统角色、canCreateProject 状态
- [x] 角色切换：admin 可将用户提升为 admin 或降级为 user
- [x] canCreateProject 授权：admin 可一键授权/撤销用户的项目创建权限
- [x] 侧边栏添加「系统管理」入口（仅 admin 角色可见）

## 移除备份与恢复页面（已完成）

- [x] 从 Home.tsx 移除 backup View 类型、navItem、handleImportProjects/handleClearAll 和 BackupPanel 渲染
- [x] 删除 BackupPanel.tsx 组件文件，清理所有引用

## 任务可见岗位多选框 + 问题清单权限（已完成）

- [x] 在任务展开面板中添加「可见岗位」多选框（仅 owner/manager/pm 可见并可修改）
- [x] 持久化 visibleRoles 修改到项目数据（project.taskVisibleRoles 字段，覆盖模板默认值）
- [x] 完善 IssueList 关闭/删除权限：仅问题创建者或 canManage 角色可操作
- [x] handleCreate 自动填充 creatorId，实现创建者身份识别

## 认证系统切换：Manus OAuth → 用户名密码（已完成）

- [x] 数据库 users 表添加 passwordHash 和 username 字段，推送迁移
- [x] 安装 bcryptjs，实现密码哈希工具函数 server/_core/password.ts
- [x] 后端新增 auth.login tRPC 接口（用户名+密码）
- [x] 后端新增 auth.createUser tRPC 接口（仅管理员可调用）
- [x] 后端新增 auth.resetPassword tRPC 接口（仅管理员可调用）
- [x] 实现前端登录页面 /login（用户名+密码表单）
- [x] 替换 getLoginUrl() 跳转为内部 /login 路由
- [x] 在管理员后台添加创建用户和重置密码功能
- [x] admin.listUsers 返回 username 字段
- [x] TypeScript 零错误，测试通过

## 架构重构：项目数据拆分为关系型表（已完成）

### Phase 1: 数据库 Schema
- [x] 设计新 Schema：organizations、projects（移除 data 字段）、project_phases、tasks、issues、gate_reviews、changelog
- [x] drizzle/schema.ts 全量重写，清空数据库并推送新 Schema

### Phase 2: 后端重构
- [x] server/db.ts 重写所有查询函数（含 seedProjectPhasesAndTasks）
- [x] server/routers/projects.ts 拆分为细粒度接口（list/get/create/update/delete）
- [x] server/routers/tasks.ts 新建（list/setCompleted/setInstructions/setVisibleRoles）
- [x] server/routers/issues.ts 新建（list/create/update/delete）
- [x] server/routers/gateReviews.ts 新建（list/create/update/delete）
- [x] server/routers/changelog.ts 新建（list/create/update/delete）
- [x] server/routers/phases.ts 新建（list/upsert）
- [x] server/sop-data.ts 服务端 SOP 模板数据（seedProjectPhasesAndTasks 使用）

### Phase 3: 前端重构
- [x] 新建 client/src/hooks/useProjectData.ts：并行查询 tasks/issues/gateReviews/changelog/phases，组装 Project 对象
- [x] Home.tsx 新增 ProjectDetailWrapper 组件：细粒度 diff 写入各 tRPC 路由
- [x] 移除 handleUpdateProject 的整体 update 方式，改为字段级别 diff 写入
- [x] TypeScript 零错误，服务器正常运行

## bulkImport 权限修复 + 注册强制 Email（已完成）

- [x] 分析 bulkImport 接口，确认绕过权限的具体位置（缺少 canCreateProject 校验）
- [x] 后端 bulkImport 添加 canCreateProject 权限校验（与 create 接口保持一致）
- [x] drizzle/schema.ts users 表已有 email 字段，无需迁移
- [x] 后端 auth.register 强制 email 非空（z.email() 格式验证 + 唯一性检查）
- [x] db.createUserWithPassword 添加可选 email 参数
- [x] 后端 auth.createUser 接口添加可选 email 字段（含唯一性检查）
- [x] 前端注册表单添加 Email 必填字段（含前端格式验证）
- [x] 管理员创建用户弹窗添加可选 Email 字段
- [x] TypeScript 零错误

## 用户显示名称强制必填（已完成）

- [x] 后端 auth.register 接口已强制 name 非空（z.string().min(1)）
- [x] 后端 auth.createUser 接口已强制 name 非空（z.string().min(1)）
- [x] 前端注册表单已有「显示名称」必填字段（含前端验证）
- [x] 前端管理员创建用户弹窗已有「显示名称」必填字段（含前端验证）
- [x] PM 下拉选择列表已用 u.name || u.username 优先显示显示名称
- [x] 后端 auth.register 和 auth.createUser 的 name 字段添加 .trim() 防纯空格输入
- [x] 前端注册表单和管理员创建用户弹窗均提交 trim() 后的值
- [x] TypeScript 零错误

## 创建项目功能改进（已完成）

- [x] 产品类型改为预设下拉（汽车充气泵/自行车充气泵/户外充气泵/车载吸尘器/暴力风扇/胎压计/机械式打气筒/组件）
- [x] ProjectDetailView 产品类型编辑选项同步更新
- [x] 后端新增 admin.listUsersForSelect 接口（返回 id+name+username，登录用户均可调用）
- [x] 创建项目向导和克隆弹窗中项目经理改为用户选择下拉（含 loading/error/empty state）
- [x] 甘特图按阶段权重比例分配时间（项目有开始/结束日期时按比例缩放，自定义日期优先）
- [x] TypeScript 零错误

## Manus OAuth 可选登录（已完成）

- [x] 登录页添加分隔线 + "使用 Manus 账号登录" 按鈕
- [x] const.ts 新增 getManusOAuthUrl() 函数，保留现有 getLoginUrl() 指向内部路由
- [x] OAuth 回调后已自动处理（现有 /api/oauth/callback 路由保留）
- [x] 按鈕下方添加提示「Manus 登录在中国大陆可能不可用」
- [x] TypeScript 零错误

## 登录页注册功能（已完成）

- [x] 后端新增 auth.register 公开接口（用户名+密码+显示名，默认 role=user，注册后自动登录）
- [x] 移除 /api/setup 和 /api/setup/status 路由
- [x] 前端登录页添加「登录」/「注册」切换 Tab
- [x] 移除 /setup 路由和 Setup.tsx 页面
- [x] TypeScript 零错误，测试通过

## 初始管理员创建 + 用户自助修改密码（已完成）

- [x] 后端新增 /api/setup 一次性接口：数据库无用户时允许创建管理员
- [x] 后端新增 /api/setup/status 接口：检查是否需要初始化
- [x] 后端新增 auth.changePassword tRPC 接口（登录用户验证旧密码后修改）
- [x] 前端新增 /setup 初始化页面（无用户时显示，已有用户时跳转登录）
- [x] 前端侧边栏用户区域添加「修改密码」按鈕（hover 显示）
- [x] 实现 ChangePasswordDialog 组件（验证旧密码、新密码确认）
- [x] TypeScript 零错误，测试通过

## 中国大陆访问优化（已完成）

- [x] 将 Google Fonts (fonts.googleapis.com) 替换为自托管字体（上传到 /manus-storage/）
- [x] index.html 移除 Google Fonts preconnect + link 标签
- [x] index.css 添加 @font-face 自托管声明（11个字体文件）
- [x] 验证替换后字体显示效果正常，TypeScript 零错误

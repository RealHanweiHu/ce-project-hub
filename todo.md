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
- [ ] 任务编辑支持修改 visibleRoles（仅 owner/manager/pm 可操作）（暂时跳过，需要进一步讨论需求）

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

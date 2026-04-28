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

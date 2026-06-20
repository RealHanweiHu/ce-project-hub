# 交付物 类型+版本 (P1-1) — 设计文档

日期：2026-06-21
状态：已评审，待实现
范围：给上传的项目文件加「类型(fileType)」「版本(fileVersion)」两项元数据，上传时填写、文件卡片与项目文件总览展示。纯增量，不动现有交付物审核(2b)/多版本/就绪度逻辑。backlog「交付物类型+版本 P1-1」（task_plan.md「结构工程师工作台」唯一未完成项）。相关 memory `automation-feature-roadmap`、`migration-mechanism-unified`。

## 目标

`project_files` 已有 `deliverableName`（表达「对应哪个交付物」），但缺「这是什么格式的文件」和「第几版」。本功能补这两项：上传时可选填，文件卡片/总览展示徽标。便于硬件团队区分 图纸/报告/认证 等格式与 T1/Rev.B 等版本。

## 关键设计决策（已确认）

1. **fileType = 固定 9 类枚举**（可空，允许「未分类」）。值集：`图纸 / BOM / 报告 / 规格书 / 测试数据 / 认证文件 / 评审记录 / 变更单 / 其他`。前后端单一来源 `shared/file-types.ts`。
2. **fileVersion = 自由文本标签**（可空，≤32 字符）。不做自增、不与重审/多版本逻辑耦合。
3. **按上传批次填**：一次拖多个文件共用同一组 类型/版本（符合「一次传一类」习惯），非逐文件。
4. **录入入口范围**：仅**任务附件区** `FileUploadArea` 提供 类型/版本 录入。**就绪度清单** `GateReadinessChecklist` 的交付物上传（`uploadFor`）**不**加录入，type/version 默认落 null（快速履约动作，保持清单简洁）。服务端规范化保证缺字段安全落 null。
5. **不**提供「给已上传旧文件补填/编辑 类型/版本」入口（YAGNI）。
6. **不**做按类型筛选/排序（先只展示徽标）。

## 现状（已核对代码）

- `drizzle/schema.ts` `projectFiles`(797-827)：有 `deliverableName varchar(256)` 可空，无 fileType/fileVersion。
- 上传路由 `server/routers/files.ts` `/api/files/upload`(150-)：从 `req.body` 读 `{projectId,phaseId,taskId,deliverableName}` 透传 `createProjectFile`；响应 json(237) 返回 `{id,name,mimeType,size,storageKey,storageUrl,taskId}`（**不含** fileType/fileVersion）。
- `server/db.ts` `getProjectFiles`：`db.select()` 全列 → 新列**自动**带出，无需改。`createProjectFile`(1463) 取 `InsertProjectFile`，新列自动纳入。
- `client/src/lib/data.ts` `FileAttachment`(54)：无 fileType/fileVersion。
- `client/src/hooks/useProjectData.ts`(108-123)：fileRows → FileAttachment 映射，无新字段。
- `client/.../ProjectDetailView.tsx` `FileUploadArea`(160-)：FormData append file/projectId/phaseId/taskId（**不含** deliverableName/type/version）；卡片(258-)显示 name+size。
- `client/.../FilesPanel.tsx` `toAttachment`(38)：FileRow → FileAttachment（项目文件总览），无新字段。
- `client/.../GateReadinessChecklist.tsx` `uploadFor`(33)：deliverable-scoped 上传，append deliverableName。

## 设计

### A. 数据层
- `drizzle/schema.ts` `projectFiles` 加两列：
  - `fileType: varchar("fileType", { length: 64 })`（可空）
  - `fileVersion: varchar("fileVersion", { length: 32 })`（可空）
- 迁移：开发期用 `drizzle-kit generate` 生成迁移 SQL；本地/生产应用用 `pnpm db:push`（= `drizzle-kit generate && drizzle-kit migrate`）；测试由 `scripts/test.mjs` 程序化应用迁移（drizzle programmatic migrator）。三条路径都吃同一份生成的迁移文件（见 `migration-mechanism-unified`）。**迁移单独提交**。
- 新增 `shared/file-types.ts`：
  ```ts
  export const FILE_TYPES = [
    "图纸", "BOM", "报告", "规格书", "测试数据", "认证文件", "评审记录", "变更单", "其他",
  ] as const;
  export type FileType = (typeof FILE_TYPES)[number];
  /** 规范化用户输入的 fileType：非空白且在白名单内才保留，否则 null */
  export function normalizeFileType(raw: string | null | undefined): FileType | null {
    const v = (raw ?? "").trim();
    return (FILE_TYPES as readonly string[]).includes(v) ? (v as FileType) : null;
  }
  /** 规范化 fileVersion：trim → 空串落 null → 截断 32 */
  export function normalizeFileVersion(raw: string | null | undefined): string | null {
    const v = (raw ?? "").trim();
    return v ? v.slice(0, 32) : null;
  }
  ```

### B. 后端
- 上传路由 `/api/files/upload`：
  - 从 `req.body` 多读 `fileType`/`fileVersion`（字符串，可缺）。
  - `const fileType = normalizeFileType(req.body.fileType);` `const fileVersion = normalizeFileVersion(req.body.fileVersion);`
  - 传给 `createProjectFile({ ...,  fileType, fileVersion })`。
  - **响应 json 补回规范化后的** `fileType`、`fileVersion`（前端乐观插卡显示的是干净值，不是用户原始脏输入）。
- `createProjectFile`(db.ts:1463) **改一处**：入库前对 `record.fileType`/`record.fileVersion` 再跑一次 `normalizeFileType`/`normalizeFileVersion` 防御性规范化。理由：白名单不能只挡在 `/api/files/upload` 路由——任何**直接调用** `createProjectFile` 的路径（现在或将来）都不应能写入非法 fileType 或超长 fileVersion。db 层是唯一收口点；路由层规范化只为「响应里返回干净值」。
- `getProjectFiles` 不需手改（select 全列自动带出）；`InsertProjectFile` 自动含新列。
- 校验全部走 `shared/file-types.ts` 的两个 normalize 函数（单一来源，前后端 + 路由/db 同口径）。

### C. 前端
- `FileAttachment`(data.ts:54) 加 `fileType?: string | null;`、`fileVersion?: string | null;`。
- `useProjectData`(108-123) 映射补 `fileType: f.fileType ?? null, fileVersion: f.fileVersion ?? null`。
- `FilesPanel.toAttachment`(38) 同样补这两字段（**否则项目文件总览看不到**）。
- `FileUploadArea`(160-)：
  - 拖拽区上方加一行：「类型」下拉（`<option value="">未分类</option>` + FILE_TYPES）+「版本」文本输入（`maxLength={32}`，占位「如 V1.0 / T1 / Rev.B」）。
  - **`readOnly` 时隐藏（或 disabled）这两个录入控件**——只读任务里不应出现可编辑的元数据控件（与拖拽区现有 readOnly 处理一致）。
  - 组件内 `useState` 持当前批次 selectedType/version；`handleFiles` 里 `formData.append('fileType', selectedType)`、`formData.append('fileVersion', version)`（空串也发，服务端规范化）。
  - 上传结果 json 含 fileType/fileVersion → push 进 newFiles 的 FileAttachment。
  - **卡片展示**(258-)：name 行旁/下加 类型徽标（有值才显示，小 chip 样式）+ 版本号（**直接显示 `{fileVersion}` 原值，不自动加 `v` 前缀**——避免 `V1.0` 变成 `vV1.0`，有值才显示）。两者皆空则卡片不变。
- `FilesPanel` 文件行展示：同样在文件名旁显示 类型徽标 + 版本（复用同一展示片段或就地渲染）。

### 数据流
```
FileUploadArea(选类型+版本) → POST /api/files/upload(formData 带 fileType/fileVersion)
  → normalizeFileType/Version → createProjectFile(落库) → 响应回规范化值
  → 乐观插卡显示徽标
files.list → getProjectFiles(select 全列含新字段)
  → useProjectData / FilesPanel.toAttachment 映射 → 卡片/总览徽标
```

## 模块边界
- `shared/file-types.ts`（新增）：枚举 + 两个 normalize 纯函数。前后端共用。
- `drizzle/schema.ts`：projectFiles 加 2 列（+ 生成迁移）。
- `server/routers/files.ts`：上传路由读+规范化+透传+响应回填。
- `server/db.ts` `createProjectFile`：入库前防御性 normalize（db 层唯一收口点）。
- `client/src/lib/data.ts`：FileAttachment 加 2 可选字段。
- `client/src/hooks/useProjectData.ts` + `client/.../FilesPanel.tsx`：映射补字段 + 展示。
- `client/.../ProjectDetailView.tsx` `FileUploadArea`：录入控件 + FormData + 卡片展示。
- **不改**：getProjectFiles select 逻辑、交付物审核(2b)、就绪度清单上传逻辑（GateReadinessChecklist 仅受益于服务端缺字段安全落 null）。

## 测试
- `shared/file-types.test.ts`（纯函数）：
  - normalizeFileType：白名单内保留；空串/空白/非法值 → null；前后空格 trim。
  - normalizeFileVersion：trim；空串/纯空白 → null；超 32 字符截断到 32；正常值保留。
- 后端集成 `server/files-metadata.test.ts`（mirror `portfolio-health.test.ts`/`custom-fields.test.ts` 建删项目套路）：
  - `createProjectFile` 带合法 fileType + 正常 fileVersion 落库 + `getProjectFiles` 读回一致。
  - **`createProjectFile` 入口防脏**：传**非法 fileType**（如 `"乱填"`）→ 读回 `null`；传**超长 fileVersion**（>32 字符）→ 读回恰好 32 字符；传空白 fileVersion → 读回 `null`。这条直接打 db 入口，证明防御性规范化生效（而非重复测 shared helper）。
  - （可选）若要覆盖路由层，再单独加一条 `/api/files/upload` 路由级测试断言响应 json 回的是规范化值——与 db 入口测试分开。
- 类型：`pnpm check` 零错。

## 明确排除（YAGNI）
- 版本自增 / 与重审·多版本耦合。
- 旧文件补填/编辑 类型·版本。
- 按类型筛选/排序/统计。
- GateReadinessChecklist 的 类型/版本 录入（默认 null）。

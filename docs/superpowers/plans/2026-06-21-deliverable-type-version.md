# 交付物 类型+版本 (P1-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给项目文件加「类型(fileType)」「版本(fileVersion)」两项可选元数据，上传时填写、文件卡片与项目文件总览展示徽标。纯增量，不动审核(2b)/多版本/就绪度逻辑。

**Architecture:** 单一来源 `shared/file-types.ts`（枚举 + 两个 normalize 纯函数）；schema 加两可空列（drizzle 迁移）；db 层 `createProjectFile` 防御性规范化（唯一收口点）；上传路由读+规范化+响应回填；前端录入控件 + 映射 + 徽标展示。

**Tech Stack:** TypeScript、drizzle(node-postgres)、Express multipart 上传、tRPC、React、vitest。

设计依据：`docs/superpowers/specs/2026-06-21-deliverable-type-version-design.md`（已按 6 点 review 补严）。
约定：测试 `node scripts/test.mjs`；类型 `pnpm check`；直接在 `main`，每个 commit 只 stage 本任务文件（never `git add -A`）。

---

### Task 1: `shared/file-types.ts` 枚举 + 规范化纯函数

**Files:**
- Create: `shared/file-types.ts`
- Test: `shared/file-types.test.ts`

- [ ] **Step 1: 写失败测试** — Create `shared/file-types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { FILE_TYPES, normalizeFileType, normalizeFileVersion } from "@shared/file-types";

describe("normalizeFileType", () => {
  it("白名单内的值保留", () => {
    for (const t of FILE_TYPES) expect(normalizeFileType(t)).toBe(t);
  });
  it("前后空格 trim 后匹配", () => {
    expect(normalizeFileType("  图纸 ")).toBe("图纸");
  });
  it("空串/空白/非法值/null/undefined → null", () => {
    expect(normalizeFileType("")).toBeNull();
    expect(normalizeFileType("   ")).toBeNull();
    expect(normalizeFileType("乱填")).toBeNull();
    expect(normalizeFileType(null)).toBeNull();
    expect(normalizeFileType(undefined)).toBeNull();
  });
});

describe("normalizeFileVersion", () => {
  it("正常值保留", () => {
    expect(normalizeFileVersion("V1.0")).toBe("V1.0");
  });
  it("trim", () => {
    expect(normalizeFileVersion("  T1  ")).toBe("T1");
  });
  it("空串/纯空白/null/undefined → null", () => {
    expect(normalizeFileVersion("")).toBeNull();
    expect(normalizeFileVersion("   ")).toBeNull();
    expect(normalizeFileVersion(null)).toBeNull();
    expect(normalizeFileVersion(undefined)).toBeNull();
  });
  it("超 32 字符截断到 32（trim 之后）", () => {
    const long = "x".repeat(40);
    expect(normalizeFileVersion(long)).toBe("x".repeat(32));
    expect(normalizeFileVersion(long)!.length).toBe(32);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node scripts/test.mjs shared/file-types.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 写实现** — Create `shared/file-types.ts`:

```typescript
export const FILE_TYPES = [
  "图纸", "BOM", "报告", "规格书", "测试数据", "认证文件", "评审记录", "变更单", "其他",
] as const;

export type FileType = (typeof FILE_TYPES)[number];

/** 规范化用户输入的 fileType：trim 后在白名单内才保留，否则 null */
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

- [ ] **Step 4: 跑测试 + 类型** — Run: `node scripts/test.mjs shared/file-types.test.ts && pnpm check` → PASS、tsc 零错。

- [ ] **Step 5: Commit**

```bash
git add shared/file-types.ts shared/file-types.test.ts
git commit -m "feat(文件): file-types 枚举 + normalize 纯函数（前后端单一来源）"
```

---

### Task 2: schema 加 fileType/fileVersion 列 + 生成迁移

**Files:**
- Modify: `drizzle/schema.ts`（`projectFiles` 表定义，约 807-819 行）
- Generate: 新的迁移文件（`drizzle/migrations/` 下，由 drizzle-kit 生成）

- [ ] **Step 1: 加两列** — `drizzle/schema.ts` 的 `projectFiles` 表，在 `deliverableName` 列之后（约 807 行）加：

```typescript
    /** 文件格式类别（可空）；取值见 shared/file-types.ts FILE_TYPES */
    fileType: varchar("fileType", { length: 64 }),
    /** 版本标签（可空，≤32），如 V1.0 / T1 / Rev.B */
    fileVersion: varchar("fileVersion", { length: 32 }),
```

（`varchar` 已在本文件 import，无需新增 import。两列可空=不加 `.notNull()`。）

- [ ] **Step 2: 生成迁移** — Run: `npx drizzle-kit generate`
Expected: 在 `drizzle/migrations/`（或项目 drizzle.config 指定的 out 目录）生成一个新的 `NNNN_*.sql` 迁移文件 + 更新 journal/snapshot。打开生成的 SQL，确认是 `ALTER TABLE "project_files" ADD COLUMN "fileType" varchar(64);` 和 `ADD COLUMN "fileVersion" varchar(32);`（两条 ADD COLUMN，**不**含任何 drop/rename，否则停下报告）。

- [ ] **Step 3: 验证迁移可应用** — 测试 runner 会程序化应用所有迁移到测试库。Run: `node scripts/test.mjs shared/file-types.test.ts`
Expected: runner 启动时应用迁移（含新列）无报错、测试通过。再 `pnpm check` 零错。

- [ ] **Step 4: Commit（迁移单独提交）**

```bash
git add drizzle/schema.ts drizzle/migrations/
git commit -m "feat(db): project_files 加 fileType/fileVersion 列 + 迁移"
```

---

### Task 3: db 防御性规范化 + 上传路由读/规范化/回填 + 入口测试

**Files:**
- Modify: `server/db.ts`（`createProjectFile`，1463-1473）
- Modify: `server/routers/files.ts`（上传路由 163-219、响应 237-245）
- Test: `server/files-metadata.test.ts`

- [ ] **Step 1: 写失败的集成测试** — Create `server/files-metadata.test.ts`（mirror `server/portfolio-health.test.ts` 建删项目套路）:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { getDb, createProjectFile, getProjectFiles } from "./db";
import { projects, projectFiles } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `fmeta-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

async function seedProject() {
  const db = await getDb();
  if (!db) return null;
  await db.insert(projects).values({
    id: PROJ, name: "文件元数据测试", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "concept", archived: false, createdBy: 1,
  }).onConflictDoNothing();
  return db;
}

const base = {
  projectId: PROJ, phaseId: null, taskId: null, deliverableName: null,
  name: "f.pdf", mimeType: "application/pdf", size: 10,
  storageKey: "k", storageUrl: "/storage/k", uploadedBy: 1,
};

describe("createProjectFile fileType/fileVersion 防脏", () => {
  it("合法值落库 + 读回一致", async () => {
    const db = await seedProject();
    if (!db) return;
    await createProjectFile({ ...base, storageKey: "k1", storageUrl: "/storage/k1", fileType: "图纸", fileVersion: "V1.0" });
    const rows = await getProjectFiles(PROJ);
    const row = rows.find((r) => r.storageKey === "k1");
    expect(row?.fileType).toBe("图纸");
    expect(row?.fileVersion).toBe("V1.0");
  });

  it("非法 fileType → null；超长 fileVersion → 32 字符；空白 → null", async () => {
    const db = await seedProject();
    if (!db) return;
    await createProjectFile({ ...base, storageKey: "k2", storageUrl: "/storage/k2", fileType: "乱填", fileVersion: "x".repeat(40) });
    await createProjectFile({ ...base, storageKey: "k3", storageUrl: "/storage/k3", fileType: "", fileVersion: "   " });
    const rows = await getProjectFiles(PROJ);
    const r2 = rows.find((r) => r.storageKey === "k2");
    const r3 = rows.find((r) => r.storageKey === "k3");
    expect(r2?.fileType).toBeNull();
    expect(r2?.fileVersion).toBe("x".repeat(32));
    expect(r2?.fileVersion?.length).toBe(32);
    expect(r3?.fileType).toBeNull();
    expect(r3?.fileVersion).toBeNull();
  });
});
```

> 注：`createProjectFile` 的入参类型是 `Omit<InsertProjectFile, "id"|"createdAt">`，Task 2 加了列后 fileType/fileVersion 自动纳入（可空）。若 tsc 抱怨 base 缺字段，按 `InsertProjectFile` 实际必填项对齐（参考已有调用：server/routers/files.ts:208）。

- [ ] **Step 2: 跑测试确认失败** — Run: `node scripts/test.mjs server/files-metadata.test.ts` → FAIL（createProjectFile 未规范化，非法值原样落库 / 超长可能报 DB 错）。

- [ ] **Step 3a: db 层防御性规范化** — `server/db.ts`：顶部 import 区加 `import { normalizeFileType, normalizeFileVersion } from "../shared/file-types";`（与现有 `../shared/*` import 风格一致）。把 `createProjectFile` 改为入库前规范化：

```typescript
export async function createProjectFile(record: Omit<InsertProjectFile, "id" | "createdAt">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalized = {
    ...record,
    fileType: normalizeFileType(record.fileType),
    fileVersion: normalizeFileVersion(record.fileVersion),
  };
  const result = await db.insert(projectFiles).values(normalized).returning({ id: projectFiles.id });
  // 上传新版本后触发交付物重审（若已审核过则回退待审）
  if (record.deliverableName && record.phaseId) {
    const { resetReviewOnReupload } = await import("./deliverable-review-service");
    await resetReviewOnReupload(record.projectId, record.phaseId, record.deliverableName);
  }
  return result[0].id;
}
```

- [ ] **Step 3b: 上传路由读 + 规范化 + 透传 + 响应回填** — `server/routers/files.ts`：
  - 顶部 import 加 `import { normalizeFileType, normalizeFileVersion } from "../../shared/file-types";`（核对相对层级：files.ts 在 server/routers/ 下，shared 在根，故 `../../shared/file-types`；以文件里其它 `../../shared` import 为准）。
  - 读 body（163-168）补 fileType/fileVersion：

```typescript
        const { projectId, phaseId, taskId, deliverableName, fileType, fileVersion } = req.body as {
          projectId?: string;
          phaseId?: string;
          taskId?: string;
          deliverableName?: string;
          fileType?: string;
          fileVersion?: string;
        };
```

  - 规范化（在 createProjectFile 调用前，用于响应回填）：

```typescript
        const normFileType = normalizeFileType(fileType);
        const normFileVersion = normalizeFileVersion(fileVersion);
```

  - `createProjectFile({...})`（208-219）补两字段：在 `deliverableName: deliverableName || null,` 之后加 `fileType: normFileType, fileVersion: normFileVersion,`。
  - 响应 json（237-245）补回规范化值：在 `taskId: taskId || null,` 之后加 `fileType: normFileType, fileVersion: normFileVersion,`。

- [ ] **Step 4: 跑测试 + 类型** — Run: `node scripts/test.mjs server/files-metadata.test.ts && pnpm check` → PASS、tsc 零错。

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/routers/files.ts server/files-metadata.test.ts
git commit -m "feat(文件): createProjectFile 防御性规范化 + 上传路由读/回填 fileType/fileVersion"
```

---

### Task 4: 前端类型 + 映射 + FilesPanel 总览展示

**Files:**
- Modify: `client/src/lib/data.ts`（`FileAttachment` 接口，54-66）
- Modify: `client/src/hooks/useProjectData.ts`（文件映射，108-119）
- Modify: `client/src/components/views/FilesPanel.tsx`（FileRow 类型 9-13、toAttachment 38-42、行展示 63-71）

- [ ] **Step 1: FileAttachment 加字段** — `client/src/lib/data.ts` 的 `FileAttachment` 接口，在 `storageKey?: string;` 之后加：

```typescript
  /** 文件格式类别（见 shared/file-types.ts），可空 */
  fileType?: string | null;
  /** 版本标签，可空 */
  fileVersion?: string | null;
```

- [ ] **Step 2: useProjectData 映射补字段** — `client/src/hooks/useProjectData.ts` 的 dbFiles map（110-119），在 `storageKey: f.storageKey,` 之后加：

```typescript
            fileType: f.fileType ?? null,
            fileVersion: f.fileVersion ?? null,
```

（`f` 来自 `files.list` = `ProjectFile`，Task 2 后含 fileType/fileVersion 列，类型自动可用。）

- [ ] **Step 3: FilesPanel 类型 + 映射 + 展示** — `client/src/components/views/FilesPanel.tsx`：
  - `FileRow` 类型（9-13）补：`fileType: string | null; fileVersion: string | null;`
  - `toAttachment`（38-42）补：在 `storageKey: f.storageKey ?? undefined,` 之后加 `fileType: f.fileType, fileVersion: f.fileVersion,`
  - 行展示（66-70）在文件名行加徽标。把：

```tsx
                  <div className="text-sm text-stone-800 truncate">{f.name}</div>
```

  改为：

```tsx
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-stone-800 truncate">{f.name}</span>
                    {f.fileType && <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">{f.fileType}</span>}
                    {f.fileVersion && <span className="shrink-0 text-[10px] font-mono text-amber-700">{f.fileVersion}</span>}
                  </div>
```

- [ ] **Step 4: 类型** — Run: `pnpm check` → 零错。

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/data.ts client/src/hooks/useProjectData.ts client/src/components/views/FilesPanel.tsx
git commit -m "feat(文件): FileAttachment 加 fileType/fileVersion + 总览展示徽标"
```

---

### Task 5: FileUploadArea 录入控件 + FormData + 卡片徽标

**Files:**
- Modify: `client/src/components/views/ProjectDetailView.tsx`（import 区；`FileUploadArea` 160-291）

- [ ] **Step 1: import FILE_TYPES** — `ProjectDetailView.tsx` 顶部 import 区加 `import { FILE_TYPES } from '@shared/file-types';`（核对本文件 `@shared` 别名是否可用；若该文件用相对路径或 `@/`，以文件内其它 shared import 写法为准）。

- [ ] **Step 2: 录入控件 state + UI** — `FileUploadArea` 组件内（171-175 的 useState 附近）加：

```typescript
  const [selectedType, setSelectedType] = useState('');
  const [version, setVersion] = useState('');
```

在拖拽区 `<div onClick={() => !readOnly && inputRef.current?.click()} ...>` 之前（即 `return (<div>` 之后、拖拽区之前，约 235 行）插入录入行，**仅非 readOnly 渲染**：

```tsx
      {!readOnly && (
        <div className="flex items-center gap-2 mb-2">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="text-xs border border-stone-300 bg-white px-2 py-1.5 text-stone-700"
          >
            <option value="">未分类</option>
            {FILE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            maxLength={32}
            placeholder="版本 如 V1.0 / T1 / Rev.B"
            className="flex-1 text-xs border border-stone-300 bg-white px-2 py-1.5 text-stone-700"
          />
        </div>
      )}
```

- [ ] **Step 3: FormData 带上 + 结果映射** — `handleFiles` 内（188-216）：
  - 在 `formData.append('projectId', projectId);` 等之后加：

```typescript
        formData.append('fileType', selectedType);
        formData.append('fileVersion', version);
```

  - 结果类型（203-206）补 `fileType` / `fileVersion`：

```typescript
        const result = await resp.json() as {
          id: number; name: string; mimeType: string; size: number;
          storageKey: string; storageUrl: string;
          fileType?: string | null; fileVersion?: string | null;
        };
```

  - push 的 FileAttachment（207-216）在 `storageKey: result.storageKey,` 之后加 `fileType: result.fileType ?? null, fileVersion: result.fileVersion ?? null,`

- [ ] **Step 4: 卡片徽标展示** — 卡片名字块（267-268）。把：

```tsx
                <div className={`text-sm text-stone-900 truncate ${previewable ? 'group-hover:text-amber-700' : ''}`}>{file.name}</div>
                <div className="text-[10px] font-mono text-stone-500">{formatBytes(file.size)}</div>
```

  改为：

```tsx
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-sm text-stone-900 truncate ${previewable ? 'group-hover:text-amber-700' : ''}`}>{file.name}</span>
                  {file.fileType && <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">{file.fileType}</span>}
                  {file.fileVersion && <span className="shrink-0 text-[10px] font-mono text-amber-700">{file.fileVersion}</span>}
                </div>
                <div className="text-[10px] font-mono text-stone-500">{formatBytes(file.size)}</div>
```

（版本直接显示原值，不加 `v` 前缀。）

- [ ] **Step 5: 类型 + 构建** — Run: `pnpm check` → 零错。

- [ ] **Step 6: 预览验证（controller 做）** — 由控制者用 preview 工具：任务详情上传区选「图纸」+ 填「V1.0」上传一个文件，确认卡片显示徽标；项目文件总览(FilesPanel)也显示；只读任务里录入控件不出现。

- [ ] **Step 7: Commit**

```bash
git add client/src/components/views/ProjectDetailView.tsx
git commit -m "feat(文件): FileUploadArea 类型/版本录入 + 卡片徽标（readOnly 隐藏）"
```

---

## 自检（Self-Review）

- **Spec 覆盖**：决策1 枚举/单一来源→Task1；决策2 版本自由文本→Task1+5；决策3 按批次→Task5（组件级 state）；决策4 录入范围（仅 FileUploadArea，GateReadinessChecklist 不动靠服务端 null）→Task5 + Task3 规范化；A 数据层→Task1+2；B 后端（db 收口 + 路由回填）→Task3；C 前端（类型/映射/FilesPanel/FileUploadArea/readOnly/无 v 前缀）→Task4+5；测试矩阵→各 Task Step1。✅
- **类型一致**：`FILE_TYPES`/`FileType`/`normalizeFileType`/`normalizeFileVersion`、`fileType`/`fileVersion` 字段名全程一致；FileAttachment、ProjectFile、FileRow、上传响应四处字段同名。✅
- **无占位符**：所有步给出完整代码；唯三「以现状为准」标注（shared import 别名、InsertProjectFile 必填项、drizzle 迁移 out 目录）是让执行者对齐真实写法，非逻辑占位。✅
- **迁移**：Task2 单独提交；generate 产物需人核对只含两条 ADD COLUMN。✅
- **YAGNI**：不做自增/旧文件补填/按类型筛选/GateReadinessChecklist 录入。✅

/**
 * Demo data seed for visual verification of the frontend redesign.
 *
 * Infrastructure only — NOT part of the redesign. Inserts ~8 projects spread
 * across categories / lifecycle phases / owners / risk / progress, plus a
 * handful of requirements and issues, so the portfolio board, overview and
 * detail screens render against realistic data.
 *
 * Idempotent: projects use stable ids demo-001..demo-008 and are skipped if
 * they already exist. Requirements/issues are keyed on a demo title marker and
 * skipped if already present. Re-running must not error or duplicate.
 *
 * Run with:
 *   export $(grep -E '^DATABASE_URL=' .env | xargs) && npx tsx scripts/seed-demo-data.ts
 */

import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, createProjectWithSeed } from "../server/db";
import {
  users,
  projects,
  projectRequirements,
  projectIssues,
  projectTasks,
  products,
  projectCalendarEvents,
  projectGateReviews,
  type InsertProject,
  type InsertProjectRequirement,
  type InsertProjectIssue,
  type InsertProduct,
} from "../drizzle/schema";

// Category + phase ids are taken from shared/sop-templates.ts:
//   npd: concept, planning, design, evt, dvt, pvt, mp
//   eco: planning, design, evt, pvt, mp
//   jdm: input, design, evt, dvt, pvt, mp
type DemoProject = {
  id: string;
  name: string;
  category: "npd" | "eco" | "jdm";
  currentPhase: string;
  risk: "low" | "medium" | "high";
  progress: number;
  customer?: string;
  description: string;
  startDate: string;
  targetDate: string;
  /** index into the test-user list below; sets pmUserId */
  pmIndex: number;
};

// 6 test users, in a stable order; pmIndex maps into this list.
const PM_USERNAMES = [
  "test_pm",
  "test_ee",
  "test_mech",
  "test_sw",
  "test_qa",
  "test_scm",
] as const;

const DEMO_PROJECTS: DemoProject[] = [
  {
    id: "demo-001",
    name: "旗舰降噪耳机 ANC Pro",
    category: "npd",
    currentPhase: "concept",
    risk: "low",
    progress: 8,
    customer: "自有品牌",
    description: "全新旗舰主动降噪耳机，对标头部竞品，主打通透模式与超长续航。",
    startDate: "2026-05-06",
    targetDate: "2026-12-20",
    pmIndex: 0,
  },
  {
    id: "demo-002",
    name: "智能手表 Gen3",
    category: "npd",
    currentPhase: "design",
    risk: "medium",
    progress: 38,
    customer: "自有品牌",
    description: "第三代智能手表，新增血氧与 ECG，结构堆叠与续航是关键挑战。",
    startDate: "2026-03-02",
    targetDate: "2026-11-30",
    pmIndex: 1,
  },
  {
    id: "demo-003",
    name: "便携投影仪 Lumo X",
    category: "npd",
    currentPhase: "evt",
    risk: "high",
    progress: 55,
    customer: "自有品牌",
    description: "便携激光投影仪，散热与光机调校在 EVT 暴露多处问题，进度承压。",
    startDate: "2026-01-12",
    targetDate: "2026-10-15",
    pmIndex: 2,
  },
  {
    id: "demo-004",
    name: "扫地机器人 Vmax",
    category: "npd",
    currentPhase: "dvt",
    risk: "medium",
    progress: 72,
    customer: "自有品牌",
    description: "激光导航扫地机器人，DVT 阶段进行可靠性与认证测试。",
    startDate: "2025-11-03",
    targetDate: "2026-09-25",
    pmIndex: 3,
  },
  {
    id: "demo-005",
    name: "无线键盘 K75 量产",
    category: "npd",
    currentPhase: "mp",
    risk: "low",
    progress: 96,
    customer: "自有品牌",
    description: "矮轴无线机械键盘，已进入量产爬坡，良率稳定。",
    startDate: "2025-09-15",
    targetDate: "2026-07-10",
    pmIndex: 4,
  },
  {
    id: "demo-006",
    name: "车载充电器 ECO 改版",
    category: "eco",
    currentPhase: "design",
    risk: "low",
    progress: 30,
    customer: "比亚迪",
    description: "车载快充改版，主控换代降本并提升 PD 兼容性，跳过概念阶段。",
    startDate: "2026-04-20",
    targetDate: "2026-08-30",
    pmIndex: 5,
  },
  {
    id: "demo-007",
    name: "蓝牙音箱 BOM 降本",
    category: "eco",
    currentPhase: "evt",
    risk: "high",
    progress: 48,
    customer: "小米生态链",
    description: "音箱替换功放与电池供应商以降本，EVT 验证回归与性能对比。",
    startDate: "2026-02-18",
    targetDate: "2026-08-15",
    pmIndex: 0,
  },
  {
    id: "demo-008",
    name: "JDM 蓝牙音箱（客户委托）",
    category: "jdm",
    currentPhase: "input",
    risk: "medium",
    progress: 12,
    customer: "Anker",
    description: "客户提供 ID 与规格，工厂承接结构/硬件/软件设计，设计输入冻结中。",
    startDate: "2026-05-25",
    targetDate: "2027-01-20",
    pmIndex: 1,
  },
];

// Demo requirements live in the global pool (projectId = null) and on a project.
// Sources used: customer(客户) / market(市场) / internal(内部).
// Statuses used: new(新建) / triaged(评估中) / planned(已立项,立项) /
//                accepted(已立项,已采纳) / rejected(已拒绝).
// NOTE: there is no "vote count" field anywhere in this codebase's schema, so
// vote counts cannot be seeded. priority (P0..P3) is varied instead to give the
// requirements pool visual differentiation.
const DEMO_REQ_MARKER = "[demo]";
type DemoReq = Omit<InsertProjectRequirement, "creatorId"> & { title: string };
const buildRequirements = (creatorId: number): InsertProjectRequirement[] => {
  const base: DemoReq[] = [
    {
      title: `${DEMO_REQ_MARKER} 支持多设备无缝切换`,
      description: "客户希望耳机可在手机/平板/电脑间自动切换连接。",
      source: "customer",
      sourceDetail: "京东 PO 反馈",
      type: "functional",
      priority: "P1",
      status: "new",
      projectId: null,
    },
    {
      title: `${DEMO_REQ_MARKER} 续航提升至 60 小时`,
      description: "市场调研显示续航是核心购买决策因素，目标对标竞品。",
      source: "market",
      sourceDetail: "竞品分析报告",
      type: "performance",
      priority: "P0",
      status: "triaged",
      projectId: null,
    },
    {
      title: `${DEMO_REQ_MARKER} 增加 LDAC 高码率音频`,
      description: "内部技术团队建议补齐高码率编码以提升音质卖点。",
      source: "internal",
      sourceDetail: "声学团队",
      type: "functional",
      priority: "P2",
      status: "planned",
      projectId: "demo-001",
    },
    {
      title: `${DEMO_REQ_MARKER} 表带快拆结构`,
      description: "用户问卷反馈表带更换不便，需快拆结构。",
      source: "customer",
      sourceDetail: "用户问卷",
      type: "ux",
      priority: "P2",
      status: "accepted",
      projectId: "demo-002",
    },
    {
      title: `${DEMO_REQ_MARKER} 支持卫星通信`,
      description: "提议加入卫星通信，评估后认为成本与认证周期不可控。",
      source: "internal",
      sourceDetail: "预研提案",
      type: "functional",
      priority: "P3",
      status: "rejected",
      decisionNote: "成本与认证周期不满足本代时程，转入下一代预研。",
      projectId: null,
    },
    {
      title: `${DEMO_REQ_MARKER} 降低整机 BOM 成本 8%`,
      description: "市场价格战压力下要求本代降本。",
      source: "market",
      sourceDetail: "渠道价格分析",
      type: "cost",
      priority: "P1",
      status: "triaged",
      projectId: "demo-007",
    },
  ];
  return base.map((r) => ({ ...r, creatorId }));
};

// Demo issues across projects, varied severity / status / category.
const DEMO_ISSUE_MARKER = "[demo]";
type DemoIssue = Omit<InsertProjectIssue, "creatorId"> & { title: string };
const buildIssues = (creatorId: number): InsertProjectIssue[] => {
  const base: DemoIssue[] = [
    {
      title: `${DEMO_ISSUE_MARKER} 光机高温下亮度衰减`,
      description: "连续工作 30 分钟后亮度下降约 15%，疑似散热不足。",
      projectId: "demo-003",
      phaseId: "evt",
      severity: "P0",
      status: "open",
      category: "thermal",
      owner: "热设计组",
      reporter: "QA",
      foundDate: "2026-06-08",
    },
    {
      title: `${DEMO_ISSUE_MARKER} 蓝牙偶发断连`,
      description: "在多设备环境下偶发断连，复现率约 5%。",
      projectId: "demo-002",
      phaseId: "design",
      severity: "P1",
      status: "in_progress",
      category: "software",
      owner: "SW",
      reporter: "EE",
      foundDate: "2026-05-21",
    },
    {
      title: `${DEMO_ISSUE_MARKER} 跌落后外壳卡扣断裂`,
      description: "1.0m 跌落测试卡扣断裂，需加强结构。",
      projectId: "demo-004",
      phaseId: "dvt",
      severity: "P1",
      status: "resolved",
      category: "mechanical",
      owner: "MD",
      reporter: "QA",
      foundDate: "2026-04-30",
      solution: "卡扣加厚 0.3mm 并改料，复测通过。",
    },
    {
      title: `${DEMO_ISSUE_MARKER} 新功放底噪偏高`,
      description: "替换功放后静音底噪较原方案偏高 3dB。",
      projectId: "demo-007",
      phaseId: "evt",
      severity: "P2",
      status: "open",
      category: "hardware",
      owner: "EE",
      reporter: "声学",
      foundDate: "2026-06-12",
    },
    {
      title: `${DEMO_ISSUE_MARKER} 量产线 FCT 治具误判`,
      description: "FCT 治具接触不良导致良率虚降，需调整探针。",
      projectId: "demo-005",
      phaseId: "mp",
      severity: "P3",
      status: "closed",
      category: "performance",
      owner: "测试工程",
      reporter: "产线",
      foundDate: "2026-06-01",
      closedDate: "2026-06-05",
      solution: "更换探针并优化压合行程。",
    },
  ];
  return base.map((i) => ({ ...i, creatorId }));
};

// ─────────────────────────────────────────────────────────────────────────────
// My Tasks — assign existing seeded project_tasks to test_pm with varied state.
//
// We UPDATE existing (projectId, phaseId, taskId) rows (created by
// createProjectWithSeed) rather than inserting new ones, so referential
// expectations (one row per SOP task) stay intact. The 我的任务 page reads
// trpc.workbench.mine → getMyTasks, which filters out done/skipped, so the
// overdue + in-progress rows surface there; the done rows are valid data but
// only render in the project-detail task list (documented in the report).
//
// project_tasks enums (drizzle/schema.ts):
//   status   : todo | in_progress | blocked | done | skipped
//   priority : low | medium | high | critical
// ─────────────────────────────────────────────────────────────────────────────
type DemoTaskAssignment = {
  projectId: string;
  phaseId: string;
  taskId: string;
  status: "todo" | "in_progress" | "blocked" | "done" | "skipped";
  priority: "low" | "medium" | "high" | "critical";
  dueDate: string;
  completed?: boolean;
  completedAt?: string; // ISO timestamp
};

// today = 2026-06-23. ~4 overdue, ~5 in-progress/upcoming, ~3 completed.
const DEMO_MY_TASKS: DemoTaskAssignment[] = [
  // ── ~4 overdue (dueDate in the past, status not done) ──
  { projectId: "demo-003", phaseId: "evt", taskId: "e1", status: "in_progress", priority: "critical", dueDate: "2026-06-12" },
  { projectId: "demo-007", phaseId: "evt", taskId: "ev2", status: "todo",       priority: "high",     dueDate: "2026-06-16" },
  { projectId: "demo-002", phaseId: "design", taskId: "d3", status: "blocked",  priority: "high",     dueDate: "2026-06-18" },
  { projectId: "demo-004", phaseId: "dvt", taskId: "v2", status: "in_progress", priority: "medium",   dueDate: "2026-06-20" },
  // ── ~5 in-progress / upcoming (dueDate near future) ──
  { projectId: "demo-001", phaseId: "concept", taskId: "c1", status: "in_progress", priority: "high",   dueDate: "2026-06-24" },
  { projectId: "demo-002", phaseId: "design",  taskId: "d4", status: "in_progress", priority: "medium", dueDate: "2026-06-26" },
  { projectId: "demo-003", phaseId: "evt",     taskId: "e3", status: "todo",        priority: "critical", dueDate: "2026-06-30" },
  { projectId: "demo-006", phaseId: "design",  taskId: "ed2", status: "todo",       priority: "low",    dueDate: "2026-07-06" },
  { projectId: "demo-008", phaseId: "input",   taskId: "jdm_input_snapshot", status: "in_progress", priority: "medium", dueDate: "2026-07-14" },
  // ── ~3 completed (status done, completed flag, completedAt set) ──
  { projectId: "demo-005", phaseId: "mp",      taskId: "mp1", status: "done", priority: "medium", dueDate: "2026-06-05", completed: true, completedAt: "2026-06-04T09:30:00Z" },
  { projectId: "demo-004", phaseId: "dvt",     taskId: "v1",  status: "done", priority: "high",   dueDate: "2026-06-09", completed: true, completedAt: "2026-06-09T15:10:00Z" },
  { projectId: "demo-007", phaseId: "evt",     taskId: "ev1", status: "done", priority: "low",    dueDate: "2026-06-11", completed: true, completedAt: "2026-06-10T11:00:00Z" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Products — populate the 产品库 screen. products columns (drizzle/schema.ts):
//   id, productNumber, name, type(finished|component), category,
//   platformId(null), targetMarkets[], lifecycleState
//   (concept|development|mass_production|maintenance|eol), createdBy.
// A couple of demo projects are linked via projects.productId so 在研项目数 > 0.
// ─────────────────────────────────────────────────────────────────────────────
type DemoProduct = Omit<InsertProduct, "createdBy">;
const DEMO_PRODUCTS: DemoProduct[] = [
  { id: "prod-001", productNumber: "PRD-ANC-001", name: "旗舰降噪耳机 ANC Pro", type: "finished", category: "耳机", targetMarkets: ["EU", "US", "CN"], lifecycleState: "concept" },
  { id: "prod-002", productNumber: "PRD-WAT-003", name: "智能手表 Gen3", type: "finished", category: "可穿戴", targetMarkets: ["CN", "US"], lifecycleState: "development" },
  { id: "prod-003", productNumber: "PRD-PRJ-X", name: "便携投影仪 Lumo X", type: "finished", category: "投影", targetMarkets: ["CN", "JP"], lifecycleState: "development" },
  { id: "prod-004", productNumber: "PRD-RBT-VMX", name: "扫地机器人 Vmax", type: "finished", category: "清洁电器", targetMarkets: ["EU", "CN"], lifecycleState: "development" },
  { id: "prod-005", productNumber: "PRD-KBD-K75", name: "无线键盘 K75", type: "finished", category: "外设", targetMarkets: ["CN", "US", "EU"], lifecycleState: "mass_production" },
  { id: "prod-006", productNumber: "PRD-MTR-BLDC", name: "无刷直流电机 BLDC-40", type: "component", category: "电机", targetMarkets: ["CN"], lifecycleState: "maintenance" },
];
// Optional project → product links so "在研项目数" shows > 0.
const DEMO_PRODUCT_LINKS: Array<{ projectId: string; productId: string }> = [
  { projectId: "demo-001", productId: "prod-001" },
  { projectId: "demo-002", productId: "prod-002" },
  { projectId: "demo-003", productId: "prod-003" },
  { projectId: "demo-004", productId: "prod-004" },
  { projectId: "demo-005", productId: "prod-005" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Calendar — populate the 日历 screen for June 2026 (today = 2026-06-23).
// getCalendar (server/db.ts) reads three dated sources:
//   • project_gate_reviews.reviewDate     → type "gate"
//   • project_calendar_events.eventDate   → type "schedule"
//   • project_tasks.dueDate               → type "task"/"gate" (already seeded above)
// We add a couple of dated gate reviews + several scheduled events (incl. today).
// ─────────────────────────────────────────────────────────────────────────────
const DEMO_GATE_MARKER = "[demo]";
type DemoGate = { projectId: string; phaseId: string; gateName: string; reviewDate: string };
const DEMO_GATE_REVIEWS: DemoGate[] = [
  { projectId: "demo-002", phaseId: "design", gateName: `${DEMO_GATE_MARKER} Gate 2 设计评审`, reviewDate: "2026-06-12" },
  { projectId: "demo-003", phaseId: "evt", gateName: `${DEMO_GATE_MARKER} Gate 3 EVT 评审`, reviewDate: "2026-06-23" },
  { projectId: "demo-004", phaseId: "dvt", gateName: `${DEMO_GATE_MARKER} Gate 4 DVT 评审`, reviewDate: "2026-06-27" },
];

type DemoCalEvent = { projectId: string; title: string; eventDate: string; startTime: string; durationMin: number };
const DEMO_CAL_EVENTS: DemoCalEvent[] = [
  { projectId: "demo-001", title: "[demo] 概念方案对齐会", eventDate: "2026-06-05", startTime: "10:00", durationMin: 90 },
  { projectId: "demo-007", title: "[demo] 降本方案评审", eventDate: "2026-06-10", startTime: "14:00", durationMin: 60 },
  { projectId: "demo-002", title: "[demo] 结构堆叠复盘", eventDate: "2026-06-17", startTime: "11:00", durationMin: 45 },
  { projectId: "demo-003", title: "[demo] EVT 问题攻关会（今日）", eventDate: "2026-06-23", startTime: "09:30", durationMin: 60 },
  { projectId: "demo-005", title: "[demo] 量产爬坡日例会", eventDate: "2026-06-23", startTime: "16:00", durationMin: 30 },
  { projectId: "demo-004", title: "[demo] 可靠性测试周报", eventDate: "2026-06-25", startTime: "15:00", durationMin: 45 },
  { projectId: "demo-008", title: "[demo] 设计输入冻结评审", eventDate: "2026-06-29", startTime: "10:30", durationMin: 90 },
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database not available — is DATABASE_URL set?");

  // Resolve test-user ids by username (do not hardcode).
  const userRows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(inArray(users.username, PM_USERNAMES as unknown as string[]));
  const idByUsername = new Map(userRows.map((u) => [u.username, u.id]));

  const pmId = idByUsername.get("test_pm");
  if (pmId == null) {
    throw new Error("test_pm user not found — seed the 6 test users first.");
  }
  const createdBy = pmId;

  // ── Projects ──────────────────────────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  for (const p of DEMO_PROJECTS) {
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, p.id))
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      console.log(`  skip project ${p.id} (already exists)`);
      continue;
    }
    const pmUserId = idByUsername.get(PM_USERNAMES[p.pmIndex]) ?? null;
    const insert: InsertProject = {
      id: p.id,
      name: p.name,
      projectNumber: p.id.toUpperCase(),
      category: p.category,
      pmUserId,
      description: p.description,
      customer: p.customer ?? null,
      risk: p.risk,
      currentPhase: p.currentPhase,
      progress: p.progress,
      startDate: p.startDate,
      targetDate: p.targetDate,
      createdBy,
    };
    await createProjectWithSeed(insert, p.category, createdBy);
    created++;
    console.log(`  + project ${p.id} ${p.name} [${p.category}/${p.currentPhase}]`);
  }
  console.log(`projects: ${created} created, ${skipped} skipped`);

  // ── Requirements ────────────────────────────────────────────────────────────
  const reqs = buildRequirements(createdBy);
  let reqCreated = 0;
  let reqSkipped = 0;
  for (const r of reqs) {
    const existing = await db
      .select({ id: projectRequirements.id })
      .from(projectRequirements)
      .where(eq(projectRequirements.title, r.title))
      .limit(1);
    if (existing.length > 0) {
      reqSkipped++;
      continue;
    }
    await db.insert(projectRequirements).values(r);
    reqCreated++;
  }
  console.log(`requirements: ${reqCreated} created, ${reqSkipped} skipped`);

  // ── Issues ──────────────────────────────────────────────────────────────────
  const issues = buildIssues(createdBy);
  let issueCreated = 0;
  let issueSkipped = 0;
  for (const i of issues) {
    const existing = await db
      .select({ id: projectIssues.id })
      .from(projectIssues)
      .where(eq(projectIssues.title, i.title))
      .limit(1);
    if (existing.length > 0) {
      issueSkipped++;
      continue;
    }
    await db.insert(projectIssues).values(i);
    issueCreated++;
  }
  console.log(`issues: ${issueCreated} created, ${issueSkipped} skipped`);

  // ── My Tasks: assign existing tasks to test_pm ────────────────────────────
  // Idempotent: we UPDATE by (projectId, phaseId, taskId) — re-running just
  // re-applies the same assignment values.
  let taskAssigned = 0;
  let taskMissing = 0;
  for (const t of DEMO_MY_TASKS) {
    const res = await db
      .update(projectTasks)
      .set({
        assigneeUserId: pmId,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        completed: t.completed ?? false,
        completedAt: t.completedAt ? new Date(t.completedAt) : null,
        statusChangedAt: new Date(),
        updatedBy: pmId,
      })
      .where(
        and(
          eq(projectTasks.projectId, t.projectId),
          eq(projectTasks.phaseId, t.phaseId),
          eq(projectTasks.taskId, t.taskId)
        )
      )
      .returning({ id: projectTasks.id });
    if (res.length > 0) taskAssigned++;
    else {
      taskMissing++;
      console.warn(`  ! task not found, skipped: ${t.projectId}/${t.phaseId}/${t.taskId}`);
    }
  }
  console.log(`my-tasks: ${taskAssigned} assigned to test_pm (${taskMissing} missing)`);

  // ── Products: create + optionally link projects ──────────────────────────
  let prodCreated = 0;
  let prodSkipped = 0;
  for (const p of DEMO_PRODUCTS) {
    const existing = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, p.id))
      .limit(1);
    if (existing.length > 0) {
      prodSkipped++;
      continue;
    }
    await db.insert(products).values({ ...p, createdBy: pmId });
    prodCreated++;
  }
  // Link a couple of demo projects to products (idempotent UPDATE).
  let linked = 0;
  for (const l of DEMO_PRODUCT_LINKS) {
    const res = await db
      .update(projects)
      .set({ productId: l.productId })
      .where(eq(projects.id, l.projectId))
      .returning({ id: projects.id });
    if (res.length > 0) linked++;
  }
  console.log(`products: ${prodCreated} created, ${prodSkipped} skipped; ${linked} projects linked`);

  // ── Calendar: dated gate reviews + scheduled events ──────────────────────
  // Gate reviews: idempotent on (projectId, phaseId, gateName).
  let gateCreated = 0;
  let gateSkipped = 0;
  for (const g of DEMO_GATE_REVIEWS) {
    const existing = await db
      .select({ id: projectGateReviews.id })
      .from(projectGateReviews)
      .where(
        and(
          eq(projectGateReviews.projectId, g.projectId),
          eq(projectGateReviews.phaseId, g.phaseId),
          eq(projectGateReviews.gateName, g.gateName)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      gateSkipped++;
      continue;
    }
    await db.insert(projectGateReviews).values({
      projectId: g.projectId,
      phaseId: g.phaseId,
      phaseName: g.phaseId,
      gateName: g.gateName,
      reviewDate: g.reviewDate,
      decision: "conditional",
      createdBy: pmId,
    });
    gateCreated++;
  }
  // Calendar events: idempotent on (projectId, title, eventDate).
  let calCreated = 0;
  let calSkipped = 0;
  for (const e of DEMO_CAL_EVENTS) {
    const existing = await db
      .select({ id: projectCalendarEvents.id })
      .from(projectCalendarEvents)
      .where(
        and(
          eq(projectCalendarEvents.projectId, e.projectId),
          eq(projectCalendarEvents.title, e.title),
          eq(projectCalendarEvents.eventDate, e.eventDate)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      calSkipped++;
      continue;
    }
    await db.insert(projectCalendarEvents).values({
      projectId: e.projectId,
      title: e.title,
      eventDate: e.eventDate,
      startTime: e.startTime,
      durationMin: e.durationMin,
      organizerUserId: pmId,
      createdBy: pmId,
    });
    calCreated++;
  }
  console.log(`calendar: ${gateCreated} gate reviews created (${gateSkipped} skipped), ${calCreated} events created (${calSkipped} skipped)`);
}

main()
  .then(() => {
    console.log("done");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

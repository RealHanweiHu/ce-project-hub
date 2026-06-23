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
import { eq, inArray } from "drizzle-orm";
import { getDb, createProjectWithSeed } from "../server/db";
import {
  users,
  projects,
  projectRequirements,
  projectIssues,
  type InsertProject,
  type InsertProjectRequirement,
  type InsertProjectIssue,
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

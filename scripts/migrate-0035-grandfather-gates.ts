// 2026-07-02 Gate 收紧的存量 grandfather 迁移。
// 对每个未归档项目：把「已过会阶段」上本次新增的必备交付物，写成一次性豁免
// （project_deliverable_overrides.action='remove' + reason），使存量在途 NPD/JDM/OBT
// 不会因新增硬性交付物被追溯打回 blocked。未过会（当前/未来）Gate 不豁免——按新严格标准往前走。
//
// 幂等：已存在同键 override 的跳过（不覆盖用户既有裁剪）。
// 用法：  pnpm tsx scripts/migrate-0035-grandfather-gates.ts [--dry] [--apply]
//   默认 dry-run 只打印将写入的豁免；加 --apply 才落库。
import "dotenv/config";
import pg from "pg";
import {
  computeGrandfatherExemptions,
  passedPhaseIds,
} from "../shared/gate-tightening";
import { getPhasesForCategory } from "../shared/sop-templates";

const REASON =
  "存量项目一次性豁免：2026-07-02 Gate 收紧前该阶段已过会，新增必备交付物不追溯打回（如需仍可在资源库补齐并撤销豁免）";
const SYSTEM_ACTOR = 0;

const apply = process.argv.includes("--apply");
const { Client } = pg;

type ProjectRow = { id: string; category: string; currentPhase: string };
type ReviewRow = { projectId: string; phaseId: string; decision: string };

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: projects } = await client.query<ProjectRow>(
      `select id, category, "currentPhase" from projects where archived = false`,
    );
    const { rows: reviews } = await client.query<ReviewRow>(
      `select "projectId", "phaseId", decision from project_gate_reviews where decision in ('approved','conditional')`,
    );
    const reviewedByProject = new Map<string, Set<string>>();
    for (const r of reviews) {
      const set = reviewedByProject.get(r.projectId) ?? new Set<string>();
      set.add(r.phaseId);
      reviewedByProject.set(r.projectId, set);
    }

    let totalExemptions = 0;
    let inserted = 0;
    let touchedProjects = 0;

    for (const p of projects) {
      const order = getPhasesForCategory(p.category).map((ph) => ph.id);
      if (order.length === 0) continue;
      const passed = passedPhaseIds(order, p.currentPhase, reviewedByProject.get(p.id) ?? []);
      const exemptions = computeGrandfatherExemptions({
        projectId: p.id,
        category: p.category,
        passedPhaseIds: passed,
      });
      if (exemptions.length === 0) continue;
      touchedProjects++;
      totalExemptions += exemptions.length;
      for (const ex of exemptions) {
        if (!apply) {
          console.log(`  [dry] ${ex.projectId}  ${ex.nodePhaseId}  ✂ ${ex.deliverableName}`);
          continue;
        }
        const res = await client.query(
          `insert into project_deliverable_overrides
             ("projectId","nodePhaseId","deliverableName",action,reason,"createdBy")
           values ($1,$2,$3,'remove',$4,$5)
           on conflict ("projectId","nodePhaseId","deliverableName") do nothing
           returning id`,
          [ex.projectId, ex.nodePhaseId, ex.deliverableName, REASON, SYSTEM_ACTOR],
        );
        inserted += res.rowCount ?? 0;
      }
    }

    if (apply) {
      console.log(`\n完成：${touchedProjects} 个项目，写入 ${inserted}/${totalExemptions} 条豁免（其余已存在，跳过）。`);
    } else {
      console.log(`\nDRY-RUN：${touchedProjects} 个项目将获 ${totalExemptions} 条豁免。加 --apply 落库。`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

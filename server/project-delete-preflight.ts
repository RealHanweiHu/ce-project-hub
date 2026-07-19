import { eq } from "drizzle-orm";
import {
  mpReleases,
  productRevisions,
  productTechnicalBaselines,
  projects,
} from "../drizzle/schema";
import { getDb } from "./db";

/**
 * Mirror the hard-delete traceability guard before any irreversible DingTalk
 * cleanup happens. The delete transaction remains the final authority.
 */
export async function canHardDeleteProject(projectId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [projectRows, releaseRows, revisionRows, baselineRows] = await Promise.all([
    db.select({ resultRevisionId: projects.resultRevisionId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
    db.select({ id: mpReleases.id })
      .from(mpReleases)
      .where(eq(mpReleases.projectId, projectId))
      .limit(1),
    db.select({ id: productRevisions.id })
      .from(productRevisions)
      .where(eq(productRevisions.createdByProjectId, projectId))
      .limit(1),
    db.select({ id: productTechnicalBaselines.id })
      .from(productTechnicalBaselines)
      .where(eq(productTechnicalBaselines.sourceProjectId, projectId))
      .limit(1),
  ]);
  const project = projectRows[0];
  return Boolean(
    project &&
    project.resultRevisionId === null &&
    releaseRows.length === 0 &&
    revisionRows.length === 0 &&
    baselineRows.length === 0
  );
}

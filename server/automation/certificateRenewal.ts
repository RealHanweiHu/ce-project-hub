import { eq, lt } from "drizzle-orm";
import { productCertificates } from "../../drizzle/schema";
import { notifyPersonal } from "../notification-gateway";
import { getDb } from "../db";
import { claimCertificateRenewalAlert, listCertificateRenewalCandidates, releaseCertificateRenewalAlert } from "../services/sop-blindspot-service";
import { addDays, daysBetween, todayShanghai } from "../../shared/shanghai-date";

export async function runCertificateRenewalScan(now = new Date()): Promise<{ expired: number; notified: number }> {
  const db = await getDb();
  if (!db) return { expired: 0, notified: 0 };
  const todayISO = todayShanghai(now);
  const expiredRows = await db.update(productCertificates).set({ status: "expired", updatedAt: new Date() })
    .where(lt(productCertificates.validUntil, todayISO)).returning({ id: productCertificates.id });
  const candidates = await listCertificateRenewalCandidates(todayISO, addDays(todayISO, 90));
  let notified = 0;
  for (const row of candidates) {
    const certificate = row.certificate;
    if (!certificate.validUntil || certificate.renewalStatus === "renewed") continue;
    const recipientUserId = certificate.renewalOwnerUserId ?? row.maintenanceOwnerUserId ?? row.productManagerUserId;
    if (!recipientUserId) continue;
    const remaining = daysBetween(todayISO, certificate.validUntil);
    const leadDays = remaining <= 30 ? 30 : 90;
    const alertKey = { certificateId: certificate.id, validUntil: certificate.validUntil, leadDays, recipientUserId };
    const claimed = await claimCertificateRenewalAlert(alertKey);
    if (!claimed) continue;
    try {
      const delivery = await notifyPersonal({
        eventKey: "certificate_renewal",
        userIds: [recipientUserId],
        title: `证书续期提醒：${certificate.type}`,
        body: `证书 ${certificate.certificateNumber || `#${certificate.id}`} 将于 ${certificate.validUntil} 到期（剩余 ${Math.max(0, remaining)} 天），请更新续期计划。`,
        entityType: "certificate",
        entityId: String(certificate.id),
        actionUrl: "/?view=products",
        bestEffortDingtalk: true,
      });
      if (delivery.site + delivery.dingtalk === 0) {
        throw new Error(delivery.errors.join("；") || "证书续期提醒没有渠道实际送达");
      }
      notified += 1;
    } catch (error) {
      await releaseCertificateRenewalAlert(alertKey);
      console.warn("[automation] certificate renewal delivery failed; claim released:", error);
    }
  }
  return { expired: expiredRows.length, notified };
}

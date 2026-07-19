-- Historical conditional Gate decisions had free text only. Convert every one
-- into an open controlled condition so Sprint-1 Close cannot silently ignore it.
INSERT INTO "project_conditions" (
  "projectId", "sourceType", "sourceId", "title", "description",
  "ownerUserId", "dueDate", "status", "createdBy", "createdAt", "updatedAt"
)
SELECT
  g."projectId",
  'gate',
  g."id"::text,
  coalesce(nullif(g."gateName", ''), nullif(g."phaseName", ''), g."phaseId") || ' 条件项',
  coalesce(nullif(g."conditions", ''), '历史有条件通过记录，需补充闭环证据'),
  coalesce(g."conditionOwnerUserId", p."pmUserId", g."createdBy", p."createdBy"),
  coalesce(
    g."conditionDueDate",
    CASE WHEN g."reviewDate" ~ '^\d{4}-\d{2}-\d{2}$' THEN g."reviewDate"::date + 14 END,
    current_date + 14
  ),
  'open',
  coalesce(g."createdBy", p."createdBy"),
  g."createdAt",
  now()
FROM "project_gate_reviews" g
JOIN "projects" p ON p."id" = g."projectId"
WHERE g."decision" = 'conditional'
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;

-- Action items are a projection of the controlled-condition record, not a
-- second source of truth. Closing the condition closes this action item.
INSERT INTO "action_items" (
  "kind", "projectId", "entityType", "entityId", "dedupeKey",
  "recipientUserId", "level", "title", "body", "actionUrl",
  "status", "priority", "dueAt", "metadata", "createdAt", "updatedAt"
)
SELECT
  'condition_followup'::action_item_kind,
  c."projectId",
  'condition',
  c."id"::text,
  'condition:' || c."id"::text || ':owner',
  c."ownerUserId",
  'owner',
  c."title",
  c."description",
  '/?view=projects&projectId=' || c."projectId",
  'open',
  'high',
  c."dueDate"::timestamp + interval '23 hours 59 minutes 59 seconds',
  jsonb_build_object('conditionId', c."id", 'sourceType', c."sourceType", 'dueDate', c."dueDate"),
  c."createdAt",
  now()
FROM "project_conditions" c
WHERE c."status" = 'open'
ON CONFLICT ("dedupeKey") DO NOTHING;

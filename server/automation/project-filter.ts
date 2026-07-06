type AutomationProjectCandidate = {
  id?: string | null;
  name?: string | null;
  projectNumber?: string | null;
  customFields?: Record<string, unknown> | null;
};

const TEST_PROJECT_ID_PATTERNS = [
  /^proj_(autoeng|cftest)(?:_archived)?$/i,
  /^smoke_test_proj/i,
  /^qa-login-project$/i,
  /^demo-\d{3}$/i,
  /^role-rank-[mv]-\d{10,}$/i,
  /^rel_test_project/i,
  /^bom_test_/i,
  /^test[-_]/i,
  /_test_/i,
  /-test-\d{10,}$/i,
  /^(appr-member|assign|bad-date|bom-router|bom-struct|bomacl-proj|cal|cl-guard|comments-acl|di-db|del-prod-proj|drg|drr|ext-vis|fmeta|gate-block|gate-conv|gate-rdy|gate-rdy-rt|grandfather|mgmt-kpi|move|pf-health|pf-metrics|phase3de|pm|risk-life|risk-override|role-unify|sev-guard|tasks-router-val|trace-proj|trperm|tsvc)-\d{10,}$/i,
  /^tli-test-\d{10,}$/i,
  /^test-plan-\d{10,}$/i,
];

const TEST_PROJECT_NAME_PATTERNS = [
  /^自动化引擎测试项目$/,
  /^自定义字段测试项目$/,
  /^日历测试项目$/,
  /^Test Relational Project$/i,
  /^Smoke Test Project$/i,
];

function customFieldFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function isAutomationSuppressedProject(project: AutomationProjectCandidate | null | undefined): boolean {
  if (!project) return false;
  const customFields = project.customFields ?? {};
  if (
    customFieldFlag(customFields.automationDisabled) ||
    customFieldFlag(customFields.suppressAutomation) ||
    customFieldFlag(customFields.testFixture)
  ) {
    return true;
  }

  const id = project.id?.trim() ?? "";
  if (id && TEST_PROJECT_ID_PATTERNS.some((pattern) => pattern.test(id))) return true;

  const name = project.name?.trim() ?? "";
  if (name && TEST_PROJECT_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;

  return false;
}

export function shanghaiTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

type MetricsRaw = {
  tasks: { createdAt: string }[];
  issues: { foundDate: string | null; closedDate: string | null }[];
  phases: { startDate: string | null }[];
};

export function defaultFromISO(
  projectStartDate: string | null,
  raw: MetricsRaw,
  fallbackISO: string,
): string {
  const projectStart = toISODate(projectStartDate);
  if (projectStart) return projectStart;
  const earliest = minISO([
    ...raw.tasks.map((task) => task.createdAt),
    ...raw.issues.map((issue) => issue.foundDate),
    ...raw.issues.map((issue) => issue.closedDate),
    ...raw.phases.map((phase) => phase.startDate),
  ]);
  return earliest ?? fallbackISO;
}

function toISODate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function minISO(values: Array<string | null | undefined>) {
  const dates = values.map(toISODate).filter((value): value is string => !!value);
  return dates.length > 0 ? dates.sort()[0] : null;
}

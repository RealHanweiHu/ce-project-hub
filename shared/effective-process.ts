import { getPhasesForCategory, type SOPPhase } from "./sop-templates";

export type DeliverableOverrideAction = "add" | "remove";

export interface DeliverableOverrideInput {
  nodePhaseId: string;
  deliverableName: string;
  action: DeliverableOverrideAction;
}

export interface CarriedDeliverable {
  name: string;
  fromPhaseId: string;
}

export type EffectiveSOPPhase = SOPPhase & {
  tailored: boolean;
  submittedDeliverables: string[];
  carriedDeliverables: CarriedDeliverable[];
};

export interface EffectiveProcess {
  phases: EffectiveSOPPhase[];
  isPhaseTailored: (phaseId: string) => boolean;
  isTaskTailored: (phaseId: string, taskId: string) => boolean;
}

function toSet(values?: Iterable<string>): Set<string> {
  return values instanceof Set ? new Set(Array.from(values)) : new Set(Array.from(values ?? []));
}

function addAll(target: Set<string>, values: Iterable<string>) {
  for (const value of Array.from(values)) {
    if (value.trim()) target.add(value);
  }
}

function phaseSubmissionTemplate(phase: SOPPhase): string[] {
  const names = new Set<string>();
  addAll(names, phase.deliverables ?? []);
  addAll(names, phase.gateStandard?.requiredDeliverables ?? []);
  return Array.from(names);
}

function nextEffectivePhaseId(phases: SOPPhase[], index: number, tailoredPhaseIds: Set<string>): string | null {
  for (let i = index + 1; i < phases.length; i++) {
    if (!tailoredPhaseIds.has(phases[i].id)) return phases[i].id;
  }
  for (let i = phases.length - 1; i >= 0; i--) {
    if (!tailoredPhaseIds.has(phases[i].id)) return phases[i].id;
  }
  return null;
}

function buildOverrideMap(overrides: DeliverableOverrideInput[]): Map<string, DeliverableOverrideAction> {
  const map = new Map<string, DeliverableOverrideAction>();
  for (const override of overrides) {
    map.set(`${override.nodePhaseId}\u0000${override.deliverableName}`, override.action);
  }
  return map;
}

export function getDeliverableLibrary(category?: string): string[] {
  const names = new Set<string>();
  for (const phase of getPhasesForCategory(category)) {
    addAll(names, phaseSubmissionTemplate(phase));
  }
  return Array.from(names);
}

export function getEffectiveProcess(
  category?: string,
  tailoredPhaseIdsInput?: Iterable<string>,
  tailoredTaskIdsInput?: Iterable<string>,
  deliverableOverrides: DeliverableOverrideInput[] = []
): EffectiveProcess {
  const phases = getPhasesForCategory(category);
  const tailoredPhaseIds = toSet(tailoredPhaseIdsInput);
  const tailoredTaskIds = toSet(tailoredTaskIdsInput);
  const submissions = new Map<string, Set<string>>();
  const carried = new Map<string, CarriedDeliverable[]>();

  for (const phase of phases) {
    submissions.set(phase.id, new Set());
    carried.set(phase.id, []);
  }

  phases.forEach((phase, index) => {
    const templateDeliverables = phaseSubmissionTemplate(phase);
    if (tailoredPhaseIds.has(phase.id)) {
      const targetPhaseId = nextEffectivePhaseId(phases, index, tailoredPhaseIds);
      if (!targetPhaseId) return;
      addAll(submissions.get(targetPhaseId)!, templateDeliverables);
      carried.get(targetPhaseId)!.push(
        ...templateDeliverables.map((name) => ({ name, fromPhaseId: phase.id }))
      );
      return;
    }
    addAll(submissions.get(phase.id)!, templateDeliverables);
  });

  const overrideMap = buildOverrideMap(deliverableOverrides);

  const effectivePhases = phases.map((phase) => {
    const tailored = tailoredPhaseIds.has(phase.id);
    const submitted = new Set(submissions.get(phase.id) ?? []);
    if (!tailored) {
      for (const [key, action] of Array.from(overrideMap.entries())) {
        const [nodePhaseId, deliverableName] = key.split("\u0000");
        if (nodePhaseId !== phase.id) continue;
        if (action === "remove") submitted.delete(deliverableName);
        else submitted.add(deliverableName);
      }
    } else {
      submitted.clear();
    }

    const carriedDeliverables = tailored
      ? []
      : (carried.get(phase.id) ?? []).filter((item) => submitted.has(item.name));

    return {
      ...phase,
      tailored,
      submittedDeliverables: Array.from(submitted),
      carriedDeliverables,
    };
  });

  return {
    phases: effectivePhases,
    isPhaseTailored: (phaseId: string) => tailoredPhaseIds.has(phaseId),
    isTaskTailored: (phaseId: string, taskId: string) =>
      tailoredPhaseIds.has(phaseId) ||
      tailoredTaskIds.has(taskId) ||
      tailoredTaskIds.has(`${phaseId}:${taskId}`),
  };
}

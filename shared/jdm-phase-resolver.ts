import type { SOPPhase } from "./sop-templates";

export type JdmEffectivePhaseResolver = (
  baselineInput?: unknown,
  templateVersion?: string | null,
) => SOPPhase[];

let resolver: JdmEffectivePhaseResolver | null = null;

/** 在模板注册表初始化后注入，保持 project-aware 入口与模板定义之间的 ESM 环无新增运行时边。 */
export function registerJdmEffectivePhaseResolver(
  next: JdmEffectivePhaseResolver,
): void {
  resolver = next;
}

export function resolveJdmEffectivePhases(
  baselineInput?: unknown,
  templateVersion?: string | null,
): SOPPhase[] | null {
  return resolver?.(baselineInput, templateVersion) ?? null;
}

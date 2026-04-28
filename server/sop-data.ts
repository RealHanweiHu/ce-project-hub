/**
 * Server-side SOP template data.
 * Mirrors client/src/lib/sop-templates.ts but without frontend dependencies.
 * Used for seeding project_phases and project_tasks on project creation.
 */

export interface SopTask {
  id: string;
  visibleRoles: string[];
}

export interface SopPhase {
  id: string;
  tasks: SopTask[];
}

// ─────────────────────────────────────────────────────────────────────────────
// NPD — New Product Development (7 phases)
// ─────────────────────────────────────────────────────────────────────────────
const NPD_PHASES: SopPhase[] = [
  {
    id: 'concept',
    tasks: [
      { id: 'c1', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'c2', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'c3', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'c4', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'] },
      { id: 'c5', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'c6', visibleRoles: [] },
    ],
  },
  {
    id: 'planning',
    tasks: [
      { id: 'p1', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'p2', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'] },
      { id: 'p3', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'p4', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'] },
      { id: 'p5', visibleRoles: ['scm', 'rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'p6', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'p7', visibleRoles: [] },
    ],
  },
  {
    id: 'design',
    tasks: [
      { id: 'd1', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'] },
      { id: 'd2', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'] },
      { id: 'd3', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'd4', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'd5', visibleRoles: ['rd_sw', 'pm', 'manager', 'owner'] },
      { id: 'd6', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'] },
      { id: 'd7', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'] },
      { id: 'd8', visibleRoles: [] },
    ],
  },
  {
    id: 'evt',
    tasks: [
      { id: 'e1', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'e2', visibleRoles: ['rd_hw', 'rd_sw', 'pm', 'manager', 'owner'] },
      { id: 'e3', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'e4', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'e5', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'e6', visibleRoles: [] },
    ],
  },
  {
    id: 'dvt',
    tasks: [
      { id: 'dv1', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'] },
      { id: 'dv2', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'dv3', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'dv4', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'dv5', visibleRoles: ['scm', 'rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'dv6', visibleRoles: [] },
    ],
  },
  {
    id: 'pvt',
    tasks: [
      { id: 'pv1', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'] },
      { id: 'pv2', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'pv3', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'pv4', visibleRoles: ['scm', 'pm', 'manager', 'owner'] },
      { id: 'pv5', visibleRoles: [] },
    ],
  },
  {
    id: 'mp',
    tasks: [
      { id: 'm1', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'm2', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'm3', visibleRoles: ['scm', 'pm', 'manager', 'owner'] },
      { id: 'm4', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'm5', visibleRoles: [] },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ECO — Engineering Change Order (5 phases)
// ─────────────────────────────────────────────────────────────────────────────
const ECO_PHASES: SopPhase[] = [
  {
    id: 'planning',
    tasks: [
      { id: 'ep1', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'ep2', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'qa', 'pm', 'manager', 'owner'] },
      { id: 'ep3', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'] },
      { id: 'ep4', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'ep5', visibleRoles: ['scm', 'rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'ep6', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'ep7', visibleRoles: [] },
    ],
  },
  {
    id: 'design',
    tasks: [
      { id: 'ed1', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'ed2', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'] },
      { id: 'ed3', visibleRoles: ['rd_sw', 'pm', 'manager', 'owner'] },
      { id: 'ed4', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'] },
      { id: 'ed5', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'ed6', visibleRoles: [] },
    ],
  },
  {
    id: 'evt',
    tasks: [
      { id: 'ev1', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'ev2', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'] },
      { id: 'ev3', visibleRoles: ['qa', 'rd_sw', 'pm', 'manager', 'owner'] },
      { id: 'ev4', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'ev5', visibleRoles: [] },
    ],
  },
  {
    id: 'pvt',
    tasks: [
      { id: 'epv1', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'] },
      { id: 'epv2', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'epv3', visibleRoles: ['scm', 'pm', 'manager', 'owner'] },
      { id: 'epv4', visibleRoles: ['pm', 'manager', 'owner'] },
      { id: 'epv5', visibleRoles: [] },
    ],
  },
  {
    id: 'mp',
    tasks: [
      { id: 'em1', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'em2', visibleRoles: ['pm', 'qa', 'manager', 'owner'] },
      { id: 'em3', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'em4', visibleRoles: [] },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// IDR — ID Refresh (3 phases)
// ─────────────────────────────────────────────────────────────────────────────
const IDR_PHASES: SopPhase[] = [
  {
    id: 'design',
    tasks: [
      { id: 'ir1', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'] },
      { id: 'ir2', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'] },
      { id: 'ir3', visibleRoles: ['rd_mech', 'scm', 'pm', 'manager', 'owner'] },
      { id: 'ir4', visibleRoles: ['scm', 'pm', 'manager', 'owner'] },
      { id: 'ir5', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'] },
      { id: 'ir6', visibleRoles: [] },
    ],
  },
  {
    id: 'dvt',
    tasks: [
      { id: 'iv1', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'iv2', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'] },
      { id: 'iv3', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'iv4', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'iv5', visibleRoles: [] },
    ],
  },
  {
    id: 'mp',
    tasks: [
      { id: 'im1', visibleRoles: ['rd_mech', 'qa', 'pm', 'manager', 'owner'] },
      { id: 'im2', visibleRoles: ['qa', 'pm', 'manager', 'owner'] },
      { id: 'im3', visibleRoles: ['scm', 'pm', 'manager', 'owner'] },
      { id: 'im4', visibleRoles: [] },
    ],
  },
];

const CATEGORY_PHASES: Record<string, SopPhase[]> = {
  npd: NPD_PHASES,
  eco: ECO_PHASES,
  idr: IDR_PHASES,
};

/**
 * Get SOP phases for a project category.
 * Falls back to NPD if category is unknown.
 */
export function getSopPhasesForCategory(category: string): SopPhase[] {
  return CATEGORY_PHASES[category] ?? NPD_PHASES;
}

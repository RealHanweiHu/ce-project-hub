// CE Project Hub - SOP 标准流程数据
// Design: Industrial Precision - stone/amber color system

export interface SOPTask {
  id: string;
  name: string;
  desc: string;
  owner: string;
  guide: string;
  /**
   * Which project-member roles can see this task.
   * Empty array (default) = visible to ALL roles.
   * Non-empty = only listed roles (plus owner/manager/pm who always see everything).
   */
  visibleRoles?: string[];
}

export interface SOPPhase {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  duration: string;
  desc: string;
  gate: string;
  gateTaskId: string; // ID of the Gate Review task that must be completed before next phase
  deliverables: string[];
  tasks: SOPTask[];
  color: string;
}

export interface TaskDetails {
  instructions: string;
  files: FileAttachment[];
}

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadDate: string;
  dataUrl: string;
}

// ── Issue Tracking ───────────────────────────────────────────────────────────
export type IssueSeverity = 'P0' | 'P1' | 'P2' | 'P3';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'wont_fix';
export type IssueCategory = 'hardware' | 'software' | 'mechanical' | 'thermal' | 'reliability' | 'safety' | 'performance' | 'other';

export interface Issue {
  id: string;
  title: string;
  desc: string;
  severity: IssueSeverity;     // P0 Critical / P1 Major / P2 Minor / P3 Observation
  status: IssueStatus;
  category: IssueCategory;
  owner: string;               // responsible person
  reporter: string;
  foundDate: string;           // YYYY-MM-DD
  targetDate: string;          // expected close date
  closedDate?: string;
  rootCause?: string;
  solution?: string;
  relatedTaskId?: string;      // link to a SOP task
  attachments?: string[];      // file names
  creatorId?: string;          // userId of the person who created this issue
}

// ── Gate Review Record ──────────────────────────────────────────────────────
export interface GateReview {
  id: string;
  phaseId: string;
  phaseName: string;
  gateName: string;
  reviewDate: string;       // YYYY-MM-DD
  participants: string;     // comma-separated names
  decision: 'approved' | 'conditional' | 'rejected';
  conditions: string;       // conditions if conditional approval
  notes: string;            // meeting notes / decision rationale
  createdAt: string;        // ISO timestamp
  roundNumber?: number;     // review round (1 = first, 2 = re-review, etc.)
}

export interface PhaseData {
  tasks: Record<string, boolean>;
  taskDetails: Record<string, TaskDetails>;
  notes: string;
  issues?: Issue[];            // issue list for this phase
  gateReviews?: GateReview[];  // gate review history (newest last)
  /** @deprecated use gateReviews instead */ gateReview?: GateReview;
}

// ── Change Log / ECR ────────────────────────────────────────────────────────
export type ChangeType =
  | 'decision'    // 老板拍板 / 关键决策
  | 'tradeoff'    // 方案取舍
  | 'eco'         // ECO — Engineering Change Order
  | 'ecn'         // ECN — Engineering Change Notice
  | 'spec'        // 规格变更
  | 'cost'        // 成本变更
  | 'schedule'    // 时间/进度变更
  | 'supplier'    // 供应商变更
  | 'other';      // 其他

export type ChangeStatus = 'proposed' | 'approved' | 'rejected' | 'implemented' | 'cancelled';

export interface ChangeRecord {
  id: string;
  number: string;           // ECR-001, ECN-002, etc. (auto or manual)
  type: ChangeType;
  title: string;
  description: string;      // what changed
  reason: string;           // why it changed (老板拍板/技术原因/成本压力等)
  decisionMaker: string;    // 拍板人
  affectedPhases: string[]; // which phases are affected
  status: ChangeStatus;
  costImpact?: string;      // e.g. "+$2/unit", "BOM +5%"
  scheduleImpact?: string;  // e.g. "+2 weeks", "no impact"
  createdAt: string;        // ISO timestamp
  createdDate: string;      // YYYY-MM-DD
  implementedDate?: string; // YYYY-MM-DD
  notes?: string;           // additional context
}

export interface PhaseDate {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface Project {
  id: string;
  code: string;
  name: string;
  type: string;
  pm: string;
  startDate: string;
  targetDate: string;
  currentPhase: string;
  risk: 'low' | 'medium' | 'high';
  phases: Record<string, PhaseData>;
  phaseDates?: Record<string, PhaseDate>; // custom per-phase dates
  category?: 'npd' | 'eco' | 'idr'; // project category determines SOP template
  changeLog?: ChangeRecord[];          // project-level change & decision log
  /** Per-task visibleRoles overrides: taskId -> roles[] (empty = all can see) */
  taskVisibleRoles?: Record<string, string[]>;
}

export const SOP_PHASES: SOPPhase[] = [
  {
    id: 'concept',
    code: 'P1',
    name: '概念阶段',
    nameEn: 'Concept',
    duration: '2-4周',
    desc: '市场洞察与产品立项',
    gate: '立项评审 / Project Charter',
    gateTaskId: 'c6',
    color: '#78716c',
    deliverables: ['市场调研报告', '产品概念书', '商业可行性分析', '立项申请书'],
    tasks: [
      { id: 'c1', name: '市场调研与竞品分析', desc: '收集市场数据、竞品拆解、定价分析', owner: 'PM/BD', guide: '1) 收集 TOP 5 竞品的硬件参数、定价、销量数据\n2) 拆解 2-3 款关键竞品（成本结构、用户评价）\n3) 输出竞品对比矩阵' },
      { id: 'c2', name: '用户需求收集 (VoC)', desc: 'Voice of Customer，用户访谈/问卷', owner: 'PM/UX', guide: '1) 至少完成 15 位目标用户的深度访谈\n2) 发布在线问卷，目标样本 ≥ 200\n3) 提炼 Top 10 用户痛点与期望' },
      { id: 'c3', name: '产品概念定义', desc: '核心卖点、目标用户、关键场景', owner: 'PM', guide: '1) 撰写一句话产品定义（Elevator Pitch）\n2) 定义 3 个核心卖点（USP）\n3) 绘制用户旅程地图' },
      { id: 'c4', name: '技术可行性评估', desc: '关键技术验证、专利检索', owner: 'R&D Lead', guide: '1) 列出关键技术挑战清单\n2) 完成核心技术 POC\n3) 进行专利检索与规避分析' },
      { id: 'c5', name: '商业可行性分析', desc: '市场规模、定价、利润模型', owner: 'PM/Finance', guide: '1) 建立 3 年销量预测模型\n2) 估算目标 BOM 成本与零售价\n3) 计算毛利率、回收期' },
      { id: 'c6', name: '立项评审 (Gate 1)', desc: '正式立项决策评审', owner: '管理层', guide: '评审材料: 1) 产品概念书 2) 市场分析 3) 商业模型 4) 技术评估 5) 资源需求' },
    ],
  },
  {
    id: 'planning',
    code: 'P2',
    name: '规划阶段',
    nameEn: 'Planning',
    duration: '3-4月',
    desc: '产品规格与项目计划',
    gate: 'Kickoff评审',
    gateTaskId: 'p7',
    color: '#a16207',
    deliverables: ['PRD产品需求文档', 'PSD产品规格书', '项目甘特图', 'BOM v0.1'],
    tasks: [
      { id: 'p1', name: '产品需求文档 (PRD)', desc: '完整的功能/非功能需求', owner: 'PM', guide: '1) 功能需求（Feature List + User Story）\n2) 非功能需求（性能/安全/合规）\n3) 验收标准（Acceptance Criteria）' },
      { id: 'p2', name: '产品规格书 (PSD)', desc: '技术规格、性能指标', owner: 'R&D', guide: '1) 硬件规格（主芯片/内存/接口）\n2) 软件规格（OS/协议栈/算法）\n3) 性能指标（功耗/续航/响应时间）' },
      { id: 'p3', name: '项目时程规划', desc: '里程碑、关键路径、资源排期', owner: 'PMO', guide: '1) 制定 WBS\n2) 标注关键路径与风险节点\n3) 设置 Gate Review 时间点' },
      { id: 'p4', name: 'BOM初版', desc: '关键料件清单，预估成本', owner: 'EE/采购', guide: '1) 列出所有关键器件\n2) 标注供应商、料号、单价\n3) 计算总 BOM 成本\n4) 识别长交期/单一来源器件' },
      { id: 'p5', name: '关键供应商初选', desc: 'IC、屏幕、电池等核心料件', owner: '采购', guide: '1) 每个关键料件至少 2-3 家供应商\n2) 评估：价格/品质/产能/付款条件\n3) 索取样品与报价' },
      { id: 'p6', name: '团队组建与资源分配', desc: 'ID/MD/EE/SW/QA/PM', owner: 'PMO/HR', guide: '1) 确认各模块负责人（RACI）\n2) 评估外包/内部资源比例\n3) 培训需求识别' },
      { id: 'p7', name: 'Kickoff会议', desc: '项目正式启动，目标对齐', owner: 'PM', guide: '议程: 1) 项目背景与目标 2) 规格与需求 Walk-through 3) 时程与里程碑 4) 角色与职责' },
    ],
  },
  {
    id: 'design',
    code: 'P3',
    name: '设计阶段',
    nameEn: 'Design',
    duration: '6-12周',
    desc: 'ID/MD/EE/SW并行设计',
    gate: '设计冻结评审 (Design Freeze)',
    gateTaskId: 'd8',
    color: '#0369a1',
    deliverables: ['ID外观图', 'MD结构图', 'PCB原理图&Layout', 'SW架构文档', 'BOM v1.0'],
    tasks: [
      { id: 'd1', name: 'ID 工业设计', desc: '外观造型、材质、CMF配色', owner: 'ID', guide: '1) 草图发散（≥10 个方向）\n2) 3 套候选方案精化\n3) CMF（颜色/材质/工艺）定义\n4) 3D 渲染图与实体模型' },
      { id: 'd2', name: 'MD 结构设计', desc: '内部结构、装配、堆叠', owner: 'MD', guide: '1) 内部空间堆叠（Layout）\n2) 装配工艺设计\n3) 公差分析（Tolerance Stack-up）' },
      { id: 'd3', name: 'EE 电子原理设计', desc: '电源/MCU/传感器/通信架构', owner: 'EE', guide: '1) 系统框图设计\n2) 原理图绘制（Schematic）\n3) 电源树设计与功耗分析' },
      { id: 'd4', name: 'PCB Layout', desc: 'PCB布线、阻抗、EMC考量', owner: 'EE/PCB', guide: '1) 板层规划与叠层设计\n2) 关键信号阻抗控制\n3) EMC/EMI 设计\n4) DRC 检查' },
      { id: 'd5', name: 'SW 软件架构', desc: 'Firmware架构、通信协议、APP', owner: 'SW', guide: '1) 系统架构图（固件 + 云 + APP）\n2) 通信协议定义（BLE/WiFi/UART）\n3) OTA 升级方案' },
      { id: 'd6', name: 'DFM/DFA 评审', desc: '可制造/可装配性评审', owner: 'ME/工厂', guide: '1) 工厂参与评审，识别制造风险\n2) DFM Checklist\n3) DFA Checklist' },
      { id: 'd7', name: '关键料件定型', desc: '主芯片、屏、电池规格冻结', owner: 'EE/采购', guide: '1) 完成关键料件 2nd Source 验证\n2) 签订正式供货协议\n3) 锁定料件规格与供货计划' },
      { id: 'd8', name: '设计冻结评审 (Gate 3)', desc: 'Design Freeze，进入打样', owner: '跨部门', guide: '评审: 1) ID/MD/EE/SW 设计完成度 2) BOM 成本 vs 目标 3) 关键风险 4) EVT 计划' },
    ],
  },
  {
    id: 'evt',
    code: 'P4',
    name: 'EVT 工程验证',
    nameEn: 'EVT',
    duration: '4-6周',
    desc: '工程样机功能验证',
    gate: 'EVT评审',
    gateTaskId: 'e7',
    color: '#7c3aed',
    deliverables: ['EVT样机 ≥10台', '功能测试报告', '问题清单 (Issue List)', 'PCB v2'],
    tasks: [
      { id: 'e1', name: '工程样机制作', desc: '手工焊接，≥10台用于验证', owner: 'EE/EMS', guide: '1) PCBA 打样（≥15 套，含备份）\n2) 整机组装（10-20 台）\n3) 标注样机版本与序号' },
      { id: 'e2', name: '功能测试 (FT)', desc: '所有功能点逐一验证', owner: 'QA/EE', guide: '1) 撰写 FT Test Plan\n2) 逐项测试，记录 Pass/Fail\n3) Bug 进入 Issue List' },
      { id: 'e3', name: '性能测试 (PT)', desc: '续航、信号、热设计、跌落初测', owner: 'QA/EE', guide: '1) 续航测试（典型/重度场景）\n2) 无线性能（RF Conducted/Radiated）\n3) 热成像与温升测试' },
      { id: 'e4', name: '软硬件联调', desc: 'Firmware与硬件配合调试', owner: 'SW/EE', guide: '1) Bringup\n2) 驱动调试\n3) 协议联调\n4) 异常处理与稳定性优化' },
      { id: 'e5', name: '设计问题清单', desc: '记录bug、设计缺陷、改善方案', owner: 'PM/QA', guide: '每个 Issue 包含:\n- 现象描述\n- 根因分析\n- 改善方案\n- 责任人与改善期限' },
      { id: 'e6', name: 'PCB改板 (v2)', desc: '根据EVT问题做PCB改版', owner: 'EE', guide: '1) 汇总 PCB 相关问题\n2) ECN（工程变更通知）\n3) PCB v2 重新 Layout' },
      { id: 'e7', name: 'EVT评审 (Gate 4)', desc: '是否达到进入DVT条件', owner: '跨部门', guide: '评审标准:\n- 主要功能 Pass Rate ≥ 95%\n- 无 P0 级未解决问题\n- 性能初测达标' },
    ],
  },
  {
    id: 'dvt',
    code: 'P5',
    name: 'DVT 设计验证',
    nameEn: 'DVT',
    duration: '4-8周',
    desc: '设计成熟度全面验证',
    gate: 'DVT评审',
    gateTaskId: 'v8',
    color: '#0f766e',
    deliverables: ['DVT样机 ≥30台', '可靠性测试报告', '认证报告', '模具T1样品'],
    tasks: [
      { id: 'v1', name: 'DVT样机制作', desc: '半SMT产线，≥30台', owner: 'EMS', guide: '1) 半正式产线 SMT（≥50 PCBA）\n2) 整机组装（≥30 台）\n3) 模拟量产工艺' },
      { id: 'v2', name: '可靠性测试', desc: '跌落/高低温/湿度/震动/老化', owner: 'QA', guide: '标准测试矩阵:\n- 跌落 1.5m × 26 面\n- 高低温 -20℃ ~ 60℃\n- 湿热 40℃/95%RH × 96h\n- 振动测试' },
      { id: 'v3', name: '安规与认证', desc: 'CE/FCC/3C/RoHS/REACH', owner: 'QA/认证', guide: '认证清单:\n- 中国: SRRC, CCC\n- 欧盟: CE (RED, EMC, LVD), RoHS\n- 美国: FCC, UL\n- 其他目标市场认证' },
      { id: 'v4', name: '模具T1/T2试模', desc: '塑胶模具开模与试模', owner: 'MD/模厂', guide: '1) 模具开模（4-6 周）\n2) T1 试模 - 准备认证样品\n3) T2 试模 - 修模\n4) 准备认证样品' },
      { id: 'v5', name: '软件功能完整测试', desc: '回归测试、压力测试', owner: 'SW/QA', guide: '1) 完整回归测试\n2) 压力测试\n3) OTA 升级测试\n4) 多 APP/多设备并发测试' },
      { id: 'v6', name: '包装设计验证', desc: '包装跌落、运输测试', owner: '包装', guide: '1) 包装结构设计\n2) 包装跌落测试（ISTA 1A/3A）\n3) 运输振动测试\n4) 堆叠压力测试' },
      { id: 'v7', name: '量产工艺评估', desc: '与工厂确认SMT/组装工艺', owner: 'ME/工厂', guide: '1) PFMEA 工艺失效模式分析\n2) 关键工艺参数定义（CTQ）\n3) 治具与测试设备清单' },
      { id: 'v8', name: 'DVT评审 (Gate 5)', desc: '进入PVT前的关键评审', owner: '跨部门', guide: '通过标准:\n- 可靠性测试全部 Pass\n- 认证测试通过\n- 模具尺寸/外观 OK\n- BOM 成本达标' },
    ],
  },
  {
    id: 'pvt',
    code: 'P6',
    name: 'PVT 试产验证',
    nameEn: 'PVT',
    duration: '3-6周',
    desc: '生产工艺与良率验证',
    gate: 'MP准备就绪评审',
    gateTaskId: 'pv8',
    color: '#b45309',
    deliverables: ['试产50-300台', 'SOP/WI作业指导书', '良率报告', '治具与测试程序'],
    tasks: [
      { id: 'pv1', name: '试产规划', desc: '产线排程、物料齐套、人员培训', owner: 'ME/工厂', guide: '1) 试产数量与排程\n2) 物料齐套（BOM 100% Ready）\n3) 产线工位规划\n4) 作业人员培训' },
      { id: 'pv2', name: 'SOP/WI制定', desc: '生产标准作业流程、作业指导书', owner: 'ME/IE', guide: '每工位需输出:\n- SOP（Standard Operating Procedure）\n- WI（Work Instruction）\n- 品质检验标准' },
      { id: 'pv3', name: '治具与测试程序', desc: 'ATE/FCT/老化治具，测试软件', owner: '测试工程', guide: '1) ICT 治具\n2) FCT 治具\n3) 老化柜与自动化测试\n4) 测试程序与判定标准' },
      { id: 'pv4', name: '试产 (50-300台)', desc: '按量产工艺试制', owner: '工厂', guide: '1) 试产首件确认（FAI）\n2) 全程监控良率与异常\n3) 每小时记录 First Pass Yield' },
      { id: 'pv5', name: '良率分析与改善', desc: 'SMT/组装/测试良率追踪', owner: 'QE/ME', guide: '良率目标:\n- SMT: ≥ 99%\n- 组装: ≥ 98%\n- FCT: ≥ 97%\n- 整机直通率: ≥ 95%' },
      { id: 'pv6', name: '包装与物流验证', desc: '完整包装、运输、仓储测试', owner: '包装/物流', guide: '1) 完整包装方案确认\n2) 装箱单 / 唛头设计\n3) 物流路径与运输测试\n4) 保税仓/海外仓方案' },
      { id: 'pv7', name: '品质标准固化', desc: 'IPQC/OQC标准、AQL等级', owner: 'QA', guide: '1) IPQC 制程巡检标准\n2) OQC 出货检验标准（AQL 0.65/1.0/2.5）\n3) 外观检验标准（限度样本）' },
      { id: 'pv8', name: 'PVT评审 (Gate 6)', desc: '量产准备就绪（Ready for MP）', owner: '跨部门', guide: '量产 GO 条件:\n- 试产良率达标\n- SOP/WI 完整\n- 治具/产能就绪\n- 物料供应稳定' },
    ],
  },
  {
    id: 'mp',
    code: 'P7',
    name: 'MP 量产阶段',
    nameEn: 'Mass Production',
    duration: '持续',
    desc: '量产爬坡与持续改善',
    gate: '产品交付/EOL',
    gateTaskId: 'mp6',
    color: '#166534',
    deliverables: ['量产产品', '良率周报', 'ECN/ECR记录', '售后数据分析'],
    tasks: [
      { id: 'mp1', name: '首批量产 (Ramp-up)', desc: '小批量爬坡，监控良率', owner: '工厂/PM', guide: '1) 首批 1K-5K 爬坡\n2) 日良率监控与异常响应\n3) 关键工位驻厂支持\n4) 客户样品确认' },
      { id: 'mp2', name: '良率监控与改善', desc: '日/周良率追踪、CAR处理', owner: 'QE/工厂', guide: '1) 每日 SMT/组装/测试良率报告\n2) Pareto 分析 Top 3 异常\n3) CAR 跟进与关闭' },
      { id: 'mp3', name: '产能爬坡', desc: '产能逐步提升至目标产能', owner: '工厂/PM', guide: '产能爬坡曲线:\n- 第 1 月: 30%\n- 第 2 月: 60%\n- 第 3 月: 100%' },
      { id: 'mp4', name: '工程变更管理', desc: 'ECN/ECR评审与执行', owner: 'PM/CM', guide: '1) ECR（变更申请）评估影响\n2) CCB（变更评审委员会）审批\n3) ECN（变更通知）执行与追踪' },
      { id: 'mp5', name: '售后问题跟踪', desc: 'RMA数据、市场反馈、FA分析', owner: '售后/QA', guide: '1) 月度 RMA 数据分析\n2) Top 3 失效模式 FA\n3) 客诉响应与改善\n4) 现场质量问题处理' },
      { id: 'mp6', name: '持续改善 (CIP)', desc: '成本优化、质量提升、周期缩短', owner: '跨部门', guide: '改善方向:\n- VAVE 降本\n- 工艺优化提良率\n- 周期 CT 缩短\n- 自动化升级' },
    ],
  },
];

export const PHASE_MAP: Record<string, SOPPhase> = SOP_PHASES.reduce(
  (acc, p) => ({ ...acc, [p.id]: p }),
  {}
);

export const buildPhasesData = (
  currentPhaseId: string,
  completedPhases: string[] = []
): Record<string, PhaseData> => {
  const data: Record<string, PhaseData> = {};
  SOP_PHASES.forEach((phase) => {
    const isCompleted = completedPhases.includes(phase.id);
    const tasks: Record<string, boolean> = {};
    const taskDetails: Record<string, TaskDetails> = {};
    phase.tasks.forEach((t) => {
      tasks[t.id] = isCompleted;
      taskDetails[t.id] = { instructions: '', files: [] };
    });
    data[phase.id] = { tasks, taskDetails, notes: '' };
  });
  return data;
};

export const normalizeProject = (project: Project): Project => {
  const phases = { ...project.phases };
  const projectPhases = getProjectPhases(project);
  projectPhases.forEach((phase) => {
    if (!phases[phase.id]) phases[phase.id] = { tasks: {}, taskDetails: {}, notes: '' };
    if (!phases[phase.id].taskDetails) phases[phase.id].taskDetails = {};
    phase.tasks.forEach((t) => {
      if (phases[phase.id].tasks[t.id] === undefined) phases[phase.id].tasks[t.id] = false;
      if (!phases[phase.id].taskDetails[t.id])
        phases[phase.id].taskDetails[t.id] = { instructions: '', files: [] };
    });
  });
  return { ...project, phases, phaseDates: project.phaseDates || {} };
};

export const computePhaseProgress = (
  phaseData: PhaseData | undefined,
  phaseId: string,
  phaseObj?: SOPPhase
): number => {
  const phase = phaseObj || PHASE_MAP[phaseId];
  if (!phase || !phaseData?.tasks) return 0;
  const total = phase.tasks.length;
  if (total === 0) return 0;
  const done = phase.tasks.filter((t) => phaseData.tasks[t.id]).length;
  return Math.round((done / total) * 100);
};

export const computeOverallProgress = (project: Project): number => {
  const phases = getProjectPhases(project);
  let totalTasks = 0;
  let doneTasks = 0;
  phases.forEach((phase) => {
    const pd = project.phases[phase.id];
    totalTasks += phase.tasks.length;
    if (pd?.tasks) doneTasks += phase.tasks.filter((t) => pd.tasks[t.id]).length;
  });
  if (totalTasks === 0) return 0;
  return Math.round((doneTasks / totalTasks) * 100);
};

export const getPhaseStatus = (
  project: Project,
  phaseId: string
): 'completed' | 'active' | 'pending' => {
  const phases = getProjectPhases(project);
  const idx = phases.findIndex((p) => p.id === phaseId);
  const currIdx = phases.findIndex((p) => p.id === project.currentPhase);
  const phaseObj = phases[idx];
  const progress = computePhaseProgress(project.phases[phaseId], phaseId, phaseObj);
  if (idx < currIdx) return 'completed';
  if (idx === currIdx) return progress === 100 ? 'completed' : 'active';
  return 'pending';
};

// ── Category-aware phase helpers ─────────────────────────────────────────────
// Import lazily to avoid circular deps; use dynamic require pattern
let _getPhasesForCategory: ((cat?: string) => SOPPhase[]) | null = null;
export const registerGetPhasesForCategory = (fn: (cat?: string) => SOPPhase[]) => {
  _getPhasesForCategory = fn;
};
export const getProjectPhases = (project: Project): SOPPhase[] => {
  if (_getPhasesForCategory) return _getPhasesForCategory(project.category as string | undefined);
  return SOP_PHASES;
};

/**
 * Returns true if the Gate Review task of the given phase is completed.
 * Uses the project's category-specific SOP phases.
 */
export const isPhaseGatePassed = (project: Project, phaseId: string): boolean => {
  const phases = getProjectPhases(project);
  const phase = phases.find((p) => p.id === phaseId);
  if (!phase) return true;
  const phaseData = project.phases[phaseId];
  if (!phaseData?.tasks) return false;
  return phaseData.tasks[phase.gateTaskId] === true;
};

/**
 * Returns true if a phase is unlocked (i.e., all previous phases' Gate tasks are done).
 * The first phase (P1) is always unlocked.
 */
export const isPhaseUnlocked = (project: Project, phaseId: string): boolean => {
  const phases = getProjectPhases(project);
  const idx = phases.findIndex((p) => p.id === phaseId);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    if (!isPhaseGatePassed(project, phases[i].id)) return false;
  }
  return true;
};

/**
 * Returns the blocking phase name if a phase is locked, or null if unlocked.
 */
export const getBlockingGate = (project: Project, phaseId: string): { phaseName: string; gateTaskName: string } | null => {
  const phases = getProjectPhases(project);
  const idx = phases.findIndex((p) => p.id === phaseId);
  if (idx <= 0) return null;
  for (let i = 0; i < idx; i++) {
    const prev = phases[i];
    if (!isPhaseGatePassed(project, prev.id)) {
      const gateTask = prev.tasks.find((t) => t.id === prev.gateTaskId);
      return { phaseName: prev.name, gateTaskName: gateTask?.name || prev.gate };
    }
  }
  return null;
};

export const RISK_CONFIG = {
  low: { label: '低', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  medium: { label: '中', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
  high: { label: '高', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200', dot: 'bg-rose-500' },
};

export const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export const SAMPLE_PROJECTS: Project[] = [
  {
    id: 'p001',
    code: 'CE-2026-001',
    name: 'AuraWatch Pro 智能手表',
    type: '可穿戴',
    pm: '张伟',
    startDate: '2026-01-08',
    targetDate: '2026-09-30',
    currentPhase: 'evt',
    risk: 'medium',
    phases: (() => {
      const d = buildPhasesData('evt', ['concept', 'planning', 'design']);
      d.evt.tasks = { e1: true, e2: true, e3: true, e4: true, e5: false, e6: false, e7: false };
      d.evt.taskDetails.e3 = {
        instructions: '本次 EVT 重点验证:\n• 续航目标 ≥ 7 天（典型使用场景）\n• 心率传感器精度 ±2bpm\n• 防水 5ATM 验证',
        files: [],
      };
      return d;
    })(),
  },
  {
    id: 'p002',
    code: 'CE-2026-002',
    name: 'PulseBuds 真无线耳机',
    type: '音频',
    pm: '李明',
    startDate: '2025-11-15',
    targetDate: '2026-06-15',
    currentPhase: 'dvt',
    risk: 'low',
    phases: (() => {
      const d = buildPhasesData('dvt', ['concept', 'planning', 'design', 'evt']);
      d.dvt.tasks = { v1: true, v2: true, v3: true, v4: true, v5: true, v6: false, v7: false, v8: false };
      return d;
    })(),
  },
  {
    id: 'p003',
    code: 'CE-2026-003',
    name: 'NovaCam 4K运动相机',
    type: '影像',
    pm: '王芳',
    startDate: '2026-02-20',
    targetDate: '2026-12-15',
    currentPhase: 'design',
    risk: 'high',
    phases: (() => {
      const d = buildPhasesData('design', ['concept', 'planning']);
      d.design.tasks = { d1: true, d2: true, d3: true, d4: false, d5: true, d6: false, d7: false, d8: false };
      return d;
    })(),
  },
  {
    id: 'p004',
    code: 'CE-2026-004',
    name: 'EcoSense 智能家居网关',
    type: 'IoT',
    pm: '陈静',
    startDate: '2025-08-01',
    targetDate: '2026-05-30',
    currentPhase: 'pvt',
    risk: 'medium',
    phases: (() => {
      const d = buildPhasesData('pvt', ['concept', 'planning', 'design', 'evt', 'dvt']);
      d.pvt.tasks = { pv1: true, pv2: true, pv3: true, pv4: true, pv5: false, pv6: false, pv7: false, pv8: false };
      return d;
    })(),
  },
  {
    id: 'p005',
    code: 'CE-2025-019',
    name: 'BeamSpeaker 智能音箱 Gen2',
    type: '音频',
    pm: '刘洋',
    startDate: '2025-03-10',
    targetDate: '2025-12-01',
    currentPhase: 'mp',
    risk: 'low',
    phases: (() => {
      const d = buildPhasesData('mp', ['concept', 'planning', 'design', 'evt', 'dvt', 'pvt']);
      d.mp.tasks = { mp1: true, mp2: true, mp3: true, mp4: false, mp5: false, mp6: false };
      return d;
    })(),
  },
];

// ── Issue Config ─────────────────────────────────────────────────────────────
export const SEVERITY_CONFIG: Record<IssueSeverity, {
  label: string; desc: string; color: string; bg: string; border: string; dot: string; textColor: string;
}> = {
  P0: { label: 'P0', desc: '严重缺陷', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', dot: 'bg-red-500', textColor: 'text-red-700' },
  P1: { label: 'P1', desc: '重要缺陷', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-300', dot: 'bg-orange-500', textColor: 'text-orange-700' },
  P2: { label: 'P2', desc: '一般缺陷', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', dot: 'bg-amber-500', textColor: 'text-amber-700' },
  P3: { label: 'P3', desc: '观察项', color: 'text-stone-600', bg: 'bg-stone-50', border: 'border-stone-300', dot: 'bg-stone-400', textColor: 'text-stone-600' },
};

export const STATUS_CONFIG: Record<IssueStatus, {
  label: string; color: string; bg: string; border: string;
}> = {
  open:        { label: '待处理', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200' },
  in_progress: { label: '处理中', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  resolved:    { label: '已解决', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  closed:      { label: '已关闭', color: 'text-stone-500', bg: 'bg-stone-100', border: 'border-stone-200' },
  wont_fix:    { label: '不修复', color: 'text-stone-400', bg: 'bg-stone-50', border: 'border-stone-200' },
};

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  hardware:    '硬件',
  software:    '软件',
  mechanical:  '结构',
  thermal:     '散热',
  reliability: '可靠性',
  safety:      '安规',
  performance: '性能',
  other:       '其他',
};

// Phases where Issue List is shown (validation phases)
export const ISSUE_PHASES = new Set(['evt', 'dvt', 'pvt', 'mp', 'design']);

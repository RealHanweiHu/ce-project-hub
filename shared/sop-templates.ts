// SOP Templates for different project categories.
// Shared by frontend display code and backend project seeding.

export interface SOPTask {
  id: string;
  name: string;
  desc: string;
  owner: string;
  guide: string;
  /**
   * Which project-member roles can see this task.
   * Empty array (default) = visible to ALL roles.
   */
  visibleRoles?: string[];
  /** 自动排期：任务工期（日历日）。缺省按 1 天处理。 */
  durationDays?: number;
  /** 自动排期：前置任务 id（finish-to-start；可指向上一阶段 gateTaskId）。缺省=阶段入口。 */
  dependsOn?: string[];
}

export interface SOPGateStandard {
  /** Conditions that must be true before a gate review can be scheduled. */
  entryCriteria: string[];
  /** Conditions that must be true before the phase can be closed or advanced. */
  exitCriteria: string[];
  /** Non-negotiable deliverables reviewed at the gate. */
  requiredDeliverables: string[];
  /** Roles accountable for preparing, reviewing, and approving this gate. */
  responsibleRoles: string[];
  /** Evidence that should be attached to the gate task before review closure. */
  evidenceRequirements: string[];
  /** Management response when the gate is not ready or not approved. */
  exceptionStrategy: string[];
}

export interface SOPPhase {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  duration: string;
  desc: string;
  gate: string;
  gateTaskId: string;
  deliverables: string[];
  gateStandard: SOPGateStandard;
  tasks: SOPTask[];
  color: string;
  /** 自动排期：进入本阶段前的缓冲天数（加在入口任务 start 前）。缺省 0。 */
  bufferDays?: number;
  /** 标记本阶段的 Gate 为 MP Release 的前置闸口（每个 category 仅一个）。 */
  isReleaseGate?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Category Definition
// ─────────────────────────────────────────────────────────────────────────────
export type ProjectCategory = 'npd' | 'eco' | 'idr';

export interface ProjectCategoryConfig {
  id: ProjectCategory;
  name: string;
  nameEn: string;
  badge: string;
  color: string;        // tailwind bg color
  textColor: string;    // tailwind text color
  borderColor: string;  // tailwind border color
  icon: string;         // emoji
  desc: string;
  phaseCount: number;
  typicalDuration: string;
  phases: SOPPhase[];
}

const NPD_GATE_STANDARDS: Record<string, SOPGateStandard> = {
  concept: {
    entryCriteria: [
      '目标客户、核心场景和商业假设已形成初稿',
      '竞品、用户需求、技术可行性和目标成本已有初步证据',
      'PM 已确认项目与公司产品策略和资源窗口匹配',
    ],
    exitCriteria: [
      '管理层批准立项范围、目标用户、核心卖点和商业目标',
      '关键技术、专利、供应链和成本风险均已登记责任人与验证计划',
      '项目进入规划阶段所需核心角色和预算窗口已确认',
    ],
    requiredDeliverables: ['市场调研报告', '产品概念书', '商业可行性分析', '立项申请书'],
    responsibleRoles: ['PM 负责材料与结论', 'R&D Lead 负责技术可行性', 'Finance/SCM 负责成本与供应风险', '管理层/Owner 负责立项决策'],
    evidenceRequirements: ['立项申请书签核记录', '竞品分析与 VoC 原始摘要', '技术 POC/专利检索记录', '商业测算表与风险清单'],
    exceptionStrategy: ['信息不足则退回补充调研或 POC', '商业价值不成立则暂停立项或降级为预研', '重大风险需形成管理层接受的豁免或关闭计划'],
  },
  planning: {
    entryCriteria: [
      '立项 Gate 已通过，项目范围和目标市场已冻结',
      'PM、核心研发、QA、SCM 等关键角色已明确',
      '关键需求、成本、认证和上市窗口没有未决重大分歧',
    ],
    exitCriteria: [
      'PRD/PSD、项目计划、风险清单和 BOM v0.1 已完成基线',
      '关键供应商、长交期物料和资源缺口已有应对计划',
      '团队对里程碑、验收口径和 Gate 节奏达成一致',
    ],
    requiredDeliverables: ['PRD产品需求文档', 'PSD产品规格书', '项目甘特图', 'BOM v0.1'],
    responsibleRoles: ['PM 负责需求与里程碑', 'R&D 负责规格可实现性', 'SCM 负责关键料件与供应商', '管理层/Owner 负责 Kickoff 决策'],
    evidenceRequirements: ['PRD/PSD 版本记录', '项目甘特图与关键路径', 'RACI/资源确认记录', 'BOM v0.1 与风险登记表'],
    exceptionStrategy: ['需求或规格未冻结则禁止进入设计冻结流程', '资源缺口需升级管理层协调', '关键物料风险需建立替代方案或调整计划'],
  },
  design: {
    entryCriteria: [
      'PRD/PSD 和项目计划已完成基线',
      'ID/MD/EE/SW 设计输入、目标成本和认证要求已明确',
      '关键料件样品、供应商窗口和工程资源已具备',
    ],
    exitCriteria: [
      'ID/MD/EE/SW 设计输出完成并通过跨部门评审',
      'DFM/DFA、BOM v1.0、关键料件定型和 EVT 计划已确认',
      '进入 EVT 的开放问题均有责任人、关闭日期或批准豁免',
    ],
    requiredDeliverables: ['ID外观图', 'MD结构图', 'PCB原理图&Layout', 'SW架构文档', 'BOM v1.0'],
    responsibleRoles: ['R&D Lead 负责设计完整性', 'PM 负责范围和节奏', 'QA/ME 负责可验证性与可制造性', '管理层/Owner 负责设计冻结批准'],
    evidenceRequirements: ['设计评审纪要', '图纸/原理图/Layout/架构文件版本', 'DFM/DFA Checklist', 'BOM v1.0 与 EVT Build Plan'],
    exceptionStrategy: ['设计输出不完整则不得释放 EVT 打样', '关键风险需建立整改清单或 Gate 条件通过', '成本偏离目标需提交管理层取舍决策'],
  },
  evt: {
    entryCriteria: [
      '设计冻结 Gate 已通过，EVT Build Plan 已批准',
      'EVT 样机、测试计划、调试资源和问题跟踪机制已就绪',
      '关键料件、PCB/FW 版本和样机编号规则已确认',
    ],
    exitCriteria: [
      '主要功能 Pass Rate 达到 95% 以上',
      'P0 问题全部关闭，P1 问题关闭或获得明确豁免',
      '设计问题清单、改板计划和 DVT 输入版本已冻结',
    ],
    requiredDeliverables: ['EVT样机 ≥10台', '功能测试报告', '问题清单 (Issue List)', 'PCB v2'],
    responsibleRoles: ['EE/SW/ME 负责问题定位与修正', 'QA 负责测试结论', 'PM 负责 Issue 闭环和 Gate 组织', '管理层/Owner 负责进入 DVT 决策'],
    evidenceRequirements: ['EVT 样机清单与版本照片', '功能/性能测试报告', 'Issue List 与关闭证据', 'PCB/FW 改版 ECN 或 Release Note'],
    exceptionStrategy: ['未达准出条件则安排 Re-EVT 或专项复测', '开放问题必须形成责任人、期限和影响评估', '影响 DVT 风险需升级为 Gate 条件通过或拒绝通过'],
  },
  dvt: {
    entryCriteria: [
      'EVT Gate 已通过，DVT 样机版本和测试矩阵已冻结',
      '认证、可靠性、模具和包装验证资源已排期',
      'EVT 遗留问题已关闭或获得进入 DVT 的批准豁免',
    ],
    exitCriteria: [
      '可靠性、认证、模具尺寸/外观和软件回归达到目标',
      '无未关闭 P0/P1 问题，量产关键风险已有控制计划',
      'BOM 成本、关键供应和 PVT 试产条件已确认',
    ],
    requiredDeliverables: ['DVT样机 ≥30台', '可靠性测试报告', '认证报告', '模具T1样品'],
    responsibleRoles: ['QA 负责可靠性与认证结论', 'R&D 负责设计整改', 'ME/SCM 负责工艺与供应准备', '管理层/Owner 负责进入 PVT 决策'],
    evidenceRequirements: ['DVT 样机 Build Record', '可靠性/认证测试报告', '模具 T1/T2 评审记录', 'BOM 成本确认与 PVT Readiness 清单'],
    exceptionStrategy: ['可靠性或认证失败必须复测并记录根因', '模具/外观不达标则冻结修模计划', '重大问题未关闭不得进入 PVT，除非有书面豁免和风险接受人'],
  },
  pvt: {
    entryCriteria: [
      'DVT Gate 已通过，量产工艺、治具和测试程序已准备',
      '试产物料齐套，SOP/WI 草案、培训计划和产线排程已确认',
      '关键质量标准、CTQ 和良率统计口径已冻结',
    ],
    exitCriteria: [
      '试产良率达到目标，关键异常已关闭或有受控计划',
      'SOP/WI、治具、测试程序、产能和人员培训全部就绪',
      '供应稳定性、包装物流和 MP Release 条件已确认',
    ],
    requiredDeliverables: ['试产50-300台', 'SOP/WI作业指导书', '良率报告', '治具与测试程序'],
    responsibleRoles: ['ME/工厂负责试产执行', 'QA 负责质量判定', 'SCM 负责物料与供应', 'PM/管理层负责 MP Release 决策'],
    evidenceRequirements: ['PVT 试产报告', '分工位良率与 FPY 数据', 'SOP/WI 与培训记录', '治具/测试程序验收记录'],
    exceptionStrategy: ['良率未达标则重复 PVT 或追加专项改善', '工艺/治具未就绪不得发布 MP', '供应风险需制定保供计划并由管理层确认'],
  },
  mp: {
    entryCriteria: [
      'PVT Gate 已通过，MP Release 文件包完整',
      '首批订单、产能、供应、OQC 和售后反馈机制已准备',
      '量产质量目标、爬坡节奏和异常升级路径已确认',
    ],
    exitCriteria: [
      '量产爬坡达到计划产能和良率目标',
      '关键质量、成本、交付和售后问题进入常态化管理',
      'ECN/ECR、RMA 和持续改善机制运行稳定',
    ],
    requiredDeliverables: ['量产产品', '良率周报', 'ECN/ECR记录', '售后数据分析'],
    responsibleRoles: ['工厂/ME 负责产能与工艺', 'QA 负责出货质量', 'SCM 负责供应连续性', 'PM/管理层负责量产经营目标'],
    evidenceRequirements: ['MP Release 记录', '周良率/产能/出货数据', 'OQC/RMA 分析', 'ECN/ECR 与 CAR 关闭记录'],
    exceptionStrategy: ['重大质量异常启动围堵、停线或召回评估', '良率/交付偏差进入管理层周会跟踪', '持续不达标需启动专项改善或工程变更'],
  },
};

const ECO_GATE_STANDARDS: Record<string, SOPGateStandard> = {
  planning: {
    entryCriteria: ['ECR 已提交并说明变更原因、范围和目标', '受影响产品、库存、认证和客户影响已初步识别', 'PM 已确认变更具备评审价值和资源窗口'],
    exitCriteria: ['CCB 批准 ECO 范围、收益、风险和验证策略', 'BOM 差异、成本影响、时程和资源计划已确认', 'ECO 编号、版本基线和责任分工已冻结'],
    requiredDeliverables: ['ECR变更申请书', '影响分析报告', 'BOM差异对比', '变更时程'],
    responsibleRoles: ['PM 负责 ECO 组织', 'R&D/QA 负责影响分析', 'SCM 负责库存和供应影响', 'CCB/管理层负责批准'],
    evidenceRequirements: ['ECR/CCB 评审记录', '影响分析矩阵', 'BOM 差异与成本测算', '变更计划和风险清单'],
    exceptionStrategy: ['收益或必要性不足则拒绝 ECO', '影响范围不清则退回补充分析', '高风险变更需管理层批准后进入设计'],
  },
  design: {
    entryCriteria: ['ECO Kickoff 已通过，变更范围和版本基线已冻结', '设计输入、测试影响和认证影响已明确', '新料件/新工艺样品或供应商支持已准备'],
    exitCriteria: ['硬件、结构、软件、工艺或包装变更设计完成', 'ECN 文件包、更新 BOM 和验证计划已确认', '变更后的制造、认证和供应风险已有控制措施'],
    requiredDeliverables: ['ECN工程变更通知', '更新后的原理图/PCB', '更新后的BOM', '变更设计评审报告'],
    responsibleRoles: ['R&D 负责变更设计', 'QA 负责验证和认证影响', 'ME/工厂负责制造影响', 'PM/CCB 负责设计冻结批准'],
    evidenceRequirements: ['变更前后设计差异文件', 'ECN 草案与更新 BOM', 'DFM/认证影响确认', '设计评审纪要'],
    exceptionStrategy: ['设计包不完整则不得进入验证', '认证或制造风险未闭环需增加验证项', '成本/交期偏差需回到 CCB 决策'],
  },
  evt: {
    entryCriteria: ['设计变更冻结 Gate 已通过', '变更样机、测试计划和回归范围已准备', '变更版本、旧版本基线和对比口径已确认'],
    exitCriteria: ['变更点专项验证通过', '核心功能回归无新增重大问题', '可靠性关键项达标或获得批准豁免'],
    requiredDeliverables: ['变更验证样机', '变更验证报告', '回归测试报告', '问题清单'],
    responsibleRoles: ['R&D 负责变更实现和问题修正', 'QA 负责验证结论', 'PM 负责 Issue 闭环', 'CCB/管理层负责进入试产决策'],
    evidenceRequirements: ['变更样机清单', '专项验证报告', '回归测试报告', '问题关闭记录和风险豁免'],
    exceptionStrategy: ['验证失败则退回设计整改', '新增问题需评估是否扩大回归范围', '高风险未闭环不得进入产线切换'],
  },
  pvt: {
    entryCriteria: ['变更验证 Gate 已通过，试产切换计划已批准', '产线、治具、SOP/WI、物料和人员培训已准备', '旧版本库存和在制品处理方案已明确'],
    exitCriteria: ['变更试产良率和质量达到切换目标', 'ECN 正式发布，文件包和培训完成', '库存/在制品切换风险受控'],
    requiredDeliverables: ['变更试产报告', '更新后的SOP/WI', '产线切换计划', '库存处理方案'],
    responsibleRoles: ['ME/工厂负责试产切换', 'QA 负责质量判定', 'SCM 负责库存与供应', 'PM/CCB 负责量产切换批准'],
    evidenceRequirements: ['试产良率报告', 'SOP/WI 更新记录', 'ECN 发布记录', '库存盘点和切换计划签核'],
    exceptionStrategy: ['试产或库存方案未达标则延后切换', '必要时执行分批切换或旧版本消耗策略', '重大质量风险需回退旧版本或重新验证'],
  },
  mp: {
    entryCriteria: ['变更量产切换 Gate 已通过，ECN 已生效', '变更后生产、质量和售后监控指标已定义', '旧版本收尾和市场/客户通知已完成或计划明确'],
    exitCriteria: ['变更目标达到预期并完成量化验证', '连续监控期内无新增重大质量或售后风险', 'ECO 文件、经验教训和关闭报告已归档'],
    requiredDeliverables: ['变更后良率报告', '变更效果验证报告', 'ECO关闭报告'],
    responsibleRoles: ['PM 负责 ECO 关闭', 'QA/工厂负责量产监控', 'SCM/售后负责外部影响跟踪', 'CCB/管理层负责关闭批准'],
    evidenceRequirements: ['连续量产监控数据', '变更前后指标对比', '售后/RMA 跟踪记录', 'ECO 关闭报告和复盘记录'],
    exceptionStrategy: ['效果未达预期则延长监控或重新打开 ECO', '质量恶化需启动 CAPA/回滚评估', '文件不完整不得关闭 ECO'],
  },
};

const IDR_GATE_STANDARDS: Record<string, SOPGateStandard> = {
  design: {
    entryCriteria: [
      '外观翻新 brief、目标市场、目标 SKU 和上市窗口已确认',
      '现有产品基线资料已收齐，包括 ID/MD/EE/BOM/包装/认证/测试报告',
      'PM 已确认本项目属于现有产品外观改版，而非全新平台开发',
    ],
    exitCriteria: [
      '翻新范围和受影响模块已冻结，明确 ID、结构、硬件接口、包装、物料和认证影响',
      '新物料、供应商、成本、认证路径和验证计划已形成可执行版本',
      '跨部门 RACI、里程碑和 Gate 节奏已确认',
    ],
    requiredDeliverables: ['IDR翻新 brief', '现有设计基线包', '影响分析矩阵', 'BOM差异与新物料清单', '认证路径预判', '项目计划'],
    responsibleRoles: ['PM 负责范围和节奏', 'ID/MD/EE 负责技术影响评估', 'SCM 负责新物料与供应', 'QA/认证负责验证和合规路径', '管理层/Owner 负责 Kickoff 批准'],
    evidenceRequirements: ['IDR brief 签核记录', '现有图纸/BOM/认证资料清单', '影响分析矩阵', '新物料供应风险与报价记录', '认证机构初步确认或内部合规判断'],
    exceptionStrategy: ['范围不清则不得进入设计', '新增核心功能、平台级硬件或电芯体系变化需升级为 ECO/NPD 决策', '认证或供应风险无法判断需补充评估后再 Gate'],
  },
  engineering: {
    entryCriteria: [
      'IDR Kickoff Gate 已通过，翻新范围、设计输入和项目计划已冻结',
      'ID、结构、硬件、包装、采购、QA 和认证负责人已明确',
      '关键新物料样品、供应商窗口和工程打样资源已准备',
    ],
    exitCriteria: [
      'ID/CMF、结构、硬件适配、包装标签和 BOM 更新已完成设计输出',
      '新物料规格、供应商打样、成本和交期已确认',
      '设计冻结版本满足验证样机制作和认证送样要求',
    ],
    requiredDeliverables: ['ID/CMF设计包', 'MD结构图纸', '硬件影响确认', '包装/标签设计稿', '更新BOM', '供应商样件'],
    responsibleRoles: ['ID 负责外观与 CMF', 'MD 负责结构和模具影响', 'EE 负责硬件接口与性能影响', 'SCM 负责新料件打样', 'QA/认证负责验证输入', '管理层/Owner 负责设计冻结批准'],
    evidenceRequirements: ['设计评审纪要', '3D/2D 图纸和样件照片', '硬件影响检查记录', '供应商样件/报价/交期确认', 'BOM 和认证资料版本记录'],
    exceptionStrategy: ['设计输出不完整则不得释放验证样机', '新物料未确认需冻结替代方案或调整排期', '硬件/结构风险未闭环需追加专项验证或升级 ECO'],
  },
  dvt: {
    entryCriteria: [
      '设计冻结 Gate 已通过，验证样机、测试矩阵和认证送样计划已准备',
      '外观、结构、硬件回归、可靠性、包装和认证影响项已明确',
      '外观检验标准草案和限度样本制作计划已确认',
    ],
    exitCriteria: [
      '外观可靠性、结构装配、功能性能回归和包装验证达到目标',
      '认证更新、Delta 认证或重新认证结论已完成并归档',
      '外观检验标准、限度样本和试产切换输入已完成',
    ],
    requiredDeliverables: ['验证样机', '可靠性/回归测试报告', '认证更新记录', '包装验证报告', '外观检验标准'],
    responsibleRoles: ['QA 负责可靠性与测试结论', 'MD/EE/ME 负责结构、硬件和工艺整改', 'ID/PM 负责外观判定', '认证负责人负责合规结论', '管理层/Owner 负责进入试产批准'],
    evidenceRequirements: ['验证样机 Build Record', '可靠性/装配/功能回归测试报告', '认证机构确认或 Delta/重测记录', '限度样本/检验标准文件', '问题清单和关闭证据'],
    exceptionStrategy: ['可靠性、功能或装配不达标则退回设计整改', '外观判定争议需形成限度样本', '认证影响不清或未通过不得进入试产切换'],
  },
  mp: {
    entryCriteria: [
      '验证与认证 Gate 已通过，量产物料、检验标准、SOP/WI 和试产排程已准备',
      '旧版库存、在制品、渠道切换和市场资料更新计划已确认',
      '产线、供应商和质量团队已完成新版本培训与首件准备',
    ],
    exitCriteria: [
      '小批试产或首批量产质量确认 OK，良率和外观合格率达到目标',
      '新旧版本库存、BOM、图纸、SOP/WI、认证和系统资料完成切换',
      '市场图片、文案、包装、渠道通知和售后识别规则已同步更新',
    ],
    requiredDeliverables: ['试产/首批量产产品', 'PVT或首批质量报告', 'SOP/WI更新记录', '版本切换计划', '市场上市计划'],
    responsibleRoles: ['ME/工厂负责试产与工艺', 'QA 负责首批质量和外观判定', 'SCM 负责物料与库存切换', 'PM/市场/销售负责上市资料', '管理层/Owner 负责 MP Release 批准'],
    evidenceRequirements: ['首件确认和试产检验记录', '分工位良率与外观合格率数据', 'SOP/WI 与培训记录', '库存和系统切换记录', '渠道/市场物料更新截图或签核'],
    exceptionStrategy: ['试产质量不稳定则暂停上市并追加改善', '物料或认证文件未切换完成不得 MP Release', '库存处理未闭环则限制渠道切换'],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// NPD — New Product Development (Full 7-phase)
// ─────────────────────────────────────────────────────────────────────────────
export const NPD_PHASES: SOPPhase[] = [
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
    gateStandard: NPD_GATE_STANDARDS.concept,
    tasks: [
      { id: 'c1', name: '市场调研与竞品分析', desc: '收集市场数据、竞品拆解、定价分析', owner: 'PM/BD', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 收集 TOP 5 竞品的硬件参数、定价、销量数据\n2) 拆解 2-3 款关键竞品（成本结构、用户评价）\n3) 输出竞品对比矩阵' },
      { id: 'c2', name: '用户需求收集 (VoC)', desc: 'Voice of Customer，用户访谈/问卷', owner: 'PM/UX', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 至少完成 15 位目标用户的深度访谈\n2) 发布在线问卷，目标样本 ≥ 200\n3) 提炼 Top 10 用户痛点与期望' },
      { id: 'c3', name: '产品概念定义', desc: '核心卖点、目标用户、关键场景', owner: 'PM', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 撰写一句话产品定义（Elevator Pitch）\n2) 定义 3 个核心卖点（USP）\n3) 绘制用户旅程地图' },
      { id: 'c4', name: '技术可行性评估', desc: '关键技术验证、专利检索', owner: 'R&D Lead', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 列出关键技术挑战清单\n2) 完成核心技术 POC\n3) 进行专利检索与规避分析' },
      { id: 'c5', name: '商业可行性分析', desc: '市场规模、定价、利润模型', owner: 'PM/Finance', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 建立 3 年销量预测模型\n2) 估算目标 BOM 成本与零售价\n3) 计算毛利率、回收期' },
      { id: 'c6', name: '立项评审 (Gate 1)', desc: '正式立项决策评审', owner: '管理层', visibleRoles: [], guide: '评审材料: 1) 产品概念书 2) 市场分析 3) 商业模型 4) 技术评估 5) 资源需求' },
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
    gateStandard: NPD_GATE_STANDARDS.planning,
    tasks: [
      { id: 'p1', name: '产品需求文档 (PRD)', desc: '完整的功能/非功能需求', owner: 'PM', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 功能需求（Feature List + User Story）\n2) 非功能需求（性能/安全/合规）\n3) 验收标准（Acceptance Criteria）' },
      { id: 'p2', name: '产品规格书 (PSD)', desc: '技术规格、性能指标', owner: 'R&D', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 硬件规格（主芯片/内存/接口）\n2) 软件规格（OS/协议栈/算法）\n3) 性能指标（功耗/续航/响应时间）' },
      { id: 'p3', name: '项目时程规划', desc: '里程碑、关键路径、资源排期', owner: 'PMO', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 制定 WBS\n2) 标注关键路径与风险节点\n3) 设置 Gate Review 时间点' },
      { id: 'p4', name: 'BOM初版', desc: '关键料件清单，预估成本', owner: 'EE/采购', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'], guide: '1) 列出所有关键器件\n2) 标注供应商、料号、单价\n3) 计算总 BOM 成本\n4) 识别长交期/单一来源器件' },
      { id: 'p5', name: '关键供应商初选', desc: 'IC、屏幕、电池等核心料件', owner: '采购', visibleRoles: ['scm', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 每个关键料件至少 2-3 家供应商\n2) 评估：价格/品质/产能/付款条件\n3) 索取样品与报价' },
      { id: 'p6', name: '团队组建与资源分配', desc: 'ID/MD/EE/SW/QA/PM', owner: 'PMO/HR', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 确认各模块负责人（RACI）\n2) 评估外包/内部资源比例\n3) 培训需求识别' },
      { id: 'p7', name: 'Kickoff会议', desc: '项目正式启动，目标对齐', owner: 'PM', visibleRoles: [], guide: '议程: 1) 项目背景与目标 2) 规格与需求 Walk-through 3) 时程与里程碑 4) 角色与职责' },
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
    gateStandard: NPD_GATE_STANDARDS.design,
    tasks: [
      { id: 'd1', name: 'ID 工业设计', desc: '外观造型、材质、CMF配色', owner: 'ID', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 草图发散（≥ 10 个方向）\n2) 3 套候选方案精化\n3) CMF（颜色/材质/工艺）定义\n4) 3D 渲染图与实体模型' },
      { id: 'd2', name: 'MD 结构设计', desc: '内部结构、装配、堆叠', owner: 'MD', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 内部空间堆叠（Layout）\n2) 装配工艺设计\n3) 公差分析（Tolerance Stack-up）' },
      { id: 'd3', name: 'EE 电子原理设计', desc: '电源/MCU/传感器/通信架构', owner: 'EE', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 系统框图设计\n2) 原理图绘制（Schematic）\n3) 电源树设计与功耗分析' },
      { id: 'd4', name: 'PCB Layout', desc: 'PCB布线、阻抗、EMC考量', owner: 'EE/PCB', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 板层规划与叠层设计\n2) 关键信号阻抗控制\n3) EMC/EMI 设计\n4) DRC 检查' },
      { id: 'd5', name: 'SW 软件架构', desc: 'Firmware架构、通信协议、APP', owner: 'SW', visibleRoles: ['rd_sw', 'pm', 'manager', 'owner'], guide: '1) 系统架构图（固件 + 云 + APP）\n2) 通信协议定义（BLE/WiFi/UART）\n3) OTA 升级方案' },
      { id: 'd6', name: 'DFM/DFA 评审', desc: '可制造/可装配性评审', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 工厂参与评审，识别制造风险\n2) DFM Checklist\n3) DFA Checklist' },
      { id: 'd7', name: '关键料件定型', desc: '主芯片、屏、电池规格冻结', owner: 'EE/采购', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'], guide: '1) 完成关键料件 2nd Source 验证\n2) 签订正式供货协议\n3) 锁定料件规格与供货计划' },
      { id: 'd8', name: '设计冻结评审 (Gate 3)', desc: 'Design Freeze，进入打样', owner: '跨部门', visibleRoles: [], guide: '评审: 1) ID/MD/EE/SW 设计完成度 2) BOM 成本 vs 目标 3) 关键风险 4) EVT 计划' },
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
    gateStandard: NPD_GATE_STANDARDS.evt,
    tasks: [
      { id: 'e1', name: '工程样机制作', desc: '手工焊接，≥10台用于验证', owner: 'EE/EMS', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) PCBA 打样（≥15 套，含备份）\n2) 整机组装（10-20 台）\n3) 标注样机版本与序号' },
      { id: 'e2', name: '功能测试 (FT)', desc: '所有功能点逐一验证', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 撰写 FT Test Plan\n2) 逐项测试，记录 Pass/Fail\n3) Bug 进入 Issue List' },
      { id: 'e3', name: '性能测试 (PT)', desc: '续航、信号、热设计、跌落初测', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 续航测试（典型/重度场景）\n2) 无线性能（RF Conducted/Radiated）\n3) 热成像与温升测试' },
      { id: 'e4', name: '软硬件联调', desc: 'Firmware与硬件配合调试', owner: 'SW/EE', visibleRoles: ['rd_sw', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) Bringup\n2) 驱动调试\n3) 协议联调\n4) 异常处理与稳定性优化' },
      { id: 'e5', name: '设计问题清单', desc: '记录bug、设计缺陷、改善方案', owner: 'PM/QA', visibleRoles: ['pm', 'qa', 'rd_hw', 'rd_sw', 'rd_mech', 'manager', 'owner'], guide: '每个 Issue 包含:\n- 现象描述\n- 根因分析\n- 改善方案\n- 责任人与改善期限' },
      { id: 'e6', name: 'PCB改板 (v2)', desc: '根据EVT问题做PCB改版', owner: 'EE', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 汇总 PCB 相关问题\n2) ECN（工程变更通知）\n3) PCB v2 重新 Layout' },
      { id: 'e7', name: 'EVT评审 (Gate 4)', desc: '是否达到进入DVT条件', owner: '跨部门', visibleRoles: [], guide: '评审标准:\n- 主要功能 Pass Rate ≥ 95%\n- 无 P0 级未解决问题\n- 性能初测达标' },
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
    gateStandard: NPD_GATE_STANDARDS.dvt,
    tasks: [
      { id: 'v1', name: 'DVT样机制作', desc: '半 SMT产线，≥30台', owner: 'EMS', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 半正式产线 SMT（≥50 PCBA）\n2) 整机组装（≥30 台）\n3) 模拟量产工艺' },
      { id: 'v2', name: '可靠性测试', desc: '跌落/高低温/湿度/震动/老化', owner: 'QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '标准测试矩阵:\n- 跌落 1.5m × 26 面\n- 高低温 -20℃ ~ 60℃\n- 湿热 40℃/95%RH × 96h\n- 振动测试' },
      { id: 'v3', name: '安规与认证', desc: 'CE/FCC/3C/RoHS/REACH', owner: 'QA/认证', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '认证清单:\n- 中国: SRRC, CCC\n- 欧盟: CE (RED, EMC, LVD), RoHS\n- 美国: FCC, UL\n- 其他目标市场认证' },
      { id: 'v4', name: '模具T1/T2试模', desc: '塑胶模具开模与试模', owner: 'MD/模厂', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 模具开模（4-6 周）\n2) T1 试模 - 准备认证样品\n3) T2 试模 - 修模\n4) 准备认证样品' },
      { id: 'v5', name: '软件功能完整测试', desc: '回归测试、压力测试', owner: 'SW/QA', visibleRoles: ['rd_sw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 完整回归测试\n2) 压力测试\n3) OTA 升级测试\n4) 多 APP/多设备并发测试' },
      { id: 'v6', name: '包装设计验证', desc: '包装跌落、运输测试', owner: '包装', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '1) 包装结构设计\n2) 包装跌落测试（ISTA 1A/3A）\n3) 运输振动测试\n4) 堆叠压力测试' },
      { id: 'v7', name: '量产工艺评估', desc: '与工厂确认SMT/组装工艺', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) PFMEA 工艺失效模式分析\n2) 关键工艺参数定义（CTQ）\n3) 治具与测试设备清单' },
      { id: 'v8', name: 'DVT评审 (Gate 5)', desc: '进入PVT前的关键评审', owner: '跨部门', visibleRoles: [], guide: '通过标准:\n- 可靠性测试全部 Pass\n- 认证测试通过\n- 模具尺寸/外观 OK\n- BOM 成本达标' },
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
    isReleaseGate: true,
    color: '#b45309',
    deliverables: ['试产50-300台', 'SOP/WI作业指导书', '良率报告', '治具与测试程序'],
    gateStandard: NPD_GATE_STANDARDS.pvt,
    tasks: [
      { id: 'pv1', name: '试产规划', desc: '产线排程、物料齐套、人员培训', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'scm', 'pm', 'manager', 'owner'], guide: '1) 试产数量与排程\n2) 物料齐套（BOM 100% Ready）\n3) 产线工位规划\n4) 作业人员培训' },
      { id: 'pv2', name: 'SOP/WI制定', desc: '生产标准作业流程、作业指导书', owner: 'ME/IE', visibleRoles: ['rd_mech', 'qa', 'pm', 'manager', 'owner'], guide: '每工位需输出:\n- SOP（Standard Operating Procedure）\n- WI（Work Instruction）\n- 品质检验标准' },
      { id: 'pv3', name: '治具与测试程序', desc: 'ATE/FCT/老化治具，测试软件', owner: '测试工程', visibleRoles: ['rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) ICT 治具\n2) FCT 治具\n3) 老化柜与自动化测试\n4) 测试程序与判定标准' },
      { id: 'pv4', name: '试产 (50-300台)', desc: '按量产工艺试制', owner: '工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 试产首件确认（FAI）\n2) 全程监控良率与异常\n3) 每小时记录 First Pass Yield' },
      { id: 'pv5', name: '良率分析与改善', desc: 'SMT/组装/测试良率追踪', owner: 'QE/ME', visibleRoles: ['qa', 'rd_hw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '良率目标:\n- SMT: ≥ 99%\n- 组装: ≥ 98%\n- FCT: ≥ 97%\n- 整机直通率: ≥ 95%' },
      { id: 'pv6', name: '包装与物流验证', desc: '完整包装、运输、仓储测试', owner: '包装/物流', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '1) 完整包装方案确认\n2) 装箱单 / 唛头设计\n3) 物流路径与运输测试\n4) 保税仓/海外仓方案' },
      { id: 'pv7', name: '品质标准固化', desc: 'IPQC/OQC标准、AQL等级', owner: 'QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) IPQC 制程巡检标准\n2) OQC 出货检验标准（AQL 0.65/1.0/2.5）\n3) 外观检验标准（限度样本）' },
      { id: 'pv8', name: 'PVT评审 (Gate 6)', desc: '量产准备就绪（Ready for MP）', owner: '跨部门', visibleRoles: [], guide: '量产 GO 条件:\n- 试产良率达标\n- SOP/WI 完整\n- 治具/产能就绪\n- 物料供应稳定' },
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
    gateStandard: NPD_GATE_STANDARDS.mp,
    tasks: [
      { id: 'mp1', name: '首批量产 (Ramp-up)', desc: '小批量爬坡，监控良率', owner: '工厂/PM', visibleRoles: ['scm', 'qa', 'pm', 'manager', 'owner'], guide: '1) 首批 1K-5K 爬坡\n2) 日良率监控与异常响应\n3) 关键工位驻厂支持\n4) 客户样品确认' },
      { id: 'mp2', name: '良率监控与改善', desc: '日/周良率追踪、CAR处理', owner: 'QE/工厂', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 每日 SMT/组装/测试良率报告\n2) Pareto 分析 Top 3 异常\n3) CAR 跟进与关闭' },
      { id: 'mp3', name: '产能爬坡', desc: '产能逐步提升至目标产能', owner: '工厂/PM', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '产能爬坡曲线:\n- 第 1 月: 30%\n- 第 2 月: 60%\n- 第 3 月: 100%' },
      { id: 'mp4', name: '工程变更管理', desc: 'ECN/ECR评审与执行', owner: 'PM/CM', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) ECR（变更申请）评估影响\n2) CCB（变更评审委员会）审批\n3) ECN（变更通知）执行与追踪' },
      { id: 'mp5', name: '售后问题跟踪', desc: 'RMA数据、市场反馈、FA分析', owner: '售后/QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 月度 RMA 数据分析\n2) Top 3 失效模式 FA\n3) 客诉响应与改善\n4) 现场质量问题处理' },
      { id: 'mp6', name: '持续改善 (CIP)', desc: '成本优化、质量提升、周期缩短', owner: '跨部门', visibleRoles: [], guide: '改善方向:\n- VAVE 降本\n- 工艺优化提良率\n- 周期 CT 缩短\n- 自动化升级' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ECO — Engineering Change Order / Iterative Upgrade (5-phase, skip P1)
// Starts from Planning, simplified tasks focused on changes
// ─────────────────────────────────────────────────────────────────────────────
export const ECO_PHASES: SOPPhase[] = [
  {
    id: 'planning',
    code: 'P1',
    name: '变更规划',
    nameEn: 'Change Planning',
    duration: '2-4周',
    desc: '变更范围定义与影响评估',
    gate: 'ECO Kickoff评审',
    gateTaskId: 'ep7',
    color: '#a16207',
    deliverables: ['ECR变更申请书', '影响分析报告', 'BOM差异对比', '变更时程'],
    gateStandard: ECO_GATE_STANDARDS.planning,
    tasks: [
      { id: 'ep1', name: '变更需求分析 (ECR)', desc: '明确变更原因、范围与目标', owner: 'PM/EE', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 填写 ECR（Engineering Change Request）\n2) 说明变更原因（成本/质量/功能/合规）\n3) 定义变更范围（硬件/软件/结构/包装）' },
      { id: 'ep2', name: '影响范围评估', desc: '评估变更对现有产品的影响', owner: 'EE/QA', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'qa', 'pm', 'manager', 'owner'], guide: '1) 影响分析矩阵（功能/可靠性/认证/成本）\n2) 识别需要重新测试的项目\n3) 评估是否需要重新认证' },
      { id: 'ep3', name: 'BOM 差异分析', desc: '新旧 BOM 对比，成本核算', owner: 'EE/采购', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'], guide: '1) 新旧 BOM 逐行对比\n2) 计算成本变化（±ΔCost）\n3) 确认新料件供应商与交期' },
      { id: 'ep4', name: '变更时程规划', desc: '里程碑、验证计划、上线时间', owner: 'PMO', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 制定变更验证计划\n2) 确认各阶段时程\n3) 识别关键路径与风险' },
      { id: 'ep5', name: '资源与供应商确认', desc: '确认变更所需资源与供应商', owner: '采购/ME', visibleRoles: ['scm', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 新料件样品申请\n2) 供应商 NDA/报价确认\n3) 内部资源排期' },
      { id: 'ep6', name: '变更评审委员会 (CCB)', desc: '跨部门评审变更方案', owner: '管理层/跨部门', visibleRoles: ['pm', 'manager', 'owner'], guide: '评审内容:\n1) 变更必要性与收益\n2) 风险与影响\n3) 资源与时程\n4) 正式批准 ECO' },
      { id: 'ep7', name: 'ECO Kickoff (Gate 1)', desc: '变更正式立项，进入设计', owner: 'PM', visibleRoles: [], guide: '确认事项:\n- ECO 编号与版本\n- 变更范围冻结\n- 团队分工确认\n- 时程基线确认' },
    ],
  },
  {
    id: 'design',
    code: 'P2',
    name: '变更设计',
    nameEn: 'Change Design',
    duration: '3-6周',
    desc: '针对变更内容的设计与验证',
    gate: '设计变更冻结',
    gateTaskId: 'ed6',
    color: '#0369a1',
    deliverables: ['ECN工程变更通知', '更新后的原理图/PCB', '更新后的BOM', '变更设计评审报告'],
    gateStandard: ECO_GATE_STANDARDS.design,
    tasks: [
      { id: 'ed1', name: '硬件设计变更', desc: '原理图/PCB/BOM 更新', owner: 'EE', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 更新原理图（Schematic）\n2) PCB Layout 修改\n3) BOM 更新（新料件替换）\n4) 设计 DRC 检查' },
      { id: 'ed2', name: '结构设计变更', desc: '结构/模具/装配变更（如适用）', owner: 'MD', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 结构图纸更新\n2) 模具修改评估（ECO 模具）\n3) 装配工艺变更' },
      { id: 'ed3', name: '软件变更', desc: 'Firmware/APP 适配更新（如适用）', owner: 'SW', visibleRoles: ['rd_sw', 'pm', 'manager', 'owner'], guide: '1) 驱动适配\n2) 功能调整\n3) OTA 升级包准备' },
      { id: 'ed4', name: 'DFM 变更评审', desc: '确认变更后的可制造性', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 工厂确认新工艺可行性\n2) 治具/测试程序更新评估\n3) 产线影响评估' },
      { id: 'ed5', name: '认证影响评估', desc: '判断是否需要重新认证', owner: 'QA/认证', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 与认证机构确认变更影响\n2) 如需重新认证，启动认证流程\n3) 更新认证文件' },
      { id: 'ed6', name: '设计变更冻结 (Gate 2)', desc: '变更设计完成，进入验证', owner: '跨部门', visibleRoles: [], guide: '评审:\n1) 变更设计完整性\n2) BOM 成本确认\n3) 认证计划\n4) 验证计划' },
    ],
  },
  {
    id: 'evt',
    code: 'P3',
    name: 'EVT 变更验证',
    nameEn: 'Change Verification',
    duration: '3-5周',
    desc: '变更内容的功能与性能验证',
    gate: '变更验证评审',
    gateTaskId: 'ev5',
    color: '#7c3aed',
    deliverables: ['变更验证样机', '变更验证报告', '回归测试报告', '问题清单'],
    gateStandard: ECO_GATE_STANDARDS.evt,
    tasks: [
      { id: 'ev1', name: '变更样机制作', desc: '制作变更后的验证样机', owner: 'EE/EMS', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 新 PCBA 打样\n2) 整机组装（≥5 台）\n3) 标注变更版本号' },
      { id: 'ev2', name: '变更点专项验证', desc: '针对变更内容的专项测试', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 变更点功能验证\n2) 性能对比测试（新旧对比）\n3) 记录测试数据' },
      { id: 'ev3', name: '回归测试', desc: '确认变更未影响其他功能', owner: 'QA', visibleRoles: ['qa', 'rd_sw', 'pm', 'manager', 'owner'], guide: '1) 核心功能回归测试\n2) 关键性能指标复测\n3) 与基线版本对比' },
      { id: 'ev4', name: '可靠性验证（关键项）', desc: '针对变更点的可靠性测试', owner: 'QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '根据变更影响范围选择:\n- 跌落测试\n- 温度循环\n- 寿命测试\n- 其他相关项' },
      { id: 'ev5', name: '变更验证评审 (Gate 3)', desc: '确认变更验证通过，进入试产', owner: '跨部门', visibleRoles: [], guide: '通过标准:\n- 变更点验证 Pass\n- 回归测试无新增问题\n- 可靠性验证达标' },
    ],
  },
  {
    id: 'pvt',
    code: 'P4',
    name: '变更试产',
    nameEn: 'Change PVT',
    duration: '2-4周',
    desc: '变更后的产线验证与切换',
    gate: '变更量产切换评审',
    gateTaskId: 'epv5',
    isReleaseGate: true,
    color: '#b45309',
    deliverables: ['变更试产报告', '更新后的SOP/WI', '产线切换计划', '库存处理方案'],
    gateStandard: ECO_GATE_STANDARDS.pvt,
    tasks: [
      { id: 'epv1', name: '产线变更准备', desc: '治具/物料/SOP 更新', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 更新 SOP/WI\n2) 治具修改或新制\n3) 测试程序更新\n4) 操作人员培训' },
      { id: 'epv2', name: '变更试产', desc: '小批量试产验证产线', owner: '工厂', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 试产数量（≥20 台）\n2) 首件确认（FAI）\n3) 全程良率监控' },
      { id: 'epv3', name: '库存与在制品处理', desc: '旧版本库存处理方案', owner: 'PM/供应链', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '1) 旧版本库存盘点\n2) 消耗计划或报废处理\n3) 在制品切换时间节点' },
      { id: 'epv4', name: 'ECN 正式发布', desc: '发布工程变更通知', owner: 'PM/CM', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 发布 ECN（Engineering Change Notice）\n2) 通知所有相关部门\n3) 更新产品文件包（BOM/图纸/SOP）' },
      { id: 'epv5', name: '变更量产切换评审 (Gate 4)', desc: '正式切换至变更后版本', owner: '跨部门', visibleRoles: [], guide: '切换 GO 条件:\n- 试产良率达标\n- 库存处理方案确认\n- SOP/WI 更新完成\n- ECN 正式发布' },
    ],
  },
  {
    id: 'mp',
    code: 'P5',
    name: 'MP 量产跟踪',
    nameEn: 'MP Monitoring',
    duration: '持续',
    desc: '变更后量产监控与问题跟踪',
    gate: '变更关闭评审',
    gateTaskId: 'em4',
    color: '#166534',
    deliverables: ['变更后良率报告', '变更效果验证报告', 'ECO关闭报告'],
    gateStandard: ECO_GATE_STANDARDS.mp,
    tasks: [
      { id: 'em1', name: '变更后量产监控', desc: '监控变更后的良率与质量', owner: 'QE/工厂', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 连续 4 周良率数据收集\n2) 与变更前基线对比\n3) 异常快速响应' },
      { id: 'em2', name: '变更效果验证', desc: '确认变更达到预期目标', owner: 'PM/QA', visibleRoles: ['pm', 'qa', 'manager', 'owner'], guide: '1) 对比变更前后的核心指标\n2) 成本节约核算\n3) 质量改善数据' },
      { id: 'em3', name: '售后影响跟踪', desc: '监控变更后的售后数据', owner: '售后/QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 变更后 RMA 数据追踪\n2) 与变更前对比\n3) 客诉处理' },
      { id: 'em4', name: 'ECO 关闭评审 (Gate 5)', desc: '确认变更目标达成，正式关闭 ECO', owner: '跨部门', visibleRoles: [], guide: '关闭条件:\n- 变更效果达到预期\n- 无遗留问题\n- 文件归档完整\n- 经验教训总结' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// IDR — ID Refresh / Appearance-Led Redesign (4-phase)
// Appearance refresh for existing products. It may trigger ID, MD, EE, new
// material procurement, packaging, manufacturing, and certification work.
// ─────────────────────────────────────────────────────────────────────────────
export const IDR_PHASES: SOPPhase[] = [
  {
    id: 'design',
    code: 'P1',
    name: '翻新范围评估',
    nameEn: 'Refresh Scoping',
    duration: '2-3周',
    desc: '定义外观翻新范围，评估 ID/结构/硬件/物料/认证影响',
    gate: 'IDR Kickoff评审',
    gateTaskId: 'ir6',
    color: '#0369a1',
    deliverables: ['IDR翻新 brief', '现有设计基线包', '影响分析矩阵', 'BOM差异与新物料清单', '认证路径预判', '项目计划'],
    gateStandard: IDR_GATE_STANDARDS.design,
    tasks: [
      { id: 'ir1', name: '翻新需求与边界定义', desc: '明确目标市场、目标 SKU、上市窗口和翻新边界', owner: 'PM/ID', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 定义翻新目标（外观升级/渠道定制/成本/合规）\n2) 锁定目标 SKU、目标市场和上市窗口\n3) 说明是否涉及外壳、按键、接口、铭牌、包装或内部堆叠' },
      { id: 'ir2', name: '现有设计基线盘点', desc: '收集旧版 ID/MD/EE/BOM/包装/认证资料', owner: 'PM/CM', visibleRoles: ['pm', 'rd_mech', 'rd_hw', 'qa', 'scm', 'manager', 'owner'], guide: '1) 汇总当前 ID 图、结构图、BOM、包装、标签和认证资料\n2) 确认当前量产问题、售后问题和客户限制\n3) 标记不可变更项与可优化项' },
      { id: 'ir3', name: '跨专业影响评估', desc: '评估外观翻新对结构、硬件、散热、装配和性能的影响', owner: 'MD/EE/QA', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) MD 评估外壳、模具、按键、密封、堆叠和装配影响\n2) EE 评估接口、线束、天线/RF、充电、电池空间、EMC 和测试影响\n3) QA 评估可靠性、安规、包装运输和售后识别风险' },
      { id: 'ir4', name: '新物料与供应策略', desc: '识别新外观件、包装、标签和潜在电子/结构料件', owner: 'SCM/采购', visibleRoles: ['scm', 'rd_mech', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 建立新旧 BOM 差异清单\n2) 确认新料号、供应商、MOQ、交期、报价和备选来源\n3) 对长交期、单一来源和认证相关物料建立风险计划' },
      { id: 'ir5', name: '认证路径预判', desc: '判断是否需要 Delta 认证、补测或重新认证', owner: 'QA/认证', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 按目标市场列出已有证书和报告\n2) 判断外壳、标签、电池、充电、RF/EMC、材料和包装变化对认证的影响\n3) 与认证机构或内部合规负责人确认送样、资料和周期' },
      { id: 'ir6', name: 'IDR Kickoff (Gate 1)', desc: '冻结翻新范围，批准进入跨专业设计', owner: '跨部门', visibleRoles: [], guide: '评审:\n1) 翻新范围和排除范围\n2) ID/MD/EE/SCM/QA/认证影响矩阵\n3) 新物料、成本和认证路径\n4) 项目计划、RACI 和 Gate 节奏' },
    ],
  },
  {
    id: 'engineering',
    code: 'P2',
    name: '跨专业设计',
    nameEn: 'Cross-Functional Design',
    duration: '4-8周',
    desc: '完成 ID/CMF、结构、硬件适配、包装标签、BOM 和供应商打样',
    gate: '设计冻结评审',
    gateTaskId: 'id7',
    color: '#7c3aed',
    deliverables: ['ID/CMF设计包', 'MD结构图纸', '硬件影响确认', '包装/标签设计稿', '更新BOM', '供应商样件'],
    gateStandard: IDR_GATE_STANDARDS.engineering,
    tasks: [
      { id: 'id1', name: 'ID/CMF 详细设计', desc: '外观造型、颜色、材质和表面工艺定义', owner: 'ID', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 输出外观方案、3D 渲染和 CMF 规格\n2) 定义颜色标准、材质牌号、纹理、光泽度和表面处理\n3) 准备实体色板、手板或样件用于评审' },
      { id: 'id2', name: '结构与模具设计', desc: '外壳、按键、接口、散热、堆叠和模具影响设计', owner: 'MD', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 更新 3D/2D 图纸、装配关系和公差\n2) 检查电池仓、气泵/马达、风道、接口、螺丝柱、密封和跌落风险\n3) 评估新开模、修模、治具和装配工艺影响' },
      { id: 'id3', name: '硬件适配确认', desc: '确认外观改版对 PCBA、接口、电源和射频性能的影响', owner: 'EE', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 检查 PCBA 固定、连接器、按键/屏幕/灯位、线束和测试点\n2) 评估充电口、电池、保护电路、温升、EMC/RF 和传感器开孔影响\n3) 如需硬件小改，输出原理图/PCB/BOM 更新和验证计划' },
      { id: 'id4', name: '包装/标签/铭牌设计', desc: '更新包装、说明书、机身标签和合规标识', owner: '包装/法规', visibleRoles: ['scm', 'qa', 'pm', 'manager', 'owner'], guide: '1) 更新包装结构、平面、说明书和装箱资料\n2) 确认机身铭牌、警示语、认证标识、批次编码和售后识别规则\n3) 评估电池运输资料、渠道标签和客户定制标签影响' },
      { id: 'id5', name: 'BOM/图纸/ECN 草案', desc: '建立新版本料号、图纸版本和工程变更文件包', owner: 'PM/CM', visibleRoles: ['pm', 'rd_mech', 'rd_hw', 'scm', 'qa', 'manager', 'owner'], guide: '1) 输出新旧 BOM 差异、料号申请和版本规则\n2) 更新图纸、规格书、包装文件和检验标准草案\n3) 准备 ECN/版本切换草案，明确旧料处理方式' },
      { id: 'id6', name: '供应商打样与FAI', desc: '完成新物料样件、包装样和首件确认', owner: 'SCM/MD/QA', visibleRoles: ['scm', 'rd_mech', 'qa', 'pm', 'manager', 'owner'], guide: '1) 组织外观件、结构件、标签、包装和相关电子料件打样\n2) 做颜色、纹理、尺寸、装配、功能和关键尺寸首件确认\n3) 记录样件问题、整改责任人和下一版样品计划' },
      { id: 'id7', name: '设计冻结评审 (Gate 2)', desc: '设计输出冻结，进入验证与认证', owner: '跨部门', visibleRoles: [], guide: '评审:\n1) ID/结构/硬件/包装设计完整性\n2) BOM 成本、供应商和交期\n3) 验证样机 Build Plan\n4) 认证送样和补测计划' },
    ],
  },
  {
    id: 'dvt',
    code: 'P3',
    name: '验证与认证',
    nameEn: 'DVT & Certification',
    duration: '4-8周',
    desc: '验证外观、结构、硬件回归、包装和认证更新',
    gate: '验证与认证评审',
    gateTaskId: 'iv7',
    color: '#0f766e',
    deliverables: ['验证样机', '可靠性/回归测试报告', '认证更新记录', '包装验证报告', '外观检验标准'],
    gateStandard: IDR_GATE_STANDARDS.dvt,
    tasks: [
      { id: 'iv1', name: '验证样机制作', desc: '按冻结版本制作整机样机和认证样品', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 使用冻结版外观件、结构件、包装和电子料件制作样机\n2) 标注样机版本、BOM 版本、供应商批次和用途\n3) 按测试、认证、客户确认和备份需求分配样机' },
      { id: 'iv2', name: '结构与装配验证', desc: '验证新外观件与内部件、工艺和治具的匹配', owner: 'MD/ME', visibleRoles: ['rd_mech', 'qa', 'pm', 'manager', 'owner'], guide: '1) 检查装配良率、关键尺寸、公差、干涉、密封和跌落风险\n2) 验证按钮、接口、屏幕/灯位、出风/进风/散热开孔和铭牌位置\n3) 记录修模、治具或工艺调整项' },
      { id: 'iv3', name: '功能与性能回归', desc: '确认外观改版未影响核心功能和电气性能', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 回归核心功能、充电/放电、按键/显示/传感器和保护功能\n2) 复测温升、续航、噪音、气压/流量、EMC/RF 等受影响项目\n3) 与量产基线版本做关键指标对比' },
      { id: 'iv4', name: '可靠性与外观耐久测试', desc: '验证新材料、涂装、结构和包装可靠性', owner: 'QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '测试项目按影响范围选择:\n- 跌落/振动/高低温/湿热/老化\n- 耐磨、耐汗液、耐化学品、UV 老化、盐雾\n- 包装跌落、运输振动、堆码\n- 新材料环保与相容性检查' },
      { id: 'iv5', name: '认证更新或重新认证', desc: '完成目标市场认证补测、Delta 或重新认证', owner: 'QA/认证', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 向认证机构提交变更说明、差异清单、图纸、BOM、标签和样品\n2) 按结论执行安规、EMC/RF、电池、材料、包装或标签相关补测\n3) 归档证书、报告、豁免说明和上市限制' },
      { id: 'iv6', name: '外观检验标准制定', desc: '制定新版本 AQL、限度样本和 OQC 标准', owner: 'QA/ID', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 定义颜色、纹理、光泽、划伤、色差、脏污、披锋和装配间隙标准\n2) 制作限度样本，明确光源、角度、距离和判定责任人\n3) 更新 IPQC/OQC 检验表和客户验货标准' },
      { id: 'iv7', name: '验证与认证评审 (Gate 3)', desc: '验证和认证通过，进入试产切换', owner: '跨部门', visibleRoles: [], guide: '通过标准:\n- 可靠性、结构装配和功能回归 Pass\n- 认证更新/补测/重新认证结论完成\n- 外观检验标准和限度样本完成\n- 试产物料、SOP/WI 和切换计划准备就绪' },
    ],
  },
  {
    id: 'mp',
    code: 'P4',
    name: '试产与量产切换',
    nameEn: 'MP Launch',
    duration: '3-6周',
    desc: '完成新版本试产、物料切换、文件发布和上市准备',
    gate: 'MP Release评审',
    gateTaskId: 'im6',
    isReleaseGate: true,
    color: '#166534',
    deliverables: ['试产/首批量产产品', 'PVT或首批质量报告', 'SOP/WI更新记录', '版本切换计划', '市场上市计划'],
    gateStandard: IDR_GATE_STANDARDS.mp,
    tasks: [
      { id: 'im1', name: '试产切换准备', desc: '准备新物料、SOP/WI、治具、测试程序和培训', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'scm', 'pm', 'manager', 'owner'], guide: '1) 确认新物料齐套、版本标识和首批采购计划\n2) 更新 SOP/WI、检验标准、治具、测试程序和包装作业指导\n3) 完成产线、IQC/IPQC/OQC 和售后识别培训' },
      { id: 'im2', name: '小批试产/首批确认', desc: '按量产工艺验证良率、外观和功能稳定性', owner: '工厂/QA', visibleRoles: ['qa', 'rd_mech', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 执行小批试产或首批量产确认\n2) 统计装配良率、外观合格率、测试良率和包装异常\n3) 对关键异常做原因分析、围堵和整改关闭' },
      { id: 'im3', name: '物料与库存切换', desc: '处理旧版库存、在制品、采购订单和系统版本', owner: 'PM/SCM', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '1) 盘点旧外观件、包装、标签、成品和在制品\n2) 制定消耗、返工、隔离、报废或渠道限制方案\n3) 更新 ERP/PLM/MES 版本、BOM 生效日期和采购切换节点' },
      { id: 'im4', name: '文件与认证资料发布', desc: '发布 ECN、图纸、BOM、检验标准和认证资料', owner: 'PM/CM/QA', visibleRoles: ['pm', 'qa', 'scm', 'manager', 'owner'], guide: '1) 发布 ECN/版本切换通知\n2) 归档图纸、BOM、包装、标签、SOP/WI、检验标准和认证文件\n3) 通知工厂、供应商、销售、售后和客户相关窗口' },
      { id: 'im5', name: '市场与渠道切换', desc: '同步新版本图片、文案、包装和售后识别规则', owner: '市场/销售/PM', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 更新产品图片、详情页、说明书、包装图和渠道资料\n2) 明确新旧版本命名、SKU、条码、销售区域和上市日期\n3) 向销售、客服和售后说明版本差异和识别方式' },
      { id: 'im6', name: 'MP Release评审 (Gate 4)', desc: '批准新版本量产和正式上市', owner: '跨部门', visibleRoles: [], guide: 'Release 条件:\n- 试产或首批质量 OK\n- 良率、外观合格率和关键功能达标\n- 新旧物料和系统切换完成\n- 文件、认证、市场和渠道资料发布完成' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Category Registry
// ─────────────────────────────────────────────────────────────────────────────
export const PROJECT_CATEGORIES: ProjectCategoryConfig[] = [
  {
    id: 'npd',
    name: '新产品开发',
    nameEn: 'New Product Development',
    badge: 'NPD',
    color: 'bg-blue-50',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-300',
    icon: '🚀',
    desc: '全新品类产品，从0到1完整开发流程，包含概念立项、规划、设计、EVT/DVT/PVT 验证到量产，共 7 个阶段。',
    phaseCount: 7,
    typicalDuration: '约 3-4 个月',
    phases: NPD_PHASES,
  },
  {
    id: 'eco',
    name: '迭代升级',
    nameEn: 'Engineering Change Order',
    badge: 'ECO',
    color: 'bg-amber-50',
    textColor: 'text-amber-800',
    borderColor: 'border-amber-300',
    icon: '🔄',
    desc: '现有产品的硬件/软件/结构迭代升级，如换芯片、增功能、降成本，跳过概念阶段，共 5 个阶段。',
    phaseCount: 5,
    typicalDuration: '约 2-3 个月',
    phases: ECO_PHASES,
  },
  {
    id: 'idr',
    name: '外观翻新',
    nameEn: 'ID Refresh',
    badge: 'IDR',
    color: 'bg-teal-50',
    textColor: 'text-teal-800',
    borderColor: 'border-teal-300',
    icon: '🎨',
    desc: '现有产品的外观翻新/外观改版，可能牵动 ID、结构、硬件接口、包装标签、新物料采购和认证更新，共 4 个阶段。',
    phaseCount: 4,
    typicalDuration: '约 2-3 个月',
    phases: IDR_PHASES,
  },
];

export const CATEGORY_MAP: Record<ProjectCategory, ProjectCategoryConfig> = {
  npd: PROJECT_CATEGORIES[0],
  eco: PROJECT_CATEGORIES[1],
  idr: PROJECT_CATEGORIES[2],
};

/**
 * Get the SOP phases for a project based on its category.
 * Falls back to NPD phases if category is not set.
 */
export const getPhasesForCategory = (category?: string): SOPPhase[] => {
  if (!category) return NPD_PHASES;
  return CATEGORY_MAP[category as ProjectCategory]?.phases || NPD_PHASES;
};

/** 定位某 category 的「MP Release 前置 Gate」所在 phase；未定义返回 null。 */
export const getReleaseGatePhase = (category?: string): SOPPhase | null =>
  getPhasesForCategory(category).find((p) => p.isReleaseGate) ?? null;

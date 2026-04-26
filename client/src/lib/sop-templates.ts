// SOP Templates for different project categories
// NPD  = New Product Development (full 7-phase)
// ECO  = Engineering Change Order / Iterative upgrade (5-phase, skip P1 concept)
// IDR  = ID Refresh / Cosmetic change only (3-phase: design + DVT + MP)

import { SOPPhase } from './data';

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
    tasks: [
      { id: 'ep1', name: '变更需求分析 (ECR)', desc: '明确变更原因、范围与目标', owner: 'PM/EE', guide: '1) 填写 ECR（Engineering Change Request）\n2) 说明变更原因（成本/质量/功能/合规）\n3) 定义变更范围（硬件/软件/结构/包装）' },
      { id: 'ep2', name: '影响范围评估', desc: '评估变更对现有产品的影响', owner: 'EE/QA', guide: '1) 影响分析矩阵（功能/可靠性/认证/成本）\n2) 识别需要重新测试的项目\n3) 评估是否需要重新认证' },
      { id: 'ep3', name: 'BOM 差异分析', desc: '新旧 BOM 对比，成本核算', owner: 'EE/采购', guide: '1) 新旧 BOM 逐行对比\n2) 计算成本变化（±ΔCost）\n3) 确认新料件供应商与交期' },
      { id: 'ep4', name: '变更时程规划', desc: '里程碑、验证计划、上线时间', owner: 'PMO', guide: '1) 制定变更验证计划\n2) 确认各阶段时程\n3) 识别关键路径与风险' },
      { id: 'ep5', name: '资源与供应商确认', desc: '确认变更所需资源与供应商', owner: '采购/ME', guide: '1) 新料件样品申请\n2) 供应商 NDA/报价确认\n3) 内部资源排期' },
      { id: 'ep6', name: '变更评审委员会 (CCB)', desc: '跨部门评审变更方案', owner: '管理层/跨部门', guide: '评审内容:\n1) 变更必要性与收益\n2) 风险与影响\n3) 资源与时程\n4) 正式批准 ECO' },
      { id: 'ep7', name: 'ECO Kickoff (Gate 1)', desc: '变更正式立项，进入设计', owner: 'PM', guide: '确认事项:\n- ECO 编号与版本\n- 变更范围冻结\n- 团队分工确认\n- 时程基线确认' },
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
    tasks: [
      { id: 'ed1', name: '硬件设计变更', desc: '原理图/PCB/BOM 更新', owner: 'EE', guide: '1) 更新原理图（Schematic）\n2) PCB Layout 修改\n3) BOM 更新（新料件替换）\n4) 设计 DRC 检查' },
      { id: 'ed2', name: '结构设计变更', desc: '结构/模具/装配变更（如适用）', owner: 'MD', guide: '1) 结构图纸更新\n2) 模具修改评估（ECO 模具）\n3) 装配工艺变更' },
      { id: 'ed3', name: '软件变更', desc: 'Firmware/APP 适配更新（如适用）', owner: 'SW', guide: '1) 驱动适配\n2) 功能调整\n3) OTA 升级包准备' },
      { id: 'ed4', name: 'DFM 变更评审', desc: '确认变更后的可制造性', owner: 'ME/工厂', guide: '1) 工厂确认新工艺可行性\n2) 治具/测试程序更新评估\n3) 产线影响评估' },
      { id: 'ed5', name: '认证影响评估', desc: '判断是否需要重新认证', owner: 'QA/认证', guide: '1) 与认证机构确认变更影响\n2) 如需重新认证，启动认证流程\n3) 更新认证文件' },
      { id: 'ed6', name: '设计变更冻结 (Gate 2)', desc: '变更设计完成，进入验证', owner: '跨部门', guide: '评审:\n1) 变更设计完整性\n2) BOM 成本确认\n3) 认证计划\n4) 验证计划' },
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
    tasks: [
      { id: 'ev1', name: '变更样机制作', desc: '制作变更后的验证样机', owner: 'EE/EMS', guide: '1) 新 PCBA 打样\n2) 整机组装（≥5 台）\n3) 标注变更版本号' },
      { id: 'ev2', name: '变更点专项验证', desc: '针对变更内容的专项测试', owner: 'QA/EE', guide: '1) 变更点功能验证\n2) 性能对比测试（新旧对比）\n3) 记录测试数据' },
      { id: 'ev3', name: '回归测试', desc: '确认变更未影响其他功能', owner: 'QA', guide: '1) 核心功能回归测试\n2) 关键性能指标复测\n3) 与基线版本对比' },
      { id: 'ev4', name: '可靠性验证（关键项）', desc: '针对变更点的可靠性测试', owner: 'QA', guide: '根据变更影响范围选择:\n- 跌落测试\n- 温度循环\n- 寿命测试\n- 其他相关项' },
      { id: 'ev5', name: '变更验证评审 (Gate 3)', desc: '确认变更验证通过，进入试产', owner: '跨部门', guide: '通过标准:\n- 变更点验证 Pass\n- 回归测试无新增问题\n- 可靠性验证达标' },
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
    color: '#b45309',
    deliverables: ['变更试产报告', '更新后的SOP/WI', '产线切换计划', '库存处理方案'],
    tasks: [
      { id: 'epv1', name: '产线变更准备', desc: '治具/物料/SOP 更新', owner: 'ME/工厂', guide: '1) 更新 SOP/WI\n2) 治具修改或新制\n3) 测试程序更新\n4) 操作人员培训' },
      { id: 'epv2', name: '变更试产', desc: '小批量试产验证产线', owner: '工厂', guide: '1) 试产数量（≥20 台）\n2) 首件确认（FAI）\n3) 全程良率监控' },
      { id: 'epv3', name: '库存与在制品处理', desc: '旧版本库存处理方案', owner: 'PM/供应链', guide: '1) 旧版本库存盘点\n2) 消耗计划或报废处理\n3) 在制品切换时间节点' },
      { id: 'epv4', name: 'ECN 正式发布', desc: '发布工程变更通知', owner: 'PM/CM', guide: '1) 发布 ECN（Engineering Change Notice）\n2) 通知所有相关部门\n3) 更新产品文件包（BOM/图纸/SOP）' },
      { id: 'epv5', name: '变更量产切换评审 (Gate 4)', desc: '正式切换至变更后版本', owner: '跨部门', guide: '切换 GO 条件:\n- 试产良率达标\n- 库存处理方案确认\n- SOP/WI 更新完成\n- ECN 正式发布' },
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
    tasks: [
      { id: 'em1', name: '变更后量产监控', desc: '监控变更后的良率与质量', owner: 'QE/工厂', guide: '1) 连续 4 周良率数据收集\n2) 与变更前基线对比\n3) 异常快速响应' },
      { id: 'em2', name: '变更效果验证', desc: '确认变更达到预期目标', owner: 'PM/QA', guide: '1) 对比变更前后的核心指标\n2) 成本节约核算\n3) 质量改善数据' },
      { id: 'em3', name: '售后影响跟踪', desc: '监控变更后的售后数据', owner: '售后/QA', guide: '1) 变更后 RMA 数据追踪\n2) 与变更前对比\n3) 客诉处理' },
      { id: 'em4', name: 'ECO 关闭评审 (Gate 5)', desc: '确认变更目标达成，正式关闭 ECO', owner: '跨部门', guide: '关闭条件:\n- 变更效果达到预期\n- 无遗留问题\n- 文件归档完整\n- 经验教训总结' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// IDR — ID Refresh / Cosmetic Change (3-phase)
// Only appearance changes: new colors, materials, packaging — no hardware change
// ─────────────────────────────────────────────────────────────────────────────
export const IDR_PHASES: SOPPhase[] = [
  {
    id: 'design',
    code: 'P1',
    name: '外观设计',
    nameEn: 'ID Design',
    duration: '4-8周',
    desc: '新外观/CMF/包装设计与冻结',
    gate: '外观设计冻结评审',
    gateTaskId: 'ir6',
    color: '#0369a1',
    deliverables: ['新CMF方案', '3D渲染图', '实体色板/材料样本', '包装设计稿', 'BOM差异表'],
    tasks: [
      { id: 'ir1', name: '外观方向定义', desc: '新配色/材质/工艺方向', owner: 'ID/PM', guide: '1) 市场趋势与竞品外观分析\n2) 提出 3 套 CMF 方案\n3) 内部评选确定方向' },
      { id: 'ir2', name: 'CMF 详细设计', desc: '颜色/材质/工艺规格定义', owner: 'ID', guide: '1) 颜色标准（Pantone/RAL）\n2) 材质规格（塑胶/金属/涂装工艺）\n3) 表面处理工艺（喷涂/阳极/UV）\n4) 3D 渲染图与实体色板' },
      { id: 'ir3', name: '供应商打样', desc: '外观件/包装打样确认', owner: 'MD/采购', guide: '1) 外观件供应商打样（≥3 套）\n2) 颜色/纹理/光泽度确认\n3) 包装打样确认' },
      { id: 'ir4', name: '包装设计更新', desc: '新外观对应的包装更新', owner: '包装/ID', guide: '1) 包装平面设计更新\n2) 包装结构确认（无需重新验证）\n3) 印刷打样确认' },
      { id: 'ir5', name: 'BOM 差异确认', desc: '外观件 BOM 变更与成本核算', owner: 'EE/采购', guide: '1) 外观件 BOM 更新\n2) 成本对比（新旧外观件）\n3) 供应商报价确认' },
      { id: 'ir6', name: '外观设计冻结 (Gate 1)', desc: '外观方案冻结，进入验证', owner: '跨部门', guide: '评审:\n1) CMF 方案最终确认\n2) 供应商打样 OK\n3) 成本在目标范围内\n4) 包装设计确认' },
    ],
  },
  {
    id: 'dvt',
    code: 'P2',
    name: '外观验证',
    nameEn: 'Appearance DVT',
    duration: '3-5周',
    desc: '外观件可靠性与认证验证',
    gate: '外观验证评审',
    gateTaskId: 'iv5',
    color: '#0f766e',
    deliverables: ['外观验证样机', '外观可靠性报告', '颜色/材质认证（如需）', '外观检验标准'],
    tasks: [
      { id: 'iv1', name: '外观件可靠性测试', desc: '涂装/材质耐久性验证', owner: 'QA', guide: '测试项目:\n- 耐磨测试（RCA/橡皮擦）\n- 耐汗液/耐化妆品\n- 高低温循环（外观变化）\n- 紫外线老化\n- 盐雾测试（金属件）' },
      { id: 'iv2', name: '整机组装验证', desc: '新外观件与现有内部件的配合', owner: 'MD/ME', guide: '1) 装配合格率验证\n2) 公差配合检查\n3) 外观件与内部件干涉检查' },
      { id: 'iv3', name: '外观检验标准制定', desc: '制定新外观的 AQL 检验标准', owner: 'QA', guide: '1) 外观缺陷分级（Critical/Major/Minor）\n2) 限度样本制作\n3) 光源/角度/距离标准' },
      { id: 'iv4', name: '认证更新（如需）', desc: '外观变更是否影响现有认证', owner: 'QA/认证', guide: '1) 与认证机构确认外观变更影响\n2) 提交 Delta 认证（如需）\n3) 更新认证文件' },
      { id: 'iv5', name: '外观验证评审 (Gate 2)', desc: '外观验证通过，进入量产', owner: '跨部门', guide: '通过标准:\n- 外观可靠性测试 Pass\n- 装配合格率 ≥ 98%\n- 外观检验标准完成\n- 认证更新完成（如需）' },
    ],
  },
  {
    id: 'mp',
    code: 'P3',
    name: 'MP 量产切换',
    nameEn: 'MP Launch',
    duration: '2-4周',
    desc: '新外观量产切换与上市',
    gate: '新外观上市评审',
    gateTaskId: 'im4',
    color: '#166534',
    deliverables: ['新外观量产产品', '外观切换报告', '市场上市计划'],
    tasks: [
      { id: 'im1', name: '产线外观切换准备', desc: '物料备料、SOP 更新、人员培训', owner: 'ME/工厂', guide: '1) 新外观件备料（按首批量）\n2) 外观检验 SOP 更新\n3) 产线人员外观检验培训' },
      { id: 'im2', name: '首批量产确认', desc: '新外观首批量产质量确认', owner: '工厂/QA', guide: '1) 首件确认（FAI）\n2) 外观检验合格率统计\n3) 客户样品确认（如需）' },
      { id: 'im3', name: '旧外观库存处理', desc: '旧外观版本库存消化方案', owner: 'PM/供应链', guide: '1) 旧外观库存盘点\n2) 消化计划（促销/捆绑/报废）\n3) 渠道切换时间节点' },
      { id: 'im4', name: '新外观上市评审 (Gate 3)', desc: '确认新外观正式上市', owner: '跨部门', guide: '上市 GO 条件:\n- 首批量产质量 OK\n- 库存处理方案确认\n- 市场物料（图片/文案）更新\n- 渠道通知完成' },
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
    typicalDuration: '12-18 个月',
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
    typicalDuration: '3-6 个月',
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
    desc: '仅更换外观颜色、材质、CMF 或包装，内部硬件不变，流程精简为设计、验证、量产切换共 3 个阶段。',
    phaseCount: 3,
    typicalDuration: '2-3 个月',
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

/**
 * Build initial phase data for a new project based on category.
 */
export const buildPhasesDataForCategory = (
  category: ProjectCategory,
  currentPhaseId: string,
  completedPhaseIds: string[] = []
): Record<string, PhaseData> => {
  const phases = getPhasesForCategory(category);
  const data: Record<string, PhaseData> = {};
  phases.forEach((phase) => {
    const isCompleted = completedPhaseIds.includes(phase.id);
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

// Re-export PhaseData and TaskDetails for convenience
import type { PhaseData, TaskDetails } from './data';

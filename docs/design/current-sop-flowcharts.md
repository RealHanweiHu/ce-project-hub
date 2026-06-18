# 当前 SOP 流程图

> 来源：`shared/sop-templates.ts` 当前模板定义。  
> 范围：NPD 新产品开发、ECO 迭代升级、IDR 外观翻新。  
> 说明：标记为 `MP Release 前置 Gate` 的节点是系统量产发布硬闸口的语义锚点。

## SOP 总览

```mermaid
flowchart LR
  Start["项目创建"] --> Category{"选择项目类别"}

  Category --> NPD["NPD 新产品开发<br/>全新品类/平台/派生开发<br/>7 个阶段"]
  Category --> ECO["ECO 迭代升级<br/>现有产品工程变更<br/>5 个阶段"]
  Category --> IDR["IDR 外观翻新<br/>现有产品外观/结构/包装改版<br/>4 个阶段"]

  NPD --> NPDRelease["PVT: MP准备就绪评审<br/>MP Release 前置 Gate"]
  ECO --> ECORelease["PVT: 变更量产切换评审<br/>MP Release 前置 Gate"]
  IDR --> IDRRelease["MP: MP Release评审<br/>MP Release 前置 Gate"]

  NPDRelease --> Revision["量产发布<br/>生成/更新产品 Revision"]
  ECORelease --> Revision
  IDRRelease --> Revision

  Revision --> Product["产品进入量产/维护<br/>后续变更走新项目闭环"]

  classDef release fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:2px;
  class NPDRelease,ECORelease,IDRRelease,Revision release;
```

## NPD 新产品开发

```mermaid
flowchart LR
  N0["开始<br/>新产品开发项目"] --> N1["P1 概念阶段<br/>2-4周<br/>Gate: 立项评审 / Project Charter<br/>交付物: 市场调研报告、产品概念书、商业可行性分析、立项申请书"]
  N1 --> N2["P2 规划阶段<br/>3-4月<br/>Gate: Kickoff评审<br/>交付物: PRD、PSD、项目甘特图、BOM v0.1"]
  N2 --> N3["P3 设计阶段<br/>6-12周<br/>Gate: 设计冻结评审<br/>交付物: ID外观图、MD结构图、PCB原理图&Layout、SW架构文档、BOM v1.0"]
  N3 --> N4["P4 EVT 工程验证<br/>4-6周<br/>Gate: EVT评审<br/>交付物: EVT样机、功能测试报告、问题清单、PCB v2"]
  N4 --> N5["P5 DVT 设计验证<br/>4-8周<br/>Gate: DVT评审<br/>交付物: DVT样机、可靠性测试报告、认证报告、模具T1样品"]
  N5 --> N6["P6 PVT 试产验证<br/>3-6周<br/>Gate: MP准备就绪评审<br/>交付物: 试产50-300台、SOP/WI、良率报告、治具与测试程序"]
  N6 --> NRelease["MP Release<br/>服务端硬闸口<br/>产品关联、P0/P1、交付物、Gate决议校验"]
  NRelease --> N7["P7 MP 量产阶段<br/>持续<br/>Gate: 产品交付/EOL<br/>交付物: 量产产品、良率周报、ECN/ECR记录、售后数据分析"]
  N7 --> NEnd["持续改善 / EOL"]

  classDef release fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:2px;
  class N6,NRelease release;
```

### NPD 任务骨架

```mermaid
flowchart TB
  subgraph N1["P1 概念阶段"]
    C1["市场调研与竞品分析"] --> C2["用户需求收集 (VoC)"] --> C3["产品概念定义"]
    C3 --> C4["技术可行性评估"] --> C5["商业可行性分析"] --> C6["立项评审 (Gate 1)"]
  end

  subgraph N2["P2 规划阶段"]
    P1["产品需求文档 (PRD)"] --> P2["产品规格书 (PSD)"] --> P3["项目时程规划"]
    P3 --> P4["BOM初版"] --> P5["关键供应商初选"] --> P6["团队组建与资源分配"] --> P7["Kickoff会议"]
  end

  subgraph N3["P3 设计阶段"]
    D1["ID 工业设计"] --> D2["MD 结构设计"] --> D3["EE 电子原理设计"] --> D4["PCB Layout"]
    D4 --> D5["SW 软件架构"] --> D6["DFM/DFA 评审"] --> D7["关键料件定型"] --> D8["设计冻结评审 (Gate 3)"]
  end

  subgraph N4["P4 EVT 工程验证"]
    E1["工程样机制作"] --> E2["功能测试 (FT)"] --> E3["性能测试 (PT)"] --> E4["软硬件联调"]
    E4 --> E5["设计问题清单"] --> E6["PCB改板 (v2)"] --> E7["EVT评审 (Gate 4)"]
  end

  subgraph N5["P5 DVT 设计验证"]
    V1["DVT样机制作"] --> V2["可靠性测试"] --> V3["安规与认证"] --> V4["模具T1/T2试模"]
    V4 --> V5["软件功能完整测试"] --> V6["包装设计验证"] --> V7["量产工艺评估"] --> V8["DVT评审 (Gate 5)"]
  end

  subgraph N6["P6 PVT 试产验证"]
    PV1["试产规划"] --> PV2["SOP/WI制定"] --> PV3["治具与测试程序"] --> PV4["试产 (50-300台)"]
    PV4 --> PV5["良率分析与改善"] --> PV6["包装与物流验证"] --> PV7["品质标准固化"] --> PV8["PVT评审 (Gate 6)"]
  end

  subgraph N7["P7 MP 量产阶段"]
    MP1["首批量产 (Ramp-up)"] --> MP2["良率监控与改善"] --> MP3["产能爬坡"]
    MP3 --> MP4["工程变更管理"] --> MP5["售后问题跟踪"] --> MP6["持续改善 (CIP)"]
  end

  C6 --> P1
  P7 --> D1
  D8 --> E1
  E7 --> V1
  V8 --> PV1
  PV8 --> MP1
```

## ECO 迭代升级

```mermaid
flowchart LR
  E0["开始<br/>工程变更项目"] --> E1["P1 变更规划<br/>2-4周<br/>Gate: ECO Kickoff评审<br/>交付物: ECR、影响分析报告、BOM差异对比、变更时程"]
  E1 --> E2["P2 变更设计<br/>3-6周<br/>Gate: 设计变更冻结<br/>交付物: ECN、更新原理图/PCB、更新BOM、变更设计评审报告"]
  E2 --> E3["P3 EVT 变更验证<br/>3-5周<br/>Gate: 变更验证评审<br/>交付物: 变更验证样机、变更验证报告、回归测试报告、问题清单"]
  E3 --> E4["P4 变更试产<br/>2-4周<br/>Gate: 变更量产切换评审<br/>交付物: 变更试产报告、更新SOP/WI、产线切换计划、库存处理方案"]
  E4 --> ERelease["MP Release<br/>服务端硬闸口<br/>以 P4 Gate 作为发布前置 Gate"]
  ERelease --> E5["P5 MP 量产跟踪<br/>持续<br/>Gate: 变更关闭评审<br/>交付物: 变更后良率报告、变更效果验证报告、ECO关闭报告"]
  E5 --> EEnd["变更关闭 / 持续监控"]

  classDef release fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:2px;
  class E4,ERelease release;
```

### ECO 任务骨架

```mermaid
flowchart TB
  subgraph E1["P1 变更规划"]
    EP1["变更需求分析 (ECR)"] --> EP2["影响范围评估"] --> EP3["BOM 差异分析"]
    EP3 --> EP4["变更时程规划"] --> EP5["资源与供应商确认"] --> EP6["变更评审委员会 (CCB)"] --> EP7["ECO Kickoff (Gate 1)"]
  end

  subgraph E2["P2 变更设计"]
    ED1["硬件设计变更"] --> ED2["结构设计变更"] --> ED3["软件变更"]
    ED3 --> ED4["DFM 变更评审"] --> ED5["认证影响评估"] --> ED6["设计变更冻结 (Gate 2)"]
  end

  subgraph E3["P3 EVT 变更验证"]
    EV1["变更样机制作"] --> EV2["变更点专项验证"] --> EV3["回归测试"]
    EV3 --> EV4["可靠性验证（关键项）"] --> EV5["变更验证评审 (Gate 3)"]
  end

  subgraph E4["P4 变更试产"]
    EPV1["产线变更准备"] --> EPV2["变更试产"] --> EPV3["库存与在制品处理"]
    EPV3 --> EPV4["ECN 正式发布"] --> EPV5["变更量产切换评审 (Gate 4)"]
  end

  subgraph E5["P5 MP 量产跟踪"]
    EM1["变更后量产监控"] --> EM2["变更效果验证"] --> EM3["售后影响跟踪"] --> EM4["ECO 关闭评审 (Gate 5)"]
  end

  EP7 --> ED1
  ED6 --> EV1
  EV5 --> EPV1
  EPV5 --> EM1
```

## IDR 外观翻新

```mermaid
flowchart LR
  I0["开始<br/>外观翻新项目"] --> I1["P1 翻新范围评估<br/>2-3周<br/>Gate: IDR Kickoff评审<br/>交付物: IDR brief、现有设计基线包、影响分析矩阵、BOM差异与新物料清单、认证路径预判、项目计划"]
  I1 --> I2["P2 跨专业设计<br/>4-8周<br/>Gate: 设计冻结评审<br/>交付物: ID/CMF设计包、MD结构图纸、硬件影响确认、包装/标签设计稿、更新BOM、供应商样件"]
  I2 --> I3["P3 验证与认证<br/>4-8周<br/>Gate: 验证与认证评审<br/>交付物: 验证样机、可靠性/回归测试报告、认证更新记录、包装验证报告、外观检验标准"]
  I3 --> I4["P4 试产与量产切换<br/>3-6周<br/>Gate: MP Release评审<br/>交付物: 试产/首批量产产品、PVT或首批质量报告、SOP/WI更新记录、版本切换计划、市场上市计划"]
  I4 --> IRelease["MP Release<br/>服务端硬闸口<br/>以 P4 Gate 作为发布前置 Gate"]
  IRelease --> IEnd["新版本量产 / 上市"]

  classDef release fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:2px;
  class I4,IRelease release;
```

### IDR 任务骨架

```mermaid
flowchart TB
  subgraph I1["P1 翻新范围评估"]
    IR1["翻新需求与边界定义"] --> IR2["现有设计基线盘点"] --> IR3["跨专业影响评估"]
    IR3 --> IR4["新物料与供应策略"] --> IR5["认证路径预判"] --> IR6["IDR Kickoff (Gate 1)"]
  end

  subgraph I2["P2 跨专业设计"]
    ID1["ID/CMF 详细设计"] --> ID2["结构与模具设计"] --> ID3["硬件适配确认"]
    ID3 --> ID4["包装/标签/铭牌设计"] --> ID5["BOM/图纸/ECN 草案"] --> ID6["供应商打样与FAI"] --> ID7["设计冻结评审 (Gate 2)"]
  end

  subgraph I3["P3 验证与认证"]
    IV1["验证样机制作"] --> IV2["结构与装配验证"] --> IV3["功能与性能回归"]
    IV3 --> IV4["可靠性与外观耐久测试"] --> IV5["认证更新或重新认证"] --> IV6["外观检验标准制定"] --> IV7["验证与认证评审 (Gate 3)"]
  end

  subgraph I4["P4 试产与量产切换"]
    IM1["试产切换准备"] --> IM2["小批试产/首批确认"] --> IM3["物料与库存切换"]
    IM3 --> IM4["文件与认证资料发布"] --> IM5["市场与渠道切换"] --> IM6["MP Release评审 (Gate 4)"]
  end

  IR6 --> ID1
  ID7 --> IV1
  IV7 --> IM1
```

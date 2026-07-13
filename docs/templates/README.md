# 交付物 Excel 模板库

> 生成日期：2026-07-09 · 覆盖全 6 类项目（NPD/ECO/DRV/IDR/JDM/OBT）的 **269 个交付物名称，每个一份 .xlsx 模板**。

## 目录结构

```
docs/templates/
├── 模板索引.xlsx            ← 先看这个：269 项交付物 → 模板文件路径 → 出现位置
├── deliverables.tsv         ← 交付物词表（从 shared/ 模板导出）
└── deliverables/
    ├── F01-评审记录表/       ← A4 可打印线下表单（入口检查/材料结论/三选一结论/签核）
    ├── F02-测试报告/         ← 主页 + 目录 + 每个测试项一个 sheet（复制「测试项-空白」）
    ├── F03-问题与跟踪清单/
    ├── F04-影响分析与评估/   ← 含 12 域影响矩阵 + 6 模块复用策略 sheet
    ├── F05-BOM与物料/        ← 金额/差异计数自动公式
    ├── F06-计划与排程/
    ├── F07-文件与清单/
    ├── F08-试产与良率报告/   ← FPY/RTY 自动公式 + 发布就绪确认
    ├── F09-SOP·WI与检验标准/
    ├── F10-认证证据归档/
    ├── F11-复用确认单/       ← A4 可打印（边界对比 → 超界处理 → 签核）
    ├── F12-客户签核单/       ← A4 可打印，中英双语，JDM/OBT 客户签署
    ├── F13-需求与文档/
    └── F14-样机与Build记录/
```

## 使用约定

- 蓝色标题区 = 模板族与适用范围；灰色斜体 = 填写提示，填写时覆盖即可。
- 下拉列表（判定/等级/状态）已内置数据有效性，不要手输花样值。
- F01/F11/F12 已设 A4 打印区域，直接打印线下签署后扫描上传。
- 测试报告：一个测试项一个 sheet——复制「测试项-空白」并重命名，在「目录」登记。
- FPY/金额等公式列在 Excel/WPS 打开时自动计算，空行不显示错误。

## 重新生成

模板骨架或交付物词表变化后：

```bash
npx tsx <dump脚本或手动更新> > docs/templates/deliverables.tsv   # 更新词表
python3 scripts/generate-deliverable-templates.py                 # 重新生成全部（需 openpyxl）
python3 scripts/generate-deliverable-templates.py --dry           # 只看分类不生成
```

交付物 → 模板族的归类在生成器的 `OVERRIDES`（显式指派）与 `PATTERNS`（关键词规则）里维护。

## 产品内入口（已上线 2026-07-09）

- **shared 常量表**：`shared/deliverable-templates.ts`（生成器自动产出，269 名称→文件路径），前后端共用；覆盖守卫 `shared/deliverable-template-coverage.test.ts` 保证词表新增交付物时必须重新生成模板。
- **下载端点**：`GET /api/deliverable-template?name=<交付物名称>`（需登录；名称以常量表为白名单，无任意路径面）。生产镜像已在 Dockerfile COPY `docs/templates`。
- **UI 挂点**：Gate 面板「审核状态」每条交付物旁 + 任务详情「交付物」清单每行 —「模板 ↓」下载。

import { useEffect, useState } from "react";
import { CircleHelp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MODULE_TYPE_OPTIONS,
  type KeyModuleBundle,
  type KeyModuleType,
} from "./types";

type ItemDraft = {
  partNumber: string;
  name: string;
  spec: string;
  quantity: string;
  refDesignator: string;
  componentProductId: string | null;
};
export type KeyModuleEditorValue = {
  moduleNumber: string;
  moduleType: KeyModuleType;
  name: string;
  category: string;
  model: string | null;
  items: Array<{
    partNumber: string;
    name: string;
    spec: string;
    quantity: number;
    refDesignator: string;
    componentProductId: string | null;
  }>;
};

const emptyItem = (): ItemDraft => ({
  partNumber: "",
  name: "",
  spec: "",
  quantity: "1",
  refDesignator: "",
  componentProductId: null,
});

export function KeyModuleEditorDialog({
  open,
  onOpenChange,
  detail,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail?: KeyModuleBundle | null;
  pending: boolean;
  onSubmit: (value: KeyModuleEditorValue) => void;
}) {
  const [moduleNumber, setModuleNumber] = useState("");
  const [moduleType, setModuleType] = useState<KeyModuleType>("battery_energy");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [model, setModel] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);

  useEffect(() => {
    if (!open) return;
    setModuleNumber(detail?.module.moduleNumber ?? "");
    setModuleType(detail?.module.moduleType ?? "battery_energy");
    setName(detail?.module.name ?? "");
    setCategory(detail?.module.category ?? "");
    setModel(detail?.module.model ?? "");
    setItems(
      detail?.items.length
        ? detail.items.map(item => ({
            partNumber: item.partNumber,
            name: item.name,
            spec: item.spec,
            quantity: String(item.quantity),
            refDesignator: item.refDesignator,
            componentProductId: item.componentProductId,
          }))
        : [emptyItem()]
    );
  }, [detail, open]);

  const ready =
    moduleNumber.trim() &&
    name.trim() &&
    items.length > 0 &&
    items.every(
      item =>
        item.partNumber.trim() &&
        item.name.trim() &&
        Number.isInteger(Number(item.quantity)) &&
        Number(item.quantity) > 0
    );
  const updateItem = (index: number, patch: Partial<ItemDraft>) =>
    setItems(current =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );

  const submit = () => {
    if (!ready || pending) return;
    onSubmit({
      moduleNumber: moduleNumber.trim(),
      moduleType,
      name: name.trim(),
      category: category.trim(),
      model: model.trim() || null,
      items: items.map(item => ({
        partNumber: item.partNumber.trim(),
        name: item.name.trim(),
        spec: item.spec.trim(),
        quantity: Number(item.quantity),
        refDesignator: item.refDesignator.trim(),
        componentProductId: item.componentProductId,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <form
          className="space-y-5"
          onSubmit={event => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {detail ? "编辑关键模块草稿" : "新建关键模块"}
            </DialogTitle>
            <DialogDescription>
              先建立模块身份与内部
              BOM。保存后模块处于草稿状态，可继续编辑或提交技术确认。
            </DialogDescription>
          </DialogHeader>

          <section
            aria-labelledby="module-identity-heading"
            className="rounded-xl border border-border bg-secondary/20 p-4"
          >
            <div className="mb-4">
              <h3
                id="module-identity-heading"
                className="text-sm font-semibold"
              >
                01 · 模块身份
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="text-destructive">*</span>{" "}
                为必填项；模块类型在创建后不可更改。
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="key-module-number">
                  模块编号 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="key-module-number"
                  autoFocus
                  value={moduleNumber}
                  onChange={event => setModuleNumber(event.target.value)}
                  placeholder="例如 BAT-001"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  模块类型 <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={moduleType}
                  onValueChange={value => setModuleType(value as KeyModuleType)}
                  disabled={Boolean(detail)}
                >
                  <SelectTrigger aria-label="模块类型">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODULE_TYPE_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="key-module-name">
                  模块名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="key-module-name"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder="便于工程师识别的名称"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key-module-category">适用品类</Label>
                <Input
                  id="key-module-category"
                  value={category}
                  onChange={event => setCategory(event.target.value)}
                  placeholder="例如充气泵"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key-module-model">型号</Label>
                <Input
                  id="key-module-model"
                  value={model}
                  onChange={event => setModel(event.target.value)}
                  placeholder="可选"
                />
              </div>
            </div>
          </section>

          <section
            aria-labelledby="internal-bom-heading"
            className="rounded-xl border border-border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="internal-bom-heading" className="text-sm font-semibold">
                  02 · 内部 BOM <span className="text-destructive">*</span>
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  至少添加一个部件。批准后，部件、规格、数量或位号变化都需派生新编号。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setItems(current => [...current, emptyItem()])}
              >
                <Plus size={14} /> 添加部件
              </Button>
            </div>

            <div className="mt-4 hidden grid-cols-12 gap-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
              <span className="col-span-2">部件编号 *</span>
              <span className="col-span-3">部件名称 *</span>
              <span className="col-span-3">规格</span>
              <span className="col-span-1">数量 *</span>
              <span className="col-span-2">位号</span>
            </div>
            <div className="mt-2 space-y-2">
              {items.map((item, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-lg border border-border bg-secondary/30 p-3 sm:grid-cols-12"
                >
                  <Input
                    aria-label={`第 ${index + 1} 行部件编号`}
                    className="sm:col-span-2"
                    value={item.partNumber}
                    onChange={event =>
                      updateItem(index, { partNumber: event.target.value })
                    }
                    placeholder="部件编号 *"
                  />
                  <Input
                    aria-label={`第 ${index + 1} 行部件名称`}
                    className="sm:col-span-3"
                    value={item.name}
                    onChange={event =>
                      updateItem(index, { name: event.target.value })
                    }
                    placeholder="部件名称 *"
                  />
                  <Input
                    aria-label={`第 ${index + 1} 行规格`}
                    className="sm:col-span-3"
                    value={item.spec}
                    onChange={event =>
                      updateItem(index, { spec: event.target.value })
                    }
                    placeholder="规格"
                  />
                  <Input
                    aria-label={`第 ${index + 1} 行数量`}
                    className="sm:col-span-1"
                    inputMode="numeric"
                    value={item.quantity}
                    onChange={event =>
                      updateItem(index, { quantity: event.target.value })
                    }
                    placeholder="数量 *"
                  />
                  <Input
                    aria-label={`第 ${index + 1} 行位号`}
                    className="sm:col-span-2"
                    value={item.refDesignator}
                    onChange={event =>
                      updateItem(index, { refDesignator: event.target.value })
                    }
                    placeholder="位号"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="sm:col-span-1"
                    aria-label={`删除第 ${index + 1} 行`}
                    disabled={items.length === 1}
                    onClick={() =>
                      setItems(current =>
                        current.filter((_, itemIndex) => itemIndex !== index)
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <div className="flex items-start gap-2 rounded-lg bg-[color:var(--acc-soft)] px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            <CircleHelp size={15} className="mt-0.5 shrink-0 text-primary" />
            <span>
              这里维护模块的工程构成，不维护供应商或二供信息。保存草稿不会立即开放给项目使用。
            </span>
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <span className="text-left text-xs text-muted-foreground">
              {ready
                ? "必填信息已完整，可以保存草稿"
                : "请补全模块编号、名称及 BOM 必填信息"}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={!ready || pending}>
                {pending ? "保存中…" : "保存草稿"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

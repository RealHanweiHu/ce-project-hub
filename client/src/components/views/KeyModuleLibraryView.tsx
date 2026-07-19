import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LinearCard, PageHeader } from "@/components/linear/primitives";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  isSystemExternalRole,
  normalizeSystemRole,
} from "@shared/system-roles";
import { KeyModuleDetailDialog } from "./key-modules/KeyModuleDetailDialog";
import {
  KeyModuleEditorDialog,
  type KeyModuleEditorValue,
} from "./key-modules/KeyModuleEditorDialog";
import {
  MODULE_STATUS_LABEL,
  MODULE_TYPE_LABEL,
  MODULE_TYPE_OPTIONS,
  type KeyModuleBundle,
  type KeyModuleStatus,
  type KeyModuleType,
} from "./key-modules/types";

const ALL_STATUSES: KeyModuleStatus[] = [
  "draft",
  "technical_confirmed",
  "approved",
  "restricted",
  "obsolete",
];

const STATUS_STYLE: Record<KeyModuleStatus, string> = {
  draft: "border-border bg-secondary text-muted-foreground",
  technical_confirmed:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  restricted:
    "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  obsolete:
    "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

function StatusBadge({ value }: { value: KeyModuleStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        STATUS_STYLE[value]
      )}
    >
      <CircleDot size={9} /> {MODULE_STATUS_LABEL[value]}
    </span>
  );
}

export function KeyModuleLibraryView({
  createRequest = 0,
}: {
  createRequest?: number;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | KeyModuleType>("all");
  const [status, setStatus] = useState<"all" | KeyModuleStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<KeyModuleBundle | null>(null);
  const canWrite = Boolean(
    user &&
      !isSystemExternalRole(user.role) &&
      normalizeSystemRole(user.role) !== "viewer"
  );
  const canApprove = Boolean(
    user &&
      (("canCreateProject" in user && user.canCreateProject) ||
        user.role === "admin" ||
        user.role === "owner")
  );
  const list = trpc.keyModules.list.useQuery({
    query: query || undefined,
    moduleType: type === "all" ? undefined : type,
    statuses: status === "all" ? ALL_STATUSES : [status],
    page: 1,
    pageSize: 100,
  });
  const detail = trpc.keyModules.get.useQuery(
    { id: selectedId ?? "" },
    { enabled: Boolean(selectedId) }
  );
  const history = trpc.keyModules.history.useQuery(
    { id: selectedId ?? "" },
    { enabled: Boolean(selectedId) }
  );
  const invalidate = async () => {
    await utils.keyModules.invalidate();
  };
  const success = (message: string) => {
    toast.success(message);
    void invalidate();
  };
  const failure = (error: { message: string }) => toast.error(error.message);

  const create = trpc.keyModules.create.useMutation({
    onSuccess: result => {
      success("关键模块草稿已创建");
      setEditorOpen(false);
      setSelectedId(result.module.id);
    },
    onError: failure,
  });
  const update = trpc.keyModules.updateDraft.useMutation({
    onSuccess: () => {
      success("模块草稿已保存");
      setEditorOpen(false);
    },
    onError: failure,
  });
  const confirm = trpc.keyModules.confirmTechnical.useMutation({
    onSuccess: () => success("技术确认完成，等待产品或项目经理批准"),
    onError: failure,
  });
  const approve = trpc.keyModules.approve.useMutation({
    onSuccess: () => success("模块已批准，可供项目选用"),
    onError: failure,
  });
  const returnToDraft = trpc.keyModules.returnToDraft.useMutation({
    onSuccess: () => success("模块已退回草稿"),
    onError: failure,
  });
  const derive = trpc.keyModules.derive.useMutation({
    onSuccess: result => {
      success("已派生新的模块草稿");
      setSelectedId(result.module.id);
    },
    onError: failure,
  });
  const restrict = trpc.keyModules.restrict.useMutation({
    onSuccess: () => success("已限制新项目选用"),
    onError: failure,
  });
  const obsolete = trpc.keyModules.obsolete.useMutation({
    onSuccess: () => success("模块已停用"),
    onError: failure,
  });
  const pending = [
    create,
    update,
    confirm,
    approve,
    returnToDraft,
    derive,
    restrict,
    obsolete,
  ].some(mutation => mutation.isPending);

  const rows = useMemo(() => list.data?.data ?? [], [list.data]);
  useEffect(() => {
    if (!createRequest) return;
    if (!canWrite) {
      toast.error("当前账号为只读或外部协作账号，不能新建关键模块");
      return;
    }
    setEditing(null);
    setEditorOpen(true);
  }, [canWrite, createRequest]);

  const openCreate = () => {
    if (!canWrite) {
      toast.error("当前账号为只读或外部协作账号，不能新建关键模块");
      return;
    }
    setEditing(null);
    setEditorOpen(true);
  };
  const submitEditor = (value: KeyModuleEditorValue) =>
    editing
      ? update.mutate({
          id: editing.module.id,
          moduleNumber: value.moduleNumber,
          name: value.name,
          category: value.category,
          model: value.model,
          items: value.items,
        })
      : create.mutate(value);
  const ask = (message: string) => window.prompt(message)?.trim() || null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="关键模块库"
        sub={
          <>
            受控的电池、核心功能与电子硬件模块 ·{" "}
            <span className="num">{list.data?.pagination.totalItems ?? 0}</span>{" "}
            个资产
          </>
        }
        actions={
          <Button
            onClick={openCreate}
            disabled={!canWrite}
            title={canWrite ? "创建关键模块草稿" : "当前账号没有模块维护权限"}
          >
            <Plus size={15} /> 新建模块
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <div className="relative min-w-[260px] flex-1 sm:max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-9"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索编号、名称、型号或品类"
            aria-label="搜索关键模块"
          />
        </div>
        <Select
          value={type}
          onValueChange={value => setType(value as typeof type)}
        >
          <SelectTrigger className="w-[160px]" aria-label="模块类型筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {MODULE_TYPE_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={value => setStatus(value as typeof status)}
        >
          <SelectTrigger className="w-[140px]" aria-label="模块状态筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {ALL_STATUSES.map(value => (
              <SelectItem key={value} value={value}>
                {MODULE_STATUS_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list.isLoading ? (
        <LinearCard className="py-16 text-center text-sm text-muted-foreground">
          加载关键模块…
        </LinearCard>
      ) : list.isError ? (
        <LinearCard
          role="alert"
          className="flex flex-col items-center py-12 text-center"
        >
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive">
            <CircleAlert size={20} />
          </span>
          <p className="text-sm font-semibold">关键模块加载失败</p>
          <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            {list.error.message}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            size="sm"
            onClick={() => {
              void list.refetch();
            }}
          >
            <RefreshCw size={14} /> 重新加载
          </Button>
        </LinearCard>
      ) : rows.length === 0 ? (
        <LinearCard className="flex flex-col items-center py-16 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-secondary text-muted-foreground">
            <Boxes size={20} />
          </span>
          <p className="text-sm font-semibold">
            {query || type !== "all" || status !== "all"
              ? "没有匹配的关键模块"
              : "还没有关键模块"}
          </p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            先创建模块草稿并录入内部 BOM；技术确认和批准后，项目才可以正式选用。
          </p>
          {canWrite && !query && type === "all" && status === "all" ? (
            <Button className="mt-4" size="sm" onClick={openCreate}>
              <Plus size={14} /> 创建第一个模块
            </Button>
          ) : null}
        </LinearCard>
      ) : (
        <LinearCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>模块编号</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>品类 / 型号</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead>
                    <span className="sr-only">打开</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow
                    key={row.id}
                    className="group cursor-pointer"
                    tabIndex={0}
                    onClick={() => setSelectedId(row.id)}
                    onKeyDown={event => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(row.id);
                      }
                    }}
                  >
                    <TableCell className="font-semibold text-foreground">
                      <span className="num">{row.moduleNumber}</span>
                    </TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <Boxes size={13} className="text-muted-foreground" />
                        {MODULE_TYPE_LABEL[row.moduleType]}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {[row.category, row.model].filter(Boolean).join(" · ") ||
                        "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={row.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(row.updatedAt).toLocaleDateString("zh-CN")}
                    </TableCell>
                    <TableCell className="w-9">
                      <ChevronRight
                        size={15}
                        className="text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </LinearCard>
      )}

      <KeyModuleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        detail={editing}
        pending={pending}
        onSubmit={submitEditor}
      />
      <KeyModuleDetailDialog
        open={Boolean(selectedId)}
        onOpenChange={open => {
          if (!open) setSelectedId(null);
        }}
        detail={detail.data as KeyModuleBundle | undefined}
        loading={detail.isLoading}
        history={[...(history.data ?? [])].reverse()}
        historyLoading={history.isLoading}
        canApprove={canApprove}
        pending={pending}
        onEdit={() => {
          setEditing(detail.data as KeyModuleBundle);
          setEditorOpen(true);
        }}
        onConfirm={() => selectedId && confirm.mutate({ id: selectedId })}
        onApprove={() => selectedId && approve.mutate({ id: selectedId })}
        onReturn={() => {
          const reason = ask("请输入退回草稿的原因");
          if (selectedId && reason)
            returnToDraft.mutate({ id: selectedId, reason });
        }}
        onDerive={() => {
          if (!selectedId || !detail.data) return;
          const moduleNumber = ask("请输入新的模块编号");
          if (moduleNumber)
            derive.mutate({
              sourceId: selectedId,
              moduleNumber,
              name: `${detail.data.module.name}（派生）`,
            });
        }}
        onRestrict={() => {
          const reason = ask("请输入限制新项目选用的原因");
          if (selectedId && reason) restrict.mutate({ id: selectedId, reason });
        }}
        onObsolete={() => {
          const reason = ask("请输入停用原因");
          if (selectedId && reason) obsolete.mutate({ id: selectedId, reason });
        }}
      />
    </div>
  );
}

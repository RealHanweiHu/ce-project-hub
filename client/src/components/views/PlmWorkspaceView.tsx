import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Boxes, Package, Plus } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isSystemExternalRole, normalizeSystemRole } from "@shared/system-roles";
import { KeyModuleLibraryView } from "./KeyModuleLibraryView";
import { ProductLibraryView } from "./ProductLibraryView";

type PlmSection = "products" | "modules";

const SECTION_META: Array<{
  id: PlmSection;
  label: string;
  eyebrow: string;
  description: string;
  icon: typeof Package;
}> = [
  {
    id: "products",
    label: "产品主数据",
    eyebrow: "PRODUCT",
    description: "型号、定义、版本与生命周期",
    icon: Package,
  },
  {
    id: "modules",
    label: "关键模块",
    eyebrow: "MODULE",
    description: "新建、批准并复用受控模块",
    icon: Boxes,
  },
];

function readSection(): PlmSection {
  if (typeof window === "undefined") return "products";
  return new URLSearchParams(window.location.search).get("plm") === "modules"
    ? "modules"
    : "products";
}

function writeSection(section: PlmSection, mode: "push" | "replace" = "push") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("view", "products");
  url.searchParams.set("plm", section);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    if (mode === "replace") window.history.replaceState({}, "", next);
    else window.history.pushState({}, "", next);
  }
}

export function PlmWorkspaceView() {
  const { user } = useAuth();
  const [section, setSectionState] = useState<PlmSection>(readSection);
  const [createModuleRequest, setCreateModuleRequest] = useState(0);
  const canCreateModule = Boolean(
    user &&
      !isSystemExternalRole(user.role) &&
      normalizeSystemRole(user.role) !== "viewer"
  );

  const setSection = useCallback((next: PlmSection) => {
    setSectionState(next);
    writeSection(next);
  }, []);

  useEffect(() => {
    // Canonicalize the PLM URL so either asset domain can be bookmarked and shared.
    writeSection(section, "replace");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handlePopState = () => setSectionState(readSection());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const startModuleCreation = () => {
    if (!canCreateModule) return;
    if (section !== "modules") setSection("modules");
    setCreateModuleRequest(request => request + 1);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col">
      <header className="mb-5 overflow-hidden rounded-[14px] border border-border bg-card">
        <div className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-primary">
              <span className="h-px w-5 bg-primary" /> PLM PRODUCT SPINE
            </div>
            <h1 className="text-[24px] font-bold tracking-[-0.5px] text-foreground">
              产品生命轴
            </h1>
            <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
              统一维护产品型号与受控关键模块。模块完成技术确认和批准后，才能被项目复用并进入产品技术基线。
            </p>
          </div>
          <Button
            className="h-9 shrink-0 self-start lg:self-auto"
            onClick={startModuleCreation}
            disabled={!canCreateModule}
            title={canCreateModule ? "创建关键模块草稿" : "当前账号没有模块维护权限"}
          >
            <Plus size={15} /> 新建关键模块
          </Button>
        </div>

        <nav
          aria-label="PLM 资产域"
          className="grid border-t border-border sm:grid-cols-2"
        >
          {SECTION_META.map((item, index) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setSection(item.id)}
                className={cn(
                  "group relative flex min-h-[82px] items-center gap-3 px-5 py-4 text-left transition-colors lg:px-6",
                  index > 0 &&
                    "border-t border-border sm:border-l sm:border-t-0",
                  active
                    ? "bg-[color:var(--acc-soft)]"
                    : "bg-card hover:bg-secondary/60"
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border transition-colors",
                    active
                      ? "border-[color:var(--acc-border)] bg-card text-primary"
                      : "border-border bg-secondary text-muted-foreground group-hover:text-foreground"
                  )}
                >
                  <Icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[9px] font-bold tracking-[0.13em] text-muted-foreground">
                    {item.eyebrow}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold text-foreground">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <ArrowRight
                  size={15}
                  className={cn(
                    "shrink-0 transition-transform group-hover:translate-x-0.5",
                    active ? "text-primary" : "text-muted-foreground/50"
                  )}
                />
                {active ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      {section === "products" ? (
        <ProductLibraryView />
      ) : (
        <KeyModuleLibraryView createRequest={createModuleRequest} />
      )}
    </div>
  );
}

import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerTrigger } from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";
import { CategoryBadge } from "@/components/CategoryVisuals";
import type { AuthFetch } from "@/types";

const valuesFromBudgetMap = (categories: string[], budgetMap: Record<string, number>): Record<string, string> => {
  const values: Record<string, string> = {};
  categories.forEach((c) => { values[c] = budgetMap[c] != null ? String(budgetMap[c]) : ""; });
  return values;
};

const sortCategoriesByBudget = (categories: string[], budgetMap: Record<string, number>): string[] => {
  const budgeted: string[] = [];
  const unbudgeted: string[] = [];
  categories.forEach((c) => (budgetMap[c] != null ? budgeted : unbudgeted).push(c));
  budgeted.sort((a, b) => a.localeCompare(b));
  unbudgeted.sort((a, b) => a.localeCompare(b));
  return [...budgeted, ...unbudgeted];
};

interface BudgetSettingsProps {
  categories: string[];
  budgetMap: Record<string, number>;
  spendByCategory?: Record<string, number>;
  authFetch: AuthFetch;
  onSaved: () => void;
}

const BudgetSettings = ({ categories, budgetMap, spendByCategory, authFetch, onSaved }: BudgetSettingsProps) => {
  const [values, setValues] = useState(() => valuesFromBudgetMap(categories, budgetMap));
  const [syncedBudgetMap, setSyncedBudgetMap] = useState(budgetMap);
  const [orderedCategories, setOrderedCategories] = useState(() => sortCategoriesByBudget(categories, budgetMap));

  if (budgetMap !== syncedBudgetMap) {
    setSyncedBudgetMap(budgetMap);
    setValues(valuesFromBudgetMap(categories, budgetMap));
    setOrderedCategories(sortCategoriesByBudget(categories, budgetMap));
  }

  const handleBlur = async (category: string) => {
    const original = budgetMap[category] ?? null;
    const trimmed = (values[category] ?? "").trim();

    if (trimmed === "") {
      if (original == null) return;
      try {
        const res = await authFetch(`/budgets/${encodeURIComponent(category)}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        onSaved();
      } catch {
        toast.error("Failed to remove budget");
        setValues((v) => ({ ...v, [category]: String(original) }));
      }
      return;
    }

    const limit = parseFloat(trimmed);
    if (!Number.isFinite(limit) || limit <= 0) {
      toast.error("Enter a valid budget amount");
      setValues((v) => ({ ...v, [category]: original != null ? String(original) : "" }));
      return;
    }
    if (limit === original) return;

    try {
      const res = await authFetch(`/budgets/${encodeURIComponent(category)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_limit: limit }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch {
      toast.error("Failed to save budget");
      setValues((v) => ({ ...v, [category]: original != null ? String(original) : "" }));
    }
  };

  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto -mx-1 px-1">
      {orderedCategories.map((category) => {
        const limit = budgetMap[category];
        const spent = spendByCategory?.[category] ?? 0;
        // spendByCategory is omitted entirely when the table is filtered to
        // "All time" — its totals would be lifetime, not monthly, spend, so
        // suppress the indicator rather than show a misleading comparison.
        const hasBudget = limit != null && spendByCategory != null;
        const usedPct = hasBudget && limit > 0 ? (spent / limit) * 100 : 0;
        const statusLevel = !hasBudget ? "none" : usedPct > 100 ? "over" : usedPct >= 80 ? "near" : "ok";
        const barColor = statusLevel === "over" ? "bg-red-500" : statusLevel === "near" ? "bg-amber-500" : "bg-foreground/40";
        const textColor = statusLevel === "over"
          ? "text-red-600 dark:text-red-400"
          : statusLevel === "near"
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground";
        return (
          <div key={category} className="py-1">
            <div className="flex items-center gap-2">
              <CategoryBadge category={category} small loggedBy={undefined} onUserClick={undefined} userActive={undefined} />
              <span className="text-sm text-foreground flex-1 truncate">{category}</span>
              <div className="relative w-24 shrink-0">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min="0"
                  placeholder="—"
                  value={values[category] ?? ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [category]: e.target.value }))}
                  onBlur={() => handleBlur(category)}
                  className="h-8 text-sm pl-5 text-right"
                />
              </div>
            </div>
            {hasBudget && (
              <div className="flex items-center gap-2 mt-1 pl-8">
                <div className="relative flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out ${barColor}`}
                    style={{ width: `${Math.min(usedPct, 100)}%` }}
                  />
                </div>
                <span className={`text-xs tabular-nums ${textColor}`}>${spent.toFixed(0)} spent</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export interface BudgetDialogProps {
  categories: string[];
  budgetMap: Record<string, number>;
  spendByCategory?: Record<string, number>;
  authFetch: AuthFetch;
  onSaved: () => void;
}

export default function BudgetDialog({ categories, budgetMap, spendByCategory, authFetch, onSaved }: BudgetDialogProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const trigger = (
    <button
      type="button"
      title="Manage budgets"
      className="w-7 h-7 flex items-center justify-center rounded-md border border-transparent text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 transition-colors"
    >
      <Wallet className="w-3.5 h-3.5" />
    </button>
  );

  const form = (
    <BudgetSettings
      categories={categories}
      budgetMap={budgetMap}
      spendByCategory={spendByCategory}
      authFetch={authFetch}
      onSaved={onSaved}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent
          className="sm:max-w-sm"
          onOpenAutoFocus={(e: Event) => {
            // Don't let Radix autofocus the first budget input — that pops
            // the mobile keyboard immediately on open. Focus the dialog
            // container itself instead (it's a valid, non-input focus
            // target per the ARIA dialog pattern) so keyboard/screen-reader
            // users still land inside the dialog rather than nowhere.
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
        >
          <DialogHeader className={undefined}>
            <DialogTitle className="text-sm font-semibold">Manage Budgets</DialogTitle>
            <DialogDescription className="sr-only">Set monthly spending limits per category</DialogDescription>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className={undefined}>
        <DrawerHeader className={undefined}>
          <DrawerTitle className="text-sm font-semibold">Manage Budgets</DrawerTitle>
          <DrawerDescription className="sr-only">Set monthly spending limits per category</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-4">{form}</div>
      </DrawerContent>
    </Drawer>
  );
}

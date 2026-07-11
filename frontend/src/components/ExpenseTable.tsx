import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { toast } from "sonner";
import { X, ArrowUp, Flag, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAnimatedNumber } from "@/lib/categoryVisuals";
import { formatMonth } from "@/components/expenseTableFormat";
import ExpenseEditDialog from "@/components/ExpenseEditDialog";
import IncomeEditDialog from "@/components/IncomeEditDialog";
import ExpenseList from "@/components/ExpenseList";
import IncomeList from "@/components/IncomeList";
import CategoryBreakdown from "@/components/CategoryBreakdown";
import RecurringSection from "@/components/RecurringSection";
import type { AuthFetch, Budget, EditValues, Expense, Income, IncomeEditValues, RecurringCharge } from "@/types";

export interface ExpenseTableProps {
  expenses: Expense[];
  income?: Income[];
  className?: string;
  token: string;
  username: string;
  onExpenseChange: () => void;
  onIncomeChange?: () => void;
  onUnauthorized: () => void;
  loading?: boolean;
  highlightIds?: Set<number>;
}

export default function ExpenseTable({ expenses, income = [], className = "", token, username, onExpenseChange, onIncomeChange, onUnauthorized, loading = false, highlightIds }: ExpenseTableProps) {
  const authFetch: AuthFetch = (url, opts = {}) => {
    const res = fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } });
    res.then((r) => { if (r.status === 401) onUnauthorized(); });
    return res;
  };

  // "New activity since you left" — entirely derived from the /expenses
  // list already being fetched, no new endpoint or push infra. Baseline
  // (highest expense id seen) is per-username in localStorage; the first
  // time it's set (no stored value yet) we snapshot the current max
  // instead of treating all existing history as "new".
  const lastSeenKey = `expenses_last_seen_id_${username}`;
  const [lastSeenId, setLastSeenId] = useState<number | null>(() => {
    const stored = localStorage.getItem(lastSeenKey);
    return stored ? parseInt(stored, 10) : null;
  });

  useEffect(() => {
    if (lastSeenId === null && expenses.length > 0) {
      const maxId = Math.max(...expenses.map((e) => e.id));
      localStorage.setItem(lastSeenKey, String(maxId));
      // Guarded by lastSeenId === null above, so this runs at most once per
      // mount (not a cascading-render loop) — the case react-hooks/set-state-
      // in-effect exists to catch. eslint-disable-next-line rather than a
      // fake async deferral just to dodge the rule.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastSeenId(maxId);
    }
  }, [expenses, lastSeenId, lastSeenKey]);

  const newFromOthers = useMemo(
    () => (lastSeenId == null ? [] : expenses.filter((e): e is Expense & { logged_by: string } => !!e.logged_by && e.logged_by !== username && e.id > lastSeenId)),
    [expenses, lastSeenId, username]
  );
  const newActivityNames = [...new Set(newFromOthers.map((e) => e.logged_by))];

  const dismissNewActivity = () => {
    const maxId = Math.max(lastSeenId ?? 0, ...expenses.map((e) => e.id));
    localStorage.setItem(lastSeenKey, String(maxId));
    setLastSeenId(maxId);
  };

  // Read-only Phase 1 income view — toggled alongside the expense list
  // rather than as a third top-level mobile tab.
  const [view, setView] = useState<"expenses" | "income">("expenses");
  const [selectedMonthOverride, setSelectedMonthOverride] = useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<string[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<RecurringCharge[]>([]);
  const [overrides, setOverrides] = useState<Record<number, Partial<Expense>>>({});
  const [deletedIds, setDeletedIds] = useState<Set<number>>(() => new Set());
  const [incomeOverrides, setIncomeOverrides] = useState<Record<number, Partial<Income>>>({});
  const [deletedIncomeIds, setDeletedIncomeIds] = useState<Set<number>>(() => new Set());
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Lifted here (not local state in CategoryBreakdown/RecurringSection)
  // because both of those unmount whenever the Expenses/Income toggle
  // switches away from Expenses — local state there would silently reset on
  // every tab switch, collapsing a section the user had just expanded.
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  const pendingDeletes = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pendingIncomeDeletes = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const handleListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setShowScrollToTop(el.scrollTop > 300);
  };

  const scrollToTop = () => {
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    fetch("/categories").then((r) => r.json()).then(setCategories);
    fetch("/income/categories").then((r) => r.json()).then(setIncomeCategories);
  }, []);

  const fetchBudgets = () => {
    authFetch("/budgets").then((r) => r.json()).then(setBudgets);
  };

  useEffect(() => {
    fetchBudgets();
    authFetch("/expenses/recurring").then((r) => r.json()).then(setRecurring);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => {
    return expenses
      .filter((e) => !deletedIds.has(e.id))
      .map((e) => (overrides[e.id] ? { ...e, ...overrides[e.id] } : e));
  }, [expenses, overrides, deletedIds]);

  const incomeItems = useMemo(() => {
    return income
      .filter((i) => !deletedIncomeIds.has(i.id))
      .map((i) => (incomeOverrides[i.id] ? { ...i, ...incomeOverrides[i.id] } : i));
  }, [income, incomeOverrides, deletedIncomeIds]);

  const months = useMemo(() => {
    const seen = new Set<string>();
    items.forEach((e) => seen.add(e.date.slice(0, 7)));
    return Array.from(seen).sort().reverse();
  }, [items]);

  const selectedMonth = selectedMonthOverride ?? (months[0] ?? "all");

  const monthFlagFiltered = items
    .filter((e) => selectedMonth === "all" || e.date.startsWith(selectedMonth))
    .filter((e) => !flaggedOnly || e.flagged);
  const userSearchFiltered = monthFlagFiltered
    .filter((e) => !userFilter || e.logged_by === userFilter)
    .filter((e) => !searchQuery || e.description.toLowerCase().includes(searchQuery.trim().toLowerCase()));
  const filtered = userSearchFiltered
    .filter((e) => !categoryFilter || e.category === categoryFilter);
  const total = filtered.reduce((sum, e) => sum + e.amount, 0);
  const animatedTotal = useAnimatedNumber(total);
  const emptyMessage = items.length === 0 ? "No expenses yet" : "No expenses match your filters";

  // Income view has no filters — total is just the sum of incomeItems
  // (already sorted date DESC server-side, adjusted for optimistic
  // edits/deletes the same way `items` adjusts the expense list).
  const incomeTotal = incomeItems.reduce((sum, i) => sum + i.amount, 0);
  const animatedIncomeTotal = useAnimatedNumber(incomeTotal);
  const displayTotal = view === "expenses" ? animatedTotal : animatedIncomeTotal;

  // Net cash flow, all-time and unfiltered by the month/search controls (those
  // only apply to the Expenses view's own total) — uses `items` rather than the
  // raw `expenses` prop so an optimistic delete-with-undo is reflected instantly.
  const netCashFlow = incomeTotal - items.reduce((sum, e) => sum + e.amount, 0);
  const animatedNetCashFlow = useAnimatedNumber(netCashFlow);

  const budgetMap = useMemo(() => {
    const map: Record<string, number> = {};
    budgets.forEach((b) => { map[b.category] = b.monthly_limit; });
    return map;
  }, [budgets]);

  const categoryTotals: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  userSearchFiltered.forEach((e) => {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
    categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
  });
  const categoryGrandTotal = userSearchFiltered.reduce((sum, e) => sum + e.amount, 0);
  const maxCategoryTotal = Math.max(0, ...Object.values(categoryTotals));
  const breakdown = Object.entries(categoryTotals)
    .map(([category, amount]) => ({
      category,
      amount,
      count: categoryCounts[category],
      pct: categoryGrandTotal ? (amount / categoryGrandTotal) * 100 : 0,
      barPct: maxCategoryTotal ? (amount / maxCategoryTotal) * 100 : 0,
      limit: selectedMonth !== "all" ? budgetMap[category] : undefined,
    }))
    .sort((a, b) => b.amount - a.amount);

  const toggleFlag = async (e: Expense, ev?: MouseEvent) => {
    ev?.stopPropagation();
    const flagged = !e.flagged;
    setOverrides((prev) => ({ ...prev, [e.id]: { ...prev[e.id], flagged } }));
    try {
      const res = await authFetch(`/expenses/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagged }),
      });
      if (!res.ok) throw new Error();
      onExpenseChange();
    } catch {
      setOverrides((prev) => ({ ...prev, [e.id]: { ...prev[e.id], flagged: e.flagged } }));
      toast.error("Failed to update flag");
    }
  };

  const openEdit = (e: Expense) => {
    setEditingExpense(e);
  };

  const saveEdit = async (values: EditValues) => {
    if (!editingExpense) return;
    const id = editingExpense.id;
    const original = items.find((x) => x.id === id);
    // Unrolled rather than looped over a key array — a loop needs an unsafe
    // cast to write a union-keyed value back into `changes` (TS can't verify
    // a same-key read/write correlation across loop iterations), and this is
    // few enough fields that the explicit form costs nothing in clarity.
    const changes: Partial<EditValues> = {};
    if (values.amount !== editingExpense.amount) changes.amount = values.amount;
    if (values.category !== editingExpense.category) changes.category = values.category;
    if (values.description !== editingExpense.description) changes.description = values.description;
    if (values.date !== editingExpense.date) changes.date = values.date;
    if (values.flagged !== editingExpense.flagged) changes.flagged = values.flagged;
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...values } }));
    setEditingExpense(null);
    try {
      const res = await authFetch(`/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) throw new Error();
      toast.success("Expense updated");
      onExpenseChange();
    } catch {
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...original } }));
      toast.error("Failed to update expense");
    }
  };

  const restoreDeleted = (id: number) => {
    clearTimeout(pendingDeletes.current[id]);
    delete pendingDeletes.current[id];
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const deleteExpenseById = (id: number) => {
    setDeletedIds((prev) => new Set(prev).add(id));

    const toastId = toast("Expense deleted", {
      action: { label: "Undo", onClick: () => restoreDeleted(id) },
      duration: 5000,
    });

    pendingDeletes.current[id] = setTimeout(async () => {
      delete pendingDeletes.current[id];
      try {
        const res = await authFetch(`/expenses/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        onExpenseChange();
      } catch {
        setDeletedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        toast.dismiss(toastId);
        toast.error("Failed to delete expense");
      }
    }, 5000);
  };

  const deleteExpense = () => {
    if (!editingExpense) return;
    deleteExpenseById(editingExpense.id);
    setEditingExpense(null);
  };

  const openEditIncome = (i: Income) => {
    setEditingIncome(i);
  };

  const saveEditIncome = async (values: IncomeEditValues) => {
    if (!editingIncome) return;
    const id = editingIncome.id;
    const original = incomeItems.find((x) => x.id === id);
    const changes: Partial<IncomeEditValues> = {};
    if (values.amount !== editingIncome.amount) changes.amount = values.amount;
    if (values.category !== editingIncome.category) changes.category = values.category;
    if (values.description !== editingIncome.description) changes.description = values.description;
    if (values.date !== editingIncome.date) changes.date = values.date;
    setIncomeOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...values } }));
    setEditingIncome(null);
    try {
      const res = await authFetch(`/income/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) throw new Error();
      toast.success("Income updated");
      onIncomeChange?.();
    } catch {
      setIncomeOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...original } }));
      toast.error("Failed to update income");
    }
  };

  const restoreDeletedIncome = (id: number) => {
    clearTimeout(pendingIncomeDeletes.current[id]);
    delete pendingIncomeDeletes.current[id];
    setDeletedIncomeIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const deleteIncomeById = (id: number) => {
    setDeletedIncomeIds((prev) => new Set(prev).add(id));

    const toastId = toast("Income deleted", {
      action: { label: "Undo", onClick: () => restoreDeletedIncome(id) },
      duration: 5000,
    });

    pendingIncomeDeletes.current[id] = setTimeout(async () => {
      delete pendingIncomeDeletes.current[id];
      try {
        const res = await authFetch(`/income/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        onIncomeChange?.();
      } catch {
        setDeletedIncomeIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        toast.dismiss(toastId);
        toast.error("Failed to delete income");
      }
    }, 5000);
  };

  const deleteIncome = () => {
    if (!editingIncome) return;
    deleteIncomeById(editingIncome.id);
    setEditingIncome(null);
  };

  return (
    <div className={`${className} flex-col flex-1 overflow-hidden bg-background`}>

      {/* Edit modal — shared between mobile and desktop */}
      <ExpenseEditDialog
        expense={editingExpense}
        categories={categories}
        onSave={saveEdit}
        onDelete={deleteExpense}
        onClose={() => setEditingExpense(null)}
      />
      <IncomeEditDialog
        income={editingIncome}
        categories={incomeCategories}
        onSave={saveEditIncome}
        onDelete={deleteIncome}
        onClose={() => setEditingIncome(null)}
      />

      {/* Header */}
      <div className="flex flex-col gap-2.5 px-4 py-3 border-b border-border shrink-0 md:px-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <div role="tablist" aria-label="View" className="inline-flex rounded-md border border-border p-0.5 shrink-0">
              <button
                type="button"
                role="tab"
                aria-selected={view === "expenses"}
                onClick={() => setView("expenses")}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors ${
                  view === "expenses" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Expenses
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "income"}
                onClick={() => setView("income")}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors ${
                  view === "income" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Income
              </button>
            </div>
            {view === "expenses" && categoryFilter && (
              <button
                onClick={() => setCategoryFilter(null)}
                className="h-6 px-2 text-xs inline-flex items-center gap-1 rounded-full border border-foreground/30 bg-muted text-foreground shrink-0"
              >
                {categoryFilter}
                <span className="text-muted-foreground">✕</span>
              </button>
            )}
            {view === "expenses" && userFilter && (
              <button
                onClick={() => setUserFilter(null)}
                className="h-6 px-2 text-xs inline-flex items-center gap-1 rounded-full border border-foreground/30 bg-muted text-foreground shrink-0"
              >
                {userFilter}
                <span className="text-muted-foreground">✕</span>
              </button>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0 flex flex-col items-end gap-0.5">
            <span>
              Total: <span className="font-semibold text-foreground">${displayTotal.toFixed(2)}</span>
            </span>
            <span
              title="Net cash flow, all time: total income minus total expenses"
              className={animatedNetCashFlow >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
            >
              Net: <span className="font-semibold">
                {animatedNetCashFlow >= 0 ? "+" : "-"}${Math.abs(animatedNetCashFlow).toFixed(2)}
              </span>
            </span>
          </span>
        </div>

        {view === "expenses" && (
          <div className="flex items-center gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonthOverride}>
              <SelectTrigger className="h-8 text-xs w-28 md:w-32 shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent className={undefined}>
                <SelectItem value="all" className={undefined}>All time</SelectItem>
                {months.map((m) => <SelectItem key={m} value={m} className={undefined}>{formatMonth(m)}</SelectItem>)}
              </SelectContent>
            </Select>

            <button
              onClick={() => setFlaggedOnly((f) => !f)}
              title="Flagged only"
              aria-label="Flagged only"
              aria-pressed={flaggedOnly}
              className={`shrink-0 h-8 w-8 flex items-center justify-center rounded-md border transition-colors ${
                flaggedOnly
                  ? "border-amber-400 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <Flag className="w-3.5 h-3.5" fill={flaggedOnly ? "currentColor" : "none"} />
            </button>

            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="h-8 text-sm pl-7 pr-7"
                type={undefined}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* New activity since you left — household awareness, derived purely
          from data already fetched via /expenses (no new endpoint/infra). */}
      {view === "expenses" && newFromOthers.length > 0 && (
        <div className="mx-4 mt-3 md:mx-5 shrink-0 rounded-xl border border-border bg-muted/40 px-3 py-2 flex items-center gap-2">
          <span className="flex-1 text-xs text-foreground">
            <span className="font-semibold">{newFromOthers.length}</span> new expense{newFromOthers.length !== 1 ? "s" : ""} from{" "}
            {newActivityNames.join(" & ")} since you were last here
          </span>
          <button
            type="button"
            onClick={dismissNewActivity}
            aria-label="Dismiss new activity notice"
            className="shrink-0 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 text-sm leading-none"
          >
            ×
          </button>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
      <div ref={listRef} onScroll={handleListScroll} className="h-full overflow-y-auto overscroll-contain">

        {/* ── Category breakdown ── */}
        {view === "expenses" && (
          <CategoryBreakdown
            breakdown={breakdown}
            maxCategoryTotal={maxCategoryTotal}
            categoryFilter={categoryFilter}
            onCategoryClick={(category) => setCategoryFilter((c) => (c === category ? null : category))}
            categories={categories}
            budgetMap={budgetMap}
            spendByCategory={selectedMonth !== "all" ? categoryTotals : undefined}
            authFetch={authFetch}
            onBudgetSaved={fetchBudgets}
            showAllCategories={showAllCategories}
            onToggleShowAllCategories={() => setShowAllCategories((v) => !v)}
          />
        )}

        {/* ── Recurring charges ── */}
        {view === "expenses" && (
          <RecurringSection
            recurring={recurring}
            searchQuery={searchQuery}
            showRecurring={showRecurring}
            onToggleShowRecurring={() => setShowRecurring((v) => !v)}
          />
        )}

        {/* ── Expense list (mobile cards + desktop table) ── */}
        {view === "expenses" && (
          <ExpenseList
            loading={loading}
            filtered={filtered}
            emptyMessage={emptyMessage}
            highlightIds={highlightIds}
            userFilter={userFilter}
            onUserFilterToggle={(u) => setUserFilter((f) => (f === u ? null : u))}
            onEdit={openEdit}
            onToggleFlag={toggleFlag}
            onDelete={deleteExpenseById}
          />
        )}

        {/* ── Income list (mobile cards + desktop table) ── */}
        {view === "income" && <IncomeList income={incomeItems} onEdit={openEditIncome} />}

      </div>
      {showScrollToTop && (
        <button
          onClick={scrollToTop}
          aria-label="Scroll to top"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-9 h-9 rounded-full bg-foreground text-background shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}
      </div>
    </div>
  );
}

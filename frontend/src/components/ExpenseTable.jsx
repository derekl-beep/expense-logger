import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X, ArrowUp, Flag, Trash2, Wallet, Search, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerTrigger } from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";
import { CategoryBadge, BreakdownRow } from "@/components/CategoryVisuals";
import { useAnimatedNumber } from "@/lib/categoryVisuals";

const formatDate = (d) =>
  new Date(d + "T00:00:00").toLocaleDateString("default", { month: "short", day: "numeric" });

const formatSectionDate = (d) => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Date(d + "T00:00:00").toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" });
};

const formatMonth = (ym) => {
  const [year, month] = ym.split("-");
  return new Date(year, month - 1).toLocaleString("default", { month: "long", year: "numeric" });
};

const ExpenseSkeleton = () => (
  <div className="px-4 py-3 space-y-3">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
    ))}
  </div>
);

const SWIPE_MAX = 88;
const SWIPE_THRESHOLD = 64;

const SwipeableRow = ({ onSwipeLeft, onSwipeRight, children }) => {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, y: 0 });
  const axisRef = useRef(null); // "x" | "y" | null

  const onTouchStart = (e) => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
    axisRef.current = null;
    setDragging(false);
  };

  const onTouchMove = (e) => {
    const t = e.touches[0];
    const deltaX = t.clientX - startRef.current.x;
    const deltaY = t.clientY - startRef.current.y;

    if (axisRef.current === null && (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8)) {
      axisRef.current = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
    }
    if (axisRef.current !== "x") return;

    setDragging(true);
    const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, deltaX));
    setDx(clamped);
  };

  const onTouchEnd = () => {
    if (dx >= SWIPE_THRESHOLD) onSwipeRight?.();
    else if (dx <= -SWIPE_THRESHOLD) onSwipeLeft?.();
    setDragging(false);
    setDx(0);
  };

  const pastRight = dx >= SWIPE_THRESHOLD;
  const pastLeft = dx <= -SWIPE_THRESHOLD;

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 flex items-stretch justify-between">
        <div
          className={`flex items-center justify-start pl-4 text-white transition-colors duration-150 ${pastRight ? "bg-amber-600" : "bg-amber-500"}`}
          style={{ width: SWIPE_MAX }}
        >
          <Flag
            className="w-4 h-4 transition-transform duration-150"
            style={{ transform: pastRight ? "scale(1.4)" : "scale(1)" }}
          />
        </div>
        <div
          className="flex items-center justify-end pr-4 bg-destructive text-destructive-foreground transition-colors duration-150"
          style={{ width: SWIPE_MAX, filter: pastLeft ? "brightness(1.25)" : "none" }}
        >
          <Trash2
            className="w-4 h-4 transition-transform duration-150"
            style={{ transform: pastLeft ? "scale(1.4)" : "scale(1)" }}
          />
        </div>
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 200ms ease-out",
          touchAction: "pan-y",
        }}
        className="relative bg-background"
      >
        {children}
      </div>
    </div>
  );
};

const valuesFromBudgetMap = (categories, budgetMap) => {
  const values = {};
  categories.forEach((c) => { values[c] = budgetMap[c] != null ? String(budgetMap[c]) : ""; });
  return values;
};

const sortCategoriesByBudget = (categories, budgetMap) => {
  const budgeted = [];
  const unbudgeted = [];
  categories.forEach((c) => (budgetMap[c] != null ? budgeted : unbudgeted).push(c));
  budgeted.sort((a, b) => a.localeCompare(b));
  unbudgeted.sort((a, b) => a.localeCompare(b));
  return [...budgeted, ...unbudgeted];
};

const BudgetSettings = ({ categories, budgetMap, spendByCategory, authFetch, onSaved }) => {
  const [values, setValues] = useState(() => valuesFromBudgetMap(categories, budgetMap));
  const [syncedBudgetMap, setSyncedBudgetMap] = useState(budgetMap);
  const [orderedCategories, setOrderedCategories] = useState(() => sortCategoriesByBudget(categories, budgetMap));

  if (budgetMap !== syncedBudgetMap) {
    setSyncedBudgetMap(budgetMap);
    setValues(valuesFromBudgetMap(categories, budgetMap));
    setOrderedCategories(sortCategoriesByBudget(categories, budgetMap));
  }

  const handleBlur = async (category) => {
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
              <CategoryBadge category={category} small />
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
                  onChange={(e) => setValues((v) => ({ ...v, [category]: e.target.value }))}
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

const BudgetDialog = ({ categories, budgetMap, spendByCategory, authFetch, onSaved }) => {
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
          onOpenAutoFocus={(e) => {
            // Don't let Radix autofocus the first budget input — that pops
            // the mobile keyboard immediately on open. Focus the dialog
            // container itself instead (it's a valid, non-input focus
            // target per the ARIA dialog pattern) so keyboard/screen-reader
            // users still land inside the dialog rather than nowhere.
            e.preventDefault();
            e.currentTarget.focus();
          }}
        >
          <DialogHeader>
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
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-sm font-semibold">Manage Budgets</DrawerTitle>
          <DrawerDescription className="sr-only">Set monthly spending limits per category</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-4">{form}</div>
      </DrawerContent>
    </Drawer>
  );
};

export default function ExpenseTable({ expenses, className = "", token, username, onExpenseChange, onUnauthorized, loading = false, highlightIds }) {
  const authFetch = (url, opts = {}) => {
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
  const [lastSeenId, setLastSeenId] = useState(() => {
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
    () => (lastSeenId == null ? [] : expenses.filter((e) => e.logged_by && e.logged_by !== username && e.id > lastSeenId)),
    [expenses, lastSeenId, username]
  );
  const newActivityNames = [...new Set(newFromOthers.map((e) => e.logged_by))];

  const dismissNewActivity = () => {
    const maxId = Math.max(lastSeenId ?? 0, ...expenses.map((e) => e.id));
    localStorage.setItem(lastSeenKey, String(maxId));
    setLastSeenId(maxId);
  };

  const [selectedMonthOverride, setSelectedMonthOverride] = useState(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [categories, setCategories] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [showRecurring, setShowRecurring] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [deletedIds, setDeletedIds] = useState(() => new Set());
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [userFilter, setUserFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const pendingDeletes = useRef({});
  const listRef = useRef(null);
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

  const months = useMemo(() => {
    const seen = new Set();
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

  const budgetMap = useMemo(() => {
    const map = {};
    budgets.forEach((b) => { map[b.category] = b.monthly_limit; });
    return map;
  }, [budgets]);

  const categoryTotals = {};
  const categoryCounts = {};
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

  const toggleFlag = async (e, ev) => {
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

  const openEdit = (e) => {
    setEditingExpense(e);
    setEditValues({ amount: e.amount, category: e.category, description: e.description, date: e.date, flagged: !!e.flagged });
  };

  const saveEdit = async () => {
    const id = editingExpense.id;
    const original = items.find((x) => x.id === id);
    const changes = {};
    for (const key of ["amount", "category", "description", "date", "flagged"]) {
      if (editValues[key] !== editingExpense[key]) changes[key] = editValues[key];
    }
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...editValues } }));
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

  const restoreDeleted = (id) => {
    clearTimeout(pendingDeletes.current[id]);
    delete pendingDeletes.current[id];
    setDeletedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const deleteExpenseById = (id) => {
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
    deleteExpenseById(editingExpense.id);
    setEditingExpense(null);
  };

  const confirmSwipeDelete = () => {
    deleteExpenseById(deleteConfirm.id);
    setDeleteConfirm(null);
  };

  return (
    <div className={`${className} flex-col flex-1 overflow-hidden bg-background`}>

      {/* Edit modal — shared between mobile and desktop */}
      <Dialog open={!!editingExpense} onOpenChange={(open) => { if (!open) setEditingExpense(null); }}>
        <DialogContent
          className="sm:max-w-sm"
          onOpenAutoFocus={(e) => {
            // Same rationale as BudgetDialog: skip autofocusing the
            // Description input (avoids an immediate mobile keyboard pop),
            // but still move focus into the dialog itself rather than
            // leaving it stranded on the now-inert trigger behind the modal.
            e.preventDefault();
            e.currentTarget.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Edit Expense</DialogTitle>
            <DialogDescription className="sr-only">Edit the details of this expense</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <Input value={editValues.description ?? ""} className="h-9 text-base md:text-sm"
                onChange={(e) => setEditValues({ ...editValues, description: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Date</label>
              <Input type="date" value={editValues.date ?? ""} className="h-9 text-base md:text-sm"
                onChange={(e) => setEditValues({ ...editValues, date: e.target.value })} />
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <label className="text-xs text-muted-foreground mb-1 block">Amount</label>
                <div className="flex gap-1">
                  {[2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      title={`Split ${n} ways`}
                      onClick={() => setEditValues((v) => {
                        const amt = parseFloat(v.amount);
                        return Number.isFinite(amt) ? { ...v, amount: Math.round((amt / n) * 100) / 100 } : v;
                      })}
                      className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 transition-colors"
                    >
                      {["½", "⅓", "¼"][n - 2]}
                    </button>
                  ))}
                </div>
              </div>
              <Input type="number" inputMode="decimal" step="0.01" value={editValues.amount ?? ""} className="h-9 text-base md:text-sm"
                onChange={(e) => setEditValues({ ...editValues, amount: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Category</label>
              <Select value={editValues.category} onValueChange={(v) => setEditValues({ ...editValues, category: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {editValues.category && !categories.includes(editValues.category) && (
                    <SelectItem value={editValues.category}>{editValues.category} (unrecognized)</SelectItem>
                  )}
                  {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <button
              type="button"
              onClick={() => setEditValues({ ...editValues, flagged: !editValues.flagged })}
              className={`flex items-center gap-2 text-xs px-3 py-2 rounded-md border w-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 transition-colors ${
                editValues.flagged
                  ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700 focus-visible:border-amber-500"
                  : "border-border text-muted-foreground hover:bg-muted focus-visible:border-ring"
              }`}
            >
              <span>⚑</span>
              <span>{editValues.flagged ? "Flagged for follow-up" : "Flag for follow-up"}</span>
            </button>
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-between">
            <Button variant="destructive" size="sm" className="text-xs" onClick={deleteExpense}>Delete</Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setEditingExpense(null)}>Cancel</Button>
              <Button size="sm" className="text-xs" onClick={saveEdit}>Save</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Swipe-to-delete confirmation — mobile only */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Delete Expense</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground py-1">
              Delete "{deleteConfirm?.description}" — ${deleteConfirm?.amount.toFixed(2)}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="text-xs" onClick={confirmSwipeDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex flex-col gap-2.5 px-4 py-3 border-b border-border shrink-0 md:px-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold text-foreground shrink-0">All Expenses</span>
            {categoryFilter && (
              <button
                onClick={() => setCategoryFilter(null)}
                className="h-6 px-2 text-xs inline-flex items-center gap-1 rounded-full border border-foreground/30 bg-muted text-foreground shrink-0"
              >
                {categoryFilter}
                <span className="text-muted-foreground">✕</span>
              </button>
            )}
            {userFilter && (
              <button
                onClick={() => setUserFilter(null)}
                className="h-6 px-2 text-xs inline-flex items-center gap-1 rounded-full border border-foreground/30 bg-muted text-foreground shrink-0"
              >
                {userFilter}
                <span className="text-muted-foreground">✕</span>
              </button>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            Total: <span className="font-semibold text-foreground">${animatedTotal.toFixed(2)}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedMonth} onValueChange={setSelectedMonthOverride}>
            <SelectTrigger className="h-8 text-xs w-28 md:w-32 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              {months.map((m) => <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>)}
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
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              className="h-8 text-sm pl-7 pr-7"
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
      </div>

      {/* New activity since you left — household awareness, derived purely
          from data already fetched via /expenses (no new endpoint/infra). */}
      {newFromOthers.length > 0 && (
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
        {breakdown.length > 0 && (
          <div className="px-4 py-3 md:px-5 border-b border-border/50">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Breakdown</div>
              <BudgetDialog
                categories={categories}
                budgetMap={budgetMap}
                spendByCategory={selectedMonth !== "all" ? categoryTotals : undefined}
                authFetch={authFetch}
                onSaved={fetchBudgets}
              />
            </div>
            <div className="space-y-1.5">
              {(showAllCategories ? breakdown : breakdown.slice(0, 5)).map(({ category, amount, count, pct, barPct, limit }) => (
                <BreakdownRow
                  key={category}
                  category={category}
                  amount={amount}
                  count={count}
                  pct={pct}
                  barPct={barPct}
                  limit={limit}
                  maxCategoryTotal={maxCategoryTotal}
                  active={categoryFilter === category}
                  onClick={() => setCategoryFilter((c) => (c === category ? null : category))}
                />
              ))}
            </div>
            {breakdown.length > 5 && (
              <button
                onClick={() => setShowAllCategories((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
              >
                {showAllCategories ? "View less" : `View ${breakdown.length - 5} more`}
              </button>
            )}
          </div>
        )}

        {/* ── Recurring charges ── */}
        {recurring.length > 0 && (
          <div className={`px-4 py-3 md:px-5 border-b border-border/50 ${searchQuery ? "hidden md:block" : ""}`}>
            <button
              type="button"
              onClick={() => setShowRecurring((v) => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Recurring · {recurring.length}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showRecurring ? "rotate-180" : ""}`} />
            </button>
            {showRecurring && (
              <div className="space-y-0.5 mt-2 -mx-1">
                {recurring.map((r) => (
                  <div
                    key={`${r.description}-${r.amount}`}
                    className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/50 transition-colors"
                  >
                    <CategoryBadge category={r.category} small />
                    <span className="text-xs text-foreground flex-1 truncate">{r.description}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium bg-primary/10 text-primary shrink-0">
                      {r.frequency[0].toUpperCase() + r.frequency.slice(1)}
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums shrink-0">${r.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Mobile card list ── */}
        <div className="md:hidden">
          {loading ? (
            <ExpenseSkeleton />
          ) : filtered.length === 0 ? (
            <p className="text-center py-16 text-muted-foreground text-sm">{emptyMessage}</p>
          ) : filtered.reduce((groups, e) => {
            const last = groups[groups.length - 1];
            if (!last || last.date !== e.date) groups.push({ date: e.date, items: [e] });
            else last.items.push(e);
            return groups;
          }, []).map(({ date, items }) => (
            <div key={date}>
              <div className="px-4 py-1.5 bg-muted/60 sticky top-0 z-10 border-b border-border/50">
                <span className="text-xs font-medium text-muted-foreground">{formatSectionDate(date)}</span>
              </div>
              {items.map((e) => (
                <SwipeableRow key={e.id} onSwipeRight={() => toggleFlag(e)} onSwipeLeft={() => setDeleteConfirm(e)}>
                  <div
                    className={`flex items-center gap-3 px-4 py-3 border-b border-border/50 active:bg-muted transition-colors cursor-pointer ${highlightIds?.has(e.id) ? "row-highlight" : ""}`}
                    onClick={() => openEdit(e)}
                  >
                    <CategoryBadge
                      category={e.category}
                      small
                      loggedBy={e.logged_by}
                      onUserClick={(u) => setUserFilter((f) => (f === u ? null : u))}
                      userActive={userFilter === e.logged_by}
                    />
                    <span className="flex-1 text-sm font-medium text-foreground truncate">{e.description}</span>
                    <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">${e.amount.toFixed(2)}</span>
                    <button
                      onClick={(ev) => toggleFlag(e, ev)}
                      aria-label={e.flagged ? "Unflag expense" : "Flag expense"}
                      className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-sm transition-colors ${
                        e.flagged ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground/30 hover:text-amber-500"
                      }`}
                    >⚑</button>
                  </div>
                </SwipeableRow>
              ))}
            </div>
          ))}
        </div>

        {/* ── Desktop table ── */}
        <table className="w-full text-sm border-collapse hidden md:table">
          <thead className="sticky top-0 bg-background z-10">
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-16">Date</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-28">Category</th>
              <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-20">Amount</th>
              <th className="w-10"></th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}><ExpenseSkeleton /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-16 text-muted-foreground text-sm">{emptyMessage}</td></tr>
            ) : filtered.map((e) => (
              <tr key={e.id}
                className={`border-b border-border/50 hover:bg-muted/50 cursor-pointer group transition-colors ${highlightIds?.has(e.id) ? "row-highlight" : ""}`}
                onClick={() => openEdit(e)}
              >
                <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(e.date)}</td>
                <td className="px-3 py-3 text-sm text-foreground">{e.description}</td>
                <td className="px-3 py-3">
                  <CategoryBadge
                    category={e.category}
                    loggedBy={e.logged_by}
                    onUserClick={(u) => setUserFilter((f) => (f === u ? null : u))}
                    userActive={userFilter === e.logged_by}
                  />
                </td>
                <td className="px-3 py-3 text-right text-sm font-medium text-foreground tabular-nums">${e.amount.toFixed(2)}</td>
                <td className="py-3 px-1">
                  <button
                    onClick={(ev) => toggleFlag(e, ev)}
                    aria-label={e.flagged ? "Unflag expense" : "Flag expense"}
                    className={`w-9 h-9 flex items-center justify-center rounded-md text-sm transition-all ${
                      e.flagged
                        ? "text-amber-500 dark:text-amber-400"
                        : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-amber-500"
                    }`}
                  >⚑</button>
                </td>
                <td className="py-3 px-1">
                  <button
                    className="opacity-0 group-hover:opacity-100 w-9 h-9 flex items-center justify-center rounded-md text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                    onClick={(ev) => { ev.stopPropagation(); deleteExpenseById(e.id); }}
                    aria-label="Delete expense"
                  >✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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

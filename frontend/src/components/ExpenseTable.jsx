import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const CATEGORY_COLORS = {
  "Dining":        "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  "Drinks":        "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  "Groceries":     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  "Transport":     "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  "Driving":       "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400",
  "Gas":           "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400",
  "Travel":        "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400",
  "Clothing":      "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
  "Beauty":        "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-400",
  "Entertainment": "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  "Subscription":  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  "Health":        "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  "Household":     "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
  "Furniture":     "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-400",
  "Rent":          "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  "Hydro":         "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  "Telecom":       "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  "Settling Down": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400",
};

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

const CategoryBadge = ({ category, small = false }) => (
  <span className={`inline-flex items-center rounded font-medium ${
    small ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs rounded-md"
  } ${CATEGORY_COLORS[category] ?? "bg-muted text-muted-foreground"}`}>
    {category}
  </span>
);

export default function ExpenseTable({ expenses, className = "", token, onExpenseChange, onUnauthorized }) {
  const authFetch = (url, opts = {}) => {
    const res = fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } });
    res.then((r) => { if (r.status === 401) onUnauthorized(); });
    return res;
  };

  const [selectedMonth, setSelectedMonth] = useState("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    fetch("/categories").then((r) => r.json()).then(setCategories);
  }, []);

  const months = useMemo(() => {
    const seen = new Set();
    expenses.forEach((e) => seen.add(e.date.slice(0, 7)));
    return Array.from(seen).sort().reverse();
  }, [expenses]);

  const filtered = expenses
    .filter((e) => selectedMonth === "all" || e.date.startsWith(selectedMonth))
    .filter((e) => !flaggedOnly || e.flagged);
  const total = filtered.reduce((sum, e) => sum + e.amount, 0);

  const toggleFlag = async (e, ev) => {
    ev.stopPropagation();
    await authFetch(`/expenses/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flagged: !e.flagged }),
    });
    onExpenseChange();
  };

  const openEdit = (e) => {
    setEditingExpense(e);
    setEditValues({ amount: e.amount, category: e.category, description: e.description, date: e.date, flagged: !!e.flagged });
  };

  const saveEdit = async () => {
    await authFetch(`/expenses/${editingExpense.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editValues),
    });
    setEditingExpense(null);
    onExpenseChange();
  };

  const deleteExpense = async () => {
    await authFetch(`/expenses/${editingExpense.id}`, { method: "DELETE" });
    setEditingExpense(null);
    onExpenseChange();
  };

  const exportCSV = async () => {
    const res = await authFetch("/expenses/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expenses.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`${className} flex-col flex-1 overflow-hidden bg-background`}>

      {/* Edit modal — shared between mobile and desktop */}
      <Dialog open={!!editingExpense} onOpenChange={(open) => { if (!open) setEditingExpense(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Edit Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <Input value={editValues.description ?? ""} className="h-9 text-sm"
                onChange={(e) => setEditValues({ ...editValues, description: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Date</label>
                <Input type="date" value={editValues.date ?? ""} className="h-9 text-sm"
                  onChange={(e) => setEditValues({ ...editValues, date: e.target.value })} />
              </div>
              <div className="w-28">
                <label className="text-xs text-muted-foreground mb-1 block">Amount</label>
                <Input type="number" step="0.01" value={editValues.amount ?? ""} className="h-9 text-sm text-right"
                  onChange={(e) => setEditValues({ ...editValues, amount: parseFloat(e.target.value) })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Category</label>
              <Select value={editValues.category} onValueChange={(v) => setEditValues({ ...editValues, category: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <button
              onClick={() => setEditValues({ ...editValues, flagged: !editValues.flagged })}
              className={`flex items-center gap-2 text-xs px-3 py-2 rounded-md border w-full transition-colors ${
                editValues.flagged
                  ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
                  : "border-border text-muted-foreground hover:bg-muted"
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

      {/* Header */}
      <div className="flex flex-col gap-2 px-4 py-3 border-b border-border shrink-0 md:flex-row md:items-center md:justify-between md:px-5">
        <div className="flex items-center justify-between md:justify-start md:gap-3">
          <span className="text-sm font-semibold text-foreground">All Expenses</span>
          <span className="text-xs text-muted-foreground md:hidden">
            Total: <span className="font-semibold text-foreground">${total.toFixed(2)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              {months.map((m) => <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <button
            onClick={() => setFlaggedOnly((f) => !f)}
            className={`h-8 px-3 text-xs inline-flex items-center gap-1 rounded-md border transition-colors ${
              flaggedOnly
                ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            ⚑ Flagged
          </button>
          <span className="text-xs text-muted-foreground hidden md:inline">
            Total: <span className="font-semibold text-foreground">${total.toFixed(2)}</span>
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors text-base">
                ⋯
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={exportCSV} className="text-xs cursor-pointer">
                Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Mobile card list ── */}
        <div className="md:hidden">
          {filtered.length === 0 ? (
            <p className="text-center py-16 text-muted-foreground text-sm">No expenses yet</p>
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
                <div key={e.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 active:bg-muted transition-colors cursor-pointer" onClick={() => openEdit(e)}>
                  <CategoryBadge category={e.category} small />
                  <span className="flex-1 text-sm font-medium text-foreground truncate">{e.description}</span>
                  <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">${e.amount.toFixed(2)}</span>
                  <button
                    onClick={(ev) => toggleFlag(e, ev)}
                    className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-sm transition-colors ${
                      e.flagged ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground/30 hover:text-amber-500"
                    }`}
                  >⚑</button>
                </div>
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
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-16 text-muted-foreground text-sm">No expenses yet</td></tr>
            ) : filtered.map((e) => (
              <tr key={e.id}
                className="border-b border-border/50 hover:bg-muted/50 cursor-pointer group transition-colors"
                onClick={() => openEdit(e)}
              >
                <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(e.date)}</td>
                <td className="px-3 py-3 text-sm text-foreground">{e.description}</td>
                <td className="px-3 py-3"><CategoryBadge category={e.category} /></td>
                <td className="px-3 py-3 text-right text-sm font-medium text-foreground tabular-nums">${e.amount.toFixed(2)}</td>
                <td className="py-3 px-1">
                  <button
                    onClick={(ev) => toggleFlag(e, ev)}
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
                    onClick={async (ev) => { ev.stopPropagation(); await authFetch(`/expenses/${e.id}`, { method: "DELETE" }); onExpenseChange(); }}
                  >✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

      </div>
    </div>
  );
}

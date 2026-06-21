import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORY_COLORS = {
  "Dining":        "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
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

const formatMonth = (ym) => {
  const [year, month] = ym.split("-");
  return new Date(year, month - 1).toLocaleString("default", { month: "long", year: "numeric" });
};

export default function ExpenseTable({ expenses, className = "", token, onExpenseChange, onUnauthorized }) {
  const authFetch = (url, opts = {}) => {
    const res = fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } });
    res.then((r) => { if (r.status === 401) onUnauthorized(); });
    return res;
  };
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    fetch("http://localhost:8000/categories").then((r) => r.json()).then(setCategories);
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
    await authFetch(`http://localhost:8000/expenses/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flagged: !e.flagged }),
    });
    onExpenseChange();
  };

  const startEdit = (e) => {
    setEditingId(e.id);
    setEditValues({ amount: e.amount, category: e.category, description: e.description, date: e.date });
  };

  const saveEdit = async () => {
    await authFetch(`http://localhost:8000/expenses/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editValues),
    });
    setEditingId(null);
    onExpenseChange();
  };

  const deleteRow = async (id) => {
    await authFetch(`http://localhost:8000/expenses/${id}`, { method: "DELETE" });
    onExpenseChange();
  };

  const exportCSV = async () => {
    const res = await authFetch("http://localhost:8000/expenses/export");
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

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground">All Expenses</span>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="h-7 text-xs w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              {months.map((m) => <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFlaggedOnly((f) => !f)}
            className={`h-7 px-2.5 text-xs inline-flex items-center gap-1 rounded-md border transition-colors ${
              flaggedOnly
                ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            ⚑ Flagged
          </button>
          <span className="text-xs text-muted-foreground">
            Total: <span className="font-semibold text-foreground">${total.toFixed(2)}</span>
          </span>
          <button onClick={exportCSV}
            className="h-7 px-2.5 text-xs inline-flex items-center rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors">
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-background z-10">
            <tr className="border-b border-border">
              <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-20">Date</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-32">Category</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-24">Amount</th>
              <th className="w-8"></th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-16 text-muted-foreground text-sm">No expenses yet</td></tr>
            ) : filtered.map((e) =>
              editingId === e.id ? (
                <tr key={e.id} className="bg-muted border-b border-border">
                  <td className="px-4 py-2">
                    <Input type="date" value={editValues.date} className="h-7 text-xs"
                      onChange={(ev) => setEditValues({ ...editValues, date: ev.target.value })} />
                  </td>
                  <td className="px-4 py-2">
                    <Input value={editValues.description} className="h-7 text-xs"
                      onChange={(ev) => setEditValues({ ...editValues, description: ev.target.value })} />
                  </td>
                  <td className="px-4 py-2">
                    <Select value={editValues.category} onValueChange={(v) => setEditValues({ ...editValues, category: v })}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2">
                    <Input type="number" step="0.01" value={editValues.amount} className="h-7 text-xs text-right"
                      onChange={(ev) => setEditValues({ ...editValues, amount: parseFloat(ev.target.value) })} />
                  </td>
                  <td></td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button onClick={saveEdit} className="w-6 h-6 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">✓</button>
                      <button onClick={() => setEditingId(null)} className="w-6 h-6 rounded text-xs bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">✕</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={e.id} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer group transition-colors"
                  onClick={() => startEdit(e)}>
                  <td className="px-5 py-3 text-xs text-muted-foreground tabular-nums">{formatDate(e.date)}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{e.description}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${CATEGORY_COLORS[e.category] ?? "bg-muted text-muted-foreground"}`}>
                      {e.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-foreground tabular-nums">${e.amount.toFixed(2)}</td>
                  <td className="px-2 py-3">
                    <button
                      onClick={(ev) => toggleFlag(e, ev)}
                      className={`w-6 h-6 rounded text-xs transition-all ${
                        e.flagged
                          ? "text-amber-500 dark:text-amber-400"
                          : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-amber-500"
                      }`}
                    >⚑</button>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                      onClick={(ev) => { ev.stopPropagation(); deleteRow(e.id); }}>✕</button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

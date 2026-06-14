import { useState, useMemo } from "react";

export default function ExpenseTable({ expenses, className = "", onExpenseChange }) {
  const [selectedMonth, setSelectedMonth] = useState("all");

  const months = useMemo(() => {
    const seen = new Set();
    expenses.forEach((e) => seen.add(e.date.slice(0, 7)));
    return Array.from(seen).sort().reverse();
  }, [expenses]);

  const filtered = selectedMonth === "all"
    ? expenses
    : expenses.filter((e) => e.date.startsWith(selectedMonth));

  const total = filtered.reduce((sum, e) => sum + e.amount, 0);

  const deleteRow = async (id) => {
    await fetch(`http://localhost:8000/expenses/${id}`, { method: "DELETE" });
    onExpenseChange();
  };

  const clearAll = async () => {
    if (!confirm("Delete all expenses?")) return;
    await fetch("http://localhost:8000/expenses", { method: "DELETE" });
    onExpenseChange();
  };

  const formatMonth = (ym) => {
    const [year, month] = ym.split("-");
    return new Date(year, month - 1).toLocaleString("default", { month: "long", year: "numeric" });
  };

  return (
    <div className={`table-panel ${className}`}>
      <div className="table-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          All Expenses
          <select
            className="month-select"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            <option value="all">All time</option>
            {months.map((m) => (
              <option key={m} value={m}>{formatMonth(m)}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span className="total">Total: ${total.toFixed(2)}</span>
          <a
            href="http://localhost:8000/expenses/export"
            download="expenses.csv"
            className="export-btn"
          >
            Export CSV
          </a>
          <button className="clear-btn" onClick={clearAll}>
            Clear All
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "#888" }}>
                  No expenses yet
                </td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.date + "T00:00:00").toLocaleDateString("default", { month: "short", day: "numeric" })}</td>
                  <td>{e.description}</td>
                  <td>{e.category}</td>
                  <td>${e.amount.toFixed(2)}</td>
                  <td>
                    <button className="delete-row-btn" onClick={() => deleteRow(e.id)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

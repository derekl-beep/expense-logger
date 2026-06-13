export default function ExpenseTable({ expenses, className = "" }) {
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className={`table-panel ${className}`}>
      <div className="table-header">
        All Expenses
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span className="total">Total: ${total.toFixed(2)}</span>
          <a
            href="http://localhost:8000/expenses/export"
            download="expenses.csv"
            className="export-btn"
          >
            Export CSV
          </a>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Category</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {expenses.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", color: "#888" }}>
                No expenses yet
              </td>
            </tr>
          ) : (
            expenses.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td>{e.description}</td>
                <td>{e.category}</td>
                <td>${e.amount.toFixed(2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

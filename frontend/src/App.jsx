import { useEffect, useState } from "react";
import Chat from "./components/Chat";
import ExpenseTable from "./components/ExpenseTable";
import "./App.css";

export default function App() {
  const [expenses, setExpenses] = useState([]);

  const fetchExpenses = async () => {
    const res = await fetch("http://localhost:8000/expenses");
    const data = await res.json();
    setExpenses(data);
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  return (
    <div className="layout">
      <Chat onExpenseChange={fetchExpenses} />
      <ExpenseTable expenses={expenses} />
    </div>
  );
}

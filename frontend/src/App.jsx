import { useEffect, useState } from "react";
import Chat from "./components/Chat";
import ExpenseTable from "./components/ExpenseTable";
import "./App.css";

export default function App() {
  const [expenses, setExpenses] = useState([]);
  const [activeTab, setActiveTab] = useState("chat");

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
      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === "chat" ? "active" : ""}`}
          onClick={() => setActiveTab("chat")}
        >
          Chat
        </button>
        <button
          className={`tab-btn ${activeTab === "expenses" ? "active" : ""}`}
          onClick={() => setActiveTab("expenses")}
        >
          Expenses
        </button>
      </div>

      <Chat
        className={activeTab !== "chat" ? "hidden-mobile" : ""}
        onExpenseChange={() => { fetchExpenses(); setActiveTab("chat"); }}
      />
      <ExpenseTable
        className={activeTab !== "expenses" ? "hidden-mobile" : ""}
        expenses={expenses}
      />
    </div>
  );
}

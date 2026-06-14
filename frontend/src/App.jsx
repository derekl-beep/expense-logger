import { useEffect, useState } from "react";
import Chat from "./components/Chat";
import ExpenseTable from "./components/ExpenseTable";

export default function App() {
  const [expenses, setExpenses] = useState([]);
  const [activeTab, setActiveTab] = useState("chat");

  const fetchExpenses = async () => {
    const res = await fetch("http://localhost:8000/expenses");
    const data = await res.json();
    setExpenses(data);
  };

  useEffect(() => { fetchExpenses(); }, []);

  const tabClass = (tab) =>
    `flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-zinc-900 text-zinc-900"
        : "border-transparent text-zinc-400"
    }`;

  return (
    <div className="h-screen md:min-h-screen md:bg-zinc-100 md:flex md:items-center md:justify-center md:p-6">
      <div className="h-screen md:h-[85vh] w-full md:max-w-5xl md:rounded-2xl md:shadow-xl overflow-hidden flex flex-col">

        {/* Mobile tab bar */}
        <div className="flex md:hidden shrink-0 bg-white border-b border-zinc-200">
          <button className={tabClass("chat")} onClick={() => setActiveTab("chat")}>Chat</button>
          <button className={tabClass("expenses")} onClick={() => setActiveTab("expenses")}>Expenses</button>
        </div>

        {/* Panels */}
        <div className="flex-1 flex overflow-hidden">
          <Chat
            className={activeTab === "chat" ? "flex" : "hidden md:flex"}
            onExpenseChange={() => { fetchExpenses(); setActiveTab("chat"); }}
          />
          <ExpenseTable
            className={activeTab === "expenses" ? "flex" : "hidden md:flex"}
            expenses={expenses}
            onExpenseChange={fetchExpenses}
          />
        </div>

      </div>
    </div>
  );
}

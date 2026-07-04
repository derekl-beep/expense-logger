import { useEffect, useRef, useState } from "react";
import Chat from "./components/Chat";
import ExpenseTable from "./components/ExpenseTable";
import Login from "./components/Login";
import { Toaster } from "./components/ui/sonner";

const HIGHLIGHT_MS = 2000;

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [username, setUsername] = useState(() => localStorage.getItem("username") || "");
  const [expenses, setExpenses] = useState([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [highlightIds, setHighlightIds] = useState(() => new Set());
  const highlightTimeoutRef = useRef(null);
  // Diff baseline for row highlighting — a ref (not the `expenses` state
  // closure) so concurrent fetches always compare against the most
  // recently known list, and null distinguishes "not loaded yet" from
  // "loaded, zero expenses" (both would otherwise read as length === 0).
  const lastKnownExpensesRef = useRef(null);
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem("activeTab") || "chat");
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0a0a0a" : "#ffffff");
  }, [dark]);

  const handleLogin = (tok, name) => {
    setToken(tok);
    setUsername(name);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setToken(null);
    setUsername("");
    setExpenses([]);
  };

  const fetchExpenses = async () => {
    const res = await fetch("/expenses", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { handleLogout(); return; }
    const data = await res.json();

    // Flash rows that are new or changed since the last fetch, so a
    // chat-driven save/edit visibly lands in the table instead of the
    // list silently refreshing underneath the user.
    if (lastKnownExpensesRef.current !== null) {
      const prevById = new Map(lastKnownExpensesRef.current.map((e) => [e.id, e]));
      const changed = new Set();
      for (const e of data) {
        const old = prevById.get(e.id);
        if (
          !old ||
          old.amount !== e.amount ||
          old.category !== e.category ||
          old.description !== e.description ||
          old.date !== e.date ||
          !!old.flagged !== !!e.flagged
        ) {
          changed.add(e.id);
        }
      }
      if (changed.size > 0) {
        setHighlightIds(changed);
        clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = setTimeout(() => setHighlightIds(new Set()), HIGHLIGHT_MS);
      }
    }

    lastKnownExpensesRef.current = data;
    setExpenses(data);
    setExpensesLoading(false);
  };

  useEffect(() => {
    if (!token) return;
    let ignore = false;
    (async () => {
      const res = await fetch("/expenses", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        if (!ignore) handleLogout();
        return;
      }
      const data = await res.json();
      if (!ignore) {
        lastKnownExpensesRef.current = data;
        setExpenses(data);
        setExpensesLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [token]);

  if (!token) return <><Login onLogin={handleLogin} /><Toaster theme={dark ? "dark" : "light"} /></>;

  const tabClass = (tab) =>
    `flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-foreground text-foreground"
        : "border-transparent text-muted-foreground"
    }`;

  return (
    <div className="h-dvh md:min-h-screen md:bg-zinc-100 md:dark:bg-zinc-950 md:flex md:items-center md:justify-center md:p-6">
      <div className="h-dvh md:h-[85vh] w-full md:max-w-5xl md:rounded-2xl md:shadow-xl overflow-hidden flex flex-col bg-background">

        {/* Mobile tab bar */}
        <div className="flex md:hidden shrink-0 bg-background border-b border-border">
          <button className={tabClass("chat")} onClick={() => setActiveTab("chat")}>Chat</button>
          <button className={tabClass("expenses")} onClick={() => setActiveTab("expenses")}>Expenses</button>
        </div>

        {/* Panels */}
        <div className="flex-1 flex overflow-hidden">
          <Chat
            className={activeTab === "chat" ? "flex" : "hidden md:flex"}
            onExpenseChange={() => { fetchExpenses(); setActiveTab("chat"); }}
            token={token}
            username={username}
            onLogout={handleLogout}
            dark={dark}
            onToggleDark={() => setDark((d) => !d)}
          />
          <ExpenseTable
            className={activeTab === "expenses" ? "flex" : "hidden md:flex"}
            expenses={expenses}
            token={token}
            onExpenseChange={fetchExpenses}
            onUnauthorized={handleLogout}
            loading={expensesLoading}
            highlightIds={highlightIds}
          />
        </div>

      </div>
      <Toaster theme={dark ? "dark" : "light"} />
    </div>
  );
}

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Login from "./components/Login";
import { Toaster } from "./components/ui/sonner";

// Split into separate chunks so a change to one pane doesn't bust the
// other's cache on deploy, and the initial bundle stays smaller. Vite
// doesn't preload dynamic-import chunks it can't statically prove are
// needed on first render, so these are warmed manually below while the
// login screen is still up (see prefetchPanes) rather than only starting
// the fetch after auth succeeds, which would show a blank Suspense flash.
const Chat = lazy(() => import("./components/Chat"));
const ExpenseTable = lazy(() => import("./components/ExpenseTable"));
const prefetchPanes = () => {
  // Errors here are surfaced again (and handled) when React.lazy's own
  // import() runs during render — this is just a best-effort warm-up, so a
  // failure (offline, flaky network) shouldn't produce an unhandled rejection.
  import("./components/Chat").catch(() => {});
  import("./components/ExpenseTable").catch(() => {});
};

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

  // Warm the Chat/ExpenseTable chunks as soon as the app mounts (including
  // while the login screen is still showing) so they're already fetched
  // by the time auth succeeds, instead of only starting the fetch once the
  // Suspense boundary first tries to render them.
  useEffect(() => {
    prefetchPanes();
  }, []);

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

        {/* Panels — each in its own Suspense boundary so a slow/failed fetch
            of one chunk doesn't hold back the other, which is always
            rendered alongside it (desktop shows both; mobile just toggles
            visibility via CSS, not mount state). */}
        <div className="flex-1 flex overflow-hidden">
          <Suspense fallback={<div className="flex-1" />}>
            <Chat
              className={activeTab === "chat" ? "flex" : "hidden md:flex"}
              onExpenseChange={() => { fetchExpenses(); setActiveTab("chat"); }}
              token={token}
              username={username}
              onLogout={handleLogout}
              dark={dark}
              onToggleDark={() => setDark((d) => !d)}
            />
          </Suspense>
          <Suspense fallback={<div className="flex-1" />}>
            <ExpenseTable
              className={activeTab === "expenses" ? "flex" : "hidden md:flex"}
              expenses={expenses}
              token={token}
              onExpenseChange={fetchExpenses}
              onUnauthorized={handleLogout}
              loading={expensesLoading}
              highlightIds={highlightIds}
            />
          </Suspense>
        </div>

      </div>
      <Toaster theme={dark ? "dark" : "light"} />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STORAGE_KEY = "chat_messages";
const TTL_MS = 24 * 60 * 60 * 1000;

const INITIAL_MESSAGE = { role: "agent", text: "Hi! Log an expense or ask about your spending.", ts: Date.now() };

function loadMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const cutoff = Date.now() - TTL_MS;
    const recent = saved.filter((m) => m.ts > cutoff);
    return recent.length > 0 ? recent : [INITIAL_MESSAGE];
  } catch {
    return [INITIAL_MESSAGE];
  }
}

function saveMessages(msgs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch {}
}

export default function Chat({ onExpenseChange, className = "", token, username, onLogout, dark, onToggleDark }) {
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const sendMessage = async (text, displayText = null) => {
    if (!text || loading) return;
    setMessages((prev) => [...prev, { role: "user", text: displayText ?? text, ts: Date.now() }]);
    setLoading(true);

    const res = await fetch("/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: text }),
    });

    if (res.status === 401) { onLogout(); return; }
    if (res.status === 429) {
      const { detail } = await res.json();
      setMessages((prev) => [...prev, { role: "agent", text: detail, error: true, ts: Date.now() }]);
      setLoading(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    setMessages((prev) => [...prev, { role: "agent", text: "", ts: Date.now() }]);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") break;
        try {
          const data = JSON.parse(payload);
          if (data.error) {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "agent", text: data.error, error: true, ts: Date.now() };
              return updated;
            });
          } else {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              updated[updated.length - 1] = { ...last, text: last.text + data.text };
              return updated;
            });
          }
        } catch {}
      }
    }
    setLoading(false);
    onExpenseChange();
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage(text);
  };

  const sendMonthlySummary = () => {
    const now = new Date();
    const month = now.toLocaleString("default", { month: "long" });
    const year = now.getFullYear();
    const start = `${year}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    sendMessage(
      `Summarize my expenses from ${start} to today. Show a breakdown by category with amounts, a total, and one observation about my spending.`,
      `Summarize ${month} ${year}`
    );
  };

  const isTouchDevice = typeof window !== "undefined" && navigator.maxTouchPoints > 0;

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) { e.preventDefault(); send(); }
  };

  const clearChat = () => {
    const fresh = [{ ...INITIAL_MESSAGE, ts: Date.now() }];
    setMessages(fresh);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className={`${className} flex-col bg-background border-r border-border w-full md:w-96 md:shrink-0`}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Expense Logger</span>
          {username && (
            <span className="text-xs text-muted-foreground">· {username}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={sendMonthlySummary} disabled={loading}>
            This Month
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors text-base">
                ⋯
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onToggleDark} className="text-xs cursor-pointer">
                {dark ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clearChat} disabled={loading} className="text-xs cursor-pointer">
                Clear chat
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout} className="text-xs cursor-pointer text-destructive focus:text-destructive">
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 flex flex-col gap-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
              m.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : m.error
                  ? "bg-destructive/10 text-destructive rounded-bl-sm"
                  : "bg-muted text-foreground rounded-bl-sm"
            }`}>
              {m.role === "agent"
                ? <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:text-xs [&_th]:py-1 [&_td]:py-1 [&_p]:my-0.5">
                    <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
                  </div>
                : m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted text-muted-foreground text-sm px-3.5 py-2.5 rounded-2xl rounded-bl-sm italic">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-border shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. $5 coffee today"
          disabled={loading}
          rows={1}
          className="flex-1 text-base md:text-sm resize-none overflow-hidden rounded-2xl border border-input bg-background px-4 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 leading-5"
          style={{ minHeight: "36px", maxHeight: "120px" }}
          onInput={(e) => {
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
        />
        <Button onClick={send} disabled={loading} size="sm" className="shrink-0 rounded-2xl px-5">Send</Button>
      </div>
    </div>
  );
}

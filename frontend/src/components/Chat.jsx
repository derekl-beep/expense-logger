import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Chat({ onExpenseChange, className = "", token, username, onLogout, dark, onToggleDark }) {
  const [messages, setMessages] = useState([
    { role: "agent", text: "Hi! Log an expense or ask about your spending." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text, displayText = null) => {
    if (!text || loading) return;
    setMessages((prev) => [...prev, { role: "user", text: displayText ?? text }]);
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
      setMessages((prev) => [...prev, { role: "agent", text: detail, error: true }]);
      setLoading(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    setMessages((prev) => [...prev, { role: "agent", text: "" }]);

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
              updated[updated.length - 1] = { role: "agent", text: data.error, error: true };
              return updated;
            });
          } else {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "agent", text: updated[updated.length - 1].text + data.text };
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

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
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
          <button
            onClick={onToggleDark}
            className="text-base w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
            title="Toggle dark mode"
          >
            {dark ? "☀️" : "🌙"}
          </button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={sendMonthlySummary} disabled={loading}>
            This Month
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
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
      <div className="flex gap-2 px-4 py-3 border-t border-border shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. $5 coffee today"
          disabled={loading}
          className="flex-1 text-sm"
        />
        <Button onClick={send} disabled={loading} size="sm">Send</Button>
      </div>
    </div>
  );
}

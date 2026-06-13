import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Chat({ onExpenseChange }) {
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

    const res = await fetch("http://localhost:8000/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

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
          const { text: chunk } = JSON.parse(payload);
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "agent",
              text: updated[updated.length - 1].text + chunk,
            };
            return updated;
          });
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
    const prompt = `Summarize my expenses from ${start} to today. Show a breakdown by category with amounts, a total, and one observation about my spending.`;
    sendMessage(prompt, `Summarize ${month} ${year}`);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        Expense Logger
        <button className="summary-btn" onClick={sendMonthlySummary} disabled={loading}>
          This Month
        </button>
      </div>
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            {m.role === "agent" ? <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown> : m.text}
          </div>
        ))}
        {loading && <div className="message agent thinking">Thinking...</div>}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. $5 coffee today"
          disabled={loading}
        />
        <button onClick={send} disabled={loading}>
          Send
        </button>
      </div>
    </div>
  );
}

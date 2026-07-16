import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Bot, Command, ImagePlus, Mic, MessageCircle, MessageSquarePlus, Moon, MoreHorizontal, Square, Sun, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BreakdownRow } from "@/components/CategoryVisuals";

const TTL_MS = 24 * 60 * 60 * 1000;
// Backstop for a silently hung connection (no error, no more data, [DONE]
// never arrives). Kept comfortably above the backend's own 120s per-call
// Claude API timeout so a legitimately slow multi-tool-call turn isn't cut off.
const FETCH_TIMEOUT_MS = 150 * 1000;

const INITIAL_MESSAGE = { role: "agent", text: "Hi! Log an expense or ask about your spending.", ts: Date.now() };

// Firefox and some older browsers don't implement this at all — the mic
// button is simply omitted there rather than shown as a dead control.
const SpeechRecognitionAPI =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const storageKey = (username) => `chat_messages_${username}`;

// Local (not UTC) calendar date, so "dismissed for today" lines up with the
// user's actual day — toISOString() alone would roll over at UTC midnight,
// which is mid-afternoon/evening in US timezones.
function localDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadMessages(username) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(username)) || "[]");
    const cutoff = Date.now() - TTL_MS;
    const recent = saved.filter((m) => m.ts > cutoff);
    return recent.length > 0 ? recent : [INITIAL_MESSAGE];
  } catch {
    return [INITIAL_MESSAGE];
  }
}

function saveMessages(msgs, username) {
  try {
    localStorage.setItem(storageKey(username), JSON.stringify(msgs));
  } catch {
    // localStorage unavailable (e.g. private browsing) — drop silently
  }
}

// Renders a get_category_breakdown tool result with the same BreakdownRow
// used in the expense list, instead of the agent's markdown table — reuses
// the app's own visual language for structured data rather than prose.
const BreakdownCard = ({ breakdown, grand_total }) => {
  if (!breakdown?.length) return null;
  const maxCategoryTotal = Math.max(0, ...breakdown.map((r) => r.total));
  return (
    <div className="space-y-1.5 mb-2 rounded-xl border border-border bg-background/60 p-2.5">
      {breakdown.map((r) => (
        <BreakdownRow
          key={r.category}
          category={r.category}
          amount={r.total}
          count={r.count}
          pct={r.pct}
          barPct={maxCategoryTotal ? (r.total / maxCategoryTotal) * 100 : 0}
          maxCategoryTotal={maxCategoryTotal}
        />
      ))}
      <div className="flex items-center justify-between pt-1 mt-1 border-t border-border/50 text-xs">
        <span className="text-muted-foreground">Total</span>
        <span className="font-semibold text-foreground tabular-nums">${grand_total.toFixed(2)}</span>
      </div>
    </div>
  );
};

export default function Chat({ onExpenseChange, className = "", token, username, onLogout, dark, onToggleDark }) {
  const [messages, setMessages] = useState(() => loadMessages(username));
  // Persists forever (unlike chat_messages_*, which has a 24h TTL) so the
  // "how this works" explainer cards only ever show once per user, not every
  // time the daily-reset welcome message reappears for someone who's already
  // logged plenty of expenses.
  const onboardedKey = `chat_onboarded_${username}`;
  const [hasOnboarded, setHasOnboarded] = useState(() => localStorage.getItem(onboardedKey) === "1");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [slow, setSlow] = useState(false);
  const [images, setImages] = useState([]); // [{ data, mediaType, previewUrl }]
  const MAX_IMAGES = 6;
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const lastFileAttachRef = useRef(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [commands, setCommands] = useState([]);
  const [rawSelectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  // Text to prepend the transcript onto, and the transcript we last wrote —
  // used to detect a manual edit (typing, a suggestion chip, the "/" empty-state
  // button, anything) made mid-recording so it rebases instead of getting
  // silently clobbered by the next interim result.
  const voiceBaseTextRef = useRef("");
  const voiceLastTranscriptRef = useRef("");

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Already stopped or never started — nothing to do.
    }
  };

  // Stop any in-progress recognition if the component unmounts mid-recording.
  useEffect(() => {
    return () => stopListening();
  }, []);

  const toggleListening = () => {
    if (!SpeechRecognitionAPI) return;
    if (isListening) {
      stopListening();
      return;
    }
    voiceBaseTextRef.current = input;
    voiceLastTranscriptRef.current = "";
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join("");
      setInput((current) => {
        const base = voiceBaseTextRef.current;
        const sep = base && !base.endsWith(" ") ? " " : "";
        const expected = base + sep + voiceLastTranscriptRef.current;
        if (current !== expected) {
          // Something else changed the input since our last write — rebase
          // onto it instead of overwriting whatever the user just did.
          voiceBaseTextRef.current = current;
          voiceLastTranscriptRef.current = "";
        }
        const newBase = voiceBaseTextRef.current;
        const newSep = newBase && !newBase.endsWith(" ") ? " " : "";
        voiceLastTranscriptRef.current = transcript;
        return newBase + newSep + transcript;
      });
    };
    recognition.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        toast.error("Couldn't access the microphone");
      }
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      toast.error("Couldn't access the microphone");
    }
  };

  // Show "Still working…" if a turn runs long, so a slow tool call doesn't read as hung.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 6000);
    return () => { clearTimeout(t); setSlow(false); };
  }, [loading]);

  useEffect(() => {
    fetch("/chat/suggestions").then((r) => r.json()).then(setSuggestions).catch(() => {});
    fetch("/chat/commands").then((r) => r.json()).then(setCommands).catch(() => {});
  }, []);

  // Proactive insights: a calm, dismissible note (not a modal, not an agent
  // message — no LLM call involved) for budget categories at/near their
  // monthly limit, and recurring charges due in the next few days. Dismissal
  // is per-item (keyed by the server-provided `key`, unique across both
  // insight types) and remembered for the day, not forever, so acknowledging
  // one still-relevant warning doesn't hide a different one, and neither
  // vanishes once and never comes back.
  const [insights, setInsights] = useState([]);
  const insightsDismissKey = `insights_dismissed_${username}_${localDateString()}`;
  const [dismissedKeys, setDismissedKeys] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(insightsDismissKey) || "[]"));
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    fetch("/insights", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setInsights)
      .catch(() => {});
  }, [token]);

  const visibleInsights = insights.filter((i) => !dismissedKeys.has(i.key));

  const dismissInsight = (key) => {
    setDismissedKeys((prev) => {
      const next = new Set(prev).add(key);
      try {
        localStorage.setItem(insightsDismissKey, JSON.stringify([...next]));
      } catch {
        // localStorage unavailable — dismissal just won't persist across reloads
      }
      return next;
    });
  };

  // Typing "/" opens a command palette listing every analytics tool, not just
  // the handful surfaced as suggestion chips.
  const paletteQuery = input.startsWith("/") ? input.slice(1).toLowerCase() : null;
  const filteredCommands = paletteQuery !== null
    ? commands.filter((c) => c.command.slice(1).toLowerCase().includes(paletteQuery) || c.label.toLowerCase().includes(paletteQuery))
    : [];
  const showPalette = paletteQuery !== null && filteredCommands.length > 0;
  // Clamped (not reset via effect) so the highlighted row always stays in
  // range as filteredCommands shrinks/grows while typing.
  const selectedCommandIndex = Math.min(rawSelectedCommandIndex, Math.max(filteredCommands.length - 1, 0));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 150);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Persist only on complete exchanges: when the user sends (messages.length grows)
  // or when streaming finishes (loading flips false). Avoids serializing to
  // localStorage on every streamed token while a response is in flight.
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "user") saveMessages(messages, username);
  // messages.length is intentional — we only want to fire when a message is added,
  // not on every content update during streaming.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, username]);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) saveMessages(messages, username);
    prevLoadingRef.current = loading;
  }, [loading, messages, username]);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    // iOS Safari can deliver a ghost tap-through to whatever's under the Send
    // button right as the native Photo Library sheet dismisses. Guard against
    // it by swallowing one send() call in the brief window after attaching.
    lastFileAttachRef.current = Date.now();
    const room = MAX_IMAGES - images.length;
    files.slice(0, room).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(",")[1];
        setImages((prev) => [...prev, { data: base64, mediaType: file.type, previewUrl: dataUrl }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const sendMessage = async (text, displayText = null) => {
    if (!text || loading) return;
    if (!hasOnboarded) {
      localStorage.setItem(onboardedKey, "1");
      setHasOnboarded(true);
    }
    stopListening();
    const attachedImages = images;
    setImages([]);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: displayText ?? text,
        imagePreviews: attachedImages.map((img) => img.previewUrl),
        ts: Date.now(),
      },
      { role: "agent", text: "", ts: Date.now() },
    ]);
    setLoading(true);
    setAgentStatus(null);

    // On error, keep any partial text that already streamed in rather than
    // wiping it — a timeout or dropped connection mid-answer shouldn't erase
    // what the user already saw arrive.
    const failMessage = (text) => {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        const prefix = last?.text ? last.text + "\n\n" : "";
        updated[updated.length - 1] = { ...last, text: prefix + text, error: true, ts: Date.now() };
        return updated;
      });
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch("/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          images: attachedImages.length
            ? attachedImages.map((img) => ({ data: img.data, media_type: img.mediaType }))
            : null,
        }),
        signal: controller.signal,
      });

      if (res.status === 401) { onLogout(); return; }
      if (res.status === 429) {
        const { detail } = await res.json();
        failMessage(detail);
        return;
      }
      if (!res.ok) {
        failMessage("Something went wrong. Please try again.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

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
              failMessage(data.error);
            } else if (data.status) {
              setAgentStatus(data.status);
            } else if (data.breakdown) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, breakdown: data.breakdown };
                return updated;
              });
            } else if (data.text) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, text: last.text + data.text };
                return updated;
              });
            }
          } catch {
            // incomplete SSE chunk — wait for the rest to arrive
          }
        }
      }
      onExpenseChange();
    } catch (err) {
      if (err.name === "AbortError") {
        failMessage("This is taking longer than expected. Please try again.");
      } else {
        failMessage("Could not connect to the server. Please try again.");
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const runCommand = (cmd) => {
    setInput("");
    sendMessage(cmd.prompt, cmd.label);
  };

  const send = () => {
    // Date.now() only ever runs here, inside a click/keydown handler, never
    // during render — eslint-plugin-react-hooks' purity check misattributes
    // it as render-time when this function sits alongside runCommand() in
    // onKeyDown's branches; false positive, not an actual purity violation.
    // eslint-disable-next-line react-hooks/purity
    if (Date.now() - lastFileAttachRef.current < 500) {
      lastFileAttachRef.current = 0;
      return;
    }
    const text = input.trim() || (images.length ? `Please log the expenses from ${images.length > 1 ? "these images" : "this image"}.` : "");
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

  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    if (!lightbox) return;
    const close = (e) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [lightbox]);

  const isTouchDevice = typeof window !== "undefined" && navigator.maxTouchPoints > 0;

  const onKeyDown = (e) => {
    if (showPalette && e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedCommandIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
    } else if (showPalette && e.key === "ArrowUp") {
      e.preventDefault();
      // Re-clamp to the current (possibly since-narrowed) list before
      // decrementing — otherwise a raw index left over from a longer list
      // silently decrements out of view and resurfaces oddly once widened.
      setSelectedCommandIndex((i) => Math.max(Math.min(i, filteredCommands.length - 1) - 1, 0));
    } else if (showPalette && e.key === "Escape") {
      e.preventDefault();
      setInput("");
    } else if (showPalette && e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      runCommand(filteredCommands[selectedCommandIndex]);
    } else if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      send();
    }
  };

  const clearChat = () => {
    const fresh = [{ ...INITIAL_MESSAGE, ts: Date.now() }];
    setMessages(fresh);
    localStorage.removeItem(storageKey(username));
    fetch("/chat/clear", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  };

  const exportCSV = async () => {
    const res = await fetch("/expenses/export", { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expenses.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const lastMessage = messages[messages.length - 1];
  const showStatusBubble = loading && lastMessage?.role === "agent" && lastMessage.text === "";
  const displayMessages = showStatusBubble ? messages.slice(0, -1) : messages;

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
          <button
            onClick={clearChat}
            disabled={loading}
            title="New chat"
            aria-label="New chat"
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleDark}
            title={dark ? "Light mode" : "Dark mode"}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="More options" className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={exportCSV} className="text-xs cursor-pointer">
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout} className="text-xs cursor-pointer text-destructive focus:text-destructive">
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {visibleInsights.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5 shrink-0">
          <div className="flex items-start gap-2.5">
            <div className="shrink-0 w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center mt-0.5">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              {visibleInsights.map((i) => (
                <div key={i.key} className="flex items-start gap-2">
                  <p className="flex-1 text-xs text-foreground leading-relaxed">
                    {i.type === "recurring" ? (
                      <>
                        <span className="font-semibold text-foreground">{i.description}</span>
                        {" "}(${i.amount.toFixed(2)}) renews{" "}
                        {i.days_until === 0 ? "today" : i.days_until === 1 ? "tomorrow" : `in ${i.days_until} days`}
                      </>
                    ) : (
                      <>
                        <span className={`font-semibold ${i.over_budget ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                          {i.category}
                        </span>
                        {" "}is at {i.pct_used.toFixed(0)}% of budget (${i.spent.toFixed(0)} of ${i.monthly_limit.toFixed(0)})
                      </>
                    )}
                  </p>
                  <button
                    onClick={() => dismissInsight(i.key)}
                    aria-label={i.type === "recurring" ? `Dismiss ${i.description} reminder` : `Dismiss ${i.category} budget insight`}
                    className="shrink-0 text-muted-foreground hover:text-foreground text-sm leading-none"
                  >×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
      <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="h-full overflow-y-auto overscroll-contain p-4 flex flex-col gap-3">
        {displayMessages.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "agent" && (
              <div className="shrink-0 w-7 h-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
            )}
            <div className={`${m.breakdown ? "max-w-[95%]" : "max-w-[85%]"} px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
              m.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : m.error
                  ? "bg-destructive/10 text-destructive rounded-bl-sm"
                  : "bg-muted text-foreground rounded-bl-sm"
            }`}>
              {m.imagePreviews?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {m.imagePreviews.map((src, j) => (
                    <img key={j} src={src} alt="attached" onClick={() => setLightbox(src)} className="max-h-40 rounded-lg object-contain cursor-zoom-in" />
                  ))}
                </div>
              )}
              {m.breakdown && <BreakdownCard breakdown={m.breakdown.breakdown} grand_total={m.breakdown.grand_total} />}
              {m.role === "agent"
                ? <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:text-xs [&_th]:py-1 [&_td]:py-1 [&_p]:my-0.5">
                    <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
                  </div>
                : m.text}
            </div>
            {m.role === "user" && (
              <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}
        {displayMessages.length === 1 && !hasOnboarded && (
          <div className="rounded-xl border border-border p-1.5 space-y-0.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-start gap-2.5 text-left rounded-lg p-2 hover:bg-muted transition-colors"
            >
              <ImagePlus className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium text-foreground">Snap a receipt</span>
                <span className="block text-xs text-muted-foreground">I'll read the line items and log them</span>
              </span>
            </button>
            <div className="w-full flex items-start gap-2.5 text-left rounded-lg p-2">
              <MessageCircle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium text-foreground">Just type it naturally</span>
                <span className="block text-xs text-muted-foreground">"$12 lunch at Chipotle" is all it takes</span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setInput("/")}
              className="w-full flex items-start gap-2.5 text-left rounded-lg p-2 hover:bg-muted transition-colors"
            >
              <Command className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium text-foreground">Ask about your spending</span>
                <span className="block text-xs text-muted-foreground">Type / to see every report I can run</span>
              </span>
            </button>
          </div>
        )}
        {displayMessages.length === 1 && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-1">
            {suggestions.map((s) => (
              <button
                key={s.label}
                onClick={() => sendMessage(s.prompt, s.label)}
                className="text-xs px-3 py-1.5 rounded-full border border-input text-foreground hover:bg-muted transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {showStatusBubble && (
          <div className="flex items-end gap-2 justify-start">
            <div className="shrink-0 w-7 h-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-muted text-muted-foreground text-sm px-3.5 py-2.5 rounded-2xl rounded-bl-sm italic transition-all">
              {agentStatus || (slow ? "Still working…" : "Thinking…")}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {showScrollToBottom && (
        <button
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-foreground text-background shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
      </div>

      {/* Input */}
      <div className="relative px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-border shrink-0">
        {showPalette && (
          <div className="absolute bottom-full left-4 right-4 mb-2 rounded-xl border border-border bg-popover shadow-lg overflow-hidden max-h-52 overflow-y-auto">
            {filteredCommands.map((c, i) => (
              <button
                key={c.command}
                type="button"
                onClick={() => runCommand(c)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${
                  i === selectedCommandIndex ? "bg-muted" : "hover:bg-muted/50"
                }`}
              >
                <span className="text-foreground">{c.label}</span>
                <span className="text-xs text-muted-foreground font-mono">{c.command}</span>
              </button>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {images.map((img, i) => (
              <div key={i} className="relative inline-block">
                <img src={img.previewUrl} alt="preview" className="h-16 rounded-lg object-contain border border-border" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center leading-none hover:bg-destructive hover:text-destructive-foreground"
                >×</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || images.length >= MAX_IMAGES}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-2xl border border-input text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            title="Attach image"
          ><ImagePlus className="w-4 h-4" /></button>
          {SpeechRecognitionAPI && (
            <button
              type="button"
              onClick={toggleListening}
              disabled={loading}
              aria-label={isListening ? "Stop voice input" : "Start voice input"}
              title={isListening ? "Stop voice input" : "Voice input"}
              className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-2xl border transition-colors disabled:opacity-50 ${
                isListening
                  ? "border-destructive bg-destructive/10 text-destructive animate-pulse"
                  : "border-input text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {isListening ? <Square className="w-3.5 h-3.5" fill="currentColor" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
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
          <Button
            onClick={send}
            disabled={loading || (!input.trim() && images.length === 0)}
            size="icon"
            className="shrink-0 w-9 h-9 rounded-full"
            aria-label="Send message"
          >
            <ArrowUp className="w-4 h-4" />
          </Button>
        </div>
      </div>
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-lg transition-colors"
          >×</button>
          <img
            src={lightbox}
            alt="full size"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full rounded-xl object-contain shadow-2xl animate-in zoom-in-95 duration-200"
          />
        </div>
      )}
    </div>
  );
}

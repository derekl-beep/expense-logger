import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });
      if (!res.ok) {
        setError("Invalid username or password");
        return;
      }
      const { token, username: name } = await res.json();
      localStorage.setItem("token", token);
      localStorage.setItem("username", name);
      onLogin(token, name);
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Expense Logger</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to continue</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
          <div className="flex items-center gap-2">
            <input
              id="remember"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
            />
            <label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer select-none">
              Remember me for 30 days
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !username || !password}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import api from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const { token, user, setAuth, logout, hydrate } = useAuthStore();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Lobby state
  const [challenge, setChallenge] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [lobbyError, setLobbyError] = useState("");
  const [lobbyLoading, setLobbyLoading] = useState(false);

  useEffect(() => { hydrate(); }, [hydrate]);

  const handleAuth = async () => {
    setError("");
    setLoading(true);
    try {
      const endpoint = tab === "login" ? "/auth/login" : "/auth/register";
      const body =
        tab === "login"
          ? { email: form.email, password: form.password }
          : { username: form.username, email: form.email, password: form.password };
      const { data } = await api.post(endpoint, body);
      setAuth(data.access_token, { id: data.user_id, username: data.username });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err.response?.data?.detail || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const createRoom = async () => {
    if (!challenge.trim()) return setLobbyError("Enter a challenge prompt");
    setLobbyLoading(true);
    setLobbyError("");
    try {
      const { data } = await api.post("/rooms", { challenge_prompt: challenge });
      router.push(`/room/${data.id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setLobbyError(err.response?.data?.detail || "Failed to create room");
    } finally {
      setLobbyLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!joinCode.trim()) return setLobbyError("Enter a room code");
    setLobbyLoading(true);
    setLobbyError("");
    try {
      const { data } = await api.get(`/rooms/code/${joinCode.trim().toUpperCase()}`);
      await api.post(`/rooms/${data.id}/join`);
      router.push(`/room/${data.id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setLobbyError(err.response?.data?.detail || "Room not found");
    } finally {
      setLobbyLoading(false);
    }
  };

  if (!token) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: "1rem" }}>
        <div style={{ width: "100%", maxWidth: 400 }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{ fontSize: "2.5rem", fontFamily: "Space Mono, monospace", fontWeight: 700, color: "var(--accent)", letterSpacing: "-2px" }}>
              ARENAAI
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>AI Creative Battle Room</div>
          </div>

          {/* Card */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "2rem" }}>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem", background: "var(--surface2)", borderRadius: 10, padding: 4 }}>
              {(["login", "register"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setError(""); }}
                  style={{
                    flex: 1, padding: "0.5rem", borderRadius: 8, border: "none", cursor: "pointer",
                    background: tab === t ? "var(--accent)" : "transparent",
                    color: tab === t ? "#fff" : "var(--muted)",
                    fontWeight: 600, fontSize: "0.875rem", textTransform: "capitalize", transition: "all 0.15s",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Fields */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {tab === "register" && (
                <Input label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v })} placeholder="coolcreator" />
              )}
              <Input label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="you@example.com" />
              <Input label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="••••••••" />
            </div>

            {error && <div style={{ marginTop: "0.75rem", color: "var(--danger)", fontSize: "0.8rem", background: "#ef444415", padding: "0.5rem 0.75rem", borderRadius: 8 }}>{error}</div>}

            <button
              onClick={handleAuth}
              disabled={loading}
              style={{
                width: "100%", marginTop: "1.25rem", padding: "0.75rem",
                background: loading ? "var(--border)" : "var(--accent)",
                color: "#fff", border: "none", borderRadius: 10, fontWeight: 700,
                fontSize: "0.925rem", cursor: loading ? "not-allowed" : "pointer",
                transition: "opacity 0.15s",
              }}
            >
              {loading ? "Loading…" : tab === "login" ? "Sign In" : "Create Account"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Lobby
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "1.5rem" }}>
      {/* Header */}
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2.5rem" }}>
          <div style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: "1.5rem", color: "var(--accent)" }}>ARENAAI</div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
              <span style={{ color: "var(--text)", fontWeight: 600 }}>{user?.username}</span>
            </span>
            <button
              onClick={logout}
              style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", padding: "0.35rem 0.75rem", borderRadius: 8, cursor: "pointer", fontSize: "0.8rem" }}
            >
              Sign out
            </button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", fontWeight: 800, marginBottom: "0.5rem", letterSpacing: "-1px" }}>
            Creative Battle Room
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "1rem" }}>Host a challenge or join one with a room code</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.5rem", maxWidth: 760, margin: "0 auto" }}>
          {/* Create Room */}
          <Card title="🎯 Host a Battle" subtitle="Create a challenge room for others to join">
            <textarea
              value={challenge}
              onChange={(e) => setChallenge(e.target.value)}
              placeholder='e.g. "Create the most insane luxury cyberpunk perfume campaign for Gen-Z"'
              rows={4}
              style={{
                width: "100%", background: "var(--surface2)", border: "1px solid var(--border)",
                borderRadius: 10, color: "var(--text)", padding: "0.75rem", fontSize: "0.875rem",
                resize: "vertical", fontFamily: "inherit", lineHeight: 1.5,
              }}
            />
            {lobbyError && challenge === "" && (
              <div style={{ color: "var(--danger)", fontSize: "0.8rem", marginTop: "0.5rem" }}>{lobbyError}</div>
            )}
            <button
              onClick={createRoom}
              disabled={lobbyLoading}
              style={primaryBtn(lobbyLoading)}
            >
              {lobbyLoading ? "Creating…" : "Create Room"}
            </button>
          </Card>

          {/* Join Room */}
          <Card title="⚔️ Join a Battle" subtitle="Enter a room code to compete">
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ROOM CODE"
                maxLength={8}
                style={{
                  flex: 1, background: "var(--surface2)", border: "1px solid var(--border)",
                  borderRadius: 10, color: "var(--text)", padding: "0.75rem", fontSize: "1rem",
                  fontFamily: "Space Mono, monospace", letterSpacing: 4, textTransform: "uppercase",
                }}
              />
            </div>
            {lobbyError && joinCode !== "" && (
              <div style={{ color: "var(--danger)", fontSize: "0.8rem", marginTop: "0.5rem" }}>{lobbyError}</div>
            )}
            <button
              onClick={joinRoom}
              disabled={lobbyLoading}
              style={{ ...primaryBtn(lobbyLoading), background: "var(--surface2)", border: "1px solid var(--accent)", color: "var(--accent)" }}
            >
              {lobbyLoading ? "Joining…" : "Join Room"}
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.35rem", fontWeight: 500 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", background: "var(--surface2)", border: "1px solid var(--border)",
          borderRadius: 10, color: "var(--text)", padding: "0.65rem 0.85rem", fontSize: "0.9rem",
        }}
      />
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.5rem" }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.25rem" }}>{title}</div>
        <div style={{ color: "var(--muted)", fontSize: "0.825rem" }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>{children}</div>
    </div>
  );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    width: "100%", padding: "0.75rem", background: disabled ? "var(--border)" : "var(--accent)",
    color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: "0.925rem",
    cursor: disabled ? "not-allowed" : "pointer", transition: "opacity 0.15s",
  };
}

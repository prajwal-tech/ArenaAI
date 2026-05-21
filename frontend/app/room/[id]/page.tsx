"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import api from "@/lib/api";
import { useRoomWebSocket } from "@/lib/useWebSocket";
import type { Room, Round, Submission, Participant, JobInfo } from "@/lib/types";

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;
  const { user, hydrate } = useAuthStore();

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [scoreModal, setScoreModal] = useState<{ subId: string; username: string } | null>(null);
  const [scoreVal, setScoreVal] = useState("8");
  const [scoreReason, setScoreReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { hydrate(); }, [hydrate]);

  const fetchRoom = useCallback(async () => {
    try {
      const { data } = await api.get(`/rooms/${roomId}`);
      setRoom(data);
    } catch {
      setError("Room not found or you don't have access.");
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { fetchRoom(); }, [fetchRoom]);

  // WebSocket handlers
  const wsHandlers = {
    participant_joined: (payload: Record<string, unknown>) => {
      const p = payload.participant as Participant;
      setRoom((r) => r ? { ...r, participants: [...r.participants.filter((x) => x.id !== p.id), p] } : r);
    },
    round_started: (payload: Record<string, unknown>) => {
      const round = payload.round as Round;
      setRoom((r) => r ? { ...r, status: "active", rounds: [...r.rounds, round] } : r);
    },
    round_ended: (payload: Record<string, unknown>) => {
      const { round_id, status } = payload as { round_id: string; status: string };
      setRoom((r) => r ? {
        ...r, status: "scoring",
        rounds: r.rounds.map((rd) => rd.id === round_id ? { ...rd, status } : rd),
      } : r);
    },
    room_finished: () => {
      setRoom((r) => r ? { ...r, status: "finished" } : r);
    },
    submission_created: (payload: Record<string, unknown>) => {
      const sub = payload.submission as Submission & { participant_username: string };
      setRoom((r) => {
        if (!r) return r;
        const rounds = r.rounds.map((rd) => {
          if (rd.status === "active") {
            const exists = rd.submissions.find((s) => s.id === sub.id);
            if (exists) return rd;
            return { ...rd, submissions: [...rd.submissions, sub] };
          }
          return rd;
        });
        return { ...r, rounds };
      });
    },
    job_update: (payload: Record<string, unknown>) => {
      const { submission_id, status, generated_output, error: err, retry_count } = payload as {
        submission_id: string; status: string; generated_output?: string; error?: string; retry_count?: number;
      };
      setRoom((r) => {
        if (!r) return r;
        const rounds = r.rounds.map((rd) => ({
          ...rd,
          submissions: rd.submissions.map((s) => {
            if (s.id !== submission_id) return s;
            const job: JobInfo = {
              id: s.job?.id || "",
              status: status as JobInfo["status"],
              error_message: err,
              retry_count: retry_count,
            };
            return {
              ...s,
              generated_output: generated_output || s.generated_output,
              job,
            };
          }),
        }));
        return { ...r, rounds };
      });
    },
    submission_scored: (payload: Record<string, unknown>) => {
      const { submission_id, score, reasoning, participant_id, participant_total_score } = payload as {
        submission_id: string; score: number; reasoning?: string;
        participant_id: string; participant_total_score: number;
      };
      setRoom((r) => {
        if (!r) return r;
        const rounds = r.rounds.map((rd) => ({
          ...rd,
          submissions: rd.submissions.map((s) =>
            s.id === submission_id ? { ...s, score, score_reasoning: reasoning } : s
          ),
        }));
        const participants = r.participants.map((p) =>
          p.id === participant_id ? { ...p, score: participant_total_score } : p
        );
        return { ...r, rounds, participants };
      });
    },
    participant_eliminated: (payload: Record<string, unknown>) => {
      const { participant_id } = payload as { participant_id: string };
      setRoom((r) => {
        if (!r) return r;
        return {
          ...r,
          participants: r.participants.map((p) =>
            p.id === participant_id ? { ...p, eliminated: true } : p
          ),
        };
      });
    },
  };

  useRoomWebSocket(roomId, wsHandlers);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} onBack={() => router.push("/")} />;
  if (!room) return null;

  const isHost = user?.id === room.host.id;
  const myParticipant = room.participants.find((p) => p.user.id === user?.id);
  const activeRound = room.rounds.find((r) => r.status === "active");
  const scoringRound = room.rounds.find((r) => r.status === "scoring");
  const currentRound = activeRound || scoringRound || room.rounds[room.rounds.length - 1];
  const mySubmission = currentRound?.submissions.find((s) => s.participant_id === myParticipant?.id);
  const hasSubmitted = !!mySubmission;

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await api.post(`/rooms/${roomId}/submit`, { prompt });
      setPrompt("");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setSubmitError(err.response?.data?.detail || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartRound = async () => {
    setActionLoading(true);
    try { await api.post(`/rooms/${roomId}/start-round`); } catch {}
    setActionLoading(false);
  };

  const handleEndRound = async () => {
    setActionLoading(true);
    try { await api.post(`/rooms/${roomId}/end-round`); } catch {}
    setActionLoading(false);
  };

  const handleFinishRoom = async () => {
    setActionLoading(true);
    try { await api.post(`/rooms/${roomId}/finish`); } catch {}
    setActionLoading(false);
  };

  const handleScore = async () => {
    if (!scoreModal) return;
    setActionLoading(true);
    try {
      await api.post(`/rooms/${roomId}/score`, {
        submission_id: scoreModal.subId,
        score: parseFloat(scoreVal),
        reasoning: scoreReason,
      });
      setScoreModal(null);
      setScoreReason("");
      setScoreVal("8");
    } catch {}
    setActionLoading(false);
  };

  const handleEliminate = async (participantId: string) => {
    if (!confirm("Eliminate this participant?")) return;
    try { await api.post(`/rooms/${roomId}/eliminate`, { participant_id: participantId }); } catch {}
  };

  const sortedParticipants = [...room.participants].sort((a, b) => b.score - a.score);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid var(--border)", padding: "1rem 1.5rem" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button onClick={() => router.push("/")} style={ghostBtn}>
              ← Back
            </button>
            <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, color: "var(--accent)", fontSize: "1.1rem" }}>ARENAAI</span>
            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Room</span>
            <span style={{ fontFamily: "Space Mono, monospace", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.2rem 0.6rem", fontSize: "0.9rem", letterSpacing: 2 }}>{room.code}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <StatusBadge status={room.status} />
            {isHost && <span style={{ fontSize: "0.75rem", background: "var(--accent)", color: "#fff", borderRadius: 6, padding: "0.2rem 0.6rem", fontWeight: 700 }}>HOST</span>}
          </div>
        </div>
      </div>

      {/* Challenge */}
      <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "1rem 1.5rem" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: 2, marginBottom: "0.35rem" }}>Challenge</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.5 }}>{room.challenge_prompt}</div>
        </div>
      </div>

      {/* Main */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem", display: "grid", gridTemplateColumns: "1fr 280px", gap: "1.5rem" }}>
        {/* Left: Action + Submissions */}
        <div style={{ minWidth: 0 }}>
          {/* Host Controls */}
          {isHost && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "1.25rem", marginBottom: "1.5rem" }}>
              <div style={{ fontWeight: 700, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                🎮 Host Controls
              </div>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                {(room.status === "waiting" || room.status === "scoring") && (
                  <button onClick={handleStartRound} disabled={actionLoading} style={actionBtnStyle("var(--accent)")}>
                    {actionLoading ? "…" : room.rounds.length === 0 ? "▶ Start Round 1" : `▶ Start Round ${room.rounds.length + 1}`}
                  </button>
                )}
                {room.status === "active" && (
                  <button onClick={handleEndRound} disabled={actionLoading} style={actionBtnStyle("var(--warning)")}>
                    {actionLoading ? "…" : "⏸ End Round (Start Scoring)"}
                  </button>
                )}
                {room.status === "scoring" && (
                  <button onClick={handleFinishRoom} disabled={actionLoading} style={actionBtnStyle("var(--danger)")}>
                    {actionLoading ? "…" : "🏁 Finish Room"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Participant Submit Area */}
          {!isHost && room.status === "active" && !hasSubmitted && !myParticipant?.eliminated && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: 14, padding: "1.25rem", marginBottom: "1.5rem" }}>
              <div style={{ fontWeight: 700, marginBottom: "0.75rem" }}>✍️ Submit Your Entry</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe your creative concept…"
                rows={4}
                style={textareaStyle}
                maxLength={1000}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{prompt.length}/1000</span>
                <button onClick={handleSubmit} disabled={submitting || !prompt.trim()} style={actionBtnStyle("var(--accent)")}>
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </div>
              {submitError && <div style={{ color: "var(--danger)", fontSize: "0.8rem", marginTop: "0.5rem" }}>{submitError}</div>}
            </div>
          )}

          {!isHost && myParticipant?.eliminated && (
            <div style={{ background: "#ef444415", border: "1px solid var(--danger)", borderRadius: 14, padding: "1.25rem", marginBottom: "1.5rem", textAlign: "center" }}>
              💀 You've been eliminated
            </div>
          )}

          {!isHost && room.status === "waiting" && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "1.25rem", marginBottom: "1.5rem", textAlign: "center", color: "var(--muted)" }}>
              ⏳ Waiting for host to start the battle…
            </div>
          )}

          {room.status === "finished" && (
            <div style={{ background: "linear-gradient(135deg, #7c3aed20, #06b6d420)", border: "1px solid var(--accent)", borderRadius: 14, padding: "1.5rem", marginBottom: "1.5rem", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🏆</div>
              <div style={{ fontWeight: 700, fontSize: "1.2rem" }}>Battle Complete!</div>
              {sortedParticipants[0] && (
                <div style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
                  Winner: <strong style={{ color: "var(--accent)" }}>{sortedParticipants[0].user.username}</strong> with {sortedParticipants[0].score.toFixed(1)} pts
                </div>
              )}
            </div>
          )}

          {/* Rounds */}
          {room.rounds.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "3rem", background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)" }}>
              No rounds yet. {isHost ? "Start a round above!" : "Waiting for host to start…"}
            </div>
          ) : (
            room.rounds.map((round) => (
              <RoundView
                key={round.id}
                round={round}
                participants={room.participants}
                isHost={isHost}
                currentUserId={user?.id || ""}
                onOpenScore={(subId, username) => { setScoreModal({ subId, username }); }}
              />
            ))
          )}
        </div>

        {/* Right: Leaderboard + Participants */}
        <div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "1.25rem", marginBottom: "1rem", position: "sticky", top: "1rem" }}>
            <div style={{ fontWeight: 700, marginBottom: "1rem" }}>🏅 Leaderboard</div>
            {room.participants.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: "0.85rem", textAlign: "center", padding: "1rem" }}>No participants yet</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {sortedParticipants.map((p, i) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0.75rem",
                      background: p.eliminated ? "#ef444410" : i === 0 ? "var(--accent)15" : "var(--surface2)",
                      borderRadius: 10, border: `1px solid ${p.eliminated ? "var(--danger)40" : i === 0 ? "var(--accent)40" : "transparent"}`,
                      opacity: p.eliminated ? 0.6 : 1,
                    }}
                  >
                    <span style={{ fontFamily: "Space Mono, monospace", fontSize: "0.75rem", color: "var(--muted)", minWidth: 16 }}>#{i + 1}</span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.user.username}
                      {p.eliminated && " 💀"}
                      {p.user.id === user?.id && <span style={{ color: "var(--accent)", fontSize: "0.7rem" }}> (you)</span>}
                    </span>
                    <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: "0.875rem", color: i === 0 ? "var(--accent)" : "var(--text)" }}>
                      {p.score.toFixed(1)}
                    </span>
                    {isHost && !p.eliminated && (
                      <button
                        onClick={() => handleEliminate(p.id)}
                        title="Eliminate"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", fontSize: "0.85rem", padding: "0 0.25rem" }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Room Info */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "1.25rem" }}>
            <div style={{ fontWeight: 700, marginBottom: "0.75rem", fontSize: "0.875rem" }}>Room Info</div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div>Host: <span style={{ color: "var(--text)" }}>{room.host.username}</span></div>
              <div>Rounds: <span style={{ color: "var(--text)" }}>{room.rounds.length}</span></div>
              <div>Players: <span style={{ color: "var(--text)" }}>{room.participants.length}</span></div>
              <div style={{ marginTop: "0.5rem" }}>
                Share code:
                <div style={{ fontFamily: "Space Mono, monospace", background: "var(--surface2)", borderRadius: 8, padding: "0.5rem", marginTop: "0.35rem", letterSpacing: 4, textAlign: "center", fontSize: "1.1rem", color: "var(--accent)", cursor: "pointer" }}
                  onClick={() => navigator.clipboard?.writeText(room.code)}
                  title="Click to copy"
                >
                  {room.code}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Score Modal */}
      {scoreModal && (
        <div style={{ position: "fixed", inset: 0, background: "#00000080", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "1rem" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.75rem", maxWidth: 420, width: "100%" }}>
            <div style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.25rem" }}>Score Submission</div>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>from {scoreModal.username}</div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.8rem", color: "var(--muted)", display: "block", marginBottom: "0.35rem" }}>Score (0–10)</label>
              <input
                type="number" min="0" max="10" step="0.5"
                value={scoreVal}
                onChange={(e) => setScoreVal(e.target.value)}
                style={{ ...inputStyle, fontFamily: "Space Mono, monospace", fontSize: "1.25rem", textAlign: "center" }}
              />
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ fontSize: "0.8rem", color: "var(--muted)", display: "block", marginBottom: "0.35rem" }}>Reasoning (optional)</label>
              <textarea
                value={scoreReason}
                onChange={(e) => setScoreReason(e.target.value)}
                rows={3}
                placeholder="Why this score?"
                style={textareaStyle}
              />
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button onClick={() => setScoreModal(null)} style={{ ...actionBtnStyle("var(--surface2)"), flex: 1, border: "1px solid var(--border)", color: "var(--text)" }}>
                Cancel
              </button>
              <button onClick={handleScore} disabled={actionLoading} style={{ ...actionBtnStyle("var(--accent)"), flex: 1 }}>
                {actionLoading ? "…" : "Submit Score"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function RoundView({ round, participants, isHost, currentUserId, onOpenScore }: {
  round: Round;
  participants: Participant[];
  isHost: boolean;
  currentUserId: string;
  onOpenScore: (subId: string, username: string) => void;
}) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, marginBottom: "1.25rem", overflow: "hidden" }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontWeight: 700 }}>Round {round.round_number}</span>
        <RoundBadge status={round.status} />
        <span style={{ color: "var(--muted)", fontSize: "0.8rem", marginLeft: "auto" }}>
          {round.submissions.length} submission{round.submissions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {round.submissions.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)", fontSize: "0.875rem" }}>
          Waiting for submissions…
        </div>
      ) : (
        <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {round.submissions.map((sub) => {
            const participant = participants.find((p) => p.id === sub.participant_id);
            const isMine = participant?.user.id === currentUserId;
            return (
              <SubmissionCard
                key={sub.id}
                submission={sub}
                username={participant?.user.username || "Unknown"}
                isMine={isMine}
                isHost={isHost}
                canScore={isHost && sub.job?.status === "completed" && sub.score == null}
                onScore={() => onOpenScore(sub.id, participant?.user.username || "Unknown")}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({ submission, username, isMine, isHost, canScore, onScore }: {
  submission: Submission;
  username: string;
  isMine: boolean;
  isHost: boolean;
  canScore: boolean;
  onScore: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const job = submission.job;

  useEffect(() => {
    if (submission.generated_output) setExpanded(true);
  }, [submission.generated_output]);

  return (
    <div style={{
      background: "var(--surface2)", borderRadius: 12,
      border: `1px solid ${isMine ? "var(--accent)40" : "var(--border)"}`,
      overflow: "hidden", transition: "all 0.2s",
    }}>
      <div style={{ padding: "0.875rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
              <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{username}</span>
              {isMine && <span style={{ fontSize: "0.7rem", color: "var(--accent)", background: "var(--accent)20", borderRadius: 4, padding: "0.1rem 0.4rem" }}>you</span>}
              {submission.score != null && (
                <span style={{ fontSize: "0.8rem", fontFamily: "Space Mono, monospace", color: "var(--success)", background: "var(--success)15", borderRadius: 6, padding: "0.15rem 0.5rem", marginLeft: "auto" }}>
                  {submission.score}/10
                </span>
              )}
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontStyle: "italic", lineHeight: 1.4 }}>"{submission.prompt}"</div>
          </div>
        </div>

        {/* Job Status */}
        <JobStatusBar job={job} />

        {/* Score reasoning */}
        {submission.score_reasoning && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--muted)", background: "var(--surface)", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
            💬 {submission.score_reasoning}
          </div>
        )}
      </div>

      {/* Generated output */}
      {submission.generated_output && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ width: "100%", padding: "0.5rem 1rem", background: "var(--surface)", border: "none", borderTop: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer", fontSize: "0.8rem", textAlign: "left", display: "flex", justifyContent: "space-between" }}
          >
            <span>✨ AI Generated Output</span>
            <span>{expanded ? "▲" : "▼"}</span>
          </button>
          {expanded && (
            <div style={{ padding: "1rem", borderTop: "1px solid var(--border)", background: "var(--surface)10" }}>
              <div style={{ fontSize: "0.85rem", lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                {submission.generated_output}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Host score button */}
      {canScore && (
        <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
          <button onClick={onScore} style={actionBtnStyle("var(--accent)")}>
            Score This Submission
          </button>
        </div>
      )}
    </div>
  );
}

function JobStatusBar({ job }: { job?: JobInfo | null }) {
  if (!job) return null;

  const configs: Record<string, { color: string; label: string; spin?: boolean }> = {
    queued: { color: "var(--muted)", label: "⏳ Queued for generation…" },
    running: { color: "var(--warning)", label: "⚡ Generating…", spin: true },
    retrying: { color: "var(--warning)", label: `🔄 Retrying (attempt ${(job.retry_count || 0) + 1})…`, spin: true },
    completed: { color: "var(--success)", label: "✅ Generation complete" },
    failed: { color: "var(--danger)", label: `❌ Failed: ${job.error_message || "Unknown error"}` },
    timed_out: { color: "var(--danger)", label: "⏰ Generation timed out" },
  };

  const config = configs[job.status] || { color: "var(--muted)", label: job.status };

  if (job.status === "completed") return null; // Don't show status bar when done

  return (
    <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: config.color, display: "flex", alignItems: "center", gap: "0.35rem" }}>
      {config.spin && <span className="animate-spin" style={{ display: "inline-block" }}>◌</span>}
      {config.label}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    waiting: { color: "var(--muted)", bg: "var(--border)", label: "Waiting" },
    active: { color: "#fff", bg: "var(--success)", label: "● Live" },
    scoring: { color: "#fff", bg: "var(--warning)", label: "Scoring" },
    finished: { color: "#fff", bg: "var(--muted)", label: "Finished" },
  };
  const s = map[status] || { color: "var(--muted)", bg: "var(--border)", label: status };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 8, padding: "0.2rem 0.6rem", fontSize: "0.75rem", fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

function RoundBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    pending: { color: "var(--muted)", label: "Pending" },
    active: { color: "var(--success)", label: "Active" },
    scoring: { color: "var(--warning)", label: "Scoring" },
    completed: { color: "var(--muted)", label: "Completed" },
  };
  const s = map[status] || { color: "var(--muted)", label: status };
  return <span style={{ fontSize: "0.75rem", color: s.color, fontWeight: 600 }}>{s.label}</span>;
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ textAlign: "center", color: "var(--muted)" }}>
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }} className="animate-spin">◌</div>
        <div>Loading room…</div>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "var(--danger)", fontSize: "1.1rem", marginBottom: "1rem" }}>{message}</div>
        <button onClick={onBack} style={ghostBtn}>← Go Home</button>
      </div>
    </div>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const ghostBtn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border)", color: "var(--muted)",
  padding: "0.35rem 0.75rem", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem",
};

const textareaStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface2)", border: "1px solid var(--border)",
  borderRadius: 10, color: "var(--text)", padding: "0.75rem", fontSize: "0.875rem",
  resize: "vertical", fontFamily: "inherit", lineHeight: 1.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface2)", border: "1px solid var(--border)",
  borderRadius: 10, color: "var(--text)", padding: "0.65rem 0.85rem", fontSize: "0.9rem",
};

function actionBtnStyle(bg: string): React.CSSProperties {
  return {
    padding: "0.6rem 1.25rem", background: bg, color: "#fff",
    border: "none", borderRadius: 10, fontWeight: 700, fontSize: "0.875rem",
    cursor: "pointer", whiteSpace: "nowrap",
  };
}

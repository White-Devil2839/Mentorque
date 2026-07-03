import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { INTERVIEW_META, type SessionSummary } from "../types";

export function Dashboard() {
  const { token, user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ sessions: SessionSummary[] }>("/interview/sessions", { token })
      .then((d) => setSessions(d.sessions))
      .catch((e) => setError((e as Error).message));
  }, [token]);

  return (
    <div className="container stack">
      <div className="row-between">
        <div>
          <h1 style={{ margin: 0 }}>Hi {user?.name?.split(" ")[0]} 👋</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Prepping for <strong>{user?.role}</strong> ({user?.experienceLevel})
          </p>
        </div>
        <Link className="btn primary lg" to="/new">
          Start an interview
        </Link>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Past sessions</h2>
        {error && <div className="error">{error}</div>}
        {!sessions && !error && <p className="muted">Loading…</p>}
        {sessions && sessions.length === 0 && (
          <p className="muted">
            No interviews yet. Your first one is one click away →
          </p>
        )}
        {sessions?.map((s) => {
          const meta = INTERVIEW_META[s.type];
          const done = s.status === "completed";
          return (
            <div className="session-row" key={s.id}>
              <div>
                <strong>{meta?.label ?? s.type}</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  {new Date(s.createdAt).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {s.overallScore != null && (
                  <span className="score-pill">{s.overallScore}/100</span>
                )}
                <span className={`badge ${done ? "done" : "active"}`}>
                  {done ? "Completed" : "In progress"}
                </span>
                {done ? (
                  <Link className="btn" to={`/report/${s.id}`}>
                    View report
                  </Link>
                ) : (
                  <span className="muted" style={{ fontSize: 13 }}>
                    —
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

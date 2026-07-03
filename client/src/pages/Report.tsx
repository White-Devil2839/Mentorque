import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { INTERVIEW_META, type InterviewType, type Report, type TranscriptTurn } from "../types";

interface SessionDetail {
  id: string;
  type: InterviewType;
  status: string;
  createdAt: string;
  transcript: TranscriptTurn[];
  report: (Report & { id: string }) | null;
}

export function ReportPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    api<{ session: SessionDetail }>(`/interview/sessions/${id}`, { token })
      .then((d) => setSession(d.session))
      .catch((e) => setError((e as Error).message));
  }, [id, token]);

  if (error) {
    return (
      <div className="container">
        <div className="card center">
          <p className="error">{error}</p>
          <Link className="btn" to="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="container">
        <p className="muted">Loading report…</p>
      </div>
    );
  }

  const meta = INTERVIEW_META[session.type];
  const report = session.report;

  // Defensive: tolerate any older/malformed persisted report without crashing.
  const dimensions = report?.dimensions ?? [];
  const strengths = report?.strengths ?? [];
  const improvements = report?.improvements ?? [];

  if (!report) {
    return (
      <div className="container">
        <div className="card center stack">
          <h2>No report yet</h2>
          <p className="muted">
            This interview doesn't have a completed report.
          </p>
          <Link className="btn primary" to="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container stack">
      <div className="row-between">
        <div>
          <Link to="/" className="muted">
            ← Dashboard
          </Link>
          <h1 style={{ margin: "6px 0 0" }}>{meta.label} — Feedback</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {new Date(session.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="report-head">
          <div className="ring" style={{ ["--p" as any]: report.overallScore }}>
            <div className="inner">{report.overallScore}</div>
          </div>
          <div>
            <h2 style={{ margin: "0 0 6px" }}>Overall</h2>
            <p style={{ margin: 0 }}>{report.summary}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>By dimension</h2>
        {dimensions.map((d, i) => (
          <div className="dim" key={i}>
            <div className="row-between">
              <strong>{d.name}</strong>
              <span className="muted">{d.score}/100</span>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.max(0, Math.min(100, d.score))}%` }} />
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
              {d.comment}
            </p>
          </div>
        ))}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2 style={{ marginTop: 0, color: "var(--good)" }}>What went well</h2>
          {strengths.map((s, i) => (
            <div className="list-item" key={i}>
              <strong>{s.point}</strong>
              {s.quote && <div className="quote">“{s.quote}”</div>}
            </div>
          ))}
          {strengths.length === 0 && <p className="muted">—</p>}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0, color: "var(--warn)" }}>
            Where to improve
          </h2>
          {improvements.map((s, i) => (
            <div className="list-item" key={i}>
              <strong>{s.point}</strong>
              {s.quote && <div className="quote">“{s.quote}”</div>}
              <p style={{ margin: "6px 0 0", fontSize: 14 }}>💡 {s.suggestion}</p>
            </div>
          ))}
          {improvements.length === 0 && <p className="muted">—</p>}
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <h2 style={{ margin: 0 }}>Transcript</h2>
          <button className="btn" onClick={() => setShowTranscript((v) => !v)}>
            {showTranscript ? "Hide" : "Show"}
          </button>
        </div>
        {showTranscript && (
          <div style={{ marginTop: 14 }}>
            {session.transcript
              .filter((t) => t.role === "user" || t.role === "assistant")
              .map((t, i) => (
                <div className={`turn ${t.role}`} key={i}>
                  <div className="who">
                    {t.role === "assistant" ? meta.interviewer : "You"}
                  </div>
                  <div className="bubble">{t.content}</div>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="center">
        <Link className="btn primary lg" to="/new">
          Practice again
        </Link>
      </div>
    </div>
  );
}

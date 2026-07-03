import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { INTERVIEW_META, type InterviewType } from "../types";

const TYPES = Object.keys(INTERVIEW_META) as InterviewType[];

export function NewInterview() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<InterviewType>("behavioral");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setError("");
    setBusy(true);
    try {
      const data = await api<{
        sessionId: string;
        assistant: unknown;
        vapiPublicKey: string;
      }>("/interview/start", {
        method: "POST",
        token,
        body: { type: selected },
      });
      navigate(`/interview/${data.sessionId}`, {
        state: {
          assistant: data.assistant,
          vapiPublicKey: data.vapiPublicKey,
          type: selected,
        },
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <div>
        <h1 style={{ marginBottom: 4 }}>Choose your interview</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          One type, done properly. Pick what you want to practice.
        </p>
      </div>

      <div className="grid cols-2">
        {TYPES.map((t) => {
          const meta = INTERVIEW_META[t];
          return (
            <button
              key={t}
              className={`type-card ${selected === t ? "selected" : ""}`}
              onClick={() => setSelected(t)}
            >
              <h3>{meta.label}</h3>
              <p>{meta.blurb}</p>
              <p style={{ marginTop: 8, color: "var(--accent)" }}>
                Interviewer: {meta.interviewer}
              </p>
            </button>
          );
        })}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row-between">
          <div>
            <strong>Ready?</strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>
              This is voice-only. You'll need to allow microphone access. Speak
              naturally — {INTERVIEW_META[selected].interviewer} is listening.
            </p>
          </div>
          <button className="btn primary lg" onClick={start} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> Preparing…
              </>
            ) : (
              `Start ${INTERVIEW_META[selected].label}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

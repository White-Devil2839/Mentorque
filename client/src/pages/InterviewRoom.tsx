import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Vapi from "@vapi-ai/web";
import { api } from "../api";
import { useAuth } from "../auth";
import { INTERVIEW_META, type InterviewType, type TranscriptTurn } from "../types";

type Phase = "ready" | "connecting" | "live" | "finishing" | "error";
type SpeakerState = "idle" | "speaking" | "listening";

interface RoomNavState {
  assistant?: unknown;
  vapiPublicKey?: string;
  type?: InterviewType;
}

export function InterviewRoom() {
  const { id: sessionId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = (location.state ?? {}) as RoomNavState;

  const [phase, setPhase] = useState<Phase>("ready");
  const [speaker, setSpeaker] = useState<SpeakerState>("idle");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [error, setError] = useState("");

  const vapiRef = useRef<Vapi | null>(null);
  const finishedRef = useRef(false);
  const transcriptRef = useRef<TranscriptTurn[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const meta = nav.type ? INTERVIEW_META[nav.type] : null;

  // If the page was refreshed we lost the transient assistant config; the
  // interview must be restarted from scratch.
  useEffect(() => {
    if (!nav.assistant || !nav.vapiPublicKey) {
      navigate("/new", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a ref copy of the transcript so event handlers/cleanup see the latest.
  useEffect(() => {
    transcriptRef.current = transcript;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript]);

  // Stop the call if the user navigates away mid-interview.
  useEffect(() => {
    return () => {
      try {
        vapiRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  async function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setPhase("finishing");
    try {
      await api(`/interview/${sessionId}/finish`, {
        method: "POST",
        token,
        body: { transcript: transcriptRef.current },
      });
      navigate(`/report/${sessionId}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  function begin() {
    if (!nav.assistant || !nav.vapiPublicKey) return;
    setPhase("connecting");
    setError("");

    const vapi = new Vapi(nav.vapiPublicKey);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setPhase("live");
      setSpeaker("listening");
    });
    vapi.on("speech-start", () => setSpeaker("speaking"));
    vapi.on("speech-end", () => setSpeaker("listening"));
    vapi.on("message", (msg: any) => {
      if (msg?.type === "transcript" && msg?.transcriptType === "final") {
        const role: TranscriptTurn["role"] =
          msg.role === "user" ? "user" : "assistant";
        const content = String(msg.transcript ?? "").trim();
        if (content) setTranscript((prev) => [...prev, { role, content }]);
      }
    });
    vapi.on("call-end", () => {
      void finish();
    });
    vapi.on("error", (e: any) => {
      console.error("Vapi error", e);
      setError(
        e?.errorMsg || e?.message || "Voice connection error. Please retry.",
      );
      setPhase("error");
    });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vapi.start(nav.assistant as any);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  function endInterview() {
    setPhase("finishing");
    try {
      vapiRef.current?.stop();
    } catch {
      /* ignore */
    }
    // 'call-end' will trigger finish(); this is a safety net.
    void finish();
  }

  // ── Pre-call screen ──
  if (phase === "ready") {
    return (
      <div className="container">
        <div className="card center stack" style={{ maxWidth: 560, margin: "6vh auto" }}>
          <h1 style={{ margin: 0 }}>
            {meta ? `${meta.label} interview` : "Interview"}
          </h1>
          <p className="muted">
            You'll speak with {meta?.interviewer ?? "your interviewer"}. When
            you're ready, click begin and allow microphone access. Speak as you
            would in a real interview — you can end anytime.
          </p>
          <button className="btn primary lg" onClick={begin}>
            🎙️ Begin interview
          </button>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="container">
        <div className="card center stack" style={{ maxWidth: 560, margin: "6vh auto" }}>
          <h2 style={{ margin: 0 }}>Something interrupted the interview</h2>
          <p className="error">{error}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              className="btn"
              onClick={() => navigate("/dashboard", { replace: true })}
            >
              Back to dashboard
            </button>
            {transcriptRef.current.some((t) => t.role === "user") && (
              <button
                className="btn primary"
                onClick={() => {
                  finishedRef.current = false;
                  void finish();
                }}
              >
                Generate report anyway
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Live room ──
  const stateLabel =
    phase === "connecting"
      ? "Connecting…"
      : phase === "finishing"
        ? "Wrapping up…"
        : speaker === "speaking"
          ? `${meta?.interviewer ?? "Interviewer"} is speaking`
          : "Listening…";

  return (
    <div className="room">
      <div className="stage">
        <div className={`orb ${phase === "live" ? speaker : "idle"}`} />
        <div className="state-label">{stateLabel}</div>
        <h2 style={{ margin: 0 }}>{meta?.interviewer ?? "Interviewer"}</h2>
        <button
          className="btn danger lg"
          onClick={endInterview}
          disabled={phase === "finishing"}
        >
          {phase === "finishing" ? (
            <>
              <span className="spinner" /> Generating report…
            </>
          ) : (
            "End interview"
          )}
        </button>
      </div>

      <div className="transcript" ref={scrollRef}>
        <h3 style={{ marginTop: 0 }}>Live transcript</h3>
        {transcript.length === 0 && (
          <p className="muted">The conversation will appear here as you talk.</p>
        )}
        {transcript.map((t, i) => (
          <div className={`turn ${t.role}`} key={i}>
            <div className="who">
              {t.role === "assistant" ? meta?.interviewer ?? "Interviewer" : "You"}
            </div>
            <div className="bubble">{t.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import { INTERVIEW_META, type InterviewType } from "../types";

const TYPES = Object.keys(INTERVIEW_META) as InterviewType[];

const STEPS = [
  {
    n: "1",
    title: "Set up your profile",
    text: "Your target role and experience level calibrate every question you'll get.",
  },
  {
    n: "2",
    title: "Pick your interview",
    text: "Behavioral, Technical, System Design, or HR — each with its own interviewer persona.",
  },
  {
    n: "3",
    title: "Talk. Actually talk.",
    text: "A real voice conversation: it listens, follows up, pushes back, and adapts. No text box.",
  },
  {
    n: "4",
    title: "Get feedback with receipts",
    text: "A scored report that quotes you verbatim — what worked, what didn't, what to say instead.",
  },
];

const FEATURES = [
  {
    icon: "🎙️",
    title: "No script, no question bank",
    text: "Every question is generated from what you just said. Vague answers get probed. Strong ones raise the difficulty.",
  },
  {
    icon: "🧠",
    title: "An interviewer that listens",
    text: "It references your own words, challenges what you glossed over, and knows when to move on.",
  },
  {
    icon: "📋",
    title: "Reports grounded in you",
    text: "Per-dimension scores, strengths, and fixes — every point anchored to a direct quote from your interview.",
  },
];

export function Landing() {
  return (
    <div className="landing">
      {/* ── Hero ── */}
      <section className="hero">
        <div>
          <span className="badge-pill">
            <i className="dot" /> AI voice interviews · free to try
          </span>
          <h1>
            Practice interviews that <span className="grad">talk back.</span>
          </h1>
          <p className="lead">
            Mentorque puts you in a real, spoken interview. The AI listens to
            what you actually said, digs into weak answers, rewards strong
            ones — then hands you a feedback report built from your own words.
          </p>
          <div className="hero-ctas">
            <Link className="btn primary lg" to="/signup">
              Start practicing free
            </Link>
            <Link className="btn lg" to="/login">
              I have an account
            </Link>
          </div>
          <p className="hero-note muted">
            No card. No question lists. Just a conversation.
          </p>
        </div>

        {/* Live-probe vignette — the product's "surprise moment" */}
        <div className="hero-demo card">
          <div className="demo-head">
            <div className="orb small speaking" />
            <div>
              <strong>Maya</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                Behavioral interviewer · live
              </div>
            </div>
          </div>
          <div className="turn user">
            <div className="who">You</div>
            <div className="bubble">
              …so we shipped the project and it went fine, I guess.
            </div>
          </div>
          <div className="turn assistant">
            <div className="who">Maya</div>
            <div className="bubble demo-highlight">
              “Went fine” is interesting — what part did <em>you</em>{" "}
              personally own, and how did you know it worked?
            </div>
          </div>
          <div className="demo-caption muted">
            She heard the hedge — and dug in.
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="landing-section">
        <h2 className="section-title">How it works</h2>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <div className="step-n">{s.n}</div>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="landing-section">
        <h2 className="section-title">Not a quiz app</h2>
        <div className="features">
          {FEATURES.map((f) => (
            <div className="card feature" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Interview types ── */}
      <section className="landing-section">
        <h2 className="section-title">Four interviews, four interviewers</h2>
        <div className="type-strip">
          {TYPES.map((t) => (
            <div className="type-chip" key={t}>
              <strong>{INTERVIEW_META[t].label}</strong>
              <span className="muted"> — {INTERVIEW_META[t].blurb}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="landing-section">
        <div className="card cta-band">
          <div>
            <h2 style={{ margin: 0 }}>Your next interview shouldn't be the real one.</h2>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              Ten minutes of practice out loud beats an hour of reading answers.
            </p>
          </div>
          <Link className="btn primary lg" to="/signup">
            Try an interview now
          </Link>
        </div>
      </section>

      <footer className="landing-footer muted">
        Mentorque — interview practice, out loud.
      </footer>
    </div>
  );
}

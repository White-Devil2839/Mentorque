# Mentorque — AI Mock Interview Platform

A full-stack platform where candidates have a **real, dynamic voice conversation**
with an AI interviewer. Not a question list. Not a chatbot. The AI listens to what
you actually said, follows up on vague answers, acknowledges strong ones, decides
when to dig deeper vs. move on, and closes naturally — then generates a detailed
feedback report grounded in your own words.

> Focus: **one interview type done properly.** The engine is fully generic across
> all four types, but Behavioral is the flagship experience.

---

## Why this isn't a quiz app

The entire interview is driven by a **LangGraph state machine** whose next move is
recomputed from the full conversation on every turn:

```
                    (candidate speaks)
                           │
                           ▼
            ┌─────────────────────────────┐   ONE streamed Gemini call:
            │            turn             │   silently scores the last answer
            │  (evaluate + decide + speak)│   (quality, vague? strong?) AND
            └──────────────┬──────────────┘   speaks the next line
                           │
             ┌─────────────┼──────────────┐        (adaptive branching —
             ▼             ▼              ▼          LangGraph routes the decision)
        ┌─────────┐   ┌─────────┐    ┌─────────┐
        │  probe  │   │ advance │    │  close  │
        └─────────┘   └─────────┘    └─────────┘
   spent a follow-up   bank the topic,   coverage is enough →
   digging into a      reset follow-ups, wrap up + complete
   weak/vague answer   ratchet difficulty the session
                       up on strong answers
```

- **No hardcoded question bank.** Every line is generated from the running transcript.
- **Running state per session** (coverage, per-answer scores, difficulty, follow-up
  budget) is persisted and carried across turns — the AI always knows what was said.
- **Adaptive difficulty:** strong answers ratchet difficulty up; weak ones get probed.
- **One round-trip per answer:** the evaluation rides in the *same* streamed call as
  the spoken reply — a machine-readable trailer that's stripped before it can reach
  the voice pipe — so scoring adds zero latency to the conversation.

## The voice architecture (clean third-party integration)

We use **Vapi as pure transport** and keep 100% of the interview intelligence in our
own backend via Vapi's **custom-LLM** mode:

```
 Browser ──WebRTC──►  Vapi Cloud  ──POST /chat/completions──►  Our Express server
 (mic/speaker)        STT · TTS ·      (OpenAI-compatible          │
                      turn-taking ·     streaming SSE)              ▼
                      barge-in                             LangGraph + Gemini
                                                        (evaluate → decide → speak)
```

Vapi handles the hard real-time audio (speech-to-text, text-to-speech, turn-taking,
interruptions). Our server is the "brain": it receives the transcript, runs the graph,
and streams tokens back. This gives production-grade voice UX **and** makes the
conversation logic provably ours — exactly what the brief asks for.

---

## Tech stack

| Layer     | Choice |
|-----------|--------|
| Frontend  | React (Vite) + React Router |
| Backend   | Node.js + Express |
| Database  | PostgreSQL + Prisma |
| Auth      | Email + password, JWT (no OAuth) |
| Voice     | Vapi (managed) in custom-LLM mode |
| AI engine | LangGraph.js + Gemini (Google) — free-tier friendly |
| Models    | Flash (speaks + scores in one merged call, with quota failover) · 3.5 Flash (report) — see [COST.md](./COST.md) |

---

## Setup (local, under 5 commands)

**Prerequisites:** Node 20+, a Postgres database (local or a free [Neon](https://neon.tech)
URL), a **free** [Gemini API key](https://aistudio.google.com/apikey) (no card
required), and a free [Vapi](https://vapi.ai) account (public key).

```bash
cp .env.example .env     # then fill in the values (see below)
npm install
npm run db:push          # creates the tables in your Postgres
npm run dev              # starts API (:4000) + client (:5173)
```

**One extra prerequisite for voice:** Vapi's cloud must reach your local server's
webhook. In a separate terminal:

```bash
ngrok http 4000
```

Copy the `https://…ngrok…` URL into `PUBLIC_SERVER_URL` in `.env`, then restart
`npm run dev`. (In production, `PUBLIC_SERVER_URL` is just your deployed API URL — no
ngrok needed.)

### Environment variables (`.env`)

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | any long random string |
| `GEMINI_API_KEY` | free key from [AI Studio](https://aistudio.google.com/apikey) |
| `PUBLIC_SERVER_URL` | ngrok https URL locally / deployed API URL in prod |
| `VITE_VAPI_PUBLIC_KEY` | Vapi **public** key (browser-safe) |
| `VITE_API_URL` | `http://localhost:4000` for local dev |

Then open **http://localhost:5173**, sign up, pick an interview, and talk.

---

## How a session flows

1. **Sign up** → name, target role, experience level (your profile).
2. **Pick an interview type** → Behavioral / Technical / System Design / HR.
3. **`POST /interview/start`** → server creates a Session, generates a personalized
   opening line, mints a signed per-interview token, and returns a transient Vapi
   assistant whose custom-LLM URL embeds that token.
4. **The call runs.** Each time you finish speaking, Vapi POSTs the transcript to
   `…/interview/webhook/:token/chat/completions`. The server verifies the token,
   loads session state, runs the LangGraph turn, and **streams** the reply back.
5. **End anytime** (or the AI closes when coverage is sufficient). `POST /:id/finish`
   generates the Opus feedback report from the full transcript.
6. **Dashboard** lists every past session; each completed one links to its report
   (overall score, per-dimension scores, strengths and weaknesses **quoting you
   verbatim**, and the full transcript).

---

## Project structure

```
.
├── server/                     # Express API
│   ├── prisma/schema.prisma    # User · Session · Report
│   └── src/
│       ├── index.ts            # app wiring
│       ├── env.ts              # validated env (zod)
│       ├── auth/               # JWT + bcrypt (register/login/me)
│       └── interview/
│           ├── engine.ts       # ⭐ LangGraph state machine
│           ├── llm.ts          # Gemini model tiers, streaming, structured output
│           ├── persona.ts      # per-type interviewer persona + prompts
│           ├── report.ts       # structured feedback report (Opus)
│           ├── vapi.ts         # transient assistant (custom-LLM) builder
│           └── routes.ts       # start · webhook · finish · history
└── client/                     # React (Vite)
    └── src/pages/
        ├── InterviewRoom.tsx   # ⭐ Vapi voice UI (orb, live transcript)
        ├── Dashboard.tsx · NewInterview.tsx · Report.tsx · Login/Signup
```

---

## Cost analysis

A full ~12-minute interview costs roughly **$1.10–$1.85**, dominated by voice
transport — the LLM "brain" costs **$0 at demo scale on Gemini's free tier** (and
only ~$0.02 at paid rates) thanks to deliberate model tiering (Flash-Lite for
scoring, Flash for turns, a bigger model once for the report), thinking disabled in
the latency-critical path, implicit prefix caching, and short spoken turns. Full
breakdown and the optimization levers are in **[COST.md](./COST.md)**.

---

## Notes & tradeoffs

- **One type, done deeply.** All four types share the same adaptive engine; Behavioral
  is the most polished persona.
- **Voice-only by design.** The live transcript is displayed for accessibility, but
  there is no text input — the candidate speaks.
- **Ending the call:** when coverage is sufficient the engine **closes the interview
  server-side** (marks it completed and speaks a wrap-up), so further utterances no
  longer run the engine. The actual audio hangup is via the "End interview" button or
  Vapi's duration/silence caps; wiring a Vapi `endCall` tool for automatic hangup is a
  natural next step.
- **Idempotent turns:** each answer is scored once (guarded by `evaluatedUpTo`), so a
  retried webhook can't double-count state or end the interview early.
- **Stateless webhook, stateful interview:** each turn reconstructs LangGraph state
  from Postgres, so the engine scales horizontally without sticky sessions.

# Cost Analysis

Per-interview cost, broken down by component, with the assumptions stated so the
numbers are auditable. Reference interview: **~12 minutes, Behavioral, ~10 candidate
answers.**

## TL;DR

| Component | Cost / interview | Share |
|---|---|---|
| Voice transport (Vapi: STT + TTS + orchestration) | **$1.10 – $1.80** | ~98% |
| Gemini engine (LangGraph turns + report) | **$0.00 on free tier** (~$0.02 at paid rates) | ~2% |
| Postgres (Neon free tier at this scale) | ~$0.00 | ~0% |
| **Total** | **≈ $1.10 – $1.85** | |

**The headline insight:** the AI "brain" is *not* the cost driver — real-time voice
I/O is. At demo scale the LLM is literally **$0** (Gemini free tier, no card
required), and even at paid rates it's a rounding error. So the highest-leverage
cost control is **bounding interview length** (`maxDurationSeconds` is capped at
18 min), not squeezing the LLM.

---

## Model tiering (with quota failover)

Each stage runs on the cheapest model that does the job well — overridable via
env (`GEMINI_TURN_MODEL` / `GEMINI_TURN_FALLBACK_MODEL` / `GEMINI_REPORT_MODEL`)
without code changes:

| Model | Role here | Why this tier |
|---|---|---|
| `gemini-2.5-flash` | live turns — **speaks AND scores in one merged call** | best price/latency for conversational quality; thinking disabled for snappy replies |
| `gemini-2.5-flash-lite` | automatic failover for live turns | separate free-tier quota bucket; keeps the interview alive if Flash is exhausted or overloaded |
| `gemini-3.5-flash` | final feedback report (1× per interview) | quality matters most here; latency doesn't; a single call (walks the chain on 429/503) |

## Gemini cost, itemized (~10 answers + report, paid-tier list prices)

Paid-tier reference prices (per 1M tokens): Flash $0.30 in / $2.50 out;
Flash-Lite $0.10 in / $0.40 out. The report call is bounded below at Pro-tier
rates ($1.25 / $10) as a conservative ceiling.

| Call | Model | ~Input tok | ~Output tok | ~Cost |
|---|---|---|---|---|
| Opening line (1×) | Flash | 700 | 80 | $0.0004 |
| Merged turns — reply + hidden evaluation trailer (10×) | Flash | ~1,600 ea | ~230 ea | $0.0106 |
| Feedback report (1×) | 3.5 Flash | ~3,300 | ~700 | ≤ $0.011 |
| **LLM total** | | | | **≈ $0.02 paid · $0.00 free tier** |

### Free-tier fit (measured, not assumed)

Free-tier limits are **per model** and vary by key and model generation — we
measured ours live: `gemini-2.5-flash` allowed ~20 requests/day, while
`gemini-2.0-flash` allowed **zero** (older models get no free quota). Your
key's exact numbers are in the
[AI Studio dashboard](https://aistudio.google.com/rate-limit). Three design
consequences:

- **Merging evaluation into the turn call halved the request count** — a full
  interview is now ~12 requests instead of ~22, which matters when a model's
  daily budget is ~20.
- **Failover spreads load across quota buckets:** on a 429 the turn call fails
  over to the fallback model *immediately* (no backoff — it's a different
  bucket), and the report walks the whole chain.
- **Demo-day planning:** budget roughly one full interview per model per day on
  a fresh free key (avoid burning smoke tests beforehand), or switch the model
  overrides between takes. Paid tier 1 removes the ceilings at ~2¢/interview.

## How the LLM cost/latency is kept low (token optimization)

This maps directly to the "AI integrations and token optimization" the role calls for:

1. **One round-trip per answer.** Answer evaluation rides in the *same* streamed
   call as the spoken reply — a machine-readable trailer stripped before it can
   reach the voice pipe — so scoring adds zero latency and zero extra
   request-quota burn.
2. **Thinking disabled in the hot path.** Flash's thinking mode is turned off
   (`thinkingBudget: 0`) for live turns — lower latency for voice and no billed
   thinking tokens. The report keeps default reasoning, where quality matters
   and latency doesn't.
3. **Latency-first failure policy.** At most ONE retry per model, only on 503,
   after a 300ms backoff; quota errors (429) fail over to the next model
   instantly. The conversation is never blocked on retry loops.
4. **Implicit prefix caching.** The stable system prompt (persona + rules +
   candidate profile) is placed first and byte-identical every turn, so Gemini's
   automatic implicit caching discounts the repeated prefix tokens.
5. **Short spoken turns.** `maxOutputTokens` is capped at 500 for merged turns
   (≤300 spoken + ~150 trailer) and 200 for the opener, so output tokens stay
   tiny.

## Voice transport assumptions

Vapi bills roughly **$0.05/min** for orchestration plus the underlying STT (Deepgram
Nova ~$0.004–0.01/min) and TTS. Using Vapi's bundled voices keeps TTS modest; an
external premium voice (ElevenLabs) would push the top of the range up. All-in ≈
**$0.09–0.15/min** → **$1.10–$1.80** for 12 minutes. (New Vapi accounts include
trial credits, so the demo itself can run at $0 end to end.)

## Scaling notes

- At **1,000 interviews/month**: ≈ **$1,100–$1,850/mo**, of which the LLM is only
  **~$20** (paid tier). Cost scales with *minutes of conversation*, so product
  levers (tighter time caps, concise interviewer prompting to reduce TTS seconds)
  matter more than model choice.
- **Cheaper voice** is the biggest lever if scale demands it: self-hosting an
  open-source pipeline (e.g. LiveKit + Deepgram + a cheaper TTS) can cut the ~98%
  voice share substantially, at the cost of more ops. The custom-LLM design means
  the brain is unchanged if we ever swap the voice layer.
- **Provider portability:** the LLM surface is isolated in one file
  (`server/src/interview/llm.ts` — ~200 lines), so swapping or A/B-ing providers
  (Claude, GPT, Gemini) is a one-file change.

*All figures are engineering estimates for planning; actual costs vary with answer
length, silence, chosen voice, and Google's current price list.*

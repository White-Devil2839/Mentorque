import {
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
} from "@google/genai";
import { env } from "../env.js";
import type { ChatMessage } from "../types.js";
import { EVAL_DELIMITER } from "./persona.js";

// Gemini client. A free API key from https://aistudio.google.com/apikey is
// enough to run the whole platform at demo scale ($0 LLM cost).
export const genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Model tiers — deliberate cost/latency tradeoff (see COST.md), overridable
// via env without code changes:
//   - turn:         the live interviewer (streamed; also scores the previous
//                   answer in the SAME call — no separate evaluation request)
//   - turnFallback: takes over when the turn model is quota-exhausted or down.
//                   Free-tier quotas are per model, so failover restores service.
//   - report:       the final feedback report (runs once per interview)
export const MODELS = {
  turn: env.GEMINI_TURN_MODEL,
  turnFallback: env.GEMINI_TURN_FALLBACK_MODEL,
  report: env.GEMINI_REPORT_MODEL,
} as const;

// ── Failure policy (latency-first) ──────────────────────────────────────────
// Live voice cannot absorb long stalls:
//   - HTTP 503 (capacity spike): retry the SAME model at most once, after a
//     single 300ms backoff. If that fails, fail over to the next model.
//   - HTTP 429 (quota exhausted): fail over to the next model IMMEDIATELY —
//     no sleep, it's a different quota bucket.
//   - Anything else, or speech already streamed: fail fast; the caller's
//     degradation path runs instead of blocking the conversation.
const RETRY_BACKOFF_MS = 300;

const is503 = (err: unknown) =>
  (err as { status?: number } | null)?.status === 503;
const is429 = (err: unknown) =>
  (err as { status?: number } | null)?.status === 429;
const isTransient = (err: unknown) => is503(err) || is429(err);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function turnCandidates(): string[] {
  return [...new Set([MODELS.turn, MODELS.turnFallback])];
}

// Run `attempt(model)` across the turn-model chain under the failure policy.
// `mayRetry()` must return false once any output has been emitted downstream —
// a retry after speech started would duplicate audio mid-sentence.
async function withTurnFailover(
  label: string,
  mayRetry: () => boolean,
  attempt: (model: string) => Promise<void>,
): Promise<void> {
  let lastError: unknown = null;
  for (const model of turnCandidates()) {
    try {
      await attempt(model);
      return;
    } catch (err) {
      if (!mayRetry() || !isTransient(err)) throw err;
      if (is503(err)) {
        console.error(
          `[llm] ${label}: ${model} hit 503; retrying once after ${RETRY_BACKOFF_MS}ms`,
        );
        await sleep(RETRY_BACKOFF_MS);
        try {
          await attempt(model);
          return;
        } catch (retryErr) {
          if (!mayRetry() || !isTransient(retryErr)) throw retryErr;
          lastError = retryErr;
        }
      } else {
        lastError = err;
      }
      console.error(
        `[llm] ${label}: ${model} unavailable (${(lastError as { status?: number })?.status}); failing over to next turn model`,
      );
    }
  }
  throw lastError;
}

// In the hot voice path we disable thinking for snappy replies. The explicit
// thinkingBudget knob applies to the 2.5 family (0 = disabled); other models
// either have none (2.0) or manage depth themselves (3.x+).
function lowLatency(model: string): GenerateContentConfig {
  return model.startsWith("gemini-2.5")
    ? { thinkingConfig: { thinkingBudget: 0 } }
    : {};
}

// Map our transcript onto Gemini contents. Gemini expects user/model roles and
// a user turn at the edges, so guard both (our transcript starts with the
// interviewer's generated opening).
function toContents(messages: ChatMessage[]): Content[] {
  const contents: Content[] = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  if (contents[0]?.role === "model") {
    contents.unshift({ role: "user", parts: [{ text: "(The interview begins.)" }] });
  }
  if (contents.at(-1)?.role === "model") {
    contents.push({
      role: "user",
      parts: [{ text: "(Continue naturally from where you left off.)" }],
    });
  }
  return contents;
}

// ── Evaluation types ────────────────────────────────────────────────────────
export interface EvaluationResult {
  topic: string;
  score: number; // 0-10 answer quality
  completeness: number; // 0-10 specificity / completeness
  isVague: boolean;
  isStrong: boolean;
  coversNewArea: boolean;
  note: string; // one-line rationale
}

// Neutral fallback — used whenever the evaluation trailer is missing or
// unparseable, so a scoring hiccup NEVER blocks the live conversation (the
// interview just moves on with an average read).
export const FALLBACK_EVALUATION: EvaluationResult = {
  topic: "the previous question",
  score: 5,
  completeness: 6,
  isVague: false,
  isStrong: false,
  coversNewArea: true,
  note: "Answer recorded.",
};

function clamp10(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.min(10, Math.round(v)))
    : fallback;
}

function normalizeEvaluation(raw: unknown): EvaluationResult {
  if (!raw || typeof raw !== "object") return FALLBACK_EVALUATION;
  const r = raw as Record<string, unknown>;
  return {
    topic:
      typeof r.topic === "string" && r.topic.trim()
        ? r.topic.trim()
        : FALLBACK_EVALUATION.topic,
    score: clamp10(r.score, FALLBACK_EVALUATION.score),
    completeness: clamp10(r.completeness, FALLBACK_EVALUATION.completeness),
    isVague: Boolean(r.isVague),
    isStrong: Boolean(r.isStrong),
    coversNewArea:
      r.coversNewArea === undefined ? true : Boolean(r.coversNewArea),
    note:
      typeof r.note === "string" && r.note.trim()
        ? r.note.trim()
        : FALLBACK_EVALUATION.note,
  };
}

// ── Streaming delimiter splitter ───────────────────────────────────────────
// The merged turn streams "<spoken reply> <<<EVAL>>> {json}". Spoken tokens
// must reach the voice pipe immediately, but the trailer must never be spoken.
// Because the delimiter can arrive split across chunks, we hold back the last
// (delimiter-length - 1) characters until we know they aren't the start of it.
// Exported for direct unit testing.
export function createReplyExtractor(onToken: (delta: string) => void) {
  let buf = "";
  let emitted = 0;
  let delimAt = -1;

  return {
    push(delta: string) {
      buf += delta;
      if (delimAt >= 0) return; // already past the spoken part — just collect
      delimAt = buf.indexOf(EVAL_DELIMITER);
      const boundary =
        delimAt >= 0
          ? delimAt
          : Math.max(emitted, buf.length - (EVAL_DELIMITER.length - 1));
      if (boundary > emitted) {
        onToken(buf.slice(emitted, boundary));
        emitted = boundary;
      }
    },
    // True once any speech has been forwarded to the voice pipe.
    spokeAny() {
      return emitted > 0;
    },
    finish(): { reply: string; trailer: string } {
      if (delimAt >= 0) {
        return {
          reply: buf.slice(0, delimAt).trim(),
          trailer: buf.slice(delimAt + EVAL_DELIMITER.length).trim(),
        };
      }
      // No trailer ever arrived — flush the held-back tail as speech.
      if (buf.length > emitted) onToken(buf.slice(emitted));
      return { reply: buf.trim(), trailer: "" };
    },
  };
}

function parseTrailer(trailer: string): {
  evaluation: EvaluationResult;
  nextAction: "probe" | "advance";
  parsed: boolean;
} {
  // Tolerate stray text/fences around the JSON: parse the outermost braces.
  const start = trailer.indexOf("{");
  const end = trailer.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const raw = JSON.parse(trailer.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
      return {
        evaluation: normalizeEvaluation(raw),
        nextAction: raw.nextAction === "probe" ? "probe" : "advance",
        parsed: true,
      };
    } catch {
      /* fall through to neutral fallback */
    }
  }
  return { evaluation: FALLBACK_EVALUATION, nextAction: "advance", parsed: false };
}

// ── The merged turn (hot path) ─────────────────────────────────────────────
export interface MergedTurnResult {
  reply: string;
  evaluation: EvaluationResult;
  nextAction: "probe" | "advance";
  evaluationParsed: boolean;
}

// ONE Gemini call: evaluates the candidate's last answer AND streams the next
// spoken line. Eliminates the previous separate evaluateAnswer() round-trip.
// The stable system prompt is placed first so Gemini's implicit caching can
// reuse the repeated prefix across turns.
export async function streamMergedTurn(
  stableSystem: string,
  mergedDirective: string,
  messages: ChatMessage[],
  onToken: (delta: string) => void,
): Promise<MergedTurnResult> {
  const extractor = createReplyExtractor(onToken);

  await withTurnFailover(
    "merged turn",
    () => !extractor.spokeAny(),
    async (model) => {
      const stream = await genai.models.generateContentStream({
        model,
        contents: toContents(messages),
        config: {
          systemInstruction: `${stableSystem}\n\n${mergedDirective}`,
          // Spoken reply (≤300) + evaluation trailer (~150).
          maxOutputTokens: 500,
          ...lowLatency(model),
        },
      });
      for await (const chunk of stream) {
        const delta = chunk.text;
        if (delta) extractor.push(delta);
      }
    },
  );

  const { reply, trailer } = extractor.finish();
  const { evaluation, nextAction, parsed } = parseTrailer(trailer);
  if (!parsed) {
    console.error(
      "[llm] merged turn had no parseable evaluation trailer; using neutral fallback",
    );
  }
  return { reply, evaluation, nextAction, evaluationParsed: parsed };
}

// Plain spoken turn without an evaluation trailer — used for duplicate-webhook
// retries where the answer was already scored.
export async function streamTurn(
  stableSystem: string,
  turnDirective: string,
  messages: ChatMessage[],
  onToken: (delta: string) => void,
): Promise<string> {
  let full = "";

  await withTurnFailover(
    "turn",
    () => !full.trim(),
    async (model) => {
      const stream = await genai.models.generateContentStream({
        model,
        contents: toContents(messages),
        config: {
          systemInstruction: `${stableSystem}\n\n${turnDirective}`,
          maxOutputTokens: 300,
          ...lowLatency(model),
        },
      });
      for await (const chunk of stream) {
        const delta = chunk.text;
        if (delta) {
          full += delta;
          onToken(delta);
        }
      }
    },
  );
  return full.trim();
}

// Non-streaming completion — used for the interviewer's opening line.
export async function completeOnce(
  stableSystem: string,
  userPrompt: string,
  maxTokens = 200,
): Promise<string> {
  let text = "";
  await withTurnFailover(
    "completion",
    () => true, // non-streaming: nothing reaches the caller until success
    async (model) => {
      const response = await genai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: stableSystem,
          maxOutputTokens: maxTokens,
          ...lowLatency(model),
        },
      });
      text = (response.text ?? "").trim();
    },
  );
  return text;
}

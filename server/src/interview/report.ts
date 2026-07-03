import { Type, type Schema } from "@google/genai";
import { genai, MODELS } from "./llm.js";
import { PERSONAS } from "./persona.js";
import type {
  CandidateProfile,
  ChatMessage,
  InterviewType,
} from "../types.js";

export interface InterviewReport {
  overallScore: number; // 0-100
  summary: string;
  dimensions: { name: string; score: number; comment: string }[];
  strengths: { point: string; quote: string }[];
  improvements: { point: string; quote: string; suggestion: string }[];
}

const DIMENSION_HINTS: Record<InterviewType, string> = {
  behavioral:
    "Communication, STAR structure, Specificity & evidence, Self-awareness, Impact & ownership",
  technical:
    "Technical depth, Problem-solving approach, Tradeoff reasoning, Clarity of explanation, Handling of edge cases",
  system_design:
    "Requirements framing, Architecture & data modeling, Tradeoff reasoning, Scalability & failure handling, Communication of complexity",
  hr: "Motivation & fit, Values & self-awareness, Situational judgment, Communication, Authenticity",
};

const REPORT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    overallScore: {
      type: Type.INTEGER,
      description: "Overall performance, 0-100.",
    },
    summary: {
      type: Type.STRING,
      description:
        "2-3 sentence honest summary of how the interview went overall.",
    },
    dimensions: {
      type: Type.ARRAY,
      description: "3-5 scored dimensions relevant to this interview type.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          score: { type: Type.INTEGER, description: "0-100" },
          comment: {
            type: Type.STRING,
            description: "1-2 sentences justifying the score with specifics.",
          },
        },
        required: ["name", "score", "comment"],
      },
    },
    strengths: {
      type: Type.ARRAY,
      description: "2-4 genuine strengths, each anchored to what they said.",
      items: {
        type: Type.OBJECT,
        properties: {
          point: { type: Type.STRING },
          quote: {
            type: Type.STRING,
            description:
              "A short VERBATIM quote of what the candidate actually said that shows this strength. Empty string if none fits.",
          },
        },
        required: ["point", "quote"],
      },
    },
    improvements: {
      type: Type.ARRAY,
      description: "2-4 concrete areas to improve.",
      items: {
        type: Type.OBJECT,
        properties: {
          point: { type: Type.STRING },
          quote: {
            type: Type.STRING,
            description:
              "A short VERBATIM quote showing the weakness (e.g. a vague answer). Empty string if none fits.",
          },
          suggestion: {
            type: Type.STRING,
            description: "A specific, actionable suggestion.",
          },
        },
        required: ["point", "quote", "suggestion"],
      },
    },
  },
  required: ["overallScore", "summary", "dimensions", "strengths", "improvements"],
};

function transcriptToText(
  messages: ChatMessage[],
  interviewer: string,
  candidate: string,
): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map(
      (m) =>
        `${m.role === "assistant" ? interviewer : candidate}: ${m.content}`,
    )
    .join("\n");
}

// Coerce whatever the model returns (possibly partial if truncated) into a
// fully-valid report. Guarantees non-null scalars and real arrays so the DB
// write and the client render can never fail on a malformed field.
function clampScore(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function normalizeReport(raw: unknown): InterviewReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  const asArr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    overallScore: clampScore(r.overallScore),
    summary: str(
      r.summary,
      "Not enough conversation took place to produce a full summary.",
    ),
    dimensions: asArr(r.dimensions).map((d: any) => ({
      name: str(d?.name, "Dimension"),
      score: clampScore(d?.score),
      comment: str(d?.comment),
    })),
    strengths: asArr(r.strengths)
      .map((s: any) => ({ point: str(s?.point), quote: str(s?.quote) }))
      .filter((s) => s.point),
    improvements: asArr(r.improvements)
      .map((s: any) => ({
        point: str(s?.point),
        quote: str(s?.quote),
        suggestion: str(s?.suggestion),
      }))
      .filter((s) => s.point),
  };
}

export async function generateReport(
  type: InterviewType,
  profile: CandidateProfile,
  transcript: ChatMessage[],
): Promise<InterviewReport> {
  const persona = PERSONAS[type];
  const convo = transcriptToText(transcript, persona.interviewer, profile.name);

  const system = `You are an expert interview coach writing a candid, useful feedback report for a ${persona.label} mock interview.
The candidate is ${profile.name}, targeting a ${profile.experienceLevel}-level ${profile.role} role.
This interview tested: ${persona.focus}
Score against dimensions like: ${DIMENSION_HINTS[type]}.

Be honest and specific — this is practice, so real feedback helps more than praise. Ground every strength and weakness in what the candidate ACTUALLY said, quoting them verbatim where possible. Calibrate scores to their stated experience level. Respond with JSON matching the required schema.`;

  const userText = `Here is the full interview transcript:\n\n${convo || "(The candidate ended the interview before answering substantively.)"}\n\nWrite the feedback report.`;

  // The report must never fail just because the flagship model is busy or
  // quota-exhausted (503/429). Walk the full model chain; only throw if every
  // model fails — the /finish route then returns a retryable 500 instead of
  // persisting a junk report.
  const candidates = [
    ...new Set([MODELS.report, MODELS.turn, MODELS.turnFallback]),
  ];
  let lastError: unknown;

  for (const model of candidates) {
    try {
      const response = await genai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userText }] }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseSchema: REPORT_SCHEMA,
          maxOutputTokens: 4096,
        },
      });
      // normalizeReport tolerates truncated/malformed JSON, always returning a
      // valid, persistable object.
      let raw: unknown = null;
      try {
        raw = JSON.parse(response.text ?? "");
      } catch {
        console.error(`[report] ${model} returned non-JSON output; normalizing`);
      }
      return normalizeReport(raw);
    } catch (err) {
      lastError = err;
      console.error(
        `[report] ${model} failed (${(err as Error)?.message?.slice(0, 120)}); trying next model`,
      );
    }
  }
  throw lastError;
}

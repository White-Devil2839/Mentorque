import { Router } from "express";
import type { Prisma } from "../generated/prisma/client.js";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireAuth } from "../auth/middleware.js";
import { signInterviewToken, verifyInterviewToken } from "../auth/jwt.js";
import {
  INTERVIEW_TYPES,
  initialRunningState,
  type CandidateProfile,
  type ChatMessage,
  type InterviewType,
  type RunningState,
} from "../types.js";
import { generateOpening, runInterviewTurn } from "./engine.js";
import { generateReport } from "./report.js";
import { buildVapiAssistant } from "./vapi.js";

export const interviewRouter = Router();

const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

// Coerce a Vapi/OpenAI message into our simple {role, content} shape.
function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw) {
    const role = m?.role;
    if (role !== "user" && role !== "assistant") continue;
    let content = "";
    if (typeof m.content === "string") content = m.content;
    else if (Array.isArray(m.content)) {
      content = m.content.map((c: any) => c?.text ?? "").join(" ").trim();
    }
    if (content) out.push({ role, content });
  }
  return out;
}

// ── Start an interview ───────────────────────────────────────────────────
const startSchema = z.object({ type: z.enum(INTERVIEW_TYPES) });

interviewRouter.post("/start", requireAuth, async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid interview type" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const profile: CandidateProfile = {
    name: user.name,
    role: user.role,
    experienceLevel: user.experienceLevel as CandidateProfile["experienceLevel"],
  };
  const type = parsed.data.type;

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      type,
      status: "active",
      // The generated opening IS the first primary question, so seed the count
      // at 1 to keep the total capped at MAX_PRIMARY_QUESTIONS.
      state: asJson({ ...initialRunningState(), questionCount: 1 }),
      transcript: asJson([]),
    },
  });

  // Generated (not templated) opening line — spoken by Vapi first.
  const opening = await generateOpening(type, profile);
  await prisma.session.update({
    where: { id: session.id },
    data: { transcript: asJson([{ role: "assistant", content: opening }]) },
  });

  const interviewToken = signInterviewToken({ sid: session.id, uid: user.id });
  const assistant = buildVapiAssistant({ interviewToken, opening, type });

  return res.status(201).json({
    sessionId: session.id,
    assistant,
    vapiPublicKey: env.VITE_VAPI_PUBLIC_KEY,
  });
});

// ── Vapi custom-LLM webhook (OpenAI-compatible streaming) ──────────────────
// Public, but authenticated by the signed token in the URL path.
interviewRouter.post("/webhook/:token/chat/completions", async (req, res) => {
  let sid: string;
  try {
    ({ sid } = verifyInterviewToken(req.params.token));
  } catch {
    return res.status(401).json({ error: "Invalid interview token" });
  }

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });

  const model = req.body?.model ?? "mentorque-interviewer";
  const id = `chatcmpl-${session.id}-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (delta: object, finish: string | null = null) => {
    res.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    );
  };

  try {
    send({ role: "assistant", content: "" });

    // If the interview is already wrapped up, don't re-run the engine.
    if (session.status === "completed") {
      send({ content: "Thanks — that's a wrap on the interview." });
      send({}, "stop");
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    const incoming = normalizeMessages(req.body?.messages);
    const profile: CandidateProfile = {
      name: session.user.name,
      role: session.user.role,
      experienceLevel:
        session.user.experienceLevel as CandidateProfile["experienceLevel"],
    };
    const running: RunningState = {
      ...initialRunningState(),
      ...((session.state as unknown as RunningState) ?? {}),
    };

    // The server-stored transcript is authoritative: it holds the exact
    // engine-authored questions (incl. the opening), not Vapi's STT echoes.
    // From Vapi we only take the candidate's latest spoken answer.
    const stored = (session.transcript as unknown as ChatMessage[]) ?? [];
    const incomingUserCount = incoming.filter((m) => m.role === "user").length;
    const isNewAnswer = incomingUserCount > running.evaluatedUpTo;
    const latestAnswer =
      [...incoming].reverse().find((m) => m.role === "user")?.content ?? "";

    // Feed the engine the authoritative history + the new answer.
    const engineMessages: ChatMessage[] =
      isNewAnswer && latestAnswer
        ? [...stored, { role: "user", content: latestAnswer }]
        : stored;

    const result = await runInterviewTurn({
      type: session.type as InterviewType,
      profile,
      messages: engineMessages,
      running,
      isNewAnswer,
      newAnswerCount: incomingUserCount,
      onToken: (delta) => send({ content: delta }),
    });

    send({}, "stop");
    res.write("data: [DONE]\n\n");
    res.end();

    // Persist authoritative transcript + running state after the stream so
    // voice latency isn't affected.
    const newTranscript: ChatMessage[] =
      isNewAnswer && latestAnswer
        ? [
            ...stored,
            { role: "user", content: latestAnswer },
            { role: "assistant", content: result.reply },
          ]
        : [...stored, { role: "assistant", content: result.reply }];

    await prisma.session.update({
      where: { id: session.id },
      data: {
        transcript: asJson(newTranscript),
        state: asJson(result.running),
        // When the engine decides to close, end the session server-side so
        // further utterances short-circuit (no extra engine cost / no score
        // corruption) instead of re-running the loop.
        ...(result.shouldEndCall
          ? { status: "completed", endedAt: new Date() }
          : {}),
      },
    });
  } catch (err) {
    console.error("[webhook] turn failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Interview engine error" });
    } else {
      // Stream already started — degrade gracefully so the call doesn't hang.
      send({ content: " Sorry, could you say that again?" });
      send({}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

// ── Finish + generate report ───────────────────────────────────────────────
const finishSchema = z.object({
  transcript: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .optional(),
});

interviewRouter.post("/:sessionId/finish", requireAuth, async (req, res) => {
  const session = await prisma.session.findFirst({
    where: { id: req.params.sessionId, userId: req.userId },
    include: { user: true, report: true },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status === "completed" && session.report) {
    return res.json({ report: session.report });
  }

  const profile: CandidateProfile = {
    name: session.user.name,
    role: session.user.role,
    experienceLevel:
      session.user.experienceLevel as CandidateProfile["experienceLevel"],
  };

  // Prefer the server-side transcript; fall back to the client's if richer.
  const serverTranscript = (session.transcript as unknown as ChatMessage[]) ?? [];
  const parsed = finishSchema.safeParse(req.body);
  const clientTranscript = parsed.success
    ? normalizeMessages(parsed.data.transcript)
    : [];
  const transcript =
    serverTranscript.filter((m) => m.role === "user").length >=
    clientTranscript.filter((m) => m.role === "user").length
      ? serverTranscript
      : clientTranscript;

  try {
    // generateReport always returns a fully-normalized, schema-valid object,
    // so these writes can't be poisoned by a partial LLM response.
    const report = await generateReport(
      session.type as InterviewType,
      profile,
      transcript,
    );

    const data = {
      overallScore: report.overallScore,
      summary: report.summary,
      dimensions: asJson(report.dimensions),
      strengths: asJson(report.strengths),
      improvements: asJson(report.improvements),
    };
    const saved = await prisma.report.upsert({
      where: { sessionId: session.id },
      create: { sessionId: session.id, ...data },
      update: data,
    });
    await prisma.session.update({
      where: { id: session.id },
      data: { status: "completed", endedAt: new Date() },
    });

    return res.json({ report: saved });
  } catch (err) {
    console.error("[finish] report generation failed:", err);
    return res
      .status(500)
      .json({ error: "Could not generate the feedback report. Please retry." });
  }
});

// ── History ────────────────────────────────────────────────────────────────
interviewRouter.get("/sessions", requireAuth, async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    include: { report: { select: { overallScore: true } } },
  });
  return res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      type: s.type,
      status: s.status,
      createdAt: s.createdAt,
      endedAt: s.endedAt,
      overallScore: s.report?.overallScore ?? null,
    })),
  });
});

interviewRouter.get("/sessions/:id", requireAuth, async (req, res) => {
  const session = await prisma.session.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { report: true },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });
  return res.json({
    session: {
      id: session.id,
      type: session.type,
      status: session.status,
      createdAt: session.createdAt,
      endedAt: session.endedAt,
      transcript: session.transcript,
      report: session.report,
    },
  });
});

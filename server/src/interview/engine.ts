import {
  Annotation,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import type {
  CandidateProfile,
  ChatMessage,
  Directive,
  InterviewType,
  RunningState,
} from "../types.js";
import {
  buildMergedTurnDirective,
  buildStableSystem,
  buildTurnDirective,
  PERSONAS,
} from "./persona.js";
import {
  completeOnce,
  streamMergedTurn,
  streamTurn,
  type EvaluationResult,
} from "./llm.js";

// Interview shape knobs (tuned for a ~10-15 minute session).
const MAX_PRIMARY_QUESTIONS = 6; // hard cap on distinct areas
const COVERAGE_TARGET = 6; // close once this many areas are covered
const MAX_FOLLOWUPS_PER_TOPIC = 2; // don't grill forever on one topic

// ── Graph state ────────────────────────────────────────────────────────────
const InterviewState = Annotation.Root({
  stableSystem: Annotation<string>(),
  messages: Annotation<ChatMessage[]>(),
  running: Annotation<RunningState>(),
  // Idempotency: is the latest candidate answer one we haven't scored yet?
  isNewAnswer: Annotation<boolean>(),
  newAnswerCount: Annotation<number>(),
  evaluation: Annotation<EvaluationResult | null>(),
  directive: Annotation<Directive>(),
  reply: Annotation<string>(),
  shouldEndCall: Annotation<boolean>(),
});
type State = typeof InterviewState.State;

// ── turn node: ONE streamed Gemini call evaluates the last answer AND speaks ──
// the next line (see llm.streamMergedTurn). The directive comes back with it;
// code only enforces the hard budgets the model can't be trusted with.
async function turnNode(
  state: State,
  config: RunnableConfig,
): Promise<Partial<State>> {
  const onToken =
    (config.configurable?.onToken as ((d: string) => void) | undefined) ??
    (() => {});

  const forcedClose =
    state.running.questionCount >= MAX_PRIMARY_QUESTIONS ||
    state.running.coverage.length >= COVERAGE_TARGET;
  const canProbe = state.running.followupsOnTopic < MAX_FOLLOWUPS_PER_TOPIC;

  // Duplicate webhook (e.g. Vapi retry of an already-scored answer):
  // regenerate speech only — no evaluation, no counter movement downstream.
  if (!state.isNewAnswer) {
    const directive: Directive = forcedClose ? "close" : "advance";
    const reply = await streamTurn(
      state.stableSystem,
      buildTurnDirective(
        directive,
        state.running,
        state.running.runningScores.at(-1)?.note ?? "",
      ),
      state.messages,
      onToken,
    );
    return { reply, evaluation: null, directive };
  }

  const merged = await streamMergedTurn(
    state.stableSystem,
    buildMergedTurnDirective(
      forcedClose ? "close" : "explore",
      canProbe,
      state.running,
    ),
    state.messages,
    onToken,
  );

  // Clamp the model's declared action to the code-enforced budgets: close is
  // decided purely by the caps, and probing past the follow-up budget counts
  // as an advance so the bookkeeping stays sane.
  const directive: Directive = forcedClose
    ? "close"
    : merged.nextAction === "probe" && canProbe
      ? "probe"
      : "advance";

  return { reply: merged.reply, evaluation: merged.evaluation, directive };
}

// ── Branch nodes: pure state transitions (adaptive branching lives here) ────
// Shared bookkeeping: record the score for the just-evaluated answer.
function withScore(state: State): RunningState {
  if (!state.evaluation || !state.isNewAnswer) return state.running;
  return {
    ...state.running,
    runningScores: [
      ...state.running.runningScores,
      {
        topic: state.evaluation.topic,
        score: state.evaluation.score,
        completeness: state.evaluation.completeness,
        note: state.evaluation.note,
      },
    ],
    evaluatedUpTo: state.newAnswerCount,
  };
}

// Weak answer → we dug deeper: spend one follow-up on the current topic.
function probeNode(state: State): Partial<State> {
  if (!state.evaluation || !state.isNewAnswer) return {};
  const running = withScore(state);
  return {
    running: { ...running, followupsOnTopic: running.followupsOnTopic + 1 },
  };
}

// Moving on: bank the covered topic, reset the follow-up budget, and ratchet
// difficulty up on strong answers / down on weak ones.
function advanceNode(state: State): Partial<State> {
  if (!state.evaluation || !state.isNewAnswer) return {};
  const running = withScore(state);
  const e = state.evaluation;
  let difficulty = running.difficulty;
  if (e.isStrong || e.score >= 7) difficulty = Math.min(5, difficulty + 1);
  else if (e.score <= 3) difficulty = Math.max(1, difficulty - 1);
  return {
    running: {
      ...running,
      questionCount: running.questionCount + 1,
      followupsOnTopic: 0,
      coverage: [...running.coverage, e.topic],
      difficulty,
    },
  };
}

// Coverage is sufficient: score the final answer and signal the wrap-up.
function closeNode(state: State): Partial<State> {
  return { running: withScore(state), shouldEndCall: true };
}

function routeAfterTurn(state: State): Directive {
  return state.directive;
}

const graph = new StateGraph(InterviewState)
  .addNode("turn", turnNode)
  .addNode("probe", probeNode)
  .addNode("advance", advanceNode)
  .addNode("close", closeNode)
  .addEdge(START, "turn")
  .addConditionalEdges("turn", routeAfterTurn, {
    probe: "probe",
    advance: "advance",
    close: "close",
  })
  .addEdge("probe", END)
  .addEdge("advance", END)
  .addEdge("close", END);

const interviewGraph = graph.compile();

// ── Public API ───────────────────────────────────────────────────────────
export interface TurnInput {
  type: InterviewType;
  profile: CandidateProfile;
  messages: ChatMessage[];
  running: RunningState;
  // Whether the latest candidate answer is new (vs. a duplicate webhook).
  isNewAnswer: boolean;
  // Total candidate answers seen this turn — becomes running.evaluatedUpTo.
  newAnswerCount: number;
  onToken: (delta: string) => void;
}

export interface TurnResult {
  reply: string;
  running: RunningState;
  shouldEndCall: boolean;
  directive: Directive;
}

// Run one interviewer turn through the graph: a single streamed call evaluates
// the last answer + speaks the next line, then the graph branches on the
// decision (probe / advance / close) to apply the matching state transition.
export async function runInterviewTurn(input: TurnInput): Promise<TurnResult> {
  const stableSystem = buildStableSystem(input.type, input.profile);

  // Edge case: no candidate answer yet — gently prompt without advancing state.
  const hasAnswer = input.messages.some((m) => m.role === "user");
  if (!hasAnswer) {
    const reply = "Whenever you're ready, go ahead.";
    input.onToken(reply);
    return {
      reply,
      running: input.running,
      shouldEndCall: false,
      directive: "probe",
    };
  }

  const result = await interviewGraph.invoke(
    {
      stableSystem,
      messages: input.messages,
      running: input.running,
      isNewAnswer: input.isNewAnswer,
      newAnswerCount: input.newAnswerCount,
      evaluation: null,
      directive: "advance",
      reply: "",
      shouldEndCall: false,
    },
    { configurable: { onToken: input.onToken } },
  );

  return {
    reply: result.reply,
    running: result.running,
    shouldEndCall: result.shouldEndCall,
    directive: result.directive,
  };
}

// The interviewer's opening line — generated (not templated) so it feels natural
// and personalized. Spoken by Vapi as the assistant's firstMessage.
export async function generateOpening(
  type: InterviewType,
  profile: CandidateProfile,
): Promise<string> {
  const stableSystem = buildStableSystem(type, profile);
  const persona = PERSONAS[type];
  const prompt = `Begin the interview now. Greet ${profile.name} by name, introduce yourself as ${persona.interviewer}, say in one line what this ${persona.label} interview will cover, and ask your FIRST question. Keep it to 2-3 short sentences, warm and natural for speech. Just the spoken words — nothing else.`;
  return completeOnce(stableSystem, prompt, 200);
}

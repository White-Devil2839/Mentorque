// Shared domain types for the interview engine and API.

export const INTERVIEW_TYPES = [
  "behavioral",
  "technical",
  "system_design",
  "hr",
] as const;

export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const EXPERIENCE_LEVELS = ["junior", "mid", "senior"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export interface CandidateProfile {
  name: string;
  role: string;
  experienceLevel: ExperienceLevel;
}

// A single scored answer, produced by the `evaluate` node.
export interface AnswerScore {
  topic: string; // short label for what was being asked
  score: number; // 0-10 quality of the answer
  completeness: number; // 0-10 how complete / specific it was
  note: string; // one-line rationale (used later in the report)
}

// State carried across turns, persisted on Session.state as JSON.
export interface RunningState {
  coverage: string[]; // topics already explored
  runningScores: AnswerScore[]; // one per evaluated candidate answer
  difficulty: number; // 1 (easy) .. 5 (hard); ratchets up on strong answers
  questionCount: number; // number of primary questions asked
  followupsOnTopic: number; // consecutive follow-ups on the current topic
  evaluatedUpTo: number; // # of candidate (user) messages already scored
}

export function initialRunningState(): RunningState {
  return {
    coverage: [],
    runningScores: [],
    difficulty: 2,
    questionCount: 0,
    followupsOnTopic: 0,
    evaluatedUpTo: 0,
  };
}

// OpenAI-style chat message (the shape Vapi sends to a custom-LLM endpoint).
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

// The interviewer's decision for the current turn — drives graph branching.
export type Directive = "probe" | "advance" | "close";

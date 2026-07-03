export type InterviewType =
  | "behavioral"
  | "technical"
  | "system_design"
  | "hr";

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  experienceLevel: "junior" | "mid" | "senior";
}

export interface SessionSummary {
  id: string;
  type: InterviewType;
  status: "active" | "completed";
  createdAt: string;
  endedAt: string | null;
  overallScore: number | null;
}

export interface TranscriptTurn {
  role: "assistant" | "user";
  content: string;
}

export interface Report {
  overallScore: number;
  summary: string;
  dimensions: { name: string; score: number; comment: string }[];
  strengths: { point: string; quote: string }[];
  improvements: { point: string; quote: string; suggestion: string }[];
}

export const INTERVIEW_META: Record<
  InterviewType,
  { label: string; blurb: string; interviewer: string }
> = {
  behavioral: {
    label: "Behavioral",
    blurb: "Communication, STAR structure, self-awareness.",
    interviewer: "Maya",
  },
  technical: {
    label: "Technical",
    blurb: "Depth of knowledge and problem-solving approach.",
    interviewer: "Sam",
  },
  system_design: {
    label: "System Design",
    blurb: "Architecture, tradeoffs, communicating complexity.",
    interviewer: "Priya",
  },
  hr: {
    label: "HR / Culture Fit",
    blurb: "Motivation, values, situational judgment.",
    interviewer: "Alex",
  },
};

import jwt from "jsonwebtoken";
import { env } from "../env.js";

const ALGS: jwt.Algorithm[] = ["HS256"];

// Auth tokens identify a logged-in user (Authorization: Bearer <token>).
export interface AuthClaims {
  sub: string; // user id
  email: string;
}

export function signAuthToken(claims: AuthClaims): string {
  return jwt.sign({ ...claims, kind: "auth" }, env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function verifyAuthToken(token: string): AuthClaims {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ALGS,
  }) as jwt.JwtPayload;
  // Reject interview tokens (or anything without a user subject) presented as
  // auth tokens — both kinds are signed with the same secret.
  if (payload.kind !== "auth" || typeof payload.sub !== "string") {
    throw new Error("Not an auth token");
  }
  return { sub: payload.sub, email: String(payload.email ?? "") };
}

// Interview tokens are embedded in the Vapi custom-LLM webhook URL so the
// stateless webhook can authenticate + resolve which session it belongs to,
// without trusting a client-supplied session id. Deliberately a DIFFERENT kind
// than auth tokens so one can never be used in place of the other.
export interface InterviewClaims {
  sid: string; // session id
  uid: string; // user id
}

export function signInterviewToken(claims: InterviewClaims): string {
  return jwt.sign({ ...claims, kind: "interview" }, env.JWT_SECRET, {
    expiresIn: "2h",
  });
}

export function verifyInterviewToken(token: string): InterviewClaims {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ALGS,
  }) as jwt.JwtPayload;
  if (payload.kind !== "interview" || typeof payload.sid !== "string") {
    throw new Error("Not an interview token");
  }
  return { sid: payload.sid, uid: String(payload.uid ?? "") };
}

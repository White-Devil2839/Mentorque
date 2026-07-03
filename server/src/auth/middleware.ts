import type { NextFunction, Request, Response } from "express";
import { verifyAuthToken } from "./jwt.js";

// Augment Express Request with the authenticated user id.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const claims = verifyAuthToken(token);
    // Guard against a token that verifies but carries no user subject — never
    // let req.userId be undefined, or Prisma would silently drop ownership
    // filters (`where: { userId: undefined }` matches everything).
    if (!claims.sub) {
      return res.status(401).json({ error: "Invalid token" });
    }
    req.userId = claims.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

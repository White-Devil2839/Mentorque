import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { EXPERIENCE_LEVELS } from "../types.js";
import { requireAuth } from "./middleware.js";
import { signAuthToken } from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1),
  role: z.string().min(1),
  experienceLevel: z.enum(EXPERIENCE_LEVELS),
});

function publicUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  experienceLevel: string;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    experienceLevel: u.experienceLevel,
  };
}

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password, name, role, experienceLevel } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      name,
      role,
      experienceLevel,
    },
  });

  const token = signAuthToken({ sub: user.id, email: user.email });
  return res.status(201).json({ token, user: publicUser(user) });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid credentials" });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signAuthToken({ sub: user.id, email: user.email });
  return res.json({ token, user: publicUser(user) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: publicUser(user) });
});

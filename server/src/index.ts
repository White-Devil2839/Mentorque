import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { authRouter } from "./auth/routes.js";
import { interviewRouter } from "./interview/routes.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/interview", interviewRouter);

app.listen(env.PORT, () => {
  console.log(`🎙️  Mentorque API listening on http://localhost:${env.PORT}`);
  console.log(`   Vapi webhook base: ${env.PUBLIC_SERVER_URL}/api/interview/webhook/:token`);
});

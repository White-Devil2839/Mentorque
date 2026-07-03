import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Workspace scripts run with cwd = server/, but the single source-of-truth
// .env lives at the repo root. Load root first, then any local override.
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

// On Render, the platform provides the service's public URL — use it as the
// Vapi webhook base automatically so no manual PUBLIC_SERVER_URL is needed.
if (!process.env.PUBLIC_SERVER_URL && process.env.RENDER_EXTERNAL_URL) {
  process.env.PUBLIC_SERVER_URL = process.env.RENDER_EXTERNAL_URL;
}

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  // Free key from https://aistudio.google.com/apikey — powers the interview
  // engine and the feedback report.
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  // Model tiers (see COST.md). Overridable without code changes. The turn
  // model both speaks and scores (merged call); the report model runs once.
  // The fallback takes over when the turn model hits its free-tier quota —
  // each model has its own quota bucket, so failover restores service.
  GEMINI_TURN_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_TURN_FALLBACK_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_REPORT_MODEL: z.string().default("gemini-3.5-flash"),
  // Public URL of this server, reachable by Vapi's cloud (ngrok locally).
  PUBLIC_SERVER_URL: z.string().url("PUBLIC_SERVER_URL must be a valid URL"),
  VITE_VAPI_PUBLIC_KEY: z.string().default(""),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\nCopy .env.example to .env and fill in the values.");
  process.exit(1);
}

export const env = parsed.data;

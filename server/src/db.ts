import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { env } from "./env.js";

// Prisma 7: direct Postgres connections go through the pg driver adapter; the
// connection URL is no longer read from the schema file.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

// Single shared Prisma client for the process.
export const prisma = new PrismaClient({ adapter });

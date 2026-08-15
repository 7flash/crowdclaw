import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database, z } from "sqlite-zod-orm";

const MilestoneSchema = z.object({
  t: z.string(),
  c: z.number().int(),
});

const GameSchema = z.object({
  gameId: z.string(),
  name: z.string(),
  prompt: z.string(),
  summary: z.string(),
  miles: z.array(MilestoneSchema).default([]),
  done: z.number().int().default(0),
  pool: z.number().default(0),
  spent: z.number().default(0),
  creator: z.string(),
  at: z.number().int(),
});

const VersionSchema = z.object({
  gameId: z.string(),
  n: z.number().int(),
  code: z.string(),
  at: z.number().int(),
  by: z.string(),
});

const rawPath = process.env.DATABASE_PATH || "./data/crowdclaw.sqlite";
const dbPath = rawPath === ":memory:" ? rawPath : resolve(rawPath);
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath, {
  games: GameSchema,
  versions: VersionSchema,
});

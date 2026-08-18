import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database as BunSqlite } from "bun:sqlite";
import { databasePath } from "./config";
import { databaseWrite } from "./db/database";
import { log } from "./log";

export type NotificationPayload = Record<string, unknown>;

export type NotificationEvent = {
  cursor: string;
  id: string;
  type: string;
  projectId: string;
  createdAt: number;
  payload: NotificationPayload;
};

type NotificationRow = {
  seq: number;
  eventId: string;
  type: string;
  projectId: string;
  payload: string;
  createdAt: number;
};

const rawPath = databasePath();
const path = rawPath === ":memory:" ? rawPath : resolve(rawPath);
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
const feedDb = new BunSqlite(path, { create: true });
feedDb.exec("PRAGMA busy_timeout=5000;");
databaseWrite(() =>
  feedDb.exec(`
  CREATE TABLE IF NOT EXISTS notification_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    eventId TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    projectId TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notification_events_project_seq
    ON notification_events(projectId, seq);
  CREATE INDEX IF NOT EXISTS notification_events_type_seq
    ON notification_events(type, seq);
`),
);

function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isNotificationFeedRequest(request: Request): boolean {
  const configured = String(process.env.CROWDCLAW_EVENTS_TOKEN || "").trim();
  if (!configured) return true;
  const auth = String(request.headers.get("authorization") || "").trim();
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const header = String(
    request.headers.get("x-crowdclaw-events-token") || "",
  ).trim();
  const supplied = bearer || header;
  return Boolean(supplied) && secureEqual(supplied, configured);
}

export function publishNotification(
  type: string,
  projectId: string,
  payload: NotificationPayload = {},
): void {
  try {
    databaseWrite(() =>
      feedDb
        .query(
          `INSERT INTO notification_events(eventId, type, projectId, payload, createdAt)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          `n_${randomUUID()}`,
          type.slice(0, 100),
          projectId.slice(0, 120),
          JSON.stringify(payload),
          Date.now(),
        ),
    );
  } catch (error) {
    // Notification delivery must never make the build/funding transaction fail.
    // WAL + busy_timeout make this exceptional, but keep it observable.
    log("warn", "notification.write_failed", { type, projectId, error });
  }
}

export function latestNotificationCursor(): number {
  const row = feedDb
    .query("SELECT COALESCE(MAX(seq), 0) AS seq FROM notification_events")
    .get() as { seq?: number } | null;
  return Math.max(0, Number(row?.seq || 0));
}

export function readNotificationsAfter(input: {
  cursor: number;
  limit: number;
  projectId?: string;
  types?: string[];
}): NotificationEvent[] {
  const clauses = ["seq > ?"];
  const args: Array<string | number> = [Math.max(0, Math.floor(input.cursor))];
  if (input.projectId) {
    clauses.push("projectId = ?");
    args.push(input.projectId);
  }
  const types = (input.types || []).filter(Boolean).slice(0, 20);
  if (types.length) {
    clauses.push(`type IN (${types.map(() => "?").join(",")})`);
    args.push(...types);
  }
  args.push(Math.max(1, Math.min(100, Math.floor(input.limit))));
  const rows = feedDb
    .query(
      `SELECT seq, eventId, type, projectId, payload, createdAt
       FROM notification_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY seq ASC
       LIMIT ?`,
    )
    .all(...args) as NotificationRow[];

  return rows.map((row) => {
    let payload: NotificationPayload = {};
    try {
      const parsed = JSON.parse(row.payload || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        payload = parsed as NotificationPayload;
    } catch {}
    return {
      cursor: String(row.seq),
      id: row.eventId,
      type: row.type,
      projectId: row.projectId,
      createdAt: Number(row.createdAt || 0),
      payload,
    };
  });
}

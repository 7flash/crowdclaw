import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { databasePath } from "../config";
import { errorMessage, log } from "../log";

/**
 * Admin STOP is an operator control, not a project lifecycle state. Persist it
 * beside the CrowdClaw database so a web-server/keeper restart does not silently
 * resurrect an agent that an operator intentionally paused.
 *
 * Only the web process writes this tiny control file. Agent workers never touch it,
 * so this does not add another cross-process lock to the project database path.
 */
function controlPath(): string {
  const configured = databasePath();
  const dataDir =
    configured === ":memory:"
      ? resolve("./data")
      : dirname(resolve(configured));
  return resolve(dataDir, "admin-paused-agents.json");
}

type PauseFile = { version: 1; projects: string[] };
let loaded = false;
let paused = new Set<string>();

function load(): Set<string> {
  if (loaded) return paused;
  loaded = true;
  const path = controlPath();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PauseFile>;
    paused = new Set(
      Array.isArray(parsed.projects)
        ? parsed.projects.filter(
            (value): value is string =>
              typeof value === "string" &&
              /^p_[a-z0-9]+_[a-z0-9]+$/i.test(value),
          )
        : [],
    );
  } catch (error) {
    const message = errorMessage(error);
    if (!/ENOENT|no such file/i.test(message))
      log("warn", "agent.admin.pause_store_read_failed", {
        path,
        error: message,
      });
  }
  return paused;
}

function persist(): void {
  const path = controlPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body: PauseFile = {
    version: 1,
    projects: [...load()].sort(),
  };
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function isProjectAdminPaused(projectId: string): boolean {
  return load().has(projectId);
}

export function setProjectAdminPaused(projectId: string, value: boolean): void {
  const set = load();
  const changed = value ? !set.has(projectId) : set.has(projectId);
  if (!changed) return;
  if (value) set.add(projectId);
  else set.delete(projectId);
  persist();
  log(
    "info",
    value ? "agent.admin.pause_persisted" : "agent.admin.pause_cleared",
    {
      projectId,
      path: controlPath(),
    },
  );
}

export function adminPausedProjectIds(): Set<string> {
  return new Set(load());
}

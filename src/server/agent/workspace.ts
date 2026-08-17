import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { databasePath } from "../config";

const MAX_FILE_CHARS = 300_000;
const MAX_WORKSPACE_CHARS = 600_000;

function workspaceBase(): string {
  const configured = process.env.WORKSPACE_ROOT?.trim();
  if (configured) return resolve(configured);
  const db = databasePath();
  if (db === ":memory:") return resolve("./data/workspaces");
  return resolve(dirname(resolve(db)), "workspaces");
}

export function workspaceRoot(projectId: string): string {
  const root = resolve(workspaceBase(), projectId);
  mkdirSync(root, { recursive: true });
  return root;
}

export function safeWorkspacePath(
  projectId: string,
  relativePath: string,
): string {
  const root = workspaceRoot(projectId);
  const cleaned = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0"))
    throw new Error("invalid project-relative path");
  const full = resolve(root, cleaned);
  const rel = relative(root, full);
  if (
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return full;
}

export function listWorkspaceFiles(
  projectId: string,
  dir = workspaceRoot(projectId),
): string[] {
  const root = workspaceRoot(projectId);
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = resolve(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) result.push(...listWorkspaceFiles(projectId, full));
    else if (info.isFile())
      result.push(relative(root, full).replaceAll("\\", "/"));
  }
  return result.sort();
}

export function readWorkspaceFile(
  projectId: string,
  relativePath: string,
): string {
  const full = safeWorkspacePath(projectId, relativePath);
  if (!existsSync(full))
    throw new Error(`File does not exist: ${relativePath}`);
  const info = statSync(full);
  if (!info.isFile()) throw new Error(`Not a file: ${relativePath}`);
  if (info.size > MAX_FILE_CHARS * 4)
    throw new Error(`File is too large to read: ${relativePath}`);
  return readFileSync(full, "utf8");
}

export function writeWorkspaceFile(
  projectId: string,
  relativePath: string,
  content: string,
): void {
  if (content.length > MAX_FILE_CHARS)
    throw new Error(
      `File exceeds ${MAX_FILE_CHARS} characters: ${relativePath}`,
    );
  const root = workspaceRoot(projectId);
  const full = safeWorkspacePath(projectId, relativePath);
  const targetRel = relative(root, full).replaceAll("\\", "/");
  const existingChars = listWorkspaceFiles(projectId).reduce((sum, file) => {
    if (file === targetRel) return sum;
    try {
      return sum + readWorkspaceFile(projectId, file).length;
    } catch {
      return sum;
    }
  }, 0);
  if (existingChars + content.length > MAX_WORKSPACE_CHARS)
    throw new Error(`Workspace exceeds ${MAX_WORKSPACE_CHARS} characters`);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

export function ensureWorkspaceIndex(
  projectId: string,
  previousHtml?: string,
): void {
  const index = safeWorkspacePath(projectId, "index.html");
  if (!existsSync(index) && previousHtml)
    writeWorkspaceFile(projectId, "index.html", previousHtml);
}

export function readWorkspaceIndex(projectId: string): string {
  return readWorkspaceFile(projectId, "index.html");
}

export function ensureWorkspaceGameSource(
  projectId: string,
  previousSource?: string,
): void {
  const game = safeWorkspacePath(projectId, "game.tsx");
  if (!existsSync(game) && previousSource)
    writeWorkspaceFile(projectId, "game.tsx", previousSource);
}

export function readWorkspaceGameSource(projectId: string): string {
  return readWorkspaceFile(projectId, "game.tsx");
}

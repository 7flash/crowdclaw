import { platform } from "node:os";

export type AgentProcessIdentity = {
  verified: boolean;
  commandLine: string;
  reason: string;
};

async function commandLineForPid(pid: number): Promise<string> {
  if (!Number.isFinite(pid) || pid <= 0) return "";

  if (platform() === "linux") {
    try {
      const raw = await Bun.file(`/proc/${pid}/cmdline`).text();
      return raw.replace(/\0/g, " ").replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }

  const command =
    platform() === "win32"
      ? [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${Math.floor(pid)}\").CommandLine`,
        ]
      : ["ps", "-p", String(Math.floor(pid)), "-o", "command="];

  try {
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    if (exitCode !== 0) return "";
    return stdout.replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function hasToken(commandLine: string, token: string): boolean {
  if (!token) return false;
  return commandLine.split(/\s+/).some((part) => {
    const clean = part.replace(/^["']|["']$/g, "");
    return (
      clean === token ||
      clean.endsWith(`/${token}`) ||
      clean.endsWith(`\\${token}`)
    );
  });
}

/**
 * Positive ownership check before CrowdClaw sends a signal to a PID obtained
 * from a persisted bgrun record. A live PID is not enough: PIDs can be reused.
 *
 * Current generations carry the unique bgrun process name as an argv token.
 * Older workers can only be verified by their CrowdClaw entrypoint + project id.
 */
export async function verifyAgentProcessIdentity(input: {
  pid: number;
  name: string;
  projectId: string;
  currentGeneration: boolean;
}): Promise<AgentProcessIdentity> {
  const commandLine = await commandLineForPid(input.pid);
  if (!commandLine) {
    return {
      verified: false,
      commandLine: "",
      reason: "command line unavailable",
    };
  }

  const crowdclawEntrypoint =
    /(?:^|[\\/\s])project-agent(?:-launch)?\.ts(?:\s|$)/i.test(commandLine);
  if (!crowdclawEntrypoint) {
    return {
      verified: false,
      commandLine,
      reason: "PID is not a CrowdClaw agent",
    };
  }
  if (!hasToken(commandLine, input.projectId)) {
    return {
      verified: false,
      commandLine,
      reason: "project id does not match PID",
    };
  }
  if (input.currentGeneration && !hasToken(commandLine, input.name)) {
    return {
      verified: false,
      commandLine,
      reason: "generation token does not match PID",
    };
  }

  return { verified: true, commandLine, reason: "verified" };
}

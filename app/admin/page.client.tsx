import { render } from "tradjs/client";
import {
  AdminView,
  type AdminAgent,
} from "../../src/client/components/AdminView";

export default function mount() {
  const root = document.getElementById("crowdclaw-admin");
  if (!root) return;

  let state = {
    agents: [] as AdminAgent[],
    registryCount: 0,
    selected: "",
    stdout: "",
    stderr: "",
    token: readToken(),
    error: "",
    busy: "",
  };
  let timer: ReturnType<typeof setInterval> | null = null;

  const headers = (): Record<string, string> =>
    state.token ? { "x-crowdclaw-admin-token": state.token } : {};

  const draw = () =>
    render(
      <AdminView
        agents={state.agents}
        registryCount={state.registryCount}
        selected={state.selected}
        stdout={state.stdout}
        stderr={state.stderr}
        token={state.token}
        error={state.error}
        busy={state.busy}
        onToken={(value) => {
          state.token = value;
          draw();
        }}
        onApplyToken={() => {
          writeToken(state.token);
          state.error = "";
          void refresh(true);
        }}
        onSelect={(name) => {
          state.selected = name;
          state.stdout = "";
          state.stderr = "";
          draw();
          void loadLogs();
        }}
        onRefresh={() => void refresh(true)}
        onStop={(name) => void action(name, "stop")}
        onRestart={(name) => void action(name, "restart")}
        onRefreshLogs={() => void loadLogs()}
      />,
      root,
    );

  const readResponse = async <T,>(response: Response): Promise<T> => {
    if (response.ok) return (await response.json()) as T;
    let message = `request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {}
    throw new Error(message);
  };

  const refresh = async (refreshLogs = false) => {
    try {
      const previous = state.agents.find(
        (item) => item.name === state.selected,
      );
      const body = await readResponse<{
        agents: AdminAgent[];
        registryCount: number;
      }>(
        await fetch("/api/admin/agents", {
          cache: "no-store",
          headers: headers(),
        }),
      );
      state.agents = body.agents;
      state.registryCount = Number(body.registryCount || body.agents.length);
      // A restart creates a fresh bgrun generation name. Preserve selection by
      // project so the detail pane follows the new generation automatically.
      if (previous) {
        const replacement = state.agents.find(
          (item) => item.projectId === previous.projectId,
        );
        state.selected = replacement?.name || "";
      } else if (
        state.selected &&
        !state.agents.some((item) => item.name === state.selected)
      ) {
        state.selected = "";
      }
      if (!state.selected && state.agents.length)
        state.selected = state.agents[0].name;
      state.error = "";
      draw();
      if (refreshLogs && state.selected) await loadLogs();
    } catch (error) {
      state.error =
        error instanceof Error ? error.message : "admin unavailable";
      draw();
    }
  };

  const loadLogs = async () => {
    if (!state.selected) return;
    const name = state.selected;
    try {
      const body = await readResponse<{
        logs: { stdout: string; stderr: string };
      }>(
        await fetch(
          `/api/admin/agents/${encodeURIComponent(name)}/logs?lines=180`,
          {
            cache: "no-store",
            headers: headers(),
          },
        ),
      );
      if (state.selected !== name) return;
      state.stdout = body.logs.stdout;
      state.stderr = body.logs.stderr;
      state.error = "";
      draw();
    } catch (error) {
      state.error = error instanceof Error ? error.message : "logs unavailable";
      draw();
    }
  };

  const action = async (name: string, action: "stop" | "restart") => {
    if (state.busy) return;
    state.busy = name;
    draw();
    try {
      const body = await readResponse<{
        ok: boolean;
        process?: { name?: string };
      }>(
        await fetch(`/api/admin/agents/${encodeURIComponent(name)}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers() },
          body: JSON.stringify({ action }),
        }),
      );
      if (action === "restart" && body.process?.name)
        state.selected = body.process.name;
      state.error = "";
      await refresh(true);
    } catch (error) {
      state.error =
        error instanceof Error ? error.message : "agent action failed";
    } finally {
      state.busy = "";
      draw();
    }
  };

  draw();
  void refresh(true);
  timer = setInterval(() => void refresh(false), 4000);
  addEventListener(
    "pagehide",
    () => {
      if (timer) clearInterval(timer);
    },
    { once: true },
  );
}

function readToken(): string {
  try {
    return sessionStorage.getItem("crowdclaw:admin-token") || "";
  } catch {
    return "";
  }
}

function writeToken(value: string): void {
  try {
    if (value) sessionStorage.setItem("crowdclaw:admin-token", value);
    else sessionStorage.removeItem("crowdclaw:admin-token");
  } catch {}
}

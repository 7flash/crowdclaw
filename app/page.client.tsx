import { render } from "tradjs/client";
import { App, type AppActions } from "../src/client/components/App";
import { initialState, type AppState, type Tab } from "../src/client/state";
import * as api from "../src/client/api";
import type { Game, StreamEvent } from "../src/shared/types";

const WALLET_KEY = "crowdclaw:me";

function wallet(): string {
  const existing = localStorage.getItem(WALLET_KEY);
  if (existing) return existing;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let value = "";
  for (let i = 0; i < 44; i += 1)
    value += chars[(Math.random() * chars.length) | 0];
  localStorage.setItem(WALLET_KEY, value);
  return value;
}

export default function mount() {
  const root = document.getElementById("crowdclaw-root");
  if (!root) return;

  let state: AppState = initialState(wallet());
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const patch = (next: Partial<AppState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    draw();
  };

  const suggestedAmount = (game: Game) => {
    const next = game.miles[game.done || 0];
    if (!next) return state.amount;
    const balance = Math.round((game.pool - game.spent) * 100) / 100;
    const gap = Math.max(0, next.c - balance);
    return String(gap > 0 ? gap : next.c);
  };

  const toast = (text: string) => {
    if (toastTimer) clearTimeout(toastTimer);
    patch({ toast: text });
    toastTimer = setTimeout(() => patch({ toast: null }), 1600);
  };

  const loadGames = async () => {
    try {
      const games = await api.listGames();
      patch({ games, loading: false });
    } catch (error) {
      patch({ loading: false, error: message(error) });
    }
  };

  const openById = async (id: string, showRefresh = false) => {
    if (showRefresh) patch({ refreshing: true });
    try {
      const bundle = await api.getGame(id);
      const versionsChanged = bundle.versions.length !== state.versions.length;
      const oldBalance = state.game
        ? Math.round((state.game.pool - state.game.spent) * 100) / 100
        : NaN;
      const newBalance =
        Math.round((bundle.game.pool - bundle.game.spent) * 100) / 100;
      const fundingStateChanged =
        !state.game ||
        state.game.done !== bundle.game.done ||
        oldBalance !== newBalance;
      patch({
        game: bundle.game,
        versions: bundle.versions,
        selectedVersion: versionsChanged ? null : state.selectedVersion,
        amount: fundingStateChanged
          ? suggestedAmount(bundle.game)
          : state.amount,
        refreshing: false,
      });
    } catch (error) {
      patch({ refreshing: false, error: message(error) });
    }
  };

  const consumePlan = async (prompt: string) => {
    patch({
      view: "plan",
      planPrompt: prompt,
      planText: "",
      planError: null,
      error: null,
    });
    window.scrollTo({ top: 0 });
    try {
      const response = await api.plan(prompt, state.wallet);
      let completed: Game | null = null;
      await api.readNdjson(response, (event: StreamEvent) => {
        if (event.type === "stream") patch({ planText: event.text });
        if (event.type === "complete") completed = event.game;
      });
      if (!completed) throw new Error("planning ended without a game");
      const game = completed as Game;
      state = {
        ...state,
        games: [
          game,
          ...state.games.filter((item) => item.id !== game.id),
        ].slice(0, 30),
        game,
        versions: [],
        amount: suggestedAmount(game),
        say: "",
        error: null,
        selectedVersion: null,
        tab: "play",
        view: "game",
      };
      draw();
      window.scrollTo({ top: 0 });
    } catch (error) {
      patch({ planError: message(error) });
    }
  };

  const actions: AppActions = {
    home() {
      patch({ view: "home", error: null, say: "" });
      window.scrollTo({ top: 0 });
      void loadGames();
    },
    setDraft(value) {
      state.draft = value;
      draw();
    },
    seed(value) {
      patch({ draft: value });
      queueMicrotask(() =>
        (root.querySelector("textarea") as HTMLTextAreaElement | null)?.focus(),
      );
    },
    start() {
      const prompt = state.draft.trim();
      if (prompt.length >= 10) void consumePlan(prompt);
    },
    retryPlan() {
      if (state.planPrompt) void consumePlan(state.planPrompt);
    },
    open(game) {
      patch({
        view: "game",
        game,
        versions: [],
        say: "",
        error: null,
        selectedVersion: null,
        tab: "play",
        amount: suggestedAmount(game),
      });
      window.scrollTo({ top: 0 });
      void openById(game.id);
    },
    setAmount(value) {
      state.amount = value;
      draw();
    },
    async fund() {
      if (!state.game || state.busy) return;
      const amount = Number.parseFloat(state.amount);
      if (!(amount > 0)) return;
      try {
        const game = await api.fund(state.game.id, amount, state.wallet);
        patch({ game, amount: suggestedAmount(game), error: null });
        toast(`+${amount} ◎`);
      } catch (error) {
        patch({ error: message(error) });
      }
    },
    async run() {
      if (!state.game || state.busy) return;
      const id = state.game.id;
      patch({
        busy: true,
        stream: "",
        say: "",
        error: null,
        selectedVersion: null,
      });
      try {
        const response = await api.run(id, state.wallet);
        await api.readNdjson(response, (event) => {
          if (event.type === "stream") patch({ stream: event.text });
          if (event.type === "say") patch({ say: event.text });
          if (event.type === "complete") {
            const versions = event.version
              ? [
                  ...state.versions.filter(
                    (version) => version.n !== event.version!.n,
                  ),
                  event.version,
                ]
                  .sort((a, b) => a.n - b.n)
                  .slice(-4)
              : state.versions;
            patch({
              game: event.game,
              versions,
              amount: suggestedAmount(event.game),
              selectedVersion: null,
            });
          }
        });
      } catch (error) {
        patch({ error: message(error), say: "" });
      } finally {
        patch({ busy: false, stream: "" });
      }
    },
    setTab(tab: Tab) {
      patch({ tab });
    },
    selectVersion(version) {
      patch({ selectedVersion: version, tab: "play" });
    },
  };

  const draw = () => render(<App state={state} actions={actions} />, root);

  draw();
  void loadGames();

  const poll = setInterval(() => {
    if (!disposed && state.view === "game" && state.game && !state.busy)
      void openById(state.game.id, true);
  }, 8000);

  return () => {
    disposed = true;
    clearInterval(poll);
    if (toastTimer) clearTimeout(toastTimer);
    render(null, root);
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "request failed";
}

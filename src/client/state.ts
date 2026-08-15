import type { Game, Version } from "../shared/types";

export type View = "home" | "plan" | "game";
export type Tab = "play" | "code";

export type AppState = {
  view: View;
  games: Game[];
  loading: boolean;
  draft: string;
  planPrompt: string;
  planText: string;
  planError: string | null;
  game: Game | null;
  versions: Version[];
  busy: boolean;
  stream: string;
  say: string;
  error: string | null;
  refreshing: boolean;
  amount: string;
  tab: Tab;
  selectedVersion: number | null;
  wallet: string;
  toast: string | null;
};

export function initialState(wallet: string): AppState {
  return {
    view: "home",
    games: [],
    loading: true,
    draft: "",
    planPrompt: "",
    planText: "",
    planError: null,
    game: null,
    versions: [],
    busy: false,
    stream: "",
    say: "",
    error: null,
    refreshing: false,
    amount: "2",
    tab: "play",
    selectedVersion: null,
    wallet,
    toast: null,
  };
}

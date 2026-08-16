import type { Project, ProjectBundle } from "../shared/types";

export type Tab = "play" | "code";
export type View = "home" | "project";

export type AppState = {
  view: View;
  projects: Project[];
  bundle: ProjectBundle | null;
  loading: boolean;
  creating: boolean;
  refreshing: boolean;
  draft: string;
  error: string | null;
  tab: Tab;
  selectedVersion: number | null;
  artifactCode: string | null;
  artifactCodeVersion: number | null;
  toast: string | null;
};

export const initialState: AppState = {
  view: "home",
  projects: [],
  bundle: null,
  loading: true,
  creating: false,
  refreshing: false,
  draft: "",
  error: null,
  tab: "play",
  selectedVersion: null,
  artifactCode: null,
  artifactCodeVersion: null,
  toast: null,
};

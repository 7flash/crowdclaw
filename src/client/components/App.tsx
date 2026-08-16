import { HomeView } from "./HomeView";
import { ProjectView } from "./ProjectView";
import type { AppState, Tab } from "../state";
import type { Project } from "../../shared/types";

export type AppActions = {
  home: () => void;
  setDraft: (value: string) => void;
  seed: (value: string) => void;
  create: () => void;
  open: (project: Project) => void;
  setTab: (tab: Tab) => void;
  selectVersion: (version: number) => void;
  copyWallet: () => void;
  syncFunding: () => void;
  devFund: () => void;
  share: () => void;
};

export function App({
  state,
  actions,
}: {
  state: AppState;
  actions: AppActions;
}) {
  return (
    <div className="cc min-h-screen">
      <div className="mx-auto max-w-[920px] px-5">
        <div className="flex h-[58px] items-center">
          <button
            className="font-display cursor-pointer border-0 bg-transparent p-0 text-[22px] font-extrabold uppercase tracking-[-.01em]"
            onClick={actions.home}
          >
            Crowd<span className="text-[var(--claw)]">Claw</span>
          </button>
          <span className="font-data ml-auto rounded-full border border-[var(--line)] px-[11px] py-1.5 text-[9px] uppercase tracking-[.12em] text-[var(--dimmer)]">
            <i className="not-italic text-[var(--mint)]">●</i> autonomous
          </span>
        </div>
      </div>

      {state.view === "home" ? (
        <HomeView
          projects={state.projects}
          loading={state.loading}
          creating={state.creating}
          draft={state.draft}
          onDraft={actions.setDraft}
          onSeed={actions.seed}
          onCreate={actions.create}
          onOpen={actions.open}
        />
      ) : state.bundle ? (
        <ProjectView
          bundle={state.bundle}
          refreshing={state.refreshing}
          error={state.error}
          tab={state.tab}
          selectedVersion={state.selectedVersion}
          artifactCode={state.artifactCode}
          artifactCodeVersion={state.artifactCodeVersion}
          onHome={actions.home}
          onTab={actions.setTab}
          onVersion={actions.selectVersion}
          onCopyWallet={actions.copyWallet}
          onSyncFunding={actions.syncFunding}
          onDevFund={actions.devFund}
          onShare={actions.share}
        />
      ) : (
        <div className="mx-auto max-w-[920px] px-5 py-20 text-center text-sm text-[var(--dimmer)]">
          loading project…
        </div>
      )}

      {state.toast ? <div className="cc-toast">{state.toast}</div> : null}
      {state.view === "home" && state.error ? (
        <div className="mx-auto mt-4 max-w-[660px] px-5 text-sm text-[var(--claw)]">
          {state.error}
        </div>
      ) : null}
    </div>
  );
}

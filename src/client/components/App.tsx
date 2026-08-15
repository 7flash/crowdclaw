import { HomeView } from "./HomeView";
import { PlanningView } from "./PlanningView";
import { GameView } from "./GameView";
import type { AppState, Tab } from "../state";
import type { Game } from "../../shared/types";

export type AppActions = {
  home: () => void;
  setDraft: (value: string) => void;
  seed: (value: string) => void;
  start: () => void;
  retryPlan: () => void;
  open: (game: Game) => void;
  setAmount: (value: string) => void;
  fund: () => void;
  run: () => void;
  setTab: (tab: Tab) => void;
  selectVersion: (version: number) => void;
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
          <span
            className="font-data ml-auto cursor-default rounded-full border border-[var(--line)] px-[11px] py-1.5 text-[10px] text-[var(--dimmer)]"
            title={`off-chain pool · ${state.wallet}`}
          >
            <i className="not-italic text-[var(--mint)]">◈</i>{" "}
            {shortWallet(state.wallet)}
          </span>
        </div>
      </div>

      {state.view === "home" ? (
        <HomeView
          games={state.games}
          loading={state.loading}
          draft={state.draft}
          onDraft={actions.setDraft}
          onSeed={actions.seed}
          onStart={actions.start}
          onOpen={actions.open}
        />
      ) : state.view === "plan" ? (
        <PlanningView
          prompt={state.planPrompt}
          text={state.planText}
          error={state.planError}
          onRetry={actions.retryPlan}
          onBack={actions.home}
        />
      ) : state.game ? (
        <GameView
          game={state.game}
          versions={state.versions}
          busy={state.busy}
          stream={state.stream}
          say={state.say}
          error={state.error}
          refreshing={state.refreshing}
          amount={state.amount}
          tab={state.tab}
          selectedVersion={state.selectedVersion}
          onHome={actions.home}
          onAmount={actions.setAmount}
          onFund={actions.fund}
          onRun={actions.run}
          onTab={actions.setTab}
          onVersion={actions.selectVersion}
        />
      ) : null}

      {state.toast ? <div className="cc-toast">{state.toast}</div> : null}
    </div>
  );
}

function shortWallet(wallet: string): string {
  return wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "……";
}

import type { ProjectBundle } from "../../shared/types";
import type { Tab } from "../state";
import { BrandBar } from "./BrandBar";
import { ProjectView } from "./ProjectView";

export type ProjectActions = {
  setTab: (tab: Tab) => void;
  selectVersion: (version: number) => void;
  copyWallet: () => void;
  syncFunding: () => void;
  devFund: () => void;
  share: () => void;
  setSteerText: (value: string) => void;
  setSteerAmount: (value: string) => void;
  steer: () => void;
};

export function ProjectApp(props: {
  bundle: ProjectBundle;
  refreshing: boolean;
  liveState: "connecting" | "live" | "fallback";
  error: string | null;
  tab: Tab;
  selectedVersion: number | null;
  artifactCode: string | null;
  artifactCodeVersion: number | null;
  previewRevision: number;
  toast: string | null;
  steerText: string;
  steerAmount: string;
  steering: boolean;
  actions: ProjectActions;
}) {
  return (
    <div className="cc min-h-screen">
      <BrandBar />
      <ProjectView
        bundle={props.bundle}
        refreshing={props.refreshing}
        liveState={props.liveState}
        error={props.error}
        tab={props.tab}
        selectedVersion={props.selectedVersion}
        artifactCode={props.artifactCode}
        artifactCodeVersion={props.artifactCodeVersion}
        previewRevision={props.previewRevision}
        steerText={props.steerText}
        steerAmount={props.steerAmount}
        steering={props.steering}
        onTab={props.actions.setTab}
        onVersion={props.actions.selectVersion}
        onCopyWallet={props.actions.copyWallet}
        onSyncFunding={props.actions.syncFunding}
        onDevFund={props.actions.devFund}
        onShare={props.actions.share}
        onSteerText={props.actions.setSteerText}
        onSteerAmount={props.actions.setSteerAmount}
        onSteer={props.actions.steer}
      />
      {props.toast ? <div className="cc-toast">{props.toast}</div> : null}
    </div>
  );
}

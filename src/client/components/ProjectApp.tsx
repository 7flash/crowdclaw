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
};

export function ProjectApp(props: {
  bundle: ProjectBundle;
  refreshing: boolean;
  error: string | null;
  tab: Tab;
  selectedVersion: number | null;
  artifactCode: string | null;
  artifactCodeVersion: number | null;
  toast: string | null;
  actions: ProjectActions;
}) {
  return (
    <div className="cc min-h-screen">
      <BrandBar />
      <ProjectView
        bundle={props.bundle}
        refreshing={props.refreshing}
        error={props.error}
        tab={props.tab}
        selectedVersion={props.selectedVersion}
        artifactCode={props.artifactCode}
        artifactCodeVersion={props.artifactCodeVersion}
        onTab={props.actions.setTab}
        onVersion={props.actions.selectVersion}
        onCopyWallet={props.actions.copyWallet}
        onSyncFunding={props.actions.syncFunding}
        onDevFund={props.actions.devFund}
        onShare={props.actions.share}
      />
      {props.toast ? <div className="cc-toast">{props.toast}</div> : null}
    </div>
  );
}

import { AdminView } from "../../src/client/components/AdminView";

const noop = () => {};

export default function Page() {
  return (
    <div id="crowdclaw-admin">
      <AdminView
        agents={[]}
        selected=""
        stdout=""
        stderr=""
        token=""
        error=""
        busy=""
        onToken={noop}
        onApplyToken={noop}
        onSelect={noop}
        onRefresh={noop}
        onStop={noop}
        onRestart={noop}
        onRefreshLogs={noop}
      />
    </div>
  );
}

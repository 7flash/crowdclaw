import { HomeView } from "../src/client/components/HomeView";
import { projectsRepository } from "../src/server/db/project-repository";
import { lamportsPerCredit } from "../src/server/config";

const noop = () => {};

export default function Page() {
  const projects = projectsRepository.list();
  return (
    <div
      id="crowdclaw-home"
      data-projects={JSON.stringify(projects)}
      className="min-h-screen bg-[var(--void)] text-[var(--bone)]"
    >
      <HomeView
        projects={projects}
        creating={false}
        starting={false}
        planningProject={null}
        draft=""
        onDraft={noop}
        lamportsPerCredit={lamportsPerCredit()}
        onCreate={noop}
        onStart={noop}
      />
    </div>
  );
}

import { HomeView } from "../src/client/components/HomeView";
import { projectsRepository } from "../src/server/db/project-repository";

const noop = () => {};

export default function Page() {
  const projects = projectsRepository.list();
  return (
    <main
      id="crowdclaw-home"
      data-projects={JSON.stringify(projects)}
      className="min-h-screen bg-[var(--void)] text-[var(--bone)]"
    >
      <HomeView
        projects={projects}
        creating={false}
        planningProject={null}
        visibleMilestones={0}
        draft=""
        onDraft={noop}
        onSeed={noop}
        onCreate={noop}
      />
    </main>
  );
}

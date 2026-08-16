import { CREDIT_SYMBOL, SEEDS } from "../../shared/constants";
import type { Project } from "../../shared/types";

export type HomeViewProps = {
  projects: Project[];
  loading: boolean;
  creating: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSeed: (value: string) => void;
  onCreate: () => void;
  onOpen: (project: Project) => void;
};

export function HomeView(props: HomeViewProps) {
  return (
    <div className="mx-auto max-w-[660px] px-5 pb-16">
      <section className="cc-rise pt-[66px] pb-[26px] text-center">
        <div className="cc-label mb-4 text-[var(--mint)]">
          IDEA → AGENT → PLAYABLE RELEASES
        </div>
        <h1 className="font-display m-0 mb-[20px] text-[clamp(2.4rem,7.4vw,4.4rem)] font-extrabold leading-[.88] tracking-[-.022em]">
          Describe your <em className="not-italic text-[var(--claw)]">game</em>.
          <br />
          The agent keeps building.
        </h1>
        <p className="mx-auto mb-7 max-w-[540px] text-[14px] leading-6 text-[var(--dim)]">
          Every idea gets a project wallet and an autonomous builder. It plans,
          ships a playable version, rolls the roadmap forward, and waits only
          when it needs more crowd funding.
        </p>
        <div className="cc-box text-left">
          <textarea
            className="min-h-[92px] w-full resize-none border-0 bg-transparent px-[18px] pt-[18px] pb-1 text-[16.5px] leading-6 outline-none placeholder:text-[var(--dimmer)]"
            value={props.draft}
            placeholder="snake, but the walls close in each time you eat…"
            onInput={(event: Event) =>
              props.onDraft((event.currentTarget as HTMLTextAreaElement).value)
            }
            onKeyDown={(event: KeyboardEvent) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                props.draft.trim().length > 9 &&
                !props.creating
              )
                props.onCreate();
            }}
          />
          <div className="flex items-center px-[10px] pt-2 pb-[10px]">
            <span className="cc-label ml-2">
              agent + wallet assigned automatically
            </span>
            <button
              className="cc-btn cc-btn-primary ml-auto min-w-[92px]"
              disabled={props.draft.trim().length < 10 || props.creating}
              onClick={props.onCreate}
            >
              {props.creating ? <span className="cc-spinner" /> : "CREATE →"}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {SEEDS.map((seed) => (
            <button
              key={seed}
              className="rounded-full border border-[var(--line)] bg-transparent px-3 py-1.5 text-[12.5px] text-[var(--dim)] transition hover:border-[var(--edge)] hover:text-[var(--bone)]"
              onClick={() => props.onSeed(seed)}
            >
              {seed}
            </button>
          ))}
        </div>
      </section>

      {props.loading ? (
        <div className="mt-11">
          <div className="cc-skeleton" />
          <div className="cc-skeleton" />
        </div>
      ) : props.projects.length ? (
        <section className="mt-11">
          <div className="cc-section">
            <span className="cc-label">live projects</span>
          </div>
          <div className="border-t border-[var(--line)]">
            {props.projects.map((project) => (
              <button
                key={project.id}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 border-0 border-b border-[var(--line)] bg-transparent px-[10px] py-[14px] text-left transition hover:bg-white/[.03]"
                onClick={() => props.onOpen(project)}
              >
                <span className="min-w-0">
                  <span className="font-data block text-[12.5px]">
                    {project.name}
                  </span>
                  <span className="block max-w-[42ch] overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-[var(--dimmer)]">
                    {project.summary}
                  </span>
                </span>
                <span className={`cc-status cc-status-${project.status}`}>
                  {statusLabel(project.status)}
                </span>
                <span className="font-data min-w-[60px] text-right text-[11px] text-[var(--dim)]">
                  {project.availableCredits.toFixed(1)} {CREDIT_SYMBOL}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function statusLabel(status: Project["status"]): string {
  if (status === "waiting_funds") return "fund me";
  if (status === "validating" || status === "publishing") return "shipping";
  return status.replace("_", " ");
}

import { SEEDS, TOKEN_SYMBOL } from "../../shared/constants";
import type { Game } from "../../shared/types";

export type HomeViewProps = {
  games: Game[];
  loading: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSeed: (value: string) => void;
  onStart: () => void;
  onOpen: (game: Game) => void;
};

export function HomeView(props: HomeViewProps) {
  return (
    <div className="mx-auto max-w-[660px] px-5">
      <section className="cc-rise pt-[66px] pb-[26px] text-center">
        <h1 className="font-display m-0 mb-[26px] text-[clamp(2.4rem,7.4vw,4.4rem)] font-extrabold leading-[.88] tracking-[-.022em]">
          Describe your <em className="not-italic text-[var(--claw)]">game</em>.
          <br />
          The crowd pays for it.
        </h1>
        <div className="cc-box text-left">
          <textarea
            className="min-h-[84px] w-full resize-none border-0 bg-transparent px-[18px] pt-[18px] pb-1 text-[16.5px] leading-6 outline-none placeholder:text-[var(--dimmer)]"
            value={props.draft}
            placeholder="snake, but the walls close in each time you eat…"
            onInput={(event: Event) =>
              props.onDraft((event.currentTarget as HTMLTextAreaElement).value)
            }
            onKeyDown={(event: KeyboardEvent) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                props.draft.trim().length > 9
              )
                props.onStart();
            }}
          />
          <div className="flex px-[10px] pt-2 pb-[10px]">
            <button
              className="cc-btn cc-btn-primary ml-auto px-[14px] text-sm"
              disabled={props.draft.trim().length < 10}
              onClick={props.onStart}
              aria-label="Plan it"
            >
              →
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
      ) : props.games.length ? (
        <div className="mt-11 border-t border-[var(--line)]">
          {props.games.map((game) => (
            <button
              key={game.id}
              className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 border-0 border-b border-[var(--line)] bg-transparent px-[10px] py-[14px] text-left transition hover:bg-white/[.03]"
              onClick={() => props.onOpen(game)}
            >
              <span className="min-w-0">
                <span className="font-data block text-[12.5px]">
                  {game.name}
                </span>
                <span className="block max-w-[42ch] overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-[var(--dimmer)]">
                  {game.summary}
                </span>
              </span>
              <span className="font-data text-[10px] text-[var(--mint)]">
                {game.done ? `v${game.done}` : ""}
              </span>
              <span className="font-data min-w-[52px] text-right text-[11px] text-[var(--dim)]">
                {(game.pool - game.spent).toFixed(1)} {TOKEN_SYMBOL}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

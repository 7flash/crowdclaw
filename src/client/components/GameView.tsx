import { TOKEN_SYMBOL } from "../../shared/constants";
import type { Game, Version } from "../../shared/types";
import type { Tab } from "../state";

export type GameViewProps = {
  game: Game;
  versions: Version[];
  busy: boolean;
  stream: string;
  say: string;
  error: string | null;
  refreshing: boolean;
  amount: string;
  tab: Tab;
  selectedVersion: number | null;
  onHome: () => void;
  onAmount: (value: string) => void;
  onFund: () => void;
  onRun: () => void;
  onTab: (tab: Tab) => void;
  onVersion: (version: number) => void;
};

export function GameView(props: GameViewProps) {
  const { game, versions } = props;
  const done = game.done || 0;
  const miles = game.miles || [];
  const next = miles[done];
  const balance = Math.round((game.pool - game.spent) * 100) / 100;
  const canRun = !props.busy && Boolean(next) && balance >= (next?.c || 0);
  const latest = versions[versions.length - 1];
  const current =
    props.selectedVersion != null
      ? versions.find((version) => version.n === props.selectedVersion) ||
        latest
      : latest;
  const shipped = miles.slice(0, done);
  const backlog = miles.slice(done + 1);
  const codeLength = (props.stream.split("CODE|")[1] || "").length;
  const progress = props.busy ? Math.min(97, 6 + (codeLength / 3400) * 94) : 0;

  return (
    <div className="mx-auto max-w-[920px] px-5 pb-[70px]">
      <header className="flex items-start gap-[10px] pt-[10px] pb-[14px]">
        <button
          className="cc-btn cc-btn-ghost"
          onClick={props.onHome}
          aria-label="Back"
        >
          ←
        </button>
        <div className="min-w-0">
          <div className="font-display text-[clamp(1.5rem,4vw,2.1rem)] font-extrabold uppercase leading-[.9] tracking-[-.015em]">
            {game.name}
          </div>
          <div className="text-[13.5px] text-[var(--dim)]">{game.summary}</div>
        </div>
      </header>

      <div className="cc-stage">
        <div className="cc-stage-bar">
          <span
            className={`cc-dot ${props.busy ? "cc-dot-go" : versions.length ? "cc-dot-on" : ""}`}
          />
          <span className="cc-label">
            {props.busy ? "" : current ? `v${current.n}` : ""}
          </span>
          {props.refreshing ? (
            <span className="cc-label text-[var(--mint)]">·</span>
          ) : null}
          {versions.length && !props.busy ? (
            <div className="ml-auto flex gap-0.5">
              <button
                className={`cc-tab ${props.tab === "play" ? "cc-tab-on" : ""}`}
                onClick={() => props.onTab("play")}
                aria-label="Play"
              >
                ▶
              </button>
              <button
                className={`cc-tab ${props.tab === "code" ? "cc-tab-on" : ""}`}
                onClick={() => props.onTab("code")}
                aria-label="Code"
              >
                {"</>"}
              </button>
            </div>
          ) : null}
          {props.busy ? (
            <span
              className="absolute bottom-[-1px] left-0 h-0.5 bg-[var(--claw)] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          ) : null}
        </div>
        <div className="relative h-[472px] max-[800px]:h-[340px]">
          {props.busy ? (
            <pre className="cc-code">
              {props.stream}
              <span className="cc-caret" />
            </pre>
          ) : current ? (
            props.tab === "play" ? (
              <iframe
                key={current.n}
                className="block h-full w-full border-0 bg-black"
                srcdoc={current.code}
                sandbox="allow-scripts allow-pointer-lock"
                title={game.name}
              />
            ) : (
              <pre className="cc-code">{current.code}</pre>
            )
          ) : (
            <div className="font-data grid h-full place-items-center text-[11px] tracking-[.2em] text-[#2B3A42]">
              v0
            </div>
          )}
        </div>
      </div>

      <div className={`cc-say ${props.say || props.error ? "cc-say-has" : ""}`}>
        {props.error ? (
          <p className="text-[var(--dim)]">{props.error}</p>
        ) : props.say ? (
          <p>{props.say}</p>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          className="font-data w-16 min-w-0 rounded-md border border-[var(--edge)] bg-[#0F181D] px-[13px] py-[10px] text-center text-[13px] outline-none focus:border-[var(--mint)]"
          value={props.amount}
          inputmode="decimal"
          aria-label="Amount"
          onInput={(event: Event) =>
            props.onAmount((event.currentTarget as HTMLInputElement).value)
          }
        />
        <button
          className="cc-btn"
          disabled={props.busy || !(Number.parseFloat(props.amount) > 0)}
          onClick={props.onFund}
          aria-label="Add to pool"
        >
          + {TOKEN_SYMBOL}
        </button>
        <span
          className="font-data ml-auto text-[15px]"
          style={{ color: canRun ? "var(--claw)" : "var(--dim)" }}
        >
          {balance.toFixed(1)} {TOKEN_SYMBOL}
        </span>
      </div>

      {shipped.length ? (
        <section>
          <div className="cc-section">
            <span className="cc-label">shipped</span>
          </div>
          <div className="grid gap-[5px]">
            {shipped.map((mile, index) => {
              const versionNumber = index + 1;
              const hasVersion = versions.some(
                (version) => version.n === versionNumber,
              );
              return (
                <button
                  key={`${mile.t}-${index}`}
                  className={`cc-milestone cc-done ${current?.n === versionNumber ? "cc-selected" : ""}`}
                  disabled={!hasVersion}
                  onClick={() => props.onVersion(versionNumber)}
                >
                  <span className="font-data text-[11px] text-[var(--mint)]">
                    ✓
                  </span>
                  <span className="text-sm leading-[1.35] text-[var(--dim)]">
                    {mile.t}
                  </span>
                  <span className="font-data whitespace-nowrap text-[11px] text-[var(--dimmer)]">
                    {hasVersion ? `v${versionNumber}` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {next ? (
        <section>
          <div className="cc-section">
            <span className="cc-label">next</span>
          </div>
          <button
            className={`cc-milestone cc-next ${canRun ? "cc-ready" : ""}`}
            disabled={!canRun}
            onClick={props.onRun}
          >
            <span className="font-data text-[11px] text-[var(--claw)]">
              {props.busy ? <span className="cc-spinner" /> : done + 1}
            </span>
            <span className="text-sm leading-[1.35]">{next.t}</span>
            <span className="font-data whitespace-nowrap text-[11px] text-[var(--claw)]">
              {balance >= next.c
                ? `${next.c} ${TOKEN_SYMBOL}`
                : `${(next.c - balance).toFixed(1)} ${TOKEN_SYMBOL} short`}
            </span>
          </button>
        </section>
      ) : null}

      {backlog.length ? (
        <section>
          <div className="cc-section">
            <span className="cc-label">backlog</span>
          </div>
          <div className="grid gap-[5px]">
            {backlog.map((mile, index) => (
              <div
                key={`${mile.t}-${index}`}
                className="cc-milestone opacity-40"
              >
                <span className="font-data text-[11px] text-[var(--dimmer)]">
                  {done + 2 + index}
                </span>
                <span className="text-sm leading-[1.35]">{mile.t}</span>
                <span className="font-data whitespace-nowrap text-[11px] text-[var(--dimmer)]">
                  {mile.c} {TOKEN_SYMBOL}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

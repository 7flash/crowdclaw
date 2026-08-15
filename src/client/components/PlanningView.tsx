import { TOKEN_SYMBOL } from "../../shared/constants";
import { parsePlanPreview } from "../format";

export function PlanningView({
  prompt,
  text,
  error,
  onRetry,
  onBack,
}: {
  prompt: string;
  text: string;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const plan = parsePlanPreview(text);
  return (
    <div className="mx-auto max-w-[660px] px-5 pt-10">
      <div className="border-l-2 border-[var(--claw)] pl-[13px] text-[14.5px] text-[var(--dim)]">
        {prompt}
      </div>
      {error ? (
        <div>
          <p className="text-sm text-[var(--dim)]">{error}</p>
          <div className="flex gap-[7px]">
            <button
              className="cc-btn cc-btn-primary"
              onClick={onRetry}
              aria-label="Retry"
            >
              ↻
            </button>
            <button
              className="cc-btn cc-btn-ghost"
              onClick={onBack}
              aria-label="Back"
            >
              ←
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="font-display mt-6 min-h-[30px] text-[28px] font-extrabold uppercase leading-[.9] tracking-[-.015em]">
            {plan.name || <span className="cc-spinner" />}
          </div>
          {plan.summary ? (
            <div className="cc-fade text-sm text-[var(--dim)]">
              {plan.summary}
            </div>
          ) : null}
          <div className="mt-[18px] grid gap-[5px]">
            {plan.miles.map((mile, index) => (
              <div
                key={`${mile.t}-${index}`}
                className={`cc-milestone ${index === 0 ? "cc-next" : "opacity-40"}`}
              >
                <span className="font-data text-[11px] text-[var(--dimmer)]">
                  {index + 1}
                </span>
                <span className="text-sm leading-[1.35]">{mile.t}</span>
                <span className="font-data whitespace-nowrap text-[11px] text-[var(--dimmer)]">
                  {mile.c} {TOKEN_SYMBOL}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

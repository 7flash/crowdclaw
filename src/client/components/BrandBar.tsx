export function BrandBar() {
  return (
    <div className="mx-auto max-w-[920px] px-5">
      <div className="flex h-[58px] items-center">
        <a
          href="/"
          className="cc-brand font-display border-0 bg-transparent p-0 text-[22px] font-extrabold uppercase tracking-[-.01em] text-[var(--bone)] no-underline"
        >
          Crowd<span className="text-[var(--claw)]">Claw</span>
        </a>
        <span className="font-data ml-auto rounded-full border border-[var(--line)] px-[11px] py-1.5 text-[9px] uppercase tracking-[.12em] text-[var(--dimmer)]">
          <i className="not-italic text-[var(--mint)]">●</i> autonomous
        </span>
      </div>
    </div>
  );
}

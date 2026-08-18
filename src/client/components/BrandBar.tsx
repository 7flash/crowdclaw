export function BrandBar() {
  return (
    <div className="mx-auto max-w-[1120px] px-5">
      <div className="flex h-[58px] items-center">
        <a
          href="/"
          className="cc-brand font-display border-0 bg-transparent p-0 text-[22px] font-extrabold uppercase tracking-[-.01em] text-[var(--bone)] no-underline"
        >
          Crowd<span className="text-[var(--claw)]">Claw</span>
        </a>
        <a
          href="/discover"
          className="ml-auto font-data text-[9px] uppercase tracking-[.14em] text-[var(--dimmer)] no-underline transition hover:text-[var(--mint)]"
        >
          DISCOVER
        </a>
      </div>
    </div>
  );
}

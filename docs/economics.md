# CrowdClaw funding and settlement contract

CrowdClaw deliberately separates **credit authority** from **transaction attribution**.

## Credit authority

The authoritative on-chain input is the confirmed SOL balance of the Solard-owned project wallet.

For each sync:

```text
observed = confirmed wallet balance
credited = max(previous credited high-water, observed)
delta    = credited - previous credited high-water
```

Only a positive `delta` creates new build credits. A temporary lower RPC balance cannot remove already-confirmed credits, and returning to an old high-water mark cannot mint the same credits twice.

`LAMPORTS_PER_CREDIT` controls the conversion from lamports to internal build credits.

## Transaction attribution

CrowdClaw also calls `getSignaturesForAddress` and `getTransaction` for recent unknown project-wallet signatures. If a confirmed transaction increases the project wallet's lamport balance, it is indexed as a supporter donation.

The donation amount is the **project wallet's positive balance delta**, not the sender's debit. The displayed sender is best-effort: CrowdClaw prefers the signer with the largest lamport debit and otherwise falls back to the largest debited account.

Donation records do **not** change project credit balances. This prevents a transaction from being counted once by transaction indexing and again by the wallet-balance high-water.

## Reservations and settlement

A milestone can start only when:

```text
fundedCredits - spentCredits - reservedCredits >= milestone.costCredits
```

Starting a build reserves the milestone cost. Reservation is not spend.

On successful validated publication, one SQLite transaction:

1. inserts the immutable artifact,
2. marks the milestone shipped,
3. increments `spentCredits`,
4. appends a negative `milestone_spend` ledger entry,
5. records `chargedCredits` on the run,
6. clears the reservation,
7. rolls the next milestone,
8. chooses `queued` or `waiting_funds` for the next state.

A failed, stale, interrupted, or rejected run releases the reservation and records no milestone debit. Its model token usage can still remain visible in run history, but the crowd is not charged a build credit for that failed attempt.

## Ledger rows

The public credit ledger contains:

- `funding` — confirmed wallet high-water increase
- `manual` — development-only injected credits
- `milestone_spend` — successful immutable release settlement
- `legacy_funding` / `legacy_spend` — one-time opening entries for projects created before the ledger existed

Project numeric fields remain cached operational totals for fast scheduling. The ledger is the human-readable audit trail of how those totals changed.

## Security boundary

Project wallets are treated as receive-only funding addresses by CrowdClaw. The application database stores only their public addresses. Wallet key custody and generation remain inside `@solard/sdk` / Solard.

## Supporter influence

Attributed donor addresses earn influence linearly from confirmed donation build units. Influence is not spendable funding and does not alter the project wallet balance. It is a separate direction budget:

```text
influence available = attributed donation units - steering units spent
```

Steering requires an Ed25519 signature from the donor's Solana address. Open steering is weighted into the next-milestone proposal and consumed only when the run that used it publishes successfully.

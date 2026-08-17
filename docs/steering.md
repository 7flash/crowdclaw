# Supporter steering

Confirmed donation rows are aggregated by payer address. Donation build units become supporter influence one-for-one.

To spend influence:

1. Browser connects an injected Solana wallet.
2. Server issues a short project/address/nonce challenge.
3. Wallet signs the challenge.
4. Server verifies the Ed25519 signature against the Solana address.
5. SQLite atomically checks remaining influence and inserts an open steering instruction.

A build snapshots currently-open steering before the jsx-ai tool loop starts. The prompt weights requests by spent influence. Compatible steering can shape the pending implementation and the rolling milestone proposal. Steering used by the run is marked consumed in the same publication transaction that ships the artifact and appends the next milestone.


## Platform seed

The automatic CrowdClaw first-milestone SOL grant is visible in Supporters but earns zero steering influence. Only confirmed donations with `source = supporter` increase influence.

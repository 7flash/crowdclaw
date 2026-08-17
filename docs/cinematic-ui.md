# Cinematic project UI

CrowdClaw 4.13 projects are projected from the same durable `ProjectBundle`; this change does not add another lifecycle or queue.

The page has four visual layers only:

1. stage — funding/build activity until an artifact exists, then the playable release;
2. live rail — agent token usage and project SOL;
3. roadmap — NOW, NEXT, SHIPPED;
4. community — supporters and steering, only after community state exists.

The activity feed is a terse projection of persisted project events plus the current build run's public tool/status stream. Internal model reasoning is never displayed.

# Agent runtime

CrowdClaw delegates iteration to `jsx-ai` rather than implementing its own assistant/tool history loop.

## Initial plan

One project creation produces one planning model request:

```text
runAgent
  maxSteps: 1
  maxToolCalls: 1
  retries: 0
      ↓
submit_game_plan
  slug
  summary
  note
  exactly 3 milestones
```

The public `note` is a short design summary intended for display. It is not private chain-of-thought. Provider quota/rate-limit failures are surfaced as `QUOTA` and are not retried automatically.

## Milestones

Each milestone starts with fresh model history. The filesystem is durable state.

```text
runAgent
  public_status
  list_files
  read_file
  write_file
  complete_milestone
```

`public_status` is the only model-generated thought-like text shown to viewers. It is explicitly public and limited to a short operational update. File operations are also shown live.

`complete_milestone` performs host validation before setting the agent completion state. Invalid artifacts return a tool error and the same `runAgent()` session continues fixing the workspace.

`runAgent()` usage is persisted as input, output, and thinking-token counts. CrowdClaw never exposes hidden reasoning content.


## Transient provider failures

Planning is still one `runAgent()` model step. Transport/service failures such as Gemini 503/502/504 and timeouts do not become terminal project failures: CrowdClaw persists `BUSY`, schedules a backoff retry with `retryAt`, and the same bgrun project process stays alive. Quota/rate-limit failures (429) and malformed/permanent request failures remain terminal and require explicit intervention.

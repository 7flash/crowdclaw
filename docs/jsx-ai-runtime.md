# jsx-ai runtime contract

CrowdClaw uses `jsx-ai` as the complete model/tool boundary for autonomous project agents.

## Runtime

For the Codex runtime:

```dotenv
JSX_AI_RUNTIME=codex
GAME_MODEL=gpt-5.4-mini
GAME_CONTEXT_WINDOW=1048576
```

CrowdClaw passes `GAME_MODEL` and `JSX_AI_RUNTIME` through to `jsx-ai` and does not duplicate provider/auth validation. `jsx-ai` owns provider/runtime authentication. `@openai/codex-sdk` is included for the Codex runtime.

## Prompt/tool shape

The agent runtime uses the custom `jsx-ai` JSX runtime (`/** @jsxImportSource jsx-ai */`), not React.

```tsx
import { callLLM, md, render } from "jsx-ai";
import type { ExtractedMessage, ToolCall } from "jsx-ai";
```

Planning is a small structured text call. Build milestones use a bounded multi-turn tool loop with:

- `list_files`
- `read_file`
- `write_file`
- `phase_done`

Assistant messages and tool results are appended as `ExtractedMessage` entries and rendered back into the next prompt turn.

## Provider routing

Without a runtime adapter, `jsx-ai` determines the provider from the model name and CrowdClaw performs an early configuration check for known provider API keys. When `JSX_AI_RUNTIME=codex`, that credential preflight is skipped because the runtime owns authentication:


With `JSX_AI_RUNTIME=codex`, none of the provider API-key rows above are required by CrowdClaw. Custom provider/model names are also allowed and may use their own credential mechanism.

## Usage accounting

`result.usage.inputTokens` and `result.usage.outputTokens` are the primary source of truth.

Provider cache counters, when exposed, are stored as metadata but are not added again to `lastContextTokens`; input usage already represents the request context used for the model call.

If usage is absent, CrowdClaw calls `render(tree)` and estimates the extracted prompt plus model output. This fallback includes system instructions and tool schemas and is marked as estimated in persisted run data/UI.

## Context window

The context window is intentionally a deployment setting rather than inferred from arbitrary model strings:

```dotenv
GAME_CONTEXT_WINDOW=1048576
```

Change it together with `GAME_MODEL` when selecting another model.

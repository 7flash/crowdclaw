# jsx-ai runtime contract

CrowdClaw uses `jsx-ai` as the complete model/tool boundary for autonomous project agents.

## Default

```dotenv
GEMINI_API_KEY=...
GAME_MODEL=gemini-3-flash-preview
GAME_CONTEXT_WINDOW=1048576
```

The application always passes `GAME_MODEL` to `callLLM()`. The default is `gemini-3-flash-preview`.

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

`jsx-ai` determines the provider from the model name. CrowdClaw only performs an early configuration check for the well-known providers:

| Model | Key |
|---|---|
| `gemini-*` | `GEMINI_API_KEY` |
| `gpt-*`, `o4-*` | `OPENAI_API_KEY` |
| `claude-*` | `ANTHROPIC_API_KEY` |
| `deepseek-*` | `DEEPSEEK_API_KEY` |

Custom provider/model names are allowed and may use their own credential mechanism.

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

# Observability

CrowdClaw uses the current `measure-fn` action API directly.

```ts
await measure(
  {
    start: () => "Build milestone 1",
    end: () => ({ status: "published" }),
    projectId,
  },
  async () => {
    await measure(
      {
        start: () => "Build model 1",
        end: response => ({
          tools: response.toolCalls.map(call => call.name),
          usage: response.usage,
        }),
      },
      () => callLLM(tree, options),
    )
  },
)
```

There is no injected child measurement function. Calling `measure()` inside an active measured closure establishes the nested span automatically.

`catch` is used only when the operation intentionally has a fallback. Model/build errors generally throw to the project-run boundary, where CrowdClaw persists the failure exactly once. Funding sync is allowed to fall back to the last persisted project snapshot.

## What logs contain

Model calls: model, strategy, tool names, normalized usage.

Tools: tool name, error flag, result character count, public operation note.

Funding: wallet/lamports/status summaries.

Artifacts: byte size, validation issue count, version and short hash.

Raw provider payloads and Gemini thought signatures are intentionally not returned from measurement `end` handlers.

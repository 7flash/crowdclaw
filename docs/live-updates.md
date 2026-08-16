# Live updates contract

CrowdClaw uses Server-Sent Events for browser-facing project state. The agent worker itself remains completely independent of browser connections.

## Endpoint

```text
GET /api/projects/:id/events
Accept: text/event-stream
```

The response sends:

- `snapshot` — the complete public `ProjectBundle` JSON.
- `gone` — the project disappeared; the stream then closes.
- comment keepalives every 15 seconds while nothing changes.

The first snapshot is sent immediately. The server checks the authoritative SQLite bundle every 500 ms but emits only when its serialized public representation changes. This keeps web and worker processes decoupled: no in-memory pub/sub dependency is required.

## Client behavior

Project page:

1. Render the SSR bundle immediately.
2. Open `EventSource`.
3. Apply each snapshot atomically.
4. If SSE errors, let `EventSource` reconnect and start a 5-second HTTP fallback poll.
5. Stop fallback polling when SSE opens again.
6. Close the connection on `pagehide`.
7. On BFCache `pageshow`, refresh once and reconnect.

Home planning uses the same stream after creating a project. Its fallback poll is 2.5 seconds because initial planning is short-lived.

## Artifact releases

Every shipped milestone remains available at:

```text
/artifacts/:projectId/:version
```

Artifact HTML is immutable and addressed by project/version. Responses include a SHA-256 ETag and support conditional `If-None-Match` requests.

Release metadata is available at:

```text
/api/projects/:projectId/releases/:version
```

The manifest includes project ID, version, milestone title, SHA-256, run ID, creation time, and canonical artifact URL.

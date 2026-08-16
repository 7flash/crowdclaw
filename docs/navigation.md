# Navigation contract

CrowdClaw targets TradJS 4.3.0 and is intentionally a multi-page application.

## Documents

- `/` is the home/create/planning document.
- `/projects/[id]` is the public agent/project document.

There is no client router and no query-string page state. Ordinary anchors perform ordinary same-origin document navigation. Refresh and direct/shared URLs resolve on the server.

## View transitions

TradJS 4.3.0 renders browser-native cross-document View Transitions by default. CrowdClaw only supplies stable names for selected elements:

- `crowdclaw-brand`
- `crowdclaw-project`

These are progressive enhancement, never routing infrastructure.

## BFCache

A browser may restore either document from Back/Forward Cache instead of constructing it again.

- Home closes its planning `EventSource`/fallback timer on `pagehide`. A persisted `pageshow` clears transient creation state and refreshes the project list.
- Project closes its live `EventSource`/fallback timer on `pagehide`. A persisted `pageshow` fetches the latest bundle and reconnects the live stream.

This makes each live connection explicitly document-local while still allowing BFCache restores to recover cleanly.

## Agent lifetime

The autonomous worker is server-side and persisted in SQLite. Browser/document lifetime never owns an agent run.

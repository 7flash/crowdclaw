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

- Home handles persisted `pageshow` by clearing transient creation/planning animation state and refreshing the project list.
- Project handles persisted `pageshow` by immediately fetching the latest project bundle.

Do not abort page resources on `pagehide`: doing so can leave a BFCache-restored page with dead resources. Normal document destruction is sufficient for non-BFCache navigations.

## Agent lifetime

The autonomous worker is server-side and persisted in SQLite. Browser/document lifetime never owns an agent run.

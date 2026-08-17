# First-run handoff

CrowdClaw treats Home planning and the project as separate TradJS 4.3 documents.

```text
Home
  ASSIGNING
  THINKING
  NAME
  LOOP
  1 / 3
  2 / 3
  READY
      ↓ normal navigation
Project
  FUNDING
  STARTING
  BUILDING
  SHIPPING
  V1
```

The project stage is state-driven. During `seeding` it visualizes the CrowdClaw treasury transfer. A pending CrowdClaw supporter row is rendered optimistically from the first milestone target even before the grant row is visible, then becomes authoritative from the persisted treasury grant. The confirmed on-chain balance is still the funding source of truth.

Build activity starts with deterministic operations already performed by the project agent (`OPEN WORKSPACE`, `FILES`) and then appends explicit public `status` and file-tool actions from `jsx-ai`. It never exposes private chain-of-thought.

When `artifact.published` reaches the page over SSE, the same stage renders the immutable artifact iframe and its reveal animation. No reload is required.

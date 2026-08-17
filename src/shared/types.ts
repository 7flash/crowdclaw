export type ProjectStatus =
  | "planning"
  | "seeding"
  | "waiting_funds"
  | "queued"
  | "working"
  | "validating"
  | "publishing"
  | "completed"
  | "failed";

export type MilestoneState = "queued" | "working" | "shipped";

export type Milestone = {
  title: string;
  costCredits: number;
  state: MilestoneState;
  createdAt: number;
  completedAt?: number;
  artifactVersion?: number;
};

export type Project = {
  id: string;
  name: string;
  idea: string;
  summary: string;
  status: ProjectStatus;
  agentId: string;
  walletAddress: string;
  milestones: Milestone[];
  done: number;
  spentCredits: number;
  reservedCredits: number;
  onchainLamports: number;
  creditedLamports: number;
  manualCredits: number;
  fundedCredits: number;
  availableCredits: number;
  currentRunId: string | null;
  agentNote: string;
  streamPreview: string;
  lastFundingSyncAt: number;
  fundingError: string;
  failureCount: number;
  retryAt: number;
  error: string;
  createdAt: number;
  updatedAt: number;
};

export type Artifact = {
  id: string;
  projectId: string;
  version: number;
  milestoneTitle: string;
  html: string;
  sha256: string;
  runId: string;
  createdAt: number;
};

export type ArtifactSummary = Omit<Artifact, "html">;

export type RunKind = "plan" | "build";
export type RunStatus = "running" | "complete" | "failed";

export type AgentRun = {
  id: string;
  projectId: string;
  kind: RunKind;
  status: RunStatus;
  milestoneIndex: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  lastContextTokens: number;
  contextWindow: number;
  remainingContextTokens: number;
  usageEstimated: boolean;
  streamChars: number;
  preview: string;
  note: string;
  error: string;
  startedAt: number;
  finishedAt: number;
  chargedCredits: number;
};

export type ProjectEvent = {
  id: string;
  projectId: string;
  type: string;
  message: string;
  createdAt: number;
};

export type DonationSource = "supporter" | "platform_seed";

export type Donation = {
  id: string;
  projectId: string;
  signature: string;
  fromAddress: string;
  lamports: number;
  credits: number;
  slot: number;
  blockTime: number;
  confirmedAt: number;
  source: DonationSource;
};

export type TreasuryGrant = {
  id: string;
  projectId: string;
  purpose: "first_milestone";
  status: "pending" | "submitted" | "confirmed" | "failed";
  fromAddress: string;
  toAddress: string;
  lamports: number;
  signature: string;
  error: string;
  createdAt: number;
  updatedAt: number;
};

export type Supporter = {
  address: string;
  donatedLamports: number;
  influenceEarned: number;
  influenceSpent: number;
  influenceAvailable: number;
};

export type Steering = {
  id: string;
  projectId: string;
  fromAddress: string;
  instruction: string;
  influence: number;
  status: "open" | "consumed";
  createdAt: number;
  consumedAt: number;
  consumedMilestoneIndex: number;
};

export type LedgerKind =
  "funding" | "manual" | "milestone_spend" | "legacy_funding" | "legacy_spend";

export type CreditLedgerEntry = {
  id: string;
  projectId: string;
  kind: LedgerKind;
  credits: number;
  runId: string;
  milestoneIndex: number;
  reference: string;
  note: string;
  createdAt: number;
};

export type UsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  buildTokens: number;
  tokensPerSpentCredit: number;
  estimatedFundedTokenRunway: number;
  latestContextTokens: number;
  contextWindow: number;
  remainingContextTokens: number;
};

export type ProjectBundle = {
  project: Project;
  artifacts: ArtifactSummary[];
  runs: AgentRun[];
  events: ProjectEvent[];
  donations: Donation[];
  treasuryGrants: TreasuryGrant[];
  supporters: Supporter[];
  steering: Steering[];
  ledger: CreditLedgerEntry[];
  usage: UsageSummary;
  lamportsPerCredit: number;
  devFundingEnabled: boolean;
};

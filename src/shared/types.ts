export type ProjectStatus =
  | "planning"
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
  streamChars: number;
  preview: string;
  note: string;
  error: string;
  startedAt: number;
  finishedAt: number;
};

export type ProjectEvent = {
  id: string;
  projectId: string;
  type: string;
  message: string;
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
  usage: UsageSummary;
  lamportsPerCredit: number;
  devFundingEnabled: boolean;
};

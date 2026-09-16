export type Gender = "Male" | "Female";
export type ClusterCode = "P1P2" | "P3P4" | "P5P6";
export type GroupCode = "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
export type PreferenceTier = ClusterCode | "NONE";
export type RankIndex = 0 | 1 | 2;
export type MatchedRank = RankIndex | -1;

export const GROUP_CODES: readonly GroupCode[] = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
export const CLUSTER_CODES: readonly ClusterCode[] = ["P1P2", "P3P4", "P5P6"] as const;

export const CLUSTER_MEMBERS: Record<ClusterCode, readonly GroupCode[]> = {
  P1P2: ["P1", "P2"],
  P3P4: ["P3", "P4"],
  P5P6: ["P5", "P6"],
};

export type SkillName =
  | "Child Psych"
  | "MC & Games"
  | "Housewife"
  | "Handicrafts"
  | "Drill"
  | "Admin"
  | "IT & AI"
  | "Finance"
  | "Logistics"
  | "Pioneering"
  | "Camping"
  | "First Aid"
  | "Cooking"
  | "Eco / Navigation"
  | "Water Sports"
  | "Astronomy"
  | "Quartermaster"
  | "Youth Leader";

export const SKILL_NAMES: readonly SkillName[] = [
  "Child Psych",
  "MC & Games",
  "Housewife",
  "Handicrafts",
  "Drill",
  "Admin",
  "IT & AI",
  "Finance",
  "Logistics",
  "Pioneering",
  "Camping",
  "First Aid",
  "Cooking",
  "Eco / Navigation",
  "Water Sports",
  "Astronomy",
  "Quartermaster",
  "Youth Leader",
] as const;

export const SKILL_COUNT = SKILL_NAMES.length;

export type LeaderInput = {
  id: string;
  name: string;
  gender: Gender;
  rankPreferences: [PreferenceTier, PreferenceTier, PreferenceTier];
  skills: number[];
};

export type LeaderAllocation = {
  leaderId: string;
  group: GroupCode;
  cluster: ClusterCode;
  matchedRank: MatchedRank;
};

export type AllocationResult = {
  allocations: LeaderAllocation[];
  groups: Record<GroupCode, { leaderIds: string[]; maleCount: number; femaleCount: number }>;
  clusters: Record<ClusterCode, { leaderIds: string[] }>;
  warnings: string[];
};

export type KPIConfig = {
  rankPoints: [number, number, number];
  weightMatrix: Record<SkillName, [number, number, number]>;
  safetySkills: { p5p6: string[]; p1p2: string[] };
};

export type MCConfig = {
  iterations: number;
  seed: number;
};

export type KPIResult = {
  rank1HitRate: number;
  rank2HitRate: number;
  rank3OrForcedRate: number;
  genderParityScore: number;
  coverageScore: number;
  contributionScore: number;
  weightedTotal: number;
};

export type AllocationMetrics = {
  rankCounts: [number, number, number];
  forcedCount: number;
  groupParity: Record<GroupCode, number>;
  totalLeaders: number;
  genderDistribution: { males: number; females: number };
};

export type ScenarioResult = {
  name: string;
  allocation: AllocationResult;
  kpi: KPIResult;
  metrics: AllocationMetrics;
};

export type FixedAllocation = AllocationResult & {
  kpi: KPIResult;
  metrics: AllocationMetrics;
};

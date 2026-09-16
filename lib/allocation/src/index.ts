export type {
  Gender,
  ClusterCode,
  GroupCode,
  PreferenceTier,
  RankIndex,
  MatchedRank,
  SkillName,
  LeaderInput,
  LeaderAllocation,
  AllocationResult,
  KPIConfig,
  MCConfig,
  KPIResult,
  AllocationMetrics,
  ScenarioResult,
  FixedAllocation,
} from "./types";

export { GROUP_CODES, CLUSTER_CODES, CLUSTER_MEMBERS, SKILL_NAMES, SKILL_COUNT } from "./types";
export { SKILL_INDEX, EXPERTISE_TO_SKILL, WEIGHT_MATRIX, CLUSTER_INDEX, WEIGHT_ARRAY, expertiseToSkillVector, DEFAULT_KPI_CONFIG, DEFAULT_MC_CONFIG } from "./weights";
export { preferenceMatchScore, matchedRank, skillWeightSum, totalScore, bestClusterForLeader, hasSafetySkill, nonCoreSkillSum } from "./scoring";
export { allocate, shuffleWithSeed } from "./allocator";
export { computeMetrics, computeKPI, runFixed, runMonteCarlo } from "./mc";
export type { MCDistribution, MCResult, FixedResult } from "./mc";
export { executiveSummary, masterTable, qualityAudit, mcSummary, fullReport } from "./report";

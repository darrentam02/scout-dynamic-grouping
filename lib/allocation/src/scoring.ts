import type { LeaderInput, SkillName, ClusterCode, KPIConfig } from "./types";
import { SKILL_INDEX, CLUSTER_INDEX, WEIGHT_ARRAY } from "./weights";

const CLUSTER_KEYS: readonly ClusterCode[] = ["P1P2", "P3P4", "P5P6"];

export function preferenceMatchScore(
  leader: LeaderInput,
  cluster: ClusterCode,
  config: KPIConfig,
): number {
  for (let rank = 0; rank < 3; rank++) {
    if (leader.rankPreferences[rank] === cluster) return config.rankPoints[rank];
    if (leader.rankPreferences[rank] === "NONE") continue;
  }
  return 0;
}

export function matchedRank(leader: LeaderInput, cluster: ClusterCode): 0 | 1 | 2 | -1 {
  for (let rank = 0; rank < 3; rank++) {
    if (leader.rankPreferences[rank] === cluster) return rank as 0 | 1 | 2;
  }
  return -1;
}

export function skillWeightSum(leader: LeaderInput, cluster: ClusterCode, config: KPIConfig): number {
  const ci = CLUSTER_INDEX[cluster];
  let sum = 0;
  for (let i = 0; i < leader.skills.length && i < WEIGHT_ARRAY.length; i++) {
    if (!leader.skills[i]) continue;
    sum += WEIGHT_ARRAY[i][ci];
  }
  return sum;
}

export function totalScore(leader: LeaderInput, cluster: ClusterCode, config: KPIConfig): number {
  return preferenceMatchScore(leader, cluster, config) + skillWeightSum(leader, cluster, config);
}

export function bestClusterForLeader(leader: LeaderInput, config: KPIConfig): ClusterCode {
  let best = CLUSTER_KEYS[0];
  let bestScore = -Infinity;
  for (const cluster of CLUSTER_KEYS) {
    const score = totalScore(leader, cluster, config);
    if (score > bestScore) {
      bestScore = score;
      best = cluster;
    }
  }
  return best;
}

export function hasSafetySkill(leader: LeaderInput, skillNames: string[]): boolean {
  for (const name of skillNames) {
    const idx = SKILL_INDEX[name as SkillName];
    if (idx !== undefined && (leader.skills[idx] ?? 0) > 0) return true;
  }
  return false;
}

export function nonCoreSkillSum(leader: LeaderInput, config: KPIConfig): number {
  let sum = 0;
  for (let i = 0; i < leader.skills.length && i < WEIGHT_ARRAY.length; i++) {
    if (!leader.skills[i]) continue;
    const triple = WEIGHT_ARRAY[i];
    sum += (triple[0] + triple[1] + triple[2]) / 3;
  }
  return sum;
}
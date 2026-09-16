import type {
  LeaderInput,
  GroupCode,
  ClusterCode,
  KPIConfig,
  AllocationResult,
  LeaderAllocation,
} from "./types";
import { GROUP_CODES, CLUSTER_CODES, CLUSTER_MEMBERS } from "./types";
import {
  totalScore,
  matchedRank,
  skillWeightSum,
  hasSafetySkill,
  nonCoreSkillSum,
} from "./scoring";

const CLUSTER_CAP = 12;
const GROUP_CAP = 6;

export type AllocateOptions = {
  lockedGroups?: ReadonlyMap<string, GroupCode>;
};

export function allocate(
  leaders: LeaderInput[],
  config: KPIConfig,
  options: AllocateOptions = {},
): AllocationResult {
  const groups = {} as AllocationResult["groups"];
  for (const code of GROUP_CODES) {
    groups[code] = { leaderIds: [], maleCount: 0, femaleCount: 0 };
  }
  const clusters = {} as AllocationResult["clusters"];
  for (const code of CLUSTER_CODES) {
    clusters[code] = { leaderIds: [] };
  }
  const result: AllocationResult = {
    allocations: [],
    groups,
    clusters,
    warnings: [],
  };

  const clusterPools: Record<ClusterCode, LeaderInput[]> = {
    P1P2: [],
    P3P4: [],
    P5P6: [],
  };
  const placed = new Set<string>();

  if (options.lockedGroups) {
    const leadersById = new Map(leaders.map((leader) => [leader.id, leader]));

    for (const [leaderId, groupCode] of options.lockedGroups) {
      const leader = leadersById.get(leaderId);
      if (!leader) continue;

      const group = result.groups[groupCode];
      if (!group) continue;

      group.leaderIds.push(leader.id);
      if (leader.gender === "Male") group.maleCount++;
      else group.femaleCount++;
      result.clusters[clusterForGroup(groupCode)].leaderIds.push(leader.id);
      result.allocations.push({
        leaderId: leader.id,
        group: groupCode,
        cluster: clusterForGroup(groupCode),
        matchedRank: matchedRank(leader, clusterForGroup(groupCode)),
      });
      placed.add(leader.id);
    }

    allocateIntoOpenGroups(
      leaders.filter((leader) => !placed.has(leader.id)),
      result,
      config,
    );

    return result;
  }

  // Step 1: Safety locks
  for (const leader of leaders) {
    if (placed.has(leader.id)) continue;

    if (hasSafetySkill(leader, config.safetySkills.p5p6) && clusterPools.P5P6.length < CLUSTER_CAP) {
      clusterPools.P5P6.push(leader);
      placed.add(leader.id);
    }
  }

  for (const leader of leaders) {
    if (placed.has(leader.id)) continue;

    if (hasSafetySkill(leader, config.safetySkills.p1p2) && clusterPools.P1P2.length < CLUSTER_CAP) {
      clusterPools.P1P2.push(leader);
      placed.add(leader.id);
    }
  }

  // Step 2: Assign remaining by score, with overflow
  const remaining = leaders.filter((l) => !placed.has(l.id));

  for (const leader of remaining) {
    const candidates = CLUSTER_CODES
      .map((cluster) => ({
        cluster,
        score: totalScore(leader, cluster, config),
        remaining: CLUSTER_CAP - clusterPools[cluster].length,
      }))
      .filter((c) => c.remaining > 0)
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      result.warnings.push(`${leader.name} could not be placed — all clusters at capacity.`);
      continue;
    }

    clusterPools[candidates[0].cluster].push(leader);
    placed.add(leader.id);
  }

  // Step 3: Split each cluster into 2 sub-groups of exactly 6
  for (const clusterCode of CLUSTER_CODES) {
    const pool = clusterPools[clusterCode];
    const [g1Code, g2Code] = CLUSTER_MEMBERS[clusterCode];

    const { g1, g2 } = splitClusterPool(pool, config);

    for (const leader of g1) {
      result.allocations.push({
        leaderId: leader.id,
        group: g1Code,
        cluster: clusterCode,
        matchedRank: matchedRank(leader, clusterCode),
      });
      result.groups[g1Code].leaderIds.push(leader.id);
      if (leader.gender === "Male") result.groups[g1Code].maleCount++;
      else result.groups[g1Code].femaleCount++;
      result.clusters[clusterCode].leaderIds.push(leader.id);
    }

    for (const leader of g2) {
      result.allocations.push({
        leaderId: leader.id,
        group: g2Code,
        cluster: clusterCode,
        matchedRank: matchedRank(leader, clusterCode),
      });
      result.groups[g2Code].leaderIds.push(leader.id);
      if (leader.gender === "Male") result.groups[g2Code].maleCount++;
      else result.groups[g2Code].femaleCount++;
      result.clusters[clusterCode].leaderIds.push(leader.id);
    }
  }

  // Validate group sizes
  for (const code of GROUP_CODES) {
    const count = result.groups[code].leaderIds.length;
    if (count !== GROUP_CAP) {
      result.warnings.push(`${code} has ${count} leaders (expected ${GROUP_CAP}).`);
    }
  }

  return result;
}

function clusterForGroup(groupCode: GroupCode): ClusterCode {
  if (groupCode === "P1" || groupCode === "P2") return "P1P2";
  if (groupCode === "P3" || groupCode === "P4") return "P3P4";
  return "P5P6";
}

function allocateIntoOpenGroups(
  leaders: LeaderInput[],
  result: AllocationResult,
  config: KPIConfig,
) {
  for (const leader of leaders) {
    const candidates = GROUP_CODES
      .map((groupCode) => {
        const group = result.groups[groupCode];
        const cluster = clusterForGroup(groupCode);
        return {
          groupCode,
          cluster,
          score: totalScore(leader, cluster, config),
          remaining: GROUP_CAP - group.leaderIds.length,
        };
      })
      .filter((candidate) => candidate.remaining > 0)
      .sort((a, b) => b.score - a.score || b.remaining - a.remaining);

    const candidate = candidates[0];
    if (!candidate) {
      result.warnings.push(`${leader.name} could not be placed — all groups at capacity.`);
      continue;
    }

    const group = result.groups[candidate.groupCode];
    group.leaderIds.push(leader.id);
    if (leader.gender === "Male") group.maleCount++;
    else group.femaleCount++;
    result.clusters[candidate.cluster].leaderIds.push(leader.id);
    result.allocations.push({
      leaderId: leader.id,
      group: candidate.groupCode,
      cluster: candidate.cluster,
      matchedRank: matchedRank(leader, candidate.cluster),
    });
  }
}

function splitClusterPool(
  pool: LeaderInput[],
  config: KPIConfig,
): { g1: LeaderInput[]; g2: LeaderInput[] } {
  const males = pool.filter((l) => l.gender === "Male");
  const females = pool.filter((l) => l.gender === "Female");

  // Split gender proportionally: each group gets exactly 6
  const g1MaleCount = Math.round(males.length / 2);
  const g1FemaleCount = GROUP_CAP - g1MaleCount;
  const g2MaleCount = males.length - g1MaleCount;
  const g2FemaleCount = females.length - g1FemaleCount;

  // Step 4: Tie-breaker — sort by non-core skill sum descending within each gender
  const sortByTieBreaker = (a: LeaderInput, b: LeaderInput) =>
    nonCoreSkillSum(b, config) - nonCoreSkillSum(a, config);

  const sortedMales = [...males].sort(sortByTieBreaker);
  const sortedFemales = [...females].sort(sortByTieBreaker);

  const g1Males = sortedMales.slice(0, g1MaleCount);
  const g1Females = sortedFemales.slice(0, g1FemaleCount);
  const g2Males = sortedMales.slice(g1MaleCount, g1MaleCount + g2MaleCount);
  const g2Females = sortedFemales.slice(g1FemaleCount, g1FemaleCount + g2FemaleCount);

  return {
    g1: [...g1Males, ...g1Females],
    g2: [...g2Males, ...g2Females],
  };
}

export function shuffleWithSeed<T>(array: T[], seed: number): T[] {
  const result = [...array];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

import type {
  LeaderInput,
  GroupCode,
  KPIConfig,
  MCConfig,
  AllocationResult,
  KPIResult,
  AllocationMetrics,
} from "./types";
import { GROUP_CODES } from "./types";
import { allocate, shuffleWithSeed } from "./allocator";

export function computeMetrics(allocation: AllocationResult): AllocationMetrics {
  const rankCounts: [number, number, number] = [0, 0, 0];
  let forcedCount = 0;

  for (const a of allocation.allocations) {
    if (a.matchedRank === 0 || a.matchedRank === 1 || a.matchedRank === 2) {
      rankCounts[a.matchedRank]++;
    } else {
      forcedCount++;
    }
  }

  const groupParity: Record<GroupCode, number> = {} as any;
  for (const code of GROUP_CODES) {
    const g = allocation.groups[code];
    const total = g.maleCount + g.femaleCount;
    groupParity[code] = total > 0
      ? Math.min(g.maleCount, g.femaleCount) / Math.max(g.maleCount, g.femaleCount)
      : 0;
  }

  const totalLeaders = allocation.allocations.length;

  let actualMales = 0;
  let actualFemales = 0;
  for (const code of GROUP_CODES) {
    const g = allocation.groups[code];
    actualMales += g.maleCount;
    actualFemales += g.femaleCount;
  }

  return {
    rankCounts,
    forcedCount,
    groupParity,
    totalLeaders,
    genderDistribution: { males: actualMales, females: actualFemales },
  };
}

export function computeKPI(metrics: AllocationMetrics, config: KPIConfig): KPIResult {
  const total = metrics.totalLeaders;
  if (total === 0) {
    return {
      rank1HitRate: 0,
      rank2HitRate: 0,
      rank3OrForcedRate: 0,
      genderParityScore: 0,
      coverageScore: 0,
      contributionScore: 0,
      weightedTotal: 0,
    };
  }

  const rank1HitRate = metrics.rankCounts[0] / total;
  const rank2HitRate = metrics.rankCounts[1] / total;
  const rank3OrForcedRate = (metrics.rankCounts[2] + metrics.forcedCount) / total;

  const parityValues = Object.values(metrics.groupParity);
  const genderParityScore =
    parityValues.reduce((s, v) => s + v, 0) / parityValues.length;

  const expectedGroupSize = total / GROUP_CODES.length;
  const coverageScore =
    GROUP_CODES.reduce((sum, code) => {
      const g = metrics.groupParity[code];
      return sum + Math.min(1, (metrics.totalLeaders > 0 ? 1 : 0));
    }, 0) / GROUP_CODES.length;

  const contributionScore = genderParityScore;

  const weightedTotal =
    rank1HitRate * 0.4 +
    rank2HitRate * 0.2 +
    genderParityScore * 0.2 +
    coverageScore * 0.1 +
    contributionScore * 0.1;

  return {
    rank1HitRate,
    rank2HitRate,
    rank3OrForcedRate,
    genderParityScore,
    coverageScore,
    contributionScore,
    weightedTotal,
  };
}

export type FixedResult = {
  allocation: AllocationResult;
  metrics: AllocationMetrics;
  kpi: KPIResult;
};

export function runFixed(
  leaders: LeaderInput[],
  config: KPIConfig,
): FixedResult {
  const allocation = allocate(leaders, config);
  const metrics = computeMetrics(allocation);
  const kpi = computeKPI(metrics, config);
  return { allocation, metrics, kpi };
}

export type MCDistribution = {
  rank1HitRates: number[];
  rank2HitRates: number[];
  genderParityScores: number[];
  coverageScores: number[];
  contributionScores: number[];
  weightedTotals: number[];
};

export type MCResult = FixedResult & {
  distribution: MCDistribution;
  iterations: number;
  seed: number;
};

export function runMonteCarlo(
  leaders: LeaderInput[],
  config: KPIConfig,
  mcConfig: MCConfig,
): MCResult {
  const { iterations, seed } = mcConfig;
  const distribution: MCDistribution = {
    rank1HitRates: [],
    rank2HitRates: [],
    genderParityScores: [],
    coverageScores: [],
    contributionScores: [],
    weightedTotals: [],
  };

  let bestWeighted = -1;
  let bestResult: FixedResult | null = null;

  for (let i = 0; i < iterations; i++) {
    const runSeed = seed + i;
    const shuffled = shuffleWithSeed(leaders, runSeed);
    const allocation = allocate(shuffled, config);
    const metrics = computeMetrics(allocation);
    const kpi = computeKPI(metrics, config);

    distribution.rank1HitRates.push(kpi.rank1HitRate);
    distribution.rank2HitRates.push(kpi.rank2HitRate);
    distribution.genderParityScores.push(kpi.genderParityScore);
    distribution.coverageScores.push(kpi.coverageScore);
    distribution.contributionScores.push(kpi.contributionScore);
    distribution.weightedTotals.push(kpi.weightedTotal);

    if (kpi.weightedTotal > bestWeighted) {
      bestWeighted = kpi.weightedTotal;
      bestResult = { allocation, metrics, kpi };
    }
  }

  return {
    ...(bestResult ?? runFixed(leaders, config)),
    distribution,
    iterations,
    seed,
  };
}

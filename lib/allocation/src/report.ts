import type {
  LeaderInput,
  GroupCode,
  ClusterCode,
  AllocationResult,
  KPIResult,
  AllocationMetrics,
} from "./types";
import type { MCResult } from "./mc";
import { GROUP_CODES, CLUSTER_CODES, CLUSTER_MEMBERS } from "./types";
import { SKILL_INDEX } from "./weights";

type LeaderMap = Map<string, LeaderInput>;

function buildLeaderMap(leaders: LeaderInput[]): LeaderMap {
  return new Map(leaders.map((l) => [l.id, l]));
}

export function executiveSummary(
  leaders: LeaderInput[],
  result: AllocationResult,
  metrics: AllocationMetrics,
  kpi: KPIResult,
): string {
  const lines: string[] = [];
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`**Total leaders processed:** ${leaders.length}`);
  lines.push("");

  const maleCount = leaders.filter((l) => l.gender === "Male").length;
  const femaleCount = leaders.filter((l) => l.gender === "Female").length;
  lines.push(`**Gender distribution:** ${maleCount} male, ${femaleCount} female (${(femaleCount / leaders.length * 100).toFixed(1)}% female)`);
  lines.push("");

  lines.push("### Cluster allocation");
  for (const cluster of CLUSTER_CODES) {
    const count = result.clusters[cluster].leaderIds.length;
    const members = CLUSTER_MEMBERS[cluster];
    lines.push(`- **${cluster}** (${members.join('+')}): ${count} leaders (cap 12)`);
  }
  lines.push("");

  lines.push("### Preference hit rates");
  lines.push(`- **Rank 1 (first choice):** ${(kpi.rank1HitRate * 100).toFixed(1)}% (${metrics.rankCounts[0]}/${leaders.length})`);
  lines.push(`- **Rank 2 (second choice):** ${(kpi.rank2HitRate * 100).toFixed(1)}% (${metrics.rankCounts[1]}/${leaders.length})`);
  lines.push(`- **Rank 3 / Forced:** ${(kpi.rank3OrForcedRate * 100).toFixed(1)}% (${metrics.rankCounts[2] + metrics.forcedCount}/${leaders.length})`);
  lines.push("");

  lines.push("### Quality metrics");
  lines.push(`- **Gender parity score:** ${(kpi.genderParityScore * 100).toFixed(1)}%`);
  lines.push(`- **Coverage score:** ${(kpi.coverageScore * 100).toFixed(1)}%`);
  lines.push(`- **Contribution score:** ${(kpi.contributionScore * 100).toFixed(1)}%`);
  lines.push(`- **Weighted total:** ${(kpi.weightedTotal * 100).toFixed(1)}%`);

  return lines.join("\n");
}

export function masterTable(
  leaders: LeaderInput[],
  result: AllocationResult,
): string {
  const leaderMap = buildLeaderMap(leaders);
  const lines: string[] = [];

  lines.push("## Final Group Allocation Master Table");
  lines.push("");

  const clusterLabels: Record<ClusterCode, string> = {
    P1P2: "小童軍區",
    P3P4: "幼童軍區",
    P5P6: "童軍區",
  };

  for (const cluster of CLUSTER_CODES) {
    const members = CLUSTER_MEMBERS[cluster];
    lines.push(`### ${clusterLabels[cluster]} (${cluster})`);

    for (const groupCode of members) {
      const group = result.groups[groupCode];
      const names = group.leaderIds
        .map((id) => leaderMap.get(id)?.name ?? id)
        .join(", ");

      const rankCounts = [0, 0, 0, 0];
      for (const alloc of result.allocations) {
        if (alloc.group === groupCode) {
          if (alloc.matchedRank === -1) rankCounts[3]++;
          else rankCounts[alloc.matchedRank]++;
        }
      }

      const contributedSkills = getTopSkills(
        group.leaderIds.map((id) => leaderMap.get(id)!).filter(Boolean),
      );

      lines.push(
        `- **${groupCode}** (${group.maleCount}M/${group.femaleCount}F): ${names}`
      );
      lines.push(
        `  - R1: ${rankCounts[0]}, R2: ${rankCounts[1]}, R3: ${rankCounts[2]}, Forced: ${rankCounts[3]}`
      );
      lines.push(`  - Skills: ${contributedSkills.join(", ")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function getTopSkills(leaders: LeaderInput[]): string[] {
  const skillCounts = new Map<string, number>();
  for (const leader of leaders) {
    for (let i = 0; i < leader.skills.length; i++) {
      if (leader.skills[i] > 0) {
        const name = Object.entries(SKILL_INDEX).find(([, idx]) => idx === i)?.[0];
        if (name) skillCounts.set(name, (skillCounts.get(name) ?? 0) + 1);
      }
    }
  }
  return [...skillCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}(${count})`);
}

export function qualityAudit(
  leaders: LeaderInput[],
  result: AllocationResult,
): string {
  const leaderMap = buildLeaderMap(leaders);
  const lines: string[] = [];

  lines.push("## Constraint & Quality Audit");
  lines.push("");

  // Capacity verification
  lines.push("### Capacity Verification");
  for (const code of GROUP_CODES) {
    const count = result.groups[code].leaderIds.length;
    const ok = count === 6;
    lines.push(`- ${code}: ${count} leaders ${ok ? "✓" : `✗ (expected 6)`}`);
  }
  for (const code of CLUSTER_CODES) {
    const count = result.clusters[code].leaderIds.length;
    const ok = count === 12;
    lines.push(`- ${code} cluster: ${count} leaders ${ok ? "✓" : `✗ (expected 12)`}`);
  }
  lines.push("");

  // Gender verification
  lines.push("### Gender Verification");
  for (const code of GROUP_CODES) {
    const g = result.groups[code];
    const total = g.maleCount + g.femaleCount;
    const ratio = total > 0 ? Math.min(g.maleCount, g.femaleCount) / Math.max(g.maleCount, g.femaleCount) : 0;
    lines.push(`- ${code}: ${g.maleCount}M/${g.femaleCount}F (balance: ${(ratio * 100).toFixed(0)}%)`);
  }
  lines.push("");

  // Forced allocations
  lines.push("### Forced Allocations (not Rank 1)");
const forced = result.allocations.filter((a) => a.matchedRank !== 0);
    if (forced.length === 0) {
      lines.push("None — all leaders received their first choice.");
    } else {
      for (const alloc of forced) {
        const leader = leaderMap.get(alloc.leaderId);
        if (!leader) continue;
        const reason = alloc.matchedRank === -1 ? "forced (safety/overflow)" : `Rank ${alloc.matchedRank + 1}`;
        lines.push(`- **${leader.name}** → ${alloc.group} (${reason})`);
      }
    }
  lines.push("");

  // Warnings
  if (result.warnings.length > 0) {
    lines.push("### Warnings");
    for (const w of result.warnings) {
      lines.push(`- ${w}`);
    }
  }

  return lines.join("\n");
}

export function mcSummary(mcResult: MCResult): string {
  const { distribution, iterations, seed } = mcResult;
  const lines: string[] = [];

  lines.push("## Monte Carlo Simulation Summary");
  lines.push("");
  lines.push(`**Iterations:** ${iterations}`);
  lines.push(`**Seed:** ${seed}`);
  lines.push("");

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const p = (arr: number[], pct: number) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(pct * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)];
  };

  lines.push("| Metric | Mean | P10 | P50 | P90 |");
  lines.push("|--------|------|-----|-----|-----|");
  lines.push(`| Rank 1 % | ${(avg(distribution.rank1HitRates) * 100).toFixed(1)}% | ${(p(distribution.rank1HitRates, 0.1) * 100).toFixed(1)}% | ${(p(distribution.rank1HitRates, 0.5) * 100).toFixed(1)}% | ${(p(distribution.rank1HitRates, 0.9) * 100).toFixed(1)}% |`);
  lines.push(`| Rank 2 % | ${(avg(distribution.rank2HitRates) * 100).toFixed(1)}% | ${(p(distribution.rank2HitRates, 0.1) * 100).toFixed(1)}% | ${(p(distribution.rank2HitRates, 0.5) * 100).toFixed(1)}% | ${(p(distribution.rank2HitRates, 0.9) * 100).toFixed(1)}% |`);
  lines.push(`| Gender parity | ${(avg(distribution.genderParityScores) * 100).toFixed(1)}% | ${(p(distribution.genderParityScores, 0.1) * 100).toFixed(1)}% | ${(p(distribution.genderParityScores, 0.5) * 100).toFixed(1)}% | ${(p(distribution.genderParityScores, 0.9) * 100).toFixed(1)}% |`);
  lines.push(`| Weighted total | ${(avg(distribution.weightedTotals) * 100).toFixed(1)}% | ${(p(distribution.weightedTotals, 0.1) * 100).toFixed(1)}% | ${(p(distribution.weightedTotals, 0.5) * 100).toFixed(1)}% | ${(p(distribution.weightedTotals, 0.9) * 100).toFixed(1)}% |`);

  return lines.join("\n");
}

export function fullReport(
  leaders: LeaderInput[],
  result: AllocationResult,
  metrics: AllocationMetrics,
  kpi: KPIResult,
  mcResult?: MCResult,
): string {
  const sections: string[] = [];
  sections.push("# Scout Leader Allocation Report");
  sections.push("");

  sections.push(executiveSummary(leaders, result, metrics, kpi));
  sections.push("");
  sections.push(masterTable(leaders, result));
  sections.push("");
  sections.push(qualityAudit(leaders, result));

  if (mcResult) {
    sections.push("");
    sections.push(mcSummary(mcResult));
  }

  return sections.join("\n");
}

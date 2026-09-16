import type { KPIConfig, SkillName } from "./types";
import { SKILL_NAMES } from "./types";

export const SKILL_INDEX: Record<SkillName, number> = {
  "Child Psych": 0,
  "MC & Games": 1,
  "Housewife": 2,
  "Handicrafts": 3,
  "Drill": 4,
  "Admin": 5,
  "IT & AI": 6,
  "Finance": 7,
  "Logistics": 8,
  "Pioneering": 9,
  "Camping": 10,
  "First Aid": 11,
  "Cooking": 12,
  "Eco / Navigation": 13,
  "Water Sports": 14,
  "Astronomy": 15,
  "Quartermaster": 16,
  "Youth Leader": 17,
};

export const EXPERTISE_TO_SKILL: readonly (SkillName | null)[] = [
  "Handicrafts",
  "Eco / Navigation",
  "Camping",
  "Water Sports",
  null,
  "Astronomy",
  "Pioneering",
  "Cooking",
  "Drill",
  "Child Psych",
  "Admin",
  "Finance",
  "Quartermaster",
  "Logistics",
  "MC & Games",
  "First Aid",
  "IT & AI",
  "Housewife",
  "Youth Leader",
  null,
];

export const WEIGHT_MATRIX: Record<SkillName, [number, number, number]> = {
  "Child Psych":      [2.0, 1.5, 1.0],
  "MC & Games":       [2.0, 1.5, 1.0],
  "Housewife":        [2.0, 1.0, 0.5],
  "Handicrafts":      [1.5, 1.0, 0.5],
  "Drill":            [0.5, 2.0, 1.5],
  "Admin":            [0.5, 2.0, 1.5],
  "IT & AI":          [0.5, 2.0, 1.5],
  "Finance":          [0.5, 1.5, 1.0],
  "Logistics":        [0.5, 1.5, 1.5],
  "Pioneering":       [0.0, 1.0, 2.0],
  "Camping":          [0.0, 1.0, 2.0],
  "First Aid":        [0.5, 1.5, 2.0],
  "Cooking":          [0.0, 1.0, 2.0],
  "Eco / Navigation": [0.5, 1.0, 2.0],
  "Water Sports":     [0.0, 0.5, 2.0],
  "Astronomy":        [0.5, 1.0, 1.5],
  "Quartermaster":    [0.5, 1.0, 1.5],
  "Youth Leader":     [1.0, 1.5, 2.0],
};

export const CLUSTER_INDEX = { P1P2: 0, P3P4: 1, P5P6: 2 } as const;

export function expertiseToSkillVector(expertise: readonly number[]): number[] {
  const out = new Array<number>(SKILL_NAMES.length).fill(0);
  for (let i = 0; i < expertise.length && i < EXPERTISE_TO_SKILL.length; i++) {
    const skill = EXPERTISE_TO_SKILL[i];
    if (skill && expertise[i]) out[SKILL_INDEX[skill]] = 1;
  }
  return out;
}

export const WEIGHT_ARRAY: readonly (readonly [number, number, number])[] = SKILL_NAMES.map(
  (skill) => WEIGHT_MATRIX[skill],
);

export const DEFAULT_KPI_CONFIG: KPIConfig = {
  rankPoints: [20.0, 5.0, 0.0],
  weightMatrix: WEIGHT_MATRIX,
  safetySkills: {
    p5p6: ["First Aid", "Camping", "Pioneering"],
    p1p2: ["Child Psych", "MC & Games"],
  },
};

export const DEFAULT_MC_CONFIG = {
  iterations: 500,
  seed: 20260916,
};

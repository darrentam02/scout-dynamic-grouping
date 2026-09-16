import { Router, type IRouter } from "express";
import { randomInt, randomUUID } from "node:crypto";
import {
  AddParticipantBody,
  CreateRoomBody,
  GetRoomParams,
} from "@workspace/api-zod";
import {
  type PreferenceTier,
  type LeaderInput,
  type MCResult,
  type KPIResult,
  runMonteCarlo,
  DEFAULT_KPI_CONFIG,
  DEFAULT_MC_CONFIG,
  expertiseToSkillVector,
} from "@workspace/allocation";

type GroupCode = "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
type Gender = "Male" | "Female";
type Preference = PreferenceTier;
type Status = "UNASSIGNED" | "ASSIGNED" | "NEW_UNASSIGNED";

type Participant = {
  id: string;
  name: string;
  gender: Gender;
  preference: Preference;
  rank2Preference: Preference;
  rank3Preference: Preference;
  expertise: number[];
  status: Status;
  assignedGroup: GroupCode | null;
};

type Group = {
  code: GroupCode;
  participantIds: string[];
  maleCount: number;
  femaleCount: number;
};

type McStats = {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
};

type MCAllocationSummary = {
  iterations: number;
  seed: number;
  best: {
    kpi: KPIResult;
    rankCounts: [number, number, number];
    forcedCount: number;
  };
  distribution: {
    rank1HitRate: McStats;
    rank2HitRate: McStats;
    genderParityScore: McStats;
    coverageScore: McStats;
    contributionScore: McStats;
    weightedTotal: McStats;
  };
};

type Room = {
  roomCode: string;
  hostName: string;
  hostPassword: string;
  status: "PRE_RUN" | "POST_RUN";
  participants: Participant[];
  groups: Group[];
  allocationWarnings: string[];
  mcSummary: MCAllocationSummary | null;
};

const groupCodes: GroupCode[] = ["P1", "P2", "P3", "P4", "P5", "P6"];
const rooms = new Map<string, Room>();
const mcIterations = DEFAULT_MC_CONFIG.iterations;
const mcSeed = DEFAULT_MC_CONFIG.seed;

const emptyGroups = (): Group[] =>
  groupCodes.map((code) => ({
    code,
    participantIds: [],
    maleCount: 0,
    femaleCount: 0,
  }));

function makeRoomCode() {
  let code = "";
  do code = String(randomInt(100000, 1000000)); while (rooms.has(code));
  return code;
}

function buildLeaders(participants: Participant[]): LeaderInput[] {
  return participants.map((participant) => ({
    id: participant.id,
    name: participant.name,
    gender: participant.gender,
    rankPreferences: [
      participant.preference,
      participant.rank2Preference,
      participant.rank3Preference,
    ] as [Preference, Preference, Preference],
    skills: expertiseToSkillVector(participant.expertise),
  }));
}

function quantile(sorted: number[], pct: number) {
  const index = Math.min(sorted.length - 1, Math.floor(pct * sorted.length));
  return Number(sorted[index].toFixed(4));
}

function statsFor(values: number[]): McStats {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    mean: Number(mean.toFixed(4)),
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
  };
}

function summarizeMc(mc: MCResult): MCAllocationSummary {
  const { distribution, iterations, seed } = mc;
  return {
    iterations,
    seed,
    best: {
      kpi: mc.kpi,
      rankCounts: mc.metrics.rankCounts,
      forcedCount: mc.metrics.forcedCount,
    },
    distribution: {
      rank1HitRate: statsFor(distribution.rank1HitRates),
      rank2HitRate: statsFor(distribution.rank2HitRates),
      genderParityScore: statsFor(distribution.genderParityScores),
      coverageScore: statsFor(distribution.coverageScores),
      contributionScore: statsFor(distribution.contributionScores),
      weightedTotal: statsFor(distribution.weightedTotals),
    },
  };
}

function refreshGroups(room: Room) {
  room.groups = emptyGroups();
  for (const participant of room.participants) {
    if (!participant.assignedGroup) continue;
    const group = room.groups.find((item) => item.code === participant.assignedGroup);
    if (!group) continue;
    group.participantIds.push(participant.id);
    if (participant.gender === "Female") group.femaleCount += 1;
    else group.maleCount += 1;
  }
}

function applyEngineResult(room: Room) {
  const leaders = buildLeaders(room.participants);
  const mc = runMonteCarlo(leaders, DEFAULT_KPI_CONFIG, { iterations: mcIterations, seed: mcSeed });
  const result = mc.allocation;
  const assignedByGroup = new Map<GroupCode, Set<string>>();
  for (const assignment of result.allocations) {
    const group = assignedByGroup.get(assignment.group) ?? new Set<string>();
    group.add(assignment.leaderId);
    assignedByGroup.set(assignment.group, group);
  }

  for (const participant of room.participants) {
    const matchedGroup = groupCodes.find((code) =>
      assignedByGroup.get(code)?.has(participant.id),
    );
    participant.assignedGroup = matchedGroup ?? null;
    participant.status = matchedGroup ? "ASSIGNED" : "UNASSIGNED";
  }

  refreshGroups(room);
  room.allocationWarnings = result.warnings;
  room.mcSummary = summarizeMc(mc);
  room.status = "POST_RUN";
}

function collectAllocationWarnings(room: Room, onlyNew: boolean) {
  const warnings: string[] = [];
  const unassigned = room.participants.filter((participant) => !participant.assignedGroup);
  if (unassigned.length) {
    warnings.push(`${unassigned.length} ${onlyNew ? "new arrival" : "participant"}${unassigned.length === 1 ? "" : "s"} could not be placed because no group capacity remained.`);
  }
  return warnings;
}

function allocate(room: Room, onlyNew = false) {
  if (!onlyNew) {
    for (const participant of room.participants) {
      participant.assignedGroup = null;
      participant.status = "UNASSIGNED";
    }
    applyEngineResult(room);
    return;
  }

  // Incremental allocation: re-run everything deterministic on the full roster,
  // then only apply to NEW_UNASSIGNED participants so existing groups stay locked.
  const previouslyAssigned = room.participants.filter(
    (participant) => participant.status === "ASSIGNED",
  );
  const newArrivals = room.participants.filter(
    (participant) => participant.status === "NEW_UNASSIGNED",
  );

  const mergedLeaders = buildLeaders([...previouslyAssigned, ...newArrivals]);

  const mc = runMonteCarlo(mergedLeaders, DEFAULT_KPI_CONFIG, { iterations: mcIterations, seed: mcSeed });
  const assignedByGroup = new Map<GroupCode, Set<string>>();
  for (const assignment of mc.allocation.allocations) {
    const group = assignedByGroup.get(assignment.group) ?? new Set<string>();
    group.add(assignment.leaderId);
    assignedByGroup.set(assignment.group, group);
  }

  for (const participant of room.participants) {
    if (participant.status !== "NEW_UNASSIGNED") continue;
    const matchedGroup = groupCodes.find((code) =>
      assignedByGroup.get(code)?.has(participant.id),
    );
    participant.assignedGroup = matchedGroup ?? null;
    participant.status = matchedGroup ? "ASSIGNED" : "NEW_UNASSIGNED";
  }

  refreshGroups(room);
  room.allocationWarnings = collectAllocationWarnings(room, true);
  room.mcSummary = summarizeMc(mc);
  room.status = "POST_RUN";
}

const router: IRouter = Router();

router.post("/rooms", (req, res) => {
  const input = CreateRoomBody.parse(req.body);
  const room: Room = {
    roomCode: makeRoomCode(),
    hostName: input.hostName,
    hostPassword: `NL-${randomInt(1000, 10000)}`,
    status: "PRE_RUN",
    participants: [],
    groups: emptyGroups(),
    allocationWarnings: [],
    mcSummary: null,
  };
  rooms.set(room.roomCode, room);
  res.status(201).json(room);
});

router.get("/rooms/:roomCode", (req, res) => {
  const { roomCode } = GetRoomParams.parse(req.params);
  const room = rooms.get(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });
  return res.json(room);
});

router.post("/rooms/:roomCode/participants", (req, res) => {
  const { roomCode } = GetRoomParams.parse(req.params);
  const room = rooms.get(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });
  const input = AddParticipantBody.parse(req.body);
  const participant: Participant = {
    ...input,
    id: randomUUID(),
    status: room.status === "POST_RUN" ? "NEW_UNASSIGNED" : "UNASSIGNED",
    assignedGroup: null,
  };
  room.participants.push(participant);
  return res.status(201).json(participant);
});

router.post("/rooms/:roomCode/grouping", (req, res) => {
  const { roomCode } = GetRoomParams.parse(req.params);
  const room = rooms.get(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });
  allocate(room);
  return res.json(room);
});

router.post("/rooms/:roomCode/grouping/new", (req, res) => {
  const { roomCode } = GetRoomParams.parse(req.params);
  const room = rooms.get(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });
  allocate(room, true);
  return res.json(room);
});

router.post("/rooms/:roomCode/grouping/clear", (req, res) => {
  const { roomCode } = GetRoomParams.parse(req.params);
  const room = rooms.get(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });
  room.status = "PRE_RUN";
  room.participants.forEach((participant) => {
    participant.assignedGroup = null;
    participant.status = "UNASSIGNED";
  });
  refreshGroups(room);
  room.allocationWarnings = [];
  room.mcSummary = null;
  return res.json(room);
});

export default router;
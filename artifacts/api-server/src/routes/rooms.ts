import { Router, type IRouter } from "express";
import { randomInt, randomUUID } from "node:crypto";
import {
  AddParticipantBody,
  CreateRoomBody,
  GetRoomParams,
} from "@workspace/api-zod";

type GroupCode = "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
type Gender = "Male" | "Female";
type Preference = "P1P2" | "P3P4" | "P5P6" | "NONE";
type Status = "UNASSIGNED" | "ASSIGNED" | "NEW_UNASSIGNED";

type Participant = {
  id: string;
  name: string;
  gender: Gender;
  preference: Preference;
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

type Room = {
  roomCode: string;
  hostName: string;
  hostPassword: string;
  status: "PRE_RUN" | "POST_RUN";
  participants: Participant[];
  groups: Group[];
  allocationWarnings: string[];
};

const groupCodes: GroupCode[] = ["P1", "P2", "P3", "P4", "P5", "P6"];
const rooms = new Map<string, Room>();
const similarFemaleThreshold = 0.75;

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

function expertisePreference(expertise: number[]): Preference {
  if (expertise.slice(6, 14).some(Boolean)) return "P5P6";
  if (expertise.slice(0, 2).some(Boolean)) return "P1P2";
  if (expertise.slice(2, 6).some(Boolean)) return "P3P4";
  return "NONE";
}

function preferencePenalty(participant: Participant, code: GroupCode) {
  const mappedPreference = expertisePreference(participant.expertise);
  const preference =
    mappedPreference === "P5P6" || participant.preference === "NONE"
      ? mappedPreference === "P5P6" ? "P5P6" : participant.preference
      : participant.preference;
  if (preference === "NONE") return 0;
  const preferred =
    preference === "P1P2" ? ["P1", "P2"] :
    preference === "P3P4" ? ["P3", "P4"] : ["P5", "P6"];
  return preferred.includes(code) ? 0 : 1;
}

function similarity(a: number[], b: number[]) {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < 20; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    aNorm += (a[i] ?? 0) ** 2;
    bNorm += (b[i] ?? 0) ** 2;
  }
  return aNorm && bNorm ? dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm)) : 0;
}

function capacityByGroup(participantCount: number) {
  const base = Math.floor(participantCount / groupCodes.length);
  const remainder = participantCount % groupCodes.length;
  return new Map(groupCodes.map((code, index) => [code, base + (index < remainder ? 1 : 0)]));
}

function groupMembers(group: Group, room: Room) {
  const memberIds = new Set(group.participantIds);
  return room.participants.filter((participant) => memberIds.has(participant.id));
}

function similarFemaleCount(participant: Participant, group: Group, room: Room) {
  return groupMembers(group, room)
    .filter((member) => member.gender === "Female")
    .filter((member) => similarity(participant.expertise, member.expertise) >= similarFemaleThreshold)
    .length;
}

function femaleSimilarityDegree(participant: Participant, females: Participant[]) {
  return females.filter((other) => other.id !== participant.id)
    .filter((other) => similarity(participant.expertise, other.expertise) >= similarFemaleThreshold)
    .length;
}

function expertiseSignalCount(participant: Participant) {
  return participant.expertise.reduce((count, value) => count + (value ? 1 : 0), 0);
}

function orderedGroupsFor(
  participant: Participant,
  room: Room,
  capacities: Map<GroupCode, number>,
) {
  const withCapacity = room.groups.filter((group) => group.participantIds.length < (capacities.get(group.code) ?? 0));
  if (!withCapacity.length) return [];

  const eligible = participant.gender === "Female"
    ? withCapacity.filter((group) => similarFemaleCount(participant, group, room) === 0)
    : withCapacity;
  const candidates = eligible.length ? eligible : withCapacity;

  return [...candidates].sort((left, right) => {
    const leftSimilar = participant.gender === "Female" ? similarFemaleCount(participant, left, room) : 0;
    const rightSimilar = participant.gender === "Female" ? similarFemaleCount(participant, right, room) : 0;
    const leftPreference = preferencePenalty(participant, left.code);
    const rightPreference = preferencePenalty(participant, right.code);
    const leftMembers = groupMembers(left, room);
    const rightMembers = groupMembers(right, room);
    const leftExpertiseOverlap = leftMembers.reduce((total, member) => total + similarity(participant.expertise, member.expertise), 0);
    const rightExpertiseOverlap = rightMembers.reduce((total, member) => total + similarity(participant.expertise, member.expertise), 0);

    return leftSimilar - rightSimilar
      || left.femaleCount - right.femaleCount
      || left.participantIds.length - right.participantIds.length
      || leftPreference - rightPreference
      || leftExpertiseOverlap - rightExpertiseOverlap
      || left.code.localeCompare(right.code);
  });
}

function collectAllocationWarnings(room: Room, capacities: Map<GroupCode, number>, onlyNew: boolean) {
  const warnings: string[] = [];
  const unassigned = room.participants.filter((participant) => !participant.assignedGroup);
  if (unassigned.length) {
    warnings.push(`${unassigned.length} ${onlyNew ? "new arrival" : "participant"}${unassigned.length === 1 ? "" : "s"} could not be placed because no group capacity remained.`);
  }

  for (const group of room.groups) {
    const target = capacities.get(group.code) ?? 0;
    if (group.participantIds.length > target) {
      warnings.push(`${group.code} already has ${group.participantIds.length} leaders but its equal-allocation capacity is ${target}; existing assignments were kept.`);
    }
    const females = groupMembers(group, room).filter((participant) => participant.gender === "Female");
    const similarNames = new Set<string>();
    for (let index = 0; index < females.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < females.length; otherIndex += 1) {
        if (similarity(females[index].expertise, females[otherIndex].expertise) >= similarFemaleThreshold) {
          similarNames.add(females[index].name);
          similarNames.add(females[otherIndex].name);
        }
      }
    }
    if (similarNames.size) {
      warnings.push(`${group.code} contains similar female expertise profiles (${[...similarNames].join(", ")}); all alternative group capacity was unavailable.`);
    }
  }
  return warnings;
}

function allocate(room: Room, onlyNew = false) {
  if (!onlyNew) {
    for (const participant of room.participants) {
      participant.assignedGroup = null;
      participant.status = "UNASSIGNED";
    }
    refreshGroups(room);
  } else {
    refreshGroups(room);
  }

  const capacities = capacityByGroup(room.participants.length);
  const pool = room.participants
    .filter((participant) => !onlyNew || participant.status === "NEW_UNASSIGNED");
  const females = pool
    .filter((participant) => participant.gender === "Female")
    .sort((left, right) =>
      femaleSimilarityDegree(right, pool.filter((participant) => participant.gender === "Female"))
      - femaleSimilarityDegree(left, pool.filter((participant) => participant.gender === "Female"))
      || expertiseSignalCount(right) - expertiseSignalCount(left)
      || left.name.localeCompare(right.name),
    );

  for (const participant of females) {
    const target = orderedGroupsFor(participant, room, capacities)[0];
    if (target) place(participant, target, room);
  }

  const remaining = pool
    .filter((participant) => !participant.assignedGroup)
    .sort((left, right) =>
      preferencePenalty(left, "P1") - preferencePenalty(right, "P1")
      || expertiseSignalCount(right) - expertiseSignalCount(left)
      || left.name.localeCompare(right.name),
    );
  for (const participant of remaining) {
    if (participant.assignedGroup) continue;
    const target = orderedGroupsFor(participant, room, capacities)[0];
    if (target) place(participant, target, room);
  }

  room.status = "POST_RUN";
  room.participants.forEach((participant) => {
    if (participant.assignedGroup) participant.status = "ASSIGNED";
  });
  refreshGroups(room);
  room.allocationWarnings = collectAllocationWarnings(room, capacities, onlyNew);
}

function place(participant: Participant, group: Group, room: Room) {
  if (!group || participant.assignedGroup) return;
  participant.assignedGroup = group.code;
  participant.status = "ASSIGNED";
  group.participantIds.push(participant.id);
  if (participant.gender === "Female") group.femaleCount += 1;
  else group.maleCount += 1;
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
  return res.json(room);
});

export default router;
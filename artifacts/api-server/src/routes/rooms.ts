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
};

const groupCodes: GroupCode[] = ["P1", "P2", "P3", "P4", "P5", "P6"];
const rooms = new Map<string, Room>();

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

function preferencePenalty(preference: Preference, code: GroupCode) {
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

function allocate(room: Room, onlyNew = false) {
  refreshGroups(room);
  const pool = room.participants
    .filter((participant) => !onlyNew || participant.status === "NEW_UNASSIGNED")
    .sort((a, b) => {
      if (a.gender !== b.gender) return a.gender === "Female" ? -1 : 1;
      if (a.preference !== b.preference) return a.preference.localeCompare(b.preference);
      return a.name.localeCompare(b.name);
    });

  if (!onlyNew) {
    for (const participant of room.participants) {
      participant.assignedGroup = null;
      participant.status = "UNASSIGNED";
    }
    refreshGroups(room);
  }

  const females = pool.filter((participant) => participant.gender === "Female");
  if (!onlyNew && females.length >= 6) {
    for (let index = 0; index < 6; index += 1) {
      place(females[index], room.groups[index], room);
    }
  }

  for (const participant of pool) {
    if (participant.assignedGroup) continue;
    const candidateGroups = [...room.groups].sort((a, b) => {
      const aScore = score(participant, a, room);
      const bScore = score(participant, b, room);
      return aScore - bScore;
    });
    place(participant, candidateGroups[0], room);
  }
  room.status = "POST_RUN";
  room.participants.forEach((participant) => {
    if (participant.assignedGroup) participant.status = "ASSIGNED";
  });
  refreshGroups(room);
}

function score(participant: Participant, group: Group, room: Room) {
  const targetSize = room.participants.length / 6;
  const genderCount = participant.gender === "Female" ? group.femaleCount : group.maleCount;
  const currentSize = group.participantIds.length;
  const average = room.participants.filter((item) => item.gender === participant.gender)
    .length / 6;
  const members = room.participants.filter((item) => item.assignedGroup === group.code);
  const centroid = Array.from({ length: 20 }, (_, index) =>
    members.reduce((sum, item) => sum + (item.expertise[index] ?? 0), 0) / Math.max(members.length, 1),
  );
  const expertiseScore = members.length ? 1 - similarity(participant.expertise, centroid) : 0;
  const capacityBias = group.code === "P5" || group.code === "P6" ? -0.15 : 0;
  return (
    Math.max(0, currentSize - targetSize) * 2 +
    Math.abs(genderCount + 1 - average) * 0.9 +
    preferencePenalty(participant.preference, group.code) * 0.7 +
    expertiseScore * 0.25 +
    capacityBias
  );
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
  return res.json(room);
});

export default router;
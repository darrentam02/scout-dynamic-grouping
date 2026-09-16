import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import app from "./app";

const GROUP_CODES = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
const PREFERENCE_TIERS = ["P1P2", "P3P4", "P5P6"] as const;

type GroupCode = (typeof GROUP_CODES)[number];
type PreferenceTier = (typeof PREFERENCE_TIERS)[number];

type ParticipantInput = {
  name: string;
  gender: "Male" | "Female";
  preference: PreferenceTier;
  rank2Preference: PreferenceTier;
  rank3Preference: PreferenceTier;
  expertise: number[];
};

type Participant = ParticipantInput & {
  id: string;
  status: "UNASSIGNED" | "ASSIGNED" | "NEW_UNASSIGNED";
  assignedGroup: GroupCode | null;
};

type Room = {
  roomCode: string;
  hostName: string;
  hostPassword: string;
  status: "PRE_RUN" | "POST_RUN";
  participants: Participant[];
  groups: Array<{
    code: GroupCode;
    participantIds: string[];
    maleCount: number;
    femaleCount: number;
  }>;
  allocationWarnings: string[];
  mcSummary?: unknown;
};

function makeParticipantInput(index: number): ParticipantInput {
  const primaryTier = PREFERENCE_TIERS[Math.floor(index / 12)];
  const otherTiers = PREFERENCE_TIERS.filter((tier) => tier !== primaryTier);

  return {
    name: `Leader ${index + 1}`,
    gender: index % 2 === 0 ? "Female" : "Male",
    preference: primaryTier,
    rank2Preference: otherTiers[0],
    rank3Preference: otherTiers[1],
    expertise: Array.from({ length: 20 }, (_, skillIndex) =>
      skillIndex === index % 20 ? 1 : 0,
    ),
  };
}

async function startTestServer() {
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

async function stopTestServer(server: ReturnType<typeof app.listen>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function requestJson<T>(
  server: ReturnType<typeof app.listen>,
  path: string,
  init?: RequestInit,
) {
  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, init);
  const body = (await response.json()) as T;
  return { response, body };
}

test("hosts can create a room, add a full roster, and persist six patrols", async () => {
  const server = await startTestServer();

  try {
    const created = await requestJson<Room>(server, "/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostName: "Camp Host" }),
    });

    assert.equal(created.response.status, 201);
    assert.match(created.body.roomCode, /^\d{6}$/);
    assert.equal(created.body.hostName, "Camp Host");
    assert.equal(created.body.status, "PRE_RUN");
    assert.deepEqual(created.body.participants, []);
    assert.deepEqual(
      created.body.groups.map((group) => group.code),
      GROUP_CODES,
    );

    const submittedParticipants = Array.from({ length: 36 }, (_, index) =>
      makeParticipantInput(index),
    );
    const participantIds: string[] = [];

    for (const input of submittedParticipants) {
      const added = await requestJson<Participant>(
        server,
        `/rooms/${created.body.roomCode}/participants`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );

      assert.equal(added.response.status, 201);
      assert.equal(added.body.name, input.name);
      assert.equal(added.body.preference, input.preference);
      assert.equal(added.body.rank2Preference, input.rank2Preference);
      assert.equal(added.body.rank3Preference, input.rank3Preference);
      assert.deepEqual(added.body.expertise, input.expertise);
      assert.equal(added.body.status, "UNASSIGNED");
      assert.equal(added.body.assignedGroup, null);
      participantIds.push(added.body.id);
    }

    assert.equal(new Set(participantIds).size, 36);

    const grouped = await requestJson<Room>(
      server,
      `/rooms/${created.body.roomCode}/grouping`,
      { method: "POST" },
    );

    assert.equal(grouped.response.status, 200);
    assert.equal(grouped.body.status, "POST_RUN");
    assert.ok(grouped.body.mcSummary);
    assert.deepEqual(grouped.body.allocationWarnings, []);
    assert.deepEqual(
      grouped.body.groups.map((group) => group.code),
      GROUP_CODES,
    );

    const assignedParticipants = grouped.body.participants.filter(
      (participant) => participant.status === "ASSIGNED",
    );
    assert.equal(assignedParticipants.length, 36);
    assert.equal(
      new Set(assignedParticipants.map((participant) => participant.id)).size,
      36,
    );
    assert.deepEqual(
      new Set(assignedParticipants.map((participant) => participant.id)),
      new Set(participantIds),
    );

    for (const group of grouped.body.groups) {
      assert.equal(group.participantIds.length, 6, `${group.code} should have six leaders`);
      assert.equal(new Set(group.participantIds).size, 6);
      assert.ok(group.participantIds.every((id) => participantIds.includes(id)));

      const assignedToGroup = assignedParticipants.filter(
        (participant) => participant.assignedGroup === group.code,
      );
      assert.deepEqual(
        new Set(group.participantIds),
        new Set(assignedToGroup.map((participant) => participant.id)),
      );
    }

    const persisted = await requestJson<Room>(
      server,
      `/rooms/${created.body.roomCode}`,
    );

    assert.equal(persisted.response.status, 200);
    assert.equal(persisted.body.status, "POST_RUN");
    assert.deepEqual(persisted.body.groups, grouped.body.groups);
    assert.deepEqual(persisted.body.participants, grouped.body.participants);
    assert.deepEqual(persisted.body.allocationWarnings, []);

    await stopTestServer(server);
    const restartedServer = await startTestServer();
    try {
      const reentered = await requestJson<Room>(
        restartedServer,
        `/rooms/${created.body.roomCode}`,
      );

      assert.equal(reentered.response.status, 200);
      assert.equal(reentered.body.status, "POST_RUN");
      assert.deepEqual(reentered.body.participants, grouped.body.participants);
      assert.deepEqual(reentered.body.groups, grouped.body.groups);
      assert.deepEqual(reentered.body.mcSummary, grouped.body.mcSummary);
    } finally {
      await stopTestServer(restartedServer);
    }
  } finally {
    if (!server.listening) return;
    await stopTestServer(server);
  }
});
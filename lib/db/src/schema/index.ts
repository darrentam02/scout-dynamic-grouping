import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const roomsTable = pgTable("rooms", {
  roomCode: text("room_code").primaryKey(),
  hostName: text("host_name").notNull(),
  hostPassword: text("host_password").notNull(),
  status: text("status").notNull(),
  participants: jsonb("participants").notNull(),
  groups: jsonb("groups").notNull(),
  allocationWarnings: jsonb("allocation_warnings").notNull(),
  mcSummary: jsonb("mc_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RoomRecord = typeof roomsTable.$inferSelect;
export type NewRoomRecord = typeof roomsTable.$inferInsert;
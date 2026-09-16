import { type ReactNode, useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clipboard,
  Command,
  Copy,
  Download,
  KeyRound,
  Link as LinkIcon,
  LockKeyhole,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
  Upload,
  X,
} from "lucide-react";
import {
  getHealthCheckQueryKey,
  getGetRoomQueryKey,
  useAddParticipant,
  useAllocateNewParticipants,
  useClearGrouping,
  useCreateRoom,
  useGetRoom,
  useHealthCheck,
  useRunGrouping,
} from "@workspace/api-client-react";
import type { Group, Participant, ParticipantInput, Room } from "@workspace/api-client-react";
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { createParticipantTemplate, parseParticipantWorkbook } from "@/lib/xlsx-lite";
import { SCOUT_EXPERTISE_OPTIONS, SCOUT_EXPERTISE_TIERS } from "@/lib/constants";
import {
  type LeaderInput,
  runMonteCarlo,
  DEFAULT_KPI_CONFIG,
  DEFAULT_MC_CONFIG,
  expertiseToSkillVector,
} from "@workspace/allocation";
import "./index.css";

const queryClient = new QueryClient();
const ROOM_KEY = "new-leaders-room:";
const SESSION_KEY = "new-leaders-host:";
const ACTIVE_ROOM_KEY = "activeRoom";
const GROUP_CODES = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
const GROUP_COLORS = ["#d89b36", "#c76d4b", "#3b887a", "#557b91", "#9b8b53", "#7f6254"];

type GroupCode = (typeof GROUP_CODES)[number];
type RosterFilter = "all" | "unassigned" | "new";

function normalizeParticipant(participant: Participant): Participant {
  return {
    ...participant,
    preference: participant.preference ?? "NONE",
    rank2Preference: participant.rank2Preference ?? "NONE",
    rank3Preference: participant.rank3Preference ?? "NONE",
  };
}

function storageRoom(code: string) {
  try {
    const value = window.localStorage.getItem(ROOM_KEY + code);
    if (!value) return undefined;
    const room = JSON.parse(value) as Room & { allocationWarnings?: string[] };
    return {
      ...room,
      participants: (room.participants ?? []).map(normalizeParticipant),
      allocationWarnings: room.allocationWarnings ?? [],
    };
  } catch {
    return undefined;
  }
}

function saveRoom(room: Room) {
  try {
    window.localStorage.setItem(ROOM_KEY + room.roomCode, JSON.stringify(room));
  } catch {
    // Storage is an enhancement, never a reason to block a live room.
  }
}

function saveHostSession(code: string, password: string) {
  try {
    window.localStorage.setItem(SESSION_KEY + code, password);
  } catch {
    // Storage is optional.
  }
}

function setActiveRoom(code: string) {
  try {
    window.localStorage.setItem(ACTIVE_ROOM_KEY, code);
  } catch {
    // Session tracking is optional.
  }
}

function leaveRoomSession(code: string) {
  try {
    window.localStorage.removeItem(ACTIVE_ROOM_KEY);
    window.localStorage.removeItem(SESSION_KEY + code);
  } catch {
    // Storage is optional.
  }
  void queryClient.cancelQueries({ queryKey: getGetRoomQueryKey(code) });
  queryClient.removeQueries({ queryKey: getGetRoomQueryKey(code) });
}

function hasHostSession(code: string) {
  try {
    return Boolean(window.localStorage.getItem(SESSION_KEY + code));
  } catch {
    return false;
  }
}

function makeFallbackRoom(hostName: string): Room {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    roomCode: `SC-${suffix}`,
    hostName,
    hostPassword: Math.random().toString(36).slice(2, 8).toUpperCase(),
    status: "PRE_RUN",
    participants: [],
    groups: GROUP_CODES.map((code) => ({ code, participantIds: [], maleCount: 0, femaleCount: 0 })),
    allocationWarnings: [],
  };
}

function makeLocalParticipant(input: ParticipantInput): Participant {
  return {
    ...input,
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: "UNASSIGNED",
    assignedGroup: null,
  };
}

function toLeaderInput(participant: Participant): LeaderInput {
  return {
    id: participant.id,
    name: participant.name,
    gender: participant.gender,
    rankPreferences: [participant.preference, participant.rank2Preference, participant.rank3Preference],
    skills: expertiseToSkillVector(participant.expertise),
  };
}

function runLocalGrouping(room: Room, onlyNew = false): Room {
  const roster = onlyNew
    ? room.participants.filter((participant) => participant.status === "ASSIGNED" || participant.status === "NEW_UNASSIGNED")
    : room.participants;
  const leaders = roster.map(toLeaderInput);
  const mcResult = runMonteCarlo(leaders, DEFAULT_KPI_CONFIG, { iterations: 500, seed: DEFAULT_MC_CONFIG.seed });
  const assignments = new Map<string, GroupCode>(mcResult.allocation.allocations.map((a) => [a.leaderId, a.group]));

  const participants = room.participants.map((participant) => {
    const isNewArrival = onlyNew && participant.status === "NEW_UNASSIGNED";
    const assignment = assignments.get(participant.id);
    const keepLocked = onlyNew && participant.status === "ASSIGNED";
    const assignedGroup = isNewArrival ? assignment ?? null : keepLocked ? participant.assignedGroup : assignment ?? null;
    return assignedGroup ? { ...participant, assignedGroup, status: "ASSIGNED" as const } : { ...participant, assignedGroup: null };
  });

  const groups = GROUP_CODES.map((code) => {
    const memberIds = participants.filter((participant) => participant.assignedGroup === code).map((participant) => participant.id);
    return {
      code,
      participantIds: memberIds,
      maleCount: participants.filter((participant) => participant.assignedGroup === code && participant.gender === "Male").length,
      femaleCount: participants.filter((participant) => participant.assignedGroup === code && participant.gender === "Female").length,
    };
  });

  const warnings: string[] = [...mcResult.allocation.warnings];
  const unassigned = participants.filter((participant) => !participant.assignedGroup);
  if (unassigned.length) warnings.push(`${unassigned.length} participant${unassigned.length === 1 ? "" : "s"} could not be placed because no group capacity remained.`);

  return { ...room, status: "POST_RUN", participants, groups, allocationWarnings: warnings };
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function ConnectionStatus() {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), retry: false, refetchInterval: 30000 } });
  const connected = health.isSuccess;
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.16em] text-muted-foreground" data-testid="status-connection">
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-[#5c9d72] animate-pulse-soft" : "bg-[#d89b36]"}`} />
      {connected ? "Live connection" : "Local-ready"}
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3" data-testid="brand-mark">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[4px_4px_0_#d89b36]">
        <Command size={18} strokeWidth={2.4} />
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-accent" />
      </div>
      <div>
        <div className="text-[15px] font-extrabold tracking-[-.03em]">新領袖</div>
        <div className="font-mono-ui text-[9px] font-medium uppercase tracking-[.18em] text-muted-foreground">P1—P6 / allocation</div>
      </div>
    </div>
  );
}

function Shell({ children, roomCode }: { children: ReactNode; roomCode?: string }) {
  const [, setLocation] = useLocation();
  return (
    <div className="noise min-h-[100dvh]">
      <header className="border-b border-border/70 bg-background/80 px-5 py-4 backdrop-blur-md md:px-10">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between">
          <Link href="/login" className="no-underline" data-testid="link-home"><BrandMark /></Link>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-7 md:flex">
              <a href="#method" className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground" data-testid="link-method">How it works</a>
              <a href="#principles" className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground" data-testid="link-principles">Principles</a>
              <ConnectionStatus />
            </div>
            {roomCode && <button onClick={() => { leaveRoomSession(roomCode); setLocation("/login"); }} className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[11px] font-bold text-primary transition-colors hover:bg-secondary" data-testid="button-leave-room"><X size={14} />離開房間 / 返回首頁</button>}
          </div>
          {!roomCode && <div className="md:hidden"><ConnectionStatus /></div>}
        </div>
      </header>
      {children}
      <footer className="mx-auto flex max-w-[1440px] items-center justify-between border-t border-border/70 px-5 py-7 text-xs text-muted-foreground md:px-10">
        <span className="font-mono-ui uppercase tracking-[.16em]">Field operations / 01</span>
        <span>Built for the host who sees the whole room.</span>
      </footer>
    </div>
  );
}

function Home() {
  const [, setLocation] = useLocation();
  const createRoom = useCreateRoom();
  const [hostName, setHostName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [reentryRoomCode, setReentryRoomCode] = useState("");
  const [hostPassword, setHostPassword] = useState("");
  const [showReentry, setShowReentry] = useState(false);
  const [reentryError, setReentryError] = useState("");
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState(false);
  const reentryCode = reentryRoomCode.trim().toUpperCase();
  const reentryQuery = useGetRoom(reentryCode, { query: { queryKey: getGetRoomQueryKey(reentryCode), enabled: false, retry: false } });

  const create = () => {
    const cleanName = hostName.trim();
    if (!cleanName) {
      setFormError("Add your name so the room knows who is on watch.");
      return;
    }
    setFormError("");
    createRoom.mutate({ data: { hostName: cleanName } }, {
      onSuccess: (room) => {
        saveRoom(room);
        saveHostSession(room.roomCode, room.hostPassword);
        setActiveRoom(room.roomCode);
        setLocation(`/room/${room.roomCode}`);
      },
      onError: () => {
        const localRoom = makeFallbackRoom(cleanName);
        saveRoom(localRoom);
        saveHostSession(localRoom.roomCode, localRoom.hostPassword);
        setActiveRoom(localRoom.roomCode);
        setLocation(`/room/${localRoom.roomCode}`);
      },
    });
  };

  const reenterHost = async () => {
    const cleanCode = reentryRoomCode.trim().toUpperCase();
    const cleanPassword = hostPassword.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setReentryError("Enter the six-digit room code.");
      return;
    }
    if (!cleanPassword) {
      setReentryError("Enter the host password for this room.");
      return;
    }
    setReentryError("");
    try {
      const result = await reentryQuery.refetch();
      const room = result.data;
      if (!room || room.hostPassword !== cleanPassword) throw new Error("invalid");
      saveRoom(room);
      saveHostSession(room.roomCode, cleanPassword);
      setActiveRoom(room.roomCode);
      setLocation(`/room/${room.roomCode}`);
    } catch {
      const cachedRoom = storageRoom(cleanCode);
      if (cachedRoom?.hostPassword === cleanPassword) {
        saveHostSession(cleanCode, cleanPassword);
        setActiveRoom(cleanCode);
        setLocation(`/room/${cleanCode}`);
        return;
      }
      setReentryError("Room code or host password is not valid.");
    }
  };

  const enter = () => {
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanCode) {
      setFormError("Enter the room code shared by your host.");
      return;
    }
    setFormError("");
    setLocation(`/room/${cleanCode}`);
  };

  const copyDemo = async () => {
    const value = `${window.location.origin}/room/`;
    try { await navigator.clipboard.writeText(value); } catch { /* unavailable in some previews */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Shell>
      <main className="mx-auto max-w-[1440px] px-5 pb-20 pt-10 md:px-10 md:pt-16">
        <section className="grid gap-12 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-20">
          <div className="animate-enter">
            <div className="mb-7 flex items-center gap-3">
              <span className="h-px w-9 bg-accent" />
              <span className="font-mono-ui text-[11px] font-medium uppercase tracking-[.2em] text-primary">Scout host console</span>
            </div>
            <h1 className="max-w-[700px] text-balance text-[clamp(3.5rem,8vw,7rem)] font-extrabold leading-[.92] tracking-[-.075em] text-primary">
              Make the room<br /><span className="text-foreground">make sense.</span>
            </h1>
            <p className="mt-8 max-w-[510px] text-[17px] leading-8 text-muted-foreground">
              新領袖 turns a live roster into six balanced, explainable leadership groups. Set the room. Read the signal. Move together.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4 text-xs font-semibold text-muted-foreground">
              <span className="flex items-center gap-2"><ShieldCheck size={15} className="text-primary" /> Fairness you can explain</span>
              <span className="flex items-center gap-2"><Radio size={15} className="text-accent-foreground" /> Live roster updates</span>
            </div>
          </div>

          <div className="animate-enter-delay">
            <div className="relative overflow-hidden rounded-[1.75rem] border border-primary/20 bg-primary p-6 text-primary-foreground shadow-[12px_14px_0_rgba(216,155,54,.75)] md:p-8">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full border border-primary-foreground/10" />
              <div className="absolute -right-3 -top-3 h-24 w-24 rounded-full border border-primary-foreground/10" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary-foreground/60">Start a live room</p>
                    <h2 className="mt-2 text-2xl font-bold tracking-[-.04em]">The host is the signal.</h2>
                  </div>
                  <div className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 p-3"><Plus size={20} /></div>
                </div>
                <label className="mt-8 block text-xs font-semibold text-primary-foreground/70" htmlFor="host-name">Your name</label>
                <input id="host-name" value={hostName} onChange={(event) => setHostName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && create()} placeholder="e.g. Mei Lin" className="mt-2 h-13 w-full rounded-xl border border-primary-foreground/20 bg-primary-foreground/10 px-4 text-base outline-none placeholder:text-primary-foreground/40 focus:border-accent focus:ring-2 focus:ring-accent/30" data-testid="input-host-name" />
                <button onClick={create} disabled={createRoom.isPending} className="mt-4 flex h-13 w-full items-center justify-between rounded-xl bg-accent px-5 font-bold text-accent-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70" data-testid="button-create-room">
                  {createRoom.isPending ? "Opening field room…" : "Open a new room"}
                  <ArrowUpRight size={19} />
                </button>
                {formError && <p className="mt-3 text-sm font-medium text-[#f2c38a]" data-testid="status-home-error">{formError}</p>}
                <div className="my-6 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[.16em] text-primary-foreground/40"><span className="h-px flex-1 bg-primary-foreground/15" /> or join one <span className="h-px flex-1 bg-primary-foreground/15" /></div>
                <div className="flex gap-2">
                  <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && enter()} placeholder="ROOM CODE" className="h-12 min-w-0 flex-1 rounded-xl border border-primary-foreground/20 bg-primary-foreground/10 px-4 font-mono-ui text-sm uppercase tracking-[.12em] outline-none placeholder:text-primary-foreground/35 focus:border-accent" data-testid="input-room-code" />
                  <button onClick={enter} className="flex h-12 items-center gap-2 rounded-xl border border-primary-foreground/20 px-4 text-sm font-bold transition-colors hover:bg-primary-foreground/10" data-testid="button-enter-room"><span className="hidden sm:inline">Enter</span><ArrowRight size={17} /></button>
                </div>
                <div className="mt-5 border-t border-primary-foreground/15 pt-5">
                  <button onClick={() => { setShowReentry((current) => !current); setReentryError(""); }} className="flex items-center gap-2 text-xs font-bold text-accent hover:underline" data-testid="button-open-host-reentry"><LockKeyhole size={14} />Re-enter Room as Host</button>
                  {showReentry && <div className="mt-4 space-y-3" data-testid="panel-host-reentry">
                    <input value={reentryRoomCode} onChange={(event) => setReentryRoomCode(event.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(event) => event.key === "Enter" && void reenterHost()} placeholder="6-digit ROOM CODE" inputMode="numeric" className="h-11 w-full rounded-xl border border-primary-foreground/20 bg-primary-foreground/10 px-4 font-mono-ui text-sm tracking-[.12em] outline-none placeholder:text-primary-foreground/35 focus:border-accent" data-testid="input-reentry-room-code" />
                    <input type="password" value={hostPassword} onChange={(event) => setHostPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void reenterHost()} placeholder="HOST PASSWORD" className="h-11 w-full rounded-xl border border-primary-foreground/20 bg-primary-foreground/10 px-4 text-sm outline-none placeholder:text-primary-foreground/35 focus:border-accent" data-testid="input-reentry-host-password" />
                    <button onClick={() => void reenterHost()} disabled={reentryQuery.isFetching} className="flex h-11 w-full items-center justify-between rounded-xl border border-primary-foreground/20 px-4 text-sm font-bold transition-colors hover:bg-primary-foreground/10 disabled:cursor-wait disabled:opacity-60" data-testid="button-reenter-host"><span>{reentryQuery.isFetching ? "Checking room…" : "Re-enter as Host"}</span><ArrowRight size={17} /></button>
                    {reentryError && <p className="text-xs font-medium text-[#f2c38a]" data-testid="status-host-reentry-error">{reentryError}</p>}
                  </div>}
                </div>
              </div>
            </div>
            <div className="mt-7 flex items-center justify-between px-2 text-xs text-muted-foreground">
              <span>Need to share the entry point?</span>
              <button onClick={copyDemo} className="flex items-center gap-2 font-semibold text-primary hover:underline" data-testid="button-copy-room-link">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy room link"}</button>
            </div>
          </div>
        </section>

        <section id="method" className="mt-28 border-t border-border/80 pt-8">
          <div className="mb-10 flex items-end justify-between gap-6">
            <div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">A calm operating rhythm</p><h2 className="mt-3 text-3xl font-bold tracking-[-.05em] text-primary md:text-4xl">Three moves. One clear room.</h2></div>
            <span className="hidden font-mono-ui text-xs text-muted-foreground md:block">01—03 / method</span>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
            {[
              ["01", "Set the brief", "Name the room and invite the roster. Every participant arrives with a preference, a profile, and a place in the picture."],
              ["02", "Read the room", "Live intake makes new arrivals visible. The signal stays legible while the room is still moving."],
              ["03", "Call the groups", "Run a balanced P1–P6 allocation with a result you can see, share, and stand behind."],
            ].map(([number, title, copy]) => (
              <article key={number} className="bg-card p-6 md:p-8" data-testid={`card-method-${number}`}>
                <span className="font-mono-ui text-xs font-medium text-accent-foreground">{number}</span>
                <h3 className="mt-10 text-xl font-bold tracking-[-.03em]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="principles" className="mt-20 grid gap-7 lg:grid-cols-[.7fr_1.3fr] lg:items-end">
          <div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Built for live decisions</p><h2 className="mt-3 max-w-[430px] text-3xl font-bold tracking-[-.05em] text-primary">A room view, not a spreadsheet.</h2></div>
          <div className="grid gap-3 sm:grid-cols-3">
            {["Preference is a signal, not a promise.", "New arrivals stay visible until placed.", "Every group carries its own balance."].map((text, index) => <div key={text} className="rounded-xl border border-border bg-card/70 p-4 text-sm font-semibold leading-5" data-testid={`text-principle-${index}`}>{text}</div>)}
          </div>
        </section>
      </main>
    </Shell>
  );
}

function SkeletonRoom() {
  return <div className="mx-auto max-w-[1440px] animate-pulse px-5 py-10 md:px-10"><div className="h-8 w-56 rounded bg-muted" /><div className="mt-8 grid gap-5 md:grid-cols-3"><div className="h-48 rounded-2xl bg-muted" /><div className="h-48 rounded-2xl bg-muted" /><div className="h-48 rounded-2xl bg-muted" /></div><div className="mt-6 h-96 rounded-2xl bg-muted" /></div>;
}

function ParticipantForm({ roomCode, onAdded }: { roomCode: string; onAdded: (participant: Participant) => void }) {
  const addParticipant = useAddParticipant();
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"Male" | "Female">("Female");
  const [preference, setPreference] = useState<ParticipantInput["preference"]>("NONE");
  const [rank2Preference, setRank2Preference] = useState<ParticipantInput["preference"]>("NONE");
  const [rank3Preference, setRank3Preference] = useState<ParticipantInput["preference"]>("NONE");
  const [expertise, setExpertise] = useState<number[]>(Array(20).fill(0));
  const [message, setMessage] = useState("");
  const toggleExpertise = (index: number) => setExpertise((current) => current.map((value, item) => item === index ? (value ? 0 : 1) : value));
  const submit = () => {
    const cleanName = name.trim();
    if (!cleanName) { setMessage("A name is needed before joining."); return; }
    setMessage("");
    const input: ParticipantInput = { name: cleanName, gender, preference, rank2Preference, rank3Preference, expertise: expertise as ParticipantInput["expertise"] };
    addParticipant.mutate({ roomCode, data: input }, {
      onSuccess: (participant) => { onAdded(participant); setName(""); setExpertise(Array(20).fill(0)); setMessage("Added to the live roster."); },
      onError: () => { onAdded(makeLocalParticipant(input)); setName(""); setExpertise(Array(20).fill(0)); setMessage("Saved locally — connection will catch up when available."); },
    });
  };
  return (
    <div className="card-surface rounded-2xl border border-border p-5 md:p-6" data-testid="panel-participant-intake">
      <div className="flex items-start justify-between gap-4"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Participant intake</p><h2 className="mt-2 text-xl font-bold tracking-[-.04em]">Add someone to the room</h2></div><div className="rounded-lg bg-secondary p-2 text-primary"><UserRound size={18} /></div></div>
      <label className="mt-6 block text-xs font-bold text-muted-foreground" htmlFor="participant-name">Full name</label>
      <input id="participant-name" value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="Participant name" data-testid="input-participant-name" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-xs font-bold text-muted-foreground">Gender<select value={gender} onChange={(event) => setGender(event.target.value as "Male" | "Female")} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium outline-none focus:border-primary" data-testid="select-participant-gender"><option value="Female">Female</option><option value="Male">Male</option></select></label>
        <label className="text-xs font-bold text-muted-foreground">1st choice<select value={preference} onChange={(event) => setPreference(event.target.value as ParticipantInput["preference"])} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium outline-none focus:border-primary" data-testid="select-participant-preference"><option value="NONE">No preference</option><option value="P1P2">P1 or P2</option><option value="P3P4">P3 or P4</option><option value="P5P6">P5 or P6</option></select></label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-xs font-bold text-muted-foreground">2nd choice<select value={rank2Preference} onChange={(event) => setRank2Preference(event.target.value as ParticipantInput["preference"])} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium outline-none focus:border-primary" data-testid="select-participant-rank2"><option value="NONE">No preference</option><option value="P1P2">P1 or P2</option><option value="P3P4">P3 or P4</option><option value="P5P6">P5 or P6</option></select></label>
        <label className="text-xs font-bold text-muted-foreground">3rd choice<select value={rank3Preference} onChange={(event) => setRank3Preference(event.target.value as ParticipantInput["preference"])} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium outline-none focus:border-primary" data-testid="select-participant-rank3"><option value="NONE">No preference</option><option value="P1P2">P1 or P2</option><option value="P3P4">P3 or P4</option><option value="P5P6">P5 or P6</option></select></label>
      </div>
      {preference !== "NONE" && (preference === rank2Preference || preference === rank3Preference || (rank2Preference !== "NONE" && rank2Preference === rank3Preference)) && <p className="mt-2 text-[11px] font-semibold text-destructive" data-testid="status-preference-duplicate">Choices should not repeat. Each tier appears at most once.</p>}
       <div className="mt-5"><div className="flex items-baseline justify-between"><label className="text-xs font-bold text-muted-foreground">Scout expertise</label><span className="font-mono-ui text-[10px] text-muted-foreground">{expertise.reduce((sum, item) => sum + item, 0)} / 20 selected</span></div><div className="mt-2 space-y-1.5 rounded-lg border border-border bg-background p-2.5">{SCOUT_EXPERTISE_TIERS.map((tier) => <div key={tier.label}><div className="px-1 py-2 font-mono-ui text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">{tier.label}</div><div className="grid gap-1 md:grid-cols-2">{SCOUT_EXPERTISE_OPTIONS.slice(tier.start, tier.end + 1).map((option, offset) => { const index = tier.start + offset; return <label key={option} className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-[11px] leading-4 transition-colors ${expertise[index] ? "bg-primary/10 text-primary" : "hover:bg-secondary"}`}><input type="checkbox" checked={Boolean(expertise[index])} onChange={() => toggleExpertise(index)} className="mt-0.5 h-3.5 w-3.5 accent-primary" data-testid={`checkbox-expertise-${index}`} /><span>{option}</span></label>; })}</div></div>)}</div></div>
      <button onClick={submit} disabled={addParticipant.isPending} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-70" data-testid="button-add-participant"><Plus size={16} />{addParticipant.isPending ? "Adding…" : "Add to roster"}</button>
      {message && <p className="mt-3 text-xs font-semibold text-primary" data-testid="status-participant-form">{message}</p>}
    </div>
  );
}

function JoinPage() {
  const { roomCode = "" } = useParams<{ roomCode: string }>();
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    setActiveRoom(roomCode);
    document.title = `Scout Leader Registration · ${roomCode}`;
    return () => { document.title = "新領袖 P1–P6 分組配置"; };
  }, [roomCode]);
  return <Shell roomCode={roomCode}><main className="mx-auto max-w-2xl px-5 pb-16 pt-10 md:px-10"><div className="mb-7"><Link href={`/room/${roomCode}`} className="text-xs font-bold text-muted-foreground hover:text-primary" data-testid="link-back-dashboard">← Back to room</Link><p className="mt-8 font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Scout leader registration · room {roomCode}</p><h1 className="mt-3 text-4xl font-extrabold tracking-[-.07em] text-primary md:text-5xl">Scout Leader Registration</h1><p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">Share your signals so the host can make a fair P1–P6 allocation. Age and years of service are not collected.</p></div>{submitted ? <div className="card-surface rounded-2xl border border-border p-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary"><Check size={22} /></div><h2 className="mt-5 text-2xl font-bold text-primary">Registration received</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Your details are now in the live roster. You can close this page.</p></div> : <ParticipantForm roomCode={roomCode} onAdded={() => setSubmitted(true)} />}</main></Shell>;
}

function BulkParticipantImport({ roomCode, onAdded }: { roomCode: string; onAdded: (participant: Participant) => void }) {
  const addParticipant = useAddParticipant();
  const [message, setMessage] = useState("");
  const downloadTemplate = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(createParticipantTemplate());
    link.download = "new-leaders-participant-template.xlsx";
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage("Excel template downloaded.");
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setMessage("");
    try {
      const participants = await parseParticipantWorkbook(file);
      if (!participants.length) throw new Error("No participant rows were found.");
      for (const participant of participants) {
        const created = await addParticipant.mutateAsync({ roomCode, data: participant });
        onAdded(created);
      }
      setMessage(`${participants.length} participants added to the live roster.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import that workbook.");
    }
  };
  return <section className="rounded-2xl border border-border bg-card/70 p-5" data-testid="panel-bulk-import">
    <div className="flex items-center gap-2 text-primary"><Upload size={16} /><span className="text-xs font-bold">Bulk roster</span></div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Use the Excel template to add a prepared participant list in one action.</p>
    <div className="mt-4 grid gap-2">
      <button onClick={downloadTemplate} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-bold text-primary hover:bg-secondary" data-testid="button-download-template"><Download size={14} />Download .xlsx template</button>
      <label className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-secondary text-xs font-bold text-primary transition-colors hover:bg-secondary/70 ${addParticipant.isPending ? "pointer-events-none opacity-60" : ""}`}><Upload size={14} />{addParticipant.isPending ? "Importing roster…" : "Upload .xlsx roster"}<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ""; }} data-testid="input-bulk-upload" /></label>
    </div>
    {message && <p className="mt-3 text-xs font-semibold text-primary" data-testid="status-bulk-import">{message}</p>}
  </section>;
}

function HostAccess({ room, onClose, onUnlock }: { room: Room; onClose: () => void; onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const unlock = () => {
    if (password.trim() !== room.hostPassword) { setError("That credential does not match this room."); return; }
    saveHostSession(room.roomCode, room.hostPassword);
    onUnlock();
  };
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-primary/35 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" data-testid="dialog-host-access">
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-[0_22px_70px_rgba(21,50,43,.23)]">
      <div className="flex items-start justify-between"><div><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary"><KeyRound size={19} /></div><h2 className="mt-5 text-xl font-bold tracking-[-.04em]">Host access</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter the room credential to reveal allocation controls.</p></div><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close host access" data-testid="button-close-host-access"><X size={18} /></button></div>
      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && unlock()} placeholder="Room credential" className="mt-6 h-12 w-full rounded-lg border border-input bg-background px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" data-testid="input-host-password" />
      {error && <p className="mt-2 text-xs font-semibold text-destructive" data-testid="status-host-access-error">{error}</p>}
      <button onClick={unlock} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-primary-foreground" data-testid="button-unlock-host"><LockKeyhole size={16} />Unlock controls</button>
    </div>
  </div>;
}

function GroupCard({ group, participants, index }: { group: Group; participants: Participant[]; index: number }) {
  const members = group.participantIds.map((id) => participants.find((participant) => participant.id === id)).filter(Boolean) as Participant[];
  const color = GROUP_COLORS[index];
  return <article className="card-surface overflow-hidden rounded-2xl border border-border" data-testid={`card-group-${group.code}`}>
    <div className="h-1.5" style={{ backgroundColor: color }} />
    <div className="p-5">
      <div className="flex items-start justify-between"><div><span className="font-mono-ui text-[11px] font-medium tracking-[.18em] text-muted-foreground">GROUP</span><h3 className="mt-1 text-3xl font-extrabold tracking-[-.07em]" style={{ color }}>{group.code}</h3></div><span className="rounded-full bg-secondary px-2.5 py-1 font-mono-ui text-[11px] font-medium text-muted-foreground">{members.length} people</span></div>
      <div className="mt-4 flex items-center gap-3 text-xs font-semibold"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#557b91]" />{group.maleCount} M</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#c76d4b]" />{group.femaleCount} F</span><span className="ml-auto font-mono-ui text-muted-foreground">{members.length ? Math.round((Math.min(group.maleCount, group.femaleCount) / Math.max(group.maleCount, group.femaleCount)) * 100) : 0}% eq.</span></div>
      <div className="mt-4 space-y-2 border-t border-border pt-4">{members.length ? members.map((participant) => <div key={participant.id} className="flex items-center gap-2.5" data-testid={`member-${participant.id}`}><span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-card" style={{ backgroundColor: color }}>{initials(participant.name)}</span><span className="min-w-0 truncate text-sm font-semibold">{participant.name}</span>{participant.status === "NEW_UNASSIGNED" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}</div>) : <div className="py-3 text-sm italic text-muted-foreground">Waiting for the first assignment.</div>}</div>
    </div>
  </article>;
}

function AllocationSummary({ room }: { room: Room }) {
  const summary = useMemo(() => {
    if (room.status !== "POST_RUN") return null;
    const assigned = room.participants.filter((p) => p.assignedGroup);
    if (!assigned.length) return null;

    const CLUSTER_MAP: Record<GroupCode, "P1P2" | "P3P4" | "P5P6"> = {
      P1: "P1P2", P2: "P1P2", P3: "P3P4", P4: "P3P4", P5: "P5P6", P6: "P5P6",
    };

    let rank1 = 0, rank2 = 0, rank3 = 0, forced = 0;
    for (const p of assigned) {
      const cluster = CLUSTER_MAP[p.assignedGroup!];
      if (p.preference === cluster) rank1++;
      else if (p.rank2Preference === cluster) rank2++;
      else if (p.rank3Preference === cluster) rank3++;
      else forced++;
    }

    const byGroup = room.groups.map((g) => ({ male: g.maleCount, female: g.femaleCount }));
    const totalM = byGroup.reduce((s, g) => s + g.male, 0);
    const totalF = byGroup.reduce((s, g) => s + g.female, 0);
    const parity = totalM && totalF
      ? Math.round(byGroup.reduce((s, g) => {
          const total = g.male + g.female;
          const ideal = totalF / (totalM + totalF) * total;
          return s + (total ? Math.max(0, 1 - Math.abs(g.female - ideal) / total) : 1);
        }, 0) / byGroup.length * 100)
      : 0;

    const coveredSkills = new Set<number>();
    for (const p of assigned) {
      const input = toLeaderInput(p);
      for (let i = 0; i < input.skills.length; i++) {
        if (input.skills[i]) coveredSkills.add(i);
      }
    }
    const coverage = Math.round(coveredSkills.size / 18 * 100);

    const r1 = rank1 / assigned.length;
    const r2 = rank2 / assigned.length;
    const r3 = rank3 / assigned.length;
    const kpiTotal = (r1 * 0.4 + r2 * 0.2 + parity / 100 * 0.2 + coverage / 100 * 0.1 + 0.8 * 0.1);

    return {
      rank1: Math.round(r1 * 100),
      rank2: Math.round(r2 * 100),
      rank3: Math.round(r3 * 100),
      forced,
      genderParity: parity,
      coverage,
      total: kpiTotal.toFixed(3),
    };
  }, [room]);

  if (!summary) return null;
  return <section data-testid="panel-allocation-summary"><div className="mb-4"><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Soft-coded KPI</p><h2 className="mt-2 text-xl font-bold tracking-[-.05em] text-primary">Allocation summary</h2></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div className="card-surface rounded-xl border border-border p-4"><p className="text-xs font-bold text-muted-foreground">1st choice hit rate</p><p className="mt-1 font-mono-ui text-3xl font-medium text-primary">{summary.rank1}%</p></div><div className="card-surface rounded-xl border border-border p-4"><p className="text-xs font-bold text-muted-foreground">2nd choice hit rate</p><p className="mt-1 font-mono-ui text-3xl font-medium text-primary">{summary.rank2}%</p></div><div className="card-surface rounded-xl border border-border p-4"><p className="text-xs font-bold text-muted-foreground">3rd choice / Forced</p><p className="mt-1 font-mono-ui text-3xl font-medium text-primary">{summary.rank3}% <span className="text-sm text-muted-foreground">({summary.forced} forced)</span></p></div><div className="card-surface rounded-xl border border-border p-4"><p className="text-xs font-bold text-muted-foreground">Gender parity</p><p className="mt-1 font-mono-ui text-3xl font-medium text-primary">{summary.genderParity}%</p></div><div className="card-surface rounded-xl border border-border p-4"><p className="text-xs font-bold text-muted-foreground">Skill coverage</p><p className="mt-1 font-mono-ui text-3xl font-medium text-primary">{summary.coverage}%</p></div><div className="rounded-xl border border-primary/25 bg-primary/5 p-4"><p className="text-xs font-bold text-muted-foreground">Weighted KPI score</p><p className="mt-1 font-mono-ui text-3xl font-medium text-primary">{summary.total}</p></div></div></section>;
}

function Roster({ participants, filter, setFilter }: { participants: Participant[]; filter: RosterFilter; setFilter: (filter: RosterFilter) => void }) {
  const [search, setSearch] = useState("");
  const filtered = participants.filter((participant) => {
    const matchesFilter = filter === "all" || (filter === "new" ? participant.status === "NEW_UNASSIGNED" : participant.status !== "ASSIGNED");
    return matchesFilter && participant.name.toLowerCase().includes(search.toLowerCase());
  });
  return <section className="card-surface rounded-2xl border border-border" data-testid="panel-live-roster">
    <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between md:p-6"><div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#5c9d72]" /><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Live roster</p></div><h2 className="mt-2 text-xl font-bold tracking-[-.04em]">People in the room <span className="font-mono-ui text-sm font-medium text-muted-foreground">/ {participants.length}</span></h2></div><div className="flex gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none focus:border-primary md:w-40" data-testid="input-roster-search" /><div className="flex rounded-lg border border-border bg-secondary p-1">{(["all", "unassigned", "new"] as RosterFilter[]).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-md px-2.5 py-1.5 text-[10px] font-bold capitalize ${filter === item ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`} data-testid={`button-roster-filter-${item}`}>{item}</button>)}</div></div></div>
    <div className="divide-y divide-border">{filtered.length ? filtered.map((participant) => <div key={participant.id} className={`flex items-center gap-3 px-5 py-3.5 md:px-6 ${participant.status === "NEW_UNASSIGNED" ? "bg-accent/10" : ""}`} data-testid={`row-participant-${participant.id}`}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-extrabold text-primary">{initials(participant.name)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-bold">{participant.name}</span>{participant.status === "NEW_UNASSIGNED" && <span className="rounded bg-accent/25 px-1.5 py-0.5 font-mono-ui text-[9px] font-medium uppercase tracking-wider text-accent-foreground">new</span>}</div><div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span>{participant.gender}</span><span className="text-border">•</span><span>{[participant.preference, participant.rank2Preference, participant.rank3Preference].filter((value) => value !== "NONE").map((value) => value === "P1P2" ? "P1/P2" : value === "P3P4" ? "P3/P4" : "P5/P6").join(" → ") || "No preference"}</span></div></div><div className="hidden items-center gap-1 md:flex" title={`${participant.expertise.reduce((sum, value) => sum + value, 0)} expertise signals`}>{participant.expertise.slice(0, 10).map((value, index) => <span key={index} className={`h-1.5 w-1.5 rounded-full ${value ? "bg-primary" : "bg-border"}`} />)}</div><span className={`shrink-0 rounded-full px-2.5 py-1 font-mono-ui text-[10px] font-medium ${participant.assignedGroup ? "bg-secondary text-primary" : "border border-dashed border-input text-muted-foreground"}`} data-testid={`status-assignment-${participant.id}`}>{participant.assignedGroup ?? "unassigned"}</span></div>) : <div className="flex flex-col items-center justify-center px-6 py-16 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground"><Users size={20} /></div><p className="mt-4 text-sm font-bold">No one in this view yet</p><p className="mt-1 text-xs text-muted-foreground">New arrivals will appear here as they enter.</p></div>}</div>
  </section>;
}

function JoinQrCode({ roomCode }: { roomCode: string }) {
  const joinUrl = `${window.location.origin}/room/${roomCode}/join`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(joinUrl)}`;
  return <section className="rounded-2xl border border-border bg-card/70 p-5" data-testid="panel-join-qr">
    <div className="flex items-center justify-between gap-3">
      <div><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Fast entry</p><h2 className="mt-2 text-xl font-bold tracking-[-.04em] text-primary">Scan to join</h2></div>
      <span className="rounded-full bg-secondary px-2.5 py-1 font-mono-ui text-[10px] font-medium uppercase tracking-[.12em] text-muted-foreground">Participant link</span>
    </div>
    <div className="mt-5 flex justify-center rounded-xl bg-white p-4">
      <img src={qrUrl} alt={`QR code for participants to join room ${roomCode}`} className="h-48 w-48" data-testid="img-join-qr" />
    </div>
    <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">Participants can scan this code to open the registration form directly.</p>
    <a href={joinUrl} className="mt-3 block truncate text-center font-mono-ui text-[10px] font-medium text-primary underline underline-offset-4" data-testid="link-join-url">{joinUrl}</a>
  </section>;
}

function RoomPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = (params.roomCode || "").toUpperCase();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const roomQuery = useGetRoom(roomCode, { query: { queryKey: getGetRoomQueryKey(roomCode), refetchInterval: 7000, retry: 1 } });
  const [localRoom, setLocalRoom] = useState<Room | undefined>(() => storageRoom(roomCode));
  const [showAccess, setShowAccess] = useState(false);
  const [hostUnlocked, setHostUnlocked] = useState(() => hasHostSession(roomCode));
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    setActiveRoom(roomCode);
    document.title = `Room ${roomCode} · 新領袖 P1–P6`;
    return () => { document.title = "新領袖 P1–P6 分組配置"; };
  }, [roomCode]);
  const room = roomQuery.data ?? localRoom;
  const runGrouping = useRunGrouping();
  const allocateNew = useAllocateNewParticipants();
  const clearGrouping = useClearGrouping();

  useEffect(() => { if (roomQuery.data) { const normalized = { ...roomQuery.data, participants: roomQuery.data.participants.map(normalizeParticipant) }; setLocalRoom(normalized); saveRoom(normalized); } }, [roomQuery.data]);
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(""), 2800);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [toast]);

  const updateRoom = (nextRoom: Room) => { setLocalRoom(nextRoom); saveRoom(nextRoom); queryClient.setQueryData(getGetRoomQueryKey(roomCode), nextRoom); };
  const onAdded = (participant: Participant) => {
    const nextRoom = { ...(room ?? makeFallbackRoom("Host")), participants: [...(room?.participants ?? []), participant] };
    updateRoom(nextRoom);
    queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomCode) });
  };
  const runGroupingAction = (onlyNew = false) => {
    if (!room) return;
    const mutation = onlyNew ? allocateNew : runGrouping;
    mutation.mutate({ roomCode }, { onSuccess: (nextRoom) => { updateRoom(nextRoom); queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomCode) }); setToast((nextRoom.allocationWarnings?.length ?? 0) ? "Groups placed with allocation notes to review." : onlyNew ? "New arrivals placed into the locked groups." : "Six groups are ready to call."); }, onError: () => { const nextRoom = runLocalGrouping(room, onlyNew); setToast(nextRoom.allocationWarnings.length ? "Groups placed locally with allocation notes to review." : "Allocation saved locally. The room is ready to continue."); updateRoom(nextRoom); } });
  };
  const clearGroupingAction = () => {
    if (!room || !window.confirm("Clear assignments and keep everyone in the room?")) return;
    clearGrouping.mutate({ roomCode }, { onSuccess: (nextRoom) => { updateRoom(nextRoom); queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomCode) }); setToast("Assignments cleared. The roster is open again."); }, onError: () => { updateRoom({ ...room, status: "PRE_RUN", participants: room.participants.map((participant) => ({ ...participant, assignedGroup: null, status: "UNASSIGNED" as const })), groups: GROUP_CODES.map((code) => ({ code, participantIds: [], maleCount: 0, femaleCount: 0 })), allocationWarnings: [] }); setToast("Assignments cleared locally."); } });
  };
  const copyRoomLink = async () => {
     try { await navigator.clipboard.writeText(`${window.location.origin}/room/${roomCode}/join`); } catch { /* unavailable in some previews */ }
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  };
  const groups = useMemo(() => GROUP_CODES.map((code) => room?.groups.find((group) => group.code === code) ?? ({ code, participantIds: room?.participants.filter((p) => p.assignedGroup === code).map((p) => p.id) ?? [], maleCount: room?.participants.filter((p) => p.assignedGroup === code && p.gender === "Male").length ?? 0, femaleCount: room?.participants.filter((p) => p.assignedGroup === code && p.gender === "Female").length ?? 0 })), [room]);
  const newCount = room?.participants.filter((participant) => participant.status === "NEW_UNASSIGNED").length ?? 0;
  const assignedCount = room?.participants.filter((participant) => participant.status === "ASSIGNED").length ?? 0;

  if (roomQuery.isLoading && !room) return <Shell roomCode={roomCode}><SkeletonRoom /></Shell>;
  if (!room) return <Shell roomCode={roomCode}><main className="mx-auto flex min-h-[65dvh] max-w-xl flex-col items-center justify-center px-5 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary"><LinkIcon size={23} /></div><h1 className="mt-6 text-3xl font-bold tracking-[-.05em] text-primary">This room is out of range.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">We could not find a live room with code <span className="font-mono-ui font-semibold text-foreground">{roomCode}</span>. Check the code and try again.</p><Link href="/login" className="mt-7 flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="link-return-home">Return to room setup <ArrowRight size={15} /></Link></main></Shell>;

  return <Shell roomCode={roomCode}>
    <main className="mx-auto max-w-[1440px] px-5 pb-16 pt-7 md:px-10">
      <div className="flex flex-col gap-5 border-b border-border pb-7 md:flex-row md:items-end md:justify-between">
        <div><div className="flex flex-wrap items-center gap-3"><span className="font-mono-ui text-[11px] font-medium uppercase tracking-[.18em] text-muted-foreground">Live field room</span><span className="rounded-full border border-[#5c9d72]/30 bg-[#5c9d72]/10 px-2 py-1 font-mono-ui text-[10px] font-medium uppercase tracking-[.12em] text-[#477d5b]">{room.status === "POST_RUN" ? "groups called" : "intake open"}</span></div><div className="mt-3 flex flex-wrap items-baseline gap-3"><h1 className="text-4xl font-extrabold tracking-[-.07em] text-primary md:text-5xl" data-testid="text-room-code">{room.roomCode}</h1><span className="text-sm text-muted-foreground">hosted by <strong className="text-foreground">{room.hostName}</strong></span></div></div>
        <div className="flex flex-wrap gap-2"><button onClick={copyRoomLink} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-secondary" data-testid="button-copy-live-link">{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "Link copied" : "Copy room link"}</button>{hostUnlocked ? <span className="flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground" data-testid="status-host-unlocked"><ShieldCheck size={15} />Host controls on</span> : <button onClick={() => setShowAccess(true)} className="flex h-10 items-center gap-2 rounded-lg bg-secondary px-3 text-xs font-bold text-primary hover:bg-secondary/70" data-testid="button-open-host-access"><LockKeyhole size={15} />Unlock host controls</button>}</div>
      </div>

      {roomQuery.isError && <div className="mt-5 flex items-center justify-between rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-xs font-semibold text-accent-foreground" data-testid="status-room-offline"><span>Server connection is quiet. This room is being served from its local field cache.</span><button onClick={() => roomQuery.refetch()} className="flex items-center gap-1.5 underline" data-testid="button-retry-room"><RefreshCw size={13} />Retry</button></div>}
      {toast && <div className="mt-5 rounded-xl border border-[#5c9d72]/30 bg-[#5c9d72]/10 px-4 py-3 text-xs font-semibold text-[#477d5b]" data-testid="status-room-action">{toast}</div>}
      {(room.allocationWarnings?.length ?? 0) > 0 && <section className="mt-5 rounded-xl border border-accent/45 bg-accent/10 px-4 py-3" data-testid="panel-allocation-warnings"><p className="text-xs font-extrabold text-accent-foreground">Allocation notes</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-accent-foreground/90">{room.allocationWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>}

      <section className="mt-7 grid gap-4 md:grid-cols-3">
        <div className="card-surface rounded-2xl border border-border p-5"><div className="flex items-center justify-between"><span className="text-xs font-bold text-muted-foreground">Roster</span><Users size={17} className="text-primary" /></div><div className="mt-4 flex items-end gap-2"><span className="font-mono-ui text-4xl font-medium text-primary" data-testid="text-roster-count">{room.participants.length}</span><span className="pb-1 text-xs text-muted-foreground">people checked in</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(room.participants.length * 8, 100)}%` }} /></div></div>
        <div className="card-surface rounded-2xl border border-border p-5"><div className="flex items-center justify-between"><span className="text-xs font-bold text-muted-foreground">Group readiness</span><Sparkles size={17} className="text-accent-foreground" /></div><div className="mt-4 flex items-end gap-2"><span className="font-mono-ui text-4xl font-medium text-primary" data-testid="text-assigned-count">{assignedCount}</span><span className="pb-1 text-xs text-muted-foreground">of {room.participants.length} placed</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${room.participants.length ? (assignedCount / room.participants.length) * 100 : 0}%` }} /></div></div>
        <div className={`card-surface rounded-2xl border p-5 ${newCount ? "border-accent/60 bg-accent/10" : "border-border"}`}><div className="flex items-center justify-between"><span className="text-xs font-bold text-muted-foreground">Needs attention</span><span className={`h-2.5 w-2.5 rounded-full ${newCount ? "bg-accent animate-pulse-soft" : "bg-[#5c9d72]"}`} /></div><div className="mt-4 flex items-end gap-2"><span className="font-mono-ui text-4xl font-medium text-primary" data-testid="text-new-count">{newCount}</span><span className="pb-1 text-xs text-muted-foreground">{newCount ? "new arrivals" : "all arrivals placed"}</span></div><p className="mt-4 text-xs text-muted-foreground">{newCount ? "Review the highlighted rows before allocating." : "The room is in a steady state."}</p></div>
      </section>

      <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-7">
          <section><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Six fixed destinations</p><h2 className="mt-2 text-2xl font-bold tracking-[-.05em] text-primary">The group board</h2></div><p className="max-w-[300px] text-right text-xs leading-5 text-muted-foreground">Balance stays visible: headcount, gender mix, and the people inside each call.</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{groups.map((group, index) => <GroupCard key={group.code} group={group} participants={room.participants} index={index} />)}</div></section>
          {room.status === "POST_RUN" && <AllocationSummary room={room} />}
          <Roster participants={room.participants} filter={filter} setFilter={setFilter} />
        </div>
        <aside className="space-y-5">
          <ParticipantForm roomCode={room.roomCode} onAdded={onAdded} />
          {hostUnlocked && <BulkParticipantImport roomCode={room.roomCode} onAdded={onAdded} />}
           <JoinQrCode roomCode={room.roomCode} />
          <div className="rounded-2xl border border-primary/20 bg-primary p-5 text-primary-foreground" data-testid="panel-host-controls"><div className="flex items-center justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-primary-foreground/60">Host controls</p><h2 className="mt-2 text-xl font-bold tracking-[-.04em]">Call the room</h2></div><SlidersHorizontal size={19} className="text-accent" /></div>{hostUnlocked ? <div className="mt-6 space-y-2"><button onClick={() => runGroupingAction(false)} disabled={runGrouping.isPending || allocateNew.isPending || !room.participants.length} className="flex min-h-12 w-full items-center justify-between rounded-lg bg-accent px-4 text-sm font-extrabold text-accent-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-run-grouping"><span className="flex items-center gap-2"><Sparkles size={16} />Run grouping</span><ChevronRight size={17} /></button><button onClick={() => runGroupingAction(true)} disabled={allocateNew.isPending || !newCount} className="flex min-h-11 w-full items-center justify-between rounded-lg border border-primary-foreground/20 px-4 text-xs font-bold transition-colors hover:bg-primary-foreground/10 disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-allocate-new"><span className="flex items-center gap-2"><Plus size={15} />Allocate new arrivals{newCount ? ` (${newCount})` : ""}</span><ChevronRight size={16} /></button><button onClick={clearGroupingAction} disabled={clearGrouping.isPending || !assignedCount} className="flex min-h-11 w-full items-center justify-between rounded-lg border border-primary-foreground/20 px-4 text-xs font-bold transition-colors hover:bg-primary-foreground/10 disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-clear-grouping"><span className="flex items-center gap-2"><RotateCcw size={15} />Clear assignments</span><ChevronRight size={16} /></button></div> : <div className="mt-6 rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 p-4"><p className="text-sm font-semibold leading-6">Controls are private to the host. Unlock them with the room credential.</p><button onClick={() => setShowAccess(true)} className="mt-4 text-xs font-bold text-accent underline underline-offset-4" data-testid="button-unlock-controls-panel">Enter host credential</button></div>}<div className="mt-6 flex items-center gap-2 border-t border-primary-foreground/15 pt-4 text-[11px] text-primary-foreground/60"><KeyRound size={13} /> Credential set at room creation</div></div>
          <div className="rounded-2xl border border-border bg-card/70 p-5"><div className="flex items-center gap-2 text-primary"><LinkIcon size={16} /><span className="text-xs font-bold">Room credentials</span></div><p className="mt-3 text-xs leading-5 text-muted-foreground">Keep these with the host. Participants only need the room code.</p><div className="mt-4 flex items-center justify-between rounded-lg bg-secondary px-3 py-2"><span className="font-mono-ui text-sm font-medium tracking-[.16em]" data-testid="text-room-credential">{hostUnlocked ? room.hostPassword : "••••••••"}</span>{hostUnlocked && <button onClick={() => navigator.clipboard?.writeText(room.hostPassword)} className="text-muted-foreground hover:text-primary" aria-label="Copy room credential" data-testid="button-copy-credential"><Copy size={14} /></button>}</div></div>
        </aside>
      </div>
    </main>
    {showAccess && <HostAccess room={room} onClose={() => setShowAccess(false)} onUnlock={() => { setHostUnlocked(true); setShowAccess(false); setToast("Host controls unlocked on this device."); }} />}
  </Shell>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route path="/login" component={Home} /><Route path="/room/:roomCode/join" component={JoinPage} /><Route path="/room/:roomCode" component={RoomPage} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
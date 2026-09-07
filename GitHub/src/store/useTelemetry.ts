import { create } from "zustand";
import type { MapInfo, MapObject, Indicators, State, Mission, ChatMessage, HudMsg, HudMessage } from "../lib/types";
import { distance, isFriendly } from "../lib/tracking";
import { isSpamMessage } from "../lib/chatFilter";

const MAX_KILLS = 400;

export interface TrailPoint { x: number; y: number; t: number; dx?: number; dy?: number }

interface TelemetryStore {
  mapInfo: MapInfo | null;
  mapObjects: MapObject[];
  mapImgUrl: string | null;
  mapGeneration: string | number | null;
  indicators: Indicators | null;
  state: State | null;
  mission: Mission | null;
  gamechat: ChatMessage[];
  hudmsg: HudMsg | null;
  connection: "offline" | "hangar" | "battle";
  isMocked: boolean;
  lastPoll: number;
  error: string | null;

  // selection & trails
  selectedKey: string | null; // e.g., "fighter-#17FFFF-idx-5" or "friendly-3"
  selectedMeta: { x: number; y: number; color: string; icon: string; type: string } | null;
  trails: Map<string, TrailPoint[]>; // key -> points (includes persistent friendly + ephemeral)
  // persistent friendly tracking from game start
  friendlyMeta: Map<string, { x: number; y: number; color: string; icon: string; type: string; lastSeen: number }>;
  nextFriendlyId: number;

  setData: (d: Partial<TelemetryStore>) => void;
  setMapImg: (url: string | null, gen: string | number | null) => void;
  selectObject: (obj: MapObject, key: string) => void;
  deselect: () => void;
  appendTrail: (key: string, pt: TrailPoint) => void;
  clearTrails: () => void;
  updateFriendlyTracks: (objects: MapObject[]) => void;
  findFriendlyTrackForObject: (obj: MapObject) => string | null;
  // Whole-match kill feed (accumulated, newest appended last, capped)
  killFeed: HudMessage[];
  appendKills: (msgs: HudMessage[]) => void;
  clearKillFeed: () => void;
}

const FRIENDLY_MATCH_DIST = 0.045;

export const useTelemetry = create<TelemetryStore>((set, get) => ({
  mapInfo: null,
  mapObjects: [],
  mapImgUrl: null,
  mapGeneration: null,
  indicators: null,
  state: null,
  mission: null,
  gamechat: [],
  hudmsg: null,
  connection: "offline",
  isMocked: false,
  lastPoll: 0,
  error: null,
  selectedKey: null,
  selectedMeta: null,
  trails: new Map(),
  friendlyMeta: new Map(),
  nextFriendlyId: 1,

  setData: (d) => set((s) => ({ ...s, ...d, lastPoll: Date.now() })),
  setMapImg: (url, gen) => set((s) => {
    if (s.mapImgUrl && s.mapImgUrl.startsWith("blob:")) {
      try { URL.revokeObjectURL(s.mapImgUrl); } catch {}
    }
    return { mapImgUrl: url, mapGeneration: gen };
  }),
  selectObject: (obj, key) => set(() => ({
    selectedKey: key,
    selectedMeta: { x: obj.x!, y: obj.y!, color: obj.color, icon: obj.icon, type: obj.type },
  })),
  deselect: () => set(() => ({ selectedKey: null, selectedMeta: null })),
  appendTrail: (key, pt) => set((s) => {
    const next = new Map(s.trails);
    const arr = next.get(key) ?? [];
    if (arr.length > 0) {
      const last = arr[arr.length - 1];
      if (Math.abs(last.x - pt.x) < 0.0005 && Math.abs(last.y - pt.y) < 0.0005) return {};
    }
    const capped = [...arr, pt];
    const now = Date.now();
    const filtered = capped.filter(p => now - p.t < 10 * 60 * 1000);
    const trimmed = filtered.length > 800 ? filtered.slice(filtered.length - 800) : filtered;
    next.set(key, trimmed);
    let meta = s.selectedMeta;
    if (s.selectedKey === key && s.selectedMeta) {
      meta = { ...s.selectedMeta, x: pt.x, y: pt.y };
    }
    // also keep friendlyMeta in sync if this trail is a friendly track
    const fMeta = new Map(s.friendlyMeta);
    if (fMeta.has(key)) {
      const prev = fMeta.get(key)!;
      fMeta.set(key, { ...prev, x: pt.x, y: pt.y, lastSeen: Date.now() });
      return { trails: next, selectedMeta: meta, friendlyMeta: fMeta };
    }
    return { trails: next, selectedMeta: meta };
  }),
  clearTrails: () => set(() => ({ trails: new Map(), friendlyMeta: new Map(), nextFriendlyId: 1, selectedKey: null, selectedMeta: null })),
  killFeed: [],
  appendKills: (msgs) => set((s) => {
    if (!msgs || msgs.length === 0) return {};
    const seen = new Set(s.killFeed.map((k) => k.id));
    const fresh = msgs.filter((m) => !seen.has(m.id) && !isSpamMessage(m.msg));
    if (fresh.length === 0) return {};
    const next = [...s.killFeed, ...fresh].sort((a, b) => a.id - b.id);
    return { killFeed: next.length > MAX_KILLS ? next.slice(next.length - MAX_KILLS) : next };
  }),
  clearKillFeed: () => set(() => ({ killFeed: [] })),
  updateFriendlyTracks: (objects) => set((s) => {
    const friendlyObjects = objects.filter(o => o.x !== undefined && o.y !== undefined && isFriendly(o) && (o.type === "aircraft" || o.type === "helicopter" || o.type === "ground_model"));
    if (friendlyObjects.length === 0) return {};
    const now = Date.now();
    const nextTrails = new Map(s.trails);
    const nextMeta = new Map(s.friendlyMeta);
    let nextId = s.nextFriendlyId;

    // Build pairs for existing tracks vs current objects
    const existingIds = Array.from(nextMeta.keys());
    const pairs: Array<{ id: string; objIdx: number; obj: MapObject; score: number }> = [];
    for (const id of existingIds) {
      const meta = nextMeta.get(id)!;
      for (let j = 0; j < friendlyObjects.length; j++) {
        const obj = friendlyObjects[j];
        const d = distance({ x: meta.x, y: meta.y }, { x: obj.x!, y: obj.y! });
        if (d > FRIENDLY_MATCH_DIST + 0.015) continue;
        const sameIcon = obj.icon === meta.icon;
        const sameType = obj.type === meta.type;
        let penalty = 0;
        if (!sameIcon) penalty += 0.015;
        if (!sameType) penalty += 0.01;
        if (obj.color !== meta.color) penalty += 0.006;
        const score = d + penalty;
        pairs.push({ id, objIdx: j, obj, score });
      }
    }
    pairs.sort((a, b) => a.score - b.score);
    const assignedTracks = new Set<string>();
    const assignedObjs = new Set<number>();
    for (const p of pairs) {
      if (assignedTracks.has(p.id) || assignedObjs.has(p.objIdx)) continue;
      assignedTracks.add(p.id);
      assignedObjs.add(p.objIdx);
      const pt = { x: p.obj.x!, y: p.obj.y!, t: now, dx: p.obj.dx, dy: p.obj.dy };
      const arr = nextTrails.get(p.id) ?? [];
      // dedup small move
      let shouldAppend = true;
      if (arr.length > 0) {
        const last = arr[arr.length - 1];
        if (Math.abs(last.x - pt.x) < 0.0005 && Math.abs(last.y - pt.y) < 0.0005) shouldAppend = false;
      }
      if (shouldAppend) {
        const capped = [...arr, pt];
        const filtered = capped.filter(pp => now - pp.t < 10 * 60 * 1000);
        const trimmed = filtered.length > 900 ? filtered.slice(filtered.length - 900) : filtered;
        nextTrails.set(p.id, trimmed);
      }
      nextMeta.set(p.id, { x: pt.x, y: pt.y, color: p.obj.color, icon: p.obj.icon, type: p.obj.type, lastSeen: now });
    }
    // Create new tracks for unmatched friendly objects (new spawns)
    for (let j = 0; j < friendlyObjects.length; j++) {
      if (assignedObjs.has(j)) continue;
      const obj = friendlyObjects[j];
      const id = `friendly-${nextId++}`;
      const pt = { x: obj.x!, y: obj.y!, t: now, dx: obj.dx, dy: obj.dy };
      nextTrails.set(id, [pt]);
      nextMeta.set(id, { x: obj.x!, y: obj.y!, color: obj.color, icon: obj.icon, type: obj.type, lastSeen: now });
    }
    // Keep unassigned existing tracks as-is (dead/out-of-view) but don't prune yet

    // If selectedKey is a friendly track, keep selectedMeta in sync
    let selMeta = s.selectedMeta;
    let selKey = s.selectedKey;
    if (selKey && nextMeta.has(selKey)) {
      const m = nextMeta.get(selKey)!;
      selMeta = { x: m.x, y: m.y, color: m.color, icon: m.icon, type: m.type };
    }
    return { trails: nextTrails, friendlyMeta: nextMeta, nextFriendlyId: nextId, selectedMeta: selMeta };
  }),
  findFriendlyTrackForObject: (obj) => {
    const s = get();
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const [id, meta] of s.friendlyMeta.entries()) {
      const d = distance({ x: meta.x, y: meta.y }, { x: obj.x!, y: obj.y! });
      if (obj.icon !== meta.icon) continue; // require same icon for precise
      if (d < bestDist && d < 0.04) {
        bestDist = d;
        bestId = id;
      }
    }
    // fallback looser: any friendly near
    if (!bestId) {
      for (const [id, meta] of s.friendlyMeta.entries()) {
        const d = distance({ x: meta.x, y: meta.y }, { x: obj.x!, y: obj.y! });
        if (d < bestDist && d < 0.05) {
          bestDist = d;
          bestId = id;
        }
      }
    }
    return bestId;
  },
}));

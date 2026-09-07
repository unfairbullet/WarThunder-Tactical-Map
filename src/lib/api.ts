const BASE = "http://localhost:8111";

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 1500): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(`${BASE}${path}`, { ...init, cache: "no-store" }, 1400);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const text = await res.text();
  if (!text) return null as unknown as T;
  return JSON.parse(text) as T;
}

async function fetchBlobUrl(path: string): Promise<string | null> {
  const res = await fetchWithTimeout(`${BASE}${path}`, { cache: "no-store" }, 1500);
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function getMapInfo() {
  return fetchJson<any>("/map_info.json");
}
export async function getMapObjects() {
  const res = await fetchWithTimeout(`${BASE}/map_obj.json`, { cache: "no-store" }, 1400);
  const txt = await res.text();
  if (!txt || txt.trim() === "" || txt.trim() === "[]") return [];
  try {
    const j = JSON.parse(txt);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}
export async function getIndicators() { return fetchJson<any>("/indicators"); }
export async function getState() { return fetchJson<any>("/state"); }
export async function getMission() { return fetchJson<any>("/mission.json"); }
export async function getGamechat(lastId: number = 0) { return fetchJson<any>(`/gamechat?lastId=${lastId}`); }
export async function getHudmsg(lastEvt: number = 0, lastDmg: number = 0) { return fetchJson<any>(`/hudmsg?lastEvt=${lastEvt}&lastDmg=${lastDmg}`); }
export async function getMapImgBlob() { return fetchBlobUrl("/map.img"); }

// For map image, browser <img> src bypasses CORS, so prefer direct URL. This helper builds a cache-busted URL.
export function getMapImgUrl(generation?: string | number | null): string {
  const bust = Date.now();
  const gen = generation != null ? `&gen=${generation}` : "";
  // Use direct localhost URL - <img> tags don't need CORS
  return `${BASE}/map.img?_=${bust}${gen}`;
}

// Stale-while-revalidate for JS fallback (web preview) — mirrors Rust poller to avoid flicker
let _lastSuccess: any = null;
let _consecutiveAllFail = 0;
let _pollCount = 0;

// Fallback mocks from _audit when offline (dev without WT)
let mockCache: Record<string, any> | null = null;
async function loadMocks(): Promise<Record<string, any>> {
  if (mockCache) return mockCache;
  try {
    const [mapInfo, mapObj, indicators, state, mission, gamechat, hudmsg] = await Promise.all([
      fetch("/_audit/map_info.json").then(r => r.json()).catch(() => null),
      fetch("/_audit/map_obj.json").then(r => r.json()).catch(() => []),
      fetch("/_audit/indicators.json").then(r => r.json()).catch(() => null),
      fetch("/_audit/state.json").then(r => r.json()).catch(() => null),
      fetch("/_audit/mission.json").then(r => r.json()).catch(() => null),
      fetch("/_audit/gamechat.json").then(r => r.json()).catch(() => []),
      fetch("/_audit/hudmsg.json").then(r => r.json()).catch(() => null),
    ]);
    mockCache = { mapInfo, mapObj, indicators, state, mission, gamechat, hudmsg };
  } catch {
    mockCache = {};
  }
  return mockCache!;
}

export async function pollAll(opts: { useMockFallback?: boolean; lastChatId?: number; lastEvt?: number; lastDmg?: number } = {}) {
  const useMock = opts.useMockFallback ?? true;
  const results: any = {};
  let offline = false;

  // Sequential fetches: the game server answers one request at a time with no
  // keep-alive, so parallel bursts only queue server-side. Essentials every
  // poll; map_info/mission (rarely change) every 4th poll.
  _pollCount += 1;
  const slowTick = _pollCount % 4 === 1;
  try {
    const mapObjects = await getMapObjects().catch(() => []);
    const indicators = await getIndicators().catch(() => null);
    const state = await getState().catch(() => null);
    let mapInfo = null;
    let mission = null;
    if (slowTick) {
      mapInfo = await getMapInfo().catch(e => { offline = true; throw e; });
      mission = await getMission().catch(() => null);
    } else {
      mapInfo = _lastSuccess?.mapInfo ?? await getMapInfo().catch(e => { offline = true; throw e; });
      mission = _lastSuccess?.mission ?? null;
    }
    // Chat/hud best-effort, sequential — never block core telemetry on failure.
    const gamechat = await getGamechat(opts.lastChatId ?? 0).catch(() => []);
    const hudmsg = await getHudmsg(opts.lastEvt ?? 0, opts.lastDmg ?? 0).catch(() => ({ events: [], damage: [] }));
    results.mapInfo = mapInfo;
    results.mapObjects = mapObjects;
    results.indicators = indicators;
    results.state = state;
    results.mission = mission;
    results.gamechat = Array.isArray(gamechat) ? gamechat : [];
    results.hudmsg = hudmsg ?? { events: [], damage: [] };
  } catch (e) {
    if (useMock && offline) {
      const mocks = await loadMocks();
      results.mapInfo = mocks.mapInfo ?? { valid: false };
      results.mapObjects = mocks.mapObj ?? [];
      results.indicators = mocks.indicators ?? null;
      results.state = mocks.state ?? null;
      results.mission = mocks.mission ?? null;
      results._mocked = true;
      results.gamechat = [];
      results.hudmsg = { events: [], damage: [] };
    } else {
      throw e;
    }
  }

  // normalize mapObj empty string case already handled
  if (!Array.isArray(results.mapObjects)) results.mapObjects = [];

  // determine connection state - map_info.valid false but map_obj may still persist post-battle, so use objects length as signal
  const hasObjects = Array.isArray(results.mapObjects) && results.mapObjects.length > 8;
  let connection: "offline" | "hangar" | "battle" = "offline";
  if (results._mocked) {
    connection = hasObjects || results.mapInfo?.valid ? "battle" : "hangar";
  } else if (results.mapInfo?.valid || hasObjects) {
    // map_info valid OR substantial objects => battle (covers post-battle where map_info false but objects still)
    connection = "battle";
  } else if (results.indicators?.valid || results.mission) {
    connection = offline ? "offline" : "hangar";
  } else if (!offline) {
    connection = "hangar";
  }

  // Stale-while-revalidate: on transient all-fail (1-2 polls), keep last success to avoid flicker
  const allFailed = !results.mapInfo && !results.indicators && !results.state && (results.mapObjects?.length ?? 0) === 0;
  if (allFailed) {
    _consecutiveAllFail += 1;
  } else {
    _consecutiveAllFail = 0;
    // only update lastSuccess when we have meaningful data (not all empty)
    if (results.mapInfo || results.indicators || results.state || (results.mapObjects?.length ?? 0) > 0) {
      _lastSuccess = { ...results, connection, generation: results.mapInfo?.map_generation ?? null, _mocked: !!results._mocked };
    }
  }
  if (_consecutiveAllFail > 0 && _consecutiveAllFail < 4 && _lastSuccess) {
    // return last success to smooth over transient fetch hiccup
    return { ..._lastSuccess, _mocked: !!_lastSuccess._mocked };
  }

  // map generation
  const gen = results.mapInfo?.map_generation ?? null;

  return { ...results, connection, generation: gen, _mocked: !!results._mocked };
}

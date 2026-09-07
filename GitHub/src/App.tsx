import { useEffect, useRef, useState, useCallback } from "react";
import MapCanvas from "./components/MapCanvas";
import TelemetryPanel from "./components/TelemetryPanel";
import ChatPanel from "./components/ChatPanel";
import { pollAll, getMapImgUrl } from "./lib/api";
import { useTelemetry } from "./store/useTelemetry";
import { useUnits } from "./lib/units";
import "./App.css";

export default function App() {
  const {
    setData, setMapImg, connection, selectedKey, clearTrails, trails, mapObjects, updateFriendlyTracks, friendlyMeta
  } = useTelemetry();
  const genRef = useRef<string | number | null>(null);
  const lastImgFetchRef = useRef<number>(0);
  const [pollInterval, setPollInterval] = useState(900);
  const [isMockMode, setIsMockMode] = useState(false);
  const [useRustPoller, setUseRustPoller] = useState(false);
  const [pollStats, setPollStats] = useState({ lastMs: 0, errors: 0, source: "js" as "js" | "rust" });
  const chatCursor = useRef(0);
  const dmgCursor = useRef(0);
  const evtCursor = useRef(0);

  const fetchMapImg = useCallback((gen: string | number | null) => {
    try {
      const url = getMapImgUrl(gen);
      setMapImg(url, gen);
      lastImgFetchRef.current = Date.now();
    } catch {}
  }, [setMapImg]);

  const processTelemetry = useCallback((res: any) => {
    // Keep last good telemetry on transient null/empty to avoid flicker every few seconds
    const prev = useTelemetry.getState();
    const effective = {
      mapInfo: res.mapInfo ?? prev.mapInfo,
      mapObjects: Array.isArray(res.mapObjects) && res.mapObjects.length === 0 && prev.mapObjects.length > 8 ? prev.mapObjects : res.mapObjects,
      indicators: res.indicators ?? prev.indicators,
      state: res.state ?? prev.state,
      mission: res.mission ?? prev.mission,
      gamechat: res.gamechat ?? prev.gamechat,
      hudmsg: res.hudmsg ?? prev.hudmsg,
      connection: res.connection ?? prev.connection,
      generation: res.generation ?? res.mapInfo?.map_generation ?? prev.mapGeneration,
      _mocked: res._mocked ?? prev.isMocked,
    };

    const newGen = effective.generation ?? effective.mapInfo?.map_generation ?? null;
    const prevGen = genRef.current;
    const genChanged = prevGen !== null && newGen !== null && String(prevGen) !== String(newGen);
    const validFlip = effective.connection === "battle" && connection !== "battle";
    const leftBattle = connection === "battle" && effective.connection !== "battle";

    if (genChanged || validFlip) {
      clearTrails();
      useTelemetry.getState().clearKillFeed();
      chatCursor.current = 0;
      dmgCursor.current = 0;
      evtCursor.current = 0;
      if (effective.connection === "battle") fetchMapImg(newGen);
      console.log(`[session] new match gen ${prevGen} -> ${newGen} validFlip=${validFlip}`);
    }
    if (leftBattle) {
      // Leaving a match: clear everything battle-scoped so the hangar reads empty.
      clearTrails();
      useTelemetry.getState().clearKillFeed();
      chatCursor.current = 0;
      dmgCursor.current = 0;
      evtCursor.current = 0;
      setMapImg(null, null);
      console.log(`[session] left battle -> hangar`);
    }
    genRef.current = newGen;

    const isValidMap = !!effective.mapInfo?.valid;
    if (isValidMap && effective.connection === "battle" && newGen !== null) {
      const st = useTelemetry.getState();
      const needImg = !st.mapImgUrl || String(st.mapGeneration) !== String(newGen);
      if (needImg) fetchMapImg(newGen);
    }

    // On battle exit, drop stale dots/chat/mission so hangar boxes read empty.
    const inBattle = effective.connection === "battle";
    setData({
      mapInfo: effective.mapInfo,
      mapObjects: leftBattle ? [] : effective.mapObjects,
      indicators: effective.indicators,
      state: effective.state,
      mission: inBattle ? effective.mission : null,
      gamechat: inBattle ? (effective.gamechat ?? []) : [],
      hudmsg: inBattle ? (effective.hudmsg ?? { events: [], damage: [] }) : { events: [], damage: [] },
      connection: effective.connection,
      isMocked: !!effective._mocked,
      error: null,
    });
    setIsMockMode(!!effective._mocked);
    // Accumulate whole-match kill feed (deduped by id in store)
    if (Array.isArray(effective.hudmsg?.damage)) {
      useTelemetry.getState().appendKills(effective.hudmsg.damage);
    }
    // Persistent friendly tracking from game start
    updateFriendlyTracks(effective.mapObjects);

    const target = effective.connection === "battle" ? 900 : effective.connection === "hangar" ? 1500 : 2500;
    if (target !== pollInterval) setPollInterval(target);
  }, [connection, pollInterval, updateFriendlyTracks, clearTrails, fetchMapImg, setData]);

  // Try to use Rust poller when running in Tauri (not throttled in background)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        // Tauri 2 may expose __TAURI_INTERNALS__ not __TAURI__, so just try listen and handle failure
        const isTauri = typeof window !== "undefined" && ((window as any).__TAURI__ !== undefined || (window as any).__TAURI_INTERNALS__ !== undefined);
        // Even if check fails, try listen anyway — if not in Tauri, listen will throw
        if (!isTauri) {
          // still try — listen will fail outside Tauri and we fallback to JS
          console.log("[poller] Not detected as Tauri, trying listen anyway");
        }
        unlisten = await listen("telemetry-update", (event: any) => {
          const start = performance.now();
          const payload = event.payload as any;
          // Rust sends mapInfo/mapObjects etc. — normalize to our shape
          // It already has connection/generation, but ensure mapObjects is array
          processTelemetry(payload);
          const dur = performance.now() - start;
          setPollStats(s => ({ ...s, lastMs: Math.round(dur), source: "rust" as const }));
        });
        if (!cancelled) {
          setUseRustPoller(true);
          setPollStats(s => ({ ...s, source: "rust" }));
          console.log("[poller] Using Rust backend (unthrottled)");
        }
      } catch (e) {
        console.warn("[poller] Rust not available, using JS", e);
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [processTelemetry]);

  const poll = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await pollAll({ useMockFallback: true, lastChatId: chatCursor.current, lastEvt: evtCursor.current, lastDmg: dmgCursor.current });
      if (Array.isArray(res.gamechat) && res.gamechat.length > 0) {
        const maxId = Math.max(...res.gamechat.map((m: any) => m.id));
        if (Number.isFinite(maxId)) chatCursor.current = maxId;
      }
      if (res.hudmsg?.damage?.length) {
        const maxD = Math.max(...res.hudmsg.damage.map((d: any) => d.id));
        if (Number.isFinite(maxD)) dmgCursor.current = maxD;
      }
      if (res.hudmsg?.events?.length) {
        const maxE = Math.max(...res.hudmsg.events.map((e: any) => e.id));
        if (Number.isFinite(maxE)) evtCursor.current = maxE;
      }
      processTelemetry(res);
      const dur = performance.now() - t0;
      setPollStats(s => ({ ...s, lastMs: Math.round(dur), source: "js" as const, errors: 0 }));
    } catch (e: any) {
      setData({ error: String(e?.message ?? e), connection: "offline" } as any);
      setIsMockMode(false);
      setPollStats(s => ({ ...s, errors: s.errors + 1, source: "js" as const }));
    }
  }, [processTelemetry, setData]);

  // JS polling only when not using Rust (web preview or fallback)
  useEffect(() => {
    if (useRustPoller) return; // Rust handles it
    poll();
    const id = window.setInterval(poll, pollInterval);
    return () => window.clearInterval(id);
  }, [poll, pollInterval, useRustPoller]);

  useEffect(() => { fetchMapImg(null); }, [fetchMapImg]);

  const { system: unitSystem, toggle: toggleUnits } = useUnits();

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--text)", overflow: "hidden" }}>
      <header style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", borderBottom: "1px solid var(--border)", background: "rgba(15,19,26,0.9)", backdropFilter: "blur(12px)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg, #17FFFF, #185AFF)", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 14, color: "#0b0e13" }}>W</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 0.3, lineHeight: 1 }}>WarThunder Tactical Map</div>
          </div>
          <div style={{ marginLeft: 12, display: "flex", gap: 6 }}>
            <span style={{ fontSize: 10, padding: "4px 8px", borderRadius: 999, background: isMockMode ? "rgba(250,200,30,0.12)" : "rgba(57,217,33,0.1)", color: isMockMode ? "#faC81E" : "#39D921", border: `1px solid ${isMockMode ? "rgba(250,200,30,0.25)" : "rgba(57,217,33,0.2)"}`, fontWeight: 700, letterSpacing: 0.5 }}>{isMockMode ? "MOCK" : "LIVE"}</span>
            <span style={{ fontSize: 10, padding: "4px 8px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "var(--muted)", border: "1px solid var(--border)" }}>{mapObjects.length} objects</span>
            <span style={{ fontSize: 10, padding: "4px 8px", borderRadius: 999, background: "rgba(23,255,255,0.08)", color: "#7ee8ff", border: "1px solid rgba(23,255,255,0.18)" }}>{friendlyMeta.size} friendly tracked</span>
            {selectedKey && <span style={{ fontSize: 10, padding: "4px 8px", borderRadius: 999, background: "rgba(250,200,30,0.15)", color: "#faC81E", border: "1px solid rgba(250,200,30,0.3)", fontWeight: 700 }}>{trails.get(selectedKey)?.length ?? 0} trail pts</span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
            {new Date().toLocaleTimeString()}
          </div>
          <button
            onClick={toggleUnits}
            title="Toggle metric / imperial"
            style={{ fontSize: 11, padding: "6px 10px", borderRadius: 8, background: unitSystem === "imperial" ? "rgba(250,200,30,0.15)" : "rgba(255,255,255,0.06)", color: unitSystem === "imperial" ? "#faC81E" : "var(--text)", border: "1px solid var(--border)", fontWeight: 700 }}
          >
            {unitSystem === "metric" ? "Metric (km/m)" : "Imperial (mi/ft)"}
          </button>
          <button
            onClick={() => { clearTrails(); chatCursor.current = 0; dmgCursor.current = 0; }}
            style={{ fontSize: 11, padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.06)", color: "var(--text)", border: "1px solid var(--border)", fontWeight: 600 }}
          >
            Clear Trails
          </button>
          <button
            onClick={() => fetchMapImg(genRef.current)}
            style={{ fontSize: 11, padding: "6px 10px", borderRadius: 8, background: "rgba(23,255,255,0.12)", color: "#7ee8ff", border: "1px solid rgba(23,255,255,0.25)", fontWeight: 700 }}
          >
            ↻ Refresh Map
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 340px 340px", gap: 8, padding: 8, minHeight: 0, overflow: "hidden" }}>
        <div style={{ minWidth: 0, minHeight: 0 }}>
          <MapCanvas />
        </div>

        <div style={{ minWidth: 0, minHeight: 0, overflow: "auto", background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: 10 }}>
          <TelemetryPanel />
        </div>

        <div style={{ minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: 10 }}>
          <ChatPanel />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px", margin: "0 8px 8px", fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
        <span>{friendlyMeta.size} tracks</span>
        <span style={{ color: "rgba(255,255,255,0.7)", background: "rgba(0,0,0,0.45)", padding: "4px 10px", borderRadius: 6 }}>Click unit = trail • Click again = hide</span>
        <span style={{ fontFamily: "ui-monospace, monospace" }}>{pollStats.lastMs}ms</span>
      </div>
    </div>
  );
}

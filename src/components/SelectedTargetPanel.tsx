import { useMemo } from "react";
import { useTelemetry } from "../store/useTelemetry";
import type { MapObject } from "../lib/types";
import { cleanIconName, cleanTypeName } from "../lib/vehicleNames";
import { useUnits, formatDistM, mToFt } from "../lib/units";

function teamFromColor(color: string): { label: string; color: string } {
  if (!color) return { label: "Unknown", color: "rgba(255,255,255,0.5)" };
  const lc = color.toLowerCase();
  // Player yellow/orange #faC81E or green #39d921/#24d921
  if (lc === "#fac81e" || lc === "#fac81f" || lc === "#39d921" || lc === "#24d921") return { label: "You (Player)", color: "#faC81E" };
  // Friendly cyan/blue
  if (lc === "#17ffff" || lc === "#185aff" || lc === "#14cfff" || lc === "#145cff") return { label: "Friendly", color: "#17FFFF" };
  // Enemy red
  if (lc.startsWith("#fa") || lc.startsWith("#f0") || lc === "#ff0000") return { label: "Enemy", color: "#fa0C00" };
  return { label: color, color };
}

function toWorld(mapInfo: any, x: number, y: number) {
  if (!mapInfo?.map_min || !mapInfo?.map_max) return null;
  const minX = parseFloat(String(mapInfo.map_min[0]));
  const maxX = parseFloat(String(mapInfo.map_max[0]));
  const minY = parseFloat(String(mapInfo.map_min[1]));
  const maxY = parseFloat(String(mapInfo.map_max[1]));
  // x,y 0-1 normalized maps to world: x=0 => minX, x=1 => maxX; y=0 => minY? but WarThunder y is inverted? Use direct lerp
  const wx = minX + x * (maxX - minX);
  const wy = minY + y * (maxY - minY);
  return { wx, wy };
}

function headingDeg(obj: MapObject): number | null {
  if (obj.dx === undefined || obj.dy === undefined) return null;
  // WarThunder dx,dy is unit vector in map space; y inverted vs world?
  let deg = (Math.atan2(obj.dy, obj.dx) * 180) / Math.PI;
  // normalize to 0-360 compass where 0 = east? Keep as math angle
  if (deg < 0) deg += 360;
  return deg;
}

function Field({ label, value, unit, mono }: { label: string; value: unknown; unit?: string; mono?: boolean }) {
  const v = value === undefined || value === null || value === "" ? "—" : String(value);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12 }}>
      <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{label}</span>
      <span style={{ color: "#e6edf3", fontFamily: mono ? "ui-monospace, monospace" : undefined, fontWeight: 600, textAlign: "right" }}>{v}{unit ? ` ${unit}` : ""}</span>
    </div>
  );
}

export default function SelectedTargetPanel() {
  const { mapObjects, mapInfo, selectedKey, selectedMeta, trails, mapGeneration } = useTelemetry();
  const { system: unitSystem } = useUnits();

  const selectedObj: MapObject | null = useMemo(() => {
    if (!selectedKey || !selectedMeta) return null;
    // find nearest match for current frame (same heuristic as tracking)
    let best: MapObject | null = null;
    let bestDist = Infinity;
    for (const o of mapObjects) {
      if (o.x === undefined || o.y === undefined) continue;
      const d = Math.hypot(o.x - selectedMeta.x, o.y - selectedMeta.y);
      const sameIcon = o.icon === selectedMeta.icon;
      const sameColor = o.color === selectedMeta.color;
      if (!sameIcon && !sameColor && d > 0.04) continue;
      if (d < bestDist) { bestDist = d; best = o; }
    }
    // if not found nearby (maybe out of range), fall back to meta
    if (!best && selectedMeta) {
      return {
        type: selectedMeta.type,
        color: selectedMeta.color,
        "color[]": [0,0,0] as any,
        blink: 0,
        icon: selectedMeta.icon,
        icon_bg: "none",
        x: selectedMeta.x,
        y: selectedMeta.y,
      } as MapObject;
    }
    return best;
  }, [mapObjects, selectedKey, selectedMeta]);

  const playerObj = useMemo(() => mapObjects.find(o => o.icon === "Player"), [mapObjects]);
  const trail = selectedKey ? trails.get(selectedKey) : undefined;

  // derived metrics
  const derived = useMemo(() => {
    if (!selectedObj || selectedObj.x === undefined || selectedObj.y === undefined) return null;
    const h = headingDeg(selectedObj);
    const world = toWorld(mapInfo, selectedObj.x!, selectedObj.y!);
    let distM: number | null = null;
    let bearingToPlayer: number | null = null;
    if (playerObj && playerObj.x !== undefined && playerObj.y !== undefined) {
      const dx = selectedObj.x! - playerObj.x!;
      const dy = selectedObj.y! - playerObj.y!;
      // distance in world meters via grid_size
      const gridSize = mapInfo?.grid_size ? parseFloat(String(mapInfo.grid_size[0])) : 131072;
      const distNorm = Math.hypot(dx, dy);
      distM = distNorm * gridSize;
      bearingToPlayer = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (bearingToPlayer < 0) bearingToPlayer += 360;
    }
    // speed estimate from trail last 2 points
    let speedEst: number | null = null;
    if (trail && trail.length >= 2) {
      const a = trail[trail.length - 2];
      const b = trail[trail.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.05) {
        const dNorm = Math.hypot(b.x - a.x, b.y - a.y);
        const gridSize = mapInfo?.grid_size ? parseFloat(String(mapInfo.grid_size[0])) : 131072;
        const dM = dNorm * gridSize;
        const vMps = dM / dt;
        // filter spikes
        if (vMps < 2000) speedEst = vMps;
      }
    }
    return { heading: h, world, distM, bearingToPlayer, speedEst };
  }, [selectedObj, mapInfo, playerObj, trail]);

  if (!selectedKey || !selectedMeta) {
    return (
      <section style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10, padding: 16, textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Selected Target</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontStyle: "italic" }}>No target — click a unit on the map to inspect its telemetry. Click again to hide trail.</div>
      </section>
    );
  }

  if (!selectedObj) return null;

  const team = teamFromColor(selectedObj.color);

  return (
    <section style={{ background: "rgba(250,200,30,0.06)", border: "1px solid rgba(250,200,30,0.18)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>Selected Target</h3>
        <span style={{ fontSize: 10, padding: "3px 7px", borderRadius: 999, background: "rgba(0,0,0,0.35)", color: team.color, border: `1px solid ${team.color}55`, fontWeight: 700 }}>{team.label}</span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, padding: "8px 10px", background: "rgba(0,0,0,0.25)", borderRadius: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 999, background: team.color, display: "grid", placeItems: "center", color: team.label === "You (Player)" ? "#000" : "#0b0b0b", fontWeight: 900, fontSize: 12 }}>{selectedObj.icon === "Player" ? "★" : selectedObj.icon[0] ?? "?"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#e6edf3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cleanTypeName(selectedObj.type)} • {cleanIconName(selectedObj.icon)}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "ui-monospace, monospace" }}>{selectedObj.color} {selectedObj.blink ? "• blinking" : ""}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "ui-monospace, monospace" }}>Gen {String(mapGeneration ?? "—")}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{trail ? `${trail.length} pts` : "0 pts"} trail</div>
        </div>
      </div>

      <Field label="Normalized" value={selectedObj.x !== undefined ? `${selectedObj.x.toFixed(4)}, ${selectedObj.y!.toFixed(4)}` : "—"} mono />
      {derived?.world && <Field label="World" value={unitSystem === "metric" ? `${derived!.world!.wx.toFixed(0)}, ${derived!.world!.wy.toFixed(0)} m` : `${mToFt(derived!.world!.wx).toFixed(0)}, ${mToFt(derived!.world!.wy).toFixed(0)} ft`} mono />}
      {derived && derived.heading !== null && derived.heading !== undefined && <Field label="Heading (dx,dy)" value={`${derived.heading!.toFixed(1)}°  (${selectedObj.dx?.toFixed(3)}, ${selectedObj.dy?.toFixed(3)})`} mono />}
      {derived && derived.distM !== null && <Field label="Distance to you" value={formatDistM(derived.distM, unitSystem)} mono />}
      {derived && derived.bearingToPlayer !== null && <Field label="Bearing from you" value={derived.bearingToPlayer !== null ? `${derived.bearingToPlayer!.toFixed(1)}°` : "—"} mono />}
      {derived && derived.speedEst !== null && <Field label="Speed est. (trail)" value={derived.speedEst !== null ? (unitSystem === "metric" ? `${(derived.speedEst!*3.6).toFixed(0)} km/h  (${derived.speedEst!.toFixed(1)} m/s)` : `${(derived.speedEst!*2.23694).toFixed(0)} mph  (${(derived.speedEst!*196.85).toFixed(0)} ft/min)`) : "—"} mono />}
      <Field label="Blink" value={selectedObj.blink ? "Yes" : "No"} />
      <Field label="Type / Icon" value={`${cleanTypeName(selectedObj.type)} / ${cleanIconName(selectedObj.icon)}`} />
      <Field label="Raw" value={`${selectedObj.type} / ${selectedObj.icon}`} />
      {trail && trail.length > 1 && <Field label="Trail age" value={`${((Date.now() - trail[0].t)/1000).toFixed(0)}s  •  last ${( (Date.now() - trail[trail.length-1].t)/1000).toFixed(1)}s ago`} mono />}
      <div style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.4 }}>
        Note: Only own vehicle gives full sensors (`indicators`/`state`). Other units expose only map position, heading, team and type via `map_obj.json`. Sensor/missile lock, RWR, TWS not in localhost:8111 — see explanation below.
      </div>
    </section>
  );
}

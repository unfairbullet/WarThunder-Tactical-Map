import { useRef, useEffect, useCallback, useState } from "react";
import { useTelemetry } from "../store/useTelemetry";
import { findNearest, HIT_RADIUS_PX, isFriendly, toCanvasPos, fromCanvasPos } from "../lib/tracking";
import type { MapObject } from "../lib/types";

function colorFor(obj: MapObject): string {
  if (obj.color) return obj.color;
  const c = (obj as any)["color[]"] as number[] | undefined;
  if (c && c.length === 3) return `rgb(${c[0]},${c[1]},${c[2]})`;
  return "#fff";
}

function iconLabel(obj: MapObject): string {
  if (obj.icon === "none" || !obj.icon) return "";
  if (obj.icon === "Player") return "★";
  if (obj.icon === "Fighter") return "▲";
  if (obj.icon === "Bomber") return "◆";
  if (obj.icon === "Assault") return "●";
  if (obj.icon === "Tracked") return "■";
  if (obj.icon === "Wheeled") return "⬣";
  if (obj.icon === "Airdefence") return "✕";
  if (obj.icon === "Helicopter") return "⬢";
  return obj.icon[0] ?? "?";
}

export default function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 800 });
  const [imgError, setImgError] = useState(false);
  const { mapObjects, mapImgUrl, selectedKey, selectedMeta, trails, selectObject, deselect, appendTrail, isMocked, connection, findFriendlyTrackForObject } = useTelemetry();

  // Reset error when src changes
  useEffect(() => { setImgError(false); }, [mapImgUrl]);

  // Effective image src: if no url or error, fall back to the neutral bundled
  // placeholder so the map area never shows a broken image
  const effectiveSrc = (() => {
    if (!mapImgUrl) return null;
    if (imgError) {
      return "/placeholder-map.png";
    }
    // If we are in mocked mode and url is localhost, prefer the placeholder
    // (localhost serves a tiny placeholder image when no battle is active)
    if (isMocked && mapImgUrl && mapImgUrl.includes("localhost:8111")) {
      return "/placeholder-map.png";
    }
    return mapImgUrl;
  })();

  // resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height) - 16;
      const w = Math.max(320, Math.floor(size));
      const h = w;
      setCanvasSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = canvasSize;

    ctx.clearRect(0, 0, w, h);

    // trails for selected only (under objects, over map)
    if (selectedKey) {
      const pts = trails.get(selectedKey);
      if (pts && pts.length > 1) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(250,200,30,0.95)";
        ctx.lineWidth = 3;
        ctx.shadowColor = "rgba(250,200,30,0.9)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const { px, py } = toCanvasPos(pts[i].x, pts[i].y, w, h);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = "rgba(250,200,30,0.95)";
        for (let i = Math.max(0, pts.length - 30); i < pts.length; i++) {
          const { px, py } = toCanvasPos(pts[i].x, pts[i].y, w, h);
          const age = (pts.length - 1 - i) / 30;
          ctx.globalAlpha = 1 - age * 0.7;
          ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        const last = pts[pts.length - 1];
        if (last.dx !== undefined && last.dy !== undefined) {
          const { px, py } = toCanvasPos(last.x, last.y, w, h);
          const angle = Math.atan2(last.dy, last.dx);
          const len = 11;
          ctx.strokeStyle = "#faC81E";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - Math.cos(angle) * len + Math.cos(angle + Math.PI/2) * 4, py - Math.sin(angle) * len + Math.sin(angle + Math.PI/2) * 4);
          ctx.moveTo(px, py);
          ctx.lineTo(px - Math.cos(angle) * len + Math.cos(angle - Math.PI/2) * 4, py - Math.sin(angle) * len + Math.sin(angle - Math.PI/2) * 4);
          ctx.stroke();
        }
      }
    }

    // objects
    for (const obj of mapObjects) {
      if (obj.type === "airfield" && obj.sx !== undefined) {
        const p1 = toCanvasPos(obj.sx!, obj.sy!, w, h);
        const p2 = toCanvasPos(obj.ex!, obj.ey!, w, h);
        ctx.strokeStyle = colorFor(obj);
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.moveTo(p1.px, p1.py);
        ctx.lineTo(p2.px, p2.py);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = colorFor(obj);
        ctx.beginPath(); ctx.arc(p1.px, p1.py, 4, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(p2.px, p2.py, 4, 0, Math.PI*2); ctx.fill();
        continue;
      }
      if (obj.x === undefined || obj.y === undefined) continue;
      const { px, py } = toCanvasPos(obj.x, obj.y, w, h);
      const isSelected = selectedKey && selectedMeta && Math.hypot(obj.x - selectedMeta.x, obj.y - selectedMeta.y) < 0.02 && obj.icon === selectedMeta.icon && obj.color === selectedMeta.color;
      const isPlayer = obj.icon === "Player";
      const radius = isPlayer ? 9.5 : obj.type === "ground_model" ? 5.2 : 6.2;

      if (isPlayer) {
        ctx.shadowColor = colorFor(obj);
        ctx.shadowBlur = 14;
      } else if (isSelected) {
        ctx.shadowColor = "#faC81E";
        ctx.shadowBlur = 14;
      }

      ctx.fillStyle = colorFor(obj);
      ctx.globalAlpha = obj.blink ? 0.55 + 0.45 * Math.abs(Math.sin(Date.now() / 220)) : 0.98;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      ctx.fillStyle = isPlayer ? "#000" : "#0b0b0b";
      ctx.font = `${isPlayer ? "900 11px" : "700 9px"} ui-sans-serif, system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(iconLabel(obj), px, py + 0.5);

      if (isSelected) {
        ctx.strokeStyle = "#faC81E";
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(px, py, radius + 4, 0, Math.PI * 2); ctx.stroke();
      }

      if (obj.dx !== undefined && obj.dy !== undefined && (obj.type === "aircraft" || obj.type === "helicopter")) {
        const len = 15;
        ctx.strokeStyle = colorFor(obj);
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + obj.dx * len, py + obj.dy * len);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }, [canvasSize, mapObjects, selectedKey, selectedMeta, trails]);

  useEffect(() => {
    draw();
    const id = setInterval(draw, 90);
    return () => clearInterval(id);
  }, [draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cpx = px * scaleX;
    const cpy = py * scaleY;
    const norm = fromCanvasPos(cpx, cpy, canvasSize.w, canvasSize.h);
    const hitNorm = HIT_RADIUS_PX / canvasSize.w;
    const nearest = findNearest(mapObjects, norm);
    if (!nearest) { deselect(); return; }
    const distPx = nearest.dist * canvasSize.w;
    if (distPx > HIT_RADIUS_PX) { deselect(); return; }
    const obj = nearest.obj;
    const friendly = isFriendly(obj);
    let trackId: string | null = null;
    if (friendly) {
      trackId = findFriendlyTrackForObject(obj);
      // If friendly but not yet tracked (just spawned, next poll will create), fall back to ephemeral but will be adopted next poll
      if (!trackId) trackId = `${obj.type}-${obj.icon}-${obj.color}-${nearest.idx}-ephemeral`;
    } else {
      // enemy: ephemeral, no persistent history needed
      trackId = `${obj.type}-${obj.icon}-${obj.color}-${nearest.idx}`;
    }
    if (selectedKey === trackId) { deselect(); return; }
    if (selectedKey && selectedMeta) {
      const d = Math.hypot(obj.x! - selectedMeta.x, obj.y! - selectedMeta.y);
      if (d < hitNorm * 1.2 && obj.icon === selectedMeta.icon && obj.color === selectedMeta.color) { deselect(); return; }
    }
    selectObject(obj, trackId);
    // For friendly, history already tracked from game start via updateFriendlyTracks — no need to append.
    // For enemy or ephemeral friendly not yet in trails, seed a single point so SelectedTargetPanel has something
    const hasTrail = useTelemetry.getState().trails.has(trackId);
    if (!hasTrail) {
      appendTrail(trackId, { x: obj.x!, y: obj.y!, t: Date.now(), dx: obj.dx, dy: obj.dy });
    }
  }, [mapObjects, canvasSize, selectedKey, selectedMeta, selectObject, deselect, appendTrail, findFriendlyTrackForObject]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cpx = px * scaleX;
    const cpy = py * scaleY;
    const norm = fromCanvasPos(cpx, cpy, canvasSize.w, canvasSize.h);
    const nearest = findNearest(mapObjects, norm);
    if (nearest && nearest.dist * canvasSize.w < HIT_RADIUS_PX) canvas.style.cursor = "pointer";
    else canvas.style.cursor = "crosshair";
  }, [mapObjects, canvasSize]);

  return (
    <div ref={containerRef} className="map-container" style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0e13", borderRadius: 12, overflow: "hidden", position: "relative" }}>
      {/* Map image layer (img tag avoids CORS fetch) */}
      <div style={{ position: "relative", width: canvasSize.w, height: canvasSize.h, flexShrink: 0 }}>
        {effectiveSrc ? (
          <img
            src={effectiveSrc}
            alt="map"
            onError={() => setImgError(true)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", display: "block", background: "#0f1419" }}
            draggable={false}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, #131a24 0%, #0f1419 70%)", display: "grid", placeItems: "center" }}>
            <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: 0.4 }}>Join a Battle</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Map, trails and telemetry appear here automatically</div>
            </div>
          </div>
        )}
        {/* Grid overlay when no image or as subtle overlay */}
        {!effectiveSrc && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.08, backgroundImage: "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)", backgroundSize: "10% 10%" }} />
        )}
        {/* Canvas overlay */}
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
        />
        {/* Border */}
        <div style={{ position: "absolute", inset: 0, border: "1px solid rgba(255,255,255,0.12)", pointerEvents: "none", borderRadius: 0 }} />
      </div>

      <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: 8, flexWrap: "wrap", pointerEvents: "none" }}>
        {selectedKey && <span style={{ fontSize: 11, color: "#faC81E", background: "rgba(0,0,0,0.65)", padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(250,200,30,0.4)" }}>● Tracking {trails.get(selectedKey)?.length ?? 0} pts</span>}
        <span style={{ fontSize: 10, color: connection === "battle" ? "#39D921" : "rgba(255,255,255,0.55)", background: "rgba(0,0,0,0.5)", padding: "4px 8px", borderRadius: 6 }}>{connection}{isMocked ? " mock" : ""}</span>
      </div>
    </div>
  );
}

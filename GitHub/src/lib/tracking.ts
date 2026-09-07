import type { MapObject } from "./types";

// Normalized x,y are 0-1. Distance threshold in normalized units.
const MATCH_DIST = 0.035; // ~3.5% of map
export const HIT_RADIUS_PX = 16;

export function isFriendly(obj: { color?: string; "color[]"?: [number, number, number]; type?: string }): boolean {
  if (obj.type === "airfield") return false;
  const c = (obj.color || "").toLowerCase();
  // explicit friendly palette observed live: cyan/blue/green/yellow
  if (c === "#17ffff" || c === "#185aff" || c === "#145cff" || c === "#14cfff" || c === "#39d921" || c === "#24d921" || c === "#fac81e" || c === "#fac81f" || c === "#00ff00" || c === "#54ff54") return true;
  // enemy red family
  if (c === "#fa0c00" || c === "#fa3200" || c === "#f01e00" || c === "#ff0000" || c === "#fa0a00") return false;
  // fallback via RGB: enemy is strong red high R, low G/B
  const rgb: any = (obj as any)["color[]"];
  if (Array.isArray(rgb) && rgb.length === 3) {
    const [r, g, b] = rgb as [number, number, number];
    if (r > 200 && g < 100 && b < 80) return false; // red enemy
    if (b > 100 || g > 100) return true; // cyan/blue/green friendly
    // yellow player #fac81e = 250,200,30 -> handled above
  }
  // default: treat anything not clearly red as friendly if it is aircraft/ground/helicopter
  // This ensures we track all friendly-ish, but enemy reds are filtered above
  // If color is missing, fallback to false for safety
  if (!c) return false;
  // heuristic: if contains "fa0" or "f01" it's red enemy
  if (c.startsWith("#fa0") || c.startsWith("#f01")) return false;
  return true;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function findNearest(
  objects: MapObject[],
  target: { x: number; y: number },
  filter?: (o: MapObject) => boolean
): { obj: MapObject; idx: number; dist: number } | null {
  let best: { obj: MapObject; idx: number; dist: number } | null = null;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (filter && !filter(o)) continue;
    if (o.x === undefined || o.y === undefined) continue;
    const d = distance({ x: o.x, y: o.y }, target);
    if (best === null || d < best.dist) best = { obj: o, idx: i, dist: d };
  }
  return best;
}

// Track history for selected unit: append if matched nearby
export function matchSelected(
  selected: { x: number; y: number; color: string; icon: string; type: string } | null,
  objects: MapObject[]
): MapObject | null {
  if (!selected) return null;
  let best: MapObject | null = null;
  let bestDist = Infinity;
  for (const o of objects) {
    if (o.x === undefined || o.y === undefined) continue;
    // prefer same icon/color/type but allow mismatch if very close
    const d = distance({ x: o.x, y: o.y }, selected);
    const sameIcon = o.icon === selected.icon;
    const sameColor = o.color === selected.color;
    const sameType = o.type === selected.type;
    let penalty = 0;
    if (!sameIcon) penalty += 0.015;
    if (!sameColor) penalty += 0.02;
    if (!sameType) penalty += 0.01;
    const score = d + penalty;
    if (score < bestDist && d < MATCH_DIST + 0.015) {
      bestDist = score;
      best = o;
    }
  }
  return best;
}

export function toCanvasPos(
  x: number,
  y: number,
  canvasW: number,
  canvasH: number
): { px: number; py: number } {
  return { px: x * canvasW, py: y * canvasH };
}

export function fromCanvasPos(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number
): { x: number; y: number } {
  return { x: px / canvasW, y: py / canvasH };
}

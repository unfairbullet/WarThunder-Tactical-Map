import { create } from "zustand";

export type UnitSystem = "metric" | "imperial";

interface UnitsState {
  system: UnitSystem;
  toggle: () => void;
  set: (s: UnitSystem) => void;
}

export const useUnits = create<UnitsState>((set) => {
  const saved = (typeof localStorage !== "undefined" ? (localStorage.getItem("wt-units") as UnitSystem | null) : null);
  const initial: UnitSystem = saved === "imperial" || saved === "metric" ? saved : "metric";
  return {
    system: initial,
    toggle: () => set((s) => {
      const next = s.system === "metric" ? "imperial" : "metric";
      try { localStorage.setItem("wt-units", next); } catch {}
      return { system: next };
    }),
    set: (system) => {
      try { localStorage.setItem("wt-units", system); } catch {}
      set({ system });
    },
  };
});

// Conversions
export function mToFt(m: number): number { return m * 3.28084; }
export function kmhToMph(kmh: number): number { return kmh * 0.621371; }
export function msToFpm(ms: number): number { return ms * 196.85; } // ft/min
export function msToMph(ms: number): number { return ms * 2.23694; }
export function kgToLb(kg: number): number { return kg * 2.20462; }
export function cToF(c: number): number { return c * 9/5 + 32; }
export function kgsToLbf(kgs: number): number { return kgs * 2.20462; } // kgf to lbf approx

export function fmt(value: number | undefined | null, fn: (n: number) => string): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return fn(value);
}

// Helpers that return { value, unit } strings
export function formatSpeed(kmh: number | undefined, system: UnitSystem): string {
  if (kmh === undefined || kmh === null) return "—";
  return system === "metric" ? `${kmh.toFixed(0)} km/h` : `${kmhToMph(kmh).toFixed(0)} mph`;
}
export function formatAlt(m: number | undefined, system: UnitSystem): string {
  if (m === undefined || m === null) return "—";
  return system === "metric" ? `${m.toFixed(0)} m` : `${mToFt(m).toFixed(0)} ft`;
}
export function formatDistM(m: number | undefined | null, system: UnitSystem): string {
  if (m === undefined || m === null) return "—";
  if (system === "metric") {
    return m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
  } else {
    const ft = mToFt(m);
    return ft >= 5280 ? `${(ft/5280).toFixed(2)} mi` : `${ft.toFixed(0)} ft`;
  }
}
export function formatFuelKg(kg: number | undefined, system: UnitSystem): string {
  if (kg === undefined || kg === null) return "—";
  return system === "metric" ? `${kg.toFixed(0)} kg` : `${kgToLb(kg).toFixed(0)} lb`;
}
export function formatVy(ms: number | undefined, system: UnitSystem): string {
  if (ms === undefined || ms === null) return "—";
  return system === "metric" ? `${ms.toFixed(1)} m/s` : `${msToFpm(ms).toFixed(0)} ft/min`;
}
export function formatTempC(c: number | undefined, system: UnitSystem): string {
  if (c === undefined || c === null) return "—";
  return system === "metric" ? `${c.toFixed(0)} °C` : `${cToF(c).toFixed(0)} °F`;
}
export function formatThrust(kgs: number | undefined, system: UnitSystem): string {
  if (kgs === undefined || kgs === null) return "—";
  return system === "metric" ? `${kgs.toFixed(0)} kgf` : `${kgsToLbf(kgs).toFixed(0)} lbf`;
}

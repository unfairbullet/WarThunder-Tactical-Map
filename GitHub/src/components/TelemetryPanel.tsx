import { useTelemetry } from "../store/useTelemetry";
import SelectedTargetPanel from "./SelectedTargetPanel";
import { cleanVehicleName } from "../lib/vehicleNames";
import { useUnits, formatSpeed, formatAlt, formatFuelKg, formatVy, formatThrust } from "../lib/units";

function Field({ label, value, unit }: { label: string; value: unknown; unit?: string }) {
  const v = value === undefined || value === null || value === "" ? "—" : String(value);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12 }}>
      <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{label}</span>
      <span style={{ color: "#e6edf3", fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{v}{unit ? ` ${unit}` : ""}</span>
    </div>
  );
}

export default function TelemetryPanel() {
  const { indicators, state, mission, mapInfo, connection, isMocked } = useTelemetry();
  const { system: unitSystem } = useUnits();
  const isAir = indicators?.army === "air" || (state?.valid && (state as any)["H, m"] !== undefined);
  const isTank = indicators?.army === "tank";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "auto", paddingRight: 4 }}>
      {/* connection badge */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
          padding: "5px 10px", borderRadius: 999,
          background: connection === "battle" ? "rgba(57,217,33,0.15)" : connection === "hangar" ? "rgba(250,200,30,0.15)" : "rgba(250,12,0,0.15)",
          color: connection === "battle" ? "#39D921" : connection === "hangar" ? "#faC81E" : "#fa0C00",
          border: `1px solid ${connection === "battle" ? "rgba(57,217,33,0.3)" : connection === "hangar" ? "rgba(250,200,30,0.3)" : "rgba(250,12,0,0.3)"}`
        }}>
          ● {connection} {isMocked ? "(mock)" : ""}
        </span>
        {mapInfo?.valid && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.06)", padding: "4px 8px", borderRadius: 6 }}>GEN {String(mapInfo.map_generation)}</span>}
        {mapInfo?.valid && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{(mapInfo.grid_size?.[0] ?? 0).toString()} grid</span>}
      </div>

      {/* mission — battle only, empty in hangar */}
      <section style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 12 }}>
        <h3 style={{ margin: 0, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Mission</h3>
        {connection !== "battle" ? <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>No mission — join a battle</div> :
        <>
        <Field label="Status" value={mission?.status ?? "—"} />
        {mission?.objectives?.length ? mission.objectives.map((o, i) => (
          <div key={i} style={{ fontSize: 12, color: "#e6edf3", padding: "6px 8px", background: o.primary ? "rgba(23,255,255,0.08)" : "rgba(255,255,255,0.03)", borderRadius: 6, marginTop: 6, borderLeft: `3px solid ${o.status === "completed" ? "#39D921" : o.status === "failed" ? "#fa0C00" : "#17FFFF"}` }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: o.primary ? "#17FFFF" : "rgba(255,255,255,0.7)" }}>{o.primary ? "PRIMARY" : "SECONDARY"} • {o.status}</div>
            <div>{o.text}</div>
          </div>
        )) : <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontStyle: "italic" }}>{mission ? "No objectives" : "No data"}</div>}
        </>}
      </section>

      {/* vehicle telemetry — single adaptive box. Air fields read primarily from
          /state (fresh every tick) with /indicators as fallback; ground keeps
          its tank fields. Shown whenever EITHER source is valid. */}
      <section style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 12 }}>
        <h3 style={{ margin: 0, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
          Vehicle Telemetry ({unitSystem === "metric" ? "Metric" : "Imperial"}) {indicators?.type ? `— ${cleanVehicleName(String(indicators.type))}` : ""}
        </h3>
        {!(indicators?.valid || state?.valid) && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontStyle: "italic" }}>No vehicle data (not in battle or invalid)</div>}
        {(indicators?.valid || state?.valid) && (
          <>
            {isTank && indicators?.valid && <>
              <Field label="Speed" value={formatSpeed(indicators.speed as number | undefined, unitSystem)} />
              <Field label="RPM" value={indicators.rpm as number | undefined} />
              <Field label="Gear" value={indicators.gear as number | undefined} />
              <Field label="Stabilizer" value={indicators.stabilizer as number | undefined} />
              <Field label="Crew" value={indicators.crew_current !== undefined ? `${indicators.crew_current}/${indicators.crew_total}` : undefined} />
              <Field label="LWS/IRCM" value={`${indicators.lws ?? "—"} / ${indicators.ircm ?? "—"}`} />
              <Field label="Ammo 1st" value={indicators.first_stage_ammo as number | undefined} />
            </>}
            {!isTank && <>
              <Field label="Speed" value={formatSpeed((state?.["TAS, km/h"] as number | undefined) ?? (indicators?.speed as number | undefined), unitSystem)} />
              <Field label="Altitude" value={formatAlt((state?.["H, m"] as number | undefined) ?? (indicators?.altitude_hour as number | undefined), unitSystem)} />
              <Field label="TAS / IAS" value={state?.["TAS, km/h"] !== undefined ? `${formatSpeed(state["TAS, km/h"] as number, unitSystem)} / ${formatSpeed(state["IAS, km/h"] as number, unitSystem)}` : (indicators?.speed !== undefined ? formatSpeed(indicators.speed as number, unitSystem) : undefined)} />
              <Field label="M" value={(state?.M as number | undefined) ?? (indicators?.mach as number | undefined)} />
              <Field label="AoA" value={state?.["AoA, deg"] !== undefined ? `${state["AoA, deg"]}°` : (indicators?.aoa !== undefined ? `${(indicators.aoa as number).toFixed(1)}°` : undefined)} />
              <Field label="G (Ny)" value={(state?.Ny as number | undefined) ?? (indicators?.g_meter as number | undefined)} />
              <Field label="Compass" value={indicators?.compass != null ? `${(indicators.compass as number).toFixed(1)}°` : undefined} />
              <Field label="Vy" value={formatVy(state?.["Vy, m/s"] as number | undefined, unitSystem)} />
              <Field label="Throttle" value={indicators?.throttle !== undefined ? `${((indicators.throttle as number)*100).toFixed(0)}%` : undefined} />
              <Field label="Fuel" value={state?.["Mfuel, kg"] !== undefined ? `${formatFuelKg(state["Mfuel, kg"] as number, unitSystem)} / ${formatFuelKg(state["Mfuel0, kg"] as number, unitSystem)}` : formatFuelKg(indicators?.fuel as number | undefined, unitSystem)} />
              <Field label="Thrust 1/2" value={(state?.["thrust 1, kgs"] !== undefined) ? (state["thrust 2, kgs"] !== undefined ? `${formatThrust(state["thrust 1, kgs"] as number, unitSystem)} / ${formatThrust(state["thrust 2, kgs"] as number, unitSystem)}` : formatThrust(state["thrust 1, kgs"] as number, unitSystem)) : undefined} />
              <Field label="RPM 1/2" value={(state?.["RPM 1"] !== undefined) ? ((state["RPM 2"] !== undefined) ? `${state["RPM 1"]} / ${state["RPM 2"]}` : `${state["RPM 1"]}`) : (indicators?.rpm as number | undefined)} />
            </>}
            {/* generic fallback for unknown army */}
            {!isAir && !isTank && indicators?.valid && Object.entries(indicators).filter(([k]) => !["valid", "army", "type"].includes(k)).slice(0, 8).map(([k, v]) => (
              <Field key={k} label={k} value={typeof v === "number" ? (v as number).toFixed(2) : String(v)} />
            ))}
          </>
        )}
      </section>

      {/* selected target - always below own telemetry */}
      <SelectedTargetPanel />

      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textAlign: "center", padding: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        Polling localhost:8111 • 300ms battle / 1s hangar • Auto-refresh on map_generation
      </div>
    </div>
  );
}

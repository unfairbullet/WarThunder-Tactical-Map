// Vehicle name cleanup: turns raw WarThunder ids like "tankModels/ussr_t_90a" or "su_30mk2v_venezuela" into human readable.
// Safe, no EAC trigger - pure string formatting.

const COUNTRY_CODES = new Set([
  "ussr","us","usa","uk","germ","ger","fr","france","jp","japan","ch","china","sw","sweden","it","italy","isr","israel",
  "ussr_","us_","uk_","jp_","fr_","ch_","sw_","it_","isr_",
]);

const CORRECTIONS: Record<string,string> = {
  "pantsyr": "Pantsir",
  "pantsir": "Pantsir",
  "venezuela": "Venezuela",
  "ussr": "", // dropped, handled
  "us": "",
  "usa": "",
  "uk": "",
  "germ": "",
  "ger": "",
  "sw": "",
  "ch": "",
  "it": "",
  "isr": "",
  "jp": "",
  "fr": "",
  "mk2v": "MK2V",
  "mk2": "MK2",
  "s1": "S1",
  "s2": "S2",
  "a1": "A1",
  "a2": "A2",
  "b3a": "B3A",
  "bvm": "BVM",
  "aim": "AIM",
  "sep": "SEP",
  "lct": "LCT",
  "cert": "Certezza",
};

function isDesignation(seg: string): boolean {
  // e.g. m1a2, 80bvm, 30mk2v, wz1001, t90, su27, 10rc, 2a6
  return /^[a-z]*\d+[a-z0-9]*$/i.test(seg) && /[a-z]/i.test(seg);
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  const low = w.toLowerCase();
  if (CORRECTIONS[low] !== undefined) return CORRECTIONS[low];
  // designations like t90, m1a2, wz1001, 10rc should be fully uppercased
  if (isDesignation(w)) return w.toUpperCase();
  if (w.length <= 3 && /^[a-z0-9]+$/i.test(w)) return w.toUpperCase();
  if (w.includes("-")) {
    return w.split("-").map(seg => {
      const sl = seg.toLowerCase();
      if (CORRECTIONS[sl] !== undefined) return CORRECTIONS[sl];
      if (isDesignation(seg)) return seg.toUpperCase();
      if (seg.length <= 3) return seg.toUpperCase();
      return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
    }).join("-");
  }
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

export function cleanVehicleName(raw?: string | null): string {
  if (!raw) return "—";
  // take after last slash or backslash
  let s = String(raw).split("/").pop()!.split("\\").pop()!;
  // strip file extensions if any
  s = s.replace(/\.(blk|csv|json)$/i, "");
  // underscores -> spaces, multiple spaces -> single
  s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  // insert dash between letter block + number block when separated by space e.g. "t 90" -> "t-90", "su 30" -> "su-30"
  s = s.replace(/\b([a-z]+)\s+(\d)/gi, "$1-$2");
  // also handle "pantsir s1" -> keep but will be title-cased to "Pantsir S1" — acceptable, but try to make "Pantsir-S1"
  s = s.replace(/\b(pantsir|pantsyr)\s+(s\d)\b/gi, "$1-$2");

  const parts = s.split(" ").filter(Boolean).map(titleCaseWord).filter(Boolean);
  // drop leading country code if present and more than one part
  if (parts.length > 1) {
    const firstLow = parts[0].toLowerCase();
    if (COUNTRY_CODES.has(firstLow) || COUNTRY_CODES.has(firstLow + "_")) {
      parts.shift();
    }
  }
  let out = parts.join(" ");
  // Fixups: "T-90A" not "T-90a"
  out = out.replace(/\bT-(\d+)([a-z])\b/g, (_, n, l) => `T-${n}${l.toUpperCase()}`);
  out = out.replace(/\bSu-(\d+)/g, "Su-$1");
  out = out.replace(/\bMig-(\d+)/gi, m => m.toUpperCase());
  out = out.replace(/\bM1A(\d)/g, "M1A$1");
  out = out.replace(/\bZtz/gi, "ZTZ");
  // collapse double spaces
  out = out.replace(/\s+/g, " ").trim();
  return out || "—";
}

export function cleanIconName(icon?: string | null): string {
  if (!icon || icon === "none") return "—";
  const map: Record<string,string> = {
    "Fighter": "Fighter",
    "Bomber": "Bomber",
    "Assault": "Strike",
    "Player": "Player",
    "Tracked": "Tracked",
    "Wheeled": "Wheeled",
    "Airdefence": "SPAA",
    "AirDefence": "SPAA",
    "MediumTank": "Medium Tank",
    "HeavyTank": "Heavy Tank",
    "LightTank": "Light Tank",
    "SPAA": "SPAA",
    "ATGM": "ATGM",
    "Helicopter": "Helicopter",
  };
  if (map[icon]) return map[icon];
  // generic humanize: insert space before capitals
  return icon.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
}

export function cleanTypeName(type?: string | null): string {
  if (!type) return "—";
  const map: Record<string,string> = {
    "airfield": "Airfield",
    "aircraft": "Aircraft",
    "helicopter": "Helicopter",
    "ground_model": "Ground Unit",
    "ground_model_tank": "Tank",
  };
  if (map[type]) return map[type];
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

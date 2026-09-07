// War Thunder localhost:8111 types derived from live audit + docs
// MapInfo
export interface MapInfo {
  valid: boolean;
  grid_size?: [number, number];
  grid_steps?: [number, number] | [string, string];
  grid_zero?: [number, number] | [string, string];
  grid_zero_str?: string[];
  map_generation?: string | number;
  map_max?: [number, number] | [string, string];
  map_min?: [number, number] | [string, string];
  hud_type?: number;
}

// Map Objects - from map_obj.json
export type MapObjectType = "airfield" | "aircraft" | "helicopter" | "ground_model" | string;
export interface MapObject {
  type: MapObjectType;
  color: string;
  "color[]": [number, number, number];
  blink: number;
  icon: string; // Fighter, Bomber, Assault, Player, Tracked, Wheeled, Airdefence, none
  icon_bg: string;
  // aircraft/helicopter/ground_model use x,y + dx,dy
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  // airfield uses sx,sy,ex,ey
  sx?: number;
  sy?: number;
  ex?: number;
  ey?: number;
}

// Indicators - highly variable between air/tank
export interface Indicators {
  valid: boolean;
  army?: string; // "air" | "tank"
  type?: string;
  // common air
  speed?: number;
  pedals?: number;
  stick_elevator?: number;
  stick_ailerons?: number;
  vario?: number;
  altitude_hour?: number;
  altitude_min?: number;
  altitude_10k?: number;
  aviahorizon_roll?: number;
  aviahorizon_pitch?: number;
  bank?: number;
  compass?: number;
  compass1?: number;
  clock_hour?: number;
  clock_min?: number;
  clock_sec?: number;
  rpm?: number;
  rpm1?: number;
  fuel?: number;
  fuel1?: number;
  oil_pressure?: number;
  oil_pressure1?: number;
  head_temperature?: number;
  throttle?: number;
  throttle1?: number;
  gears?: number;
  flaps?: number;
  mach?: number;
  g_meter?: number;
  g_meter_max?: number;
  aoa?: number;
  // tank extras
  stabilizer?: number;
  gear?: number;
  gear_neutral?: number;
  has_speed_warning?: number;
  driving_direction_mode?: number;
  cruise_control?: number;
  lws?: number;
  ircm?: number;
  crew_total?: number;
  crew_current?: number;
  crew_distance?: number;
  gunner_state?: number;
  driver_state?: number;
  first_stage_ammo?: number;
  // catch-all
  [key: string]: unknown;
}

// State - air detailed
export interface State {
  valid: boolean;
  "aileron, %"?: number;
  "elevator, %"?: number;
  "rudder, %"?: number;
  "flaps, %"?: number;
  "gear, %"?: number;
  "airbrake, %"?: number;
  "H, m"?: number;
  "TAS, km/h"?: number;
  "IAS, km/h"?: number;
  M?: number;
  "AoA, deg"?: number;
  "AoS, deg"?: number;
  Ny?: number;
  "Vy, m/s"?: number;
  "Wx, deg/s"?: number;
  "Mfuel, kg"?: number;
  "Mfuel0, kg"?: number;
  // per-engine dynamic keys
  [key: string]: unknown;
}

// Mission
export interface Mission {
  objectives: Array<{ primary: boolean; status: string; text: string }> | null;
  status: string; // running, success, fail
}

// Gamechat
export interface ChatMessage {
  id: number;
  msg: string;
  sender: string;
  enemy: boolean;
  mode: string;
  time?: number;
}

// Hudmsg
export interface HudMessage {
  id: number;
  msg: string;
  sender: string;
  enemy: boolean;
  mode: string;
  time: number;
}
export interface HudMsg {
  events: HudMessage[];
  damage: HudMessage[];
}

// Combined telemetry snapshot
export interface TelemetrySnapshot {
  timestamp: number;
  mapInfo: MapInfo | null;
  mapObjects: MapObject[];
  mapImgBlobUrl: string | null;
  mapImgGeneration: string | number | null;
  indicators: Indicators | null;
  state: State | null;
  mission: Mission | null;
  gamechat: ChatMessage[];
  hudmsg: HudMsg | null;
  connection: "offline" | "hangar" | "battle";
  error?: string;
}

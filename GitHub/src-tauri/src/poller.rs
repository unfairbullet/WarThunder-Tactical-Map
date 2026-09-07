use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const BASE: &str = "http://127.0.0.1:8111";

async fn fetch_json(client: &reqwest::Client, path: &str) -> Option<Value> {
    let url = format!("{}{}", BASE, path);
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let text = resp.text().await.ok()?;
    if text.trim().is_empty() {
        return None;
    }
    // map_obj.json can be "[]", mission etc. Try parse, if fails return None
    match serde_json::from_str::<Value>(&text) {
        Ok(v) => Some(v),
        Err(_) => {
            // For map_obj empty string corner, treat as empty array
            if text.trim() == "[]" {
                Some(Value::Array(vec![]))
            } else {
                None
            }
        }
    }
}

async fn fetch_map_obj(client: &reqwest::Client) -> Option<Value> {
    let url = format!("{}/map_obj.json", BASE);
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let text = resp.text().await.ok()?;
    if text.trim().is_empty() {
        return Some(Value::Array(vec![]));
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(v) if v.is_array() => Some(v),
        Ok(v) => Some(v),
        Err(_) => {
            if text.trim() == "[]" {
                Some(Value::Array(vec![]))
            } else {
                None
            }
        }
    }
}

struct ChatCache {
    last_chat_id: i64,
    last_evt_id: i64,
    last_dmg_id: i64,
    gamechat: Value,
    hudmsg: Value,
}

async fn fetch_chat(client: &reqwest::Client, last_id: i64) -> Value {
    let url = format!("{}/gamechat?lastId={}", BASE, last_id);
    match tokio::time::timeout(Duration::from_millis(800), client.get(&url).send()).await {
        Ok(Ok(resp)) if resp.status().is_success() => match resp.text().await {
            Ok(txt) => serde_json::from_str(&txt).unwrap_or(Value::Array(vec![])),
            Err(_) => Value::Array(vec![]),
        },
        _ => Value::Array(vec![]),
    }
}

async fn fetch_hud(client: &reqwest::Client, last_evt: i64, last_dmg: i64) -> Value {
    let url = format!("{}/hudmsg?lastEvt={}&lastDmg={}", BASE, last_evt, last_dmg);
    match tokio::time::timeout(Duration::from_millis(800), client.get(&url).send()).await {
        Ok(Ok(resp)) if resp.status().is_success() => match resp.text().await {
            Ok(txt) => serde_json::from_str(&txt).unwrap_or(serde_json::json!({"events":[],"damage":[]})),
            Err(_) => serde_json::json!({"events":[],"damage":[]}),
        },
        _ => serde_json::json!({"events":[],"damage":[]}),
    }
}

pub fn start_poller(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(1000))
            .connect_timeout(Duration::from_millis(600))
            .pool_idle_timeout(Duration::from_secs(10))
            .tcp_nodelay(true)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let mut poll_interval_ms: u64;
        let chat_cache = std::sync::Arc::new(tokio::sync::Mutex::new(ChatCache {
            last_chat_id: 0,
            last_evt_id: 0,
            last_dmg_id: 0,
            gamechat: Value::Array(vec![]),
            hudmsg: serde_json::json!({"events":[],"damage":[]}),
        }));

        // Slow loop: chat/hud at ~1.5s in parallel, never blocks the fast telemetry loop.
        {
            let cache = chat_cache.clone();
            let slow_client = client.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let (last_chat, last_evt, last_dmg) = {
                        let c = cache.lock().await;
                        (c.last_chat_id, c.last_evt_id, c.last_dmg_id)
                    };
                    // Sequential: the game server handles one request at a time and
                    // closes every connection, so parallel bursts only queue up.
                    let gc = fetch_chat(&slow_client, last_chat).await;
                    let hm = fetch_hud(&slow_client, last_evt, last_dmg).await;
                    {
                        let mut c = cache.lock().await;
                        if let Value::Array(arr) = &gc {
                            if let Some(last) = arr.last() {
                                if let Some(id) = last.get("id").and_then(|v| v.as_i64()) {
                                    c.last_chat_id = id;
                                }
                            }
                            if !arr.is_empty() {
                                c.gamechat = gc;
                            }
                        }
                        if let Value::Object(map) = &hm {
                            let mut touched = false;
                            if let Some(Value::Array(evts)) = map.get("events") {
                                if let Some(last) = evts.last() {
                                    if let Some(id) = last.get("id").and_then(|v| v.as_i64()) {
                                        c.last_evt_id = id;
                                    }
                                }
                                if !evts.is_empty() { touched = true; }
                            }
                            if let Some(Value::Array(dmgs)) = map.get("damage") {
                                if let Some(last) = dmgs.last() {
                                    if let Some(id) = last.get("id").and_then(|v| v.as_i64()) {
                                        c.last_dmg_id = id;
                                    }
                                }
                                if !dmgs.is_empty() { touched = true; }
                            }
                            if touched {
                                c.hudmsg = hm;
                            }
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                }
            });
        }
        // Keep last successful payloads to avoid flicker on transient 1-2 poll failures
        let mut last_map_info: Option<Value> = None;
        let mut last_map_obj: Option<Value> = None;
        let mut last_indicators: Option<Value> = None;
        let mut last_state: Option<Value> = None;
        let mut last_mission: Option<Value> = None;
        let mut consecutive_failures: u32 = 0;

        // Small delay to let frontend mount listener
        tokio::time::sleep(Duration::from_millis(500)).await;

        let mut tick: u64 = 0;
        loop {
            let loop_start = std::time::Instant::now();
            tick += 1;
            // Sequential fetches: the game server answers one request at a time
            // (~200ms each in battle) and supports no keep-alive, so a parallel
            // burst only queues server-side and burns connections. Essentials
            // every tick; map_info/mission (rarely change) every 4th tick.
            let map_obj_opt = fetch_map_obj(&client).await;
            let indicators_opt = fetch_json(&client, "/indicators").await;
            let state_opt = fetch_json(&client, "/state").await;
            let (map_info_opt, mission_opt) = if tick % 4 == 1 {
                (
                    fetch_json(&client, "/map_info.json").await,
                    fetch_json(&client, "/mission.json").await,
                )
            } else {
                (None, None)
            };
            // Stale-while-revalidate: judge by the essentials fetched every tick
            // (map_info/mission are intentionally skipped 3 of 4 ticks).
            let all_failed = map_obj_opt.is_none() && indicators_opt.is_none() && state_opt.is_none();
            if all_failed {
                consecutive_failures += 1;
            } else {
                consecutive_failures = 0;
                if let Some(v) = map_info_opt { last_map_info = Some(v); }
                if let Some(v) = map_obj_opt { last_map_obj = Some(v); }
                if let Some(v) = indicators_opt { last_indicators = Some(v); }
                if let Some(v) = state_opt { last_state = Some(v); }
                if let Some(v) = mission_opt { last_mission = Some(v); }
            }
            // Emit last successful values to avoid flicker on transient single-poll failure
            let map_info = last_map_info.clone();
            let map_obj = last_map_obj.clone().unwrap_or(Value::Array(vec![]));
            let indicators = last_indicators.clone();
            let state = last_state.clone();
            let mission = last_mission.clone();

            // Chat/hud come from the slow-loop cache — cloning here never blocks fast telemetry.
            let (gamechat, hudmsg) = {
                let c = chat_cache.lock().await;
                (c.gamechat.clone(), c.hudmsg.clone())
            };

            // If we have had 4 consecutive all-fails, truly offline — don't emit stale battle data
            let (mut map_info, mut map_obj, mut indicators, mut state, mut mission, mut connection) = if consecutive_failures >= 4 {
                (None, Value::Array(vec![]), None, None, None, "offline")
            } else {
                let is_valid_map = map_info
                    .as_ref()
                    .and_then(|v| v.get("valid"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let has_objects = match &map_obj {
                    Value::Array(a) => a.len() > 8,
                    _ => false,
                };
                let conn = if is_valid_map || has_objects {
                    "battle"
                } else if indicators.is_some() || mission.is_some() {
                    "hangar"
                } else {
                    if map_info.is_none() && indicators.is_none() && state.is_none() {
                        "offline"
                    } else {
                        "hangar"
                    }
                };
                (map_info, map_obj, indicators, state, mission, conn)
            };
            // Honest intervals: sequential fetches cost ~200ms each in battle,
            // so a tick is ~700ms of server time. Polling faster only queues.
            poll_interval_ms = match connection {
                "battle" => 900,
                "hangar" => 1500,
                _ => 2500,
            };

            // Build payload matching frontend pollAll shape
            let generation = map_info
                .as_ref()
                .and_then(|v| v.get("map_generation"))
                .cloned()
                .unwrap_or(Value::Null);

            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let payload = serde_json::json!({
                "mapInfo": map_info.unwrap_or(Value::Null),
                "mapObjects": map_obj,
                "indicators": indicators.unwrap_or(Value::Null),
                "state": state.unwrap_or(Value::Null),
                "mission": mission.unwrap_or(Value::Null),
                "gamechat": gamechat,
                "hudmsg": hudmsg,
                "connection": connection,
                "generation": generation,
                "_mocked": false,
                "ts": ts,
            });

            // Emit to frontend — ignore error if no listener yet
            let _ = app.emit("telemetry-update", payload);

            // Adaptive sleep: ensure interval from loop_start, not from end
            let elapsed = loop_start.elapsed();
            let mut sleep_dur = Duration::from_millis(poll_interval_ms).saturating_sub(elapsed);
            // Ensure at least 80ms sleep to avoid tight loop on repeated failures
            if sleep_dur < Duration::from_millis(80) {
                sleep_dur = Duration::from_millis(80);
            }
            tokio::time::sleep(sleep_dur).await;
        }
    });
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

import { useTelemetry } from "../store/useTelemetry";
import { isSpamMessage, stripMarkup } from "../lib/chatFilter";

export default function ChatPanel() {
  const { gamechat, killFeed, connection } = useTelemetry();
  const inBattle = connection === "battle";
  const cleanChat = inBattle ? gamechat.filter((m) => !isSpamMessage(m.msg)) : [];
  // Newest first — box scrolls as it fills through the match.
  const killsNewestFirst = [...killFeed].reverse();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
      <section style={{ flex: 1, display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, overflow: "hidden" }}>
        <h3 style={{ margin: 0, padding: "10px 12px", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>Game Chat · {cleanChat.length}</h3>
        <div style={{ flex: 1, overflow: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {cleanChat.length === 0 && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>No messages</div>}
          {cleanChat.slice(-40).map(m => (
            <div key={m.id} style={{ fontSize: 12, lineHeight: 1.35, padding: "6px 8px", background: m.enemy ? "rgba(250,12,0,0.08)" : "rgba(23,255,255,0.06)", borderRadius: 6, borderLeft: `2px solid ${m.enemy ? "#fa0C00" : m.mode === "All" ? "rgba(255,255,255,0.2)" : "#17FFFF"}` }}>
              <span style={{ fontWeight: 700, color: m.enemy ? "#ff6b6b" : "#7ee8ff" }}>{m.sender || "—"}</span>
              <span style={{ color: "rgba(255,255,255,0.35)", margin: "0 6px", fontSize: 10 }}>{m.mode}</span>
              <span style={{ color: "#e6edf3" }}>{stripMarkup(m.msg)}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ flex: 1, display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, overflow: "hidden" }}>
        <h3 style={{ margin: 0, padding: "10px 12px", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>Kill Feed · {killFeed.length}</h3>
        <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {killsNewestFirst.length === 0 && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>No events</div>}
          {killsNewestFirst.map(d => (
            <div key={d.id} style={{ fontSize: 11, lineHeight: 1.35, padding: "5px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 6, color: "rgba(230,237,243,0.9)", fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: "rgba(255,255,255,0.35)", marginRight: 6 }}>[{d.time}s]</span>{stripMarkup(d.msg)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

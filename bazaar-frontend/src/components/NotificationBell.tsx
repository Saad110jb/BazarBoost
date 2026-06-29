"use client";
import React, { useState, useRef, useEffect } from "react";
import { useNotifications, NotificationEntry } from "@/context/NotificationContext";

// ── Severity badge renderer ───────────────────────────────────────────────────
function SeverityBadge({ type, badge }: { type: string; badge?: string }) {
  if (badge === "AI_RECOMMENDED" || type === "ai_alert") {
    return (
      <span style={{
        fontSize: "9px",
        background: "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(109,40,217,0.25))",
        color: "#c084fc",
        border: "1px solid rgba(168,85,247,0.5)",
        padding: "0.12rem 0.4rem",
        borderRadius: "4px",
        fontWeight: 900,
        letterSpacing: "0.03em",
        boxShadow: "0 0 8px rgba(168,85,247,0.3)",
        flexShrink: 0,
      }}>
        [AI-RECOMMENDED]
      </span>
    );
  }
  if (type === "security_alert") {
    return (
      <span className="animate-pulse" style={{
        fontSize: "9px",
        background: "rgba(239,68,68,0.15)",
        color: "#ef4444",
        border: "1px solid rgba(239,68,68,0.4)",
        padding: "0.12rem 0.35rem",
        borderRadius: "4px",
        fontWeight: 900,
        letterSpacing: "0.03em",
        flexShrink: 0,
      }}>
        [CRITICAL]
      </span>
    );
  }
  if (type === "flash_sale" || type === "order_update" || type === "financial") {
    return (
      <span style={{
        fontSize: "9px",
        background: "rgba(168,85,247,0.15)",
        color: "#a855f7",
        border: "1px solid rgba(168,85,247,0.35)",
        padding: "0.12rem 0.35rem",
        borderRadius: "4px",
        fontWeight: 900,
        letterSpacing: "0.03em",
        flexShrink: 0,
      }}>
        [FINANCIAL]
      </span>
    );
  }
  return (
    <span style={{
      fontSize: "9px",
      background: "rgba(59,130,246,0.12)",
      color: "#60a5fa",
      border: "1px solid rgba(59,130,246,0.3)",
      padding: "0.12rem 0.35rem",
      borderRadius: "4px",
      fontWeight: 900,
      letterSpacing: "0.03em",
      flexShrink: 0,
    }}>
      [INFO]
    </span>
  );
}

// ── Icon & color maps ─────────────────────────────────────────────────────────
const TYPE_ICON: Record<string, string> = {
  order_update:   "📦",
  ad_approved:    "🚀",
  flash_sale:     "⚡",
  security_alert: "🚨",
  general:        "🔔",
  ai_alert:       "✨",
  financial:      "💰",
};

const TYPE_COLOR: Record<string, string> = {
  order_update:   "#10b981",
  ad_approved:    "#a855f7",
  flash_sale:     "#f59e0b",
  security_alert: "#ef4444",
  general:        "#7c3aed",
  ai_alert:       "#c084fc",
  financial:      "#a855f7",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotificationSkeleton() {
  return (
    <div style={{ padding: "0.75rem 1.25rem", display: "flex", gap: "12px", alignItems: "flex-start" }}>
      <div style={{
        width: "36px", height: "36px", borderRadius: "10px",
        background: "rgba(255,255,255,0.05)", flexShrink: 0,
        animation: "skelPulse 1.5s ease-in-out infinite",
      }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{
          height: "10px", borderRadius: "4px", width: "60%",
          background: "rgba(255,255,255,0.05)",
          animation: "skelPulse 1.5s ease-in-out infinite",
        }} />
        <div style={{
          height: "8px", borderRadius: "4px", width: "90%",
          background: "rgba(255,255,255,0.03)",
          animation: "skelPulse 1.5s ease-in-out 0.2s infinite",
        }} />
      </div>
    </div>
  );
}

export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef           = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    if (!open && notifications.length === 0) {
      setLoading(true);
      setTimeout(() => setLoading(false), 600);
    }
    setOpen(v => !v);
  };

  const handleMarkRead = async (n: NotificationEntry) => {
    if (!n.isRead) await markRead(n._id);
  };

  const displayCount = unreadCount > 99 ? "99+" : unreadCount;

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      {/* Bell Capsule Button */}
      <button
        id="notification-bell-btn"
        onClick={handleOpen}
        style={{
          position:       "relative",
          background:     "rgba(124,58,237,0.12)",
          border:         "1px solid rgba(124,58,237,0.35)",
          borderRadius:   "12px",
          width:          "42px",
          height:         "42px",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          cursor:         "pointer",
          transition:     "all 0.2s ease",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.background  = "rgba(124,58,237,0.25)";
          (e.currentTarget as HTMLButtonElement).style.transform   = "scale(1.06)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(168,85,247,0.6)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow   = "0 0 18px rgba(168,85,247,0.25)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background  = "rgba(124,58,237,0.12)";
          (e.currentTarget as HTMLButtonElement).style.transform   = "scale(1)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(124,58,237,0.35)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow   = "none";
        }}
        aria-label="Notifications"
      >
        <span style={{ animation: unreadCount > 0 ? "bellRing 1.8s ease infinite" : "none", display: "flex" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </span>
        {unreadCount > 0 && (
          <span className="bg-purple-600 text-[10px] font-black text-white px-1.5 py-0.5 rounded-full absolute -top-1 -right-1"
            style={{ boxShadow: "0 0 10px rgba(147,51,234,0.7)", lineHeight: 1, minWidth: "18px", textAlign: "center" }}>
            {displayCount}
          </span>
        )}
      </button>

      {/* Dropdown Drawer */}
      {open && (
        <div
          className="bg-[#111119] border border-slate-800 rounded-xl shadow-2xl absolute right-0 top-12 z-50"
          style={{
            width: "340px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 40px rgba(124,58,237,0.12)",
            maxHeight: "520px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "dropdownSlide 0.18s ease",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span style={{ fontWeight: 800, fontSize: "0.88rem", color: "#f8f8ff" }}>Notifications</span>
              {unreadCount > 0 && (
                <span style={{
                  fontSize: "0.7rem", color: "#a855f7", fontWeight: 700,
                  background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.25)",
                  borderRadius: "8px", padding: "0.1rem 0.4rem"
                }}>
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                id="mark-all-read-btn"
                onClick={markAllRead}
                style={{
                  background: "none", border: "none", color: "#a855f7", cursor: "pointer",
                  fontSize: "0.72rem", fontWeight: 700, padding: "3px 8px", borderRadius: "6px",
                  transition: "background 0.2s",
                }}
                onMouseEnter={e  => (e.currentTarget.style.background = "rgba(168,85,247,0.12)")}
                onMouseLeave={e => (e.currentTarget.style.background = "none")}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading ? (
              <><NotificationSkeleton /><NotificationSkeleton /><NotificationSkeleton /></>
            ) : notifications.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center" }}>
                <div style={{ fontSize: "2.2rem", marginBottom: "10px" }}>🔕</div>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#6b6b85" }}>No notifications yet</div>
                <div style={{ fontSize: "0.75rem", color: "#4b4b65", marginTop: "4px" }}>You are all caught up!</div>
              </div>
            ) : (
              notifications.map(n => {
                const accentColor = TYPE_COLOR[n.type] || "#7c3aed";
                const isAI = n.type === "ai_alert" || (n as any).badge === "AI_RECOMMENDED";
                return (
                  <div
                    key={n._id}
                    id={`notif-${n._id}`}
                    onClick={() => handleMarkRead(n)}
                    style={{
                      display: "flex", gap: "10px", padding: "10px 16px",
                      background: n.isRead ? "transparent" : isAI ? "rgba(168,85,247,0.05)" : "rgba(124,58,237,0.06)",
                      borderLeft: n.isRead ? "3px solid transparent" : `3px solid ${accentColor}`,
                      cursor: "pointer", transition: "background 0.18s",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = isAI ? "rgba(168,85,247,0.10)" : "rgba(124,58,237,0.10)")}
                    onMouseLeave={e => (e.currentTarget.style.background = n.isRead ? "transparent" : isAI ? "rgba(168,85,247,0.05)" : "rgba(124,58,237,0.06)")}
                  >
                    <div style={{
                      width: "36px", height: "36px", borderRadius: "10px",
                      background: `${accentColor}18`, border: `1px solid ${accentColor}35`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "17px", flexShrink: 0,
                      boxShadow: isAI ? `0 0 12px ${accentColor}30` : "none",
                    }}>
                      {(n as any).icon || TYPE_ICON[n.type] || "🔔"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap", marginBottom: "3px" }}>
                        <SeverityBadge type={n.type} badge={(n as any).badge} />
                        <div style={{ fontWeight: 700, fontSize: "0.83rem", color: "#f0f0ff", lineHeight: 1.3 }}>
                          {n.title}
                        </div>
                      </div>
                      <div style={{ fontSize: "0.76rem", color: "#a9a9c0", lineHeight: "1.45", marginBottom: "4px" }}>
                        {n.body}
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#5a5a75" }}>{timeAgo(n.createdAt)}</div>
                    </div>
                    {!n.isRead && (
                      <div style={{
                        width: "7px", height: "7px", borderRadius: "50%",
                        background: accentColor, boxShadow: `0 0 6px ${accentColor}`,
                        flexShrink: 0, alignSelf: "center",
                        animation: n.type === "security_alert" ? "criticalPulse 1s ease infinite" : "none",
                      }} />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes bellRing {
          0%, 85%, 100% { transform: rotate(0deg); }
          10%            { transform: rotate(12deg); }
          20%            { transform: rotate(-12deg); }
          30%            { transform: rotate(9deg); }
          40%            { transform: rotate(-9deg); }
          50%            { transform: rotate(0deg); }
        }
        @keyframes dropdownSlide {
          from { opacity: 0; transform: translateY(-10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes criticalPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px #ef4444; }
          50%       { opacity: 0.4; box-shadow: 0 0 16px #ef4444; }
        }
        @keyframes skelPulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

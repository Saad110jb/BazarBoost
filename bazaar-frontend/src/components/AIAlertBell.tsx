"use client";
import React, { useState, useRef, useEffect } from "react";
import { useNotifications, NotificationEntry } from "@/context/NotificationContext";

/**
 * AIAlertBell
 *
 * Shopper-facing header component that surfaces AI-synthesized recommendation
 * alerts emitted by the hourly `sync_shopper_predictive_alerts` backend daemon.
 * Displays a purple neon AI icon with a live unread count badge and a dark
 * glass dropdown drawer listing [AI-RECOMMENDED] tagged entries.
 */

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function AISkeleton() {
  return (
    <div style={{ padding: "10px 16px", display: "flex", gap: "10px" }}>
      <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "rgba(168,85,247,0.08)", flexShrink: 0, animation: "aiSkelPulse 1.5s ease infinite" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ height: "9px", borderRadius: "4px", width: "70%", background: "rgba(168,85,247,0.08)", animation: "aiSkelPulse 1.5s ease infinite" }} />
        <div style={{ height: "8px", borderRadius: "4px", width: "95%", background: "rgba(168,85,247,0.05)", animation: "aiSkelPulse 1.5s ease 0.2s infinite" }} />
      </div>
    </div>
  );
}

export default function AIAlertBell() {
  const { aiAlerts, dismissAiAlert } = useNotifications();
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const dropdownRef             = useRef<HTMLDivElement>(null);

  const unread = aiAlerts.filter(a => !a.isRead).length;

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
    if (!open && aiAlerts.length === 0) {
      setLoading(true);
      setTimeout(() => setLoading(false), 500);
    }
    setOpen(v => !v);
  };

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>

      {/* AI Bell capsule */}
      <button
        id="ai-alert-bell-btn"
        onClick={handleOpen}
        title="AI Personalised Alerts"
        style={{
          position:       "relative",
          background:     "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(109,40,217,0.14))",
          border:         "1px solid rgba(168,85,247,0.4)",
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
          (e.currentTarget as HTMLButtonElement).style.background  = "linear-gradient(135deg, rgba(168,85,247,0.26), rgba(109,40,217,0.26))";
          (e.currentTarget as HTMLButtonElement).style.transform   = "scale(1.06)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow   = "0 0 20px rgba(168,85,247,0.35)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background  = "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(109,40,217,0.14))";
          (e.currentTarget as HTMLButtonElement).style.transform   = "scale(1)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow   = "none";
        }}
        aria-label="AI Personalised Alerts"
      >
        {/* Animated AI sparkle icon */}
        <span style={{
          fontSize: "17px",
          animation: unread > 0 ? "aiPulse 2s ease-in-out infinite" : "none",
          filter: unread > 0 ? "drop-shadow(0 0 6px #c084fc)" : "none",
        }}>
          &#x2728;
        </span>

        {/* Unread count badge */}
        {unread > 0 && (
          <span style={{
            position:     "absolute",
            top:          "-4px",
            right:        "-4px",
            background:   "linear-gradient(135deg, #a855f7, #7c3aed)",
            color:        "#fff",
            borderRadius: "50%",
            minWidth:     "18px",
            height:       "18px",
            fontSize:     "10px",
            fontWeight:   900,
            display:      "flex",
            alignItems:   "center",
            justifyContent: "center",
            boxShadow:    "0 0 12px rgba(168,85,247,0.75)",
            padding:      "0 3px",
            lineHeight:   1,
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown drawer */}
      {open && (
        <div
          className="bg-[#0d0d14] border border-purple-900/40 rounded-xl shadow-2xl absolute right-0 top-12 z-50"
          style={{
            width:     "340px",
            maxHeight: "480px",
            display:   "flex",
            flexDirection: "column",
            overflow:  "hidden",
            boxShadow: "0 20px 60px rgba(0,0,0,0.65), 0 0 50px rgba(168,85,247,0.18)",
            animation: "aiDropIn 0.2s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid rgba(168,85,247,0.15)",
            background: "linear-gradient(135deg, rgba(168,85,247,0.08), rgba(109,40,217,0.08))",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "15px", filter: "drop-shadow(0 0 4px #c084fc)" }}>&#x2728;</span>
              <span style={{ fontWeight: 800, fontSize: "0.88rem", color: "#f0e6ff" }}>AI Recommendations</span>
              {unread > 0 && (
                <span style={{
                  fontSize: "0.68rem", fontWeight: 800, color: "#c084fc",
                  background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.35)",
                  borderRadius: "8px", padding: "0.1rem 0.4rem",
                }}>
                  {unread} new
                </span>
              )}
            </div>
            <span style={{ fontSize: "0.68rem", color: "#7c5c9e", fontWeight: 600 }}>AI-Powered</span>
          </div>

          {/* Alert list */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading ? (
              <><AISkeleton /><AISkeleton /></>
            ) : aiAlerts.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center" }}>
                <div style={{ fontSize: "2rem", marginBottom: "8px", opacity: 0.5 }}>&#x2728;</div>
                <div style={{ fontSize: "0.82rem", color: "#6b4d8e", fontWeight: 600 }}>No AI alerts yet</div>
                <div style={{ fontSize: "0.73rem", color: "#4b3660", marginTop: "4px" }}>Check back after the next hourly sync</div>
              </div>
            ) : (
              aiAlerts.map(alert => (
                <div
                  key={alert._id}
                  id={`ai-alert-${alert._id}`}
                  style={{
                    display: "flex", gap: "10px", padding: "10px 16px",
                    borderBottom: "1px solid rgba(168,85,247,0.08)",
                    background: alert.isRead ? "transparent" : "rgba(168,85,247,0.05)",
                    borderLeft: `3px solid ${alert.isRead ? "transparent" : "#a855f7"}`,
                    transition: "background 0.2s",
                    cursor: "default",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(168,85,247,0.09)")}
                  onMouseLeave={e => (e.currentTarget.style.background = alert.isRead ? "transparent" : "rgba(168,85,247,0.05)")}
                >
                  {/* AI icon bubble */}
                  <div style={{
                    width: "34px", height: "34px", borderRadius: "10px",
                    background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "15px", flexShrink: 0,
                    boxShadow: "0 0 12px rgba(168,85,247,0.2)",
                  }}>
                    {alert.icon || "✨"}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "3px", flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: "8px", fontWeight: 900, color: "#c084fc",
                        background: "rgba(168,85,247,0.18)", border: "1px solid rgba(168,85,247,0.4)",
                        borderRadius: "3px", padding: "0.1rem 0.35rem",
                        boxShadow: "0 0 6px rgba(168,85,247,0.2)",
                      }}>
                        [AI-RECOMMENDED]
                      </span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "0.81rem", color: "#e8d5ff", lineHeight: 1.3, marginBottom: "3px" }}>
                      {alert.title}
                    </div>
                    <div style={{ fontSize: "0.73rem", color: "#9878b8", lineHeight: 1.45, marginBottom: "4px" }}>
                      {alert.body}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "#5d4477" }}>{timeAgo(alert.createdAt)}</div>
                  </div>

                  {/* Dismiss button */}
                  <button
                    onClick={() => dismissAiAlert(alert._id)}
                    style={{
                      background: "none", border: "none", color: "#5d4477",
                      cursor: "pointer", fontSize: "13px", padding: "2px 4px",
                      borderRadius: "4px", transition: "color 0.2s", alignSelf: "flex-start",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#a855f7")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#5d4477")}
                    title="Dismiss"
                  >
                    &#x2715;
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes aiPulse {
          0%, 100% { transform: scale(1);    filter: drop-shadow(0 0 6px #c084fc); }
          50%       { transform: scale(1.15); filter: drop-shadow(0 0 14px #a855f7); }
        }
        @keyframes aiDropIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes aiSkelPulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}

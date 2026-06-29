"use client";
import React from "react";
import { BreachAlert } from "@/context/NotificationContext";

interface SecurityBreachCardProps {
  breach: BreachAlert;
  index: number;
  onDismiss: () => void;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function SecurityBreachCard({ breach, index, onDismiss }: SecurityBreachCardProps) {
  return (
    <div
      id={`breach-card-${index}`}
      style={{
        position:       "relative",
        background:     "rgba(18,5,5,0.97)",
        border:         "1px solid rgba(239,68,68,0.5)",
        borderRadius:   "14px",
        padding:        "16px 18px",
        overflow:       "hidden",
        animation:      "breachPulse 1.5s ease infinite",
        boxShadow:      "0 0 30px rgba(239,68,68,0.25), 0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      {/* Animated red top bar */}
      <div style={{
        position:   "absolute",
        top:        0,
        left:       0,
        right:      0,
        height:     "3px",
        backgroundImage: "linear-gradient(90deg,#ef4444,#dc2626,#ef4444)",
        backgroundSize: "200% 100%",
        animation:  "shimmer 1.5s linear infinite",
      }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
        <div style={{
          width:          "36px",
          height:         "36px",
          borderRadius:   "10px",
          background:     "rgba(239,68,68,0.15)",
          border:         "1px solid rgba(239,68,68,0.4)",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          fontSize:       "18px",
          animation:      "iconFlash 0.8s ease infinite",
        }}>
          🚨
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#ef4444", letterSpacing: "0.05em" }}>
            ⚠️ SECURITY BREACH DETECTED
          </div>
          <div style={{ fontSize: "0.72rem", color: "#9b1c1c", fontFamily: "monospace" }}>
            {formatTime(breach.blockedAt)}
          </div>
        </div>
        <button
          onClick={onDismiss}
          style={{
            marginLeft:   "auto",
            background:   "rgba(239,68,68,0.1)",
            border:       "1px solid rgba(239,68,68,0.3)",
            borderRadius: "8px",
            color:        "#ef4444",
            cursor:       "pointer",
            fontSize:     "18px",
            width:        "30px",
            height:       "30px",
            display:      "flex",
            alignItems:   "center",
            justifyContent: "center",
            transition:   "background 0.2s",
            flexShrink:   0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.25)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.1)")}
          aria-label="Dismiss breach alert"
        >
          ×
        </button>
      </div>

      {/* Breach data grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        {[
          { label: "Blocked User",   value: breach.userName,      icon: "👤" },
          { label: "Role",           value: breach.userRole,      icon: "🎭" },
          { label: "Target Store",   value: breach.targetStoreId?.slice(-8).toUpperCase(), icon: "🏪" },
          { label: "Target Model",   value: breach.targetModel,   icon: "🗄️" },
          { label: "IP Address",     value: breach.ipAddress || "Unknown", icon: "🌐" },
        ].map(({ label, value, icon }) => (
          <div key={label} style={{
            background:   "rgba(239,68,68,0.06)",
            border:       "1px solid rgba(239,68,68,0.15)",
            borderRadius: "8px",
            padding:      "8px 10px",
          }}>
            <div style={{ fontSize: "0.68rem", color: "#9b1c1c", fontWeight: 600, marginBottom: "2px" }}>
              {icon} {label}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#fca5a5", fontFamily: "monospace", fontWeight: 600, wordBreak: "break-all" }}>
              {value || "Unknown"}
            </div>
          </div>
        ))}
        <div style={{
          gridColumn:   "1 / -1",
          background:   "rgba(239,68,68,0.06)",
          border:       "1px solid rgba(239,68,68,0.15)",
          borderRadius: "8px",
          padding:      "8px 10px",
        }}>
          <div style={{ fontSize: "0.68rem", color: "#9b1c1c", fontWeight: 600, marginBottom: "2px" }}>
            ℹ️ Reason
          </div>
          <div style={{ fontSize: "0.78rem", color: "#fca5a5", lineHeight: "1.4" }}>
            {breach.reason}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes breachPulse {
          0%, 100% { box-shadow: 0 0 30px rgba(239,68,68,0.25), 0 8px 32px rgba(0,0,0,0.5); }
          50%       { box-shadow: 0 0 50px rgba(239,68,68,0.5), 0 8px 32px rgba(0,0,0,0.5); }
        }
        @keyframes iconFlash {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

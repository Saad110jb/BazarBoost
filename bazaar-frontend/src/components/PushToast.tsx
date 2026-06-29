"use client";
import React from "react";
import { useNotifications, NotificationEntry } from "@/context/NotificationContext";

const TYPE_ICON: Record<string, string> = {
  order_update:   "📦",
  ad_approved:    "🚀",
  flash_sale:     "⚡",
  security_alert: "🚨",
  general:        "🔔",
};

const TYPE_COLOR: Record<string, string> = {
  order_update:   "#10b981",
  ad_approved:    "#a855f7",
  flash_sale:     "#f59e0b",
  security_alert: "#ef4444",
  general:        "#7c3aed",
};

function ToastCard({ notification, onDismiss }: { notification: NotificationEntry; onDismiss: () => void }) {
  const color = TYPE_COLOR[notification.type] || "#7c3aed";
  const icon  = TYPE_ICON[notification.type] || "🔔";

  return (
    <div
      id={`toast-${notification._id}`}
      style={{
        position:       "relative",
        background:     "rgba(18,18,26,0.97)",
        backdropFilter: "blur(20px)",
        border:         `1px solid ${color}40`,
        borderRadius:   "14px",
        padding:        "14px 16px",
        width:          "320px",
        boxShadow:      `0 8px 32px rgba(0,0,0,0.4), 0 0 20px ${color}20`,
        overflow:       "hidden",
        animation:      "toastSlideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      {/* Colored top border accent */}
      <div style={{
        position:   "absolute",
        top:        0,
        left:       0,
        right:      0,
        height:     "3px",
        background: `linear-gradient(90deg, ${color}, ${color}80)`,
      }} />

      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        {/* Icon */}
        <div style={{
          width:          "38px",
          height:         "38px",
          borderRadius:   "10px",
          background:     `${color}15`,
          border:         `1px solid ${color}35`,
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          fontSize:       "20px",
          flexShrink:     0,
          marginTop:      "2px",
        }}>
          {icon}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#f8f8ff", marginBottom: "4px" }}>
            {notification.title}
          </div>
          <div style={{ fontSize: "0.78rem", color: "#a9a9c0", lineHeight: "1.5" }}>
            {notification.body}
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onDismiss}
          style={{
            background:   "none",
            border:       "none",
            color:        "#6b6b85",
            cursor:       "pointer",
            fontSize:     "18px",
            lineHeight:   "1",
            padding:      "0",
            flexShrink:   0,
            transition:   "color 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#f8f8ff")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#6b6b85")}
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>

      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(100%) scale(0.9); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

export default function PushToast() {
  const { toastQueue, dismissToast } = useNotifications();

  if (toastQueue.length === 0) return null;

  return (
    <div style={{
      position:       "fixed",
      top:            "24px",
      right:          "24px",
      zIndex:         99999,
      display:        "flex",
      flexDirection:  "column",
      gap:            "12px",
      pointerEvents:  "none",
    }}>
      {toastQueue.map((notif) => (
        <div key={notif._id} style={{ pointerEvents: "auto" }}>
          <ToastCard notification={notif} onDismiss={() => dismissToast(notif._id)} />
        </div>
      ))}
    </div>
  );
}

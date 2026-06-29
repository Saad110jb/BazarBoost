"use client";
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

const API = (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL !== "undefined" && process.env.NEXT_PUBLIC_API_URL !== "null") ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:5000";

export interface NotificationEntry {
  _id: string;
  type: "order_update" | "ad_approved" | "flash_sale" | "security_alert" | "general" | "ai_alert" | "financial";
  title: string;
  body: string;
  badge?: "AI_RECOMMENDED" | string;
  icon?: string;
  meta?: Record<string, any>;
  isRead: boolean;
  createdAt: string;
}

export interface AuditEntry {
  _id?: string;
  action: string;
  userName: string;
  details: string;
  scope: "store" | "platform";
  ipAddress?: string;
  targetModel?: string;
  storeId?: string | null;
  timestamp: string;
}

export interface BreachAlert {
  userId: string;
  userName: string;
  userRole: string;
  targetStoreId: string;
  targetModel: string;
  ipAddress: string;
  reason: string;
  blockedAt: string;
}

interface NotificationContextValue {
  notifications: NotificationEntry[];
  unreadCount: number;
  toastQueue: NotificationEntry[];
  auditStream: AuditEntry[];
  breachAlerts: BreachAlert[];
  aiAlerts: NotificationEntry[];
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismissToast: (id: string) => void;
  dismissBreach: (idx: number) => void;
  dismissAiAlert: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  toastQueue: [],
  auditStream: [],
  breachAlerts: [],
  aiAlerts: [],
  markRead: async () => {},
  markAllRead: async () => {},
  dismissToast: () => {},
  dismissBreach: () => {},
  dismissAiAlert: () => {},
});

export function NotificationContextProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [toastQueue, setToastQueue]       = useState<NotificationEntry[]>([]);
  const [auditStream, setAuditStream]     = useState<AuditEntry[]>([]);
  const [breachAlerts, setBreachAlerts]   = useState<BreachAlert[]>([]);
  const [aiAlerts, setAiAlerts]           = useState<NotificationEntry[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const getAuth = () => {
    if (typeof window === "undefined") return { token: null, user: null };
    const token = localStorage.getItem("bazaar_token");
    const userStr = localStorage.getItem("bazaar_user");
    const user = userStr ? JSON.parse(userStr) : null;
    return { token, user };
  };

  // Load initial notifications from REST API
  const loadNotifications = useCallback(async () => {
    const { token } = getAuth();
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setNotifications(data.notifications || []);
      }
    } catch (err) {
      console.error("Failed to load notifications:", err);
    }
  }, []);

  useEffect(() => {
    const { token, user } = getAuth();
    if (!token || !user) return;

    loadNotifications();

    // Connect to Socket.IO
    const socket = io(API, {
      auth: { token },
      transports: ["websocket"],
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[NotificationContext] Socket connected");

      // If admin, join audit and security channels
      if (user.role === "admin") {
        socket.emit("join_admin_channel");
      }
    });

    // Incoming real-time push notification
    socket.on("push_notification", (notif: NotificationEntry) => {
      setNotifications((prev) => [notif, ...prev]);
      setToastQueue((prev) => [notif, ...prev]);
      // Auto-dismiss toast after 5 seconds
      setTimeout(() => {
        setToastQueue((prev) => prev.filter((t) => t._id !== notif._id));
      }, 5000);
    });

    // Incoming platform-wide broadcast notification
    socket.on("on_platform_notification_broadcast", (broadcastData: any) => {
      const entry: NotificationEntry = {
        _id: broadcastData._id || `bc_${Date.now()}_${Math.random().toString(36).substring(5)}`,
        type: broadcastData.type || "general",
        title: broadcastData.title,
        body: broadcastData.body,
        isRead: false,
        createdAt: broadcastData.createdAt || new Date().toISOString()
      };
      setNotifications((prev) => [entry, ...prev]);
      setToastQueue((prev) => [entry, ...prev]);
      setTimeout(() => {
        setToastQueue((prev) => prev.filter((t) => t._id !== entry._id));
      }, 5000);
    });

    // Incoming AI consumer alert (shopper-targeted hourly predictions)
    socket.on("on_consumer_ai_alert", (alertData: any) => {
      const entry: NotificationEntry = {
        _id: alertData._id || `ai_${Date.now()}_${Math.random().toString(36).substring(5)}`,
        type: "ai_alert",
        badge: "AI_RECOMMENDED",
        icon: alertData.icon || "\u2728",
        title: alertData.title,
        body: alertData.body,
        isRead: false,
        createdAt: alertData.createdAt || new Date().toISOString(),
        meta: alertData.meta || {},
      };
      // Unique-ID dedup: only prepend if not already in the stack
      setAiAlerts(prev => {
        if (prev.some(a => a._id === entry._id)) return prev;
        return [entry, ...prev].slice(0, 50);
      });
      setNotifications(prev => {
        if (prev.some(n => n._id === entry._id)) return prev;
        return [entry, ...prev];
      });
      setToastQueue(prev => [entry, ...prev]);
      setTimeout(() => {
        setToastQueue(prev => prev.filter(t => t._id !== entry._id));
      }, 6000);
    });

    // Flush unread notifications on reconnect
    socket.on("notification:flush", ({ notifications: flushed }: { notifications: NotificationEntry[]; count: number }) => {
      setNotifications((prev) => {
        const existingIds = new Set(prev.map((n) => n._id));
        const newOnes = flushed.filter((n) => !existingIds.has(n._id));
        return [...newOnes, ...prev];
      });
    });

    // Live audit log entries (admin only)
    socket.on("audit_log_entry", (entry: AuditEntry) => {
      setAuditStream((prev) => [{ ...entry, timestamp: entry.timestamp || new Date().toISOString() }, ...prev].slice(0, 200));
    });

    // Security breach alerts (admin only)
    socket.on("security_breach_alert", (breach: BreachAlert) => {
      setBreachAlerts((prev) => [breach, ...prev].slice(0, 20));
    });

    socket.on("disconnect", () => {
      console.log("[NotificationContext] Socket disconnected");
    });

    socket.on("connect_error", (err: Error) => {
      console.error("[NotificationContext] Socket connection error:", err.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = async (id: string) => {
    const { token } = getAuth();
    if (!token) return;
    try {
      await fetch(`${API}/api/notifications/${id}/read`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
      );
    } catch (err) {
      console.error("markRead error:", err);
    }
  };

  const markAllRead = async () => {
    const { token } = getAuth();
    if (!token) return;
    try {
      await fetch(`${API}/api/notifications/mark-all-read`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (err) {
      console.error("markAllRead error:", err);
    }
  };

  const dismissToast = (id: string) => {
    setToastQueue((prev) => prev.filter((t) => t._id !== id));
  };

  const dismissAiAlert = (id: string) => {
    setAiAlerts(prev => prev.filter(a => a._id !== id));
  };

  const dismissBreach = (idx: number) => {
    setBreachAlerts((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, toastQueue, auditStream, breachAlerts, aiAlerts, markRead, markAllRead, dismissToast, dismissBreach, dismissAiAlert }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}

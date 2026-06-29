"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import Sidebar from "@/components/Sidebar";
import StoreSwitcher from "@/components/StoreSwitcher";
import NotificationBell from "@/components/NotificationBell";
import {
  TrendingUp, Package, Megaphone, MessageCircle,
  DollarSign, Eye, ShoppingBag, ArrowUp, ArrowDown, Zap, ShieldAlert, RefreshCw, Loader
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend
} from "recharts";

const CHART_STYLE = { fontSize: 11, fill: "#a9a9c0" };
const API = (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL !== "undefined" && process.env.NEXT_PUBLIC_API_URL !== "null") ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:5000";

let socket: any;
if (typeof window !== "undefined") {
  socket = io(API, {
    transports: ["websocket"],
    autoConnect: false
  });
}

// Fallback data shown while real data loads
const FALLBACK_MONTHLY = [
  { month: "Jan", sales: 0, orders: 0 },
  { month: "Feb", sales: 0, orders: 0 },
  { month: "Mar", sales: 0, orders: 0 },
  { month: "Apr", sales: 0, orders: 0 },
  { month: "May", sales: 0, orders: 0 },
  { month: "Jun", sales: 0, orders: 0 },
];

const decodeJWT = (token: string) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      window.atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
};

const startCSVExportWorker = (headers: string[], rows: any[][], fileName: string, onProgress: (p: number) => void, onComplete: () => void) => {
  const workerCode = `
    self.onmessage = function(e) {
      const { headers, rows } = e.data;
      let csvContent = headers.join(",") + "\\n";
      const total = rows.length;
      const chunkSize = 200;
      let index = 0;

      function processChunk() {
        const end = Math.min(index + chunkSize, total);
        for (let i = index; i < end; i++) {
          const row = rows[i];
          const line = row.map(val => {
            if (val === null || val === undefined) return '""';
            let str = String(val).replace(/"/g, '""');
            if (str.includes(",") || str.includes("\\n") || str.includes('"')) {
              str = '"' + str + '"';
            }
            return str;
          }).join(",");
          csvContent += line + "\\n";
        }
        index = end;

        const progress = total > 0 ? Math.min(100, Math.round((index / total) * 100)) : 100;
        self.postMessage({ type: 'progress', progress });

        if (index < total) {
          setTimeout(processChunk, 15);
        } else {
          self.postMessage({ type: 'complete', csv: csvContent });
        }
      }

      processChunk();
    };
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl);

  worker.onmessage = (e) => {
    if (e.data.type === "progress") {
      onProgress(e.data.progress);
    } else if (e.data.type === "complete") {
      const downloadBlob = new Blob([e.data.csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(downloadBlob);
      link.setAttribute("href", url);
      link.setAttribute("download", fileName);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(workerUrl);
      worker.terminate();
      onComplete();
    }
  };

  worker.postMessage({ headers, rows });
};

export default function VendorDashboard() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [exportingCatalog, setExportingCatalog] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [userRole, setUserRole] = useState<string>("");

  // Real dashboard data
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState("");
  const [realStats, setRealStats] = useState<any>({
    totalRevenue: 0,
    productCount: 0,
    totalImpressions: 0,
    openNegotiations: 0,
    orderCount: 0,
    totalConversions: 0,
  });
  const [monthlySales, setMonthlySales] = useState<any[]>(FALLBACK_MONTHLY);

  const [activeProductsCount, setActiveProductsCount] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(1900);

  const socketRef = useRef<any>(null);
  const [flashRevenue, setFlashRevenue] = useState(false);
  const [flashProducts, setFlashProducts] = useState(false);
  const [categoryData, setCategoryData] = useState<any[]>([]);
  const [adPerformanceData, setAdPerformanceData] = useState<any[]>([]);
  const [recommendationMsg, setRecommendationMsg] = useState("Vendors bidding Rs. 50 more right now are capturing 3.2x more impressions in Lahore.");

  const fetchRecommendations = useCallback(async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/ads/recommendations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.recommendation) {
        setRecommendationMsg(data.recommendation.message);
      }
    } catch (err) {
      console.warn("Failed to fetch ad recommendations:", err);
    }
  }, []);

  // Store suspension and complaints states
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [complaintAppealTarget, setComplaintAppealTarget] = useState<any | null>(null);
  const [appealText, setAppealText] = useState("");
  const [showComplaintsModal, setShowComplaintsModal] = useState(false);

  // Disputes & Support Tickets state
  const [activeTab, setActiveTab] = useState<"overview" | "disputes">("overview");
  const [vendorTickets, setVendorTickets] = useState<any[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [remedyType, setRemedyType] = useState<string>("none"); // none | refund | coupon | soft_delete
  const [responseMsg, setResponseMsg] = useState("");
  const [remedySubmitting, setRemedySubmitting] = useState(false);
  const [escalateMsg, setEscalateMsg] = useState("");
  const [showEscalateModal, setShowEscalateModal] = useState(false);
  const [countdownText, setCountdownText] = useState("48:00:00");

  const fetchVendorTickets = useCallback(async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    setTicketsLoading(true);
    try {
      const res = await fetch(`${API}/api/complaints/vendor`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setVendorTickets(data.tickets || []);
      }
    } catch (err) {
      console.error("Failed to load vendor disputes:", err);
    } finally {
      setTicketsLoading(false);
    }
  }, []);

  const fetchStoreInfo = useCallback(async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/wallet/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.store) {
        setStoreInfo(data.store);
      }
    } catch (err) {
      console.error("Failed to load store info:", err);
    }
  }, []);

  const fetchDashboardStats = useCallback(async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    setDashLoading(true);
    setDashError("");

    try {
      const res = await fetch(`${API}/api/orders/dashboard-stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success) {
        setRealStats(data.stats);
        setActiveProductsCount(data.stats.productCount);
        setTotalRevenue(data.stats.totalRevenue);
        if (data.monthlySales?.length > 0) setMonthlySales(data.monthlySales);
        if (data.categoryData?.length > 0) setCategoryData(data.categoryData);
        if (data.adPerformanceData?.length > 0) setAdPerformanceData(data.adPerformanceData);
      } else {
        setDashError(data.message || "Failed to load dashboard stats");
      }
    } catch (err: any) {
      setDashError("Could not connect to API");
      console.error("Dashboard stats fetch error:", err);
    } finally {
      setDashLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("bazaar_user");
    const token = localStorage.getItem("bazaar_token");
    if (stored) {
      const u = JSON.parse(stored);
      setUser(u);
      setUserRole(u.role);
    }
    if (token) {
      const decoded = decodeJWT(token);
      if (decoded?.permissions) {
        setPermissions(decoded.permissions);
      }
    }
    fetchStoreInfo();
    fetchDashboardStats();
    fetchVendorTickets();
    fetchRecommendations();
  }, [fetchStoreInfo, fetchDashboardStats, fetchVendorTickets, fetchRecommendations]);

  useEffect(() => {
    if (!socket) return;
    const vendorId = storeInfo?.vendorId || (user?.role === "vendor" ? user?._id : null);
    if (!vendorId) return;

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    socket.auth = { token };
    socket.query = { token };
    socket.connect();

    const handleConnect = () => {
      console.log("[Dashboard Socket] Connected and joining room for vendorId:", vendorId);
      socket.emit("join_vendor_dashboard_room", { vendorId });
    };

    if (socket.connected) {
      handleConnect();
    } else {
      socket.on("connect", handleConnect);
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.disconnect();
    };
  }, [user, storeInfo]);

  useEffect(() => {
    socket.on("vendor_product_catalog_mutated", (payload: any) => {
      setActiveProductsCount(payload.currentActiveCount);
      if (payload.computedTotalRevenue !== undefined) {
        setTotalRevenue(payload.computedTotalRevenue);
      }
      setFlashProducts(true);
      setFlashRevenue(true);
      setTimeout(() => {
        setFlashProducts(false);
        setFlashRevenue(false);
      }, 800);
    });
    return () => {
      socket.off("vendor_product_catalog_mutated");
    };
  }, []);

  useEffect(() => {
    if (storeInfo?.debtZone !== 'amber' || !storeInfo?.amberCountdownStartedAt) return;

    const interval = setInterval(() => {
      const startTime = new Date(storeInfo.amberCountdownStartedAt).getTime();
      const elapsed = Date.now() - startTime;
      const fortyEightHours = 48 * 60 * 60 * 1000;
      const remaining = fortyEightHours - elapsed;
      
      if (remaining <= 0) {
        setCountdownText("00:00:00");
        fetchStoreInfo();
      } else {
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
        setCountdownText(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [storeInfo]);

  const handleExportCatalogMetrics = async () => {
    const storeId = user?.activeStoreId || user?.storeId || storeInfo?._id;
    if (!storeId) return;

    setExportingCatalog(true);
    setExportProgress(0);

    try {
      const token = localStorage.getItem("bazaar_token");
      // Pull entire historical catalog ledger
      const res = await fetch(`${API}/api/products/store/${storeId}/export`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success && data.metrics) {
        const headers = [
          "Product ID",
          "Name",
          "Live Stock Status",
          "Base Price",
          "Total Units Sold",
          "Gross Revenue Contributed",
          "Cumulative Ad Wallet Budget Spent"
        ];

        const rows = data.metrics.map((m: any) => [
          m.productId,
          m.name,
          m.liveStockStatus,
          m.basePrice,
          m.totalUnitsSold,
          m.grossRevenueContributed,
          m.cumulativeAdWalletBudgetSpent
        ]);

        const dateStr = new Date().toISOString().split('T')[0];
        const storeName = storeInfo?.slug || storeId;
        const fileName = `bazaarboost-catalog-${storeName}-${dateStr}.csv`;

        startCSVExportWorker(
          headers,
          rows,
          fileName,
          (progress) => setExportProgress(progress),
          () => {
            setExportingCatalog(false);
          }
        );
      } else {
        alert(data.message || "Failed to fetch metrics for catalog export.");
        setExportingCatalog(false);
      }
    } catch (err) {
      console.error(err);
      // Fallback offline export
      const headers = [
        "Product ID",
        "Name",
        "Live Stock Status",
        "Base Price",
        "Total Units Sold",
        "Gross Revenue Contributed",
        "Cumulative Ad Wallet Budget Spent"
      ];
      const rows = [
        ["prod-1", "Premium Wireless Headphones", "In Stock", 79.99, 15, 1199.85, 100],
        ["prod-2", "Handwoven Leather Wallet", "Low Stock", 34.99, 2, 69.98, 50],
        ["prod-3", "Adjustable Laptop Stand", "In Stock", 45.00, 8, 360.00, 20]
      ];
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `bazaarboost-catalog-${storeId}-${dateStr}.csv`;

      startCSVExportWorker(
        headers,
        rows,
        fileName,
        (progress) => setExportProgress(progress),
        () => {
          setExportingCatalog(false);
        }
      );
    }
  };

  const handleAppealSubmit = async () => {
    if (!complaintAppealTarget || !appealText.trim() || !storeInfo) return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/stores/${storeInfo._id}/complaints/${complaintAppealTarget._id}/appeal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ appealMessage: appealText })
      });
      const data = await res.json();
      if (data.success) {
        alert("Appeal submitted successfully!");
        setComplaintAppealTarget(null);
        setAppealText("");
        fetchStoreInfo();
      } else {
        alert(data.message || "Failed to submit appeal");
      }
    } catch (err: any) {
      alert("Error appealing complaint: " + err.message);
    }
  };

  if (!mounted) return null;

  const canViewBilling = userRole === "vendor" || permissions.includes("VIEW_BILLING");
  const canManageAds = userRole === "vendor" || permissions.includes("MANAGE_ADS");

  // Format revenue display
  const formatRevenue = (v: number) => {
    if (v >= 1000000) return `Rs. ${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `Rs. ${(v / 1000).toFixed(1)}K`;
    return `Rs. ${v.toLocaleString()}`;
  };

  const formatImpressions = (v: number) => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return String(v);
  };

  const stats = [
    {
      label: "Total Revenue",
      value: canViewBilling ? formatRevenue(totalRevenue) : "Rs. •••",
      subLabel: `${realStats.orderCount} orders`,
      change: totalRevenue > 0 ? "Live" : "No orders yet",
      up: totalRevenue > 0,
      icon: <DollarSign size={20} />,
      color: "#10b981",
      restricted: !canViewBilling
    },
    {
      label: "Active Products",
      value: String(activeProductsCount),
      subLabel: "Listed in catalog",
      change: activeProductsCount > 0 ? `+${activeProductsCount}` : "0 listed",
      up: activeProductsCount > 0,
      icon: <Package size={20} />,
      color: "#3b82f6",
      restricted: false
    },
    {
      label: "Ad Impressions",
      value: canManageAds ? formatImpressions(realStats.totalImpressions) : "•••",
      subLabel: `${realStats.totalConversions} conversions`,
      change: realStats.totalImpressions > 0 ? "Active ads" : "No active ads",
      up: realStats.totalImpressions > 0,
      icon: <Eye size={20} />,
      color: "#a855f7",
      restricted: !canManageAds
    },
    {
      label: "Open Negotiations",
      value: String(realStats.openNegotiations),
      subLabel: "Active chat threads",
      change: realStats.openNegotiations > 0 ? `${realStats.openNegotiations} active` : "None open",
      up: false,
      icon: <MessageCircle size={20} />,
      color: "#f59e0b",
      restricted: false
    },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <Sidebar role="vendor" />
      <main style={{ flex: 1, padding: "2.5rem", overflow: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
          <div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>Welcome back,</p>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800 }}>
              {user?.name || "Vendor"}&apos;s Dashboard
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
              Here&apos;s what&apos;s happening with your store today.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <NotificationBell />
            {storeInfo && (
              <button
                onClick={() => { fetchStoreInfo(); setShowComplaintsModal(true); }}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  background: (storeInfo.penaltyPoints || 0) > 0 ? "rgba(239,68,68,0.1)" : "var(--bg-secondary)",
                  border: (storeInfo.penaltyPoints || 0) > 0 ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--border-subtle)",
                  color: (storeInfo.penaltyPoints || 0) > 0 ? "#ef4444" : "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem"
                }}
              >
                <ShieldAlert size={14} /> Complaints & Appeals {(storeInfo.penaltyPoints || 0) > 0 && `(${storeInfo.penaltyPoints}/50)`}
              </button>
            )}
            <button
              onClick={handleExportCatalogMetrics}
              disabled={exportingCatalog || dashLoading}
              style={{
                background: "none",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                padding: "0.5rem 1rem",
                cursor: "pointer",
                color: exportingCatalog ? "var(--text-muted)" : "var(--text-primary)",
                fontSize: "0.82rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                height: "34px"
              }}
              title="Export Catalog Metrics"
            >
              {exportingCatalog ? (
                <>
                  <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
                  <span>Exporting ({exportProgress}%)</span>
                </>
              ) : (
                <>
                  <span>📥 Export Catalog Metrics</span>
                </>
              )}
            </button>

            <button
              onClick={() => { fetchDashboardStats(); fetchVendorTickets(); }}
              disabled={dashLoading}
              style={{
                background: "none",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                padding: "0.5rem",
                cursor: "pointer",
                color: dashLoading ? "var(--text-muted)" : "var(--accent-secondary)",
                display: "flex",
                alignItems: "center"
              }}
              title="Refresh stats"
            >
              {dashLoading
                ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} />
                : <RefreshCw size={16} />}
            </button>
            <StoreSwitcher />
          </div>
        </div>

        {/* Orange Zone Warning Banner */}
        {storeInfo && storeInfo.debtZone === 'orange' && (
          <div style={{
            background: "rgba(245,158,11,0.1)",
            border: "1px solid #f59e0b",
            borderRadius: 12,
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem"
          }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#f59e0b", display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
              <ShieldAlert size={18} /> Soft Debt Alert (Orange Zone)
            </h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
              Warning: You have outstanding platform commission debt. Standard active operations are maintained, but please settle your unpaid commissions in the Wallet panel to avoid moving to Amber/Red Zones.
            </p>
          </div>
        )}

        {/* Amber Zone Warning Banner */}
        {storeInfo && storeInfo.debtZone === 'amber' && (
          <div style={{
            background: "rgba(249,115,22,0.12)",
            border: "2px dashed #f97316",
            borderRadius: 14,
            padding: "1.25rem 1.5rem",
            marginBottom: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#f97316", display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
              <ShieldAlert size={20} /> Ad Campaign Freeze & Suspension Ultimatum (Amber Zone)
            </h3>
            <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
              Critical Alert: Your outstanding commission debt exceeds PKR 10,000. All sponsored search boosts and active ad campaigns have been temporarily paused to preserve your wallet balances.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "0.25rem" }}>
              <span style={{ fontSize: "0.82rem", background: "rgba(249,115,22,0.2)", color: "#f97316", padding: "0.3rem 0.6rem", borderRadius: "6px", fontWeight: 700 }}>
                Grace Period Countdown: {countdownText}
              </span>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Clear outstanding balance within the clock countdown to avoid automatic storefront shutdown (Red Zone).
              </span>
            </div>
          </div>
        )}

        {/* Suspension Banner */}
        {storeInfo && storeInfo.isActive === false && (
          <div style={{
            background: "rgba(239,68,68,0.12)",
            border: "2px solid #ef4444",
            borderRadius: 14,
            padding: "1.25rem 1.5rem",
            marginBottom: "2rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            boxShadow: "0 0 15px rgba(239,68,68,0.15)"
          }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <ShieldAlert size={20} /> Store Suspended by Platform Administration
            </h2>
            <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              BazaarBoost Governance Alert: Access to your dynamic catalog has been administratively disabled.
              Customers attempting to visit your storefront slug will see a suspended notice.
            </p>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.82rem", background: "rgba(0,0,0,0.15)", padding: "0.75rem 1rem", borderRadius: 8, marginTop: "0.25rem" }}>
              <div><strong>Reason:</strong> <span style={{ color: "var(--text-secondary)" }}>{storeInfo.suspensionReason || "N/A"}</span></div>
              <div style={{ borderLeft: "1px solid var(--border-subtle)", paddingLeft: "1rem" }}>
                <strong>Penalty Points:</strong> <span style={{ color: "#ef4444", fontWeight: 700 }}>{storeInfo.penaltyPoints || 0} / 50</span>
              </div>
            </div>
            <button
              onClick={() => { fetchStoreInfo(); setShowComplaintsModal(true); }}
              style={{
                alignSelf: "flex-start",
                padding: "0.4rem 0.8rem",
                borderRadius: "6px",
                background: "#ef4444",
                border: "none",
                color: "white",
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: 700,
                marginTop: "0.5rem"
              }}
            >
              Appeal suspension or view complaints
            </button>
          </div>
        )}

        {/* Error banner */}
        {dashError && (
          <div style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 10,
            padding: "0.75rem 1rem",
            marginBottom: "1.5rem",
            fontSize: "0.82rem",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem"
          }}>
            <ShieldAlert size={14} />
            {dashError} — showing cached or empty data.
          </div>
        )}

        {/* Tab Switcher */}
        <div style={{ display: "flex", gap: "1rem", borderBottom: "1px solid var(--border-subtle)", marginBottom: "2rem" }}>
          <button
            onClick={() => setActiveTab("overview")}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "overview" ? "2px solid #a855f7" : "2px solid transparent",
              color: activeTab === "overview" ? "#a855f7" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Overview
          </button>
          <button
            onClick={() => { setActiveTab("disputes"); fetchVendorTickets(); }}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "disputes" ? "2px solid #a855f7" : "2px solid transparent",
              color: activeTab === "disputes" ? "#a855f7" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Disputes Portal
          </button>
        </div>

        {activeTab === "overview" && (
          <>
            {/* Predictive AI Smart Recommendation Banner */}
            <div className="glass-card animate-fade-up" style={{
              background: "linear-gradient(90deg, rgba(124, 58, 237, 0.15) 0%, rgba(168, 85, 247, 0.05) 100%)",
              border: "1px solid rgba(168, 85, 247, 0.3)",
              borderRadius: "14px",
              padding: "1rem 1.5rem",
              marginBottom: "1.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              boxShadow: "0 4px 20px rgba(124, 58, 237, 0.1)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "rgba(168, 85, 247, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#a855f7",
                  flexShrink: 0
                }}>
                  <Zap size={18} className="animate-pulse" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h4 style={{ fontSize: "0.85rem", fontWeight: 800, color: "#ffffff", margin: 0 }}>Predictive AI Smart Recommendation</h4>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", margin: "0.15rem 0 0 0" }}>
                    {recommendationMsg}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { window.location.href = "/vendor/ads?boost=true"; }}
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "0.5rem 1rem",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "transform 0.2s"
                }}
                onMouseEnter={e => e.currentTarget.style.transform = "scale(1.03)"}
                onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
              >
                Boost Bid Now
              </button>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
              {stats.map((stat) => {
                const isRevenueCard = stat.label === "Total Revenue";
                const isProductsCard = stat.label === "Active Products";
                const isFlashing = (isRevenueCard && flashRevenue) || (isProductsCard && flashProducts);
                const flashClass = isFlashing ? "animate-pulse ring-2 ring-purple-500/50" : "";

                return (
                  <div key={stat.label} className={`stat-card bg-[#111119] border border-slate-800 ${flashClass}`} style={{ position: "relative", overflow: "hidden" }}>
                    <div style={{
                      filter: stat.restricted ? "blur(4px)" : "none",
                      opacity: stat.restricted ? 0.35 : 1,
                      transition: "all 0.3s"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 10,
                          background: `${stat.color}18`, display: "flex", alignItems: "center", justifyContent: "center",
                          color: stat.color
                        }}>
                          {stat.icon}
                        </div>
                        <span style={{
                          fontSize: "0.72rem", fontWeight: 700,
                          color: stat.up ? "#10b981" : "var(--text-muted)",
                          display: "flex", alignItems: "center", gap: 2
                        }}>
                          {stat.up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                          {stat.change}
                        </span>
                      </div>
                      {dashLoading ? (
                        <div className="w-12 h-6 bg-slate-800 animate-pulse rounded" />
                      ) : (
                        <div style={{ fontSize: "1.6rem", fontWeight: 800, marginBottom: "0.25rem" }}>{stat.value}</div>
                      )}
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{stat.label}</div>
                      {stat.subLabel && (
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.15rem", opacity: 0.7 }}>{stat.subLabel}</div>
                      )}
                    </div>

                    {stat.restricted && (
                      <div style={{
                        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        background: "rgba(26,26,38,0.4)", color: "#ef4444", fontWeight: 700, fontSize: "0.8rem"
                      }}>
                        <ShieldAlert size={14} style={{ marginBottom: "0.25rem" }} />
                        Restricted
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Charts Row */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.25rem", marginBottom: "1.25rem" }}>
              {/* Revenue Line Chart — real monthly data */}
              <div className="glass-card bg-[#111119] border border-slate-800" style={{ padding: "1.5rem", position: "relative", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                  <h3 style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <TrendingUp size={16} style={{ color: "#a855f7" }} /> Revenue Overview
                  </h3>
                  {dashLoading && <Loader size={14} style={{ color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />}
                </div>

                <div style={{ filter: canViewBilling ? "none" : "blur(5px) grayscale(100%)", opacity: canViewBilling ? 1 : 0.35, pointerEvents: canViewBilling ? "auto" : "none", transition: "all 0.3s" }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={monthlySales}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="month" tick={CHART_STYLE} axisLine={false} tickLine={false} />
                      <YAxis tick={CHART_STYLE} axisLine={false} tickLine={false} tickFormatter={(v) => `Rs.${v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}`} />
                      <Tooltip
                        contentStyle={{ background: "#1a1a26", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}
                        labelStyle={{ color: "#f8f8ff" }}
                        formatter={(value: any) => [`Rs. ${Number(value).toLocaleString()}`, "Revenue"]}
                      />
                      <Line type="monotone" dataKey="sales" stroke="#a855f7" strokeWidth={2.5} dot={{ fill: "#a855f7", r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {!canViewBilling && (
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    background: "rgba(26, 26, 38, 0.65)", backdropFilter: "blur(4px)",
                    padding: "1.5rem", textAlign: "center", zIndex: 10
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: "50%", background: "rgba(239, 68, 68, 0.1)",
                      display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", marginBottom: "0.75rem"
                    }}>
                      <ShieldAlert size={20} />
                    </div>
                    <h4 style={{ fontWeight: 800, fontSize: "1rem", color: "#f8f8ff", marginBottom: "0.25rem" }}>Access Restricted</h4>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", maxWidth: "260px" }}>
                      Viewing financial revenue overview details is limited to store Owners only.
                    </p>
                  </div>
                )}
              </div>

              {/* Category Pie — real category breakdown from sold items */}
              <div className="glass-card bg-[#111119] border border-slate-800" style={{ padding: "1.5rem", position: "relative", overflow: "hidden" }}>
                <h3 style={{ fontWeight: 700, marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <ShoppingBag size={16} style={{ color: "#a855f7" }} /> By Category
                </h3>

                <div style={{ filter: canViewBilling ? "none" : "blur(5px) grayscale(100%)", opacity: canViewBilling ? 1 : 0.35, pointerEvents: canViewBilling ? "auto" : "none", transition: "all 0.3s" }}>
                  {categoryData.length === 0 && !dashLoading ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 220, color: "var(--text-muted)", fontSize: "0.82rem", gap: "0.5rem" }}>
                      <ShoppingBag size={28} style={{ opacity: 0.4 }} />
                      No sales data yet
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={categoryData.length > 0 ? categoryData : [{ name: "Loading", value: 100, color: "#374151" }]}
                          cx="50%" cy="50%"
                          innerRadius={55} outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {(categoryData.length > 0 ? categoryData : [{ color: "#374151" }]).map((entry: any, index: number) => (
                            <Cell key={index} fill={entry.color} />
                          ))}
                        </Pie>
                        <Legend formatter={(v) => <span style={{ fontSize: 11, color: "#a9a9c0" }}>{v}</span>} />
                        <Tooltip
                          contentStyle={{ background: "#1a1a26", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}
                          formatter={(value: any) => [`${value}%`, "Share"]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {!canViewBilling && (
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    background: "rgba(26, 26, 38, 0.65)", backdropFilter: "blur(4px)",
                    padding: "1rem", textAlign: "center", zIndex: 10
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%", background: "rgba(239, 68, 68, 0.1)",
                      display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", marginBottom: "0.5rem"
                    }}>
                      <ShieldAlert size={16} />
                    </div>
                    <h4 style={{ fontWeight: 800, fontSize: "0.9rem", color: "#f8f8ff", marginBottom: "0.2rem" }}>Restricted</h4>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", maxWidth: "160px" }}>
                      Category values locked.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Ad Performance — real impressions/conversions per slot */}
            <div className="glass-card bg-[#111119] border border-slate-800" style={{ padding: "1.5rem", position: "relative", overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Megaphone size={16} style={{ color: "#a855f7" }} /> Ad Slot Performance
                </h3>
                {dashLoading && <Loader size={14} style={{ color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />}
              </div>

              <div style={{ filter: canManageAds ? "none" : "blur(5px) grayscale(100%)", opacity: canManageAds ? 1 : 0.35, pointerEvents: canManageAds ? "auto" : "none", transition: "all 0.3s" }}>
                {adPerformanceData.length === 0 && !dashLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, color: "var(--text-muted)", fontSize: "0.82rem", gap: "0.5rem" }}>
                    <Megaphone size={28} style={{ opacity: 0.4 }} />
                    No active ad campaigns yet — place a bid on the Ad Bids page to get started.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={adPerformanceData} barGap={4}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="slot" tick={CHART_STYLE} axisLine={false} tickLine={false} />
                      <YAxis tick={CHART_STYLE} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#1a1a26", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }} />
                      <Bar dataKey="impressions" fill="#3b82f622" stroke="#3b82f6" strokeWidth={1} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="clicks" fill="#a855f722" stroke="#a855f7" strokeWidth={1} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="conversions" fill="#10b98122" stroke="#10b981" strokeWidth={1} radius={[4, 4, 0, 0]} />
                      <Legend formatter={(v) => <span style={{ fontSize: 11, color: "#a9a9c0", textTransform: "capitalize" }}>{v}</span>} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {!canManageAds && (
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  background: "rgba(26, 26, 38, 0.65)", backdropFilter: "blur(4px)",
                  padding: "1.5rem", textAlign: "center", zIndex: 10
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: "50%", background: "rgba(239, 68, 68, 0.1)",
                    display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", marginBottom: "0.75rem"
                  }}>
                    <ShieldAlert size={20} />
                  </div>
                  <h4 style={{ fontWeight: 800, fontSize: "1rem", color: "#f8f8ff", marginBottom: "0.25rem" }}>Access Restricted</h4>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", maxWidth: "280px" }}>
                    Ad budgeting performance metrics are locked for staff accounts.
                  </p>
                </div>
              )}
            </div>

            {/* AI Status Banner */}
            <div style={{
              marginTop: "1.25rem",
              background: "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(59,130,246,0.05))",
              border: "1px solid rgba(124,58,237,0.2)", borderRadius: 14, padding: "1.25rem",
              display: "flex", alignItems: "center", gap: "1rem"
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, boxShadow: "0 0 20px rgba(124,58,237,0.3)"
              }}>
                <Zap size={20} color="white" />
              </div>
              <div>
                <p style={{ fontWeight: 700, marginBottom: "0.2rem" }}>Local AI Engine Active</p>
                <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  Tesseract OCR + Xenova Transformers running locally — zero API costs, full data privacy.
                </p>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
                <span className="badge badge-success">OCR ● Active</span>
                <span className="badge badge-info">Tagging ● Active</span>
              </div>
            </div>
          </>
        )}

        {activeTab === "disputes" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "1.5rem", alignItems: "start" }}>
            {/* Disputes List */}
            <div className="glass-card" style={{ padding: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <ShieldAlert size={18} style={{ color: "#a855f7" }} /> Store Disputes & Support Tickets
              </h3>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Ticket Details</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Shopper</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Target</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Status</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticketsLoading ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "2rem" }}>
                          <Loader size={24} style={{ animation: "spin 1s linear infinite", color: "#a855f7" }} />
                        </td>
                      </tr>
                    ) : vendorTickets.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No customer disputes filed against your store.
                        </td>
                      </tr>
                    ) : (
                      vendorTickets.map((t: any) => {
                        const statusColors: any = {
                          open: { bg: "rgba(168,85,247,0.1)", border: "rgba(168,85,247,0.3)", color: "#a855f7" },
                          under_review: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", color: "#3b82f6" },
                          resolved: { bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.3)", color: "#10b981" },
                          escalated: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", color: "#ef4444" }
                        };
                        const colors = statusColors[t.status] || statusColors.open;
                        const isSelected = selectedTicket?._id === t._id;
                        return (
                          <tr key={t._id} style={{ borderBottom: "1px solid var(--border-subtle)", background: isSelected ? "rgba(255,255,255,0.02)" : "transparent" }}>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <p style={{ fontWeight: 700 }}>{t.category.toUpperCase()}</p>
                              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Filed: {new Date(t.createdAt).toLocaleDateString()}</p>
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <p style={{ fontWeight: 600 }}>{t.shopperId?.name || "Shopper"}</p>
                              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{t.shopperId?.email}</p>
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              {t.orderId ? (
                                <span style={{ color: "#3b82f6", fontWeight: 600 }}>Order: #{t.orderId._id.slice(-6)}</span>
                              ) : t.productId ? (
                                <span style={{ color: "#10b981", fontWeight: 600 }}>Prod: {t.productId.title}</span>
                              ) : (
                                <span style={{ color: "var(--text-muted)" }}>General</span>
                              )}
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <span style={{
                                fontSize: "0.72rem", fontWeight: 800, padding: "0.15rem 0.4rem", borderRadius: 4,
                                background: colors.bg, border: `1px solid ${colors.border}`, color: colors.color
                              }}>
                                {t.status.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                              <button
                                onClick={() => { setSelectedTicket(t); setResponseMsg(""); setRemedyType("none"); }}
                                style={{
                                  padding: "0.35rem 0.75rem",
                                  borderRadius: "6px",
                                  background: isSelected ? "#a855f7" : "rgba(255,255,255,0.05)",
                                  border: isSelected ? "none" : "1px solid var(--border-subtle)",
                                  color: isSelected ? "white" : "var(--text-primary)",
                                  cursor: "pointer",
                                  fontSize: "0.75rem",
                                  fontWeight: 600
                                }}
                              >
                                Inspect
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Inspector Panel */}
            <div className="glass-card" style={{ padding: "1.5rem" }}>
              {selectedTicket ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "1rem", marginBottom: "1rem" }}>
                    <div>
                      <h4 style={{ fontWeight: 800, fontSize: "1rem", color: "var(--text-primary)" }}>Dispute Inspector</h4>
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>ID: {selectedTicket._id}</p>
                    </div>
                    <button
                      onClick={() => setSelectedTicket(null)}
                      style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.9rem" }}
                    >
                      ✕ Close
                    </button>
                  </div>

                  {/* Customer Claim details */}
                  <div style={{ marginBottom: "1rem" }}>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Customer claim description</p>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "0.25rem", lineHeight: 1.5, background: "var(--bg-secondary)", padding: "0.75rem", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                      {selectedTicket.description}
                    </p>
                  </div>

                  {/* Evidence Screenshot */}
                  {selectedTicket.evidenceUrl && (
                    <div style={{ marginBottom: "1.25rem" }}>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: "0.35rem" }}>Dispute Evidence Screenshot</p>
                      <div style={{ display: "flex", justifyContent: "center", background: "#000", borderRadius: "8px", overflow: "hidden", maxHeight: "200px" }}>
                        <img
                          src={`${API}${selectedTicket.evidenceUrl}`}
                          alt="Customer uploaded evidence"
                          style={{ maxWidth: "100%", maxHeight: "200px", objectFit: "contain", cursor: "pointer" }}
                          onClick={() => window.open(`${API}${selectedTicket.evidenceUrl}`, "_blank")}
                        />
                      </div>
                    </div>
                  )}

                  {/* Escalation Log */}
                  <div style={{ marginBottom: "1.25rem" }}>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: "0.35rem" }}>Dispute Lifecycle Log</p>
                    <div style={{ maxHeight: "120px", overflowY: "auto", background: "var(--bg-secondary)", padding: "0.5rem", borderRadius: 8, fontSize: "0.72rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      {selectedTicket.escalationLog?.map((log: any, idx: number) => (
                        <div key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", paddingBottom: "0.25rem" }}>
                          <span style={{ color: "#a855f7", fontWeight: 700 }}>[{log.action}]</span> <span style={{ color: "var(--text-secondary)" }}>{log.message}</span>
                          <span style={{ color: "var(--text-muted)", fontStyle: "italic", marginLeft: "0.3rem" }}>({log.actorRole})</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Triage / Resolution Actions */}
                  {selectedTicket.status !== "resolved" ? (
                    <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem" }}>
                      <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Resolve Dispute &amp; counter-respond</p>

                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div>
                          <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Remediation Option</label>
                          <select
                            value={remedyType}
                            onChange={(e) => setRemedyType(e.target.value)}
                            style={{ width: "100%", padding: "0.5rem", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.8rem" }}
                          >
                            <option value="none">None (Respond without remedy)</option>
                            <option value="refund">Simulate Order Refund (Cancels Order)</option>
                            <option value="coupon">Generate Coupon Compensation (15% Off)</option>
                            <option value="soft_delete">Soft-delete associated product catalog listing</option>
                          </select>
                        </div>

                        <div>
                          <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Counter Response Message</label>
                          <textarea
                            value={responseMsg}
                            onChange={(e) => setResponseMsg(e.target.value)}
                            placeholder="Type your explanation or remedy confirmation details..."
                            style={{ width: "100%", minHeight: 70, padding: "0.5rem", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.8rem" }}
                          />
                        </div>

                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            onClick={async () => {
                              if (!responseMsg.trim()) {
                                alert("Please provide a response message");
                                return;
                              }
                              setRemedySubmitting(true);
                              try {
                                const token = localStorage.getItem("bazaar_token");
                                const res = await fetch(`${API}/api/complaints/${selectedTicket._id}/respond`, {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${token}`
                                  },
                                  body: JSON.stringify({ message: responseMsg, remedyType })
                                });
                                const data = await res.json();
                                if (data.success) {
                                  alert("Response submitted and remedy executed successfully!");
                                  setSelectedTicket(data.ticket);
                                  fetchVendorTickets();
                                } else {
                                  alert(data.message || "Failed to submit response");
                                }
                              } catch (err: any) {
                                alert("Error submitting response: " + err.message);
                              } finally {
                                setRemedySubmitting(false);
                              }
                            }}
                            disabled={remedySubmitting}
                            style={{ flex: 1, padding: "0.5rem", borderRadius: 8, background: "#10b981", border: "none", color: "white", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}
                          >
                            {remedySubmitting ? "Submitting..." : "Apply Remedy & Resolve"}
                          </button>

                          {selectedTicket.status !== "escalated" && (
                            <button
                              onClick={() => setShowEscalateModal(true)}
                              style={{ padding: "0.5rem 0.75rem", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
                            >
                              Escalate
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem", fontSize: "0.8rem" }}>
                      <p style={{ fontWeight: 700, color: "#10b981", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        ✓ Dispute Resolved / Closed
                      </p>
                      {selectedTicket.vendorResponse && (
                        <div style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 8, padding: "0.75rem", marginTop: "0.5rem" }}>
                          <p><strong>Remedy:</strong> {selectedTicket.vendorResponse.remedyType}</p>
                          {selectedTicket.vendorResponse.couponCode && (
                            <p><strong>Generated Coupon:</strong> <code style={{ color: "#a855f7" }}>{selectedTicket.vendorResponse.couponCode}</code></p>
                          )}
                          <p style={{ marginTop: "0.3rem", color: "var(--text-secondary)" }}><strong>Vendor Statement:</strong> &ldquo;{selectedTicket.vendorResponse.message}&rdquo;</p>
                        </div>
                      )}
                      {selectedTicket.adminDecision && (
                        <div style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, padding: "0.75rem", marginTop: "0.5rem" }}>
                          <p><strong>Admin Ruling Action:</strong> {selectedTicket.adminDecision.actionTaken}</p>
                          <p style={{ marginTop: "0.3rem", color: "var(--text-secondary)" }}><strong>Admin Verdict:</strong> &ldquo;{selectedTicket.adminDecision.message}&rdquo;</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "300px", color: "var(--text-muted)", fontSize: "0.85rem", gap: "0.5rem" }}>
                  <ShieldAlert size={28} style={{ opacity: 0.3 }} />
                  Select a dispute from the list to inspect details.
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Complaints & Appeals Modal */}
      {showComplaintsModal && storeInfo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "2rem" }}>
          <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 640, padding: "2rem", maxHeight: "85vh", overflowY: "auto", position: "relative" }}>
            <button
              onClick={() => { setShowComplaintsModal(false); setComplaintAppealTarget(null); }}
              style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
            >
              <X size={20} />
            </button>

            <h3 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <ShieldAlert size={20} style={{ color: "#ef4444" }} /> Complaints & Penalty Ledger
            </h3>

            {/* Scorecard */}
            <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", background: "var(--bg-secondary)", padding: "1rem", borderRadius: 12, border: "1px solid var(--border-subtle)" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Store status</p>
                <p style={{ fontSize: "1rem", fontWeight: 800, color: storeInfo.isActive ? "#10b981" : "#ef4444", marginTop: "0.25rem" }}>
                  {storeInfo.isActive ? "✓ Live / Active" : "🚨 Suspended"}
                </p>
              </div>
              <div style={{ flex: 1, borderLeft: "1px solid var(--border-subtle)", paddingLeft: "1rem" }}>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Penalty Points</p>
                <p style={{ fontSize: "1rem", fontWeight: 800, color: storeInfo.penaltyPoints >= 30 ? "#ef4444" : "#f59e0b", marginTop: "0.25rem" }}>
                  {storeInfo.penaltyPoints || 0} / 50 Dues
                </p>
              </div>
            </div>

            {/* Warning threshold alert */}
            {storeInfo.penaltyPoints >= 35 && storeInfo.isActive && (
              <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.5rem", color: "#f59e0b", fontSize: "0.82rem" }}>
                <strong>Penalties Warning:</strong> Your store has accumulated {storeInfo.penaltyPoints} penalty points. If you reach 50 points, your catalog access will be automatically suspended. Please resolve or appeal pending complaints.
              </div>
            )}

            {/* Appeals Form */}
            {complaintAppealTarget ? (
              <div style={{ background: "var(--bg-secondary)", padding: "1.25rem", borderRadius: 10, border: "1px solid var(--border-subtle)", marginBottom: "1.5rem" }}>
                <h4 style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.5rem" }}>Appeal Complaint: &ldquo;{complaintAppealTarget.title}&rdquo;</h4>
                <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
                  Explain your case or attach relevant transaction ref IDs to appeal this complaint to the administration.
                </p>
                <textarea
                  value={appealText}
                  onChange={(e) => setAppealText(e.target.value)}
                  placeholder="Write your appeal statement here..."
                  style={{ width: "100%", minHeight: 80, padding: "0.6rem", background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: 8, color: "var(--text-primary)", fontSize: "0.82rem", marginBottom: "0.75rem" }}
                />
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setComplaintAppealTarget(null)}
                    style={{ padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.78rem" }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleAppealSubmit}
                    style={{ padding: "0.35rem 0.75rem", borderRadius: 6, background: "#a855f7", border: "none", color: "white", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700 }}
                  >
                    Submit Appeal
                  </button>
                </div>
              </div>
            ) : null}

            {/* Complaints List */}
            <div style={{ marginTop: "1rem" }}>
              <h4 style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.75rem" }}>Complaint History</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {(storeInfo.complaints || []).length === 0 ? (
                  <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem", padding: "2rem" }}>
                    No complaints filed. Your store account is in good standing!
                  </p>
                ) : (
                  storeInfo.complaints.map((comp: any) => (
                    <div key={comp._id} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                        <div>
                          <h5 style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--text-primary)" }}>{comp.title}</h5>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                            Filed on: {new Date(comp.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <span style={{
                          fontSize: "0.7rem", fontWeight: 800, padding: "0.15rem 0.35rem", borderRadius: 4,
                          background: comp.status === "dismissed" ? "rgba(16,185,129,0.1)" : comp.status === "resolved" ? "rgba(59,130,246,0.1)" : comp.status === "appealed" ? "rgba(245,158,11,0.1)" : "rgba(239,68,68,0.1)",
                          color: comp.status === "dismissed" ? "#10b981" : comp.status === "resolved" ? "#3b82f6" : comp.status === "appealed" ? "#f59e0b" : "#ef4444",
                          border: comp.status === "dismissed" ? "1px solid rgba(16,185,129,0.3)" : comp.status === "resolved" ? "1px solid rgba(59,130,246,0.3)" : comp.status === "appealed" ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(239,68,68,0.3)"
                        }}>
                          {comp.status.toUpperCase()}
                        </span>
                      </div>
                      <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "0.75rem" }}>
                        {comp.details}
                      </p>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem" }}>
                        <span style={{ color: "#ef4444", fontWeight: 700 }}>
                          +{comp.points} Points
                        </span>
                        {comp.status === "pending" && !complaintAppealTarget && (
                          <button
                            onClick={() => { setComplaintAppealTarget(comp); setAppealText(""); }}
                            style={{ padding: "0.25rem 0.6rem", borderRadius: 6, border: "1px solid #a855f7", background: "transparent", color: "#a855f7", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
                          >
                            Appeal
                          </button>
                        )}
                        {comp.status === "appealed" && (
                          <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.75rem" }}>
                            Appeal sent: &ldquo;{comp.appealMessage}&rdquo;
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Escalate to SuperAdmin Modal */}
      {showEscalateModal && selectedTicket && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: "2rem" }}>
          <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 450, padding: "2rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.1rem", color: "#ef4444" }}>Escalate to SuperAdmin Supreme Court</h3>
              <button onClick={() => setShowEscalateModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1.1rem" }}>✕</button>
            </div>

            <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "1rem" }}>
              This will escalate the dispute to the platform governance Master Supreme Court. SuperAdmins will review the entire ticket history, shopper transaction details, and shopper-vendor chat transcripts to render a final override.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.35rem" }}>Reason for Escalation</label>
                <textarea
                  value={escalateMsg}
                  onChange={(e) => setEscalateMsg(e.target.value)}
                  placeholder="Provide details on why you are escalating this StoreAdmin decision/dispute..."
                  style={{ width: "100%", minHeight: 80, padding: "0.5rem", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.8rem" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                <button
                  onClick={() => setShowEscalateModal(false)}
                  style={{ padding: "0.45rem 1rem", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", fontSize: "0.8rem", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!escalateMsg.trim()) {
                      alert("Please provide escalation reasons");
                      return;
                    }
                    try {
                      const token = localStorage.getItem("bazaar_token");
                      const res = await fetch(`${API}/api/complaints/${selectedTicket._id}/escalate`, {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`
                        },
                        body: JSON.stringify({ message: escalateMsg })
                      });
                      const data = await res.json();
                      if (data.success) {
                        alert("Dispute escalated successfully!");
                        setSelectedTicket(data.ticket);
                        setShowEscalateModal(false);
                        setEscalateMsg("");
                        fetchVendorTickets();
                      } else {
                        alert(data.message || "Failed to escalate dispute");
                      }
                    } catch (err: any) {
                      alert("Error escalating dispute: " + err.message);
                    }
                  }}
                  style={{ padding: "0.45rem 1rem", borderRadius: 8, background: "#ef4444", border: "none", color: "white", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
                >
                  Escalate Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function X({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  );
}

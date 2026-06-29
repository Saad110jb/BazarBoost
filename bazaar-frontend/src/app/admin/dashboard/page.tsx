"use client";
import React, { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import SecurityBreachCard from "@/components/SecurityBreachCard";
import { 
  TrendingUp, Shield, Users, Layers, AlertCircle, 
  Loader, CheckCircle2, Lock, Terminal, RefreshCw, Calendar,
  Trash2, Archive, X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useNotifications } from "@/context/NotificationContext";
import { io } from "socket.io-client";
import NotificationBell from "@/components/NotificationBell";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function LockoutCountdown({ startedAt }: { startedAt: string | null | undefined }) {
  const [timeLeft, setTimeLeft] = useState<string>("48h 00m 00s");

  useEffect(() => {
    if (!startedAt) {
      setTimeLeft("48h 00m 00s");
      return;
    }

    const interval = setInterval(() => {
      const start = new Date(startedAt).getTime();
      const limit = 48 * 60 * 60 * 1000;
      const now = Date.now();
      const elapsed = now - start;
      const remaining = limit - elapsed;

      if (remaining <= 0) {
        setTimeLeft("Expired");
        clearInterval(interval);
      } else {
        const secs = Math.floor(remaining / 1000);
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        const remainingSecs = secs % 60;
        setTimeLeft(
          `${hrs.toString().padStart(2, "0")}h ${mins
            .toString()
            .padStart(2, "0")}m ${remainingSecs
            .toString()
            .padStart(2, "0")}s`
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

  if (!startedAt) return null;

  return (
    <span 
      className="blink-warning-indicator"
      style={{ 
        marginLeft: "0.5rem", 
        fontSize: "0.75rem", 
        fontFamily: "monospace", 
        background: "rgba(245,158,11,0.15)", 
        border: "1px solid rgba(245,158,11,0.3)", 
        color: "#fbbf24", 
        padding: "0.1rem 0.35rem", 
        borderRadius: "4px",
        fontWeight: 800,
        display: "inline-flex",
        alignItems: "center"
      }}
    >
      ⏳ {timeLeft}
    </span>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  
  const [user, setUser] = useState<any>(null);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [revenueMatrix, setRevenueMatrix] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const { auditStream, breachAlerts, dismissBreach } = useNotifications();
  const auditTerminalRef = useRef<HTMLDivElement>(null);
  
  // Tab types extension
  const [activeTab, setActiveTab] = useState<"directory" | "ads" | "audit" | "products" | "maintenance" | "disputes" | "logistics" | "fintech">("directory");

  // Demand Forecast state
  const [demandMatrix, setDemandMatrix] = useState<any[]>([]);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastSweepResult, setForecastSweepResult] = useState<any>(null);
  const [forecastSweeping, setForecastSweeping] = useState(false);

  // FinTech & Margin Engineering state
  const [takeRateRules, setTakeRateRules] = useState<any[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [submittingRule, setSubmittingRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    ruleName: "",
    priority: 10,
    takeRatePercent: 5,
    description: "",
    isActive: true,
    salesVolumeTierMin: "",
    salesVolumeTierMax: "",
    categoryMatch: "",
    creditScoreMin: "",
    creditScoreMax: "",
    debtZones: [] as string[]
  });

  const [fraudShoppers, setFraudShoppers] = useState<any[]>([]);
  const [fraudLoading, setFraudLoading] = useState(false);
  const [resettingFraudId, setResettingFraudId] = useState<string | null>(null);

  const fetchForecastData = async () => {
    setForecastLoading(true);
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/admin/dark-hub/forecast/preview`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setDemandMatrix(data.demandMatrix || []);
      }
    } catch (err) {
      console.error("Failed to fetch forecast preview:", err);
    } finally {
      setForecastLoading(false);
    }
  };

  const runForecastSweep = async () => {
    setForecastSweeping(true);
    setForecastSweepResult(null);
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/admin/dark-hub/forecast`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setForecastSweepResult({
          notificationsDispatched: data.notificationsDispatched,
          topPeaks: data.demandMatrix?.slice(0, 5) || []
        });
        setDemandMatrix(data.demandMatrix || []);
      } else {
        alert(data.message || "Failed to execute forecast sweep");
      }
    } catch (err: any) {
      alert("Error executing forecast sweep: " + err.message);
    } finally {
      setForecastSweeping(false);
    }
  };

  const fetchTakeRateRules = async () => {
    setRulesLoading(true);
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/admin/take-rates`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setTakeRateRules(data.rules || []);
    } catch (err) {
      console.error("Failed to load take-rate rules:", err);
    } finally {
      setRulesLoading(false);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingRule(true);
    const token = localStorage.getItem("bazaar_token");
    try {
      const payload = {
        ruleName: ruleForm.ruleName,
        priority: Number(ruleForm.priority),
        takeRatePercent: Number(ruleForm.takeRatePercent),
        description: ruleForm.description,
        isActive: ruleForm.isActive,
        conditions: {
          salesVolumeTierMin: ruleForm.salesVolumeTierMin ? Number(ruleForm.salesVolumeTierMin) : null,
          salesVolumeTierMax: ruleForm.salesVolumeTierMax ? Number(ruleForm.salesVolumeTierMax) : null,
          categoryMatch: ruleForm.categoryMatch,
          creditScoreMin: ruleForm.creditScoreMin ? Number(ruleForm.creditScoreMin) : null,
          creditScoreMax: ruleForm.creditScoreMax ? Number(ruleForm.creditScoreMax) : null,
          debtZones: ruleForm.debtZones
        }
      };

      const res = await fetch(`${API}/api/admin/take-rates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        alert("Dynamic take-rate rule created successfully!");
        setRuleForm({
          ruleName: "",
          priority: 10,
          takeRatePercent: 5,
          description: "",
          isActive: true,
          salesVolumeTierMin: "",
          salesVolumeTierMax: "",
          categoryMatch: "",
          creditScoreMin: "",
          creditScoreMax: "",
          debtZones: []
        });
        fetchTakeRateRules();
      } else {
        alert(data.message || "Failed to create rule");
      }
    } catch (err: any) {
      alert("Error creating take-rate rule: " + err.message);
    } finally {
      setSubmittingRule(false);
    }
  };

  const handleToggleRuleActive = async (ruleId: string, currentStatus: boolean) => {
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/admin/take-rates/${ruleId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isActive: !currentStatus })
      });
      const data = await res.json();
      if (data.success) {
        fetchTakeRateRules();
      } else {
        alert(data.message || "Failed to update rule status");
      }
    } catch (err: any) {
      alert("Error updating rule status: " + err.message);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!window.confirm("Are you sure you want to delete this take-rate rule?")) return;
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/admin/take-rates/${ruleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        fetchTakeRateRules();
      } else {
        alert(data.message || "Failed to delete rule");
      }
    } catch (err: any) {
      alert("Error deleting rule: " + err.message);
    }
  };

  const fetchFraudShoppers = async () => {
    setFraudLoading(true);
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/admin/fraud-shoppers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setFraudShoppers(data.shoppers || []);
    } catch (err) {
      console.error("Failed to load fraud shopper registry:", err);
    } finally {
      setFraudLoading(false);
    }
  };

  const handleResetFraud = async (shopperId: string) => {
    if (!window.confirm("Are you sure you want to manually reset the fraud risk status and re-enable COD for this shopper?")) return;
    setResettingFraudId(shopperId);
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/admin/fraud-shoppers/${shopperId}/reset`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        alert("Shopper profile cleared from high-fraud list successfully.");
        fetchFraudShoppers();
      } else {
        alert(data.message || "Failed to reset shopper status");
      }
    } catch (err: any) {
      alert("Error resetting shopper status: " + err.message);
    } finally {
      setResettingFraudId(null);
    }
  };

  // Operational Messaging Broadcast state
  const [broadcastForm, setBroadcastForm] = useState({ targetAudience: "all_vendors", deliveryChannel: "smtp", subject: "", body: "" });
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState("");
  const [broadcastError, setBroadcastError] = useState("");

  // Dark Hub Logistics state
  const [logisticsPipelines, setLogisticsPipelines] = useState<any[]>([]);
  const [logisticsLoading, setLogisticsLoading]     = useState(false);

  // Computer Vision Disputes state
  const [cvDisputes, setCvDisputes]         = useState<any[]>([]);
  const [cvDisputesLoading, setCvDisputesLoading] = useState(false);

  // Broadcast job history state (live job tracker)
  const [broadcastHistory, setBroadcastHistory]       = useState<any[]>([]);
  const [broadcastHistoryLoading, setBroadcastHistoryLoading] = useState(false);
  const [slots, setSlots] = useState<any[]>([]);
  const [allBids, setAllBids] = useState<any[]>([]);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [slotForm, setSlotForm] = useState({ name: "", basePrice: "", durationDays: "", maxSimultaneousCampaigns: "", isActive: true });

  // Disputes Triage state
  const [complaints, setComplaints] = useState<any[]>([]);
  const [complaintsLoading, setComplaintsLoading] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState<any>(null);
  const [triageAction, setTriageAction] = useState<string>("resolve"); // resolve | soft_delete | escalate
  const [triageMessage, setTriageMessage] = useState<string>("");
  const [triageSubmitting, setTriageSubmitting] = useState(false);
  const [chatLogs, setChatLogs] = useState<any[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [targetShopperBlock, setTargetShopperBlock] = useState(false);
  const [governanceSubmitting, setGovernanceSubmitting] = useState(false);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedStoreForDrawer, setSelectedStoreForDrawer] = useState<any>(null);
  const [drawerTransactions, setDrawerTransactions] = useState<any[]>([]);
  const [drawerTransactionsLoading, setDrawerTransactionsLoading] = useState(false);
  const [drawerActionLoading, setDrawerActionLoading] = useState(false);

  // Maintenance, Products & Purge States
  const [products, setProducts] = useState<any[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [purgeThreshold, setPurgeThreshold] = useState<number>(6);
  const [confirmText, setConfirmText] = useState<string>("");
  const [purgingLoading, setPurgingLoading] = useState(false);
  const [purgeMessage, setPurgeMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [purgeLedger, setPurgeLedger] = useState<any[]>([]);

  const openDrawerForStore = async (store: any) => {
    setSelectedStoreForDrawer(store);
    setDrawerOpen(true);
    setDrawerTransactions([]);
    setDrawerTransactionsLoading(true);

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    try {
      const res = await fetch(`${API}/api/wallet/admin/transactions/${store._id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setDrawerTransactions(data.transactions || []);
      } else {
        console.error("Failed to fetch store transactions:", data.message);
      }
    } catch (err) {
      console.error("Error fetching transactions:", err);
    } finally {
      setDrawerTransactionsLoading(false);
    }
  };

  const handleDrawerOverrideAction = async (action: "toggle_active" | "clear_debt") => {
    if (!selectedStoreForDrawer) return;
    setDrawerActionLoading(true);

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    try {
      const res = await fetch(`${API}/api/wallet/stores/${selectedStoreForDrawer._id}/override`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || `Action ${action} executed successfully!`);
        // Refresh page stats dynamically
        fetchData(token);
        
        // Update selected store in drawer to reflect new state
        setSelectedStoreForDrawer(data.store);

        // Refetch drawer transactions if debt cleared
        if (action === "clear_debt") {
          openDrawerForStore(data.store);
        }
      } else {
        alert(data.message || "Failed to execute override action");
      }
    } catch (err: any) {
      alert("Error executing override action: " + err.message);
    } finally {
      setDrawerActionLoading(false);
    }
  };

  // Authenticate and load data
  useEffect(() => {
    const stored = localStorage.getItem("bazaar_user");
    const token = localStorage.getItem("bazaar_token");
    if (!stored || !token) {
      router.push("/admin/gatekeeper-login");
      return;
    }

    const u = JSON.parse(stored);
    if (u.role !== "admin" && u.role !== "storeAdmin") {
      router.push("/auth/login");
      return;
    }
    setUser(u);

    // Fetch initial data
    fetchData(token);
    generateMockSystemLogs();

    // Socket.io real-time connection
    let socket: any;
    try {
      socket = io(API, {
        auth: { token },
        transports: ["websocket"],
        timeout: 5000,
        reconnectionAttempts: 5
      });

      socket.on("connect", () => {
        console.log("[Admin Socket] Connected to real-time channel");
      });

      socket.on("disconnect", () => {
        console.log("[Admin Socket] Disconnected");
      });

      socket.on("wallet_updated", (data: any) => {
        console.log("[Admin Socket] Wallet updated:", data);
        fetchData(token);
      });

      socket.on("commission_due", (data: any) => {
        console.log("[Admin Socket] Commission due event:", data);
        fetchData(token);
      });

      socket.on("purge_completed", (data: any) => {
        console.log("[Admin Socket] Purge completed:", data);
        fetchData(token);
      });
    } catch (err) {
      console.error("[Admin Socket] Failed to connect:", err);
    }    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBroadcastSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBroadcasting(true);
    setBroadcastSuccess("");
    setBroadcastError("");
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/admin/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(broadcastForm)
      });
      const data = await res.json();
      if (data.success) {
        setBroadcastSuccess(data.message);
        setBroadcastForm(prev => ({ ...prev, subject: "", body: "" }));
        // Refresh broadcast history after successful submit
        fetchBroadcastHistory();
      } else {
        setBroadcastError(data.message || "Failed to dispatch messaging broadcast");
      }
    } catch (err: any) {
      setBroadcastError("Network failure deploying broadcast payload: " + err.message);
    } finally {
      setBroadcasting(false);
    }
  };

  const fetchLogisticsData = async () => {
    setLogisticsLoading(true);
    const token = localStorage.getItem("bazaar_token");
    try {
      const res  = await fetch(`${API}/api/admin/dark-hub`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setLogisticsPipelines(data.pipelines || []);
    } catch (err) {
      console.error("Failed to load logistics data:", err);
    } finally {
      setLogisticsLoading(false);
    }
  };

  const fetchBroadcastHistory = async () => {
    setBroadcastHistoryLoading(true);
    const token = localStorage.getItem("bazaar_token");
    try {
      const res  = await fetch(`${API}/api/admin/broadcast/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setBroadcastHistory(data.jobs || []);
    } catch (err) {
      console.error("Failed to load broadcast history:", err);
    } finally {
      setBroadcastHistoryLoading(false);
    }
  };

  const fetchCvDisputes = async () => {
    setCvDisputesLoading(true);
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/admin/cv-disputes`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setCvDisputes(data.disputes || []);
      }
    } catch (err) {
      console.error("Failed to load CV disputes data:", err);
    } finally {
      setCvDisputesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "logistics") {
      fetchLogisticsData();
      fetchCvDisputes();
      fetchBroadcastHistory();
      fetchForecastData();
    } else if (activeTab === "fintech") {
      fetchTakeRateRules();
      fetchFraudShoppers();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchQueue = async (token: string) => {
    setQueueLoading(true);
    try {
      const res = await fetch(`${API}/api/wallet/verification-queue`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setQueue(data.queue || []);
      }
    } catch (err) {
      console.error("Failed to fetch verification queue:", err);
    } finally {
      setQueueLoading(false);
    }
  };

  const fetchPurgeLedger = async (token: string) => {
    try {
      const res = await fetch(`${API}/api/admin/purge/ledger`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setPurgeLedger(data.ledger || []);
      }
    } catch (err) {
      console.error("Failed to fetch purge ledger:", err);
    }
  };

  const fetchComplaints = async (token: string) => {
    setComplaintsLoading(true);
    try {
      const res = await fetch(`${API}/api/complaints/admin`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setComplaints(data.tickets || []);
      }
    } catch (err) {
      console.error("Failed to fetch complaints:", err);
    } finally {
      setComplaintsLoading(false);
    }
  };

  const fetchChatLogs = async (ticketId: string) => {
    setChatLoading(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/complaints/${ticketId}/chat`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setChatLogs(data.chatHistory || []);
      }
    } catch (err) {
      console.error("Failed to fetch chat logs:", err);
    } finally {
      setChatLoading(false);
    }
  };

  const fetchData = async (token: string) => {
    setLoading(true);
    setErrorMsg("");
    try {
      // 1. Fetch ledger summary
      const res = await fetch(`${API}/api/wallet/ledger`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/admin/gatekeeper-login");
          return;
        }
        throw new Error(`Server returned status: ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        setLedgerData(data);
        setRevenueMatrix(data.dailyRevenueMatrix || []);
      } else {
        setErrorMsg(data.message || "Failed to load ledger statistics.");
      }

      // 1.1 Fetch slots
      const slotsRes = await fetch(`${API}/api/ads/slots`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const slotsData = await slotsRes.json();
      if (slotsData.success) {
        setSlots(slotsData.slots || []);
      }

      // 1.2 Fetch all bids
      const bidsRes = await fetch(`${API}/api/ads/bids/all`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const bidsData = await bidsRes.json();
      if (bidsData.success) {
        setAllBids(bidsData.bids || []);
      }

      // Fetch queue
      await fetchQueue(token);

      // Fetch all products
      const productsRes = await fetch(`${API}/api/products`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const productsData = await productsRes.json();
      if (productsData.success) {
        setProducts(productsData.products || []);
      }

      // Fetch purge ledger
      await fetchPurgeLedger(token);

      // Fetch complaints
      await fetchComplaints(token);

      // Mock session lists representing active JWT connections in AdminSession
      // Using client IP and token information
      setSessions([
        { id: "s1", ipAddress: "127.0.0.1 (Localhost)", role: "SuperAdmin", expires: "In 2 hours", status: "Active Session" }
      ]);

    } catch (err) {
      setErrorMsg("Failed to connect to backend ledger API. Check connection.");
    } finally {
      setLoading(false);
    }
  };


  const generateMockSystemLogs = () => {
    setSystemLogs([
      { id: 1, time: new Date().toLocaleTimeString(), type: "SECURITY", msg: "Unrestricted master scope payload (tenantStores: ['GLOBAL']) signed." },
      { id: 2, time: new Date().toLocaleTimeString(), type: "AI_OCR", msg: "Local Tesseract OCR engine successfully loaded for receipt fraud analysis." },
      { id: 3, time: new Date().toLocaleTimeString(), type: "MIDDLEWARE", msg: "verifyTenantAccess: Admin role identified. Tenant isolation queries bypassed." },
      { id: 4, time: new Date().toLocaleTimeString(), type: "COMMISSION", msg: "Commission scheduler completed. Platform commissions charged atomically." },
    ]);
  };

  const handleExecutePurge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmText !== "CONFIRM") {
      setPurgeMessage({ type: "error", text: "Please type 'CONFIRM' to verify execution." });
      return;
    }

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    setPurgingLoading(true);
    setPurgeMessage(null);

    try {
      const res = await fetch(`${API}/api/admin/purge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ thresholdMonths: purgeThreshold })
      });
      const data = await res.json();
      if (data.success) {
        setPurgeMessage({
          type: "success",
          text: `Purge executed successfully! Deleted ${data.ledgerEntry.purgedCounts.adBids} ad bids, ${data.ledgerEntry.purgedCounts.notifications} notifications, ${data.ledgerEntry.purgedCounts.uncompletedCarts} uncompleted carts, and ${data.ledgerEntry.purgedCounts.auditLogs} audit logs.`
        });
        setConfirmText("");
        // Reload ledger and products data
        fetchData(token);
      } else {
        setPurgeMessage({ type: "error", text: data.message || "Failed to execute database purge." });
      }
    } catch (err: any) {
      setPurgeMessage({ type: "error", text: "Network connection error. Failed to run purge." });
    } finally {
      setPurgingLoading(false);
    }
  };

  const handleDeleteProductAdmin = async (productId: string, force: boolean) => {
    const token = localStorage.getItem("bazaar_token");
    setProductsLoading(true);
    try {
      const res = await fetch(`${API}/api/products/${productId}?force=${force}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        if (token) {
          fetchData(token);
        }
        setShowDeleteModal(false);
        setSelectedProduct(null);
      } else {
        alert(data.message || "Failed to delete product");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to communicate with API server");
    } finally {
      setProductsLoading(false);
    }
  };

  const handleQueueAction = async (id: string, type: "ad_bid" | "wallet_topup", action: "approved" | "rejected") => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const endpoint = type === "ad_bid" ? `/api/ads/bids/${id}/status` : `/api/wallet/topups/${id}/status`;
      const res = await fetch(`${API}${endpoint}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: action })
      });
      const data = await res.json();
      if (data.success) {
        // Refresh queue and ledger balance statistics
        fetchData(token);
      } else {
        alert(data.message || "Failed to process request");
      }
    } catch (err: any) {
      alert("Error processing action: " + err.message);
    }
  };

  const handleToggleVisibility = async (storeId: string, currentVal: boolean) => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/wallet/stores/${storeId}/visibility`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ productVisibilityLimited: !currentVal })
      });
      const data = await res.json();
      if (data.success) {
        fetchData(token);
      } else {
        alert(data.message || "Failed to update visibility");
      }
    } catch (err: any) {
      alert("Error updating visibility: " + err.message);
    }
  };

  const handleUpdateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSlotId) return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/ads/slots/${editingSlotId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: slotForm.name,
          basePrice: parseFloat(slotForm.basePrice),
          durationDays: parseInt(slotForm.durationDays),
          maxSimultaneousCampaigns: parseInt(slotForm.maxSimultaneousCampaigns),
          isActive: slotForm.isActive
        })
      });
      const data = await res.json();
      if (data.success) {
        setEditingSlotId(null);
        fetchData(token);
      } else {
        alert(data.message || "Failed to update slot");
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const handleTerminateCampaign = async (bidId: string) => {
    if (!confirm("Are you sure you want to administratively terminate this ad campaign? This will revoke its sponsored visibility immediately.")) return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/ads/bids/${bidId}/terminate`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        fetchData(token);
      } else {
        alert(data.message || "Failed to terminate campaign");
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };



  if (loading) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
        <Sidebar role="admin" />
        <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <Loader size={36} style={{ animation: "spin 1s linear infinite", color: "#a855f7", marginBottom: "0.5rem" }} />
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Hydrating platforms operations data...</p>
          </div>
        </main>
      </div>
    );
  }

  // Calculate stats from ledger
  const summary = ledgerData?.summary || { totalStores: 0, totalPlatformBalancePKR: 0, totalDepositedPlatformPKR: 0, totalSpentPlatformPKR: 0 };
  const stores = ledgerData?.stores || [];
  const totalCommissionDebt = stores.reduce((sum: number, s: any) => sum + (s.wallet?.outstandingCommission || 0), 0);

  const tickerItems: any[] = [];
  allBids.forEach(bid => {
    if (bid.paymentStatus === 'approved') {
      const slotName = bid.slotId?.name || 'Campaign';
      const prodName = bid.productId?.title || 'Product';
      if (bid.variants && bid.variants.length > 0) {
        bid.variants.forEach((v: any) => {
          tickerItems.push({
            campaignId: bid._id,
            slotName,
            prodName,
            variantId: v.variantId,
            name: v.name || v.variantId,
            impressions: v.impressions || 0,
            conversions: v.conversions || 0
          });
        });
      }
    }
  });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <Sidebar role="admin" />
      
      <main style={{ flex: 1, padding: "2.5rem", overflow: "auto" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "0.3rem" }}>Platform Operations Dashboard</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Governing multi-tenant bounds, outstanding commission debts, and platform parameters.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <NotificationBell />
            <button 
              onClick={() => router.push("/admin/analytics")}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                background: "#a855f7",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontSize: "0.82rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontWeight: 700,
                boxShadow: "0 4px 14px rgba(168,85,247,0.3)"
              }}
            >
              <TrendingUp size={14} /> Platform Analytics
            </button>
            <button 
              onClick={() => {
                const token = localStorage.getItem("bazaar_token");
                if (token) fetchData(token);
              }}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-subtle)",
                cursor: "pointer",
                fontSize: "0.82rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontWeight: 600
              }}
            >
              <RefreshCw size={14} /> Refresh Data
            </button>
          </div>
        </div>

        {/* Scrolling Traffic Ticker */}
        {tickerItems.length > 0 && (
          <div className="ticker-wrap">
            <div style={{
              background: "rgba(168, 85, 247, 0.15)",
              color: "#c084fc",
              fontSize: "0.7rem",
              fontWeight: 800,
              padding: "0.2rem 0.5rem",
              borderRadius: "6px",
              marginRight: "1.2rem",
              flexShrink: 0,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              border: "1px solid rgba(168, 85, 247, 0.3)",
              zIndex: 2
            }}>
              Live Traffic Ticker
            </div>
            <div style={{ overflow: "hidden", width: "100%", display: "flex" }}>
              <div className="ticker-scroll">
                {tickerItems.map((item, idx) => (
                  <span key={`t1-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ color: "#a855f7", fontWeight: 700 }}>[{item.slotName}]</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{item.name} ({item.variantId})</span>
                    <span style={{ color: "var(--text-muted)" }}>•</span>
                    <span>Impressions: <strong style={{ color: "#3b82f6" }}>{item.impressions}</strong></span>
                    <span style={{ color: "var(--text-muted)" }}>•</span>
                    <span>Conversions: <strong style={{ color: "#10b981" }}>{item.conversions}</strong></span>
                  </span>
                ))}
                {tickerItems.map((item, idx) => (
                  <span key={`t2-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ color: "#a855f7", fontWeight: 700 }}>[{item.slotName}]</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{item.name} ({item.variantId})</span>
                    <span style={{ color: "var(--text-muted)" }}>•</span>
                    <span>Impressions: <strong style={{ color: "#3b82f6" }}>{item.impressions}</strong></span>
                    <span style={{ color: "var(--text-muted)" }}>•</span>
                    <span>Conversions: <strong style={{ color: "#10b981" }}>{item.conversions}</strong></span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "1rem", marginBottom: "1.5rem", color: "#ef4444", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <AlertCircle size={16} /> {errorMsg}
          </div>
        )}

        {/* Stats Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "2.5rem" }}>
          {[
            { label: "Active Stores Registered", value: summary.totalActiveStores !== undefined ? summary.totalActiveStores : summary.totalStores, color: "#3b82f6", icon: <Layers size={18} /> },
            { label: "Merchant Wallet Balance", value: `Rs. ${(summary.totalPlatformBalancePKR || 0).toLocaleString()}`, color: "#10b981", icon: <TrendingUp size={18} /> },
            { label: "Outstanding Commission Debt", value: `Rs. ${(summary.totalCommissionDebt !== undefined ? summary.totalCommissionDebt : totalCommissionDebt).toLocaleString()}`, color: "#ef4444", icon: <AlertCircle size={18} /> },
            { label: "Active Security Sessions", value: summary.activeSecuritySessions !== undefined ? summary.activeSecuritySessions : sessions.length, color: "#a855f7", icon: <Shield size={18} /> },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div style={{ color: s.color, marginBottom: "0.75rem" }}>{s.icon}</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{s.value}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Style Tag for Blinking Warning Colors */}
        <style>{`
          @keyframes blink-alert {
            0%, 100% { border: 2px solid #ef4444; box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); background-color: rgba(239, 68, 68, 0.18); }
            50% { border: 2px solid transparent; box-shadow: none; background-color: transparent; }
          }
          .blink-warning-row {
            animation: blink-alert 1.2s infinite;
          }
          @keyframes blink-warning {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          .blink-warning-indicator {
            animation: blink-warning 1s infinite;
          }
          @keyframes blink-debt {
            0%, 100% { background-color: rgba(239, 68, 68, 0.08); }
            50% { background-color: transparent; }
          }
          .blink-debt-row {
            animation: blink-debt 1.5s infinite;
          }
          @keyframes marquee {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-50%); }
          }
          .ticker-wrap {
            overflow: hidden;
            width: 100%;
            position: relative;
            background: rgba(255, 255, 255, 0.03);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            padding: 0.6rem 1rem;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
          }
          .ticker-scroll {
            display: inline-flex;
            gap: 3rem;
            animation: marquee 35s linear infinite;
            font-size: 0.82rem;
            color: var(--text-secondary);
            white-space: nowrap;
            min-width: 100%;
          }
          .ticker-scroll:hover {
            animation-play-state: paused;
          }
        `}</style>

        {/* Recharts Unified Platform Revenue Matrix */}
        <div className="glass-card animate-fade-up" style={{ padding: "1.5rem", marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "0.4rem", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <TrendingUp size={20} style={{ color: "#3b82f6" }} /> Unified Platform Revenue Matrix
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
            Real-time aggregate Gross Merchandise Value (GMV) flowing through the BazaarBoost ecosystem and 5% Platform Commission earnings.
          </p>
          <div style={{ width: "100%", height: 300 }}>
            {revenueMatrix.length === 0 ? (
              <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontStyle: "italic" }}>
                No revenue data available. Process some orders to generate statistics.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={revenueMatrix}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorGmv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorCommission" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} />
                  <YAxis stroke="var(--text-muted)" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: "var(--bg-secondary)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }} />
                  <Legend />
                  <Area type="monotone" dataKey="gmv" name="Gross Merchandise Value (GMV)" stroke="#3b82f6" fillOpacity={1} fill="url(#colorGmv)" />
                  <Area type="monotone" dataKey="commission" name="Platform Commission (5%)" stroke="#10b981" fillOpacity={1} fill="url(#colorCommission)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>


        {/* Verification Queue Section */}
        <div className="glass-card animate-fade-up" style={{ padding: "1.5rem", marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "0.4rem", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <TrendingUp size={20} style={{ color: "#10b981" }} /> Financial Verification Queue
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
            Audit pending manual deposits and ad campaigns. Duplicate/fraudulent receipts are highlighted automatically.
          </p>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Vendor / Store</th>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Request Type</th>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Claimed Amount</th>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Reference Details</th>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Receipt Screenshot</th>
                  <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {queue.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                      No pending financial approvals in the queue.
                    </td>
                  </tr>
                ) : (
                  queue.map((item) => {
                    const isDup = item.isDuplicate;
                    return (
                      <tr 
                        key={item._id} 
                        className={isDup ? "blink-warning-row" : ""} 
                        style={{ borderBottom: "1px solid var(--border-subtle)", transition: "background 0.2s" }}
                      >
                        <td style={{ padding: "1rem" }}>
                          <p style={{ fontWeight: 700 }}>{item.vendorId?.name || "Merchant"}</p>
                          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{item.vendorId?.email}</p>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          {item.type === "ad_bid" ? (
                            <span className="badge badge-info">Ad Campaign Placement</span>
                          ) : item.topupType === "commission_payment" ? (
                            <span className="badge" style={{ background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.3)", color: "#a855f7", borderRadius: "4px", padding: "0.15rem 0.35rem", fontWeight: 800 }}>Commission Payment</span>
                          ) : (
                            <span className="badge badge-success">Wallet Top-up</span>
                          )}
                        </td>
                        <td style={{ padding: "1rem", fontWeight: 800, fontSize: "0.95rem" }}>
                          {item.type === "ad_bid" ? `$${item.bidAmount}` : `Rs. ${item.amountPKR}`}
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <div style={{ fontSize: "0.8rem" }}>
                            <strong>Typed Ref:</strong> <span style={{ fontFamily: "monospace" }}>{item.referenceId || "N/A"}</span>
                          </div>
                          <div style={{ fontSize: "0.74rem", color: "var(--text-secondary)", marginTop: "0.15rem" }}>
                            <strong>OCR Ref:</strong> <span style={{ fontFamily: "monospace" }}>{item.ocrResult?.referenceNumber || "Unparsed"}</span>
                          </div>
                          {isDup && (
                            <div style={{ color: "#ef4444", fontSize: "0.7rem", fontWeight: 900, marginTop: "0.3rem", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                              ⚠️ CRITICAL: DUPLICATE TRANSACTION DETECTED / POSSIBLE FRAUD
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "1rem" }}>
                          {item.paymentReceiptUrl ? (
                            <button 
                              onClick={() => setSelectedReceipt(`${API}${item.paymentReceiptUrl}`)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.3rem",
                                padding: "0.35rem 0.7rem",
                                background: "rgba(168,85,247,0.1)",
                                border: "1px solid rgba(168,85,247,0.3)",
                                color: "#a855f7",
                                borderRadius: "6px",
                                fontSize: "0.74rem",
                                cursor: "pointer",
                                fontWeight: 600
                              }}
                            >
                              View Receipt Image
                            </button>
                          ) : (
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>No file uploaded</span>
                          )}
                        </td>
                        <td style={{ padding: "1rem", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "0.5rem" }}>
                            <button 
                              onClick={() => handleQueueAction(item._id, item.type, "approved")}
                              style={{
                                background: "#10b981",
                                color: "#fff",
                                border: "none",
                                borderRadius: "6px",
                                padding: "0.4rem 0.8rem",
                                fontSize: "0.76rem",
                                fontWeight: 700,
                                cursor: "pointer"
                              }}
                            >
                              Approve
                            </button>
                            <button 
                              onClick={() => handleQueueAction(item._id, item.type, "rejected")}
                              style={{
                                background: "#ef4444",
                                color: "#fff",
                                border: "none",
                                borderRadius: "6px",
                                padding: "0.4rem 0.8rem",
                                fontSize: "0.76rem",
                                fontWeight: 700,
                                cursor: "pointer"
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Window for high-resolution receipt review */}
        {selectedReceipt && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: "2rem" }}>
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: "12px", width: "100%", maxWidth: "600px", padding: "1.5rem", position: "relative" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={{ fontWeight: 800, fontSize: "1rem" }}>High-Resolution Receipt View</h3>
                <button 
                  onClick={() => setSelectedReceipt(null)} 
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontWeight: 800,
                    fontSize: "1rem"
                  }}
                >
                  ✕ Close
                </button>
              </div>
              <div style={{ display: "flex", justifyContent: "center", background: "#000", borderRadius: "8px", overflow: "hidden", maxHeight: "450px" }}>
                <img 
                  src={selectedReceipt} 
                  alt="Receipt screenshot" 
                  style={{ maxWidth: "100%", maxHeight: "450px", objectFit: "contain" }} 
                />
              </div>
            </div>
          </div>
        )}

        {/* Content Tabs */}

        {/* Tab Switcher */}
        <div style={{ display: "flex", gap: "1rem", borderBottom: "1px solid var(--border-subtle)", marginBottom: "2rem" }}>
          <button
            onClick={() => setActiveTab("directory")}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "directory" ? "2px solid #a855f7" : "2px solid transparent",
              color: activeTab === "directory" ? "#a855f7" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Core Directory & Financial Ledger
          </button>
          <button
            onClick={() => setActiveTab("ads")}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "ads" ? "2px solid #a855f7" : "2px solid transparent",
              color: activeTab === "ads" ? "#a855f7" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Ad &amp; Promotion Infrastructure
          </button>
          <button
            onClick={() => setActiveTab("products")}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "products" ? "2px solid #a855f7" : "2px solid transparent",
              color: activeTab === "products" ? "#a855f7" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Products Management
          </button>
          <button
            id="tab-audit-trail"
            onClick={() => setActiveTab("audit")}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "audit" ? "2px solid #ef4444" : "2px solid transparent",
              color: activeTab === "audit" ? "#ef4444" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Shield size={16} />
            Security &amp; Audit Trail
            {breachAlerts.length > 0 && (
              <span style={{
                background: "#ef4444",
                color: "#fff",
                borderRadius: "50%",
                width: "18px",
                height: "18px",
                fontSize: "0.7rem",
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 8px rgba(239,68,68,0.6)",
                animation: "breachBadgePulse 1s ease infinite",
              }}>
                {breachAlerts.length}
              </span>
            )}
          </button>
          <button
            id="tab-maintenance"
            onClick={() => setActiveTab("maintenance")}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "maintenance" ? "2px solid #10b981" : "2px solid transparent",
              color: activeTab === "maintenance" ? "#10b981" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <RefreshCw size={16} />
            Maintenance &amp; Purging
          </button>
          <button
            id="tab-disputes"
            onClick={() => setActiveTab("disputes")}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "disputes" ? "2px solid #ef4444" : "2px solid transparent",
              color: activeTab === "disputes" ? "#ef4444" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Shield size={16} />
            Disputes Triage
          </button>
          <button
            id="tab-logistics"
            onClick={() => setActiveTab("logistics")}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "logistics" ? "2px solid #a855f7" : "2px solid transparent",
              color: activeTab === "logistics" ? "#a855f7" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Layers size={16} />
            SaaS Logistics &amp; Broadcast
          </button>
          <button
            id="tab-fintech"
            onClick={() => setActiveTab("fintech")}
            style={{
              padding: "0.75rem 1.25rem",
              background: "none",
              border: "none",
              borderBottom: activeTab === "fintech" ? "2px solid #10b981" : "2px solid transparent",
              color: activeTab === "fintech" ? "#10b981" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <TrendingUp size={16} />
            FinTech &amp; Margin Engineering
          </button>
        </div>

        {activeTab === "directory" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1.5rem", alignItems: "start" }}>
            
            {/* Left Panel: Vendor Outstanding Balance Ledger */}
            <div className="glass-card" style={{ padding: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Users size={18} style={{ color: "#a855f7" }} /> Vendor Outstanding Balance Ledger
              </h3>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Store Details</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Owner Vendor</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Current Balance</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Outstanding Commission</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Status</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stores.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No stores registered on platform.
                        </td>
                      </tr>
                    ) : (
                      stores.map((st: any) => {
                        const commission = st.wallet?.outstandingCommission || 0;
                        const debtPercent = Math.min((commission / 25000) * 100, 100);

                        let phase = "normal";
                        let progressColor = "#10b981"; // green
                        let badgeLabel = "";
                        let badgeColor = "";
                        let rowBackground = "transparent";

                        if (debtPercent >= 100) {
                          phase = "phase3";
                          progressColor = "#ef4444"; // red
                          badgeLabel = "Phase 3: Suspended & Locked";
                          badgeColor = "rgba(239,68,68,0.15)";
                          rowBackground = "rgba(239,68,68,0.08)";
                        } else if (debtPercent >= 90) {
                          phase = "phase2";
                          progressColor = "#fbbf24"; // amber
                          badgeLabel = "Phase 2: Ad-Placements Frozen";
                          badgeColor = "rgba(245,158,11,0.15)";
                        } else if (debtPercent >= 70) {
                          phase = "phase1";
                          progressColor = "#f97316"; // orange
                          badgeLabel = "Phase 1: Alert Active";
                          badgeColor = "rgba(249,115,22,0.15)";
                        }

                        return (
                          <tr 
                            key={st._id} 
                            style={{ 
                              borderBottom: "1px solid var(--border-subtle)",
                              backgroundColor: rowBackground,
                              transition: "background-color 0.2s ease"
                            }}
                          >
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <p style={{ fontWeight: 700 }}>{st.name}</p>
                              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>/{st.slug}</p>
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <p style={{ fontWeight: 600 }}>{st.vendorId?.name || "N/A"}</p>
                              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{st.vendorId?.email || ""}</p>
                            </td>
                            <td style={{ padding: "0.75rem 1rem", fontWeight: 700 }}>
                              Rs. {(st.wallet?.balancePKR || 0).toLocaleString()}
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", width: "100%", minWidth: "160px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem" }}>
                                  <span style={{ fontWeight: 750, color: "var(--text-primary)" }}>
                                    Rs. {commission.toLocaleString()} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>/ Rs. 25,000</span>
                                  </span>
                                  <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>{Math.round(debtPercent)}%</span>
                                </div>
                                
                                <div style={{ width: "100%", height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
                                  <div style={{ width: `${debtPercent}%`, height: "100%", background: progressColor, borderRadius: "2px", transition: "width 0.3s ease" }} />
                                </div>

                                {badgeLabel && (
                                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px", marginTop: "0.15rem" }}>
                                    <span 
                                      className={phase === "phase2" ? "blink-warning-indicator" : ""}
                                      style={{ 
                                        fontSize: "0.68rem", 
                                        fontWeight: 800, 
                                        background: badgeColor, 
                                        border: `1px solid ${progressColor}`, 
                                        color: progressColor, 
                                        borderRadius: "4px", 
                                        padding: "0.1rem 0.3rem",
                                        display: "inline-flex",
                                        alignItems: "center"
                                      }}
                                    >
                                      {badgeLabel}
                                    </span>
                                    {phase === "phase2" && <LockoutCountdown startedAt={st.amberCountdownStartedAt} />}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "start" }}>
                                {!st.isActive ? (
                                  <span className="badge" style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444", fontSize: "0.68rem", fontWeight: 900, borderRadius: "4px", padding: "0.1rem 0.3rem", textTransform: "uppercase" }}>SUSPENDED</span>
                                ) : st.productVisibilityLimited ? (
                                  <span className="badge badge-error" style={{ fontSize: "0.68rem", fontWeight: 800, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: "4px", padding: "0.1rem 0.3rem" }}>Visibility Limited</span>
                                ) : (
                                  <span className="badge badge-success" style={{ fontSize: "0.68rem", fontWeight: 800, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", borderRadius: "4px", padding: "0.1rem 0.3rem" }}>Visible</span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                              <button
                                onClick={() => openDrawerForStore(st)}
                                style={{
                                  padding: "0.35rem 0.7rem",
                                  borderRadius: "6px",
                                  background: "rgba(168,85,247,0.15)",
                                  border: "1px solid rgba(168,85,247,0.4)",
                                  color: "#c084fc",
                                  cursor: "pointer",
                                  fontSize: "0.74rem",
                                  fontWeight: 700,
                                  transition: "all 0.2s"
                                }}
                              >
                                Limit &amp; Manage
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

            {/* Right Panel: Sessions, Logs & Platform Bank Account */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {/* Active Security Sessions */}
              <div className="glass-card" style={{ padding: "1.5rem" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Shield size={16} style={{ color: "#3b82f6" }} /> Active Security Sessions
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {sessions.map(s => (
                    <div key={s.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "0.75rem", background: "var(--bg-secondary)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{s.ipAddress}</span>
                        <span className="badge badge-success" style={{ fontSize: "0.68rem", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", borderRadius: 4, padding: "0.1rem 0.3rem", fontWeight: 800 }}>{s.status}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                        <span>Role: {s.role}</span>
                        <span>Lifespan: {s.expires}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* System Audit Logs */}
              <div className="glass-card" style={{ padding: "1.5rem" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Terminal size={16} style={{ color: "#a855f7" }} /> System Audit Logs
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: 220, overflowY: "auto", fontFamily: "monospace", fontSize: "0.74rem" }}>
                  {systemLogs.map(l => (
                    <div key={l.id} style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.4rem" }}>
                      <span style={{ color: "var(--text-muted)" }}>[{l.time}]</span>{" "}
                      <span style={{ color: l.type === "SECURITY" ? "#ef4444" : l.type === "AI_OCR" ? "#10b981" : "#3b82f6", fontWeight: 700 }}>{l.type}:</span>{" "}
                      <span style={{ color: "var(--text-secondary)" }}>{l.msg}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Platform Bank Account Instructions */}
              <div className="glass-card" style={{ padding: "1.5rem" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <TrendingUp size={16} style={{ color: "#10b981" }} /> Platform Bank Account
                </h3>
                <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
                  <p style={{ margin: "0 0 0.5rem", fontWeight: 700 }}>BazaarBoost Corporate Settlement Account:</p>
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "0.75rem" }}>
                    <div style={{ marginBottom: "0.3rem" }}><strong>Bank Name:</strong> Habib Bank Limited (HBL)</div>
                    <div style={{ marginBottom: "0.3rem" }}><strong>Account Title:</strong> BAZAARBOOST PVT LTD</div>
                    <div><strong>IBAN / Account No:</strong> PK99 HABB 0123 4567 8901 23</div>
                  </div>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem", fontStyle: "italic" }}>
                    Vendors reference this IBAN to initiate manual ad bids or settle negative commission balances.
                  </p>
                </div>
              </div>
            </div>

          </div>
        )}

        {activeTab === "ads" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "1.5rem", alignItems: "start" }}>
            
            {/* Left Panel: Ad Slots Inventory Configurator */}
            <div className="glass-card" style={{ padding: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Layers size={18} style={{ color: "#3b82f6" }} /> Ad Placements & Pricing Inventory
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", marginBottom: "1.25rem" }}>
                Configure slot availability limits, temporal runtimes, and monetization base prices.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {slots.map(slot => (
                  <div key={slot._id} style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "1rem", background: "var(--bg-secondary)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                      <h4 style={{ fontWeight: 700, fontSize: "0.9rem", margin: 0 }}>{slot.name}</h4>
                      <span className="badge" style={{
                        fontSize: "0.68rem", fontWeight: 800,
                        background: slot.isActive ? "rgba(16,185,129,0.1)" : "rgba(107,114,128,0.1)",
                        border: slot.isActive ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(107,114,128,0.3)",
                        color: slot.isActive ? "#10b981" : "#9ca3af",
                        borderRadius: 4, padding: "0.1rem 0.35rem"
                      }}>{slot.isActive ? "Active Placement" : "Disabled"}</span>
                    </div>

                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem 1rem", marginBottom: "0.75rem" }}>
                      <div><strong>Location Key:</strong> <span style={{ fontFamily: "monospace" }}>{slot.location}</span></div>
                      <div><strong>Base Bid Price:</strong> Rs. {slot.basePrice}</div>
                      <div><strong>Default Runtime:</strong> {slot.durationDays} days</div>
                      <div><strong>Max Simultaneous:</strong> {slot.maxSimultaneousCampaigns || 3} limit</div>
                    </div>

                    <button
                      onClick={() => {
                        setEditingSlotId(slot._id);
                        setSlotForm({
                          name: slot.name,
                          basePrice: slot.basePrice.toString(),
                          durationDays: (slot.durationDays || 7).toString(),
                          maxSimultaneousCampaigns: (slot.maxSimultaneousCampaigns || 3).toString(),
                          isActive: slot.isActive
                        });
                      }}
                      style={{
                        width: "100%",
                        padding: "0.45rem",
                        borderRadius: 6,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-subtle)",
                        fontSize: "0.76rem",
                        fontWeight: 700,
                        cursor: "pointer",
                        color: "#a855f7",
                        transition: "all 0.2s"
                      }}
                    >
                      Edit Pricing & Duration Config
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Panel: Master Ad Campaign Timeline */}
            <div className="glass-card" style={{ padding: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Calendar size={18} style={{ color: "#a855f7" }} /> Master Ad Campaigns Calendar & Timeline
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", marginBottom: "1.25rem" }}>
                Overview of platform advertising campaigns. Intervene administratively to terminate campaigns.
              </p>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                      <th style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem" }}>Vendor Store</th>
                      <th style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem" }}>Placement / Slot</th>
                      <th style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem" }}>Bid Price</th>
                      <th style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem" }}>Timeline Bounds</th>
                      <th style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem" }}>Custom Branding</th>
                      <th style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem" }}>Status</th>
                      <th style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allBids.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No campaigns booked on the platform yet.
                        </td>
                      </tr>
                    ) : (
                      allBids.map(bid => {
                        const statusColors: Record<string, { bg: string, color: string }> = {
                          pending_upload: { bg: "rgba(245,158,11,0.1)", color: "#f59e0b" },
                          pending_approval: { bg: "rgba(59,130,246,0.1)", color: "#3b82f6" },
                          approved: { bg: "rgba(16,185,129,0.1)", color: "#10b981" },
                          rejected: { bg: "rgba(239,68,68,0.1)", color: "#ef4444" },
                          expired: { bg: "rgba(107,114,128,0.1)", color: "#6b7280" },
                          terminated: { bg: "rgba(220,38,38,0.15)", color: "#dc2626" },
                        };
                        const colorStyle = statusColors[bid.paymentStatus] || { bg: "rgba(107,114,128,0.1)", color: "#6b7280" };

                        return (
                          <tr key={bid._id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: "0.75rem 0.5rem" }}>
                              <p style={{ fontWeight: 700, margin: 0 }}>{bid.productId?.storeId?.name || "Local Store"}</p>
                              <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>{bid.vendorId?.email}</p>
                            </td>
                            <td style={{ padding: "0.75rem 0.5rem" }}>
                              <p style={{ fontWeight: 600, margin: 0 }}>{bid.slotId?.name || "Ad Placement"}</p>
                              <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>Location: {bid.slotId?.location}</p>
                            </td>
                            <td style={{ padding: "0.75rem 0.5rem", fontWeight: 700 }}>
                              Rs. {bid.bidAmount}
                            </td>
                            <td style={{ padding: "0.75rem 0.5rem", fontSize: "0.74rem" }}>
                              <div>Start: {new Date(bid.startDate).toLocaleDateString()}</div>
                              <div>End: {new Date(bid.endDate).toLocaleDateString()}</div>
                            </td>
                            <td style={{ padding: "0.75rem 0.5rem", fontSize: "0.72rem", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {bid.textHeader || bid.bannerGraphic ? (
                                <>
                                  {bid.textHeader && <div>T: "{bid.textHeader}"</div>}
                                  {bid.bannerGraphic && <div style={{ color: "#a855f7" }}>Graphic Attached</div>}
                                </>
                              ) : (
                                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Product Defaults</span>
                              )}
                            </td>
                            <td style={{ padding: "0.75rem 0.5rem" }}>
                              <span style={{
                                display: "inline-block",
                                fontSize: "0.68rem", fontWeight: 800,
                                background: colorStyle.bg,
                                border: `1px solid ${colorStyle.color}40`,
                                color: colorStyle.color,
                                borderRadius: 4, padding: "0.1rem 0.35rem",
                                textTransform: "capitalize"
                              }}>{bid.paymentStatus.replace('_', ' ')}</span>
                            </td>
                            <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
                              {bid.paymentStatus === "approved" && (
                                <button
                                  onClick={() => handleTerminateCampaign(bid._id)}
                                  style={{
                                    padding: "0.3rem 0.6rem",
                                    borderRadius: 6,
                                    background: "#dc2626",
                                    color: "#fff",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: "0.7rem",
                                    fontWeight: 700,
                                    transition: "all 0.2s"
                                  }}
                                >
                                  Terminate
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* Configure Slot Parameters Modal */}
        {editingSlotId && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: "2rem" }}>
            <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 450, padding: "2rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1.2rem" }}>Configure Ad Slot Parameters</h2>
                <button onClick={() => setEditingSlotId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1.1rem" }}>✕</button>
              </div>

              <form onSubmit={handleUpdateSlot} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Slot Name</label>
                  <input type="text" className="input-field" required value={slotForm.name} onChange={e => setSlotForm({ ...slotForm, name: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Base Price (PKR)</label>
                  <input type="number" min="0" step="1" className="input-field" required value={slotForm.basePrice} onChange={e => setSlotForm({ ...slotForm, basePrice: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Duration (Days)</label>
                  <input type="number" min="1" step="1" className="input-field" required value={slotForm.durationDays} onChange={e => setSlotForm({ ...slotForm, durationDays: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Max Simultaneous Campaigns</label>
                  <input type="number" min="1" step="1" className="input-field" required value={slotForm.maxSimultaneousCampaigns} onChange={e => setSlotForm({ ...slotForm, maxSimultaneousCampaigns: e.target.value })} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input type="checkbox" id="slot-active" checked={slotForm.isActive} onChange={e => setSlotForm({ ...slotForm, isActive: e.target.checked })} />
                  <label htmlFor="slot-active" style={{ fontSize: "0.82rem", fontWeight: 600 }}>Slot is Active</label>
                </div>

                <button type="submit" className="btn-primary" style={{ justifyContent: "center", marginTop: "0.5rem" }}>Update Configurations</button>
              </form>
            </div>
          </div>
        )}

        {/* ── Products Management Tab ────────────────────────────────────────── */}
        {activeTab === "products" && (
          <div className="glass-card animate-fade-up" style={{ padding: "2rem" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Layers size={20} style={{ color: "#a855f7" }} /> Platform Product Directory &amp; Safety Matrix
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
              Monitor all active marketplace listings. Store Administrators can choose to soft-delete items for standard maintenance or perform a hard-deletion to completely drop listings violating platform guidelines.
            </p>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left", background: "rgba(255,255,255,0.01)" }}>
                    <th style={{ padding: "1rem" }}>Product</th>
                    <th style={{ padding: "1rem" }}>Store</th>
                    <th style={{ padding: "1rem" }}>Price</th>
                    <th style={{ padding: "1rem" }}>Stock</th>
                    <th style={{ padding: "1rem", textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p: any) => (
                    <tr key={p._id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "1rem", fontWeight: 600 }}>{p.title}</td>
                      <td style={{ padding: "1rem", color: "var(--text-secondary)" }}>{p.storeId?.name || "Unknown Store"}</td>
                      <td style={{ padding: "1rem" }}>Rs. {p.price?.toLocaleString()}</td>
                      <td style={{ padding: "1rem" }}>{p.stock} units</td>
                      <td style={{ padding: "1rem", textAlign: "center" }}>
                        <button 
                          onClick={() => {
                            setSelectedProduct(p);
                            setShowDeleteModal(true);
                          }}
                          style={{
                            background: "rgba(239, 68, 68, 0.1)",
                            border: "1px solid rgba(239, 68, 68, 0.2)",
                            color: "#ef4444",
                            padding: "0.3rem 0.75rem",
                            borderRadius: "6px",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            transition: "all 0.2s"
                          }}
                        >
                          Delete Matrix
                        </button>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
                        No active product listings found on the platform.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Product Deletion Safety Matrix Modal ──────────────────────────── */}
        {showDeleteModal && selectedProduct && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "1.5rem"
          }}>
            <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: "480px", padding: "2rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1.5rem" }}>
                <div>
                  <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <AlertCircle size={20} /> Product Deletion Safety Matrix
                  </h3>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    Select target severity for product deletion.
                  </p>
                </div>
                <button onClick={() => setShowDeleteModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                  <X size={20} />
                </button>
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "8px", padding: "1rem", marginBottom: "1.5rem" }}>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>Product: <strong>{selectedProduct.title}</strong></p>
                <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>Store: <strong>{selectedProduct.storeId?.name || "Unknown"}</strong></p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
                {/* Option 1: Soft Delete */}
                <button 
                  onClick={() => handleDeleteProductAdmin(selectedProduct._id, false)}
                  disabled={productsLoading}
                  style={{
                    display: "flex",
                    alignItems: "start",
                    gap: "0.75rem",
                    textAlign: "left",
                    background: "rgba(168, 85, 247, 0.05)",
                    border: "1px solid rgba(168, 85, 247, 0.2)",
                    borderRadius: "10px",
                    padding: "1rem",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  <Archive size={18} style={{ color: "#a855f7", marginTop: "2px" }} />
                  <div>
                    <strong style={{ display: "block", fontSize: "0.85rem", color: "var(--text-primary)" }}>Soft-Delete (Standard Maintenance)</strong>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.4, display: "block", marginTop: "0.2rem" }}>
                      Hides product from shopper catalog and vendor dashboard, but preserves database records for past orders and wallet ledgers.
                    </span>
                  </div>
                </button>

                {/* Option 2: Hard Delete */}
                <button 
                  onClick={() => handleDeleteProductAdmin(selectedProduct._id, true)}
                  disabled={productsLoading}
                  style={{
                    display: "flex",
                    alignItems: "start",
                    gap: "0.75rem",
                    textAlign: "left",
                    background: "rgba(239, 68, 68, 0.05)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                    borderRadius: "10px",
                    padding: "1rem",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  <AlertCircle size={18} style={{ color: "#ef4444", marginTop: "2px" }} />
                  <div>
                    <strong style={{ display: "block", fontSize: "0.85rem", color: "#ef4444" }}>Force/Hard-Delete (Guidelines Violation)</strong>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.4, display: "block", marginTop: "0.2rem" }}>
                      Completely drops item database record and cuts all relational bindings. Dispatches system audit logs for violation recording.
                    </span>
                  </div>
                </button>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button 
                  onClick={() => setShowDeleteModal(false)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-secondary)",
                    padding: "0.5rem 1rem",
                    borderRadius: "6px",
                    fontSize: "0.8rem",
                    cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Security & Audit Trail Tab ─────────────────────────────────────── */}
        {activeTab === "audit" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "1.5rem", alignItems: "start" }}>

            {/* Left: Live Audit Terminal */}
            <div className="glass-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", height: "680px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Terminal size={18} style={{ color: "#10b981" }} />
                  <span style={{ color: "#10b981" }}>Master Audit Terminal</span>
                </h3>
                <span style={{
                  background: "rgba(16,185,129,0.12)",
                  border: "1px solid rgba(16,185,129,0.3)",
                  color: "#10b981",
                  borderRadius: "8px",
                  padding: "3px 10px",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  fontFamily: "monospace",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", display: "inline-block", animation: "livePulse 1.5s ease infinite" }} />
                  LIVE
                </span>
              </div>

              {/* Terminal window */}
              <div
                ref={auditTerminalRef}
                id="audit-terminal-stream"
                style={{
                  flex: 1,
                  background: "#050a05",
                  border: "1px solid rgba(16,185,129,0.2)",
                  borderRadius: "10px",
                  padding: "12px",
                  overflowY: "auto",
                  fontFamily: "'Courier New', monospace",
                  fontSize: "0.72rem",
                  lineHeight: "1.7",
                }}
              >
                {auditStream.length === 0 ? (
                  <div style={{ color: "#10b981", opacity: 0.5, paddingTop: "12px" }}>
                    &gt; Waiting for platform events...<br />
                    &gt; Stream will populate automatically as operations are logged.
                  </div>
                ) : (
                  auditStream.map((entry, i) => {
                    const actionColor = entry.scope === "platform" ? "#ef4444"
                      : entry.action.includes("DELETE") ? "#f59e0b"
                      : entry.action.includes("BREACH") ? "#ef4444"
                      : entry.action.includes("LOGIN") ? "#a855f7"
                      : "#10b981";
                    const ts = new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false });
                    return (
                      <div key={i} style={{ marginBottom: "2px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ color: "#4a5568", flexShrink: 0 }}>[{ts}]</span>
                        <span style={{ color: entry.scope === "platform" ? "#ef4444" : "#6b6b85", flexShrink: 0, fontWeight: 700 }}>
                          [{entry.scope?.toUpperCase() || "STORE"}]
                        </span>
                        <span style={{ color: actionColor, fontWeight: 700, flexShrink: 0 }}>{entry.action}</span>
                        <span style={{ color: "#a9a9c0" }}>by <span style={{ color: "#f8f8ff" }}>{entry.userName}</span></span>
                        {entry.ipAddress && (
                          <span style={{ color: "#6b6b85" }}>({entry.ipAddress})</span>
                        )}
                        <span style={{ color: "#718096", wordBreak: "break-all" }}>— {entry.details}</span>
                      </div>
                    );
                  })
                )}
              </div>

              <div style={{ marginTop: "8px", fontSize: "0.7rem", color: "#4a5568", fontFamily: "monospace", display: "flex", justifyContent: "space-between" }}>
                <span>{auditStream.length} events loaded (max 200)</span>
                <span>Auto-scrolls on new events</span>
              </div>
            </div>

            {/* Right: Security Breach Alarm Desk */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className="glass-card" style={{ padding: "1.25rem" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <Shield size={18} style={{ color: "#ef4444" }} />
                  <span style={{ color: "#ef4444" }}>Security Breach Alarm Desk</span>
                </h3>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                  Real-time tenant isolation violation intercepts. Fired automatically when any actor attempts unauthorized cross-tenant data access.
                </p>

                {breachAlerts.length === 0 ? (
                  <div style={{
                    background: "rgba(16,185,129,0.06)",
                    border: "1px solid rgba(16,185,129,0.2)",
                    borderRadius: "10px",
                    padding: "24px",
                    textAlign: "center",
                    color: "#10b981",
                  }}>
                    <div style={{ fontSize: "1.8rem", marginBottom: "8px" }}>🛡️</div>
                    <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>All Clear — No Breach Attempts</div>
                    <div style={{ fontSize: "0.72rem", opacity: 0.7, marginTop: "4px" }}>Perimeter protection is active.</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxHeight: "580px", overflowY: "auto" }}>
                    {breachAlerts.map((breach, idx) => (
                      <SecurityBreachCard
                        key={idx}
                        breach={breach}
                        index={idx}
                        onDismiss={() => dismissBreach(idx)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Maintenance & Purging Tab ────────────────────────────────────── */}
        {activeTab === "maintenance" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: "1.5rem", alignItems: "start" }} className="animate-fade-up">
            {/* Left: Rolling Lifecycle Gate Selector & Controls */}
            <div className="glass-card" style={{ padding: "2rem" }}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-primary)" }}>
                <RefreshCw size={20} style={{ color: "#10b981" }} /> Rolling Lifecycle Retention Gates
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
                Select a legacy threshold gate to clear expired objects and reclaim database storage space.
              </p>

              <form onSubmit={handleExecutePurge} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                <div>
                  <label htmlFor="threshold-select" style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem" }}>
                    Select Retention Threshold:
                  </label>
                  <select
                    id="threshold-select"
                    value={purgeThreshold}
                    onChange={(e) => {
                      setPurgeThreshold(parseInt(e.target.value, 10));
                      setPurgeMessage(null);
                    }}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      borderRadius: "8px",
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-primary)",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                      cursor: "pointer"
                    }}
                  >
                    <option value={1}>Purge Data Older than 1 Month</option>
                    <option value={3}>Purge Data Older than 3 Months</option>
                    <option value={6}>Purge Data Older than 6 Months (Recommended)</option>
                    <option value={12}>Purge Data Older than 12 Months</option>
                  </select>
                </div>

                {/* Cascading Relational Wipe Info */}
                <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "8px", padding: "1rem" }}>
                  <h4 style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--text-primary)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Targeted Collections &amp; Relational Wipe rules:
                  </h4>
                  <ul style={{ paddingLeft: "1.2rem", margin: 0, fontSize: "0.78rem", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    <li>
                      <strong>Completed Ad Campaigns:</strong> Expired, terminated, or rejected promotions are deleted. Active campaigns are strictly retained.
                    </li>
                    <li>
                      <strong>Old Notification Logs:</strong> User inbox logs exceeding the month threshold are cleared.
                    </li>
                    <li>
                      <strong>Uncompleted Checkout Carts:</strong> Orders stuck in <code>pending_payment</code> are dropped.
                    </li>
                    <li>
                      <strong>System Audit Logs:</strong> Prunes platform-wide logging trails exceeding lifecycle gate.
                    </li>
                  </ul>
                </div>

                {/* Warning Banner */}
                <div style={{
                  background: "rgba(239, 68, 68, 0.05)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  borderRadius: "8px",
                  padding: "1rem",
                  color: "#ef4444"
                }}>
                  <div style={{ fontWeight: 800, fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem", textTransform: "uppercase" }}>
                    <AlertCircle size={16} /> Caution: destructive operation
                  </div>
                  <div style={{ fontSize: "0.75rem", lineHeight: 1.4, color: "var(--text-secondary)" }}>
                    Executing this cascading purge drops indexing overhead and flushes live server logs from replica sets. Operational GMV statistics, store wallets, and completed orders are safely retained.
                  </div>
                </div>

                {/* Confirmation Box */}
                <div>
                  <label htmlFor="confirm-input" style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>
                    To proceed, type <span style={{ color: "#ef4444", fontFamily: "monospace", fontSize: "0.85rem" }}>CONFIRM</span>:
                  </label>
                  <input
                    id="confirm-input"
                    type="text"
                    required
                    placeholder="Type CONFIRM"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      borderRadius: "8px",
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-primary)",
                      fontFamily: "monospace",
                      fontWeight: 800,
                      fontSize: "0.9rem"
                    }}
                  />
                </div>

                {purgeMessage && (
                  <div style={{
                    padding: "0.75rem 1rem",
                    borderRadius: "8px",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    lineHeight: 1.4,
                    background: purgeMessage.type === "success" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                    border: purgeMessage.type === "success" ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(239,68,68,0.3)",
                    color: purgeMessage.type === "success" ? "#10b981" : "#ef4444"
                  }}>
                    {purgeMessage.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={purgingLoading || confirmText !== "CONFIRM"}
                  style={{
                    width: "100%",
                    padding: "0.85rem",
                    borderRadius: "8px",
                    background: confirmText === "CONFIRM" ? "#ef4444" : "var(--border-subtle)",
                    color: confirmText === "CONFIRM" ? "#fff" : "var(--text-muted)",
                    border: "none",
                    fontSize: "0.9rem",
                    fontWeight: 800,
                    cursor: confirmText === "CONFIRM" ? "pointer" : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                    transition: "all 0.2s"
                  }}
                >
                  {purgingLoading ? (
                    <>
                      <Loader size={16} className="animate-spin" />
                      Optimizing &amp; Compacting live database...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      Execute Cascading Relational Wipe
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Right: Global Maintenance & Data Purging Ledger */}
            <div className="glass-card" style={{ padding: "2rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "1.2rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-primary)" }}>
                  <Terminal size={20} style={{ color: "#a855f7" }} /> Global Purging Ledger
                </h3>
                <button
                  onClick={() => {
                    const token = localStorage.getItem("bazaar_token");
                    if (token) fetchPurgeLedger(token);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#a855f7",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <RefreshCw size={12} /> Refresh Logs
                </button>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
                Permanent audit stream storing database compaction records, resource optimization details, and consolidated operational statistics.
              </p>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                      <th style={{ padding: "0.75rem 0.5rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem", fontWeight: 700 }}>Timestamp / Operator</th>
                      <th style={{ padding: "0.75rem 0.5rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem", fontWeight: 700 }}>Threshold</th>
                      <th style={{ padding: "0.75rem 0.5rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem", fontWeight: 700 }}>Documents Purged</th>
                      <th style={{ padding: "0.75rem 0.5rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem", fontWeight: 700 }}>Reclaimed Stats</th>
                      <th style={{ padding: "0.75rem 0.5rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.68rem", fontWeight: 700 }}>Index Optimization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purgeLedger.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No database maintenance cycles executed yet.
                        </td>
                      </tr>
                    ) : (
                      purgeLedger.map((log: any) => (
                        <tr key={log._id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "1rem 0.5rem" }}>
                            <div style={{ fontWeight: 700 }}>{new Date(log.timestamp).toLocaleString()}</div>
                            <div style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>Operator: {log.executedByName}</div>
                          </td>
                          <td style={{ padding: "1rem 0.5rem", fontWeight: 700 }}>
                            {log.thresholdMonths} months
                          </td>
                          <td style={{ padding: "1rem 0.5rem" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.74rem" }}>
                              <div>Ads Bids: <strong style={{ color: log.purgedCounts?.adBids > 0 ? "#f59e0b" : "inherit" }}>{log.purgedCounts?.adBids || 0}</strong></div>
                              <div>Notifications: <strong>{log.purgedCounts?.notifications || 0}</strong></div>
                              <div>Uncompleted Carts: <strong>{log.purgedCounts?.uncompletedCarts || 0}</strong></div>
                              <div>Audit Logs: <strong>{log.purgedCounts?.auditLogs || 0}</strong></div>
                            </div>
                          </td>
                          <td style={{ padding: "1rem 0.5rem" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.74rem" }}>
                              <div>Impressions: <strong>{(log.reclaimedStats?.totalAdImpressions || 0).toLocaleString()}</strong></div>
                              <div>Conversions: <strong>{(log.reclaimedStats?.totalAdConversions || 0).toLocaleString()}</strong></div>
                              <div>Spend Purged: <strong>Rs. {(log.reclaimedStats?.totalAdSpendPKR || 0).toLocaleString()}</strong></div>
                            </div>
                          </td>
                          <td style={{ padding: "1rem 0.5rem" }}>
                            {log.optimizedCollections?.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                {log.optimizedCollections.map((c: string) => (
                                  <span key={c} style={{
                                    fontSize: "0.6rem",
                                    background: "rgba(16,185,129,0.1)",
                                    border: "1px solid rgba(16,185,129,0.3)",
                                    color: "#10b981",
                                    borderRadius: "4px",
                                    padding: "1px 4px",
                                    textTransform: "uppercase",
                                    fontWeight: 700
                                  }}>
                                    {c}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>None</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Disputes Triage Tab ────────────────────────────────────────── */}
        {activeTab === "disputes" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "1.5rem", alignItems: "start" }} className="animate-fade-up">
            {/* Left: Complaints List */}
            <div className="glass-card" style={{ padding: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Shield size={18} style={{ color: "#ef4444" }} />
                <span>{user?.role === "admin" ? "Master Supreme Court Docket" : "Store Triage Docket"}</span>
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.82rem", marginBottom: "1.25rem" }}>
                {user?.role === "admin"
                  ? "Reviewing escalated store disputes, merchant representations, and complete communication logs."
                  : "Rule on active shopper support tickets, issue product suspensions, and local remediation plans."}
              </p>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Ticket Details</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Shopper</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Store Context</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700 }}>Status</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.7rem", fontWeight: 700, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complaintsLoading ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "2rem" }}>
                          <Loader size={24} style={{ animation: "spin 1s linear infinite", color: "#a855f7" }} />
                        </td>
                      </tr>
                    ) : complaints.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          {user?.role === "admin"
                            ? "No escalated disputes currently require Master Court override."
                            : "No active shopper disputes recorded against your store."}
                        </td>
                      </tr>
                    ) : (
                      complaints.map((c: any) => {
                        const statusColors: any = {
                          open: { bg: "rgba(168,85,247,0.1)", border: "rgba(168,85,247,0.3)", color: "#a855f7" },
                          under_review: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", color: "#3b82f6" },
                          resolved: { bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.3)", color: "#10b981" },
                          escalated: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", color: "#ef4444" }
                        };
                        const colors = statusColors[c.status] || statusColors.open;
                        const isSelected = selectedComplaint?._id === c._id;
                        return (
                          <tr key={c._id} style={{ borderBottom: "1px solid var(--border-subtle)", background: isSelected ? "rgba(255,255,255,0.02)" : "transparent" }}>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <p style={{ fontWeight: 700 }}>{c.category.toUpperCase()}</p>
                              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Filed: {new Date(c.createdAt).toLocaleDateString()}</p>
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <p style={{ fontWeight: 600 }}>{c.shopperId?.name || "Shopper"}</p>
                              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{c.shopperId?.email}</p>
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <p style={{ fontWeight: 600 }}>{c.storeId?.name || "Store"}</p>
                              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>/{c.storeId?.slug || ""}</p>
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <span style={{
                                fontSize: "0.72rem", fontWeight: 800, padding: "0.15rem 0.4rem", borderRadius: 4,
                                background: colors.bg, border: `1px solid ${colors.border}`, color: colors.color
                              }}>
                                {c.status.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                              <button
                                onClick={() => {
                                  setSelectedComplaint(c);
                                  setTriageMessage("");
                                  setTriageAction("resolve");
                                  setTargetShopperBlock(false);
                                  if (user?.role === "admin") {
                                    fetchChatLogs(c._id);
                                  }
                                }}
                                style={{
                                  padding: "0.35rem 0.75rem",
                                  borderRadius: "6px",
                                  background: isSelected ? "#ef4444" : "rgba(255,255,255,0.05)",
                                  border: isSelected ? "none" : "1px solid var(--border-subtle)",
                                  color: isSelected ? "white" : "var(--text-primary)",
                                  cursor: "pointer",
                                  fontSize: "0.75rem",
                                  fontWeight: 600
                                }}
                              >
                                Review
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

            {/* Right: Inspector & Ruling Panel */}
            <div className="glass-card" style={{ padding: "1.5rem" }}>
              {selectedComplaint ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "1rem", marginBottom: "1rem" }}>
                    <div>
                      <h4 style={{ fontWeight: 800, fontSize: "1rem", color: "var(--text-primary)" }}>
                        {user?.role === "admin" ? "Supreme Verdict Desk" : "Triage Ruling Panel"}
                      </h4>
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>Ticket ID: {selectedComplaint._id}</p>
                    </div>
                    <button
                      onClick={() => setSelectedComplaint(null)}
                      style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.9rem" }}
                    >
                      ✕ Close
                    </button>
                  </div>

                  {/* Claims & Claims description */}
                  <div style={{ marginBottom: "1rem" }}>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Shopper Dispute Statement</p>
                    <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "0.25rem", lineHeight: 1.5, background: "var(--bg-secondary)", padding: "0.75rem", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                      {selectedComplaint.description}
                    </p>
                  </div>

                  {/* Screenshot evidence */}
                  {selectedComplaint.evidenceUrl && (
                    <div style={{ marginBottom: "1rem" }}>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: "0.35rem" }}>Screenshot Evidence</p>
                      <div style={{ display: "flex", justifyContent: "center", background: "#000", borderRadius: "8px", overflow: "hidden", maxHeight: "150px" }}>
                        <img
                          src={`${API}${selectedComplaint.evidenceUrl}`}
                          alt="Evidence upload"
                          style={{ maxWidth: "100%", maxHeight: "150px", objectFit: "contain", cursor: "pointer" }}
                          onClick={() => window.open(`${API}${selectedComplaint.evidenceUrl}`, "_blank")}
                        />
                      </div>
                    </div>
                  )}

                  {/* Vendor Response section if available */}
                  {selectedComplaint.vendorResponse?.message && (
                    <div style={{ marginBottom: "1rem", background: "rgba(168,85,247,0.05)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 8, padding: "0.75rem" }}>
                      <p style={{ fontSize: "0.72rem", color: "#a855f7", textTransform: "uppercase", fontWeight: 700 }}>Vendor Counter-Offer</p>
                      <p style={{ fontSize: "0.8rem", color: "var(--text-primary)", marginTop: "0.2rem" }}>
                        &ldquo;{selectedComplaint.vendorResponse.message}&rdquo;
                      </p>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                        Remedy offered: <strong style={{ color: "#10b981" }}>{selectedComplaint.vendorResponse.remedyType}</strong>
                        {selectedComplaint.vendorResponse.couponCode && ` (Coupon: ${selectedComplaint.vendorResponse.couponCode})`}
                      </p>
                    </div>
                  )}

                  {/* Chat logs for SuperAdmin Supreme Court view */}
                  {user?.role === "admin" && (
                    <div style={{ marginBottom: "1.25rem" }}>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: "0.35rem" }}>Shopper-Merchant Communication Audit Logs</p>
                      {chatLoading ? (
                        <div style={{ display: "flex", justifyContent: "center", padding: "1rem" }}>
                          <Loader size={18} style={{ animation: "spin 1s linear infinite", color: "#ef4444" }} />
                        </div>
                      ) : chatLogs.length === 0 ? (
                        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic", background: "var(--bg-secondary)", padding: "0.5rem", borderRadius: 8 }}>
                          No negotiation chat logs recorded between shopper and vendor store owner.
                        </p>
                      ) : (
                        <div style={{ maxHeight: "150px", overflowY: "auto", background: "#08080f", padding: "0.5rem", borderRadius: 8, fontSize: "0.72rem", display: "flex", flexDirection: "column", gap: "0.4rem", border: "1px solid var(--border-subtle)" }}>
                          {chatLogs.map((msg, idx) => {
                            const isShopper = msg.senderId === selectedComplaint.shopperId._id;
                            return (
                              <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: isShopper ? "flex-start" : "flex-end" }}>
                                <span style={{ color: isShopper ? "#3b82f6" : "#a855f7", fontWeight: 700, fontSize: "0.65rem" }}>
                                  {isShopper ? "Shopper" : "Vendor Store"}
                                </span>
                                <div style={{
                                  background: isShopper ? "rgba(59,130,246,0.1)" : "rgba(168,85,247,0.1)",
                                  border: `1px solid ${isShopper ? "rgba(59,130,246,0.2)" : "rgba(168,85,247,0.2)"}`,
                                  borderRadius: "6px", padding: "0.3rem 0.5rem", maxWidth: "85%", color: "var(--text-secondary)", marginTop: "0.1rem"
                                }}>
                                  {msg.content}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Escalation log */}
                  <div style={{ marginBottom: "1.25rem" }}>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: "0.35rem" }}>Dispute Audit Trails</p>
                    <div style={{ maxHeight: "100px", overflowY: "auto", background: "var(--bg-secondary)", padding: "0.5rem", borderRadius: 8, fontSize: "0.72rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                      {selectedComplaint.escalationLog?.map((log: any, idx: number) => (
                        <div key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", paddingBottom: "0.2rem" }}>
                          <span style={{ color: "#ef4444", fontWeight: 700 }}>[{log.action}]</span> <span style={{ color: "var(--text-secondary)" }}>{log.message}</span>
                          <span style={{ color: "var(--text-muted)", fontStyle: "italic", marginLeft: "0.2rem" }}>({log.actorRole})</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rulings Section */}
                  {selectedComplaint.status !== "resolved" ? (
                    <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem" }}>
                      {user?.role === "storeAdmin" ? (
                        /* StoreAdmin view: local triage */
                        <div>
                          <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Local Triage ruling toolkit</p>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                            <div>
                              <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Triage Action</label>
                              <select
                                value={triageAction}
                                onChange={(e) => setTriageAction(e.target.value)}
                                style={{ width: "100%", padding: "0.5rem", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.8rem" }}
                              >
                                <option value="resolve">Mark Resolved (Execute Settlement)</option>
                                <option value="soft_delete">Force Catalog Product Soft-Deletion</option>
                                <option value="escalate">Escalate store dispute to Platform Master Court</option>
                              </select>
                            </div>

                            <div>
                              <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Verdict Statement</label>
                              <textarea
                                value={triageMessage}
                                onChange={(e) => setTriageMessage(e.target.value)}
                                placeholder="State the reason or details of this triage ruling..."
                                style={{ width: "100%", minHeight: 60, padding: "0.5rem", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.8rem" }}
                              />
                            </div>

                            <button
                              onClick={async () => {
                                if (!triageMessage.trim()) {
                                  alert("Please write a verdict statement");
                                  return;
                                }
                                setTriageSubmitting(true);
                                try {
                                  const token = localStorage.getItem("bazaar_token");
                                  const res = await fetch(`${API}/api/complaints/${selectedComplaint._id}/triage`, {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${token}`
                                    },
                                    body: JSON.stringify({ action: triageAction, message: triageMessage })
                                  });
                                  const data = await res.json();
                                  if (data.success) {
                                    alert("Triage decision applied successfully!");
                                    setSelectedComplaint(data.ticket);
                                    fetchData(token || "");
                                  } else {
                                    alert(data.message || "Failed to apply triage");
                                  }
                                } catch (err: any) {
                                  alert("Error: " + err.message);
                                } finally {
                                  setTriageSubmitting(false);
                                }
                              }}
                              disabled={triageSubmitting}
                              style={{ width: "100%", padding: "0.5rem", borderRadius: 8, background: "#10b981", border: "none", color: "white", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
                            >
                              {triageSubmitting ? "Applying Verdict..." : "Apply Triage Verdict"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* SuperAdmin Supreme Court view */
                        <div>
                          <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#ef4444", marginBottom: "0.5rem" }}>Supreme Court Override Controls</p>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                            <div>
                              <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Absolute Override Action</label>
                              <select
                                value={triageAction}
                                onChange={(e) => setTriageAction(e.target.value)}
                                style={{ width: "100%", padding: "0.5rem", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.8rem" }}
                              >
                                <option value="resolve">Resolve Dispute (Apply Final Settlement)</option>
                                <option value="suspend_fleet">Suspend Storefront Fleet (Deactivates store &amp; vendor)</option>
                                <option value="block_profile">Block Profile Permanently (Suspends merchant account)</option>
                              </select>
                            </div>

                            {triageAction === "block_profile" && (
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <input
                                  type="checkbox"
                                  id="shopper-block"
                                  checked={targetShopperBlock}
                                  onChange={(e) => setTargetShopperBlock(e.target.checked)}
                                />
                                <label htmlFor="shopper-block" style={{ fontSize: "0.75rem", fontWeight: 600 }}>Also block shopper profile permanently</label>
                              </div>
                            )}

                            <div>
                              <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Verdict Statement</label>
                              <textarea
                                value={triageMessage}
                                onChange={(e) => setTriageMessage(e.target.value)}
                                placeholder="State the legal override arguments and ruling results..."
                                style={{ width: "100%", minHeight: 60, padding: "0.5rem", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.8rem" }}
                              />
                            </div>

                            <button
                              onClick={async () => {
                                if (!triageMessage.trim()) {
                                  alert("Please state a verdict override message");
                                  return;
                                }
                                setGovernanceSubmitting(true);
                                try {
                                  const token = localStorage.getItem("bazaar_token");
                                  const res = await fetch(`${API}/api/complaints/${selectedComplaint._id}/governance`, {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${token}`
                                    },
                                    body: JSON.stringify({ action: triageAction, message: triageMessage, targetShopperBlock })
                                  });
                                  const data = await res.json();
                                  if (data.success) {
                                    alert("Supreme Verdict Overrides successfully applied!");
                                    setSelectedComplaint(data.ticket);
                                    fetchData(token || "");
                                  } else {
                                    alert(data.message || "Failed to apply Supreme ruling");
                                  }
                                } catch (err: any) {
                                  alert("Error: " + err.message);
                                } finally {
                                  setGovernanceSubmitting(false);
                                }
                              }}
                              disabled={governanceSubmitting}
                              style={{ width: "100%", padding: "0.5rem", borderRadius: 8, background: "#ef4444", border: "none", color: "white", fontSize: "0.8rem", fontWeight: 800, cursor: "pointer" }}
                            >
                              {governanceSubmitting ? "Executing Supreme Command..." : "Issue Supreme Ruling"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem", fontSize: "0.8rem" }}>
                      <p style={{ fontWeight: 800, color: "#10b981", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        ✓ Case Resolved / Absolute Settlement Complete
                      </p>
                      {selectedComplaint.adminDecision && (
                        <div style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 8, padding: "0.75rem", marginTop: "0.5rem" }}>
                          <p><strong>Verdict Type:</strong> {selectedComplaint.adminDecision.actionTaken}</p>
                          <p style={{ marginTop: "0.3rem", color: "var(--text-secondary)" }}><strong>Verdict Statement:</strong> &ldquo;{selectedComplaint.adminDecision.message}&rdquo;</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "300px", color: "var(--text-muted)", fontSize: "0.85rem", gap: "0.5rem" }}>
                  <Shield size={28} style={{ opacity: 0.3 }} />
                  Select a dispute docket from the list to review claim files.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SaaS Logistics & Broadcast Tab ──────────────────────────────── */}
        {activeTab === "logistics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }} className="animate-fade-up">

            {/* ── Global Platform Messaging & Notification Engine ──────────── */}
            <div className="glass-card" style={{
              padding: 0,
              overflow: "hidden",
              border: "1px solid rgba(124,58,237,0.2)",
              boxShadow: "0 0 40px rgba(124,58,237,0.08)",
            }}>
              {/* Gradient card header */}
              <div style={{
                background: "linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(109,40,217,0.08) 100%)",
                borderBottom: "1px solid rgba(124,58,237,0.2)",
                padding: "1.25rem 1.75rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                flexWrap: "wrap",
              }}>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
                    <span style={{ fontSize: "1.3rem" }}>📣</span>
                    Global Platform Messaging &amp; Notification Engine
                  </h3>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                    Target user segments, select delivery channels, and broadcast payloads to platform nodes via symmetric delivery channels.
                  </p>
                </div>
                <div style={{
                  fontSize: "0.7rem", fontWeight: 700, color: "#a855f7",
                  background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)",
                  borderRadius: "20px", padding: "0.25rem 0.75rem",
                  display: "flex", alignItems: "center", gap: "6px",
                }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#a855f7", display: "inline-block", boxShadow: "0 0 6px #a855f7", animation: "livePulse 1.5s ease infinite" }} />
                  BROADCAST ENGINE ONLINE
                </div>
              </div>

              <div style={{ padding: "1.5rem 1.75rem" }}>
                {broadcastSuccess && (
                  <div style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.25)", borderRadius: "8px", padding: "0.75rem 1rem", fontSize: "0.8rem", color: "#10b981", marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    ✓ {broadcastSuccess}
                  </div>
                )}
                {broadcastError && (
                  <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)", borderRadius: "8px", padding: "0.75rem 1rem", fontSize: "0.8rem", color: "#ef4444", marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    ✗ {broadcastError}
                  </div>
                )}

                <form onSubmit={handleBroadcastSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

                  {/* Row 1: Audience + Subject */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Target Audience Filter Pool
                      </label>
                      <select
                        value={broadcastForm.targetAudience}
                        onChange={e => setBroadcastForm(prev => ({ ...prev, targetAudience: e.target.value }))}
                        className="input-field"
                        style={{ width: "100%", height: "40px" }}
                      >
                        <option value="all_vendors">All Registered Platform Vendors</option>
                        <option value="delinquents">High Debt Matrix Delinquents (Phase 2 &amp; 3 Vendors)</option>
                        <option value="all_shoppers">All Active Consumer Profiles</option>
                        <option value="gold_loyalists">Gold Loyalists</option>
                      </select>
                      {/* Live audience size preview badge */}
                      <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 5px #10b981" }} />
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          {broadcastForm.targetAudience === "all_vendors"
                            ? "Targeting all registered vendor accounts"
                            : broadcastForm.targetAudience === "delinquents"
                              ? "Targeting Phase 2 + Phase 3 high-debt vendors"
                              : broadcastForm.targetAudience === "all_shoppers"
                                ? "Targeting all active consumer shopper profiles"
                                : "Targeting Gold Tier loyalty programme members"}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Broadcast Subject Headline
                      </label>
                      <input
                        type="text"
                        value={broadcastForm.subject}
                        onChange={e => setBroadcastForm(prev => ({ ...prev, subject: e.target.value }))}
                        placeholder="Enter broadcast subject header..."
                        className="input-field"
                        style={{ width: "100%", height: "40px" }}
                        required
                      />
                    </div>
                  </div>

                  {/* Row 2: Channel cards + Body */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "1.25rem" }}>

                    {/* Visual delivery channel card selector */}
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Communication Delivery Channel
                      </label>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {[
                          { value: "smtp", icon: "✉️", label: "SMTP External Mail Relay", sub: "NodeMailer / AWS SES", color: "#3b82f6" },
                          { value: "push", icon: "⚡", label: "In-App Live Push", sub: "Socket.io real-time", color: "#10b981" },
                          { value: "both", icon: "🔀", label: "Symmetric Multi-Channel", sub: "SMTP + Push concurrently", color: "#a855f7" },
                        ].map(ch => (
                          <div
                            key={ch.value}
                            onClick={() => setBroadcastForm(prev => ({ ...prev, deliveryChannel: ch.value }))}
                            style={{
                              display: "flex", alignItems: "center", gap: "10px",
                              padding: "0.6rem 0.85rem", borderRadius: "10px", cursor: "pointer",
                              transition: "all 0.2s",
                              background: broadcastForm.deliveryChannel === ch.value ? `${ch.color}12` : "rgba(255,255,255,0.02)",
                              border: broadcastForm.deliveryChannel === ch.value ? `1.5px solid ${ch.color}55` : "1px solid var(--border-subtle)",
                              boxShadow: broadcastForm.deliveryChannel === ch.value ? `0 0 18px ${ch.color}15` : "none",
                            }}
                          >
                            <span style={{ fontSize: "15px" }}>{ch.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: broadcastForm.deliveryChannel === ch.value ? ch.color : "var(--text-primary)" }}>
                                {ch.label}
                              </div>
                              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{ch.sub}</div>
                            </div>
                            <div style={{
                              width: "14px", height: "14px", borderRadius: "50%",
                              border: `2px solid ${broadcastForm.deliveryChannel === ch.value ? ch.color : "rgba(255,255,255,0.15)"}`,
                              background: broadcastForm.deliveryChannel === ch.value ? ch.color : "transparent",
                              transition: "all 0.2s",
                              flexShrink: 0,
                            }} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Body + submit */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      <div>
                        <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Broadcast Body Payload <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(Markdown Supported)</span>
                        </label>
                        <textarea
                          value={broadcastForm.body}
                          onChange={e => setBroadcastForm(prev => ({ ...prev, body: e.target.value }))}
                          placeholder="Compose broadcast markdown body payload..."
                          className="input-field font-mono"
                          style={{ width: "100%", height: "110px", resize: "none", fontSize: "0.8rem", padding: "0.65rem" }}
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={broadcasting}
                        style={{
                          height: "40px",
                          background: broadcasting ? "rgba(124,58,237,0.3)" : "linear-gradient(135deg, #7c3aed, #6d28d9)",
                          border: "none", borderRadius: "10px", color: "#fff", fontWeight: 700,
                          fontSize: "0.85rem", cursor: broadcasting ? "not-allowed" : "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                          transition: "all 0.2s",
                          boxShadow: broadcasting ? "none" : "0 4px 20px rgba(124,58,237,0.35)",
                        }}
                      >
                        {broadcasting ? (
                          <><Loader size={14} className="animate-spin" /><span>Queuing Broadcast Task...</span></>
                        ) : (
                          <span>🚀 Deploy Broadcast Stream</span>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {/* ── Broadcast Job History Sub-Panel ─────────────────────────── */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "1rem 1.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Recent Broadcast Jobs Ledger
                  </span>
                  <button
                    onClick={fetchBroadcastHistory}
                    style={{ background: "none", border: "none", color: "#a855f7", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    <RefreshCw size={11} className={broadcastHistoryLoading ? "animate-spin" : ""} /> Refresh
                  </button>
                </div>

                {broadcastHistoryLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {[1, 2, 3].map(i => (
                      <div key={i} className="animate-pulse" style={{ height: "32px", background: "rgba(255,255,255,0.02)", borderRadius: "6px" }} />
                    ))}
                  </div>
                ) : broadcastHistory.length === 0 ? (
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontStyle: "italic", padding: "0.5rem 0" }}>
                    No broadcast jobs dispatched yet.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                      <thead>
                        <tr style={{ color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <th style={{ padding: "0.4rem 0.6rem" }}>Subject</th>
                          <th style={{ padding: "0.4rem 0.6rem" }}>Target</th>
                          <th style={{ padding: "0.4rem 0.6rem" }}>Channel</th>
                          <th style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>Status</th>
                          <th style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {broadcastHistory.slice(0, 5).map((job: any) => {
                          const statusMap: Record<string, { label: string; color: string; bg: string }> = {
                            QUEUED:     { label: "QUEUED",     color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
                            PROCESSING: { label: "PROCESSING", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
                            COMPLETED:  { label: "COMPLETED",  color: "#10b981", bg: "rgba(16,185,129,0.12)" },
                            FAILED:     { label: "FAILED",     color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
                          };
                          const s = statusMap[job.status] || { label: job.status, color: "#a9a9c0", bg: "rgba(255,255,255,0.05)" };
                          return (
                            <tr key={job._id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                              <td style={{ padding: "0.5rem 0.6rem", fontWeight: 600, color: "var(--text-primary)", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {job.subject || "—"}
                              </td>
                              <td style={{ padding: "0.5rem 0.6rem", color: "var(--text-secondary)", fontFamily: "monospace", fontSize: "0.73rem" }}>
                                {job.targetAudience}
                              </td>
                              <td style={{ padding: "0.5rem 0.6rem", color: "var(--text-muted)" }}>
                                {job.deliveryChannel === "both" ? "Multi" : job.deliveryChannel?.toUpperCase()}
                              </td>
                              <td style={{ padding: "0.5rem 0.6rem", textAlign: "right" }}>
                                <span style={{ background: s.bg, color: s.color, padding: "0.12rem 0.45rem", borderRadius: "5px", fontWeight: 700, fontSize: "10px" }}>
                                  {s.label}
                                </span>
                              </td>
                              <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                                {new Date(job.createdAt).toLocaleDateString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* ── Dark Hub Consolidation Pipelines Tracker ─────────────────── */}
            <div className="glass-card" style={{ padding: "1.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
                    <span>📦</span> Dark Hub Consolidation Pipelines
                  </h3>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                    Centralized multi-vendor customer package consolidation routing depot — live 4-state fulfillment streaming.
                  </p>
                </div>
                <button
                  onClick={fetchLogisticsData}
                  style={{ background: "none", border: "none", color: "#a855f7", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                >
                  <RefreshCw size={12} className={logisticsLoading ? "animate-spin" : ""} /> Sync Depot
                </button>
              </div>

              {logisticsLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[1, 2, 3, 4].map(idx => (
                    <div key={idx} className="animate-pulse" style={{ height: "52px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid var(--border-subtle)" }} />
                  ))}
                </div>
              ) : logisticsPipelines.length === 0 ? (
                <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  No packages currently flowing through Dark Hub consolidation depot.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left", color: "var(--text-muted)", fontSize: "0.71rem", textTransform: "uppercase" }}>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Package Tracking ID</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Originating Merchant</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Items</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Hub Destination</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Fulfillment State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logisticsPipelines.map((p: any) => {
                        // 4-State fulfillment chip config
                        const stateMap: Record<string, { label: string; color: string; bg: string; dot: string }> = {
                          RECEIVING:       { label: "RECEIVING",        color: "#a855f7", bg: "rgba(168,85,247,0.12)", dot: "#a855f7" },
                          CONSOLIDATING:   { label: "CONSOLIDATING",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  dot: "#f59e0b" },
                          DISPATCHED_TO_HUB: { label: "DISPATCHED",    color: "#3b82f6", bg: "rgba(59,130,246,0.12)",  dot: "#3b82f6" },
                          DELIVERED:       { label: "DELIVERED",        color: "#10b981", bg: "rgba(16,185,129,0.12)", dot: "#10b981" },
                        };
                        const state = stateMap[p.fulfillmentState] || { label: p.fulfillmentState, color: "#a9a9c0", bg: "rgba(255,255,255,0.05)", dot: "#a9a9c0" };
                        return (
                          <tr key={p.trackingId} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.2s" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                          >
                            <td style={{ padding: "0.75rem", fontFamily: "monospace", fontWeight: 800 }}>
                              <span style={{
                                background: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(109,40,217,0.18))",
                                color: "#c084fc", border: "1px solid rgba(168,85,247,0.3)",
                                borderRadius: "6px", padding: "0.15rem 0.5rem", fontSize: "0.78rem",
                              }}>
                                {p.trackingId}
                              </span>
                            </td>
                            <td style={{ padding: "0.75rem", fontWeight: 600 }}>
                              <div>{p.storeName}</div>
                            </td>
                            <td style={{ padding: "0.75rem" }}>
                              <div style={{ fontWeight: 700 }}>{p.itemCount} Units</div>
                              {p.itemSummary && (
                                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "2px" }}>{p.itemSummary}</div>
                              )}
                            </td>
                            <td style={{ padding: "0.75rem" }}>
                              📍 {p.destinationCity}
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              <span style={{
                                background: state.bg, color: state.color,
                                padding: "0.2rem 0.5rem", borderRadius: "6px",
                                fontWeight: 800, fontSize: "10px",
                                display: "inline-flex", alignItems: "center", gap: "5px",
                              }}>
                                <span style={{
                                  width: "5px", height: "5px", borderRadius: "50%",
                                  background: state.dot, display: "inline-block",
                                  animation: p.fulfillmentState === "CONSOLIDATING" || p.fulfillmentState === "DISPATCHED_TO_HUB" ? "livePulse 1.2s ease infinite" : "none",
                                }} />
                                {state.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Inventory Cross-Docking & Distribution Forecasts ─────────── */}
            <div className="glass-card" style={{ padding: "1.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
                    <span>📈</span> Regional Demand Forecasts &amp; Cross-Docking
                  </h3>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                    Identify high-velocity regions by category (rolling 30d orders) and dispatch stock optimization alerts.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    onClick={fetchForecastData}
                    disabled={forecastLoading}
                    style={{ background: "none", border: "none", color: "#a855f7", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    <RefreshCw size={12} className={forecastLoading ? "animate-spin" : ""} /> Sync Data
                  </button>
                  <button
                    onClick={runForecastSweep}
                    disabled={forecastSweeping}
                    style={{
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      padding: "0.4rem 0.8rem",
                      fontSize: "0.76rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px"
                    }}
                  >
                    {forecastSweeping ? <Loader size={12} className="animate-spin" /> : "⚡"} Run Forecast Sweep
                  </button>
                </div>
              </div>

              {forecastSweepResult && (
                <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: "8px", padding: "0.75rem 1rem", fontSize: "0.8rem", color: "#10b981", marginBottom: "1.25rem" }}>
                  <strong>✓ Forecast Sweep Completed:</strong> Stock optimization checklists dispatched to <strong>{forecastSweepResult.notificationsDispatched}</strong> qualifying vendor stores.
                </div>
              )}

              {forecastLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[1, 2, 3].map(idx => (
                    <div key={idx} className="animate-pulse" style={{ height: "48px", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }} />
                  ))}
                </div>
              ) : demandMatrix.length === 0 ? (
                <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  No regional demand statistics compiled. Place some orders to generate forecast data.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left", color: "var(--text-muted)", fontSize: "0.71rem", textTransform: "uppercase" }}>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Target Hub City</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Category Vector</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>Orders Count</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>Qty Dispatched</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Rolling Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {demandMatrix.slice(0, 10).map((peak: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                          <td style={{ padding: "0.75rem", fontWeight: 700, color: "var(--text-primary)" }}>
                            📍 {peak.city}
                          </td>
                          <td style={{ padding: "0.75rem" }}>
                            <span style={{
                              background: "rgba(59,130,246,0.12)",
                              color: "#60a5fa",
                              borderRadius: "4px",
                              padding: "0.15rem 0.4rem",
                              fontSize: "0.72rem",
                              fontWeight: 700
                            }}>
                              {peak.category}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "center" }}>{peak.orderCount}</td>
                          <td style={{ padding: "0.75rem", textAlign: "center", fontWeight: 700, color: "#f59e0b" }}>{peak.totalQuantity} units</td>
                          <td style={{ padding: "0.75rem", textAlign: "right", color: "#10b981", fontWeight: 750 }}>
                            Rs. {peak.totalRevenue?.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Computer Vision Dispute Arbitrator Room ──────────────────── */}
            <div className="glass-card" style={{ padding: "1.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
                    🤖 Automated Dispute Arbitrator Room
                  </h3>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                    Real-time Computer Vision (CV) model validation of returned parcel conditions — dense terminal audit view.
                  </p>
                </div>
                <button
                  onClick={fetchCvDisputes}
                  style={{ background: "none", border: "none", color: "#ef4444", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                >
                  <RefreshCw size={12} className={cvDisputesLoading ? "animate-spin" : ""} /> Sync Models
                </button>
              </div>

              {cvDisputesLoading ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
                  {[1, 2, 3].map(idx => (
                    <div key={idx} className="animate-pulse" style={{ height: "130px", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }} />
                  ))}
                </div>
              ) : cvDisputes.length === 0 ? (
                <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  No claim tickets scanned by CV models currently.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: "1rem" }}>
                  {cvDisputes.map((d: any) => {
                    const confidenceNum = parseFloat(String(d.confidence).replace("%", "")) || 0;
                    const isResolved = d.status === "resolved";
                    const confidenceColor = confidenceNum >= 85 ? "#10b981" : confidenceNum >= 60 ? "#f59e0b" : "#ef4444";
                    return (
                      <div
                        key={d.claimId}
                        style={{
                          background: "rgba(6,4,12,0.85)",
                          border: `1px solid ${isResolved ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                          borderRadius: "10px",
                          padding: "1rem",
                          fontFamily: "'Fira Code', 'Cascadia Code', 'Courier New', monospace",
                          fontSize: "0.75rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.6rem",
                          transition: "border-color 0.2s",
                        }}
                      >
                        {/* Claim ID row */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{
                            fontWeight: 900, color: "#ef4444",
                            textShadow: "0 0 10px rgba(239,68,68,0.4)",
                            fontSize: "0.8rem",
                          }}>
                            {d.claimId}
                          </span>
                          <span style={{
                            fontWeight: 900, fontSize: "0.88rem",
                            color: confidenceColor,
                            textShadow: `0 0 10px ${confidenceColor}60`,
                          }}>
                            {d.confidence}
                          </span>
                        </div>

                        {/* Confidence gauge bar */}
                        <div>
                          <div style={{ fontSize: "0.66rem", color: "#5d5d7a", marginBottom: "3px" }}>
                            CV CONFIDENCE SCORE
                          </div>
                          <div style={{ width: "100%", height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
                            <div style={{
                              width: `${Math.min(confidenceNum, 100)}%`,
                              height: "100%",
                              background: `linear-gradient(90deg, ${confidenceColor}99, ${confidenceColor})`,
                              borderRadius: "2px",
                              transition: "width 0.6s ease",
                              boxShadow: `0 0 8px ${confidenceColor}60`,
                            }} />
                          </div>
                        </div>

                        {/* Detail rows */}
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                          <div>
                            <span style={{ color: "#5d5d7a" }}>MERCHANT:  </span>
                            <span style={{ color: "#c8c8e8", fontWeight: 600 }}>{d.storeName}</span>
                          </div>
                          <div>
                            <span style={{ color: "#5d5d7a" }}>SCAN_RESULT: </span>
                            <span style={{ color: "#fbbf24", fontWeight: 700 }}>{d.reason}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ color: "#5d5d7a" }}>VERDICT:   </span>
                            <span style={{
                              fontWeight: 800, fontSize: "10px",
                              padding: "0.1rem 0.4rem", borderRadius: "4px",
                              background: isResolved ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                              color: isResolved ? "#10b981" : "#f59e0b",
                              border: `1px solid ${isResolved ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`,
                            }}>
                              {isResolved ? "DECISION SETTLED" : "AWAITING AUDIT"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {activeTab === "fintech" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }} className="animate-fade-up">
            
            {/* ── Take-Rate Rules Manager Card ─────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1.5rem", alignItems: "start" }}>
              
              {/* Left Panel: Take Rate Rules Table */}
              <div className="glass-card" style={{ padding: "1.5rem" }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>💸</span> Algorithmic Take-Rate Rules Manager
                </h3>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>
                  Platform commission defaults to 5%. Below rules override commission dynamically at checkout. Evaluated in order of descending priority.
                </p>

                {rulesLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {[1, 2, 3].map(i => (
                      <div key={i} className="animate-pulse" style={{ height: "48px", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }} />
                    ))}
                  </div>
                ) : takeRateRules.length === 0 ? (
                  <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem", border: "1px dashed var(--border-subtle)", borderRadius: "8px" }}>
                    No dynamic take-rate rules configured. Defaulting to standard 5% flat commission.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left", color: "var(--text-muted)", fontSize: "0.71rem", textTransform: "uppercase" }}>
                          <th style={{ padding: "0.6rem 0.75rem" }}>Rule Name</th>
                          <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>Priority</th>
                          <th style={{ padding: "0.6rem 0.75rem" }}>Conditions Summary</th>
                          <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>Commission</th>
                          <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>Status</th>
                          <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {takeRateRules.map((rule: any) => {
                          const hasLowerRate = rule.takeRatePercent < 5;
                          const rateBadgeBg = hasLowerRate ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)";
                          const rateBadgeColor = hasLowerRate ? "#10b981" : "#f59e0b";
                          const rateBadgeBorder = hasLowerRate ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)";

                          // Format conditions summary string
                          const cond = rule.conditions || {};
                          const summaryParts = [];
                          if (cond.salesVolumeTierMin !== null) summaryParts.push(`Vol ≥ ${cond.salesVolumeTierMin}`);
                          if (cond.salesVolumeTierMax !== null) summaryParts.push(`Vol ≤ ${cond.salesVolumeTierMax}`);
                          if (cond.categoryMatch) summaryParts.push(`Cat: "${cond.categoryMatch}"`);
                          if (cond.creditScoreMin !== null) summaryParts.push(`Credit ≥ ${cond.creditScoreMin}`);
                          if (cond.creditScoreMax !== null) summaryParts.push(`Credit ≤ ${cond.creditScoreMax}`);
                          if (cond.debtZones && cond.debtZones.length > 0) summaryParts.push(`Zones: ${cond.debtZones.join(', ')}`);

                          const conditionsText = summaryParts.length > 0 ? summaryParts.join(' | ') : "None (Universal)";

                          return (
                            <tr key={rule._id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                              <td style={{ padding: "0.75rem", fontWeight: 700 }}>
                                <div>{rule.ruleName}</div>
                                {rule.description && <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 400 }}>{rule.description}</div>}
                              </td>
                              <td style={{ padding: "0.75rem", textAlign: "center", fontFamily: "monospace", fontWeight: 700 }}>{rule.priority}</td>
                              <td style={{ padding: "0.75rem", color: "var(--text-secondary)", fontSize: "0.76rem" }}>{conditionsText}</td>
                              <td style={{ padding: "0.75rem", textAlign: "center" }}>
                                <span style={{
                                  background: rateBadgeBg,
                                  color: rateBadgeColor,
                                  border: `1px solid ${rateBadgeBorder}`,
                                  borderRadius: "4px",
                                  padding: "0.2rem 0.5rem",
                                  fontWeight: 800,
                                  fontSize: "0.8rem"
                                }}>
                                  {rule.takeRatePercent}%
                                </span>
                              </td>
                              <td style={{ padding: "0.75rem", textAlign: "center" }}>
                                <button
                                  onClick={() => handleToggleRuleActive(rule._id, rule.isActive)}
                                  style={{
                                    background: rule.isActive ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                                    border: `1px solid ${rule.isActive ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.15)"}`,
                                    color: rule.isActive ? "#10b981" : "var(--text-muted)",
                                    borderRadius: "15px",
                                    padding: "0.15rem 0.6rem",
                                    fontSize: "0.7rem",
                                    fontWeight: 700,
                                    cursor: "pointer"
                                  }}
                                >
                                  {rule.isActive ? "● Active" : "○ Inactive"}
                                </button>
                              </td>
                              <td style={{ padding: "0.75rem", textAlign: "right" }}>
                                <button
                                  onClick={() => handleDeleteRule(rule._id)}
                                  style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: "4px" }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Right Panel: Add Rule Form */}
              <div className="glass-card" style={{ padding: "1.5rem" }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>➕</span> Add Take-Rate Flex Rule
                </h3>
                <form onSubmit={handleCreateRule} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                  <div>
                    <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem", textTransform: "uppercase" }}>
                      Rule Name
                    </label>
                    <input
                      type="text"
                      value={ruleForm.ruleName}
                      onChange={e => setRuleForm(prev => ({ ...prev, ruleName: e.target.value }))}
                      placeholder="e.g. Bronze Tier Tech Discount"
                      className="input-field"
                      style={{ width: "100%", height: "36px" }}
                      required
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem", textTransform: "uppercase" }}>
                        Priority (1-100)
                      </label>
                      <input
                        type="number"
                        value={ruleForm.priority}
                        onChange={e => setRuleForm(prev => ({ ...prev, priority: Number(e.target.value) }))}
                        className="input-field"
                        style={{ width: "100%", height: "36px" }}
                        min="1"
                        max="100"
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem", textTransform: "uppercase" }}>
                        Take-Rate Percent
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={ruleForm.takeRatePercent}
                        onChange={e => setRuleForm(prev => ({ ...prev, takeRatePercent: Number(e.target.value) }))}
                        className="input-field"
                        style={{ width: "100%", height: "36px" }}
                        min="0"
                        max="50"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem", textTransform: "uppercase" }}>
                      Description
                    </label>
                    <input
                      type="text"
                      value={ruleForm.description}
                      onChange={e => setRuleForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Summary of this rule's conditions or target"
                      className="input-field"
                      style={{ width: "100%", height: "36px" }}
                    />
                  </div>

                  <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.5rem", marginTop: "0.25rem" }}>
                    <div style={{ fontSize: "0.76rem", fontWeight: 800, color: "#a855f7", marginBottom: "0.5rem", textTransform: "uppercase" }}>
                      Rule Conditions (Optional)
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                        <div>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)" }}>Sales Volume Min (PKR)</span>
                          <input
                            type="number"
                            value={ruleForm.salesVolumeTierMin}
                            onChange={e => setRuleForm(prev => ({ ...prev, salesVolumeTierMin: e.target.value }))}
                            placeholder="No limit"
                            className="input-field"
                            style={{ width: "100%", height: "30px", fontSize: "0.75rem" }}
                          />
                        </div>
                        <div>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)" }}>Sales Volume Max (PKR)</span>
                          <input
                            type="number"
                            value={ruleForm.salesVolumeTierMax}
                            onChange={e => setRuleForm(prev => ({ ...prev, salesVolumeTierMax: e.target.value }))}
                            placeholder="No limit"
                            className="input-field"
                            style={{ width: "100%", height: "30px", fontSize: "0.75rem" }}
                          />
                        </div>
                      </div>

                      <div>
                        <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)" }}>Category Regex Pattern Match</span>
                        <input
                          type="text"
                          value={ruleForm.categoryMatch}
                          onChange={e => setRuleForm(prev => ({ ...prev, categoryMatch: e.target.value }))}
                          placeholder="e.g. electronics or fashion"
                          className="input-field"
                          style={{ width: "100%", height: "30px", fontSize: "0.75rem" }}
                        />
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                        <div>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)" }}>Min Credit Score Override</span>
                          <input
                            type="number"
                            value={ruleForm.creditScoreMin}
                            onChange={e => setRuleForm(prev => ({ ...prev, creditScoreMin: e.target.value }))}
                            placeholder="Any"
                            className="input-field"
                            style={{ width: "100%", height: "30px", fontSize: "0.75rem" }}
                          />
                        </div>
                        <div>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)" }}>Max Credit Score Override</span>
                          <input
                            type="number"
                            value={ruleForm.creditScoreMax}
                            onChange={e => setRuleForm(prev => ({ ...prev, creditScoreMax: e.target.value }))}
                            placeholder="Any"
                            className="input-field"
                            style={{ width: "100%", height: "30px", fontSize: "0.75rem" }}
                          />
                        </div>
                      </div>

                      <div>
                        <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>Debt Zone Matches</span>
                        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                          {['active', 'orange', 'amber', 'red'].map(z => {
                            const selected = ruleForm.debtZones.includes(z);
                            return (
                              <button
                                key={z}
                                type="button"
                                onClick={() => {
                                  if (selected) {
                                    setRuleForm(prev => ({ ...prev, debtZones: prev.debtZones.filter(dz => dz !== z) }));
                                  } else {
                                    setRuleForm(prev => ({ ...prev, debtZones: [...prev.debtZones, z] }));
                                  }
                                }}
                                style={{
                                  padding: "0.2rem 0.5rem",
                                  borderRadius: "4px",
                                  fontSize: "0.68rem",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  background: selected ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.02)",
                                  border: `1.5px solid ${selected ? "#a855f7" : "var(--border-subtle)"}`,
                                  color: selected ? "#c084fc" : "var(--text-muted)"
                                }}
                              >
                                {z.toUpperCase()}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submittingRule}
                    style={{
                      height: "36px",
                      background: submittingRule ? "rgba(16,185,129,0.3)" : "linear-gradient(135deg, #10b981, #059669)",
                      border: "none",
                      borderRadius: "8px",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "0.82rem",
                      cursor: submittingRule ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      marginTop: "0.5rem"
                    }}
                  >
                    {submittingRule ? <Loader size={14} className="animate-spin" /> : "Deploy Dynamic Take-Rate Rule"}
                  </button>
                </form>
              </div>

            </div>

            {/* ── Automated Fraud & Delinquency Shopper Registry ───────────── */}
            <div className="glass-card" style={{ padding: "1.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
                    <span>🛡️</span> Automated Fraud &amp; Delinquency Shopper Registry
                  </h3>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                    Consumers with rolling 30d cancellation rate &ge; 50% or refusal records have Cash on Delivery blocked. Requires a 25% wallet down-payment.
                  </p>
                </div>
                <button
                  onClick={fetchFraudShoppers}
                  style={{ background: "none", border: "none", color: "#10b981", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                >
                  <RefreshCw size={12} className={fraudLoading ? "animate-spin" : ""} /> Refresh Registry
                </button>
              </div>

              {fraudLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[1, 2, 3, 4].map(idx => (
                    <div key={idx} className="animate-pulse" style={{ height: "50px", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }} />
                  ))}
                </div>
              ) : fraudShoppers.length === 0 ? (
                <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  No shoppers found in registry.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left", color: "var(--text-muted)", fontSize: "0.71rem", textTransform: "uppercase" }}>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Shopper Account</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>Orders Stats</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>30d Cancellation Rate</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>Wallet Balance</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>Risk Status</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "center" }}>COD Status</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fraudShoppers.map((shopper: any) => {
                        const isHighRisk = shopper.fraudRiskLevel === 'HIGH';
                        const ratePercent = Math.round(shopper.cancellationRate * 100);

                        return (
                          <tr key={shopper.shopperId} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                            <td style={{ padding: "0.75rem" }}>
                              <div style={{ fontWeight: 700 }}>{shopper.name}</div>
                              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{shopper.email}</div>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "center" }}>
                              <div>{shopper.totalOrders} total</div>
                              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{shopper.cancelledOrders} cancelled</div>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "center" }}>
                              <span style={{
                                color: ratePercent >= 50 ? "#ef4444" : ratePercent >= 30 ? "#f59e0b" : "var(--text-secondary)",
                                fontWeight: 800
                              }}>
                                {ratePercent}%
                              </span>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "center", fontWeight: 700 }}>
                              Rs. {shopper.walletBalance?.toLocaleString()}
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "center" }}>
                              <span style={{
                                padding: "0.15rem 0.45rem", borderRadius: "5px", fontSize: "10px", fontWeight: 800,
                                background: isHighRisk ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.12)",
                                color: isHighRisk ? "#ef4444" : "#10b981",
                                border: `1px solid ${isHighRisk ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`
                              }}>
                                {shopper.fraudRiskLevel}
                              </span>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "center" }}>
                              <span style={{
                                padding: "0.15rem 0.45rem", borderRadius: "5px", fontSize: "10px", fontWeight: 800,
                                background: shopper.codDisabled ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.12)",
                                color: shopper.codDisabled ? "#ef4444" : "#10b981",
                                border: `1px solid ${shopper.codDisabled ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`
                              }}>
                                {shopper.codDisabled ? "DISABLED" : "ENABLED"}
                              </span>
                            </td>
                            <td style={{ padding: "0.75rem", textAlign: "right" }}>
                              {isHighRisk && (
                                <button
                                  onClick={() => handleResetFraud(shopper.shopperId)}
                                  disabled={resettingFraudId === shopper.shopperId}
                                  style={{
                                    background: "#10b981",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: "6px",
                                    padding: "0.35rem 0.7rem",
                                    fontSize: "0.72rem",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    opacity: resettingFraudId === shopper.shopperId ? 0.6 : 1
                                  }}
                                >
                                  {resettingFraudId === shopper.shopperId ? "Resetting..." : "Reset Risk & COD"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}



        {/* Slide-out Governance Drawer */}
        {drawerOpen && selectedStoreForDrawer && (
          <div 
            style={{ 
              position: "fixed", 
              inset: 0, 
              background: "rgba(0,0,0,0.6)", 
              backdropFilter: "blur(4px)", 
              zIndex: 9999, 
              display: "flex", 
              justifyContent: "flex-end" 
            }}
            onClick={() => setDrawerOpen(false)}
          >
            <div 
              className="glass-card animate-fade-left"
              style={{ 
                width: "100%", 
                maxWidth: "520px", 
                height: "100vh", 
                background: "rgba(10,10,14,0.95)", 
                borderLeft: "1px solid var(--border-subtle)", 
                padding: "2rem 1.5rem", 
                overflowY: "auto", 
                display: "flex", 
                flexDirection: "column",
                gap: "1.5rem",
                boxShadow: "-10px 0 30px rgba(0,0,0,0.5)"
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "1rem" }}>
                <div>
                  <h2 style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-primary)" }}>{selectedStoreForDrawer.name}</h2>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    Owner: <strong style={{ color: "var(--text-secondary)" }}>{selectedStoreForDrawer.vendorId?.name || "N/A"}</strong> ({selectedStoreForDrawer.vendorId?.email || ""})
                  </p>
                </div>
                <button 
                  onClick={() => setDrawerOpen(false)} 
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-subtle)", borderRadius: "50%", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", cursor: "pointer" }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Status Block */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Governance Status</h3>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Current Balance</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#10b981" }}>
                      Rs. {(selectedStoreForDrawer.wallet?.balancePKR || 0).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Outstanding Commission</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#ef4444" }}>
                      Rs. {(selectedStoreForDrawer.wallet?.outstandingCommission || 0).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>Store Visibility: </span>
                    {selectedStoreForDrawer.productVisibilityLimited ? (
                      <span className="badge badge-error" style={{ fontSize: "0.68rem", fontWeight: 800, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: "4px", padding: "0.1rem 0.3rem" }}>Limited</span>
                    ) : (
                      <span className="badge badge-success" style={{ fontSize: "0.68rem", fontWeight: 800, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", borderRadius: "4px", padding: "0.1rem 0.3rem" }}>Active</span>
                    )}
                  </div>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>Activation Status: </span>
                    {selectedStoreForDrawer.isActive ? (
                      <span className="badge badge-success" style={{ fontSize: "0.68rem", fontWeight: 800, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", borderRadius: "4px", padding: "0.1rem 0.3rem" }}>Active</span>
                    ) : (
                      <span className="badge badge-error" style={{ fontSize: "0.68rem", fontWeight: 900, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444", borderRadius: "4px", padding: "0.1rem 0.3rem" }}>Suspended</span>
                    )}
                  </div>
                </div>

                {/* Escalation Phase Banner */}
                {(() => {
                  const comm = selectedStoreForDrawer.wallet?.outstandingCommission || 0;
                  const debtPercent = (comm / 25000) * 100;
                  let label = "PHASE 0: Normal Standings";
                  let bannerStyle = { background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981" };
                  
                  if (debtPercent >= 100) {
                    label = "PHASE 3: Suspended & Locked (Exceeds PKR 25,000)";
                    bannerStyle = { background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444" };
                  } else if (debtPercent >= 90) {
                    label = "PHASE 2: Ad-Placements Frozen (Exceeds PKR 22,500)";
                    bannerStyle = { background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)", color: "#fbbf24" };
                  } else if (debtPercent >= 70) {
                    label = "PHASE 1: Alert Active (Exceeds PKR 17,500)";
                    bannerStyle = { background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.4)", color: "#f97316" };
                  }

                  return (
                    <div style={{ ...bannerStyle, borderRadius: "8px", padding: "0.6rem 0.8rem", fontSize: "0.8rem", fontWeight: 800, textAlign: "center", marginTop: "0.25rem" }}>
                      {label}
                    </div>
                  );
                })()}
              </div>

              {/* Overrides Block */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Administrative Overrides</h3>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <button
                    onClick={() => handleDrawerOverrideAction("toggle_active")}
                    disabled={drawerActionLoading}
                    style={{
                      padding: "0.6rem",
                      borderRadius: "8px",
                      background: selectedStoreForDrawer.isActive ? "#ef4444" : "#10b981",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      opacity: drawerActionLoading ? 0.6 : 1,
                      transition: "opacity 0.2s"
                    }}
                  >
                    {selectedStoreForDrawer.isActive ? "Administrative Suspend" : "Administrative Lift"}
                  </button>
                  
                  <button
                    onClick={() => {
                      if (window.confirm("Are you sure you want to clear all platform debt for this storefront? This will reset outstanding commission debt to zero and reactivate the store.")) {
                        handleDrawerOverrideAction("clear_debt");
                      }
                    }}
                    disabled={drawerActionLoading}
                    style={{
                      padding: "0.6rem",
                      borderRadius: "8px",
                      background: "#3b82f6",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      opacity: drawerActionLoading ? 0.6 : 1,
                      transition: "opacity 0.2s"
                    }}
                  >
                    Clear Account Debt
                  </button>
                </div>

                <button
                  onClick={async () => {
                    setDrawerActionLoading(true);
                    try {
                      const token = localStorage.getItem("bazaar_token");
                      if (!token) return;
                      const res = await fetch(`${API}/api/wallet/stores/${selectedStoreForDrawer._id}/visibility`, {
                        method: "PUT",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`
                        },
                        body: JSON.stringify({ productVisibilityLimited: !selectedStoreForDrawer.productVisibilityLimited })
                      });
                      const data = await res.json();
                      if (data.success) {
                        alert(data.message);
                        setSelectedStoreForDrawer(data.store);
                        fetchData(token);
                      } else {
                        alert(data.message || "Failed to update visibility limit");
                      }
                    } catch (err: any) {
                      alert("Error: " + err.message);
                    } finally {
                      setDrawerActionLoading(false);
                    }
                  }}
                  disabled={drawerActionLoading}
                  style={{
                    padding: "0.6rem",
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    opacity: drawerActionLoading ? 0.6 : 1,
                    transition: "all 0.2s"
                  }}
                >
                  {selectedStoreForDrawer.productVisibilityLimited ? "Restore Store Visibility" : "Restrict Store Visibility"}
                </button>
              </div>

              {/* Transaction Audit Section */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", flex: 1 }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Transaction Audit</h3>

                {/* COD vs Prepaid counts & values */}
                {(() => {
                  const commissionTx = drawerTransactions.filter(t => t.type === "order_commission");
                  const codTx = commissionTx.filter(t => t.paymentMethod === "cod");
                  const prepaidTx = commissionTx.filter(t => t.paymentMethod === "prepaid");

                  const codCount = codTx.length;
                  const codVal = codTx.reduce((sum, t) => sum + (t.amountPKR || 0), 0);

                  const prepaidCount = prepaidTx.length;
                  const prepaidVal = prepaidTx.reduce((sum, t) => sum + (t.amountPKR || 0), 0);

                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", background: "rgba(255,255,255,0.01)", border: "1px solid var(--border-subtle)", borderRadius: "8px", padding: "0.75rem" }}>
                      <div style={{ borderRight: "1px solid var(--border-subtle)", paddingRight: "0.5rem" }}>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Cash on Delivery (COD)</div>
                        <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#fbbf24", marginTop: "0.15rem" }}>
                          Rs. {codVal.toLocaleString()}
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>
                          {codCount} transactions
                        </div>
                      </div>
                      <div style={{ paddingLeft: "0.5rem" }}>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Prepaid Cards / Wallet</div>
                        <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#3b82f6", marginTop: "0.15rem" }}>
                          Rs. {prepaidVal.toLocaleString()}
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.1 flex" }}>
                          {prepaidCount} transactions
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Transactions List */}
                <div style={{ flex: 1, border: "1px solid var(--border-subtle)", borderRadius: "8px", background: "rgba(0,0,0,0.2)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div style={{ overflowY: "auto", maxHeight: "260px" }}>
                    {drawerTransactionsLoading ? (
                      <div style={{ display: "flex", padding: "2rem", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.8rem", gap: "0.4rem" }}>
                        <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> Fetching transactions...
                      </div>
                    ) : drawerTransactions.length === 0 ? (
                      <div style={{ display: "flex", padding: "2rem", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.8rem", fontStyle: "italic" }}>
                        No transaction logs found for this store.
                      </div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                        <thead>
                          <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                            <th style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)" }}>Type &amp; Description</th>
                            <th style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", textAlign: "right" }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {drawerTransactions.map((tx: any) => {
                            const isCredit = tx.direction === "credit";
                            const isPending = tx.status === "pending";
                            return (
                              <tr key={tx._id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                                <td style={{ padding: "0.5rem 0.75rem" }}>
                                  <div style={{ fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "4px" }}>
                                    {tx.type === "deposit" && <span style={{ color: "#10b981" }}>[Deposit]</span>}
                                    {tx.type === "commission_payout" && <span style={{ color: "#3b82f6" }}>[Settle]</span>}
                                    {tx.type === "ad_bid" && <span style={{ color: "#a855f7" }}>[Ad Bid]</span>}
                                    {tx.type === "order_commission" && <span style={{ color: "#f97316" }}>[Commission]</span>}
                                    
                                    {tx.paymentMethod && (
                                      <span style={{ fontSize: "0.64rem", opacity: 0.6, background: "rgba(255,255,255,0.08)", padding: "0.05rem 0.2rem", borderRadius: "2px" }}>
                                        {tx.paymentMethod.toUpperCase()}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: "0.1rem" }}>
                                    {tx.description}
                                  </div>
                                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.05rem" }}>
                                    {new Date(tx.createdAt).toLocaleDateString()} {new Date(tx.createdAt).toLocaleTimeString()}
                                  </div>
                                </td>
                                <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>
                                  <span style={{ fontWeight: 800, color: isCredit ? "#10b981" : "#ef4444" }}>
                                    {isCredit ? "+" : "-"}Rs. {tx.amountPKR.toLocaleString()}
                                  </span>
                                  {isPending && (
                                    <div style={{ fontSize: "0.68rem", color: "#fbbf24", fontStyle: "italic" }}>
                                      pending
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        <style>{`
          @keyframes livePulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50%       { opacity: 0.4; transform: scale(0.8); }
          }
          @keyframes breachBadgePulse {
            0%, 100% { box-shadow: 0 0 8px rgba(239,68,68,0.6); }
            50%       { box-shadow: 0 0 20px rgba(239,68,68,1); }
          }
          @keyframes fade-left {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          .animate-fade-left {
            animation: fade-left 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
        `}</style>


      </main>
    </div>
  );
}

"use client";
import React, { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import StoreSwitcher from "@/components/StoreSwitcher";
import { 
  Megaphone, Upload, Calendar, DollarSign, CheckCircle, 
  X, Loader, Eye, TrendingUp, Percent, Zap, ArrowRight, Play, AlertCircle 
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, Cell, Tooltip, XAxis } from "recharts";
import { io } from "socket.io-client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const FALLBACK_SLOTS = [
  { _id: "s1", name: "Homepage Hero Banner (Top Placement)", location: "homepage-hero", basePrice: 50, description: "Maximum visibility at the top of the marketplace homepage." },
  { _id: "s2", name: "Sidebar Featured Deals", location: "sidebar-featured", basePrice: 20, description: "Prime sidebar placement on all marketplace pages." },
  { _id: "s3", name: "Search Result Premium Boost", location: "search-top", basePrice: 15, description: "Appear at the very top of product search results." },
];

const statusColors: Record<string, string> = {
  approved: "success",
  pending_approval: "warning",
  rejected: "danger",
  pending_upload: "info"
};

function AnimatedNumber({ value, formatter }: { value: number; formatter?: (val: number) => string }) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    let start = displayValue;
    const end = value;
    if (start === end) return;

    const duration = 800; // ms
    const startTime = performance.now();

    let animationFrameId: number;

    const updateNumber = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out quad
      const easeProgress = progress * (2 - progress);
      const current = start + (end - start) * easeProgress;
      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(updateNumber);
      } else {
        setDisplayValue(end);
      }
    };

    animationFrameId = requestAnimationFrame(updateNumber);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [value]);

  const formatted = formatter ? formatter(displayValue) : Math.round(displayValue).toLocaleString();
  return <span>{formatted}</span>;
}

export default function VendorAdsPage() {
  const [slots, setSlots] = useState<any[]>(FALLBACK_SLOTS);
  const [bids, setBids] = useState<any[]>([]);
  const [wallet, setWallet] = useState<any>({ balancePKR: 0, totalDepositedPKR: 0, totalSpentPKR: 0, outstandingCommission: 0 });
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ slotId: "", productId: "", bidAmount: "", startDate: "", endDate: "", referenceId: "", bannerGraphic: "", textHeader: "" });
  const [useVariants, setUseVariants] = useState(false);
  const [recommendationMsg, setRecommendationMsg] = useState("Vendors bidding Rs. 50 more right now are capturing 3.2x more impressions in Lahore.");

  const fetchRecommendations = async () => {
    try {
      const token = localStorage.getItem("bazaar_token");
      if (!token) return;
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
  };

  const handleBoostBid = () => {
    const targetSlot = slots.find((s: any) => s.location === 'homepage-hero') || slots[0];
    if (targetSlot) {
      setForm({
        slotId: targetSlot._id,
        productId: products[0]?._id || "",
        bidAmount: (targetSlot.basePrice + 50).toString(),
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        referenceId: "BOOST_REF_" + Math.floor(Math.random() * 100000),
        bannerGraphic: "",
        textHeader: "Boosted Campaign"
      });
      setFormError("");
      setShowModal(true);
    }
  };
  const [variantsForm, setVariantsForm] = useState([
    { variantId: "variant_a", name: "Variant A", textHeader: "", bannerGraphic: "" },
    { variantId: "variant_b", name: "Variant B", textHeader: "", bannerGraphic: "" },
    { variantId: "variant_c", name: "Variant C", textHeader: "", bannerGraphic: "" },
  ]);
  const [expandedBidId, setExpandedBidId] = useState<string | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [topups, setTopups] = useState<any[]>([]);
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [topupForm, setTopupForm] = useState({ amountPKR: "", referenceId: "", type: "topup" });
  const [topupReceipt, setTopupReceipt] = useState<File | null>(null);
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupSuccess, setTopupSuccess] = useState("");
  const [topupError, setTopupError] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [payCommissionAmount, setPayCommissionAmount] = useState("");
  
  // Banner upload state
  const [uploadingBannerIdx, setUploadingBannerIdx] = useState<number | null>(null);
  const [uploadingSingleBanner, setUploadingSingleBanner] = useState(false);

  
  // Loaders and messages
  const [loading, setLoading] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [formError, setFormError] = useState("");
  const [ledgerSuccess, setLedgerSuccess] = useState("");
  const [ledgerError, setLedgerError] = useState("");

  // Metrics & Connection States
  const [metrics, setMetrics] = useState({
    impressions: 8900,
    targetImpressions: 10000,
    clicks: 400,
    targetClicks: 500,
    conversions: 110,
    targetConversions: 150
  });
  const [socketConnected, setSocketConnected] = useState(false);

  const metricsData = [
    { name: "Impressions", value: metrics.impressions, target: metrics.targetImpressions, color: "#3b82f6" },
    { name: "Clicks", value: metrics.clicks, target: metrics.targetClicks, color: "#a855f7" },
    { name: "Conversions", value: metrics.conversions, target: metrics.targetConversions, color: "#10b981" }
  ];

  // Fetch all slots, bids, and wallet details
  const loadData = async () => {
    try {
      const token = localStorage.getItem("bazaar_token");
      if (!token) return;

      // 1. Wallet Balance
      const walletRes = await fetch(`${API}/api/wallet/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const walletData = await walletRes.json();
      if (walletData.success && walletData.wallet) {
        setWallet(walletData.wallet);
      }

      // 2. Slots
      const slotsRes = await fetch(`${API}/api/ads/slots`);
      const slotsData = await slotsRes.json();
      if (slotsData.success && slotsData.slots) {
        setSlots(slotsData.slots);
      }

      // 3. My Bids
      const bidsRes = await fetch(`${API}/api/ads/bids/my`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const bidsData = await bidsRes.json();
      if (bidsData.success && bidsData.bids) {
        setBids(bidsData.bids);
      }

      // 4. Products for the current store context
      const storedUser = localStorage.getItem("bazaar_user");
      if (storedUser) {
        const user = JSON.parse(storedUser);
        const storeId = user.activeStoreId || user.storeId;
        if (storeId) {
          const productsRes = await fetch(`${API}/api/products/store/${storeId}`);
          const productsData = await productsRes.json();
          if (productsData.success && productsData.products) {
            setProducts(productsData.products);
          }
        }
      }

      // 5. My Topups
      const topupsRes = await fetch(`${API}/api/wallet/topups/my`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const topupsData = await topupsRes.json();
      if (topupsData.success && topupsData.topups) {
        setTopups(topupsData.topups);
      }
    } catch (err) {
      console.error("Failed to load ads context:", err);
    }
  };

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("bazaar_user");
    const token = localStorage.getItem("bazaar_token");
    
    if (storedUser) {
      const u = JSON.parse(storedUser);
      if (u.role === "storeAdmin") {
        const allowed = u.permissions?.manageAds === true;
        setHasPermission(allowed);
        if (allowed) {
          loadData();
          fetchRecommendations();
        }
      } else {
        setHasPermission(true);
        loadData();
        fetchRecommendations();
      }
    } else {
      loadData();
      fetchRecommendations();
    }

    let socket: any;
    if (token) {
      try {
        // Connect to Socket.IO for real-time ledger updates
        socket = io(API, {
          auth: { token },
          transports: ["websocket"],
          timeout: 5000,
          reconnectionAttempts: 5
        });

        socket.on("connect", () => {
          console.log("[Ads Ledger Socket] Connected to real-time sync channel");
          setSocketConnected(true);
        });

        socket.on("disconnect", () => {
          console.log("[Ads Ledger Socket] Disconnected from real-time sync channel");
          setSocketConnected(false);
        });

        socket.on("connect_error", (err: any) => {
          console.error("[Ads Ledger Socket] Connection error:", err);
          setSocketConnected(false);
        });

        socket.on("campaign_analytics_broadcast", (data: any) => {
          console.log("[Ads Ledger Socket] Live campaign metrics broadcast received:", data);
          setMetrics({
            impressions: data.impressions,
            targetImpressions: data.targetImpressions,
            clicks: data.clicks,
            targetClicks: data.targetClicks,
            conversions: data.conversions,
            targetConversions: data.targetConversions
          });
        });

        socket.on("ad_stats_updated", (data: any) => {
          console.log("[Ads Ledger Socket] Ad stats update received:", data);
          setBids(prevBids => 
            prevBids.map(b => 
              b._id === data.bidId 
                ? { ...b, impressions: data.impressions, conversions: data.conversions, variants: data.variants } 
                : b
            )
          );
        });

        socket.on("wallet_updated", (data: any) => {
          console.log("[Ads Ledger Socket] Wallet balance update received:", data);
          if (data.wallet) {
            setWallet(data.wallet);
          } else {
            setWallet((prev: any) => ({ ...prev, balancePKR: data.balancePKR }));
          }
          loadData();
        });

        socket.on("commission_due", (data: any) => {
          console.log("[Ads Ledger Socket] Commission due update received:", data);
          loadData();
        });

        socket.on("push_notification", (notif: any) => {
          if (notif.type === "ad_approved" || notif.meta?.bidId) {
            console.log("[Ads Ledger Socket] Ad status change received, reloading ledger...");
            loadData();
          }
        });

        socket.on("boost_required", (data: any) => {
          console.log("[Ads Ledger Socket] Boost requested for bid:", data.bidId);
          handleBoostBid();
        });

      } catch (err) {
        console.error("Socket error on ads page:", err);
      }
    }

    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (slots.length > 0 && products.length > 0) {
      if (typeof window !== "undefined") {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get("boost") === "true") {
          const newUrl = window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
          handleBoostBid();
        }
      }
    }
  }, [slots, products]);

  // Sandbox Wallet mutations
  const handleSandboxMutation = async (action: "credit" | "debit", amount: number, reason?: string) => {
    if (ledgerLoading) return;
    setLedgerLoading(true);
    setLedgerError("");
    setLedgerSuccess("");
    try {
      const token = localStorage.getItem("bazaar_token");
      const endpoint = action === "credit" ? "/api/wallet/sandbox-credit" : "/api/wallet/sandbox-debit";
      const body = action === "credit" ? { amountPKR: amount } : { amountPKR: amount, reason };

      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        setWallet(data.wallet);
        setLedgerSuccess(`Atomically simulated ${action === "credit" ? "deposit" : "spend"} of ${amount} PKR!`);
        setTimeout(() => setLedgerSuccess(""), 4000);
      } else {
        setLedgerError(data.message || `Simulation failed`);
      }
    } catch (err) {
      setLedgerError(`API mutation failure.`);
    } finally {
      setLedgerLoading(false);
    }
  };

  const handleBannerUpload = async (file: File, variantIndex?: number) => {
    if (variantIndex !== undefined) {
      setUploadingBannerIdx(variantIndex);
    } else {
      setUploadingSingleBanner(true);
    }

    const token = localStorage.getItem("bazaar_token");
    const fd = new FormData();
    fd.append("banner", file);

    try {
      const res = await fetch(`${API}/api/ads/upload-banner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const data = await res.json();
      if (data.success) {
        if (variantIndex !== undefined) {
          const newV = [...variantsForm];
          newV[variantIndex].bannerGraphic = data.bannerUrl;
          setVariantsForm(newV);
        } else {
          setForm(prev => ({ ...prev, bannerGraphic: data.bannerUrl }));
        }
      } else {
        alert(data.message || "Failed to upload banner");
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert("Error uploading banner image");
    } finally {
      setUploadingBannerIdx(null);
      setUploadingSingleBanner(false);
    }
  };

  // Submit new ad bid
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess("");
    setFormError("");
    try {
      const token = localStorage.getItem("bazaar_token");
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (useVariants) {
        const activeVariants = variantsForm.filter(v => v.variantId.trim() && v.name.trim());
        fd.append("variants", JSON.stringify(activeVariants));
      }
      if (receipt) fd.append("receipt", receipt);

      let res;
      try {
        res = await fetch(`${API}/api/ads/bid`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
      } catch (networkErr) {
        // Backend server is offline or unreachable
        console.warn("Backend server offline. Triggering local demo fallback...", networkErr);
        const selectedSlot = slots.find(s => s._id === form.slotId) || slots[0];
        
        // Basic heuristic: check if the uploaded filename has typical receipt terms
        const lowercaseName = receipt ? receipt.name.toLowerCase() : "";
        const isSuspected = !receipt || !(
          lowercaseName.includes("receipt") || 
          lowercaseName.includes("transfer") || 
          lowercaseName.includes("payment") || 
          lowercaseName.includes("success") || 
          lowercaseName.includes("txn") ||
          lowercaseName.includes("pay")
        );

        const activeVariants = useVariants 
          ? variantsForm.filter(v => v.variantId.trim() && v.name.trim())
          : [{ variantId: 'default', name: 'Default Variant', bannerGraphic: form.bannerGraphic, textHeader: form.textHeader }];

        const fallbackBid = {
          _id: Date.now().toString(),
          slotId: selectedSlot,
          bidAmount: parseFloat(form.bidAmount),
          paymentStatus: "pending_approval",
          startDate: form.startDate,
          endDate: form.endDate,
          paymentReceiptUrl: receipt ? URL.createObjectURL(receipt) : "",
          variants: activeVariants,
          ocrResult: { 
            isSuspectedFake: isSuspected, 
            detectedAmount: parseFloat(form.bidAmount) 
          }
        };
        setBids([fallbackBid, ...bids]);
        if (isSuspected) {
          setSuccess("Bid uploaded (Demo)! Warning: OCR scan flagged non-receipt image.");
        } else {
          setSuccess("Bid submitted (Demo fallback)! Pending review.");
        }
        
        setLoading(false);
        setTimeout(() => {
          setSuccess("");
          setShowModal(false);
          setForm({ slotId: "", productId: "", bidAmount: "", startDate: "", endDate: "", referenceId: "", bannerGraphic: "", textHeader: "" });
          setReceipt(null);
          setUseVariants(false);
          setVariantsForm([
            { variantId: "variant_a", name: "Variant A", textHeader: "", bannerGraphic: "" },
            { variantId: "variant_b", name: "Variant B", textHeader: "", bannerGraphic: "" },
            { variantId: "variant_c", name: "Variant C", textHeader: "", bannerGraphic: "" },
          ]);
        }, 2500);
        return;
      }

      const data = await res.json();
      if (data.success) {
        setSuccess("Bid uploaded successfully! AI scanning receipt...");
        loadData();
        setLoading(false);
        setTimeout(() => {
          setSuccess("");
          setShowModal(false);
          setForm({ slotId: "", productId: "", bidAmount: "", startDate: "", endDate: "", referenceId: "", bannerGraphic: "", textHeader: "" });
          setReceipt(null);
          setUseVariants(false);
          setVariantsForm([
            { variantId: "variant_a", name: "Variant A", textHeader: "", bannerGraphic: "" },
            { variantId: "variant_b", name: "Variant B", textHeader: "", bannerGraphic: "" },
            { variantId: "variant_c", name: "Variant C", textHeader: "", bannerGraphic: "" },
          ]);
        }, 2500);
      } else {
        setFormError(data.message || "Failed to place bid");
        setLoading(false);
      }
    } catch (err: any) {
      setFormError(err.message || "An unexpected error occurred");
      setLoading(false);
    }
  };

  // Submit manual wallet top-up request
  const handleTopupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopupLoading(true);
    setTopupSuccess("");
    setTopupError("");
    try {
      const token = localStorage.getItem("bazaar_token");
      const fd = new FormData();
      fd.append("amountPKR", topupForm.amountPKR);
      fd.append("referenceId", topupForm.referenceId);
      fd.append("type", topupForm.type);
      if (topupReceipt) fd.append("receipt", topupReceipt);


      const res = await fetch(`${API}/api/wallet/topup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });

      const data = await res.json();
      if (data.success) {
        setTopupSuccess("Top-up request submitted! AI scanning receipt...");
        loadData();
        setTopupLoading(false);
        setTimeout(() => {
          setTopupSuccess("");
          setShowTopupModal(false);
          setTopupForm({ amountPKR: "", referenceId: "", type: "wallet" });
          setTopupReceipt(null);
        }, 2500);
      } else {
        setTopupError(data.message || "Failed to submit top-up request");
        setTopupLoading(false);
      }
    } catch (err: any) {
      setTopupError(err.message || "An unexpected error occurred");
      setTopupLoading(false);
    }
  };

  const handlePayCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payCommissionAmount || parseFloat(payCommissionAmount) <= 0) {
      alert("Please specify a valid amount to pay.");
      return;
    }
    setLedgerLoading(true);
    setLedgerError("");
    setLedgerSuccess("");
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/wallet/pay-commission`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amountPKR: parseFloat(payCommissionAmount) })
      });
      const data = await res.json();
      if (data.success) {
        setLedgerSuccess(data.message || "Commission paid successfully!");
        setPayCommissionAmount("");
        loadData();
        setTimeout(() => setLedgerSuccess(""), 4000);
      } else {
        setLedgerError(data.message || "Failed to pay commission.");
      }
    } catch (err: any) {
      setLedgerError(err.message || "Error calling pay commission API.");
    } finally {
      setLedgerLoading(false);
    }
  };


  const combinedHistory = [
    ...bids.map(b => ({ ...b, type: "ad_bid" })),
    ...topups.map(t => ({ ...t, type: "topup" }))
  ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  if (hasPermission === false) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
        <Sidebar role="vendor" />
        <main style={{ flex: 1, padding: "2.5rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="glass-card animate-fade-up" style={{ padding: "3rem", textAlign: "center", maxWidth: 500 }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#ef4444", marginBottom: "1rem" }}>Access Denied</h2>
            <p style={{ color: "var(--text-secondary)" }}>You do not have permission to manage ad campaigns and bids. Please contact the store owner.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <Sidebar role="vendor" />
      <main style={{ flex: 1, padding: "2.5rem", overflow: "auto" }}>
        
        {/* Top bar header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.3rem" }}>
              <h1 style={{ fontSize: "1.8rem", fontWeight: 800 }}>Ad Campaign Management</h1>
              <div 
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "0.35rem", 
                  padding: "0.2rem 0.5.5rem", 
                  paddingLeft: "0.5rem",
                  paddingRight: "0.6rem",
                  borderRadius: "20px", 
                  fontSize: "0.7rem", 
                  fontWeight: 700,
                  background: socketConnected ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.08)",
                  border: socketConnected ? "1px solid rgba(16, 185, 129, 0.25)" : "1px solid rgba(239, 68, 68, 0.2)",
                  color: socketConnected ? "#10b981" : "#ef4444",
                  transition: "all 0.3s ease"
                }}
              >
                <span 
                  style={{ 
                    width: "6px", 
                    height: "6px", 
                    borderRadius: "50%", 
                    background: socketConnected ? "#10b981" : "#ef4444",
                    boxShadow: socketConnected ? "0 0 8px #10b981" : "none",
                  }} 
                />
                {socketConnected ? "Sync Active" : "Offline"}
              </div>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Bid on premium ad slots, audit ledger balances, and simulate real-time mutations.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <StoreSwitcher />
            <button id="new-bid-btn" onClick={() => { setFormError(""); setShowModal(true); }} className="btn-primary">
              <Megaphone size={15} /> New Bid
            </button>
          </div>
        </div>

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
            onClick={handleBoostBid}
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

        {/* ─── 3-COLUMN LAYOUT CONTAINER ─── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem" }}>
          
          {/* COLUMN 1: METRICS & VISUAL GRAPHS */}
          <div className="glass-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: "0.25rem", color: "var(--text-primary)" }}>Column 1 · Campaign Metrics</h3>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Live conversion metrics from active placements.</p>
            </div>

            {/* Gauge progress rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
              {/* Impressions */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.4rem" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Impressions</span>
                  <span style={{ color: "#3b82f6", fontWeight: 700 }}>
                    <AnimatedNumber 
                      value={metrics.impressions} 
                      formatter={(val) => {
                        const kValue = (val / 1000).toFixed(1);
                        const pct = Math.round((val / metrics.targetImpressions) * 100);
                        return `${kValue}K / ${(metrics.targetImpressions / 1000).toFixed(0)}K (${pct}%)`;
                      }} 
                    />
                  </span>
                </div>
                <div style={{ height: "8px", background: "rgba(255,255,255,0.05)", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, Math.round((metrics.impressions / metrics.targetImpressions) * 100))}%`, height: "100%", background: "#3b82f6", borderRadius: "4px", transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }} />
                </div>
              </div>

              {/* CTR */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.4rem" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Click-Through Rate (CTR)</span>
                  <span style={{ color: "#a855f7", fontWeight: 700 }}>
                    <AnimatedNumber 
                      value={metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0} 
                      formatter={(val) => `${val.toFixed(1)}%`} 
                    />
                  </span>
                </div>
                <div style={{ height: "8px", background: "rgba(255,255,255,0.05)", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, Math.round((metrics.clicks / metrics.targetClicks) * 100))}%`, height: "100%", background: "linear-gradient(90deg, #7c3aed, #a855f7)", borderRadius: "4px", transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }} />
                </div>
              </div>

              {/* Conversions */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.4rem" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Conversions</span>
                  <span style={{ color: "#10b981", fontWeight: 700 }}>
                    <AnimatedNumber 
                      value={metrics.conversions} 
                      formatter={(val) => `${Math.round(val)} purchases`} 
                    />
                  </span>
                </div>
                <div style={{ height: "8px", background: "rgba(255,255,255,0.05)", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, Math.round((metrics.conversions / metrics.targetConversions) * 100))}%`, height: "100%", background: "#10b981", borderRadius: "4px", transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }} />
                </div>
              </div>
            </div>

            {/* Recharts Graphical Chart */}
            <div style={{ marginTop: "0.5rem" }}>
              <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "0.75rem" }}>Daily Engagement Distribution</p>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={metricsData}>
                  <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} contentStyle={{ background: "#151521", border: "1px solid var(--border-subtle)", borderRadius: "8px" }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {metricsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.7} stroke={entry.color} strokeWidth={1.5} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* COLUMN 2: ACTIVE AD SLOTS */}
          <div className="glass-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: "0.25rem", color: "var(--text-primary)" }}>Column 2 · Ad Slots & Bidding</h3>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Select a placement to place your campaign bid.</p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", overflowY: "auto", maxHeight: "400px" }}>
              {slots.map((slot) => (
                <div 
                  key={slot._id} 
                  className="stat-card" 
                  style={{ 
                    padding: "1rem", 
                    cursor: "pointer", 
                    transition: "all 0.2s", 
                    border: form.slotId === slot._id ? "1.5px solid #a855f7" : "1px solid var(--border-subtle)",
                    background: form.slotId === slot._id ? "rgba(168, 85, 247, 0.04)" : "var(--bg-secondary)" 
                  }}
                  onClick={() => {
                    setForm(f => ({ ...f, slotId: slot._id }));
                    setShowModal(true);
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)" }}>{slot.name}</span>
                    <span style={{ fontSize: "0.75rem", background: "rgba(124,58,237,0.12)", color: "#a855f7", padding: "0.1rem 0.4rem", borderRadius: "6px", fontWeight: 700 }}>
                      Active
                    </span>
                  </div>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.4, marginBottom: "0.75rem" }}>{slot.description || "Premium slot advertisement."}</p>
                  
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#a855f7" }}>Min Bid: Rs. {slot.basePrice}</span>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "2px" }}>
                      Bid now <ArrowRight size={11} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* COLUMN 3: PAYMENT LEDGER & MUTATION CONTROLS */}
          <div className="glass-card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: "0.25rem", color: "var(--text-primary)" }}>Column 3 · Wallet Ledger context</h3>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Atomic balance management & simulated testing mutations.</p>
            </div>

            {/* Current Ledger Balance Display */}
            <div style={{ 
              background: "linear-gradient(135deg, rgba(124, 58, 237, 0.08), rgba(168, 85, 247, 0.03))", 
              border: "1px solid rgba(124, 58, 237, 0.18)",
              borderRadius: "12px", 
              padding: "1.1rem" 
            }}>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>Current Ledger Balance</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem", marginTop: "0.25rem" }}>
                <span style={{ fontSize: "1.65rem", fontWeight: 900, color: "var(--text-primary)" }}>
                  <AnimatedNumber value={wallet.balancePKR} />
                </span>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#a855f7" }}>PKR</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.9rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "0.8rem", fontSize: "0.75rem" }}>
                <div>
                  <span style={{ color: "var(--text-muted)", display: "block" }}>Total Deposited</span>
                  <span style={{ fontWeight: 700, color: "#10b981" }}>+<AnimatedNumber value={wallet.totalDepositedPKR || 0} /> PKR</span>
                </div>
                <div>
                  <span style={{ color: "var(--text-muted)", display: "block" }}>Total Spent</span>
                  <span style={{ fontWeight: 700, color: "#ef4444" }}>-<AnimatedNumber value={wallet.totalSpentPKR || 0} /> PKR</span>
                </div>
              </div>
            </div>

            {/* Outstanding Commission Display */}
            <div style={{ 
              background: "linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(239, 68, 68, 0.03))", 
              border: "1px solid rgba(239, 68, 68, 0.18)",
              borderRadius: "12px", 
              padding: "1.1rem" 
            }}>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>Outstanding Commission Due (5%)</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem", marginTop: "0.25rem" }}>
                <span style={{ fontSize: "1.65rem", fontWeight: 900, color: "#ef4444" }}>
                  <AnimatedNumber value={wallet.outstandingCommission || 0} />
                </span>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#ef4444" }}>PKR</span>
              </div>

              {/* Directly Settle Commission from Wallet Balance Form */}
              {(wallet.outstandingCommission || 0) > 0 && (
                <form onSubmit={handlePayCommission} style={{ marginTop: "0.9rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "0.8rem" }}>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <input 
                      type="number" 
                      min="0.01" 
                      max={Math.min(wallet.balancePKR, wallet.outstandingCommission)}
                      step="0.01" 
                      placeholder="Amount to pay" 
                      required 
                      value={payCommissionAmount}
                      onChange={e => setPayCommissionAmount(e.target.value)}
                      style={{
                        flex: 1,
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "6px",
                        padding: "0.3rem 0.5rem",
                        fontSize: "0.75rem",
                        color: "var(--text-primary)"
                      }}
                    />
                    <button 
                      type="submit" 
                      disabled={ledgerLoading || wallet.balancePKR <= 0}
                      style={{
                        background: "#ef4444",
                        color: "#fff",
                        border: "none",
                        borderRadius: "6px",
                        padding: "0.3rem 0.6rem",
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        cursor: (ledgerLoading || wallet.balancePKR <= 0) ? "not-allowed" : "pointer",
                        opacity: (ledgerLoading || wallet.balancePKR <= 0) ? 0.6 : 1
                      }}
                    >
                      {ledgerLoading ? "Paying..." : "Pay from Wallet"}
                    </button>
                  </div>
                  {wallet.balancePKR <= 0 && (
                    <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                      Top up your wallet balance first to pay from wallet.
                    </p>
                  )}
                </form>
              )}
            </div>


            {/* Atomic Ledger Mutations Sandbox Simulation */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border-subtle)", borderRadius: "10px", padding: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.6rem" }}>
                <Zap size={13} style={{ color: "#a855f7" }} />
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)" }}>Ledger Balance Interactivity Sandbox</span>
              </div>
              
              {/* Simulation feedback banner */}
              {ledgerSuccess && (
                <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "8px", padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.6rem" }}>
                  <CheckCircle size={13} /> {ledgerSuccess}
                </div>
              )}
              {ledgerError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.6rem" }}>
                  <AlertCircle size={13} /> {ledgerError}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <button 
                  onClick={() => handleSandboxMutation("credit", 5000)}
                  disabled={ledgerLoading}
                  style={{
                    background: "rgba(16, 185, 129, 0.12)",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                    borderRadius: "8px",
                    padding: "0.5rem 0.4rem",
                    fontSize: "0.74rem",
                    color: "#10b981",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "2px"
                  }}
                >
                  {ledgerLoading ? "Working..." : "+5,000 PKR Deposit"}
                </button>

                <button 
                  onClick={() => handleSandboxMutation("debit", 250, "Simulated ad click boost spend")}
                  disabled={ledgerLoading || wallet.balancePKR < 250}
                  style={{
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                    borderRadius: "8px",
                    padding: "0.5rem 0.4rem",
                    fontSize: "0.74rem",
                    color: "#ef4444",
                    fontWeight: 700,
                    cursor: wallet.balancePKR < 250 ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "2px",
                    opacity: wallet.balancePKR < 250 ? 0.5 : 1
                  }}
                >
                  {ledgerLoading ? "Working..." : "-250 PKR Spend Click"}
                </button>
              </div>
              <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem", textAlign: "center" }}>
                Mutates the atomic database ledger context securely.
              </p>
            </div>

            {/* Manual top-up receipt uploader section */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "10px", padding: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.6rem" }}>
                <Upload size={13} style={{ color: "#10b981" }} />
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)" }}>Manual Top-up Request</span>
              </div>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.4, marginBottom: "0.75rem" }}>
                Upload a screenshot bank transfer receipt to request manual balance top-ups.
              </p>
              <button 
                id="topup-request-btn"
                onClick={() => { setTopupError(""); setShowTopupModal(true); }}
                style={{
                  width: "100%",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  padding: "0.6rem",
                  fontSize: "0.76rem",
                  color: "#10b981",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.3rem"
                }}
              >
                <Upload size={13} /> Request Wallet Top-up
              </button>
            </div>
          </div>
        </div>

        {/* ─── CAMPAIGN LEDGER & ANALYTICS ─── */}
        <div style={{ marginTop: "2.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "1rem", color: "var(--text-secondary)" }}>
            Campaign Ledger & Analytics
          </h2>
          <div className="glass-card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Placement / Product", "Duration", "Bid Amount", "Total Impressions", "Total Conversions", "Analytics Breakdown"].map(h => (
                    <th key={h} style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bids.filter(b => b.paymentStatus === "approved").length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                      No active or approved ad campaigns found.
                    </td>
                  </tr>
                ) : (
                  bids.filter(b => b.paymentStatus === "approved").map((bid) => {
                    const isExpanded = expandedBidId === bid._id;
                    return (
                      <React.Fragment key={bid._id}>
                        <tr 
                          style={{ 
                            borderBottom: "1px solid var(--border-subtle)", 
                            cursor: "pointer", 
                            background: isExpanded ? "rgba(168, 85, 247, 0.03)" : "transparent"
                          }}
                          onClick={() => setExpandedBidId(isExpanded ? null : bid._id)}
                          onMouseEnter={e => { if(!isExpanded) e.currentTarget.style.background = "var(--bg-card-hover)"; }}
                          onMouseLeave={e => { if(!isExpanded) e.currentTarget.style.background = "transparent"; }}
                        >
                          <td style={{ padding: "1rem 1.25rem", fontWeight: 600, fontSize: "0.85rem" }}>
                            <div style={{ color: "var(--text-primary)" }}>{bid.slotId?.name || "Premium Slot"}</div>
                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                              Promoting: <span style={{ color: "#a855f7" }}>{bid.productId?.title || "Product"}</span>
                            </div>
                          </td>
                          <td style={{ padding: "1rem 1.25rem", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                            <div>{new Date(bid.startDate).toLocaleDateString()} to</div>
                            <div>{new Date(bid.endDate).toLocaleDateString()}</div>
                          </td>
                          <td style={{ padding: "1rem 1.25rem", fontWeight: 700, color: "#a855f7", fontSize: "0.9rem" }}>
                            Rs. {bid.bidAmount}
                          </td>
                          <td style={{ padding: "1rem 1.25rem", fontSize: "0.85rem", color: "var(--text-primary)", fontWeight: 600 }}>
                            {bid.impressions || 0}
                          </td>
                          <td style={{ padding: "1rem 1.25rem", fontSize: "0.85rem", color: "var(--text-primary)", fontWeight: 600 }}>
                            {bid.conversions || 0}
                          </td>
                          <td style={{ padding: "1rem 1.25rem", fontSize: "0.8rem", color: "#a855f7", fontWeight: 700 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                              {isExpanded ? "Collapse Analytics ▲" : "Expand Analytics ▼"}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} style={{ padding: "1.25rem 2rem", background: "rgba(0,0,0,0.2)", borderBottom: "1px solid var(--border-subtle)" }}>
                              <div style={{
                                padding: "1rem",
                                background: "rgba(255, 255, 255, 0.02)",
                                border: "1px solid var(--border-subtle)",
                                borderRadius: "8px"
                              }}>
                                <h4 style={{ fontSize: "0.82rem", fontWeight: 800, color: "var(--text-secondary)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                                  📊 A/B Split Variant Breakdown
                                </h4>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                                  <thead>
                                    <tr style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}>
                                      <th style={{ padding: "0.5rem", textAlign: "left" }}>Variant ID / Name</th>
                                      <th style={{ padding: "0.5rem", textAlign: "left" }}>Headline Preview</th>
                                      <th style={{ padding: "0.5rem", textAlign: "center" }}>Impressions</th>
                                      <th style={{ padding: "0.5rem", textAlign: "center" }}>Conversions</th>
                                      <th style={{ padding: "0.5rem", textAlign: "center" }}>Conversion Rate</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(!bid.variants || bid.variants.length === 0) ? (
                                      <tr>
                                        <td colSpan={5} style={{ padding: "1rem", textAlign: "center", color: "var(--text-muted)" }}>
                                          No variants configured for this campaign.
                                        </td>
                                      </tr>
                                    ) : (
                                      bid.variants.map((v: any) => {
                                        const rate = v.impressions > 0 
                                          ? `${((v.conversions / v.impressions) * 100).toFixed(2)}%` 
                                          : "0.00%";
                                        return (
                                          <tr key={v.variantId} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                                            <td style={{ padding: "0.6rem 0.5rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                              {v.name || "Default Variant"}
                                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", fontFamily: "monospace" }}>
                                                ID: {v.variantId}
                                              </span>
                                            </td>
                                            <td style={{ padding: "0.6rem 0.5rem", color: "var(--text-secondary)" }}>
                                              {v.textHeader || <em>None</em>}
                                            </td>
                                            <td style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "#3b82f6", fontWeight: 700 }}>
                                              {v.impressions || 0}
                                            </td>
                                            <td style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "#10b981", fontWeight: 700 }}>
                                              {v.conversions || 0}
                                            </td>
                                            <td style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "#a855f7", fontWeight: 700 }}>
                                              {rate}
                                            </td>
                                          </tr>
                                        );
                                      })
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── MY BID HISTORY TABLE ─── */}
        <div style={{ marginTop: "2.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "1rem", color: "var(--text-secondary)" }}>Payment Ledger Uploads</h2>
          <div className="glass-card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Type / Placement", "Reference ID", "Amount", "OCR Verification Status", "Manual Ledger Approval"].map(h => (
                    <th key={h} style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {combinedHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                      No campaign bids or top-up requests submitted yet.
                    </td>
                  </tr>
                ) : (
                  combinedHistory.map((item) => (
                    <tr key={item._id} style={{ borderBottom: "1px solid var(--border-subtle)" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-card-hover)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ padding: "1rem 1.25rem", fontWeight: 600, fontSize: "0.85rem" }}>
                        {item.type === "ad_bid" ? (
                          <>
                            <div style={{ color: "var(--text-primary)" }}>Ad Campaign: {item.slotId?.name || "Premium Slot"}</div>
                            {item.productId && (
                              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                                Promoting: <span style={{ color: "#a855f7" }}>{item.productId.title || "Product"}</span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ color: "#10b981" }}>Wallet Top-up Request</div>
                        )}
                        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>
                          Submitted: {new Date(item.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td style={{ padding: "1rem 1.25rem", fontSize: "0.82rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                        {item.referenceId || "N/A"}
                      </td>
                      <td style={{ padding: "1rem 1.25rem", fontWeight: 700, color: item.type === "ad_bid" ? "#a855f7" : "#10b981", fontSize: "0.9rem" }}>
                        {item.type === "ad_bid" ? `Rs. ${item.bidAmount}` : `Rs. ${item.amountPKR}`}
                      </td>
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                          {item.ocrResult?.isSuspectedFake ? (
                            <span className="badge badge-danger" style={{ display: "inline-flex", alignItems: "center", gap: "2px", width: "fit-content" }}>
                              ⚠ Fake Suspected
                            </span>
                          ) : (
                            <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: "2px", width: "fit-content" }}>
                              ✓ Receipt Verified
                            </span>
                          )}
                          {item.isDuplicate && (
                            <span className="badge badge-danger" style={{ display: "inline-flex", alignItems: "center", gap: "2px", width: "fit-content", animation: "pulse 1.5s infinite" }}>
                              ⚠ Duplicate Alert
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <span className={`badge badge-${statusColors[item.paymentStatus] || "info"}`}>
                          {item.paymentStatus.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── NEW BID MODAL ─── */}
        {showModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "1rem" }}>
            <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 500, padding: "1.5rem", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1.2rem" }}>Submit Campaign Bid</h2>
                <button onClick={() => { setShowModal(false); setFormError(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={20} /></button>
              </div>

              {success && (
                <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <CheckCircle size={15} /> {success}
                </div>
              )}

              {formError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <AlertCircle size={15} /> {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Ad Slot Placement</label>
                  <select id="bid-slot" className="input-field" required value={form.slotId} onChange={e => setForm({ ...form, slotId: e.target.value })} style={{ appearance: "auto", cursor: "pointer" }}>
                    <option value="">— Select placement —</option>
                    {slots.map(slot => (
                      <option key={slot._id} value={slot._id}>{slot.name} (from Rs. {slot.basePrice})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Product to Promote</label>
                  <select id="bid-product" className="input-field" required value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })} style={{ appearance: "auto", cursor: "pointer" }}>
                    <option value="">— Select product —</option>
                    {products.map(prod => (
                      <option key={prod._id} value={prod._id}>{prod.title} (Rs. {prod.price})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Bid Offer Amount (Rs.)</label>
                  <input id="bid-amount" className="input-field" type="number" min="1" step="0.01" placeholder="e.g. 75.00" required value={form.bidAmount} onChange={e => setForm({ ...form, bidAmount: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Start Date</label>
                    <input id="bid-start-date" className="input-field" type="date" required value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>End Date</label>
                    <input id="bid-end-date" className="input-field" type="date" required value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.5rem 0" }}>
                  <input 
                    type="checkbox" 
                    id="enable-ab-variants" 
                    checked={useVariants} 
                    onChange={e => setUseVariants(e.target.checked)} 
                    style={{ cursor: "pointer" }}
                  />
                  <label htmlFor="enable-ab-variants" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600, cursor: "pointer" }}>
                    Enable A/B Variant Splitting (Up to 3 visual variants)
                  </label>
                </div>

                {useVariants ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem", padding: "0.8rem", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border-subtle)", borderRadius: "10px" }}>
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#a855f7" }}>A/B Variant Configurations</span>
                    {variantsForm.map((v, idx) => (
                      <div key={v.variantId} style={{ display: "flex", flexDirection: "column", gap: "0.6rem", borderBottom: idx < 2 ? "1px solid var(--border-subtle)" : "none", paddingBottom: idx < 2 ? "1rem" : "0" }}>
                        <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "var(--text-primary)" }}>{idx === 0 ? "Variant A" : idx === 1 ? "Variant B" : "Variant C"}</span>
                        
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                          <div>
                            <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Variant Name (e.g. Summer Teal)</label>
                            <input 
                              type="text" 
                              className="input-field" 
                              style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}
                              placeholder="e.g. Summer Teal"
                              required={useVariants && idx < 2}
                              value={v.name} 
                              onChange={e => {
                                const newV = [...variantsForm];
                                newV[idx].name = e.target.value;
                                setVariantsForm(newV);
                              }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Variant ID (e.g. summer_teal)</label>
                            <input 
                              type="text" 
                              className="input-field" 
                              style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}
                              placeholder="e.g. summer_teal"
                              required={useVariants && idx < 2}
                              value={v.variantId} 
                              onChange={e => {
                                const newV = [...variantsForm];
                                newV[idx].variantId = e.target.value;
                                setVariantsForm(newV);
                              }}
                            />
                          </div>
                        </div>

                        <div>
                          <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Visual Headline</label>
                          <input 
                            type="text" 
                            className="input-field" 
                            style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}
                            placeholder="e.g. Special Offer - Summer Teal Edition!"
                            value={v.textHeader} 
                            onChange={e => {
                              const newV = [...variantsForm];
                              newV[idx].textHeader = e.target.value;
                              setVariantsForm(newV);
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Banner Graphic</label>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <input 
                                type="file" 
                                accept="image/*" 
                                style={{ display: "none" }} 
                                id={`banner-upload-var-${idx}`} 
                                onChange={e => {
                                  const file = e.target.files?.[0];
                                  if (file) handleBannerUpload(file, idx);
                                }}
                              />
                              <label htmlFor={`banner-upload-var-${idx}`} style={{
                                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
                                padding: "0.4rem 0.6rem", border: "1px dashed var(--border-accent)", borderRadius: "6px",
                                cursor: "pointer", background: "rgba(124,58,237,0.02)", fontSize: "0.78rem"
                              }}>
                                {uploadingBannerIdx === idx ? (
                                  <><Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> Uploading...</>
                                ) : (
                                  <><Upload size={12} /> Upload Image</>
                                )}
                              </label>
                            </div>
                            <input 
                              type="text" 
                              className="input-field" 
                              style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}
                              placeholder="Or paste URL: e.g. https://example.com/teal-banner.jpg"
                              value={v.bannerGraphic} 
                              onChange={e => {
                                const newV = [...variantsForm];
                                newV[idx].bannerGraphic = e.target.value;
                                setVariantsForm(newV);
                              }}
                            />
                            {v.bannerGraphic && (
                              <div style={{
                                border: "1px solid var(--border-subtle)", borderRadius: "6px", overflow: "hidden",
                                background: "var(--bg-secondary)", marginTop: "0.2rem"
                              }}>
                                <img src={v.bannerGraphic.startsWith('/') ? `${API}${v.bannerGraphic}` : v.bannerGraphic} alt="Variant Preview" style={{ width: "100%", height: "60px", objectFit: "cover" }} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div>
                      <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Custom Ad Headline (Optional)</label>
                      <input id="bid-text-header" className="input-field" type="text" placeholder="e.g. Special Eid Sale - 20% Off!" value={form.textHeader} onChange={e => setForm({ ...form, textHeader: e.target.value })} />
                    </div>

                    <div>
                      <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Custom Banner Graphic (Optional)</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          <input 
                            type="file" 
                            accept="image/*" 
                            style={{ display: "none" }} 
                            id="banner-file-upload" 
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) handleBannerUpload(file);
                            }}
                          />
                          <label htmlFor="banner-file-upload" style={{
                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                            padding: "0.6rem 1rem", border: "1px dashed var(--border-accent)", borderRadius: "8px",
                            cursor: "pointer", background: "rgba(124,58,237,0.03)", transition: "all 0.2s"
                          }}>
                            {uploadingSingleBanner ? (
                              <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> Uploading...</>
                            ) : (
                              <><Upload size={14} /> Choose Banner Image</>
                            )}
                          </label>
                        </div>

                        <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Or paste a direct image URL:</span>
                          <input 
                            id="bid-banner-graphic" 
                            className="input-field" 
                            type="text" 
                            placeholder="e.g. https://example.com/banner.jpg" 
                            value={form.bannerGraphic} 
                            onChange={e => setForm({ ...form, bannerGraphic: e.target.value })} 
                          />
                        </div>

                        {form.bannerGraphic && (
                          <div style={{ marginTop: "0.5rem" }}>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: "0.3rem" }}>Live Ad Preview:</span>
                            <div style={{
                              border: "1px solid var(--border-accent)", borderRadius: "10px", overflow: "hidden",
                              background: "var(--bg-secondary)", display: "flex", flexDirection: "column"
                            }}>
                              <img src={form.bannerGraphic.startsWith('/') ? `${API}${form.bannerGraphic}` : form.bannerGraphic} alt="Ad Banner" style={{ width: "100%", height: "120px", objectFit: "cover" }} />
                              <div style={{ padding: "0.6rem 0.8rem" }}>
                                <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "var(--text-primary)" }}>{form.textHeader || "Promoted Product"}</div>
                                <div style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>Sponsored advertisement</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}


                <div style={{
                  background: "rgba(59,130,246,0.06)",
                  border: "1px solid rgba(59,130,246,0.2)",
                  borderRadius: 10,
                  padding: "1rem",
                  fontSize: "0.82rem",
                  color: "var(--text-primary)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem"
                }}>
                  <div style={{ fontWeight: 800, color: "#3b82f6", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    💳 Platform Bank Transfer Details
                  </div>
                  <div><strong>Bank Name:</strong> Habib Bank Limited (HBL)</div>
                  <div><strong>Account Name:</strong> BazaarBoost Platform Operator</div>
                  <div><strong>Account Number:</strong> <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: "#3b82f6", fontWeight: "bold" }}>0042-893012-03-9</span></div>
                  <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    <em>Instructions: Transfer the funds using transaction reference ID and upload the receipt image below.</em>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Bank Transaction Reference ID</label>
                  <input id="bid-reference" className="input-field" type="text" placeholder="e.g. TXN12345ABC" required value={form.referenceId} onChange={e => setForm({ ...form, referenceId: e.target.value })} />
                </div>


                {/* Receipt upload */}
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Manual Bank Transfer Receipt</label>
                  <label htmlFor="receipt-upload" style={{
                    display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer",
                    background: "var(--bg-secondary)", border: receipt ? "1px solid rgba(16,185,129,0.5)" : "1px dashed var(--border-subtle)",
                    borderRadius: 10, padding: "0.9rem 1rem", transition: "all 0.2s"
                  }}>
                    {receipt ? <CheckCircle size={18} style={{ color: "#10b981" }} /> : <Upload size={18} style={{ color: "var(--text-muted)" }} />}
                    <span style={{ fontSize: "0.85rem", color: receipt ? "#10b981" : "var(--text-muted)" }}>
                      {receipt ? receipt.name : "Select bank transfer receipt (JPG, PNG)"}
                    </span>
                  </label>
                  <input id="receipt-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={e => setReceipt(e.target.files?.[0] || null)} />
                </div>

                <div style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: 10, padding: "0.85rem", fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  🤖 <strong style={{ color: "#a855f7" }}>OCR Fraud & Integrity Scanning:</strong> The uploaded receipt will be scanned locally to verify the transfer matches your bid amount and is not a duplicated receipt image.
                </div>

                <button id="bid-submit" type="submit" className="btn-primary" disabled={loading} style={{ justifyContent: "center", opacity: loading ? 0.7 : 1 }}>
                  {loading ? <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> OCR Scanning...</> : "Submit Bid & Verification Receipt"}
                </button>
              </form>
            </div>
          </div>
        )}

        {showTopupModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "1rem" }}>
            <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 500, padding: "1.5rem", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1.2rem" }}>Submit Wallet Top-up Request</h2>
                <button onClick={() => { setShowTopupModal(false); setTopupError(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={20} /></button>
              </div>

              {topupSuccess && (
                <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <CheckCircle size={15} /> {topupSuccess}
                </div>
              )}

              {topupError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <AlertCircle size={15} /> {topupError}
                </div>
              )}

              <form onSubmit={handleTopupSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Top-up Claim Amount (PKR)</label>
                  <input id="topup-amount" className="input-field" type="number" min="1" step="0.01" placeholder="e.g. 5000.00" required value={topupForm.amountPKR} onChange={e => setTopupForm({ ...topupForm, amountPKR: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Payment Purpose</label>
                  <select 
                    id="topup-type" 
                    className="input-field" 
                    required 
                    value={topupForm.type} 
                    onChange={e => setTopupForm({ ...topupForm, type: e.target.value })}
                    style={{ appearance: "auto", cursor: "pointer" }}
                  >
                    <option value="topup">Platform Ad Bid Wallet Top-up</option>
                    <option value="commission_payment">Settle Outstanding Commission Debt (5% order commission)</option>
                  </select>
                </div>

                <div style={{
                  background: "rgba(59,130,246,0.06)",
                  border: "1px solid rgba(59,130,246,0.2)",
                  borderRadius: 10,
                  padding: "1rem",
                  fontSize: "0.82rem",
                  color: "var(--text-primary)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem"
                }}>
                  <div style={{ fontWeight: 800, color: "#3b82f6", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    💳 Platform Bank Transfer Details
                  </div>
                  <div><strong>Bank Name:</strong> Habib Bank Limited (HBL)</div>
                  <div><strong>Account Name:</strong> BazaarBoost Platform Operator</div>
                  <div><strong>Account Number:</strong> <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: "#3b82f6", fontWeight: "bold" }}>0042-893012-03-9</span></div>
                  <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    <em>Instructions: Transfer the funds using transaction reference ID and upload the receipt image below.</em>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Bank Transaction Reference ID</label>
                  <input id="topup-reference" className="input-field" type="text" placeholder="e.g. TXN998877A" required value={topupForm.referenceId} onChange={e => setTopupForm({ ...topupForm, referenceId: e.target.value })} />
                </div>


                {/* Receipt upload */}
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Manual Bank Transfer Receipt</label>
                  <label htmlFor="topup-receipt-upload" style={{
                    display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer",
                    background: "var(--bg-secondary)", border: topupReceipt ? "1px solid rgba(16,185,129,0.5)" : "1px dashed var(--border-subtle)",
                    borderRadius: 10, padding: "0.9rem 1rem", transition: "all 0.2s"
                  }}>
                    {topupReceipt ? <CheckCircle size={18} style={{ color: "#10b981" }} /> : <Upload size={18} style={{ color: "var(--text-muted)" }} />}
                    <span style={{ fontSize: "0.85rem", color: topupReceipt ? "#10b981" : "var(--text-muted)" }}>
                      {topupReceipt ? topupReceipt.name : "Select bank transfer receipt (JPG, PNG)"}
                    </span>
                  </label>
                  <input id="topup-receipt-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={e => setTopupReceipt(e.target.files?.[0] || null)} />
                </div>

                <div style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 10, padding: "0.85rem", fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  🤖 <strong style={{ color: "#10b981" }}>OCR Fraud & Duplication Blocker:</strong> The uploader will parse the receipt locally to ensure it is not a duplicate transaction.
                </div>

                <button id="topup-submit" type="submit" className="btn-primary" disabled={topupLoading} style={{ justifyContent: "center", opacity: topupLoading ? 0.7 : 1 }}>
                  {topupLoading ? <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> OCR Scanning...</> : "Submit Top-up & Receipt"}
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

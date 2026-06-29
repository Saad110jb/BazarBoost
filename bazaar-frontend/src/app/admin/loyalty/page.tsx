"use client";
import React, { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import { Tag, ShieldAlert, Award, TrendingUp, DollarSign, Activity, Settings, RefreshCw, Terminal, Sliders, ToggleLeft, ToggleRight } from "lucide-react";
import { io, Socket } from "socket.io-client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface LeaderboardRow {
  userId: string;
  name: string;
  email: string;
  accumulatedSpend: number;
  monthKey: string;
  claimsCount: number;
  tier: string;
}

interface HUDStats {
  totalLoyalistPool: number;
  silverPool: number;
  goldPool: number;
  totalRevenueSubsidized: number;
  liveVelocityIndex: number;
  platformNetProfitSplitYield: number;
}

interface LoyaltyConfig {
  isActive: boolean;
  silverThreshold: number;
  goldThreshold: number;
  silverDiscount: number;
  goldDiscount: number;
}

export default function PlatformLoyaltyHub() {
  const [activeTab] = useState<string>("loyalty");
  const [hud, setHud] = useState<HUDStats>({
    totalLoyalistPool: 0,
    silverPool: 0,
    goldPool: 0,
    totalRevenueSubsidized: 0,
    liveVelocityIndex: 0,
    platformNetProfitSplitYield: 0
  });

  const [config, setConfig] = useState<LoyaltyConfig>({
    isActive: true,
    silverThreshold: 10000,
    goldThreshold: 20000,
    silverDiscount: 5,
    goldDiscount: 10
  });

  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [overrideUserId, setOverrideUserId] = useState<string>("");
  const [overrideAmount, setOverrideAmount] = useState<string>("");
  const [overrideLoading, setOverrideLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>( "");

  const socketRef = useRef<Socket | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Fetch initial analytical datasets
  const fetchData = async () => {
    setLoading(true);
    setErrorMsg("");
    const token = localStorage.getItem("bazaar_token");
    try {
      const [resConfig, resAnalytics, resLeaderboard] = await Promise.all([
        fetch(`${API}/api/loyalty/config`),
        fetch(`${API}/api/loyalty/analytics`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/api/loyalty/leaderboard`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      const dataConfig = await resConfig.json();
      const dataAnalytics = await resAnalytics.json();
      const dataLeaderboard = await resLeaderboard.json();

      if (dataConfig.success) setConfig(dataConfig.config);
      if (dataAnalytics.success) setHud(dataAnalytics.hud);
      if (dataLeaderboard.success) setLeaderboard(dataLeaderboard.leaderboard);
      
    } catch (err) {
      console.error("Failed to load loyalty analytics data:", err);
      setErrorMsg("Network latency or authorization timeout loading analytics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Load mock initial logs stream
    const currentMonthLabel = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    setLogs([
      { text: `[INFO] Loyalty ledger caching metrics initialized for rolling period: ${currentMonthLabel}.`, timestamp: new Date(Date.now() - 30000) },
      { text: `[LOGISTICS] Bounded memory caches synchronized with database transaction states.`, timestamp: new Date(Date.now() - 20000) },
      { text: `[INFO] Superadmin Loyalty Hub dashboard mounted. Ready for WebSocket ledger updates.`, timestamp: new Date() }
    ]);

    // WebSocket integration
    const token = localStorage.getItem("bazaar_token");
    const socket = io(API, {
      auth: { token },
      transports: ["websocket"]
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Loyalty Socket] Connected to stream events");
    });

    socket.on("loyalty_log_event", (log: any) => {
      setLogs(prev => [...prev, { text: log.text, timestamp: new Date(log.timestamp || Date.now()) }]);
      // Trigger dynamic refresh on hud metric update
      fetchAnalyticsAndLeaderboardOnly();
    });

    socket.on("loyalty_config_updated", (newConfig: LoyaltyConfig) => {
      setConfig(newConfig);
      setLogs(prev => [...prev, { text: `[INFO] Global loyalty parameters updated by Superadmin. Matrix is now ${newConfig.isActive ? "ACTIVE" : "INACTIVE"}.`, timestamp: new Date() }]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const fetchAnalyticsAndLeaderboardOnly = async () => {
    const token = localStorage.getItem("bazaar_token");
    try {
      const [resAnalytics, resLeaderboard] = await Promise.all([
        fetch(`${API}/api/loyalty/analytics`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/api/loyalty/leaderboard`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      const dataAnalytics = await resAnalytics.json();
      const dataLeaderboard = await resLeaderboard.json();
      if (dataAnalytics.success) setHud(dataAnalytics.hud);
      if (dataLeaderboard.success) setLeaderboard(dataLeaderboard.leaderboard);
    } catch (e) {
      console.warn("Failed silent fetch update:", e);
    }
  };

  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setErrorMsg("");
    setSuccessMsg("");
    const token = localStorage.getItem("bazaar_token");

    try {
      const res = await fetch(`${API}/api/loyalty/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg("Global loyalty matrix configurations updated successfully!");
        setConfig(data.config);
        fetchData();
      } else {
        setErrorMsg(data.message || "Failed to update loyalty config.");
      }
    } catch (err) {
      setErrorMsg("Network timeout saving configurations.");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleManualOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideUserId || !overrideAmount) {
      setErrorMsg("Please specify shopper profile ID and override target spend.");
      return;
    }
    setOverrideLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    const token = localStorage.getItem("bazaar_token");

    try {
      const res = await fetch(`${API}/api/loyalty/override`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ userId: overrideUserId, accumulatedSpend: overrideAmount })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(`Manual spend override applied successfully for user ${overrideUserId}!`);
        setOverrideUserId("");
        setOverrideAmount("");
        fetchData();
      } else {
        setErrorMsg(data.message || "Spend override request rejected.");
      }
    } catch (err) {
      setErrorMsg("Failed to execute overrides.");
    } finally {
      setOverrideLoading(false);
    }
  };

  const formatPKR = (amount: number) => `Rs. ${Math.round(amount).toLocaleString()}`;
  const currentMonthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)" }} className="font-sans">
      <Sidebar role="admin" />

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto w-full">
        {/* Title */}
        <div className="flex justify-between items-center mb-8 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-purple-400 tracking-tight leading-tight pb-1 pt-1">
              Platform Monthly Loyalty Analytics Hub
            </h1>
            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
              Superadmin Control Matrix: Audit rolling monthly spend limits and global escrow subsidizations.
            </p>
          </div>
          <button 
            onClick={fetchData} 
            className="btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.5rem 1rem", borderRadius: "8px" }}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh Data
          </button>
        </div>

        {/* Global Notifications */}
        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-bold flex items-center gap-2">
            <ShieldAlert size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center gap-2 animate-fade-in">
            <RefreshCw size={14} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* 1. FOUR METRIC STAT-CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          
          {/* HUD Card 1: Total Platform Monthly Loyalist Pool */}
          <div className="stat-card flex flex-col justify-between relative overflow-hidden group">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--text-muted)" }}>Shopper Loyalist Pool</span>
              <Award size={18} style={{ color: "var(--accent-secondary)" }} className="group-hover:scale-110 transition-transform" />
            </div>
            <div>
              <p className="text-3xl font-black text-white leading-none tracking-tight">{hud.totalLoyalistPool}</p>
              <p className="text-[10px] mt-2 font-semibold" style={{ color: "var(--text-secondary)" }}>
                T1 Silver: <span style={{ color: "var(--accent-secondary)", fontWeight: "bold" }}>{hud.silverPool}</span> | T2 Gold: <span style={{ color: "var(--warning)", fontWeight: "bold" }}>{hud.goldPool}</span>
              </p>
            </div>
            <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-purple-500/10 blur-2xl rounded-full group-hover:scale-125 transition-transform duration-500" />
          </div>

          {/* HUD Card 2: Total Revenue Subsidized */}
          <div className="stat-card flex flex-col justify-between relative overflow-hidden group">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--text-muted)" }}>Subsidies Absorbed</span>
              <DollarSign size={18} style={{ color: "var(--success)" }} className="group-hover:scale-110 transition-transform" />
            </div>
            <div>
              <p className="text-3xl font-black leading-none tracking-tight" style={{ color: "var(--success)" }}>{formatPKR(hud.totalRevenueSubsidized)}</p>
              <p className="text-[10px] mt-2 font-semibold" style={{ color: "var(--text-secondary)" }}>
                Platform-subsidized markdown pool this month.
              </p>
            </div>
            <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-emerald-500/10 blur-2xl rounded-full group-hover:scale-125 transition-transform duration-500" />
          </div>

          {/* HUD Card 3: Live Shopping Velocity Index */}
          <div className="stat-card flex flex-col justify-between relative overflow-hidden group">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--text-muted)" }}>Velocity Index</span>
              <Activity size={18} style={{ color: "var(--warning)" }} className="group-hover:scale-110 transition-transform" />
            </div>
            <div>
              <p className="text-3xl font-black leading-none tracking-tight" style={{ color: "var(--warning)" }}>{hud.liveVelocityIndex}/hr</p>
              <p className="text-[10px] mt-2 font-semibold animate-pulse" style={{ color: "var(--text-secondary)" }}>
                Active multi-vendor baskets checking out now.
              </p>
            </div>
            <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-amber-500/10 blur-2xl rounded-full group-hover:scale-125 transition-transform duration-500" />
          </div>

          {/* HUD Card 4: Platform Net Profit Split Yield */}
          <div className="stat-card flex flex-col justify-between relative overflow-hidden group">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--text-muted)" }}>Net Profit Split Yield</span>
              <TrendingUp size={18} style={{ color: "var(--accent-primary)" }} className="group-hover:scale-110 transition-transform" />
            </div>
            <div>
              <p className="text-3xl font-black leading-none tracking-tight" style={{ color: hud.platformNetProfitSplitYield >= 0 ? "#3b82f6" : "var(--danger)" }}>
                {formatPKR(hud.platformNetProfitSplitYield)}
              </p>
              <p className="text-[10px] mt-2 font-semibold" style={{ color: "var(--text-secondary)" }}>
                Commissions collected minus discount subsidies paid.
              </p>
            </div>
            <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-blue-500/10 blur-2xl rounded-full group-hover:scale-125 transition-transform duration-500" />
          </div>

        </div>

        {/* 2. CONFIGURATION MATRIX & LEADERBOARD GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-10">
          
          {/* Left panel: Config Sliders (4 Columns) */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <div className="glass-card p-6 flex flex-col gap-5 hover:border-slate-800/40 transition-all duration-300">
              <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: "var(--border-subtle)" }}>
                <Sliders size={15} style={{ color: "var(--accent-secondary)" }} />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Loyalty Config Parameters</h3>
              </div>

              <form onSubmit={handleUpdateConfig} className="flex flex-col gap-4">
                {/* Active switch toggle */}
                <div className="flex justify-between items-center p-3 rounded-lg" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}>
                  <span className="text-xs font-bold text-slate-300">Loyalty discount active state</span>
                  <button
                    type="button"
                    onClick={() => setConfig(prev => ({ ...prev, isActive: !prev.isActive }))}
                    className="focus:outline-none"
                  >
                    {config.isActive ? (
                      <ToggleRight size={32} className="cursor-pointer" style={{ color: "var(--accent-primary)" }} />
                    ) : (
                      <ToggleLeft size={32} className="cursor-pointer" style={{ color: "var(--text-muted)" }} />
                    )}
                  </button>
                </div>

                {/* Silver Threshold */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    Silver Floor limit (PKR)
                  </label>
                  <input
                    type="number"
                    value={config.silverThreshold}
                    onChange={e => setConfig(prev => ({ ...prev, silverThreshold: parseFloat(e.target.value) || 0 }))}
                    className="input-field font-mono text-xs"
                  />
                </div>

                {/* Silver Markdown */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    Silver markdown rate (%)
                  </label>
                  <input
                    type="number"
                    value={config.silverDiscount}
                    onChange={e => setConfig(prev => ({ ...prev, silverDiscount: parseFloat(e.target.value) || 0 }))}
                    className="input-field font-mono text-xs"
                  />
                </div>

                {/* Gold Threshold */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    Gold Floor limit (PKR)
                  </label>
                  <input
                    type="number"
                    value={config.goldThreshold}
                    onChange={e => setConfig(prev => ({ ...prev, goldThreshold: parseFloat(e.target.value) || 0 }))}
                    className="input-field font-mono text-xs"
                  />
                </div>

                {/* Gold Markdown */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    Gold markdown rate (%)
                  </label>
                  <input
                    type="number"
                    value={config.goldDiscount}
                    onChange={e => setConfig(prev => ({ ...prev, goldDiscount: parseFloat(e.target.value) || 0 }))}
                    className="input-field font-mono text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingConfig}
                  className="btn-primary w-full justify-center text-xs py-3 mt-2"
                >
                  {savingConfig ? "Syncing configs..." : "Save Config Matrix"}
                </button>
              </form>
            </div>

            {/* Manual override tool */}
            <div className="glass-card p-6 flex flex-col gap-4 hover:border-slate-800/40 transition-all duration-300">
              <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: "var(--border-subtle)" }}>
                <Settings size={15} style={{ color: "var(--warning)" }} />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Manual Spend Override</h3>
              </div>

              <form onSubmit={handleManualOverride} className="flex flex-col gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    Shopper Profile ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 64b81c..."
                    value={overrideUserId}
                    onChange={e => setOverrideUserId(e.target.value)}
                    className="input-field text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    Override accumulated spend (PKR)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 15000"
                    value={overrideAmount}
                    onChange={e => setOverrideAmount(e.target.value)}
                    className="input-field font-mono text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={overrideLoading || !overrideUserId || !overrideAmount}
                  className="btn-primary w-full justify-center text-xs py-3 mt-2"
                  style={{
                    background: "linear-gradient(135deg, #d97706, #f59e0b)",
                    boxShadow: "0 0 20px rgba(245, 158, 11, 0.2)"
                  }}
                >
                  {overrideLoading ? "Overriding ledger..." : "Confirm Spend Override"}
                </button>
              </form>
            </div>
          </div>

          {/* Right panel: Table Leaderboard (8 Columns) */}
          <div className="lg:col-span-8 glass-card p-6 flex flex-col gap-4 hover:border-slate-800/40 transition-all duration-300">
            <div className="flex justify-between items-center border-b pb-3" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center gap-2">
                <Award size={16} style={{ color: "var(--accent-secondary)" }} />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Shopper Monthly Spend Leaderboard</h3>
              </div>
              <span className="badge badge-info animate-pulse">
                📆 Rolling Period: {currentMonthName}
              </span>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <RefreshCw size={24} className="animate-spin text-purple-500" style={{ color: "var(--accent-primary)" }} />
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Fetching monthly cross-tenant ledger logs...</span>
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="text-center py-24 text-xs" style={{ color: "var(--text-muted)" }}>
                No monthly shopper transaction rollups logged under period cache.
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.72rem", fontWeight: 800 }}>Shopper Profile</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.72rem", fontWeight: 800 }} className="text-right">Accumulated Spend ({currentMonthName})</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.72rem", fontWeight: 800 }} className="text-center">Loyalty Tier</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.72rem", fontWeight: 800 }} className="text-center">Discount Claims</th>
                      <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textTransform: "uppercase", fontSize: "0.72rem", fontWeight: 800 }} className="text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map(row => (
                      <tr 
                        key={row.userId} 
                        style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}
                        className="hover:bg-slate-900/30 transition-all font-medium"
                      >
                        <td style={{ padding: "1rem" }}>
                          <div>
                            <div className="text-slate-100 font-bold">{row.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">{row.userId}</div>
                            <div className="text-[10px] font-semibold" style={{ color: "var(--text-secondary)" }}>{row.email}</div>
                          </div>
                        </td>
                        <td style={{ padding: "1rem" }} className="text-right font-mono font-bold text-white">
                          {formatPKR(row.accumulatedSpend)}
                        </td>
                        <td style={{ padding: "1rem" }} className="text-center">
                          <span className={`badge ${
                            row.tier === 'Gold' 
                              ? "badge-warning" 
                              : row.tier === 'Silver' 
                                ? "badge-info"
                                : "bg-slate-800/40 border border-slate-800/80 text-slate-400 text-[10px] px-2 py-0.5 rounded-full"
                          }`} style={{ fontSize: "0.68rem", fontWeight: 800 }}>
                            {row.tier}
                          </span>
                        </td>
                        <td style={{ padding: "1rem" }} className="text-center font-mono text-slate-300 font-bold">
                          {row.claimsCount} items
                        </td>
                        <td style={{ padding: "1rem" }} className="text-center">
                          <button
                            onClick={() => {
                              setOverrideUserId(row.userId);
                              setOverrideAmount(String(row.accumulatedSpend));
                            }}
                            className="btn-secondary"
                            style={{ padding: "0.4rem 0.8rem", borderRadius: "8px", fontSize: "0.7rem" }}
                          >
                            Set Override
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 3. PLATFORM LOYALTY LOG DRAWER (WebSocket Stream Ticker) */}
        <div className="glass-card p-6 relative overflow-hidden hover:border-slate-800/40 transition-all duration-300">
          <div className="flex justify-between items-center border-b pb-3 mb-4" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center gap-3">
              {/* Window Controls Mockup */}
              <div className="flex gap-1.5 shrink-0">
                <span className="w-3 h-3 rounded-full bg-rose-500/70 border border-rose-600/50" />
                <span className="w-3 h-3 rounded-full bg-amber-500/70 border border-amber-600/50" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/70 border border-emerald-600/50" />
              </div>
              <div className="h-4 w-px bg-slate-800 mx-1" style={{ background: "var(--border-subtle)" }} />
              <div className="flex items-center gap-1.5">
                <Terminal size={14} style={{ color: "var(--accent-secondary)" }} />
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Platform Loyalty Log Drawer (Real-Time)</h3>
              </div>
            </div>
            <span className="badge badge-success animate-pulse" style={{ fontSize: "0.68rem" }}>
              Live Console Stream Active
            </span>
          </div>

          {/* Terminal log panel */}
          <div className="bg-[#07070a] border rounded-xl p-4 h-56 overflow-y-auto font-mono text-xs flex flex-col gap-2 shadow-inner shadow-black/85 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent" style={{ borderColor: "var(--border-subtle)" }}>
            {logs.map((log, idx) => {
              const isInfo = log.text.includes("[INFO]");
              const isRebate = log.text.includes("[REBATE]");
              const isLogistics = log.text.includes("[LOGISTICS]");

              let colorClass = "text-slate-300";
              if (isInfo) colorClass = "text-blue-400";
              else if (isRebate) colorClass = "text-emerald-400";
              else if (isLogistics) colorClass = "text-amber-500";

              return (
                <div key={idx} className="flex gap-2.5 items-start leading-relaxed border-b pb-1.5 last:border-b-0 hover:bg-slate-900/10 px-1 rounded transition-colors" style={{ borderColor: "rgba(255,255,255,0.02)" }}>
                  <span className="text-slate-600 select-none font-bold shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className={colorClass}>{log.text}</span>
                </div>
              );
            })}
            <div ref={terminalEndRef} />
          </div>
        </div>
      </main>
    </div>
  );
}

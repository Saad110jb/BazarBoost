"use client";
import React, { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import { 
  TrendingUp, Shield, Users, AlertCircle, Loader, 
  CheckCircle2, Lock, Terminal, RefreshCw, Info,
  DollarSign, Check, X, ShieldAlert, Award, AlertTriangle, Ban
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { io } from "socket.io-client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Standard mock data for fallback & analytics graph simulation
const defaultChartData = [
  { name: "Jan", disbursed: 45000, recaptured: 38000 },
  { name: "Feb", disbursed: 68000, recaptured: 55000 },
  { name: "Mar", disbursed: 89000, recaptured: 72000 },
  { name: "Apr", disbursed: 120000, recaptured: 98000 },
  { name: "May", disbursed: 155000, recaptured: 135000 },
  { name: "Jun", disbursed: 195000, recaptured: 172000 },
];

const mockLogs = [
  { time: "19:28:04", type: "FINTECH", text: "Disbursed Rs. 955 inventory credit to 'Shop Bazar'. 5% flat fee written to platform escrow ledger." },
  { time: "19:30:15", type: "SETTLEMENT", text: "Intercepted incoming payout to vendor ID #VND-402. Rs. 1,003 auto-deducted to settle active loan tier balances." },
  { time: "19:32:44", type: "RISKALERT", text: "Merchant 'VendorX' fulfillment rate slipped below 85%. Credit score dropped; Available loan limits throttled." },
  { time: "19:35:10", type: "FINTECH", text: "Assessing credit limits for 'Lahore Sports Hub'. Base GMV computed at Rs. 24,000. Underwriting loan limit: Rs. 12,000." },
  { time: "19:38:02", type: "SETTLEMENT", text: "Auto-repayment hook executed for 'Karachi Garments'. Settle fee Rs. 500 from active sandbox deposit." },
  { time: "19:41:20", type: "RISKALERT", text: "Fulfillment audit check: 'Multan Agri-Store' flagged. 0% completion rate on last 3 COD shipments." }
];

export default function EscrowLoansAdminPage() {
  const router = useRouter();
  
  // Auth state
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // Data state
  const [loans, setLoans] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>(mockLogs);
  const [fetchingData, setFetchingData] = useState(false);

  // Stats counters
  const [stats, setStats] = useState({
    totalOutstanding: 0,
    excellentRiskCount: 0,
    moderateRiskCount: 0,
    criticalRiskCount: 0,
    cumulativeInterest: 0,
    nplRate: 0
  });

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modals state
  const [scoreOverrideModal, setScoreOverrideModal] = useState<{ isOpen: boolean; storeId: string; storeName: string; currentScore: number } | null>(null);
  const [scoreOverrideValue, setScoreOverrideValue] = useState<string>("");

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Decode JWT safely
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

  const fetchLoansData = async (token: string) => {
    setFetchingData(true);
    setErrorMsg("");
    try {
      const res = await fetch(`${API}/api/wallet/admin/loans`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setLoans(data.loans || []);
        calculateStats(data.loans || []);
      } else {
        setErrorMsg(data.message || "Failed to retrieve escrow loan registry");
      }
    } catch (err) {
      console.error("Error fetching admin loans:", err);
      setErrorMsg("Network error fetching active lien registry. Check backend server.");
    } finally {
      setFetchingData(false);
      setLoading(false);
    }
  };

  const calculateStats = (loanList: any[]) => {
    let totalOutstanding = 0;
    let excellentRiskCount = 0;
    let moderateRiskCount = 0;
    let criticalRiskCount = 0;
    let cumulativeInterest = 0;
    let overdueCount = 0;

    loanList.forEach(l => {
      if (l.status === 'approved') {
        totalOutstanding += l.repaymentAmount;
        // Check standard 30 day window for NPL (Non-performing loan)
        const loanAgeDays = (Date.now() - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (loanAgeDays > 30) {
          overdueCount++;
        }
      }

      if (l.status === 'repaid') {
        cumulativeInterest += (l.repaymentAmount - l.amount);
      }

      // Risk score count
      const score = l.creditScore || 300;
      if (score >= 700) {
        excellentRiskCount++;
      } else if (score >= 600) {
        moderateRiskCount++;
      } else {
        criticalRiskCount++;
      }
    });

    const activeCount = loanList.filter(l => l.status === 'approved').length;
    const nplRate = activeCount > 0 ? Math.round((overdueCount / activeCount) * 100) : 0;

    setStats({
      totalOutstanding,
      excellentRiskCount,
      moderateRiskCount,
      criticalRiskCount,
      cumulativeInterest,
      nplRate
    });
  };

  // Row actions
  const triggerManualDeduction = async (loanId: string) => {
    if (!confirm("Are you sure you want to manually execute a wallet balance deduction to repay this loan?")) return;
    setActionLoading(loanId);
    setActionError(null);
    setActionSuccess(null);

    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/wallet/admin/loans/${loanId}/deduct`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setActionSuccess(`Loan fully settled. Deducted Rs. ${data.loan.repaymentAmount} from merchant wallet.`);
        addLog("SETTLEMENT", `Superadmin triggered manual deduction for loan ID #${loanId.slice(-6).toUpperCase()}. Settled Rs. ${data.loan.repaymentAmount}.`);
        if (token) fetchLoansData(token);
      } else {
        setActionError(data.message || "Insufficient wallet balance to cover loan repayment.");
      }
    } catch (err) {
      setActionError("Network failure executing manual settlement.");
    } finally {
      setActionLoading(null);
    }
  };

  const toggleLoanFreeze = async (storeId: string, currentFrozen: boolean) => {
    setActionLoading(storeId);
    setActionError(null);
    setActionSuccess(null);

    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/wallet/admin/stores/${storeId}/freeze-loan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isLoanFrozen: !currentFrozen })
      });
      const data = await res.json();
      if (data.success) {
        const actionText = !currentFrozen ? "FROZEN" : "UNFROZEN";
        setActionSuccess(`Store credit status updated: Eligibility is now ${actionText}.`);
        addLog("RISKALERT", `Merchant '${data.store.name}' loan eligibility was administratively ${actionText} by Superadmin.`);
        if (token) fetchLoansData(token);
      } else {
        setActionError(data.message || "Failed to update loan freeze status.");
      }
    } catch (err) {
      setActionError("Network failure updating credit eligibility.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleScoreOverrideSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scoreOverrideModal) return;
    
    setActionLoading(scoreOverrideModal.storeId);
    setActionError(null);
    setActionSuccess(null);

    const token = localStorage.getItem("bazaar_token");
    const val = scoreOverrideValue.trim() === "" ? null : Number(scoreOverrideValue);

    try {
      const res = await fetch(`${API}/api/wallet/admin/stores/${scoreOverrideModal.storeId}/override-credit-score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ creditScoreOverride: val })
      });
      const data = await res.json();
      if (data.success) {
        setActionSuccess(`Credit score override updated successfully for ${scoreOverrideModal.storeName}.`);
        const overrideText = val === null ? "cleared override" : `overrode credit score to ${val}`;
        addLog("FINTECH", `Superadmin ${overrideText} for merchant '${scoreOverrideModal.storeName}'.`);
        setScoreOverrideModal(null);
        setScoreOverrideValue("");
        if (token) fetchLoansData(token);
      } else {
        setActionError(data.message || "Failed to update credit score override.");
      }
    } catch (err) {
      setActionError("Network failure saving credit override.");
    } finally {
      setActionLoading(null);
    }
  };

  const addLog = (type: string, text: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { time, type, text }]);
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Auth and initial loading
  useEffect(() => {
    const stored = localStorage.getItem("bazaar_user");
    const token = localStorage.getItem("bazaar_token");
    if (!stored || !token) {
      router.push("/admin/gatekeeper-login");
      return;
    }

    const decoded = decodeJWT(token);
    if (!decoded || decoded.role !== "admin") {
      router.push("/admin/gatekeeper-login");
      return;
    }

    setUser(JSON.parse(stored));
    fetchLoansData(token);

    const socket = io(API);
    socket.on("on_platform_financial_update", (data: any) => {
      setLogs(prev => [...prev, data]);
      fetchLoansData(token);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="bg-[#07070A] text-white min-h-screen flex font-sans">
      {/* Sidebar Panel */}
      <Sidebar role="admin" />

      {/* Main Admin Console */}
      <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-6 ml-64">
        {/* Top Header Controls */}
        <div className="flex justify-between items-center border-b border-slate-800/60 pb-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
              Escrow Loan & Risk Administration
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Underwrite short-term credit risk, execute collections, and adjust active credit tier parameters.
            </p>
          </div>
          <button
            onClick={() => {
              const token = localStorage.getItem("bazaar_token");
              if (token) fetchLoansData(token);
            }}
            disabled={fetchingData}
            className="flex items-center gap-2 px-4 py-2 bg-[#111119] border border-slate-800 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/30 transition text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={fetchingData ? "animate-spin" : ""} />
            {fetchingData ? "Fetching..." : "Refresh Console"}
          </button>
        </div>

        {/* Global Warnings/Notifications */}
        {errorMsg && (
          <div className="flex items-center gap-3 p-4 bg-red-950/20 border border-red-800/40 rounded-xl text-red-300 text-sm">
            <ShieldAlert size={18} className="text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {actionSuccess && (
          <div className="flex items-center gap-3 p-4 bg-emerald-950/20 border border-emerald-800/40 rounded-xl text-emerald-300 text-sm">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {actionError && (
          <div className="flex items-center gap-3 p-4 bg-amber-950/20 border border-amber-800/40 rounded-xl text-amber-300 text-sm">
            <AlertCircle size={18} className="text-amber-400 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {/* 1. RISK HUD COUNTERS PANEL */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Card 1: Capital Outstanding */}
          <div className="bg-[#0f0f18]/80 border border-slate-800/70 p-5 rounded-2xl flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Capital Outstanding</span>
              <span className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg"><DollarSign size={14} /></span>
            </div>
            <div className="mt-4">
              <span className="text-2xl font-extrabold text-white">
                Rs. {stats.totalOutstanding.toLocaleString()}
              </span>
              <p className="text-xs text-slate-400 mt-1">Disbursed to vendor wallets & in-flight</p>
            </div>
          </div>

          {/* Card 2: Platform Risk Index Pool */}
          <div className="bg-[#0f0f18]/80 border border-slate-800/70 p-5 rounded-2xl flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Risk Index Pool</span>
              <span className="p-2 bg-purple-500/10 text-purple-400 rounded-lg"><Shield size={14} /></span>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span className="text-emerald-400 font-semibold">Excellent (&ge;700):</span>
                <span className="text-white font-bold">{stats.excellentRiskCount}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-amber-400 font-semibold">Moderate (600-699):</span>
                <span className="text-white font-bold">{stats.moderateRiskCount}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-red-400 font-semibold">Critical (&lt;600):</span>
                <span className="text-white font-bold">{stats.criticalRiskCount}</span>
              </div>
            </div>
          </div>

          {/* Card 3: Flat Interest realized */}
          <div className="bg-[#0f0f18]/80 border border-slate-800/70 p-5 rounded-2xl flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Escrow Flat Interest realized</span>
              <span className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg"><TrendingUp size={14} /></span>
            </div>
            <div className="mt-4">
              <span className="text-2xl font-extrabold text-white">
                Rs. {stats.cumulativeInterest.toLocaleString()}
              </span>
              <p className="text-xs text-slate-400 mt-1">Accumulated 5% service fees settled</p>
            </div>
          </div>

          {/* Card 4: NPL Rate */}
          <div className="bg-[#0f0f18]/80 border border-slate-800/70 p-5 rounded-2xl flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Non-Performing Loans (NPL)</span>
              <span className="p-2 bg-rose-500/10 text-rose-400 rounded-lg"><AlertCircle size={14} /></span>
            </div>
            <div className="mt-4">
              <span className="text-2xl font-extrabold text-rose-400">
                {stats.nplRate}%
              </span>
              <p className="text-xs text-slate-400 mt-1">Active loans past 30 days window</p>
            </div>
          </div>
        </div>

        {/* 2. LOAN PERFORMANCE & LIQUIDITY STREAM CHART */}
        <div className="bg-[#0f0f18]/80 border border-slate-800/70 p-6 rounded-2xl">
          <div className="flex justify-between items-center mb-5">
            <div>
              <h3 className="font-bold text-white text-base">Loan Performance & Liquidity Streams</h3>
              <p className="text-xs text-slate-400 mt-0.5">Disbursement volume versus automatic deductions recaptured monthly.</p>
            </div>
            <div className="flex gap-4 text-xs font-semibold">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-indigo-500 rounded-full inline-block"></span> Capital Disbursed</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-emerald-500 rounded-full inline-block"></span> Capital Recaptured</span>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={defaultChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorDisbursed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorRecaptured" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0f0f18", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#fff" }} />
                <Area type="monotone" dataKey="disbursed" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorDisbursed)" />
                <Area type="monotone" dataKey="recaptured" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorRecaptured)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3. CREDIT AND LIEN REGISTRY GRID */}
        <div className="bg-[#0f0f18]/80 border border-slate-800/70 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-slate-800/70">
            <h3 className="font-bold text-white text-base">Centralized Multi-Tenant Credit & Lien Registry</h3>
            <p className="text-xs text-slate-400 mt-0.5">Active escrow loans outstanding across verified marketplace stores.</p>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-12 flex justify-center items-center gap-2 text-slate-400">
                <Loader size={18} className="animate-spin" />
                <span>Loading active lien records...</span>
              </div>
            ) : loans.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Info size={28} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">No active loans found in database.</p>
                <p className="text-xs opacity-65 mt-1">Vendor inventory loans will appear here once requested.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900/50 text-slate-400 font-bold border-b border-slate-800/50">
                    <th className="p-4">Vendor / Store</th>
                    <th className="p-4 text-center">Credit Score</th>
                    <th className="p-4 text-right">Principal</th>
                    <th className="p-4 text-right">Repayment Debt</th>
                    <th className="p-4 text-right">30D GMV Sales</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-center">Timeline Track</th>
                    <th className="p-4 text-center">Eligibility</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {loans.map(loan => {
                    const score = loan.creditScore || 300;
                    const ageDays = (Date.now() - new Date(loan.createdAt).getTime()) / (1000 * 60 * 60 * 24);
                    
                    let riskColor = "text-red-400 bg-red-400/5 border border-red-500/20";
                    let riskLabel = "Critical Risk";

                    if (loan.status === 'repaid') {
                      riskColor = "text-emerald-400 bg-emerald-400/5 border border-emerald-500/20";
                      riskLabel = "Excellent Risk";
                    } else {
                      if (ageDays < 30) {
                        riskColor = "text-purple-400 bg-purple-400/5 border border-purple-500/20";
                        riskLabel = "Excellent Risk";
                      } else if (ageDays >= 30 && ageDays < 45) {
                        riskColor = "text-amber-400 bg-amber-400/5 border border-amber-500/20";
                        riskLabel = "Moderate Risk";
                      } else if (ageDays >= 45 && ageDays < 60) {
                        riskColor = "text-amber-500 bg-amber-500/5 border border-amber-500/20";
                        riskLabel = "Critical Risk";
                      } else {
                        riskColor = "text-red-500 bg-red-500/5 border border-red-500/20 font-extrabold";
                        riskLabel = "Default/Suspended";
                      }
                    }

                    let statusColor = "text-blue-400 bg-blue-500/10";
                    if (loan.status === 'repaid') {
                      statusColor = "text-emerald-400 bg-emerald-500/10";
                    } else {
                      if (ageDays > 30) {
                        statusColor = "text-rose-400 bg-rose-500/10 border border-rose-500/20 animate-pulse";
                      }
                    }

                    return (
                      <tr key={loan._id} className="hover:bg-slate-900/20 transition">
                        {/* Vendor Profile */}
                        <td className="p-4">
                          <div className="font-semibold text-white">{loan.storeName || "Vendor Store"}</div>
                          <div className="text-slate-500 text-[10px] mt-0.5">ID: #{loan.vendorId ? loan.vendorId.toString().slice(-8).toUpperCase() : "N/A"}</div>
                        </td>

                        {/* Credit score indicator */}
                        <td className="p-4 text-center">
                          <div className="font-bold text-white text-[13px]">{score}</div>
                          <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium mt-1 ${riskColor}`}>
                            {riskLabel}
                          </span>
                        </td>

                        {/* Financial figures */}
                        <td className="p-4 text-right font-medium text-slate-300">Rs. {loan.amount.toLocaleString()}</td>
                        <td className="p-4 text-right font-bold text-white">Rs. {loan.repaymentAmount.toLocaleString()}</td>
                        <td className="p-4 text-right text-slate-300">Rs. {(loan.monthlyGmv || 0).toLocaleString()}</td>

                        {/* Settlement Status */}
                        <td className="p-4 text-center">
                          <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide uppercase ${statusColor}`}>
                            {loan.status === 'repaid' ? "Settled" : (ageDays >= 60 ? "Defaulted" : "Disbursed")}
                          </span>
                        </td>

                        {/* Timeline Track Progress Bar */}
                        <td className="p-4 text-center">
                          {loan.status !== 'repaid' ? (
                            <div className="inline-block w-28 text-left">
                              <div className="flex justify-between text-[9px] text-slate-400 mb-1">
                                <span>Day {Math.floor(ageDays)}/60</span>
                                <span>{Math.min(100, Math.round((ageDays / 60) * 100))}%</span>
                              </div>
                              <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden relative">
                                <div className={`h-full rounded ${
                                  ageDays >= 60 ? "bg-red-500" : (ageDays >= 45 ? "bg-amber-500" : "bg-purple-500")
                                }`} style={{ width: `${Math.min(100, (ageDays / 60) * 100)}%` }} />
                                <div className="absolute left-1/2 top-0 w-px h-full bg-slate-600/50" />
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-600 text-[10px]">Settle (N/A)</span>
                          )}
                        </td>

                        {/* Eligibility / Freeze indicator */}
                        <td className="p-4 text-center">
                          {loan.status !== 'repaid' && ageDays >= 60 ? (
                            <span className="inline-flex items-center gap-1 font-bold text-red-500 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded text-[10px]">
                              <Ban size={10} />
                              <span>Suspended</span>
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 font-bold ${loan.isLoanFrozen ? "text-red-400" : "text-emerald-400"}`}>
                              {loan.isLoanFrozen ? (
                                <>
                                  <Ban size={12} />
                                  <span>Frozen</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 size={12} />
                                  <span>Active</span>
                                </>
                              )}
                            </span>
                          )}
                        </td>

                        {/* Operational buttons */}
                        <td className="p-4 text-right">
                          <div className="flex gap-2 justify-end">
                            {/* Manual Collection / trigger deduction */}
                            {loan.status !== 'repaid' && (
                              <button
                                onClick={() => triggerManualDeduction(loan._id)}
                                disabled={actionLoading === loan._id}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-bold transition text-[10px] cursor-pointer disabled:opacity-50"
                              >
                                {actionLoading === loan._id ? "Deducting..." : "Trigger Deduction"}
                              </button>
                            )}

                            {/* Freeze eligibility toggle */}
                            <button
                              onClick={() => toggleLoanFreeze(loan.storeId._id, loan.isLoanFrozen)}
                              disabled={actionLoading === loan.storeId?._id}
                              className={`px-2.5 py-1 rounded text-white font-bold transition text-[10px] cursor-pointer ${
                                loan.isLoanFrozen ? "bg-slate-700 hover:bg-slate-600" : "bg-red-900/60 hover:bg-red-800"
                              }`}
                            >
                              {loan.isLoanFrozen ? "Unfreeze" : "Freeze"}
                            </button>

                            {/* Credit override limits */}
                            <button
                              onClick={() => setScoreOverrideModal({
                                isOpen: true,
                                storeId: loan.storeId._id,
                                storeName: loan.storeName,
                                currentScore: score
                              })}
                              className="px-2.5 py-1 bg-indigo-900/60 hover:bg-indigo-800 rounded text-white font-bold transition text-[10px] cursor-pointer"
                            >
                              Override Limit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 4. REAL-TIME AUDIT LOG CONTAINER */}
        <div className="bg-[#0b0b14]/90 border border-slate-800/80 rounded-2xl overflow-hidden font-mono">
          <div className="bg-slate-950/80 p-4 border-b border-slate-800/70 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-purple-400" />
              <span className="text-xs font-bold text-slate-300">Fulfillment Pipeline Underwriting Watcher</span>
            </div>
            <span className="text-[10px] text-slate-500 animate-pulse">● System Logs Online</span>
          </div>
          <div className="p-5 max-h-56 overflow-y-auto flex flex-col gap-2 text-[11px] leading-relaxed text-slate-300">
            {logs.map((log, index) => {
              let typeColor = "text-indigo-400";
              if (log.type === "SETTLEMENT") typeColor = "text-emerald-400";
              if (log.type === "RISKALERT") typeColor = "text-rose-400";

              return (
                <div key={index} className="flex gap-2">
                  <span className="text-slate-500 font-bold">[{log.time}]</span>
                  <span className={`${typeColor} font-bold shrink-0`}>[{log.type}]</span>
                  <span>{log.text}</span>
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {/* Credit score override dialog modal */}
      {scoreOverrideModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f0f18] border border-slate-800 rounded-2xl max-w-sm w-full p-6 relative">
            <button
              onClick={() => setScoreOverrideModal(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X size={18} />
            </button>
            <h4 className="font-bold text-white text-base">Adjust Credit Limits</h4>
            <p className="text-xs text-slate-400 mt-1">
              Apply administrative override limits for <strong>{scoreOverrideModal.storeName}</strong>. Currently calculated score: {scoreOverrideModal.currentScore}.
            </p>
            
            <form onSubmit={handleScoreOverrideSubmit} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Override Score (300 - 850)</label>
                <input
                  type="number"
                  min="300"
                  max="850"
                  placeholder="Enter override score (e.g. 720)..."
                  className="w-full bg-[#111119] border border-slate-800 rounded-lg p-2.5 text-xs text-white outline-none focus:border-indigo-500"
                  value={scoreOverrideValue}
                  onChange={e => setScoreOverrideValue(e.target.value)}
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Leave empty and submit to reset to system-calculated score.</span>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setScoreOverrideModal(null)}
                  className="px-4 py-2 border border-slate-850 bg-[#111119] rounded-lg text-slate-400 hover:text-white text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Apply Override
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

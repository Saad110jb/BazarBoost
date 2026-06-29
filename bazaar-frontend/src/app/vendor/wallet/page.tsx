"use client";
import React, { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import StoreSwitcher from "@/components/StoreSwitcher";
import { 
  Wallet, DollarSign, ArrowUpRight, ArrowDownRight, 
  Upload, CheckCircle, AlertCircle, X, Printer, 
  Search, Filter, Loader, Shield, Play, Plus, RefreshCw, Eye, Lock,
  AlertTriangle, Info
} from "lucide-react";
import { io } from "socket.io-client";

const API = (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL !== "undefined" && process.env.NEXT_PUBLIC_API_URL !== "null") ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:5000";

// Helper: decode JWT locally
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

export default function VendorWalletPage() {
  const [wallet, setWallet] = useState<any>({
    balancePKR: 0,
    totalDepositedPKR: 0,
    totalSpentPKR: 0,
    outstandingCommission: 0,
    lastUpdated: ""
  });
  const [exportingLedger, setExportingLedger] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [fetchingOrder, setFetchingOrder] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [countdownText, setCountdownText] = useState("48:00:00");
  const [sandboxWithdrawAmt, setSandboxWithdrawAmt] = useState("");
  const [sandboxTransferAmt, setSandboxTransferAmt] = useState("");
  const [sandboxTransferSlug, setSandboxTransferSlug] = useState("");
  const [sandboxActionError, setSandboxActionError] = useState("");
  const [sandboxActionSuccess, setSandboxActionSuccess] = useState("");
  
  // Search & Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Topup State
  const [showTopup, setShowTopup] = useState(false);
  const [topupForm, setTopupForm] = useState({ amountPKR: "", referenceId: "", type: "topup" });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupResult, setTopupResult] = useState<any | null>(null); // For smooth OCR review
  const [topupError, setTopupError] = useState("");

  // Micro-Financing states
  const [creditScoreData, setCreditScoreData] = useState<any>(null);
  const [loadingScore, setLoadingScore] = useState(false);
  const [loanAmount, setLoanAmount] = useState("");
  const [applyingLoan, setApplyingLoan] = useState(false);
  const [repayingLoan, setRepayingLoan] = useState(false);
  const [loanError, setLoanError] = useState("");
  const [loanSuccess, setLoanSuccess] = useState("");

  // Pay Commission State
  const [showPayComm, setShowPayComm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const [paySuccess, setPaySuccess] = useState("");
  const [payError, setPayError] = useState("");

  // Sandbox State
  const [sandboxLoading, setSandboxLoading] = useState(false);

  // Permissions state
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [userRole, setUserRole] = useState("");

  // Load Data function
  const loadData = async (tokenString?: string) => {
    const token = tokenString || localStorage.getItem("bazaar_token");
    if (!token) return;
    
    setLoading(true);
    setError("");

    try {
      // 1. Balance
      const balanceRes = await fetch(`${API}/api/wallet/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const balanceData = await balanceRes.json();
      if (balanceData.success && balanceData.wallet) {
        setWallet(balanceData.wallet);
      } else {
        setError(balanceData.message || "Failed to load wallet balance");
      }
      if (balanceData.success && balanceData.store) {
        setStoreInfo(balanceData.store);
      }

      // 2. Transactions
      const transRes = await fetch(`${API}/api/wallet/transactions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const transData = await transRes.json();
      if (transData.success && transData.transactions) {
        setTransactions(transData.transactions);
      }

      // 3. Credit Score & Micro-Financing
      const scoreRes = await fetch(`${API}/api/wallet/credit-score`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const scoreData = await scoreRes.json();
      if (scoreData.success) {
        setCreditScoreData(scoreData);
      }
    } catch (err: any) {
      console.error(err);
      setError("Failed to communicate with billing gateway API");
    } finally {
      setLoading(false);
    }
  };

  const handleApplyLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanAmount || isNaN(Number(loanAmount))) return;
    setApplyingLoan(true);
    setLoanError("");
    setLoanSuccess("");
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/wallet/apply-loan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amount: Number(loanAmount) })
      });
      const data = await res.json();
      if (data.success) {
        setLoanSuccess(data.message);
        setLoanAmount("");
        loadData(token || undefined);
      } else {
        setLoanError(data.message || "Failed to apply for inventory loan");
      }
    } catch (err) {
      setLoanError("Network error applying for loan");
    } finally {
      setApplyingLoan(false);
    }
  };

  const handleRepayLoan = async () => {
    setRepayingLoan(true);
    setLoanError("");
    setLoanSuccess("");
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/wallet/repay-loan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setLoanSuccess(data.message);
        loadData(token || undefined);
      } else {
        setLoanError(data.message || "Failed to repay loan");
      }
    } catch (err) {
      setLoanError("Network error repaying loan");
    } finally {
      setRepayingLoan(false);
    }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem("bazaar_user");
    const token = localStorage.getItem("bazaar_token");
    
    if (storedUser && token) {
      const u = JSON.parse(storedUser);
      setUserRole(u.role);
      
      if (u.role === "storeAdmin") {
        const decoded = decodeJWT(token);
        const permissionsArray = decoded?.permissions || [];
        const allowed = permissionsArray.includes("VIEW_BILLING");
        setHasPermission(allowed);
        if (allowed) {
          loadData(token);
        }
      } else {
        setHasPermission(true);
        loadData(token);
      }

      // Register Socket.IO listener for real-time wallet balance sync
      const socket = io(API, {
        auth: { token },
        transports: ["websocket"]
      });

      socket.on("wallet_updated", (data: any) => {
        console.log("[Wallet Ledger Socket] Real-time wallet update received:", data);
        setWallet((prev: any) => ({ ...prev, balancePKR: data.balancePKR }));
        loadData(token);
      });

      // Real-time commission lock-in when an order transitions to 'completed'
      socket.on("commission_due", (data: any) => {
        console.log("[Commission Socket] Commission locked in from completed order:", data);
        setWallet((prev: any) => ({
          ...prev,
          outstandingCommission: data.totalOutstanding
        }));
        loadData(token); // Refresh full transaction timeline
      });

      return () => {
        socket.disconnect();
      };
    }
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
        loadData();
      } else {
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
        setCountdownText(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [storeInfo]);

  // Handle manual top-up request
  const handleTopupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topupForm.amountPKR || !topupForm.referenceId || !receiptFile) {
      setTopupError("Please specify deposit amount, reference ID, and upload receipt.");
      return;
    }

    setTopupLoading(true);
    setTopupError("");
    setTopupResult(null);

    const token = localStorage.getItem("bazaar_token");
    const formData = new FormData();
    formData.append("amountPKR", topupForm.amountPKR);
    formData.append("referenceId", topupForm.referenceId);
    formData.append("type", topupForm.type);
    formData.append("receipt", receiptFile);

    try {
      const res = await fetch(`${API}/api/wallet/topup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      
      if (data.success && data.topup) {
        setTopupResult(data.topup); // Expose OCR analysis details to the user
        // Reset form inputs except visual review state
        setTopupForm({ amountPKR: "", referenceId: "", type: "topup" });
        setReceiptFile(null);
        setReceiptPreview(null);
        // Refresh underlying balances
        loadData();
      } else {
        setTopupError(data.message || "Failed to submit top-up request");
      }
    } catch (err: any) {
      setTopupError("API communication failure during receipt submission");
    } finally {
      setTopupLoading(false);
    }
  };

  // Handle Pay Commission
  const handlePayCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payAmount || parseFloat(payAmount) <= 0) {
      setPayError("Please enter a valid settlement amount.");
      return;
    }
    if (parseFloat(payAmount) > wallet.balancePKR) {
      setPayError("Insufficient wallet balance for this payment.");
      return;
    }
    if (parseFloat(payAmount) > wallet.outstandingCommission) {
      setPayError("Payment exceeds outstanding commission due.");
      return;
    }

    setPayLoading(true);
    setPayError("");
    setPaySuccess("");

    const token = localStorage.getItem("bazaar_token");

    try {
      const res = await fetch(`${API}/api/wallet/pay-commission`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amountPKR: parseFloat(payAmount) })
      });
      const data = await res.json();

      if (data.success) {
        setPaySuccess(`Successfully settled PKR ${payAmount} outstanding commission directly from your wallet balance.`);
        setPayAmount("");
        loadData();
        setTimeout(() => {
          setShowPayComm(false);
          setPaySuccess("");
        }, 3000);
      } else {
        setPayError(data.message || "Commission payment rejected by gateway");
      }
    } catch (err) {
      setPayError("Network connection failure. Commission pay action terminated.");
    } finally {
      setPayLoading(false);
    }
  };

  // Sandbox actions
  const triggerSandboxAction = async (action: "credit" | "debit") => {
    setSandboxLoading(true);
    const token = localStorage.getItem("bazaar_token");
    const endpoint = action === "credit" ? "/sandbox-credit" : "/sandbox-debit";
    const body = action === "credit" 
      ? { amountPKR: 5000 } 
      : { amountPKR: 250, reason: "Sandbox testing placement charge" };

    try {
      const res = await fetch(`${API}/api/wallet${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        loadData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSandboxLoading(false);
    }
  };

  const handleSandboxWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sandboxWithdrawAmt || parseFloat(sandboxWithdrawAmt) <= 0) {
      setSandboxActionError("Please enter a valid withdrawal amount.");
      return;
    }
    setSandboxLoading(true);
    setSandboxActionError("");
    setSandboxActionSuccess("");

    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/wallet/withdraw`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amountPKR: parseFloat(sandboxWithdrawAmt) })
      });
      const data = await res.json();
      if (data.success) {
        setSandboxActionSuccess(`Withdrawal of PKR ${sandboxWithdrawAmt} simulated successfully.`);
        setSandboxWithdrawAmt("");
        loadData();
      } else {
        setSandboxActionError(data.message || "Failed to process withdrawal");
      }
    } catch (err: any) {
      setSandboxActionError("Failed to communicate with billing gateway");
    } finally {
      setSandboxLoading(false);
    }
  };

  const handleSandboxTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sandboxTransferAmt || parseFloat(sandboxTransferAmt) <= 0 || !sandboxTransferSlug) {
      setSandboxActionError("Please enter a valid transfer amount and target store slug.");
      return;
    }
    setSandboxLoading(true);
    setSandboxActionError("");
    setSandboxActionSuccess("");

    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/wallet/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          amountPKR: parseFloat(sandboxTransferAmt),
          targetStoreSlug: sandboxTransferSlug
        })
      });
      const data = await res.json();
      if (data.success) {
        setSandboxActionSuccess(`Transfer of PKR ${sandboxTransferAmt} to ${sandboxTransferSlug} simulated successfully.`);
        setSandboxTransferAmt("");
        setSandboxTransferSlug("");
        loadData();
      } else {
        setSandboxActionError(data.message || "Failed to process transfer");
      }
    } catch (err: any) {
      setSandboxActionError("Failed to communicate with billing gateway");
    } finally {
      setSandboxLoading(false);
    }
  };

  // Receipt preview handler
  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setReceiptFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setReceiptPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleExportLedgerCSV = () => {
    setExportingLedger(true);
    setExportProgress(0);

    const headers = [
      "Timestamp",
      "Reference ID",
      "Transaction Type",
      "Reconciliation Details",
      "Amount (PKR)",
      "Settlement Status"
    ];

    const rows = filteredTransactions.map((tx: any) => {
      const typeLabel = tx.type === "deposit" 
        ? "DEPOSIT" 
        : tx.type === "commission_payout" 
          ? "SETTLEMENT" 
          : tx.type === "ad_bid" 
            ? "AD EXPENSE" 
            : "COMMISSION";
      
      const isCredit = tx.direction === "credit";
      const signedAmount = `${isCredit ? "+" : "-"}${tx.amountPKR}`;

      const statusLabel = tx.type === "order_commission"
        ? tx.status === "approved"
          ? "Due Now"
          : "Accruing"
        : tx.status === "approved"
          ? "Cleared"
          : tx.status === "pending_approval"
            ? "Review Pending"
            : tx.status === "pending"
              ? "Accruing"
              : "Failed / Rejected";

      return [
        new Date(tx.createdAt).toLocaleString("en-PK", {
          dateStyle: "short",
          timeStyle: "short"
        }),
        tx.referenceId || "N/A",
        typeLabel,
        tx.description || "",
        signedAmount,
        statusLabel
      ];
    });

    const dateStr = new Date().toISOString().split('T')[0];
    const storeSlug = storeInfo?.slug || "vendor";
    const fileName = `bazaarboost-ledger-${storeSlug}-${dateStr}.csv`;

    startCSVExportWorker(
      headers,
      rows,
      fileName,
      (progress) => setExportProgress(progress),
      () => {
        setExportingLedger(false);
      }
    );
  };

  const handleViewReceipt = async (orderId: string) => {
    setFetchingOrder(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.order) {
        setSelectedOrder(data.order);
        setShowInvoiceModal(true);
      } else {
        alert(data.message || "Failed to retrieve order details.");
      }
    } catch (err) {
      alert("Network connection error. Failed to retrieve order details.");
    } finally {
      setFetchingOrder(false);
    }
  };

  // Print function
  const handlePrint = () => {
    window.print();
  };

  // Filtering ledger logs
  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = t.referenceId?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    let matchesType = true;
    if (typeFilter !== "all") {
      if (typeFilter === "deposit") matchesType = t.type === "deposit";
      else if (typeFilter === "ad_bid") matchesType = t.type === "ad_bid";
      else if (typeFilter === "order_commission") matchesType = t.type === "order_commission";
      else if (typeFilter === "payout") matchesType = t.type === "commission_payout";
    }

    let matchesStatus = true;
    if (statusFilter !== "all") {
      matchesStatus = t.status === statusFilter;
    }

    return matchesSearch && matchesType && matchesStatus;
  });

  if (hasPermission === false) {
    return (
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar role="vendor" />
        <div style={{ flex: 1, padding: "2rem", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--bg-primary)" }}>
          <div className="glass-card" style={{ maxWidth: "450px", padding: "2.5rem", textAlign: "center", border: "1px solid rgba(239,68,68,0.2)" }}>
            <Lock size={48} style={{ color: "var(--danger)", marginBottom: "1rem" }} />
            <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>Access Denied</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.6 }}>
              You do not have administrative permissions to view billing or financial records. 
              Please contact your primary store administrator to grant `VIEW_BILLING` access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Hide Sidebar on Print */}
      <div className="no-print">
        <Sidebar role="vendor" />
      </div>

      <div className={showInvoiceModal ? "no-print" : "print-container"} style={{ flex: 1, padding: "2.5rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
        
        {/* Style block for Print override controls */}
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            .no-print {
              display: none !important;
            }
            body, html {
              background: #ffffff !important;
              color: #000000 !important;
            }
            ${showInvoiceModal ? `
              body * {
                visibility: hidden !important;
              }
              #print-area, #print-area * {
                visibility: visible !important;
              }
              #print-area {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                color: #000000 !important;
                background: #ffffff !important;
              }
              @page {
                size: A4 portrait;
                margin: 1cm;
              }
            ` : `
              main, div, table, tr, td, th {
                background: transparent !important;
                color: #000000 !important;
                border-color: #cccccc !important;
                box-shadow: none !important;
                text-shadow: none !important;
              }
              .print-container {
                width: 100% !important;
                max-width: 100% !important;
                padding: 0 !important;
                margin: 0 !important;
              }
              .glass-card {
                border: 1px solid #000000 !important;
                border-radius: 0 !important;
                margin-bottom: 20px !important;
                padding: 15px !important;
              }
              .status-badge {
                border: 1px solid #000000 !important;
                color: #000000 !important;
                background: transparent !important;
              }
            `}
          }
        `}} />

        {/* 1. Header Section */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }} className="print-container">
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800 }} className="gradient-text">Wallet & Billing Center</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", marginTop: "0.2rem" }}>
              Monitor balances, settle commissions, request top-ups, and audit financial records.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }} className="no-print">
            <StoreSwitcher />
            
            <button onClick={handlePrint} className="btn-secondary" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Printer size={15} /> Print Statement
            </button>

            <button 
              onClick={handleExportLedgerCSV} 
              disabled={exportingLedger} 
              className="btn-secondary" 
              style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
            >
              {exportingLedger ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  <span>Exporting ({exportProgress}%)</span>
                </>
              ) : (
                <>
                  <span>📥 Export CSV</span>
                </>
              )}
            </button>

            <button onClick={() => setShowTopup(true)} className="btn-primary" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Plus size={15} /> Request Wallet Top-up
            </button>
          </div>
        </div>

        {/* Orange Zone Warning Banner */}
        {storeInfo && storeInfo.debtZone === 'orange' && (
          <div style={{
            background: "rgba(245,158,11,0.1)",
            border: "1px solid #f59e0b",
            borderRadius: 12,
            padding: "1rem 1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem"
          }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#f59e0b", display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
              <AlertCircle size={18} /> Soft Debt Alert (Orange Zone)
            </h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
              Warning: You have outstanding platform commission debt. Standard active operations are maintained, but please settle your unpaid commissions below to avoid moving to Amber/Red Zones.
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
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#f97316", display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
              <AlertCircle size={20} /> Ad Campaign Freeze & Suspension Ultimatum (Amber Zone)
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

        {error && (
          <div className="glass-card" style={{ padding: "1rem", border: "1px solid rgba(239, 68, 68, 0.2)", display: "flex", alignItems: "center", gap: "0.75rem", color: "var(--danger)" }}>
            <AlertCircle size={20} />
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{error}</span>
            <button onClick={() => loadData()} style={{ background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer", marginLeft: "auto", display: "flex", alignItems: "center" }}>
              <RefreshCw size={14} />
            </button>
          </div>
        )}

        {/* 2. Visual Overview Metrics Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.25rem" }} className="print-container">
          
          {/* Card 1: Balance */}
          <div className="glass-card" style={{ padding: "1.5rem", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 12, right: 12, width: 35, height: 35, borderRadius: "50%", background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Wallet size={16} style={{ color: "var(--success)" }} />
            </div>
            <p style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.05em" }}>Current Wallet Balance</p>
            <h2 style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: "0.5rem", color: "var(--success)", display: "flex", alignItems: "baseline", gap: "0.2rem" }}>
              {wallet.balancePKR?.toLocaleString()} <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>PKR</span>
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
              <RefreshCw size={10} /> Real-time active ledger balance
            </div>
          </div>

          {/* Card 2: Deposited */}
          <div className="glass-card" style={{ padding: "1.5rem", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 12, right: 12, width: 35, height: 35, borderRadius: "50%", background: "rgba(59,130,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ArrowUpRight size={16} style={{ color: "#3b82f6" }} />
            </div>
            <p style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.05em" }}>Total Funds Deposited</p>
            <h2 style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: "0.5rem", color: "#3b82f6", display: "flex", alignItems: "baseline", gap: "0.2rem" }}>
              {wallet.totalDepositedPKR?.toLocaleString()} <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>PKR</span>
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
              Cumulative manual top-up deposits
            </div>
          </div>

          {/* Card 3: Spent */}
          <div className="glass-card" style={{ padding: "1.5rem", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 12, right: 12, width: 35, height: 35, borderRadius: "50%", background: "rgba(168,85,247,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ArrowDownRight size={16} style={{ color: "var(--accent-secondary)" }} />
            </div>
            <p style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.05em" }}>Total Budget Spent</p>
            <h2 style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: "0.5rem", color: "var(--accent-secondary)", display: "flex", alignItems: "baseline", gap: "0.2rem" }}>
              {wallet.totalSpentPKR?.toLocaleString()} <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>PKR</span>
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
              Debited for ads and platform commission
            </div>
          </div>

          {/* Card 4: Commission Dashboard */}
          <div className="glass-card" style={{ 
            padding: "1.5rem", 
            position: "relative", 
            overflow: "hidden", 
            border: wallet.outstandingCommission > 0 ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--border-subtle)" 
          }}>
            <div style={{ position: "absolute", top: 12, right: 12, width: 35, height: 35, borderRadius: "50%", background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <DollarSign size={16} style={{ color: "var(--danger)" }} />
            </div>
            <p style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.05em" }}>5% Platform Commission</p>

            {/* Outstanding (Due) */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "0.5rem" }}>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 800, color: wallet.outstandingCommission > 0 ? "var(--danger)" : "var(--text-muted)", display: "flex", alignItems: "baseline", gap: "0.2rem" }}>
                {(wallet.outstandingCommission || 0).toLocaleString()} <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>PKR</span>
              </h2>
              {wallet.outstandingCommission > 0 && (
                <button onClick={() => setShowPayComm(true)} className="btn-primary no-print" style={{ fontSize: "0.7rem", padding: "0.3rem 0.6rem", borderRadius: "6px", boxShadow: "none" }}>
                  Settle Now
                </button>
              )}
            </div>
            <p style={{ fontSize: "0.68rem", color: "var(--danger)", fontWeight: 600, marginBottom: "0.6rem" }}>Due Now — from completed orders</p>

            {/* Divider */}
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.6rem", marginTop: "0.25rem" }}>
              {/* Accruing (In-flight) */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem", marginBottom: "0.25rem" }}>
                <span style={{ color: "var(--text-muted)" }}>⏳ Accruing (in-flight orders):</span>
                <span style={{ fontWeight: 700, color: "#f59e0b" }}>PKR {(wallet.pendingCommission || 0).toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem" }}>
                <span style={{ color: "var(--text-muted)" }}>📦 {wallet.totalOrdersCount || 0} total tracked orders</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>Locked on completion</span>
              </div>
            </div>
          </div>

        </div>

        {/* BazaarBoost Micro-Financing & Capital Safeguards Console */}
        {creditScoreData && (
          <div className="glass-card animate-fade-up" style={{ padding: "1.75rem", margin: "1.5rem 0", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                🚀 Escrow-Locked Inventory Micro-Financing Console
              </h3>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>
                Activating low-risk capital loans based on your monthly rolling GMV sales volume and order fulfillment success scores.
              </p>
            </div>

            {loanSuccess && (
              <div style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.25)", borderRadius: "8px", padding: "0.6rem 0.8rem", fontSize: "0.78rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <CheckCircle size={14} /> <span>{loanSuccess}</span>
              </div>
            )}

            {loanError && (
              <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)", borderRadius: "8px", padding: "0.6rem 0.8rem", fontSize: "0.78rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <AlertCircle size={14} /> <span>{loanError}</span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.25rem" }}>
              {/* Credit Score Indicator */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "1rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase" }}>BazaarBoost Credit Score</span>
                <div style={{
                  fontSize: "2rem",
                  fontWeight: 900,
                  color: creditScoreData.creditScore >= 700 ? "#10b981" : creditScoreData.creditScore >= 650 ? "#a855f7" : "#ef4444",
                  margin: "0.5rem 0"
                }}>
                  {creditScoreData.creditScore}
                </div>
                <span style={{
                  fontSize: "0.68rem",
                  background: creditScoreData.creditScore >= 700 ? "rgba(16,185,129,0.12)" : creditScoreData.creditScore >= 650 ? "rgba(168,85,247,0.12)" : "rgba(239,68,68,0.12)",
                  color: creditScoreData.creditScore >= 700 ? "#10b981" : creditScoreData.creditScore >= 650 ? "#a855f7" : "#ef4444",
                  padding: "0.15rem 0.4rem",
                  borderRadius: "6px",
                  fontWeight: 700
                }}>
                  {creditScoreData.creditScore >= 700 ? "Excellent Risk" : creditScoreData.creditScore >= 650 ? "Good (Eligible)" : "Poor Credit"}
                </span>
              </div>

              {/* Monthly GMV Tracker */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "1rem", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase" }}>Monthly GMV (30d)</span>
                <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "#ffffff", marginTop: "0.4rem" }}>
                  Rs. {creditScoreData.monthlyGmv.toLocaleString()}
                </div>
                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                  Fulfillment Rate: {(creditScoreData.fulfillmentRate * 100).toFixed(1)}%
                </span>
              </div>

              {/* Escrow upcoming payout */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "1rem", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase" }}>Upcoming Payouts</span>
                <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "#a855f7", marginTop: "0.4rem" }}>
                  Rs. {creditScoreData.upcomingPayouts.toLocaleString()}
                </div>
                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                  In-flight orders cash backing
                </span>
              </div>

              {/* Loan Offer eligibility */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "1rem", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase" }}>Available Loan Limit</span>
                <div style={{ fontSize: "1.45rem", fontWeight: 800, color: creditScoreData.eligible ? "#10b981" : "var(--text-muted)", marginTop: "0.4rem" }}>
                  Rs. {creditScoreData.maxLoanAmount.toLocaleString()}
                </div>
                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                  Flat fee: {creditScoreData.interestRate * 100}% flat interest
                </span>
              </div>
            </div>

            {/* Loan status / Action Tray */}
            <div style={{ background: "rgba(0,0,0,0.12)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "1.25rem" }}>
              {creditScoreData.activeLoan ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
                    <div>
                      <span style={{ fontSize: "0.68rem", textTransform: "uppercase", color: "#a855f7", fontWeight: 700 }}>Active Inventory Loan</span>
                      <h4 style={{ fontSize: "1.1rem", fontWeight: 800, marginTop: "0.2rem" }}>
                        Rs. {creditScoreData.activeLoan.amount.toLocaleString()} <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 500 }}>(Repayment due: Rs. {creditScoreData.activeLoan.repaymentAmount.toLocaleString()})</span>
                      </h4>
                      <p style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                        ℹ️ Repayment is secured directly by upcoming platform payouts. Payouts will automatically settle this loan.
                      </p>
                    </div>
                    <button
                      onClick={handleRepayLoan}
                      disabled={repayingLoan || wallet.balancePKR < creditScoreData.activeLoan.repaymentAmount}
                      className="btn-primary"
                      style={{
                        padding: "0.5rem 1.25rem",
                        background: "linear-gradient(135deg, #10b981, #059669)",
                        border: "none",
                        cursor: wallet.balancePKR >= creditScoreData.activeLoan.repaymentAmount ? "pointer" : "not-allowed",
                        opacity: wallet.balancePKR >= creditScoreData.activeLoan.repaymentAmount ? 1 : 0.5
                      }}
                    >
                      {repayingLoan ? "Settle Repayment..." : "Settle Loan from Wallet"}
                    </button>
                  </div>

                  {/* Operational Risk Lifecycle Matrix Progress Tracker */}
                  {creditScoreData.loanAgeDays !== null && (
                    <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem", marginTop: "0.5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem", fontSize: "0.74rem" }}>
                        <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
                          Operational Risk Status: <strong style={{ 
                            color: creditScoreData.loanAgeDays >= 60 ? "#ef4444" : (creditScoreData.loanAgeDays >= 30 ? "#f59e0b" : "#a855f7")
                          }}>{creditScoreData.riskTier}</strong>
                        </span>
                        <span style={{ color: "var(--text-muted)", fontFamily: "monospace" }}>
                          Day {Math.floor(creditScoreData.loanAgeDays)} of 60
                        </span>
                      </div>

                      {/* Progress track bar */}
                      <div style={{ height: "6px", width: "100%", background: "rgba(255,255,255,0.05)", borderRadius: "3px", overflow: "hidden", position: "relative" }}>
                        <div style={{ 
                          height: "100%", 
                          width: `${Math.min(100, (creditScoreData.loanAgeDays / 60) * 100)}%`,
                          background: creditScoreData.loanAgeDays >= 60 ? "#ef4444" : (creditScoreData.loanAgeDays >= 45 ? "#f59e0b" : "#a855f7"),
                          borderRadius: "3px",
                          transition: "width 0.4s ease-out"
                        }} />
                        {/* 50% centerline marker */}
                        <div style={{ position: "absolute", left: "50%", top: 0, width: "1px", height: "100%", background: "rgba(255,255,255,0.25)" }} />
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                        <span>Excellent Risk</span>
                        <span>50% Centerline Benchmark</span>
                        <span>Maturity Default (Day 60)</span>
                      </div>

                      {/* Lifecycle Alerts Notification Strategy */}
                      {creditScoreData.loanAgeDays >= 60 && (
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.75rem", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", color: "#f87171", fontSize: "0.74rem", marginTop: "0.75rem" }}>
                          <AlertTriangle size={14} className="shrink-0 animate-bounce" />
                          <span><strong>🚫 SYSTEM DEFAULT FREEZE:</strong> Store panel negotiations and checkouts are locked due to defaulted loan balance exceeding 60-day window. Settle balance to restore visibility.</span>
                        </div>
                      )}

                      {creditScoreData.loanAgeDays >= 45 && creditScoreData.loanAgeDays < 60 && (
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.75rem", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "8px", color: "#fbbf24", fontSize: "0.74rem", marginTop: "0.75rem" }}>
                          <AlertTriangle size={14} className="shrink-0 animate-pulse" />
                          <span><strong>🚨 LATE ESCALATION WARNING:</strong> Automated 48-hour risk check active. Counter risk factors recalculating. Top up store wallet immediately to avoid system suspension.</span>
                        </div>
                      )}

                      {creditScoreData.loanAgeDays >= 30 && creditScoreData.loanAgeDays < 45 && (
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.75rem", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: "8px", color: "#f59e0b", fontSize: "0.74rem", marginTop: "0.75rem" }}>
                          <Info size={14} className="shrink-0" />
                          <span><strong>⚠️ HALFWAY CHECKPOINT BENCHMARK:</strong> 50% target collection split check active. Review statement summary to monitor rolling GMV health.</span>
                        </div>
                      )}

                      {creditScoreData.loanAgeDays < 30 && (
                        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.5rem", fontStyle: "italic" }}>
                          &gt; Days 1-29 Standard Repaying Status: Wallet-split streams are silently resolving loan balance. Zero prompt alerts.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {creditScoreData.eligible ? (
                    <form onSubmit={handleApplyLoan} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: "220px" }}>
                        <span style={{ fontSize: "0.68rem", textTransform: "uppercase", color: "#10b981", fontWeight: 700, display: "block", marginBottom: "0.3rem" }}>Request Short-term Inventory Loan</span>
                        <input
                          type="number"
                          min="1"
                          max={creditScoreData.maxLoanAmount}
                          placeholder={`Amount up to Rs. ${creditScoreData.maxLoanAmount}...`}
                          value={loanAmount}
                          onChange={e => setLoanAmount(e.target.value)}
                          className="input-field"
                          style={{ height: "38px" }}
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={applyingLoan || !loanAmount}
                        className="btn-primary"
                        style={{ alignSelf: "flex-end", height: "38px", padding: "0 1.5rem" }}
                      >
                        {applyingLoan ? "Disbursing Funds..." : "Apply & Disburse Now"}
                      </button>
                    </form>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                      <Lock size={15} />
                      <span>
                        {creditScoreData.creditScore < 650 
                          ? `Loan eligibility locked: credit score is ${creditScoreData.creditScore}/850. Maintain high fulfillment rates and generate more sales GMV to reach the 650 eligibility score.` 
                          : "Loan eligibility locked: you do not have enough monthly sales GMV to generate credit lines. Settle outstanding platform commissions to enable credit scoring."}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. Transaction Timeline Ledger */}
        <div style={{ padding: "1.75rem" }} className="print-container glass-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Transaction Ledger & Audit Trail</h3>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>
                A continuous, immutable record of all deposits, ad bid expenses, and sales commission splits.
              </p>
            </div>

            {/* Filter controls — Hide on print */}
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }} className="no-print">
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <Search size={14} style={{ position: "absolute", left: 10, color: "var(--text-muted)" }} />
                <input 
                  type="text" 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)} 
                  placeholder="Search Reference / Desc..." 
                  className="input-field" 
                  style={{ paddingLeft: "2rem", width: "200px", fontSize: "0.78rem", height: "35px" }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <Filter size={14} style={{ color: "var(--text-muted)" }} />
                <select 
                  value={typeFilter} 
                  onChange={e => setTypeFilter(e.target.value)}
                  className="input-field"
                  style={{ fontSize: "0.78rem", height: "35px", padding: "0 0.5rem" }}
                >
                  <option value="all">All Types</option>
                  <option value="deposit">Deposits</option>
                  <option value="ad_bid">Ad Placements</option>
                  <option value="order_commission">Order Commission</option>
                  <option value="payout">Commission Settlements</option>
                </select>
              </div>

              <select 
                value={statusFilter} 
                onChange={e => setStatusFilter(e.target.value)}
                className="input-field"
                style={{ fontSize: "0.78rem", height: "35px", padding: "0 0.5rem" }}
              >
                <option value="all">All Statuses</option>
                <option value="approved">Due Now / Cleared</option>
                <option value="pending">Accruing (Pending)</option>
                <option value="pending_approval">Awaiting Admin Review</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem", gap: "0.5rem" }}>
              <Loader className="animate-spin" size={24} style={{ color: "var(--accent-primary)" }} />
              <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Retrieving ledger statements...</span>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", border: "1px dashed var(--border-subtle)", borderRadius: "12px" }}>
              <Wallet size={36} style={{ color: "var(--text-muted)", marginBottom: "0.5rem" }} />
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No transaction ledger items found matching the selected criteria.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                    <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)" }}>Timestamp</th>
                    <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)" }}>Reference ID</th>
                    <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)" }}>Type</th>
                    <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)" }}>Reconciliation Details</th>
                    <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textAlign: "right" }}>Amount (PKR)</th>
                    <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textAlign: "center" }}>Status</th>
                    <th style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", textAlign: "center" }} className="no-print">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((tx: any) => {
                    const isCredit = tx.direction === "credit";
                    return (
                      <tr key={tx._id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "0.75rem 1rem", color: "var(--text-secondary)" }}>
                          {new Date(tx.createdAt).toLocaleString("en-PK", {
                            dateStyle: "short",
                            timeStyle: "short"
                          })}
                        </td>
                        <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace", fontWeight: 700 }}>
                          {tx.referenceId || "N/A"}
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <span style={{ 
                            padding: "0.15rem 0.4rem", 
                            borderRadius: "4px", 
                            fontSize: "0.7rem", 
                            fontWeight: 700,
                            background: tx.type === "deposit" ? "rgba(16,185,129,0.1)" : tx.type === "commission_payout" ? "rgba(59,130,246,0.1)" : "rgba(124,58,237,0.1)",
                            color: tx.type === "deposit" ? "var(--success)" : tx.type === "commission_payout" ? "#3b82f6" : "var(--accent-secondary)"
                          }}>
                            {tx.type === "deposit" ? "DEPOSIT" : tx.type === "commission_payout" ? "SETTLEMENT" : tx.type === "ad_bid" ? "AD EXPENSE" : "COMMISSION"}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 1rem", color: "var(--text-secondary)" }}>
                          {tx.description}
                        </td>
                        <td style={{ 
                          padding: "0.75rem 1rem", 
                          textAlign: "right", 
                          fontWeight: 700, 
                          color: isCredit ? "var(--success)" : "var(--danger)" 
                        }}>
                          {isCredit ? "+" : "-"}{tx.amountPKR?.toLocaleString()}
                        </td>
                        <td style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                            <span style={{
                              padding: "0.15rem 0.4rem", 
                              borderRadius: "4px", 
                              fontSize: "0.7rem", 
                              fontWeight: 700,
                              background: tx.status === "approved" ? "rgba(16,185,129,0.15)" 
                                : tx.status === "pending_approval" ? "rgba(245,158,11,0.15)" 
                                : tx.status === "pending" ? "rgba(245,158,11,0.1)"
                                : "rgba(239,68,68,0.15)",
                              color: tx.status === "approved" ? "var(--success)" 
                                : (tx.status === "pending_approval" || tx.status === "pending") ? "#f59e0b" 
                                : "var(--danger)"
                            }}>
                              {/* For order_commission, show lifecycle-specific labels */}
                              {tx.type === "order_commission" 
                                ? tx.status === "approved" 
                                  ? "Due Now" 
                                  : "Accruing"
                                : tx.status === "approved" 
                                  ? "Cleared" 
                                  : tx.status === "pending_approval" 
                                    ? "Review Pending" 
                                    : "Failed / Rejected"}
                            </span>
                            {/* Show order status pill for commission rows */}
                            {tx.type === "order_commission" && tx.orderStatus && (
                              <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                                order: {tx.orderStatus.replace("_", " ")}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem", textAlign: "center" }} className="no-print">
                          {tx.orderId ? (
                            <button
                              onClick={() => handleViewReceipt(tx.orderId)}
                              disabled={fetchingOrder}
                              className="btn-secondary"
                              style={{ 
                                padding: "0.25rem 0.5rem", 
                                fontSize: "0.7rem", 
                                display: "inline-flex", 
                                alignItems: "center", 
                                gap: "0.25rem",
                                height: "26px",
                                border: "1px solid var(--border-subtle)",
                                borderRadius: "4px"
                              }}
                              title="Print Receipt / Invoice"
                            >
                              <Printer size={10} /> Print Receipt
                            </button>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>—</span>
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



        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* MODAL 1: Settle Commission from Wallet Balance */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {showPayComm && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div className="glass-card" style={{ width: "400px", padding: "2rem", display: "flex", flexDirection: "column", gap: "1.25rem", border: "1px solid var(--border-accent)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Settle Commission</h3>
                <button onClick={() => setShowPayComm(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                  <X size={18} />
                </button>
              </div>

              <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Directly deduct outstanding platform commission from your available store wallet balance.
              </p>

              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "0.75rem", fontSize: "0.8rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)" }}>Available Wallet Balance:</span>
                  <span style={{ fontWeight: 700, color: "var(--success)" }}>PKR {wallet.balancePKR?.toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)" }}>Outstanding Commission Due:</span>
                  <span style={{ fontWeight: 700, color: "var(--danger)" }}>PKR {wallet.outstandingCommission?.toLocaleString()}</span>
                </div>
              </div>

              <form onSubmit={handlePayCommission} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.3rem", fontWeight: 600 }}>Payment Amount (PKR)</label>
                  <input 
                    type="number" 
                    value={payAmount} 
                    onChange={e => setPayAmount(e.target.value)} 
                    placeholder="e.g. 500" 
                    className="input-field" 
                    max={Math.min(wallet.balancePKR, wallet.outstandingCommission)}
                    min={1}
                    required
                  />
                </div>

                {paySuccess && (
                  <div style={{ display: "flex", gap: "0.4rem", color: "var(--success)", fontSize: "0.78rem", alignItems: "center" }}>
                    <CheckCircle size={14} /> <span>{paySuccess}</span>
                  </div>
                )}

                {payError && (
                  <div style={{ display: "flex", gap: "0.4rem", color: "var(--danger)", fontSize: "0.78rem", alignItems: "center" }}>
                    <AlertCircle size={14} /> <span>{payError}</span>
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button type="button" onClick={() => setShowPayComm(false)} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={payLoading} className="btn-primary" style={{ flex: 1, justifyContent: "center" }}>
                    {payLoading ? <Loader className="animate-spin" size={14} /> : "Pay Now"}
                  </button>
                </div>
              </form>

            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* MODAL 2: Request Manual Wallet Top-up with OCR Verification */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {showTopup && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div className="glass-card" style={{ width: "500px", padding: "2rem", display: "flex", flexDirection: "column", gap: "1.25rem", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Request Manual Wallet Top-up</h3>
                <button onClick={() => { setShowTopup(false); setTopupResult(null); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                  <X size={18} />
                </button>
              </div>

              {/* Show result slider if successfully verified by OCR */}
              {topupResult ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", textAlign: "center", padding: "1rem 0" }}>
                    <CheckCircle size={40} style={{ color: "var(--success)" }} />
                    <h4 style={{ fontWeight: 700 }}>Receipt Submitted Successfully!</h4>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      Our AI-powered OCR auditing engine has processed your transaction receipt immediately.
                    </p>
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "10px", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem", fontSize: "0.8rem", border: "1px solid var(--border-subtle)" }}>
                    <div style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.4rem", fontWeight: 700, color: "var(--accent-secondary)", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>
                      AI OCR Audit Feedback
                    </div>
                    
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-muted)" }}>Reference ID Verified:</span>
                      <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{topupResult.referenceId}</span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-muted)" }}>Deposited Amount:</span>
                      <span style={{ fontWeight: 700 }}>PKR {topupResult.amountPKR?.toLocaleString()}</span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-muted)" }}>OCR Extracted Amount:</span>
                      <span style={{ fontWeight: 700, color: topupResult.ocrResult?.detectedAmount ? "var(--success)" : "var(--warning)" }}>
                        {topupResult.ocrResult?.detectedAmount ? `PKR ${topupResult.ocrResult.detectedAmount}` : "Unparsed"}
                      </span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-muted)" }}>Detected Bank Title:</span>
                      <span style={{ fontWeight: 600 }}>{topupResult.ocrResult?.detectedBank || "Unknown Bank"}</span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-muted)" }}>Duplication Check:</span>
                      <span style={{ fontWeight: 700, color: topupResult.isDuplicate ? "var(--danger)" : "var(--success)" }}>
                        {topupResult.isDuplicate ? "Duplicate Flagged ⚠️" : "Clear (No duplication)"}
                      </span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-muted)" }}>AI Suspicion Warning:</span>
                      <span style={{ fontWeight: 700, color: topupResult.ocrResult?.isSuspectedFake ? "var(--danger)" : "var(--success)" }}>
                        {topupResult.ocrResult?.isSuspectedFake ? "High Fraud Risk" : "Low Risk (Trusted)"}
                      </span>
                    </div>
                  </div>

                  <div className="glass-card" style={{ padding: "0.75rem", fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <Shield size={14} style={{ color: "var(--success)" }} />
                    <span>This top-up request is now pending final administrative clearance. Standard SLA is under 5 mins.</span>
                  </div>

                  <button onClick={() => { setShowTopup(false); setTopupResult(null); }} className="btn-primary" style={{ justifyContent: "center" }}>
                    Close Window
                  </button>
                </div>
              ) : (
                <form onSubmit={handleTopupSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  
                  {/* Bank detail instruction frame */}
                  <div style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.1), rgba(59,130,246,0.05))", borderRadius: "10px", padding: "1rem", border: "1px dashed var(--border-accent)" }}>
                    <h5 style={{ fontWeight: 700, fontSize: "0.8rem", color: "var(--text-primary)", marginBottom: "0.4rem" }}>BazaarBoost Platform Banking Address</h5>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      Please transfer the amount to the following corporate account and save the transaction screenshot:
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.75rem", marginTop: "0.6rem", fontFamily: "monospace" }}>
                      <div>Bank: <strong>Habib Bank Limited (HBL)</strong></div>
                      <div>Title: <strong>BazaarBoost Platform Operations</strong></div>
                      <div>Acct #: <strong>1209-90812739-03</strong></div>
                      <div>IBAN: <strong>PK82HABB0012099081273903</strong></div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.3rem", fontWeight: 600 }}>Amount (PKR)</label>
                      <input 
                        type="number" 
                        value={topupForm.amountPKR} 
                        onChange={e => setFormForm("amountPKR", e.target.value)}
                        placeholder="e.g. 5000" 
                        className="input-field" 
                        min={1}
                        step="0.01"
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.3rem", fontWeight: 600 }}>Transaction Ref ID</label>
                      <input 
                        type="text" 
                        value={topupForm.referenceId} 
                        onChange={e => setFormForm("referenceId", e.target.value)}
                        placeholder="e.g. HBL108273" 
                        className="input-field" 
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.3rem", fontWeight: 600 }}>Request Destination</label>
                    <div style={{ display: "flex", gap: "0.75rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", cursor: "pointer" }}>
                        <input 
                          type="radio" 
                          name="type" 
                          checked={topupForm.type === "topup"} 
                          onChange={() => setFormForm("type", "topup")}
                        />
                        Top-up Balance
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", cursor: "pointer" }}>
                        <input 
                          type="radio" 
                          name="type" 
                          checked={topupForm.type === "commission_payment"} 
                          onChange={() => setFormForm("type", "commission_payment")}
                        />
                        Settle Commission Debt
                      </label>
                    </div>
                  </div>

                  {/* Drag-and-drop receipt file input */}
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Bank Transfer Slip Receipt</label>
                    <div style={{ border: "1px dashed var(--border-subtle)", borderRadius: "10px", padding: "1.25rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", background: "rgba(255,255,255,0.01)", textAlign: "center", position: "relative" }}>
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleReceiptChange} 
                        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, cursor: "pointer" }}
                        required
                      />
                      <Upload size={24} style={{ color: "var(--text-muted)" }} />
                      <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                        {receiptFile ? receiptFile.name : "Click or drag files here to upload receipt"}
                      </span>
                      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Supports PNG, JPG, JPEG up to 5MB</span>
                    </div>

                    {receiptPreview && (
                      <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "center" }}>
                        <img 
                          src={receiptPreview} 
                          alt="Receipt Preview" 
                          style={{ maxWidth: "100px", maxHeight: "100px", borderRadius: "6px", objectFit: "contain", border: "1px solid var(--border-subtle)" }} 
                        />
                      </div>
                    )}
                  </div>

                  {topupError && (
                    <div style={{ display: "flex", gap: "0.4rem", color: "var(--danger)", fontSize: "0.78rem", alignItems: "center" }}>
                      <AlertCircle size={14} /> <span>{topupError}</span>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <button type="button" onClick={() => { setShowTopup(false); setReceiptPreview(null); }} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>
                      Cancel
                    </button>
                    <button type="submit" disabled={topupLoading} className="btn-primary" style={{ flex: 1, justifyContent: "center" }}>
                      {topupLoading ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                          <Loader className="animate-spin" size={14} /> Running AI OCR...
                        </div>
                      ) : (
                        "Upload & Verify"
                      )}
                    </button>
                  </div>

                </form>
              )}

            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* MODAL 3: Printable Shipping Invoice Modal (dual-purpose receipt) */}
        {/* ─────────────────────────────────────────────────────────────────── */}

      </div>

      {showInvoiceModal && selectedOrder && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="glass-card animate-fade-up" style={{ padding: "2rem", maxWidth: "600px", width: "95%", maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--border-accent)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Print Packing Slip / Shipping Invoice</h3>
              <button onClick={() => { setShowInvoiceModal(false); setSelectedOrder(null); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
            </div>

            {/* Printable Area Wrapper */}
            <div id="print-area" style={{ background: "#ffffff", border: "1px solid #000000", padding: "2rem", color: "#000000", fontFamily: "monospace", fontSize: "0.85rem", lineHeight: 1.6 }}>
              
              {/* Invoice Header */}
              <div style={{ borderBottom: "2px solid #000000", paddingBottom: "1rem", marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h2 style={{ fontSize: "1.25rem", fontWeight: 800, textTransform: "uppercase", color: "#000000", margin: 0 }}>BAZAARBOOST INVOICE</h2>
                  <p style={{ fontSize: "0.75rem", margin: "0.2rem 0 0 0", color: "#333333" }}>Order Reference: #{selectedOrder._id}</p>
                  <p style={{ fontSize: "0.75rem", margin: 0, color: "#333333" }}>Date: {new Date(selectedOrder.createdAt).toLocaleDateString()}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase" }}>{storeInfo?.name || "Merchant Store"}</div>
                  <span style={{ fontSize: "0.7rem", border: "1px solid #000000", padding: "0.2rem 0.5rem", borderRadius: "4px", fontWeight: 700, textTransform: "uppercase", display: "inline-block", marginTop: "0.4rem" }}>
                    {selectedOrder.deliveryType} Delivery
                  </span>
                </div>
              </div>

              {/* Grid Customer and Shipping details */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
                <div>
                  <strong style={{ textTransform: "uppercase", fontSize: "0.78rem", display: "block", marginBottom: "0.4rem" }}>Customer Details</strong>
                  <p style={{ fontWeight: 700, margin: 0 }}>{selectedOrder.shopperId?.name || "Shopper Client"}</p>
                  <p style={{ margin: 0, color: "#333333" }}>{selectedOrder.shopperId?.email || ""}</p>
                </div>
                <div>
                  <strong style={{ textTransform: "uppercase", fontSize: "0.78rem", display: "block", marginBottom: "0.4rem" }}>Destination Address</strong>
                  <p style={{ fontWeight: 700, margin: 0 }}>{selectedOrder.city}</p>
                  <p style={{ margin: 0, color: "#333333" }}>{selectedOrder.shippingAddress}</p>
                </div>
              </div>

              {/* Localized Fulfillment Custom notes */}
              {selectedOrder.customNotes && (
                <div style={{ border: "1px dashed #000000", borderRadius: "8px", padding: "0.85rem", marginBottom: "1.5rem" }}>
                  <strong style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Fulfillment Instructions:</strong>
                  <p style={{ margin: "0.2rem 0 0 0", color: "#333333" }}>&ldquo;{selectedOrder.customNotes}&rdquo;</p>
                </div>
              )}

              {/* Order Line Items */}
              <div style={{ marginBottom: "1.5rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #000000", textAlign: "left", fontSize: "0.75rem", fontWeight: 700 }}>
                      <th style={{ paddingBottom: "0.5rem" }}>Item Description</th>
                      <th style={{ paddingBottom: "0.5rem", textAlign: "center" }}>Qty</th>
                      <th style={{ paddingBottom: "0.5rem", textAlign: "right" }}>Price</th>
                      <th style={{ paddingBottom: "0.5rem", textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOrder.items || []).map((it: any, index: number) => (
                      <tr key={index} style={{ borderBottom: "1px solid #dddddd" }}>
                        <td style={{ padding: "0.5rem 0" }}>{it.title || "Product item"}</td>
                        <td style={{ padding: "0.5rem 0", textAlign: "center" }}>{it.quantity}</td>
                        <td style={{ padding: "0.5rem 0", textAlign: "right" }}>Rs. {it.price}</td>
                        <td style={{ padding: "0.5rem 0", textAlign: "right" }}>Rs. {it.price * it.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Logistics context */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem", borderTop: "1px solid #000000", paddingTop: "1rem" }}>
                <div>
                  <strong style={{ textTransform: "uppercase", fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Payment Details</strong>
                  <p style={{ margin: 0 }}>Payment Method: <span style={{ fontWeight: 700 }}>{selectedOrder.paymentMethod === "cod" ? "Cash on Delivery (COD)" : "Prepaid Wallet"}</span></p>
                </div>
                <div>
                  <strong style={{ textTransform: "uppercase", fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Shipping & Tracking</strong>
                  {selectedOrder.deliveryType === "in-city" ? (
                    <p style={{ margin: 0 }}>Rider: <span style={{ fontWeight: 700 }}>{selectedOrder.driverName || "Assigned Rider"} ({selectedOrder.driverContact || "N/A"})</span></p>
                  ) : (
                    <p style={{ margin: 0 }}>Courier: <span style={{ fontWeight: 700 }}>{selectedOrder.courierName || "TCS"}</span> | Track ID: <span style={{ fontWeight: 700 }}>{selectedOrder.trackingId || "N/A"}</span></p>
                  )}
                </div>
              </div>

              {/* Platform Split & Final calculations */}
              <div style={{ borderTop: "2px solid #000000", paddingTop: "1rem", display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "1rem" }}>
                <div style={{ fontSize: "0.72rem", border: "1px dashed #cccccc", padding: "0.6rem", borderRadius: "8px" }}>
                  <strong style={{ display: "block", marginBottom: "0.2rem", textTransform: "uppercase" }}>Financial Split Audit</strong>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.15rem" }}>
                    <span>Platform Commission (5%):</span>
                    <span>Rs. {(selectedOrder.platformCommission || ((selectedOrder.totalAmount - (selectedOrder.shippingPremium || 0)) * 0.05)).toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                    <span>Net Vendor Yield:</span>
                    <span>Rs. {(selectedOrder.totalAmount - (selectedOrder.platformCommission || ((selectedOrder.totalAmount - (selectedOrder.shippingPremium || 0)) * 0.05))).toLocaleString()}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", alignItems: "flex-end" }}>
                  <div style={{ width: "220px", display: "flex", justifyContent: "space-between" }}>
                    <span>Shipping Premium:</span>
                    <span>Rs. {selectedOrder.shippingPremium || 0}</span>
                  </div>
                  {selectedOrder.marketingDiscount > 0 && (
                    <div style={{ width: "220px", display: "flex", justifyContent: "space-between", color: "#ef4444" }}>
                      <span>Discount ({selectedOrder.couponCode}):</span>
                      <span>- Rs. {selectedOrder.marketingDiscount}</span>
                    </div>
                  )}
                  <div style={{ width: "220px", display: "flex", justifyContent: "space-between", borderTop: "1.5px solid #000000", paddingTop: "0.5rem", fontSize: "0.95rem", fontWeight: 800 }}>
                    <span>Gross Total Collected:</span>
                    <span>Rs. {selectedOrder.totalAmount}</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }} className="no-print">
              <button onClick={() => { setShowInvoiceModal(false); setSelectedOrder(null); }} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Close</button>
              <button onClick={handlePrint} className="btn-primary" style={{ flex: 1, justifyContent: "center", display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <Printer size={15} /> Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Helper setter
  function setFormForm(field: string, val: string) {
    setTopupForm(prev => ({ ...prev, [field]: val }));
  }
}

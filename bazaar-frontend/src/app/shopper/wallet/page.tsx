"use client";
import React, { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import { 
  Wallet, ArrowUpRight, ArrowDownLeft, ShieldCheck, 
  Send, DollarSign, RefreshCw, CheckCircle, AlertCircle, Sparkles 
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function ShopperWalletPage() {
  const [balance, setBalance] = useState<number>(0);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Form states
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<"jazzcash" | "easypaisa">("jazzcash");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [accountTitle, setAccountTitle] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const fetchWallet = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      if (!token) return;

      const res = await fetch(`${API}/api/auth/shopper-wallet`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setBalance(data.balancePKR || 0);
        setWithdrawals(data.withdrawals || []);
      }
    } catch (err) {
      console.error("Failed to load shopper wallet:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallet();
  }, []);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const withdrawAmt = parseFloat(amount);

    if (!withdrawAmt || withdrawAmt <= 0) {
      setMessage({ text: "Please enter a valid amount to transfer.", type: "error" });
      return;
    }

    if (withdrawAmt > balance) {
      setMessage({ text: `Insufficient balance. Available balance: Rs. ${balance.toLocaleString()}`, type: "error" });
      return;
    }

    if (!accountNumber.trim() || !accountTitle.trim()) {
      setMessage({ text: "Please provide account number and account title.", type: "error" });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/auth/shopper-wallet/withdraw`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          amountPKR: withdrawAmt,
          method,
          accountNumber,
          accountTitle
        })
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ text: data.message, type: "success" });
        setBalance(data.balancePKR);
        setWithdrawals(data.withdrawals || []);
        setAmount("");
        setAccountNumber("");
        setAccountTitle("");
      } else {
        setMessage({ text: data.message || "Failed to process withdrawal.", type: "error" });
      }
    } catch (err) {
      setMessage({ text: "Network error during wallet payout transfer.", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#09090e", color: "#f8f8ff", fontFamily: "sans-serif" }}>
      <Sidebar />

      <main style={{ flex: 1, padding: "2.5rem 3rem", overflowY: "auto" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2.5rem" }}>
          <div>
            <span style={{ fontSize: "0.8rem", fontWeight: 800, color: "#a855f7", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Fintech Wallet Ledger
            </span>
            <h1 style={{ fontSize: "2rem", fontWeight: 800, margin: "0.3rem 0" }}>Shopper Digital Wallet</h1>
            <p style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
              Instant refund payouts, COD downpayments, and zero-fee transfers to local mobile accounts.
            </p>
          </div>
          
          <button onClick={fetchWallet} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#ffffff", padding: "0.6rem 1.2rem", borderRadius: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh Balance
          </button>
        </div>

        {/* Hero Balance Card & Withdrawal Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "2rem", marginBottom: "3rem" }}>
          
          {/* Balance Hero Card */}
          <div style={{ background: "linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(168, 85, 247, 0.05))", border: "1px solid rgba(168, 85, 247, 0.3)", borderRadius: "24px", padding: "2.5rem", display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#a855f7", fontSize: "0.85rem", fontWeight: 800, textTransform: "uppercase" }}>
                <Wallet size={18} /> Available Wallet Balance
              </div>
              <div style={{ fontSize: "3.2rem", fontWeight: 900, color: "#ffffff", fontFamily: "monospace", margin: "1rem 0 0.5rem 0" }}>
                Rs. {balance.toLocaleString()}
              </div>
              <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                Backed by 100% platform escrow guarantee. Funds can be used for shopping checkouts or cashed out instantly.
              </p>
            </div>

            <div style={{ display: "flex", gap: "1rem", marginTop: "2rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "1.5rem" }}>
              <div style={{ flex: 1, background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "14px", padding: "1rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#10b981", fontWeight: 700, display: "block" }}>Refund Payouts</span>
                <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "#ffffff" }}>Instant Credit</span>
              </div>
              <div style={{ flex: 1, background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.2)", borderRadius: "14px", padding: "1rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#f59e0b", fontWeight: 700, display: "block" }}>Transfer Fee</span>
                <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "#ffffff" }}>Rs. 0 (Free)</span>
              </div>
            </div>
          </div>

          {/* Transfer Payout Form Card */}
          <div style={{ background: "#111119", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "24px", padding: "2rem" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Send size={18} style={{ color: "#a855f7" }} /> Transfer Money Out
            </h3>
            <p style={{ color: "#94a3b8", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              Transfer your wallet funds directly to your JazzCash or EasyPaisa mobile account.
            </p>

            {message && (
              <div style={{ background: message.type === "success" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)", border: `1px solid ${message.type === "success" ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`, borderRadius: "12px", padding: "0.85rem", color: message.type === "success" ? "#10b981" : "#ef4444", fontSize: "0.8rem", marginBottom: "1.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {message.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {message.text}
              </div>
            )}

            <form onSubmit={handleWithdraw} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
              <div>
                <label style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 700, display: "block", marginBottom: "0.4rem" }}>Select Payout Method</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <button
                    type="button"
                    onClick={() => setMethod("jazzcash")}
                    style={{
                      padding: "0.75rem",
                      borderRadius: "12px",
                      border: method === "jazzcash" ? "2px solid #ef4444" : "1px solid rgba(255,255,255,0.08)",
                      background: method === "jazzcash" ? "rgba(239, 68, 68, 0.15)" : "#151521",
                      color: "#ffffff",
                      fontWeight: 800,
                      fontSize: "0.85rem",
                      cursor: "pointer"
                    }}
                  >
                    JazzCash
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("easypaisa")}
                    style={{
                      padding: "0.75rem",
                      borderRadius: "12px",
                      border: method === "easypaisa" ? "2px solid #10b981" : "1px solid rgba(255,255,255,0.08)",
                      background: method === "easypaisa" ? "rgba(16, 185, 129, 0.15)" : "#151521",
                      color: "#ffffff",
                      fontWeight: 800,
                      fontSize: "0.85rem",
                      cursor: "pointer"
                    }}
                  >
                    EasyPaisa
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 700, display: "block", marginBottom: "0.4rem" }}>Transfer Amount (PKR)</label>
                <input
                  type="number"
                  required
                  placeholder="e.g. 1500"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{ width: "100%", background: "#151521", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "0.75rem", color: "#ffffff", fontSize: "0.85rem" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 700, display: "block", marginBottom: "0.4rem" }}>Mobile Account Number</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 03001234567"
                  value={accountNumber}
                  onChange={e => setAccountNumber(e.target.value)}
                  style={{ width: "100%", background: "#151521", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "0.75rem", color: "#ffffff", fontSize: "0.85rem" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 700, display: "block", marginBottom: "0.4rem" }}>Account Title / Owner Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Muhammad Saad"
                  value={accountTitle}
                  onChange={e => setAccountTitle(e.target.value)}
                  style={{ width: "100%", background: "#151521", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "0.75rem", color: "#ffffff", fontSize: "0.85rem" }}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{ width: "100%", padding: "0.85rem", background: "linear-gradient(135deg, #7c3aed, #a855f7)", border: "none", borderRadius: "12px", color: "#ffffff", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", marginTop: "0.5rem" }}
              >
                {submitting ? "Processing Transfer..." : `Transfer to ${method === 'jazzcash' ? 'JazzCash' : 'EasyPaisa'}`}
              </button>
            </form>
          </div>

        </div>

        {/* Withdrawal History Table */}
        <div style={{ background: "#111119", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "24px", padding: "2rem" }}>
          <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "1.25rem" }}>Payout & Transfer History</h3>
          
          {withdrawals.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94a3b8", fontSize: "0.88rem" }}>
              No transfer payouts recorded yet. Refunded order amounts will appear in your balance above.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textStyle: "left", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8", textTransform: "uppercase", fontSize: "0.72rem", letterSpacing: "0.05em" }}>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "left" }}>Date & Time</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "left" }}>Payout Method</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "left" }}>Account Title</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "left" }}>Account Number</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Amount (PKR)</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "center" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((w: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "1rem", color: "#94a3b8" }}>{new Date(w.createdAt).toLocaleString()}</td>
                      <td style={{ padding: "1rem", textTransform: "uppercase", fontWeight: 700, color: w.method === "jazzcash" ? "#ef4444" : "#10b981" }}>{w.method}</td>
                      <td style={{ padding: "1rem", fontWeight: 600 }}>{w.accountTitle}</td>
                      <td style={{ padding: "1rem", fontFamily: "monospace", color: "#e2e8f0" }}>{w.accountNumber}</td>
                      <td style={{ padding: "1rem", textAlign: "right", fontWeight: 900, color: "#10b981" }}>- Rs. {w.amountPKR?.toLocaleString()}</td>
                      <td style={{ padding: "1rem", textAlign: "center" }}>
                        <span style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981", padding: "0.25rem 0.6rem", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase" }}>
                          {w.status || "Completed"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

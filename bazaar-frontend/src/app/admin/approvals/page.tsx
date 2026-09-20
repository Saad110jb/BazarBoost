"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { 
  ShieldCheck, Eye, CheckCircle, XCircle, Loader, 
  Receipt, AlertTriangle, Image as ImageIcon, Sparkles, X 
} from "lucide-react";
import { getImageUrl } from "@/utils/imageUrl";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function AdminApprovalsPage() {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  
  // Rejection Modal State
  const [rejectingItem, setRejectingItem] = useState<any | null>(null);
  const [rejectionReason, setRejectionReason] = useState("Invalid Transaction Ref ID");
  const [customReason, setCustomReason] = useState("");

  const fetchQueue = async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/wallet/verification-queue`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setQueue(data.queue || []);
      }
    } catch (err) {
      console.error("Failed to load verification queue:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleAction = async (id: string, type: "ad_bid" | "wallet_topup", status: "approved" | "rejected", reasonText?: string) => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    setActionLoading(id + status);
    try {
      const endpoint = type === "ad_bid" ? `/api/ads/bids/${id}/status` : `/api/wallet/topups/${id}/status`;
      const bodyPayload: any = { status };
      if (status === "rejected" && reasonText) {
        bodyPayload.message = reasonText;
      }

      const res = await fetch(`${API}${endpoint}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(bodyPayload)
      });
      const data = await res.json();
      if (data.success) {
        setActionMsg(`Submission ${status} successfully!`);
        setQueue(prev => prev.filter(item => item._id !== id));
        setRejectingItem(null);
        setCustomReason("");
      } else {
        alert(data.message || "Failed to process approval action");
      }
    } catch (err: any) {
      alert("Error sending request: " + err.message);
    } finally {
      setActionLoading(null);
      setTimeout(() => setActionMsg(""), 3000);
    }
  };

  const openRejectionDialog = (item: any) => {
    setRejectingItem(item);
    setRejectionReason("Invalid Transaction Ref ID");
    setCustomReason("");
  };

  const submitRejection = () => {
    if (!rejectingItem) return;
    const finalReason = rejectionReason === "Other" ? customReason : rejectionReason;
    handleAction(rejectingItem._id, rejectingItem.type, "rejected", finalReason || "Manual deposit review rejected");
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <Sidebar role="admin" />
      <main style={{ flex: 1, padding: "2.5rem", overflow: "auto" }}>
        
        {/* Style Tag for Blinking Warning Colors */}
        <style>{`
          @keyframes blink-alert {
            0%, 100% { border: 2px solid #ef4444; box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); background-color: rgba(239, 68, 68, 0.08); }
            50% { border: 2px solid transparent; box-shadow: none; background-color: transparent; }
          }
          .blink-warning-row {
            animation: blink-alert 1.2s infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>

        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "0.3rem" }}>Ad Approvals & Clearinghouse</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Review pending ad campaigns and manual deposit receipts. Highlighted rows represent duplicate transaction keys.
          </p>
        </div>

        {actionMsg && (
          <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.25rem", color: "#10b981", fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CheckCircle size={15} /> {actionMsg}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
          {[
            { label: "Pending Submissions", value: queue.length, color: "#f59e0b", icon: <Receipt size={18} /> },
            { label: "Flagged Duplicates", value: queue.filter(b => b.isDuplicate).length, color: "#ef4444", icon: <AlertTriangle size={18} /> },
            { label: "Ad Campaigns", value: queue.filter(b => b.type === "ad_bid").length, color: "#3b82f6", icon: <Sparkles size={18} /> },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div style={{ color: s.color, marginBottom: "0.75rem" }}>{s.icon}</div>
              <div style={{ fontSize: "1.7rem", fontWeight: 800 }}>{s.value}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "4rem" }}>
            <Loader size={32} style={{ animation: "spin 1s linear infinite", color: "#a855f7" }} />
          </div>
        ) : (
          <div className="glass-card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Merchant / Business", "Placement Type", "Requested Budget", "Receipt Reference", "AI OCR Risk", "Actions"].map(h => (
                    <th key={h} style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queue.map(item => {
                  const isDup = item.isDuplicate;
                  const storeName = item.storeId?.name || item.vendorId?.name || "Merchant Store";
                  const storeSlug = item.storeId?.slug || "";
                  const budgetAmount = item.type === "ad_bid" ? `Rs. ${item.bidAmount}` : `Rs. ${item.amountPKR}`;

                  return (
                    <tr 
                      key={item._id} 
                      className={isDup ? "blink-warning-row" : ""}
                      style={{ borderBottom: "1px solid var(--border-subtle)" }}
                      onMouseEnter={e => { if (!isDup) e.currentTarget.style.background = "var(--bg-card-hover)"; }}
                      onMouseLeave={e => { if (!isDup) e.currentTarget.style.background = "transparent"; }}
                    >
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <p style={{ fontWeight: 600, fontSize: "0.875rem" }}>{storeName}</p>
                        {storeSlug && <p style={{ fontSize: "0.75rem", color: "#a855f7" }}>slug: /{storeSlug}</p>}
                        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{item.vendorId?.email}</p>
                      </td>
                      <td style={{ padding: "1rem 1.25rem", fontSize: "0.85rem" }}>
                        {item.type === "ad_bid" ? (
                          <span className="badge badge-info" style={{ textTransform: "uppercase", fontSize: "0.68rem" }}>Ad Campaign: {item.slotId?.name || "Placement"}</span>
                        ) : (
                          <span className="badge badge-success" style={{ textTransform: "uppercase", fontSize: "0.68rem" }}>Wallet Deposit</span>
                        )}
                      </td>
                      <td style={{ padding: "1rem 1.25rem", fontWeight: 800, color: "#a855f7", fontSize: "1rem" }}>
                        {budgetAmount}
                      </td>
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <div>
                          <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                            Ref ID: <code style={{ color: "#a855f7", fontSize: "0.75rem", fontWeight: 700 }}>{item.referenceId || "—"}</code>
                          </p>
                          {item.ocrResult?.referenceNumber && (
                            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                              OCR Extracted: <code>{item.ocrResult.referenceNumber}</code>
                            </p>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "1rem 1.25rem" }}>
                        {isDup || item.ocrResult?.isSuspectedFake ? (
                          <span className="badge badge-danger" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                            <AlertTriangle size={10} /> Flagged Risk
                          </span>
                        ) : (
                          <span className="badge badge-success">✓ Clean</span>
                        )}
                      </td>
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                          {item.paymentReceiptUrl && (
                            <button 
                              onClick={() => setSelectedReceipt(getImageUrl(item.paymentReceiptUrl))}
                              style={{ padding: "0.35rem 0.75rem", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.3rem" }}
                            >
                              <ImageIcon size={12} /> View Receipt
                            </button>
                          )}
                          <button 
                            onClick={() => handleAction(item._id, item.type, "approved")} 
                            disabled={!!actionLoading}
                            style={{ padding: "0.35rem 0.75rem", borderRadius: 8, border: "1px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.1)", color: "#10b981", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.3rem" }}
                          >
                            {actionLoading === item._id + "approved" ? <Loader size={12} style={{ animation: "spin 1s linear" }} /> : <CheckCircle size={12} />} Approve
                          </button>
                          <button 
                            onClick={() => openRejectionDialog(item)} 
                            disabled={!!actionLoading}
                            style={{ padding: "0.35rem 0.75rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.1)", color: "#ef4444", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.3rem" }}
                          >
                            {actionLoading === item._id + "rejected" ? <Loader size={12} style={{ animation: "spin 1s linear" }} /> : <XCircle size={12} />} Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {queue.length === 0 && (
              <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)" }}>
                <ShieldCheck size={36} style={{ margin: "0 auto 1rem", opacity: 0.4 }} />
                <p>All cleared! No pending ad approvals or wallet deposits.</p>
              </div>
            )}
          </div>
        )}

        {/* High-Resolution Receipt Preview Modal */}
        {selectedReceipt && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "2rem" }}>
            <div className="glass-card animate-fade-up" style={{ position: "relative", maxWidth: 640, width: "100%", padding: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <button 
                onClick={() => setSelectedReceipt(null)}
                style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
              >
                <X size={20} />
              </button>
              <h3 style={{ fontWeight: 800, marginBottom: "1rem", alignSelf: "flex-start" }}>Uploaded Screenshot Receipt</h3>
              <img 
                src={selectedReceipt} 
                alt="Receipt screenshot" 
                style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 8, border: "1px solid var(--border-subtle)" }} 
              />
            </div>
          </div>
        )}

        {/* SuperAdmin Rejection Reason Dialog Modal */}
        {rejectingItem && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "2rem" }}>
            <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 440, padding: "2rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.1rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <XCircle size={18} /> Reject Submission
                </h3>
                <button onClick={() => setRejectingItem(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={20} /></button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Select the reason why you are rejecting this manual deposit or ad bid receipt. This message will trigger a push-down alert on the merchant's dashboard.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[
                    "Invalid Transaction Ref ID",
                    "Blurry Screenshot",
                    "Amount Mismatch",
                    "Duplicate Receipt Uploaded",
                    "Other"
                  ].map(reason => (
                    <label key={reason} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer", padding: "0.5rem", borderRadius: 6, background: rejectionReason === reason ? "rgba(168,85,247,0.1)" : "transparent", border: rejectionReason === reason ? "1px solid rgba(168,85,247,0.3)" : "1px solid transparent" }}>
                      <input 
                        type="radio" 
                        name="rejectionReason" 
                        value={reason} 
                        checked={rejectionReason === reason} 
                        onChange={() => setRejectionReason(reason)} 
                      />
                      {reason}
                    </label>
                  ))}
                </div>

                {rejectionReason === "Other" && (
                  <textarea 
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="Enter custom rejection reason here..."
                    style={{ width: "100%", minHeight: 80, padding: "0.75rem", background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: 8, color: "var(--text-primary)", fontSize: "0.85rem" }}
                  />
                )}

                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button 
                    onClick={() => setRejectingItem(null)}
                    style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={submitRejection}
                    style={{ padding: "0.5rem 1rem", borderRadius: 8, background: "#ef4444", border: "1px solid rgba(239,68,68,0.4)", color: "#white", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700 }}
                  >
                    Reject Submission
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

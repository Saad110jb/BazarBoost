"use client";
import React, { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";
import { AlertCircle, ShieldCheck, Loader, Calendar, Terminal, RefreshCw, ChevronRight, FileText } from "lucide-react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function ShopperDisputesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const fetchTickets = async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) {
      router.push("/auth/login");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`${API}/api/complaints/my`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setTickets(data.tickets || []);
      } else {
        setErrorMsg(data.message || "Failed to load disputes.");
      }
    } catch (err) {
      setErrorMsg("Network error. Could not connect to API.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "resolved": return { bg: "rgba(16,185,129,0.1)", color: "#10b981", border: "rgba(16,185,129,0.2)" };
      case "escalated": return { bg: "rgba(239,68,68,0.1)", color: "#ef4444", border: "rgba(239,68,68,0.2)" };
      case "under_review": return { bg: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "rgba(245,158,11,0.2)" };
      default: return { bg: "rgba(59,130,246,0.1)", color: "#3b82f6", border: "rgba(59,130,246,0.2)" };
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)" }}>
      <Navbar />
      
      <main style={{ flex: 1, padding: "7rem 2rem 3rem", maxWidth: "1200px", margin: "0 auto", width: "100%" }}>
        
        {/* Header section */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: 900, letterSpacing: "-0.03em" }}>
              My Support Disputes &amp; Complaints
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", marginTop: "0.25rem" }}>
              Track the live resolution progress of disputes filed against order delays, defective items, or price haggles.
            </p>
          </div>

          <button
            onClick={fetchTickets}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",
              color: "var(--text-primary)",
              transition: "all 0.2s"
            }}
          >
            <RefreshCw size={14} /> Refresh Logs
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "4rem", textAlign: "center" }}>
            <Loader size={32} style={{ animation: "spin 1s linear infinite", color: "#a855f7", margin: "0 auto 1rem" }} />
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Fetching dispute logs...</p>
          </div>
        ) : errorMsg ? (
          <div className="glass-card" style={{ padding: "2rem", textAlign: "center", color: "#ef4444" }}>
            <AlertCircle size={32} style={{ margin: "0 auto 1rem" }} />
            <p>{errorMsg}</p>
          </div>
        ) : tickets.length === 0 ? (
          <div style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "16px",
            padding: "4rem 2rem",
            textAlign: "center"
          }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🛡️</div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "0.5rem" }}>No Disputes Filed</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", maxWidth: "420px", margin: "0 auto 1.5rem", lineHeight: 1.5 }}>
              All of your orders are running smoothly! If you ever experience issues with an order delivery or defects, file a ticket directly from the order tracking screen.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {tickets.map((ticket) => {
              const statusStyle = getStatusColor(ticket.status);
              return (
                <div 
                  key={ticket._id} 
                  className="glass-card animate-fade-up" 
                  style={{ padding: "2rem", border: "1px solid var(--border-subtle)" }}
                >
                  {/* Top Ticket Details Header */}
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "1rem", marginBottom: "1.2rem" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                        <span style={{
                          fontSize: "0.68rem",
                          fontWeight: 800,
                          textTransform: "uppercase",
                          padding: "0.15rem 0.45rem",
                          borderRadius: "4px",
                          background: "rgba(168,85,247,0.1)",
                          color: "#a855f7",
                          border: "1px solid rgba(168,85,247,0.2)"
                        }}>
                          {ticket.category}
                        </span>
                        <span style={{ fontSize: "0.76rem", fontFamily: "monospace", color: "var(--text-muted)", fontWeight: 700 }}>
                          TICKET: #{ticket._id.slice(-8).toUpperCase()}
                        </span>
                      </div>
                      <h3 style={{ fontSize: "1.15rem", fontWeight: 800, marginTop: "0.4rem" }}>
                        Store context: {ticket.storeId?.name || "Bazaar Store"}
                      </h3>
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem", display: "flex", alignItems: "center", gap: "4px", fontWeight: 600 }}>
                        <Calendar size={12} /> Filed on {new Date(ticket.createdAt).toLocaleDateString()} at {new Date(ticket.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>

                    <span style={{
                      fontSize: "0.72rem",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      padding: "0.25rem 0.75rem",
                      borderRadius: "20px",
                      background: statusStyle.bg,
                      color: statusStyle.color,
                      border: `1px solid ${statusStyle.border}`,
                      letterSpacing: "0.04em"
                    }}>
                      {ticket.status.replace("_", " ")}
                    </span>
                  </div>

                  {/* Body description */}
                  <div style={{ fontSize: "0.86rem", lineHeight: 1.5, color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                    <p style={{ margin: 0 }}><strong>Shopper Complaint Description:</strong></p>
                    <p style={{ margin: "0.3rem 0 0", color: "var(--text-primary)" }}>{ticket.description}</p>
                    {ticket.evidenceUrl && (
                      <div style={{ marginTop: "0.75rem", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                        <FileText size={14} style={{ color: "#a855f7" }} />
                        <a href={`${API}${ticket.evidenceUrl}`} target="_blank" rel="noopener noreferrer" style={{ color: "#a855f7", textDecoration: "underline", fontSize: "0.78rem", fontWeight: 700 }}>
                          View Screenshot Evidence File
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Relational details: Order or Product info */}
                  <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border-subtle)", borderRadius: "8px", padding: "1rem", marginBottom: "1.5rem" }}>
                    <h4 style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                      Associated System Context
                    </h4>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem", fontSize: "0.8rem" }}>
                      {ticket.orderId && (
                        <div>
                          <strong>Related Order:</strong>{" "}
                          <span 
                            onClick={() => router.push(`/shop/${ticket.storeId?.slug}/order/${ticket.orderId._id}`)}
                            style={{ color: "#a855f7", cursor: "pointer", textDecoration: "underline", fontWeight: 700 }}
                          >
                            #{ticket.orderId._id.slice(-8).toUpperCase()}
                          </span>
                        </div>
                      )}
                      {ticket.productId && (
                        <div>
                          <strong>Related Product:</strong> {ticket.productId.title} (Rs. {ticket.productId.price})
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status Timeline Workflow */}
                  <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1.2rem", marginTop: "1rem" }}>
                    <h4 style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "1rem" }}>
                      Dispute Lifecycle Log
                    </h4>
                    
                    {/* Responses */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                      {ticket.vendorResponse?.message ? (
                        <div style={{ background: "rgba(168,85,247,0.02)", borderLeft: "3px solid #a855f7", padding: "1rem", borderRadius: "0 8px 8px 0" }}>
                          <strong style={{ display: "block", fontSize: "0.82rem", color: "#a855f7", marginBottom: "0.3rem" }}>
                            Merchant Counter-Response &amp; Remediation
                          </strong>
                          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                            {ticket.vendorResponse.message}
                          </p>
                          {ticket.vendorResponse.remedyType !== 'none' && (
                            <div style={{ marginTop: "0.6rem", fontSize: "0.76rem", color: "#10b981", fontWeight: 800 }}>
                              Remedy Executed: {ticket.vendorResponse.remedyType.toUpperCase()}
                              {ticket.vendorResponse.couponCode && (
                                <div style={{ display: "inline-block", marginLeft: "1rem", fontFamily: "monospace", background: "rgba(16,185,129,0.06)", padding: "0.2rem 0.5rem", borderRadius: "4px", border: "1px dashed rgba(16,185,129,0.3)", color: "var(--text-primary)" }}>
                                  Use Code: {ticket.vendorResponse.couponCode} (15% off)
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontStyle: "italic", color: "var(--text-muted)", fontSize: "0.76rem" }}>
                          ⌛ Awaiting direct merchant response or self-remediation proposal.
                        </div>
                      )}

                      {ticket.adminDecision?.message && (
                        <div style={{ background: "rgba(16,185,129,0.02)", borderLeft: "3px solid #10b981", padding: "1rem", borderRadius: "0 8px 8px 0" }}>
                          <strong style={{ display: "block", fontSize: "0.82rem", color: "#10b981", marginBottom: "0.3rem" }}>
                            Official Governance Ruling
                          </strong>
                          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                            {ticket.adminDecision.message}
                          </p>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", display: "block", marginTop: "0.4rem" }}>
                            Ruling Enforcement Action: {ticket.adminDecision.actionTaken}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}

      </main>
    </div>
  );
}

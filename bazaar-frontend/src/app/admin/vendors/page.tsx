"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { 
  Store as StoreIcon, User, Globe, ShieldAlert, CheckCircle, 
  Loader, RefreshCw, AlertCircle, Edit3, Trash2, Link as LinkIcon,
  X, AlertTriangle, MessageSquare, ShieldCheck
} from "lucide-react";
import Link from "next/link";
import { getImageUrl } from "@/utils/imageUrl";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function AdminVendorsPage() {
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Edit Slug Modal State
  const [editingStore, setEditingStore] = useState<any | null>(null);
  const [newSlug, setNewSlug] = useState("");

  // Suspension Reason Modal State
  const [suspensionStoreTarget, setSuspensionStoreTarget] = useState<any | null>(null);
  const [suspensionReasonText, setSuspensionReasonText] = useState("Violating platform terms");
  const [customSuspensionReason, setCustomSuspensionReason] = useState("");

  // Complaints / Points System State
  const [selectedStoreComplaints, setSelectedStoreComplaints] = useState<any | null>(null);
  const [showFileComplaint, setShowFileComplaint] = useState(false);
  const [complaintTitle, setComplaintTitle] = useState("");
  const [complaintDetails, setComplaintDetails] = useState("");
  const [complaintPoints, setComplaintPoints] = useState(10);

  const fetchStores = async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`${API}/api/stores`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setStores(data.stores || []);
      } else {
        setErrorMsg(data.message || "Failed to load store registry.");
      }
    } catch (err) {
      setErrorMsg("Failed to connect to stores registry API.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStores();
  }, []);

  const handleToggleStatus = async (storeId: string, currentVal: boolean, reasonText?: string) => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    setActionLoading(storeId + "status");
    try {
      const res = await fetch(`${API}/api/stores/${storeId}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isActive: !currentVal, reason: reasonText })
      });
      const data = await res.json();
      if (data.success) {
        setStores(prev => prev.map(s => s._id === storeId ? data.store : s));
        setSuccessMsg(`Store status updated successfully.`);
        setSuspensionStoreTarget(null);
        setCustomSuspensionReason("");
      } else {
        alert(data.message || "Failed to update status");
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setActionLoading(null);
      setTimeout(() => setSuccessMsg(""), 3000);
    }
  };

  const handleReleaseSlug = async (storeId: string) => {
    if (!confirm("Are you sure you want to release this store's dynamic path slug? This will detach it from their vendor identity and free it up for future users.")) return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    setActionLoading(storeId + "release");
    try {
      const res = await fetch(`${API}/api/stores/${storeId}/slug`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ release: true })
      });
      const data = await res.json();
      if (data.success) {
        setStores(prev => prev.map(s => s._id === storeId ? { ...s, slug: data.store.slug } : s));
        setSuccessMsg("Store slug released and reclaimed successfully.");
      } else {
        alert(data.message || "Failed to release slug");
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setActionLoading(null);
      setTimeout(() => setSuccessMsg(""), 3000);
    }
  };

  const handleUpdateSlug = async () => {
    if (!editingStore) return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/stores/${editingStore._id}/slug`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ slug: newSlug })
      });
      const data = await res.json();
      if (data.success) {
        setStores(prev => prev.map(s => s._id === editingStore._id ? { ...s, slug: data.store.slug } : s));
        setSuccessMsg(`Store slug changed to /shop/${data.store.slug}`);
        setEditingStore(null);
      } else {
        alert(data.message || "Failed to update slug");
      }
    } catch (err: any) {
      alert("Error updating slug: " + err.message);
    } finally {
      setTimeout(() => setSuccessMsg(""), 3000);
    }
  };

  const handleFileComplaint = async () => {
    if (!selectedStoreComplaints || !complaintTitle.trim() || !complaintDetails.trim()) return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/stores/${selectedStoreComplaints._id}/complaints`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title: complaintTitle, details: complaintDetails, points: complaintPoints })
      });
      const data = await res.json();
      if (data.success) {
        setStores(prev => prev.map(s => s._id === selectedStoreComplaints._id ? data.store : s));
        setSelectedStoreComplaints(data.store); // Update modal context
        setSuccessMsg("Complaint filed and points added successfully.");
        setShowFileComplaint(false);
        setComplaintTitle("");
        setComplaintDetails("");
        setComplaintPoints(10);
      } else {
        alert(data.message || "Failed to file complaint");
      }
    } catch (err: any) {
      alert("Error filing complaint: " + err.message);
    } finally {
      setTimeout(() => setSuccessMsg(""), 3000);
    }
  };

  const handleResolveComplaint = async (complaintId: string, action: "resolved" | "dismissed") => {
    if (!selectedStoreComplaints) return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/stores/${selectedStoreComplaints._id}/complaints/${complaintId}/resolve`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (data.success) {
        setStores(prev => prev.map(s => s._id === selectedStoreComplaints._id ? data.store : s));
        setSelectedStoreComplaints(data.store); // Update modal context
        setSuccessMsg(`Complaint successfully marked as ${action}.`);
      } else {
        alert(data.message || "Failed to resolve complaint");
      }
    } catch (err: any) {
      alert("Error updating complaint: " + err.message);
    } finally {
      setTimeout(() => setSuccessMsg(""), 3000);
    }
  };

  const handleSuspendConfirm = () => {
    if (!suspensionStoreTarget) return;
    const finalReason = suspensionReasonText === "Other" ? customSuspensionReason : suspensionReasonText;
    handleToggleStatus(suspensionStoreTarget._id, true, finalReason || "Policy Violation suspension");
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <Sidebar role="admin" />
      <main style={{ flex: 1, padding: "2.5rem", overflow: "auto" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "0.3rem" }}>Vendor Registry & Store Fleet</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Monitor tenant branding, operating owner credentials, complaints penalties, and platform status.
            </p>
          </div>
          <button 
            onClick={fetchStores}
            style={{
              padding: "0.5rem 1rem", borderRadius: 8, background: "var(--bg-secondary)",
              border: "1px solid var(--border-subtle)", cursor: "pointer", fontSize: "0.82rem",
              display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600
            }}
          >
            <RefreshCw size={14} /> Refresh Fleet
          </button>
        </div>

        {errorMsg && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "1rem", marginBottom: "1.5rem", color: "#ef4444", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <AlertCircle size={16} /> {errorMsg}
          </div>
        )}

        {successMsg && (
          <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 10, padding: "1rem", marginBottom: "1.5rem", color: "#10b981", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CheckCircle size={16} /> {successMsg}
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "4rem" }}>
            <Loader size={32} style={{ animation: "spin 1s linear infinite", color: "#a855f7" }} />
          </div>
        ) : (
          <div className="glass-card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Store Fleet & Branding", "Operating Owner", "Sub-URL Slug Path", "Account status", "Moderation Switches", "Penalties Ledger", "Slug Reclamation"].map(h => (
                    <th key={h} style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stores.map(store => {
                  const logoUrl = store.logo ? getImageUrl(store.logo) : "";
                  const storeActive = store.isActive !== false;
                  const pts = store.penaltyPoints || 0;
                  
                  return (
                    <tr 
                      key={store._id} 
                      style={{ borderBottom: "1px solid var(--border-subtle)", transition: "background 0.2s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-card-hover)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* Store Branding */}
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                          {logoUrl ? (
                            <img src={logoUrl} alt={store.name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", border: "1px solid var(--border-subtle)" }} />
                          ) : (
                            <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center", color: "#a855f7", border: "1px solid var(--border-subtle)" }}>
                              <StoreIcon size={18} />
                            </div>
                          )}
                          <div>
                            <p style={{ fontWeight: 700, fontSize: "0.875rem" }}>{store.name}</p>
                            <Link 
                              href={`/shop/${store.slug}`}
                              target="_blank"
                              style={{ fontSize: "0.75rem", color: "#a855f7", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.2rem" }}
                            >
                              <LinkIcon size={10} /> Visit Storefront
                            </Link>
                          </div>
                        </div>
                      </td>

                      {/* Owner Metadata */}
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <User size={14} style={{ color: "var(--text-muted)" }} />
                          <div>
                            <p style={{ fontWeight: 600, fontSize: "0.82rem" }}>{store.vendorId?.name || "Unassigned"}</p>
                            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{store.vendorId?.email || "—"}</p>
                          </div>
                        </div>
                      </td>

                      {/* Sub-URL Tenant Slug */}
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <span style={{ fontSize: "0.85rem", fontFamily: "monospace", padding: "0.2rem 0.4rem", background: "var(--bg-secondary)", borderRadius: 6, border: "1px solid var(--border-subtle)" }}>
                          /shop/{store.slug}
                        </span>
                      </td>

                      {/* Store Status Badge */}
                      <td style={{ padding: "1rem 1.25rem" }}>
                        {storeActive ? (
                          <span className="badge badge-success">✓ Active Fleet</span>
                        ) : (
                          <span className="badge badge-danger">⚠ Suspended</span>
                        )}
                        {pts > 0 && (
                          <div style={{ fontSize: "0.7rem", color: pts >= 30 ? "#ef4444" : "#f59e0b", marginTop: "0.25rem", fontWeight: 700 }}>
                            Points: {pts} / 50
                          </div>
                        )}
                      </td>

                      {/* Master Suspension Switch */}
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <label style={{ display: "inline-flex", position: "relative", alignItems: "center", cursor: "pointer" }}>
                            <input 
                              type="checkbox" 
                              checked={storeActive} 
                              onChange={() => {
                                if (storeActive) {
                                  setSuspensionStoreTarget(store);
                                  setSuspensionReasonText("Violating platform terms");
                                  setCustomSuspensionReason("");
                                } else {
                                  handleToggleStatus(store._id, false);
                                }
                              }} 
                              style={{ display: "none" }} 
                            />
                            <div style={{
                              width: 38, height: 20, backgroundColor: storeActive ? "#10b981" : "#4b5563",
                              borderRadius: 10, position: "relative", transition: "background-color 0.2s"
                            }}>
                              <div style={{
                                width: 16, height: 16, borderRadius: 8, backgroundColor: "white",
                                position: "absolute", top: 2, left: storeActive ? 20 : 2,
                                transition: "left 0.2s"
                              }} />
                            </div>
                            <span style={{ marginLeft: 8, fontSize: "0.78rem", fontWeight: 600, color: storeActive ? "#10b981" : "#ef4444" }}>
                              {actionLoading === store._id + "status" ? "Saving..." : storeActive ? "Active" : "Suspended"}
                            </span>
                          </label>
                        </div>
                      </td>

                      {/* Penalties System */}
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <button 
                          onClick={() => { setSelectedStoreComplaints(store); setShowFileComplaint(false); }}
                          style={{
                            padding: "0.35rem 0.75rem", borderRadius: 8,
                            border: "1px solid var(--border-subtle)", background: "var(--bg-secondary)",
                            color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.75rem",
                            fontWeight: 600, display: "flex", alignItems: "center", gap: "0.3rem"
                          }}
                        >
                          <ShieldAlert size={12} /> Manage Penalties ({(store.complaints || []).length})
                        </button>
                      </td>

                      {/* Slug Reclamation System */}
                      <td style={{ padding: "1rem 1.25rem" }}>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button 
                            onClick={() => { setEditingStore(store); setNewSlug(store.slug); }}
                            style={{ padding: "0.3rem 0.6rem", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
                          >
                            <Edit3 size={12} /> Edit Slug
                          </button>
                          <button 
                            onClick={() => handleReleaseSlug(store._id)}
                            disabled={store.slug.startsWith("released-")}
                            style={{ padding: "0.3rem 0.6rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.05)", color: "#ef4444", cursor: "pointer", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
                          >
                            <Trash2 size={12} /> Release Slug
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {stores.length === 0 && (
              <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)" }}>
                <ShieldAlert size={36} style={{ margin: "0 auto 1rem", opacity: 0.4 }} />
                <p>No stores registered on the platform.</p>
              </div>
            )}
          </div>
        )}

        {/* Edit Slug Modal Dialog */}
        {editingStore && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "2rem" }}>
            <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 420, padding: "2rem" }}>
              <h3 style={{ fontWeight: 800, marginBottom: "1rem", color: "var(--text-primary)" }}>Alter Sub-URL Tenant Slug</h3>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                  Manually change the dynamic path for <strong>{editingStore.name}</strong>. This slug must be unique and contain only alphanumeric characters and hyphens.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <label style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Tenant Route Slug</label>
                  <input 
                    type="text" 
                    value={newSlug} 
                    onChange={(e) => setNewSlug(e.target.value)} 
                    style={{ padding: "0.6rem 0.75rem", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.85rem", fontFamily: "monospace" }} 
                  />
                </div>

                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button 
                    onClick={() => setEditingStore(null)}
                    style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleUpdateSlug}
                    style={{ padding: "0.5rem 1rem", borderRadius: 8, background: "#a855f7", border: "1px solid rgba(168,85,247,0.4)", color: "white", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700 }}
                  >
                    Save Slug
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Suspension Reason Dialog Modal */}
        {suspensionStoreTarget && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "2rem" }}>
            <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 440, padding: "2rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.1rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <ShieldAlert size={18} /> Suspend Store Fleet access
                </h3>
                <button onClick={() => setSuspensionStoreTarget(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={20} /></button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Specify the deactivation reason for <strong>{suspensionStoreTarget.name}</strong>. An alert message will be instantly sent to the operating vendor.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[
                    "Violating platform terms",
                    "Unresolved buyer complaints",
                    "Excessive penalty threshold crossed",
                    "Non-payment of platform COD commission",
                    "Other"
                  ].map(reason => (
                    <label key={reason} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer", padding: "0.5rem", borderRadius: 6, background: suspensionReasonText === reason ? "rgba(239,68,68,0.06)" : "transparent", border: suspensionReasonText === reason ? "1px solid rgba(239,68,68,0.2)" : "1px solid transparent" }}>
                      <input 
                        type="radio" 
                        name="suspensionReason" 
                        value={reason} 
                        checked={suspensionReasonText === reason} 
                        onChange={() => setSuspensionReasonText(reason)} 
                      />
                      {reason}
                    </label>
                  ))}
                </div>

                {suspensionReasonText === "Other" && (
                  <textarea 
                    value={customSuspensionReason}
                    onChange={(e) => setCustomSuspensionReason(e.target.value)}
                    placeholder="Enter custom suspension reason here..."
                    style={{ width: "100%", minHeight: 80, padding: "0.75rem", background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: 8, color: "var(--text-primary)", fontSize: "0.85rem" }}
                  />
                )}

                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.25rem" }}>
                  <button 
                    onClick={() => setSuspensionStoreTarget(null)}
                    style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSuspendConfirm}
                    style={{ padding: "0.5rem 1rem", borderRadius: 8, background: "#ef4444", border: "1px solid rgba(239,68,68,0.4)", color: "white", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700 }}
                  >
                    Confirm Suspension
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Complaints and Penalty Point Management Modal */}
        {selectedStoreComplaints && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "2rem" }}>
            <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 640, padding: "2rem", maxHeight: "85vh", overflowY: "auto", position: "relative" }}>
              <button 
                onClick={() => setSelectedStoreComplaints(null)}
                style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
              >
                <X size={20} />
              </button>

              <h3 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <ShieldAlert size={20} style={{ color: "#ef4444" }} /> Penalties & Complaints Ledger
              </h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
                Review, file, or resolve complaints for <strong>{selectedStoreComplaints.name}</strong>. Current points: <strong style={{ color: "#ef4444" }}>{selectedStoreComplaints.penaltyPoints || 0}/50</strong>.
              </p>

              {/* Form to File New Complaint */}
              {showFileComplaint ? (
                <div style={{ background: "var(--bg-secondary)", padding: "1.25rem", borderRadius: 12, border: "1px solid var(--border-subtle)", marginBottom: "1.5rem" }}>
                  <h4 style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "1rem" }}>File New Complaint / Penalty</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <input 
                      type="text" 
                      placeholder="Complaint Title (e.g. Counterfeit Products)" 
                      value={complaintTitle}
                      onChange={(e) => setComplaintTitle(e.target.value)}
                      style={{ padding: "0.6rem", borderRadius: 8, background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.82rem" }}
                    />
                    <textarea 
                      placeholder="Detailed complaint reports, buyer order reference IDs..."
                      value={complaintDetails}
                      onChange={(e) => setComplaintDetails(e.target.value)}
                      style={{ padding: "0.6rem", borderRadius: 8, background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.82rem", minHeight: 70 }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                      <label style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>Penalty Points:</label>
                      <select 
                        value={complaintPoints}
                        onChange={(e) => setComplaintPoints(parseInt(e.target.value))}
                        style={{ padding: "0.4rem 0.6rem", borderRadius: 6, background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", fontSize: "0.82rem" }}
                      >
                        <option value={5}>5 Points (Minor Warning)</option>
                        <option value={10}>10 Points (Policy Violation)</option>
                        <option value={20}>20 Points (Counterfeit / Scam)</option>
                        <option value={50}>50 Points (Immediate Suspension)</option>
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                      <button 
                        onClick={() => setShowFileComplaint(false)}
                        style={{ padding: "0.4rem 0.8rem", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.78rem" }}
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={handleFileComplaint}
                        style={{ padding: "0.4rem 0.8rem", borderRadius: 6, background: "#ef4444", border: "none", color: "white", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700 }}
                      >
                        File Complaint
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => setShowFileComplaint(true)}
                  style={{ padding: "0.45rem 1rem", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700, marginBottom: "1.5rem" }}
                >
                  + File Complaint & Add Penalty
                </button>
              )}

              {/* Complaints Ledger List */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {(selectedStoreComplaints.complaints || []).length === 0 ? (
                  <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem", padding: "2rem" }}>
                    No complaints registered for this store fleet.
                  </p>
                ) : (
                  selectedStoreComplaints.complaints.map((comp: any) => (
                    <div key={comp._id} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                        <div>
                          <h5 style={{ fontWeight: 700, fontSize: "0.85rem" }}>{comp.title}</h5>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                            Filed: {new Date(comp.createdAt).toLocaleDateString()} | Points: <strong style={{ color: "#ef4444" }}>+{comp.points}</strong>
                          </span>
                        </div>
                        <span style={{
                          fontSize: "0.68rem", fontWeight: 800, padding: "0.15rem 0.35rem", borderRadius: 4,
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

                      {comp.appealMessage && (
                        <div style={{ background: "rgba(245,158,11,0.06)", borderLeft: "3px solid #f59e0b", padding: "0.5rem 0.75rem", borderRadius: "0 6px 6px 0", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
                          <span style={{ fontWeight: 700, fontSize: "0.72rem", color: "#f59e0b", display: "block", textTransform: "uppercase" }}>Vendor Appeal Statement</span>
                          {comp.appealMessage}
                        </div>
                      )}

                      {comp.status !== "resolved" && comp.status !== "dismissed" && (
                        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                          <button 
                            onClick={() => handleResolveComplaint(comp._id, "resolved")}
                            style={{ padding: "0.25rem 0.6rem", borderRadius: 6, border: "1px solid rgba(59,130,246,0.4)", background: "rgba(59,130,246,0.05)", color: "#3b82f6", cursor: "pointer", fontSize: "0.74rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.2rem" }}
                          >
                            <ShieldCheck size={12} /> Mark Resolved
                          </button>
                          <button 
                            onClick={() => handleResolveComplaint(comp._id, "dismissed")}
                            style={{ padding: "0.25rem 0.6rem", borderRadius: 6, border: "1px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.05)", color: "#10b981", cursor: "pointer", fontSize: "0.74rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.2rem" }}
                          >
                            ✓ Dismiss (Refund Points)
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

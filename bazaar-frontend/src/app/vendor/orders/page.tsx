"use client";
import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import StoreSwitcher from "@/components/StoreSwitcher";
import { 
  ShoppingBag, Truck, CheckCircle, Package, ArrowRight, Printer, 
  User, MapPin, DollarSign, X, Check, Loader, AlertCircle, Sparkles 
} from "lucide-react";

import { getImageUrl } from "@/utils/imageUrl";

const API = (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL !== "undefined" && process.env.NEXT_PUBLIC_API_URL !== "null") ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:5000";

const FALLBACK_ORDERS = [
  {
    _id: "order-1",
    shopperId: { name: "Zayan Ali", email: "zayan@gmail.com" },
    storeId: "s1",
    items: [
      { productId: "p1", title: "Summer Lawn Suit", quantity: 2, price: 4500 }
    ],
    totalAmount: 9000,
    status: "pending_approval",
    deliveryType: "in-city",
    shippingAddress: "House 45, D-Ground",
    city: "Faisalabad",
    customNotes: "Call before arrival",
    couponCode: "",
    marketingDiscount: 0,
    shippingPremium: 150,
    createdAt: new Date().toISOString()
  },
  {
    _id: "order-2",
    shopperId: { name: "Amina Shah", email: "amina@hotmail.com" },
    storeId: "s1",
    items: [
      { productId: "p2", title: "Leather Wallet", quantity: 1, price: 1200 }
    ],
    totalAmount: 1200,
    status: "processing",
    deliveryType: "out-of-city",
    shippingAddress: "House 22-A, Gulberg III",
    city: "Lahore",
    customNotes: "Leave at the gate",
    couponCode: "EID200",
    marketingDiscount: 200,
    shippingPremium: 300,
    createdAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    _id: "order-3",
    shopperId: { name: "Mustafa Khan", email: "mustafa@yahoo.com" },
    storeId: "s1",
    items: [
      { productId: "p3", title: "Premium wireless headphones", quantity: 1, price: 5500 }
    ],
    totalAmount: 5500,
    status: "dispatched",
    deliveryType: "out-of-city",
    shippingAddress: "Street 5, Sector F-6",
    city: "Islamabad",
    customNotes: "Ring doorbell twice",
    couponCode: "",
    marketingDiscount: 0,
    shippingPremium: 300,
    courierName: "TCS",
    trackingId: "TCS992818",
    createdAt: new Date(Date.now() - 7200000).toISOString()
  }
];

const COLUMNS = [
  { id: "pending_approval", label: "Pending Approval", color: "#f59e0b" },
  { id: "processing", label: "Processing/Packing", color: "#3b82f6" },
  { id: "dispatched", label: "Dispatched/Shipped", color: "#a855f7" },
  { id: "delivered", label: "Delivered", color: "#10b981" },
  { id: "return_requested", label: "Retake Request", color: "#ef4444" },
  { id: "return_approved", label: "Retake Approved (In-Pickup)", color: "#f59e0b" },
  { id: "completed", label: "Completed/Settled", color: "#6b7280" }
];

export default function VendorOrdersPage() {
  const [orders, setOrders] = useState<any[]>(FALLBACK_ORDERS);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [activeStoreId, setActiveStoreId] = useState("");
  const [activeModal, setActiveModal] = useState<string | null>(null); // 'approve' | 'dispatch' | 'invoice' | 'deliver' | 'complete'
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  // Form states for validation gates
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [courierName, setCourierName] = useState("TCS");
  const [trackingId, setTrackingId] = useState("");
  const [validationError, setValidationError] = useState("");
  const [vendorCancelReason, setVendorCancelReason] = useState("out_of_stock");
  const [customVendorReason, setCustomVendorReason] = useState("");
  const [declineReturnReason, setDeclineReturnReason] = useState("");
  const [declineSubmitting, setDeclineSubmitting] = useState(false);

  const loadOrders = async (storeId: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/orders/store/${storeId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.orders && data.orders.length > 0) {
        setOrders(data.orders);
      } else {
        setOrders(FALLBACK_ORDERS);
      }
    } catch (err) {
      console.warn("Backend orders fetch failed. Using fallback simulation data.");
      setOrders(FALLBACK_ORDERS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem("bazaar_user");
    if (stored) {
      const u = JSON.parse(stored);
      setUser(u);
      const storeId = u.activeStoreId || u.storeId || "s1";
      setActiveStoreId(storeId);
      loadOrders(storeId);
    }
  }, []);

  // Handle order transition update API calls
  const handleTransition = async (orderId: string, targetStatus: string, payload = {}) => {
    setValidationError("");
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/orders/${orderId}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: targetStatus, ...payload })
      });
      const data = await res.json();
      if (data.success) {
        // Refresh orders list
        loadOrders(activeStoreId);
        setActiveModal(null);
        setSelectedOrder(null);
        // Reset forms
        setDriverName("");
        setDriverContact("");
        setTrackingId("");
      } else {
        setValidationError(data.message || "Fulfillment validation gate failed.");
      }
    } catch (err) {
      // Simulate offline state updates for the sandbox experience
      console.warn("Offline fallback state transition simulation...");
      setOrders(prev => prev.map(o => {
        if (o._id === orderId) {
          const updated = { ...o, status: targetStatus, ...payload };
          if (targetStatus === "processing") {
            updated.platformCommission = (o.totalAmount - (o.shippingPremium || 0)) * 0.05;
          }
          return updated;
        }
        return o;
      }));
      setActiveModal(null);
      setSelectedOrder(null);
    }
  };

  // Trigger modal validation prompt when dragging/clicking statuses
  const triggerMove = (order: any, nextStatus: string) => {
    setSelectedOrder(order);
    setValidationError("");
    
    if (nextStatus === "processing") {
      if (order.deliveryType === "in-city") {
        setActiveModal("approve");
      } else {
        // Directly process out-of-city after showing confirmation
        handleTransition(order._id, "processing");
      }
    } else if (nextStatus === "dispatched") {
      setActiveModal("dispatch");
    } else if (nextStatus === "delivered") {
      handleTransition(order._id, "delivered");
    } else if (nextStatus === "completed") {
      setActiveModal("complete");
    }
  };

  const submitApproval = (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverName || !driverContact) {
      setValidationError("Driver details are required for In-City delivery.");
      return;
    }
    handleTransition(selectedOrder._id, "processing", { driverName, driverContact });
  };

  const submitDispatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedOrder.deliveryType === "in-city") {
      handleTransition(selectedOrder._id, "dispatched");
    } else {
      if (!trackingId || !courierName) {
        setValidationError("Courier name and tracking ID are required.");
        return;
      }
      const alphanumericRegex = /^[a-zA-Z0-9]+$/;
      if (!alphanumericRegex.test(trackingId)) {
        setValidationError("Tracking ID must be a valid alphanumeric string.");
        return;
      }
      handleTransition(selectedOrder._id, "dispatched", { courierName, trackingId });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCancelApproval = async (orderId: string, approve: boolean, reasonText?: string) => {
    try {
      const token = localStorage.getItem("bazaar_token");
      const url = approve 
        ? `${API}/api/orders/${orderId}/cancel`
        : `${API}/api/orders/${orderId}/reject-cancel`;
      const body = approve ? { reason: reasonText || "Merchant approved customer cancellation" } : {};

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        loadOrders(activeStoreId);
      } else {
        alert(data.message || "Failed to process cancellation action.");
      }
    } catch (err) {
      alert("Error communicating with server.");
    }
  };

  const handleVendorCancel = async (orderId: string, reasonText: string) => {
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: reasonText })
      });
      const data = await res.json();
      if (data.success) {
        loadOrders(activeStoreId);
        setActiveModal(null);
        setSelectedOrder(null);
      } else {
        setValidationError(data.message || "Failed to cancel order.");
      }
    } catch (err) {
      setValidationError("Error communicating with server.");
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <div className="no-print">
        <Sidebar role="vendor" />
      </div>
      <main className={activeModal === "invoice" ? "no-print" : ""} style={{ flex: 1, padding: "2.5rem", overflow: "auto" }}>
        
        {/* Print wrapper styles */}
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            body {
              background: #ffffff !important;
              color: #000000 !important;
            }
            body * {
              visibility: hidden;
            }
            #print-area, #print-area * {
              visibility: visible !important;
            }
            #print-area {
              position: fixed !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              height: auto !important;
              color: #000000 !important;
              background: #ffffff !important;
              padding: 2rem !important;
              border: none !important;
              box-shadow: none !important;
              z-index: 99999 !important;
            }
            .no-print, .no-print * {
              display: none !important;
              visibility: hidden !important;
            }
            @page {
              size: A4 portrait;
              margin: 10mm;
            }
          }
        `}} />

        {/* Header */}
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "0.3rem" }}>Kanban Fulfillment Dispatch</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Route merchant shipments, confirm courier tracking references, and split ledger commissions.
            </p>
          </div>
          <StoreSwitcher />
        </div>

        {/* Kanban Board Showcase layout */}
        <div className="no-print" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "1rem", alignItems: "start", minHeight: "65vh" }}>
          {COLUMNS.map(col => {
            const columnOrders = orders.filter(o => o.status === col.id);
            return (
              <div 
                key={col.id} 
                className="glass-card" 
                style={{ 
                  padding: "1rem", 
                  minHeight: "450px", 
                  background: "rgba(255,255,255,0.015)",
                  border: "1px solid var(--border-subtle)" 
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", borderBottom: `2px solid ${col.color}`, paddingBottom: "0.5rem" }}>
                  <h3 style={{ fontSize: "0.85rem", fontWeight: 800, color: col.color, textTransform: "uppercase" }}>{col.label}</h3>
                  <span style={{ fontSize: "0.75rem", background: "rgba(255,255,255,0.05)", padding: "0.1rem 0.4rem", borderRadius: "6px", fontWeight: 700 }}>
                    {columnOrders.length}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {columnOrders.map(order => (
                    <div 
                      key={order._id}
                      className="stat-card"
                      style={{ 
                        padding: "1rem", 
                        cursor: "pointer", 
                        border: "1px solid var(--border-subtle)",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "#a855f7"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-subtle)"}
                    >
                      {order.cancellationRequested && (
                        <div style={{
                          background: "rgba(239, 68, 68, 0.08)",
                          border: "1px solid rgba(239, 68, 68, 0.2)",
                          borderRadius: "8px",
                          padding: "0.5rem",
                          marginBottom: "0.75rem",
                          fontSize: "0.7rem",
                          color: "#ef4444",
                          fontWeight: 700,
                          animation: "pulse 2s infinite"
                        }}>
                          ⚠️ Customer Requested Cancel: "{order.cancellationReason}"
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                        <span style={{ fontSize: "0.8rem", fontWeight: 800 }}>{order.shopperId?.name || "Shopper Client"}</span>
                        <span style={{ 
                          fontSize: "0.62rem", 
                          background: order.deliveryType === "in-city" ? "rgba(16,185,129,0.15)" : "rgba(124,58,237,0.25)",
                          color: order.deliveryType === "in-city" ? "#10b981" : "#c084fc",
                          padding: "0.15rem 0.4rem", 
                          borderRadius: "4px",
                          fontWeight: 700,
                          textTransform: "uppercase"
                        }}>
                          {order.deliveryType}
                        </span>
                      </div>

                      {/* Item list brief summary */}
                      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
                        {order.items?.map((it: any) => `${it.quantity}x ${it.title}`).join(", ")}
                      </p>

                      {order.deliverySLA && (
                        <div style={{ fontSize: "0.65rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
                          SLA: <span style={{ color: order.deliveryType === "in-city" ? "#10b981" : "#c084fc", fontWeight: 700 }}>{order.deliverySLA}</span>
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px dashed rgba(255,255,255,0.05)", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
                        <span style={{ fontSize: "0.9rem", fontWeight: 900, color: "var(--text-primary)" }}>Rs. {order.totalAmount}</span>
                        
                        {/* Status update actions */}
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          {col.id === "processing" && (
                            <button 
                              onClick={() => { setSelectedOrder(order); setActiveModal("invoice"); }} 
                              style={{ background: "rgba(255,255,255,0.05)", border: "none", borderRadius: "6px", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-secondary)" }}
                              title="Print Invoice"
                            >
                              <Printer size={12} />
                            </button>
                          )}
                          
                          {col.id !== "completed" && (
                            <button 
                              onClick={() => {
                                const nextIndex = COLUMNS.findIndex(c => c.id === col.id) + 1;
                                triggerMove(order, COLUMNS[nextIndex].id);
                              }}
                              style={{ background: "rgba(168,85,247,0.1)", border: "none", borderRadius: "6px", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#a855f7" }}
                              title="Advance Status"
                            >
                              <ArrowRight size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      {order.cancellationRequested && (
                        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.5rem" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Approve customer's order cancellation request? This will restitute stock and refund prepaid amounts.")) {
                                handleCancelApproval(order._id, true, order.cancellationReason);
                              }
                            }}
                            style={{ flex: 1, background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)", color: "#10b981", borderRadius: "6px", fontSize: "0.68rem", fontWeight: 700, padding: "0.3rem", cursor: "pointer" }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Reject customer's order cancellation request? The order will proceed with fulfillment.")) {
                                handleCancelApproval(order._id, false);
                              }
                            }}
                            style={{ flex: 1, background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#ef4444", borderRadius: "6px", fontSize: "0.68rem", fontWeight: 700, padding: "0.3rem", cursor: "pointer" }}
                          >
                            Reject
                          </button>
                        </div>
                      )}

                      {(order.returnRequested || order.status === "return_requested") && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.75rem", borderTop: "1px solid rgba(245,158,11,0.2)", paddingTop: "0.5rem", background: "rgba(245,158,11,0.04)", padding: "0.5rem", borderRadius: "8px" }}>
                          <span style={{ fontSize: "0.68rem", color: "#f59e0b", fontWeight: 800 }}>⚠️ Retake / Return Requested</span>
                          <p style={{ fontSize: "0.65rem", color: "var(--text-secondary)", lineHeight: 1.3 }}>Reason: {order.returnReason || "Customer flagged issue with item"}</p>
                          
                          {/* Customer Evidence Photo Thumbnail */}
                          {order.returnEvidenceUrl && (
                            <div style={{ marginTop: "0.2rem" }}>
                              <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Customer Photo Evidence:</span>
                              <a href={getImageUrl(order.returnEvidenceUrl)} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block" }}>
                                <img 
                                  src={getImageUrl(order.returnEvidenceUrl)} 
                                  alt="Return Evidence" 
                                  style={{ width: "60px", height: "60px", borderRadius: "6px", objectFit: "cover", border: "1px solid rgba(245,158,11,0.3)" }} 
                                  onError={(e) => { e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 24 24' fill='none' stroke='%23f59e0b' stroke-width='2'><rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/></svg>"; }}
                                />
                              </a>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.2rem" }}>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const token = localStorage.getItem("bazaar_token");
                                const res = await fetch(`${API}/api/orders/${order._id}/return-action`, {
                                  method: "PUT",
                                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                                  body: JSON.stringify({ action: "approve", notes: "Approved for rider retake pickup" })
                                });
                                const data = await res.json();
                                if (data.success) { alert("Return approved!"); loadOrders(activeStoreId); }
                              }}
                              style={{ flex: 1, background: "#10b981", color: "#000000", border: "none", borderRadius: "4px", fontSize: "0.68rem", fontWeight: 800, padding: "0.3rem", cursor: "pointer" }}
                            >
                              Approve Return
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrder(order);
                                setDeclineReturnReason("");
                                setValidationError("");
                                setActiveModal("decline_return");
                              }}
                              style={{ flex: 1, background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#ef4444", borderRadius: "4px", fontSize: "0.68rem", fontWeight: 700, padding: "0.3rem", cursor: "pointer" }}
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      )}

                      {!order.cancellationRequested && ['pending_approval', 'processing'].includes(order.status) && (
                        <div style={{ display: "flex", marginTop: "0.5rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.5rem" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOrder(order);
                              setValidationError("");
                              setActiveModal("vendor_cancel");
                            }}
                            style={{ width: "100%", background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "var(--text-muted)", borderRadius: "6px", fontSize: "0.65rem", fontWeight: 600, padding: "0.25rem", cursor: "pointer" }}
                          >
                            Cancel Order
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {columnOrders.length === 0 && (
                    <div style={{ padding: "2rem 1rem", border: "1px dashed rgba(255,255,255,0.03)", borderRadius: "10px", textAlign: "center", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                      Column Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* MODAL 1: In-City Driver Allocation (Pending Approval -> Processing) */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {activeModal === "approve" && selectedOrder && (
          <div className="no-print" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div className="glass-card animate-fade-up" style={{ padding: "2rem", maxWidth: "440px", width: "90%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>In-City Driver Assignment</h3>
                <button onClick={() => setActiveModal(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
              </div>

              {validationError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem" }}>
                  <AlertCircle size={14} /> {validationError}
                </div>
              )}

              {/* Commission estimation info */}
              <div style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: "10px", padding: "0.85rem", marginBottom: "1.25rem", fontSize: "0.78rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <Sparkles size={16} style={{ color: "#a855f7", flexShrink: 0 }} />
                <div>
                  <p style={{ fontWeight: 700, color: "var(--text-primary)" }}>Fulfillment Financial Gate</p>
                  <p style={{ color: "var(--text-secondary)", marginTop: "0.15rem" }}>
                    Platform commission fee 5% (Rs. {(selectedOrder.platformCommission || ((selectedOrder.totalAmount - (selectedOrder.shippingPremium || 0)) * 0.05)).toLocaleString()}) will log into administration ledger.
                  </p>
                </div>
              </div>

              <form onSubmit={submitApproval} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Rider Full Name</label>
                  <input className="input-field" type="text" placeholder="e.g. Aslam Rider" required value={driverName} onChange={e => setDriverName(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Rider Contact Number</label>
                  <input className="input-field" type="text" placeholder="e.g. 0300-1234567" required value={driverContact} onChange={e => setDriverContact(e.target.value)} />
                </div>

                <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                  <button type="button" onClick={() => setActiveModal(null)} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Cancel</button>
                  <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: "center" }}>Approve Order</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* MODAL 2: Courier Binding (Processing -> Dispatched) */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {activeModal === "dispatch" && selectedOrder && (
          <div className="no-print" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div className="glass-card animate-fade-up" style={{ padding: "2rem", maxWidth: "440px", width: "90%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Dispatch Shipment Settings</h3>
                <button onClick={() => setActiveModal(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
              </div>

              {validationError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem" }}>
                  <AlertCircle size={14} /> {validationError}
                </div>
              )}

              <form onSubmit={submitDispatch} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {selectedOrder.deliveryType === "in-city" ? (
                  <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "10px", padding: "1rem" }}>
                    <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#10b981", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      <Check size={16} /> Self-Delivery Option Ready
                    </p>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.3rem", lineHeight: 1.4 }}>
                      Rider <strong>{selectedOrder.driverName}</strong> is assigned. Dispatching will trigger an immediate notification update to the customer.
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Third-Party Courier Partner</label>
                      <select 
                        className="input-field" 
                        style={{ width: "100%", background: "#151521", border: "1px solid var(--border-subtle)", color: "#ffffff", padding: "0.5rem" }}
                        value={courierName} 
                        onChange={e => setCourierName(e.target.value)}
                      >
                        <option value="TCS">TCS Express</option>
                        <option value="Leopards">Leopards Courier</option>
                        <option value="Trax">Trax Logistics</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Courier Tracking ID (Alphanumeric)</label>
                      <input className="input-field" type="text" placeholder="e.g. TRK9928182" required value={trackingId} onChange={e => setTrackingId(e.target.value)} />
                    </div>
                  </>
                )}

                <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                  <button type="button" onClick={() => setActiveModal(null)} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Cancel</button>
                  <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: "center" }}>Dispatch Order</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* MODAL 3: Settlement Splits (Delivered -> Completed)               */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {activeModal === "complete" && selectedOrder && (
          <div className="no-print" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div className="glass-card animate-fade-up" style={{ padding: "2rem", maxWidth: "440px", width: "90%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Financial Reconciliation Split</h3>
                <button onClick={() => setActiveModal(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
                <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Fulfilling order <strong>#{selectedOrder._id}</strong> closes out the ledger ledger. Payments are structured as follows:
                </p>

                <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "10px", overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "0.6rem 0.85rem", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Order Payment:</span>
                    <strong style={{ fontSize: "0.8rem" }}>Rs. {selectedOrder.totalAmount.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "0.6rem 0.85rem", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Platform Commission (5%):</span>
                    <strong style={{ fontSize: "0.8rem", color: "#ef4444" }}>
                      - Rs. {(selectedOrder.platformCommission || ((selectedOrder.totalAmount - (selectedOrder.shippingPremium || 0)) * 0.05)).toLocaleString()}
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "0.6rem 0.85rem", background: "rgba(16,185,129,0.03)" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 700 }}>Vendor Payout Split:</span>
                    <strong style={{ fontSize: "0.8rem", color: "#10b981", fontWeight: 800 }}>
                      + Rs. {(selectedOrder.totalAmount - (selectedOrder.platformCommission || ((selectedOrder.totalAmount - (selectedOrder.shippingPremium || 0)) * 0.05))).toLocaleString()}
                    </strong>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button onClick={() => setActiveModal(null)} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Cancel</button>
                <button 
                  onClick={() => handleTransition(selectedOrder._id, "completed")} 
                  className="btn-primary" 
                  style={{ flex: 1, justifyContent: "center", background: "#10b981", color: "#000" }}
                >
                  Confirm Settlement
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* MODAL 5: Vendor Cancellation Reason Selector Modal                  */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {activeModal === "vendor_cancel" && selectedOrder && (
          <div className="no-print" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div className="glass-card animate-fade-up" style={{ padding: "2rem", maxWidth: "440px", width: "90%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Cancel Order</h3>
                <button onClick={() => setActiveModal(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
              </div>

              {validationError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem" }}>
                  <AlertCircle size={14} /> {validationError}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div>
                  <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Cancellation Reason Code</label>
                  <select 
                    className="input-field" 
                    style={{ width: "100%", background: "#151521", border: "1px solid var(--border-subtle)", color: "#ffffff", padding: "0.5rem" }}
                    value={vendorCancelReason} 
                    onChange={e => setVendorCancelReason(e.target.value)}
                  >
                    <option value="out_of_stock">Out of Stock (Negligence Penalty)</option>
                    <option value="quality_check_failed">Failed Quality Check (Negligence Penalty)</option>
                    <option value="address_zone_restriction">Delivery Address Zone Restriction (No Penalty)</option>
                    <option value="other">Other / Custom Reason</option>
                  </select>
                </div>

                {vendorCancelReason === "other" && (
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Specify Custom Reason</label>
                    <input 
                      className="input-field" 
                      type="text" 
                      placeholder="e.g. Buyer requested custom variant changes..." 
                      required 
                      value={customVendorReason} 
                      onChange={e => setCustomVendorReason(e.target.value)} 
                    />
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                  <button type="button" onClick={() => setActiveModal(null)} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Cancel</button>
                  <button 
                    onClick={() => {
                      const finalReason = vendorCancelReason === "other" ? customVendorReason : vendorCancelReason;
                      handleVendorCancel(selectedOrder._id, finalReason);
                    }}
                    className="btn-primary" 
                    style={{ flex: 1, justifyContent: "center", background: "#ef4444", color: "#ffffff" }}
                    disabled={vendorCancelReason === "other" && !customVendorReason.trim()}
                  >
                    Cancel Order
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* MODAL 6: Decline Retake / Return Request Modal                      */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {activeModal === "decline_return" && selectedOrder && (
          <div className="no-print" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div className="glass-card animate-fade-up" style={{ padding: "2rem", maxWidth: "460px", width: "90%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.1rem", color: "#ef4444" }}>Decline Retake Request</h3>
                <button onClick={() => setActiveModal(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
              </div>

              {validationError && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem" }}>
                  <AlertCircle size={14} /> {validationError}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                  Declining this retake request will mark Order <strong>#{selectedOrder._id?.toString().slice(-8).toUpperCase()}</strong> as <strong style={{ color: "#10b981" }}>Completed</strong> and release order payout funds to your balance.
                </p>

                <div>
                  <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Reason for Declining Retake Request *</label>
                  <textarea
                    className="input-field"
                    rows={3}
                    style={{ width: "100%", background: "#151521", border: "1px solid var(--border-subtle)", color: "#ffffff", padding: "0.6rem", fontSize: "0.8rem" }}
                    placeholder="Provide clear justification for declining (e.g., photo evidence shows user damage or missing tags)..."
                    required
                    value={declineReturnReason}
                    onChange={e => setDeclineReturnReason(e.target.value)}
                  />
                </div>

                <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                  <button type="button" onClick={() => setActiveModal(null)} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Cancel</button>
                  <button
                    disabled={declineSubmitting || !declineReturnReason.trim()}
                    onClick={async () => {
                      if (!declineReturnReason.trim()) {
                        setValidationError("Please specify reason for declining retake request.");
                        return;
                      }
                      setDeclineSubmitting(true);
                      try {
                        const token = localStorage.getItem("bazaar_token");
                        const res = await fetch(`${API}/api/orders/${selectedOrder._id}/return-action`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ action: "reject", notes: declineReturnReason })
                        });
                        const data = await res.json();
                        if (data.success) {
                          setActiveModal(null);
                          setDeclineReturnReason("");
                          loadOrders(activeStoreId);
                        } else {
                          setValidationError(data.message || "Failed to decline return request.");
                        }
                      } catch (err) {
                        setValidationError("Network error declining retake request.");
                      } finally {
                        setDeclineSubmitting(false);
                      }
                    }}
                    className="btn-primary"
                    style={{ flex: 1, justifyContent: "center", background: "#ef4444", color: "#ffffff" }}
                  >
                    {declineSubmitting ? "Processing..." : "Confirm & Complete Order"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {activeModal === "invoice" && selectedOrder && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="glass-card animate-fade-up" style={{ padding: "2rem", maxWidth: "600px", width: "95%", maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--border-accent)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Print Packing Slip / Shipping Invoice</h3>
              <button onClick={() => setActiveModal(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
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
                  <div style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase" }}>Vendor Order Panel</div>
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
              <button onClick={() => setActiveModal(null)} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Close</button>
              <button onClick={handlePrint} className="btn-primary" style={{ flex: 1, justifyContent: "center", display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <Printer size={15} /> Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}

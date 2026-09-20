"use client";
import React, { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useStore } from "../../layout";
import { 
  Check, Phone, ShieldCheck, Truck, User, MapPin, 
  ChevronRight, Calendar, Sparkles, ExternalLink, MessageSquare, 
  AlertCircle, Loader, Star, Camera, FileText, RotateCcw
} from "lucide-react";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import { getImageUrl } from "@/utils/imageUrl";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Milestone statuses order
const STATUS_STEPS = ["pending_payment", "pending_approval", "processing", "dispatched", "delivered", "completed"];

const STEP_LABELS = [
  "Order Placed",
  "Shop Confirmed",
  "Processing",
  "Dispatched",
  "Out for Delivery",
  "Completed"
];

export default function OrderTrackingClient() {
  const params = useParams();
  const orderId = params?.orderId as string;
  const slug = params?.slug as string;
  const { store } = useStore();

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [highlightStep, setHighlightStep] = useState<number | null>(null);

  // Order cancellation states
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelSuccess, setCancelSuccess] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("Changed Mind");
  const [customReason, setCustomReason] = useState("");

  const handleCancelOrder = async (reasonText?: string) => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    setCancelling(true);
    setCancelError("");
    setCancelSuccess("");

    try {
      const res = await fetch(`${API}/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: reasonText || "Customer Cancel" })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCancelSuccess(data.message || "Order cancelled successfully.");
        // Reload order details
        const orderRes = await fetch(`${API}/api/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const orderData = await orderRes.json();
        if (orderData.success && orderData.order) {
          setOrder(orderData.order);
        }
        setShowCancelModal(false);
      } else {
        if (data.code === 'LOCKED') {
          setCancelError(data.message || "Cancellation locked.");
          fetchOrderTickets(); // Refresh tickets list to show auto-generated one!
        } else {
          setCancelError(data.message || "Failed to cancel order.");
        }
      }
    } catch (err) {
      setCancelError("Network error. Failed to execute cancellation.");
    } finally {
      setCancelling(false);
    }
  };

  // Review states
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewing, setReviewing] = useState(false);

  // Dispute states
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeCategory, setDisputeCategory] = useState("delay");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [disputeEvidence, setDisputeEvidence] = useState<File | null>(null);
  const [disputeTargetId, setDisputeTargetId] = useState(""); // associatedId: orderId or productId
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeError, setDisputeError] = useState("");
  const [disputeSuccess, setDisputeSuccess] = useState("");
  const [existingTickets, setExistingTickets] = useState<any[]>([]);
  // Retake / Return Modal states
  const [showRetakeModal, setShowRetakeModal] = useState(false);
  const [retakeReason, setRetakeReason] = useState("");
  const [retakePhotoUrl, setRetakePhotoUrl] = useState("");
  const [retakeUploading, setRetakeUploading] = useState(false);
  const [retakeSubmitting, setRetakeSubmitting] = useState(false);
  const [retakeError, setRetakeError] = useState("");

  const handleRetakeFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    setRetakeUploading(true);
    setRetakeError("");

    const formData = new FormData();
    formData.append("receipt", file);

    try {
      const res = await fetch(`${API}/api/orders/upload-receipt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success && data.paymentReceiptUrl) {
        setRetakePhotoUrl(data.paymentReceiptUrl);
      } else {
        setRetakeError(data.message || "Failed to upload photo from device.");
      }
    } catch (err) {
      setRetakeError("Network error uploading image file.");
    } finally {
      setRetakeUploading(false);
    }
  };

  const handleRetakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retakeReason.trim()) {
      setRetakeError("Please enter a valid reason for product retake.");
      return;
    }
    if (!retakePhotoUrl.trim()) {
      setRetakeError("Photo evidence URL/link is mandatory for product retake requests.");
      return;
    }

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    setRetakeSubmitting(true);
    setRetakeError("");

    try {
      const res = await fetch(`${API}/api/orders/${orderId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: retakeReason, returnEvidenceUrl: retakePhotoUrl })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowRetakeModal(false);
        // Reload order
        const orderRes = await fetch(`${API}/api/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const orderData = await orderRes.json();
        if (orderData.success && orderData.order) {
          setOrder(orderData.order);
        }
      } else {
        setRetakeError(data.message || "Failed to submit return request.");
      }
    } catch (err) {
      setRetakeError("Network error submitting retake request.");
    } finally {
      setRetakeSubmitting(false);
    }
  };

  const fetchOrderTickets = async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/complaints/my`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.tickets) {
        // filter tickets related to this orderId
        const related = data.tickets.filter((t: any) => t.orderId?._id === orderId);
        setExistingTickets(related);
      }
    } catch (err) {
      console.error("Failed to fetch order tickets:", err);
    }
  };

  const handleDisputeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeDescription.trim()) {
      setDisputeError("Please describe your issue.");
      return;
    }

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    setDisputeSubmitting(true);
    setDisputeError("");
    setDisputeSuccess("");

    try {
      const formData = new FormData();
      formData.append("category", disputeCategory);
      formData.append("description", disputeDescription);
      formData.append("associatedId", disputeTargetId || orderId);
      if (disputeEvidence) {
        formData.append("evidence", disputeEvidence);
      }

      const res = await fetch(`${API}/api/complaints`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setDisputeSuccess("Your dispute ticket has been successfully filed. The vendor has been notified.");
        setDisputeDescription("");
        setDisputeEvidence(null);
        setTimeout(() => {
          setShowDisputeModal(false);
          setDisputeSuccess("");
        }, 3000);
        fetchOrderTickets();
      } else {
        setDisputeError(data.message || "Failed to submit dispute.");
      }
    } catch (err) {
      setDisputeError("Network error. Failed to file dispute.");
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const socketRef = useRef<Socket | null>(null);

  // Fetch initial order details
  useEffect(() => {
    if (!orderId) return;
    const fetchOrder = async () => {
      setLoading(true);
      setError("");
      const token = localStorage.getItem("bazaar_token");
      if (!token) {
        setError("Please log in to view order tracking status.");
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API}/api/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.order) {
          setOrder(data.order);
          fetchOrderTickets();
        } else {
          setError(data.message || "Failed to load order tracking details.");
        }
      } catch (err) {
        setError("Network error fetching tracking details.");
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [orderId]);

  // Connect socket and listen for real-time order updates
  useEffect(() => {
    if (!orderId || !order) return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    const socket = io(API, {
      auth: { token },
      transports: ["websocket"]
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join_room", { roomId: `order:${orderId}` });
      console.log(`[Order Socket] Subscribed to order:${orderId}`);
    });

    socket.on("order_status_update", (updatedData: any) => {
      console.log(`[Order Socket] Received order_status_update:`, updatedData);
      setOrder((prev: any) => {
        if (!prev) return prev;
        
        // Find index of new status
        const stepIdx = STATUS_STEPS.indexOf(updatedData.status);
        if (stepIdx !== -1) {
          // Trigger neon pulse flash on the timeline step
          setHighlightStep(stepIdx);
          setTimeout(() => setHighlightStep(null), 3000);
        }

        return {
          ...prev,
          status: updatedData.status,
          driverName: updatedData.driverName || prev.driverName,
          driverContact: updatedData.driverContact || prev.driverContact,
          courierName: updatedData.courierName || prev.courierName,
          trackingId: updatedData.trackingId || prev.trackingId
        };
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [orderId, !!order]);

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) {
      setReviewError("Review message is required.");
      return;
    }
    setReviewing(true);
    setReviewError("");

    // Simulate saving feedback to "Two-Tier Social Proof Rating Factory"
    setTimeout(() => {
      setReviewing(false);
      setReviewSubmitted(true);
    }, 1200);
  };

  const primaryColor = store?.theme?.primaryColor || "#7c3aed";

  if (loading) {
    return (
      <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
        <Loader size={36} style={{ animation: "spin 1s linear infinite", color: primaryColor, margin: "0 auto 1rem" }} />
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Loading live tracking data...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div style={{ padding: "4rem 2rem", textAlign: "center", background: "#ffffff", borderRadius: "16px", border: "1px solid rgba(0,0,0,0.08)", maxWidth: "500px", margin: "2rem auto" }}>
        <AlertCircle size={36} style={{ color: "#ef4444", marginBottom: "1rem", marginLeft: "auto", marginRight: "auto" }} />
        <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "0.5rem" }}>Tracking Error</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{error || "Order not found."}</p>
        <Link href={`/shop/${slug}`} style={{ background: primaryColor, color: "#ffffff", padding: "0.5rem 1rem", borderRadius: "8px", textDecoration: "none", fontSize: "0.85rem", fontWeight: 700 }}>
          Back to Storefront
        </Link>
      </div>
    );
  }

  // Get current step index on milestone timeline
  const currentStepIndex = STATUS_STEPS.indexOf(order.status);

  // Out of city logistics links
  const getCourierLink = (courierName: string, trackingId: string) => {
    const courier = courierName.toLowerCase();
    if (courier.includes("tcs")) {
      return `https://www.tcsexpress.com/tracking?consignment=${trackingId}`;
    }
    if (courier.includes("trax")) {
      return `https://trax.pk/tracking/?tracking_id=${trackingId}`;
    }
    if (courier.includes("leopard")) {
      return `https://www.leopardscourier.com/tracking?track_number=${trackingId}`;
    }
    return `https://www.google.com/search?q=${courierName}+tracking+${trackingId}`;
  };

  const isDeliveredOrCompleted = ["delivered", "completed"].includes(order.status);

  return (
    <div className="flex flex-col gap-6 relative z-10">
      
      {/* 1. Header info panel */}
      <div className="w-full bg-[#111119]/80 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl flex flex-wrap justify-between items-center gap-6">
        <div>
          <span className="text-xs bg-slate-900 border border-slate-800 text-slate-400 px-2.5 py-1 rounded-md font-semibold tracking-wider uppercase">
            ORDER NO: #{order._id.slice(-8).toUpperCase()}
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-3">
            Live Progress Tracking
          </h2>
          <p className="text-xs text-slate-400 flex items-center gap-1 mt-1.5 font-semibold">
            <Calendar size={13} className="text-slate-500" /> Placed on {new Date(order.createdAt).toLocaleDateString()} at {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* Live Status indicator Badge */}
        <div className="flex flex-col items-start sm:items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isDeliveredOrCompleted ? "bg-emerald-500" : "bg-[var(--vendor-color)] animate-pulse"}`} style={{ backgroundColor: isDeliveredOrCompleted ? undefined : 'var(--vendor-color)' }} />
            <span 
              className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border"
              style={{
                background: isDeliveredOrCompleted ? "rgba(16,185,129,0.08)" : `${primaryColor}15`,
                color: isDeliveredOrCompleted ? "#10b981" : primaryColor,
                borderColor: isDeliveredOrCompleted ? "rgba(16,185,129,0.2)" : `${primaryColor}30`,
              }}
            >
              {STEP_LABELS[Math.max(0, currentStepIndex)]}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 font-bold tracking-wider">
            WebSocket Live Sync Connected
          </span>
        </div>
      </div>

      {/* 2. Visual Progress Milestone Timeline */}
      <div className="w-full bg-[#111119]/80 border border-slate-800/80 rounded-2xl p-8 sm:p-10 shadow-2xl backdrop-blur-xl overflow-x-auto">
        <div style={{ minWidth: "600px", position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          
          {/* Timeline background line */}
          <div className="absolute left-[3rem] right-[3rem] h-[3px] bg-slate-800/80 z-1" />
          
          {/* Timeline progress line filler */}
          <div 
            className="absolute left-[3rem] h-[3px] transition-all duration-1000 ease-in-out z-1" 
            style={{ 
              width: `${(Math.max(0, currentStepIndex) / (STATUS_STEPS.length - 1)) * 90}%`, 
              backgroundColor: 'var(--vendor-color)'
            }} 
          />

          {/* Timeline Milestones */}
          {STEP_LABELS.map((label, index) => {
            const isCompleted = index <= currentStepIndex;
            const isActive = index === currentStepIndex;
            const isNeonFlash = highlightStep === index;

            return (
              <div key={label} className="flex flex-col items-center relative z-10 flex-1">
                
                {/* Milestone Node Dot */}
                <div 
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-500 border-2 ${
                    isCompleted 
                      ? "bg-emerald-500/10 border-emerald-500 text-emerald-400" 
                      : "bg-slate-900 border-slate-800 text-slate-500"
                  }`}
                  style={{
                    boxShadow: isActive ? `0 0 15px var(--vendor-color)` : isNeonFlash ? `0 0 25px #ff0055` : "none",
                  }}
                >
                  {isCompleted ? <Check size={13} style={{ strokeWidth: 3 }} /> : <span>{index + 1}</span>}
                </div>

                {/* Milestone Node Title */}
                <div className="mt-3 text-center">
                  <p className={`text-[11px] font-bold transition-all duration-300 ${isCompleted ? "text-slate-200" : "text-slate-500"}`}>
                    {label}
                  </p>
                  {isActive && (
                    <span 
                      className="text-[8px] font-extrabold tracking-widest block mt-0.5 uppercase"
                      style={{ color: 'var(--vendor-color)' }}
                    >
                      Active State
                    </span>
                  )}
                </div>

              </div>
            );
          })}

        </div>
      </div>

      {/* 3. Geographic Multi-Route Logistics Panel */}
      {order.status === "dispatched" && (
        <div className="bg-slate-900/40 border border-slate-800/60 p-5 rounded-2xl">
          
          {order.deliveryType === "in-city" ? (
            /* Rider Logistics Details */
            <div className="flex flex-wrap justify-between items-center gap-6">
              <div className="flex gap-4 items-center">
                <div className="width-[48px] h-[48px] rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                  <User size={20} />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Rider Out for Delivery</p>
                  <h4 className="text-base font-extrabold text-white mt-1">{order.driverName || "Merchant Rider"}</h4>
                  <p className="text-xs text-slate-400 mt-0.5">🛵 Motorcycle local transit courier</p>
                </div>
              </div>

              <div className="flex gap-3">
                {order.driverContact && (
                  <a 
                    href={`tel:${order.driverContact}`} 
                    className="bg-[var(--vendor-color)] text-white hover:opacity-90 font-bold text-xs px-4 py-2 rounded-lg text-decoration-none transition-all"
                    style={{ backgroundColor: 'var(--vendor-color)' }}
                  >
                    <Phone size={13} className="inline mr-1" /> Call Driver ({order.driverContact})
                  </a>
                )}
              </div>
            </div>
          ) : (
            /* Third-Party Courier Logistics Details */
            <div className="flex flex-wrap justify-between items-center gap-6">
              <div className="flex gap-4 items-center">
                <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                  <Truck size={20} />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Out-of-City Shipping</p>
                  <h4 className="text-base font-extrabold text-white mt-1">
                    Courier: {order.courierName || "Independent Logistics"}
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Consignment ID: <code className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-slate-300 font-mono text-xs">{order.trackingId || "Pending"}</code>
                  </p>
                </div>
              </div>

              {order.trackingId && order.courierName && (
                <a 
                  href={getCourierLink(order.courierName, order.trackingId)} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="bg-[var(--vendor-color)] text-white hover:opacity-90 font-bold text-xs px-4 py-2 rounded-lg text-decoration-none transition-all"
                  style={{ backgroundColor: 'var(--vendor-color)' }}
                >
                  Track Parcel Live <ExternalLink size={13} className="inline ml-1" />
                </a>
              )}
            </div>
          )}

        </div>
      )}

      {/* 4. Details Workspace: Invoice breakdown & payment states - 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        
        {/* Left Column: Invoice Transparency & Items */}
        <div className="bg-[#111119]/80 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl flex flex-col gap-5">
          <h3 className="text-base font-bold border-b border-slate-800/80 pb-3 text-slate-100">
            Purchased Items & Invoice
          </h3>

          <div className="flex flex-col gap-4">
            {order.items?.map((item: any) => (
              <div key={item.productId} className="flex justify-between items-center gap-4">
                <div>
                  <h4 className="text-sm font-bold text-slate-200">{item.title}</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Qty: {item.quantity} × Rs. {item.price.toLocaleString()}
                  </p>
                </div>
                <span className="text-sm font-bold text-slate-300">
                  Rs. {(item.price * item.quantity).toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          <hr className="border-slate-800/80" />

          {/* Invoice calculations */}
          <div className="flex flex-col gap-2 text-xs text-slate-400">
            <div className="flex justify-between">
              <span>Cart Subtotal:</span>
              <span className="font-semibold text-slate-300">
                Rs. {order.items?.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0).toLocaleString()}
              </span>
            </div>

            {order.marketingDiscount > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Coupon Promo Code ({order.couponCode || "Discount"}):</span>
                <span className="font-extrabold">-Rs. {order.marketingDiscount.toLocaleString()}</span>
              </div>
            )}

            <div className="flex justify-between items-start">
              <div>
                <span>Shipping Premium ({order.deliveryType === "out-of-city" ? "Courier" : "Rider"}):</span>
                {order.deliverySLA && (
                  <span className="block text-[10px] text-slate-500 mt-0.5">SLA: {order.deliverySLA}</span>
                )}
              </div>
              <span className="font-semibold text-slate-300">+Rs. {order.shippingPremium.toLocaleString()}</span>
            </div>

            <hr className="border-dashed border-slate-800 my-1" />

            <div className="flex justify-between text-sm font-black text-white mt-1">
              <span>Grand Total Payable:</span>
              <span className="text-emerald-400 font-mono">Rs. {order.totalAmount.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Right Column: Payment Status & Delivery Details */}
        <div className="flex flex-col gap-6">
          
          {/* Payment indicator card */}
          <div className="bg-[#111119]/80 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl">
            <h3 className="text-sm font-bold border-b border-slate-800/80 pb-3 mb-4 text-slate-100">
              Payment Mode Verification
            </h3>

            {order.paymentMethod === "bank_transfer" ? (
              <div className="flex flex-col gap-4">
                
                {/* Badge uploader review state */}
                <div className="flex items-center gap-2">
                  {currentStepIndex >= 2 ? (
                    <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-md px-2.5 py-1 text-xs font-bold">
                      <ShieldCheck size={14} /> PAYMENT CONFIRMED
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-md px-2.5 py-1 text-xs font-bold">
                      <Loader size={12} className="animate-spin" /> RECEIPT REVIEW PENDING
                    </div>
                  )}
                </div>

                <p className="text-xs text-slate-400">
                  Submitted Ref ID: <code className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-slate-300 font-mono">{order.referenceId || "N/A"}</code>
                </p>

                {/* Uploaded receipt thumbnail uploader */}
                {order.paymentReceiptUrl && (
                  <div>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Uploaded Screenshot</p>
                    <a href={getImageUrl(order.paymentReceiptUrl)} target="_blank" rel="noopener noreferrer" className="inline-block relative overflow-hidden rounded-lg border border-slate-800">
                      <img 
                        src={getImageUrl(order.paymentReceiptUrl)} 
                        alt="Payment Receipt Screenshot" 
                        className="max-w-[120px] max-h-[120px] object-cover transition-transform duration-300 hover:scale-105"
                      />
                    </a>
                  </div>
                )}

              </div>
            ) : (
              /* COD Stamp badge */
              <div className="flex flex-col gap-3">
                <div className="inline-flex align-self-start items-center gap-1.5 bg-amber-500/10 text-amber-400 border-2 border-dashed border-amber-500/30 rounded-lg px-4 py-2 text-base font-black rotate-[-3deg] tracking-wider w-fit shadow-md">
                  PAY ON DELIVERY
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  No digital payment was uploaded. Please pay the delivery rider the exact payable sum in cash upon arrival.
                </p>
              </div>
            )}
          </div>

          {/* Delivery address & merchant contact card */}
          <div className="bg-[#111119]/80 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl flex flex-col gap-4">
            
            {/* Merchant customer support card */}
            <div className="border-b border-slate-800/80 pb-3">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Fulfillment Merchant</p>
              <h4 className="text-sm font-bold text-slate-200 mt-1">
                {order.storeId?.name || "Bazaar Merchant"}
              </h4>
              <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
                <MessageSquare size={13} style={{ color: 'var(--vendor-color)' }} />
                Support chat available in dashboard drawer.
              </p>
            </div>

            {/* Address */}
            <div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                <MapPin size={11} className="text-slate-500" /> Shipping Destination
              </p>
              <p className="text-xs text-slate-200 font-bold mt-2 leading-relaxed">
                {order.shippingAddress}, {order.city}
              </p>
            </div>

          </div>

          {/* Order Cancellation Control Card */}
          {order.status !== 'cancelled' && (
            <div className="bg-[#111119]/80 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl flex flex-col gap-3">
              <h3 className="text-sm font-bold border-b border-slate-800/80 pb-2 text-slate-100">
                Order Actions
              </h3>
              
              {order.cancellationRequested ? (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-xs">
                  <p className="font-bold text-amber-400">⚠️ Cancellation Request Pending</p>
                  <p className="text-slate-400 mt-1.5 leading-relaxed">
                    You have requested cancellation for this order (Reason: "{order.cancellationReason}"). The merchant is reviewing your request.
                  </p>
                </div>
              ) : (
                <>
                  {['pending_payment', 'pending_approval'].includes(order.status) ? (
                    <div>
                      <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                        You are within the 1-hour grace window. You can cancel this order instantly.
                      </p>
                      <button
                        onClick={() => {
                          if (confirm("Are you sure you want to cancel this order instantly?")) {
                            handleCancelOrder("Customer Cancel (Grace Window)");
                          }
                        }}
                        disabled={cancelling}
                        className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs w-full py-2.5 rounded-lg transition-colors border-none"
                      >
                        {cancelling ? "Processing..." : "Cancel Order Instantly"}
                      </button>
                    </div>
                  ) : order.status === 'processing' ? (
                    <div>
                      <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                        Fulfillment has started. You may request cancellation, subject to merchant approval.
                      </p>
                      <button
                        onClick={() => setShowCancelModal(true)}
                        className="bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 hover:border-violet-500 text-[var(--vendor-color)] font-bold text-xs w-full py-2.5 rounded-lg transition-all"
                        style={{ color: 'var(--vendor-color)' }}
                      >
                        Request Cancellation
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                        Fulfillment dispatched. Cancellation is locked.
                      </p>
                      <button
                        onClick={() => {
                          if (confirm("Cancellation is locked because the order has shipped. Clicking OK will automatically file a triage dispute ticket for the StoreAdmin. Proceed?")) {
                            handleCancelOrder("Customer attempted cancellation on locked dispatched order");
                          }
                        }}
                        disabled={cancelling}
                        className="bg-slate-900 border border-slate-800 text-slate-500 font-bold text-xs w-full py-2.5 rounded-lg transition-colors cursor-pointer"
                      >
                        {cancelling ? "Processing..." : "Cancel Order (Locked)"}
                      </button>
                    </div>
                  )}
                </>
              )}

              {cancelError && (
                <div className="text-rose-500 text-xs font-semibold mt-1">
                  {cancelError}
                </div>
              )}
              {cancelSuccess && (
                <div className="text-emerald-400 text-xs font-semibold mt-1">
                  {cancelSuccess}
                </div>
              )}
              {/* Order Retake / Return Action Launcher - Activates ONLY after product is Delivered */}
              {['delivered', 'return_requested', 'return_approved', 'return_rejected'].includes(order.status) && (
                <div className="border-t border-slate-800/80 pt-4 mt-2">
                  <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <RotateCcw size={14} /> Product Retake & Return Guarantee
                  </h4>

                  {order.status === 'return_requested' ? (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3.5 text-xs text-amber-300">
                      <p className="font-bold">⚠️ Retake Request Pending Merchant Review</p>
                      <p className="text-slate-400 text-[11px] mt-1">Reason: "{order.returnReason}"</p>
                    </div>
                  ) : order.status === 'return_approved' ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3.5 text-xs text-emerald-400">
                      <p className="font-bold">✅ Retake Approved & 100% Refunded</p>
                      <p className="text-slate-400 text-[11px] mt-1">A return rider has been dispatched. Refund credited to your Shopper Wallet.</p>
                    </div>
                  ) : order.status === 'return_rejected' ? (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3.5 text-xs text-rose-400">
                      <p className="font-bold">❌ Return Request Declined</p>
                      <p className="text-slate-400 text-[11px] mt-1">Note: {order.returnActionNotes || "Failed return policy criteria."}</p>
                    </div>
                  ) : (
                    <div>
                      {(() => {
                        const daysElapsed = (new Date().getTime() - new Date(order.updatedAt || order.createdAt).getTime()) / (1000 * 60 * 60 * 24);
                        if (daysElapsed > 6) {
                          return (
                            <p className="text-[11px] text-slate-500 italic">
                              🔒 Retake window expired (More than 6 days elapsed since delivery).
                            </p>
                          );
                        }
                        return (
                          <div>
                            <div className="flex justify-between items-center text-[11px] text-slate-400 mb-2">
                              <span>Policy Window:</span>
                              <span className={daysElapsed <= 3 ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                                {daysElapsed <= 3 ? "🛡️ 3-Day 100% Full Refund Guarantee" : "⚠️ Day 4-6 Evaluation Window"}
                              </span>
                            </div>
                            <button
                              onClick={() => setShowRetakeModal(true)}
                              className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs w-full py-2.5 rounded-lg shadow-lg transition-all border-none cursor-pointer"
                            >
                              Request Product Retake / Return
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Dispute Ticket Launcher & Status Tracking */}
          {existingTickets.length === 0 ? (
            <div className="bg-[#111119]/80 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl flex flex-col gap-3">
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                <AlertCircle size={16} className="text-rose-500" /> Need Help with this Order?
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                If you are experiencing order delays, received defective products, or have disputes regarding prices, file a formal complaint.
              </p>
              <button
                onClick={() => {
                  setDisputeTargetId(orderId);
                  setShowDisputeModal(true);
                }}
                className="bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 hover:border-rose-500 text-rose-400 font-bold text-xs w-full py-2.5 rounded-lg transition-all"
              >
                File a Dispute / Complaint
              </button>
            </div>
          ) : (
            existingTickets.map((ticket: any) => (
              <div key={ticket._id} className="bg-[#111119]/80 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl flex flex-col gap-3">
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5 justify-between">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck size={16} className="text-emerald-400" /> Dispute Ticket
                  </span>
                  <span className="text-[9px] px-2 py-0.5 rounded font-extrabold uppercase border"
                    style={{
                      background: ticket.status === 'resolved' ? "rgba(16,185,129,0.1)" : ticket.status === 'escalated' ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.1)",
                      color: ticket.status === 'resolved' ? "#10b981" : ticket.status === 'escalated' ? "#ef4444" : "#3b82f6",
                      borderColor: ticket.status === 'resolved' ? "rgba(16,185,129,0.2)" : ticket.status === 'escalated' ? "rgba(239,68,68,0.2)" : "rgba(59,130,246,0.2)"
                    }}
                  >
                    {ticket.status}
                  </span>
                </h4>
                <div className="text-xs text-slate-400 flex flex-col gap-2">
                  <div><strong>Category:</strong> <span className="capitalize">{ticket.category}</span></div>
                  <div><strong>Issue Description:</strong> {ticket.description}</div>
                  {ticket.evidenceUrl && (
                    <div className="mt-1">
                      <strong>Evidence Attachment:</strong>{" "}
                      <a href={`${API}${ticket.evidenceUrl}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--vendor-color)', textDecoration: "underline" }}>
                        View Uploaded Screenshot
                      </a>
                    </div>
                  )}
                  <hr className="border-slate-800" />
                  {ticket.vendorResponse?.message ? (
                    <div className="bg-slate-950/60 p-3 rounded-lg border-l-2 border-[var(--vendor-color)]">
                      <strong className="text-slate-200 block mb-1">Vendor Response:</strong>
                      <p className="margin-0">{ticket.vendorResponse.message}</p>
                      {ticket.vendorResponse.remedyType !== 'none' && (
                        <div className="mt-2 text-emerald-400 font-extrabold">
                          Remedy Offered: {ticket.vendorResponse.remedyType.toUpperCase()}
                          {ticket.vendorResponse.couponCode && (
                            <span className="block text-slate-300 bg-emerald-500/10 border border-dashed border-emerald-500/20 px-2 py-1 rounded mt-1 font-mono">
                              Coupon Code: {ticket.vendorResponse.couponCode}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="italic text-slate-500 text-[10px]">
                      Waiting for merchant response or administrative review.
                    </div>
                  )}
                  {ticket.adminDecision?.message && (
                    <div className="bg-emerald-500/5 p-3 rounded-lg border-l-2 border-emerald-500 mt-2">
                      <strong className="text-emerald-400 block mb-1">Official Ruling:</strong>
                      <p className="margin-0">{ticket.adminDecision.message}</p>
                      <span className="text-[10px] text-slate-500 block mt-1">Ruling type: {ticket.adminDecision.actionTaken}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

        </div>

      </div>

      {/* 5. Post-Delivery Two-Tier Reviews Release (Unlocks only on delivered/completed) */}
      {isDeliveredOrCompleted && (
        <div className="bg-[#111119]/80 border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl flex flex-col gap-6">
          
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-amber-400" />
            <h3 className="text-base font-bold text-slate-100">
              Rate Your Purchase Experience
            </h3>
          </div>

          {reviewSubmitted ? (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-6 text-center text-emerald-400">
              <p className="text-sm font-bold">✓ Verified Feedback Submitted!</p>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Thank you for contributing verified feedback. Your review will help future local shoppers discover this vendor.
              </p>
            </div>
          ) : (
            <form onSubmit={handleReviewSubmit} className="flex flex-col gap-4">
              
              {/* Star selector */}
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-2">Product & Service Rating</label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map(star => {
                    const filled = hoverRating !== null ? star <= hoverRating : star <= rating;
                    return (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(null)}
                        className="bg-none border-none p-0.5 transition-colors cursor-pointer"
                        style={{ color: filled ? "#f59e0b" : "rgba(255, 255, 255, 0.15)" }}
                      >
                        <Star size={24} style={{ fill: filled ? "#f59e0b" : "none" }} />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Text feedback comments */}
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-2">Write Verified Review</label>
                <textarea
                  className="bg-[#12121a] border border-slate-800 text-slate-100 rounded-lg p-3 w-full focus:outline-none focus:border-slate-700 text-xs resize-none"
                  rows={3}
                  placeholder="Share details of your experience (e.g. shipping speed, variant quality, sizing precision)..."
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  required
                />
              </div>

              {/* Mock media uploader */}
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-2">Attach Product Photo (Optional)</label>
                <div className="inline-flex items-center gap-2 border border-dashed border-slate-800 hover:border-slate-700 bg-slate-900/40 rounded-lg px-4 py-2.5 cursor-pointer text-xs text-slate-300 transition-colors">
                  <Camera size={14} style={{ color: 'var(--vendor-color)' }} />
                  <span className="font-semibold">Choose File</span>
                </div>
              </div>

              {reviewError && <p className="text-xs text-rose-500 font-semibold">{reviewError}</p>}

              <button 
                type="submit" 
                className="bg-[var(--vendor-color)] text-white hover:opacity-90 font-bold text-xs w-fit px-5 py-2.5 rounded-lg transition-colors border-none"
                style={{ backgroundColor: 'var(--vendor-color)' }}
                disabled={reviewing}
              >
                {reviewing ? "Publishing Review..." : "Submit Verified Review"}
              </button>

            </form>
          )}

        </div>
      )}

      {/* Dispute Filing Modal */}
      {showDisputeModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-filter backdrop-blur-md flex items-center justify-center z-[99999] p-6">
          <div className="bg-[#0d0d14] border border-slate-900 rounded-2xl w-full max-w-[480px] p-6 sm:p-8 text-slate-100 animate-fade-up">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-base font-bold">File a Dispute Ticket</h3>
              <button onClick={() => setShowDisputeModal(false)} className="bg-none border-none text-slate-500 hover:text-slate-400 text-lg cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleDisputeSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-2">Issue Category</label>
                <select
                  value={disputeCategory}
                  onChange={e => setDisputeCategory(e.target.value)}
                  className="w-full bg-[#12121a] border border-slate-800 text-slate-200 rounded-lg p-2.5 font-semibold text-xs focus:outline-none focus:border-slate-700"
                >
                  <option value="delay">Order Delivery Delay</option>
                  <option value="defective">Defective or Broken Item</option>
                  <option value="negotiation">Unfair Price Negotiation Outcome</option>
                  <option value="other">Other Queries/Complaints</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-2">Target of Complaint</label>
                <select
                  value={disputeTargetId}
                  onChange={e => setDisputeTargetId(e.target.value)}
                  className="w-full bg-[#12121a] border border-slate-800 text-slate-200 rounded-lg p-2.5 font-semibold text-xs focus:outline-none focus:border-slate-700"
                >
                  <option value={orderId}>Entire Order (#{orderId.slice(-8).toUpperCase()})</option>
                  {order.items?.map((item: any) => (
                    <option key={item.productId} value={item.productId}>
                      Product: {item.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-2">Detailed Description</label>
                <textarea
                  className="w-full bg-[#12121a] border border-slate-800 text-slate-100 rounded-lg p-3 text-xs resize-none focus:outline-none focus:border-slate-700"
                  rows={4}
                  required
                  placeholder="Provide details about order delays, defect symptoms, or haggle agreements..."
                  value={disputeDescription}
                  onChange={e => setDisputeDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-2">Upload Screenshot Evidence (Optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => setDisputeEvidence(e.target.files?.[0] || null)}
                  className="text-xs text-slate-400 cursor-pointer"
                />
              </div>

              {disputeError && (
                <div className="text-rose-500 text-xs font-semibold">
                  {disputeError}
                </div>
              )}

              {disputeSuccess && (
                <div className="text-emerald-400 text-xs font-semibold">
                  {disputeSuccess}
                </div>
              )}

              <button
                type="submit"
                disabled={disputeSubmitting}
                className="bg-[var(--vendor-color)] text-white hover:opacity-90 font-bold text-xs py-2.5 rounded-lg transition-colors border-none cursor-pointer w-full text-center mt-2"
                style={{ backgroundColor: 'var(--vendor-color)' }}
              >
                {disputeSubmitting ? "Submitting Dispute..." : "Submit Complaint Ticket"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Cancellation Request Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-filter backdrop-blur-md flex items-center justify-center z-[99999] p-6">
          <div className="bg-[#0d0d14] border border-slate-900 rounded-2xl w-full max-w-[440px] p-6 sm:p-8 text-slate-100 animate-fade-up">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-base font-bold">Request Order Cancellation</h3>
              <button onClick={() => setShowCancelModal(false)} className="bg-none border-none text-slate-500 hover:text-slate-400 text-lg cursor-pointer">✕</button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-2">Select Reason Code</label>
                <select
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  className="w-full bg-[#12121a] border border-slate-800 text-slate-200 rounded-lg p-2.5 font-semibold text-xs focus:outline-none focus:border-slate-700"
                >
                  <option value="Incorrect Delivery Address">Incorrect Delivery Address</option>
                  <option value="Changed Mind">Changed Mind</option>
                  <option value="Found Better Price">Found Better Price</option>
                  <option value="Other">Other (Specify below)</option>
                </select>
              </div>

              {cancelReason === "Other" && (
                <div>
                  <label className="text-xs text-slate-400 font-semibold block mb-2">Custom Reason</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter cancellation reason..."
                    value={customReason}
                    onChange={e => setCustomReason(e.target.value)}
                    className="w-full bg-[#12121a] border border-slate-800 text-slate-100 rounded-lg p-2.5 text-xs focus:outline-none focus:border-slate-700"
                  />
                </div>
              )}

              <button
                onClick={() => {
                  const finalReason = cancelReason === "Other" ? customReason : cancelReason;
                  handleCancelOrder(finalReason);
                }}
                disabled={cancelling || (cancelReason === "Other" && !customReason.trim())}
                className="bg-[var(--vendor-color)] text-white hover:opacity-90 font-bold text-xs py-2.5 rounded-lg transition-colors border-none cursor-pointer w-full text-center mt-2"
                style={{ backgroundColor: 'var(--vendor-color)' }}
              >
                {cancelling ? "Submitting Request..." : "Submit Cancellation Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retake Request Modal Component */}
      {showRetakeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-filter backdrop-blur-md flex items-center justify-center z-[99999] p-6">
          <div className="bg-[#0d0d14] border border-amber-500/30 rounded-2xl w-full max-w-[480px] p-6 sm:p-8 text-slate-100 animate-fade-up shadow-2xl">
            <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-amber-400 flex items-center gap-2">
                <RotateCcw size={18} /> Request Product Retake / Return
              </h3>
              <button onClick={() => setShowRetakeModal(false)} className="bg-none border-none text-slate-500 hover:text-slate-400 text-lg cursor-pointer">✕</button>
            </div>

            {retakeError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-4">
                {retakeError}
              </div>
            )}

            <form onSubmit={handleRetakeSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-slate-300 font-bold block mb-1.5">
                  Detailed Reason for Retake <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Explain issue (e.g. Defective item, wrong size, damaged packaging)..."
                  value={retakeReason}
                  onChange={e => setRetakeReason(e.target.value)}
                  className="w-full bg-[#12121a] border border-slate-800 text-slate-100 rounded-lg p-3 text-xs focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-bold block mb-1.5 flex justify-between items-center">
                  <span>Photo Evidence Screenshot / Image <span className="text-rose-500">*</span></span>
                  {retakeUploading && <span className="text-amber-400 text-[10px] animate-pulse">Uploading file...</span>}
                </label>

                {/* File picker button from device */}
                <div className="flex gap-2 mb-2">
                  <label className="bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2 rounded-lg cursor-pointer flex items-center gap-1.5 transition-colors">
                    <Camera size={14} className="text-amber-400" />
                    {retakeUploading ? "Uploading..." : "Choose File from Device"}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleRetakeFileUpload}
                      className="hidden"
                    />
                  </label>

                  {retakePhotoUrl && (
                    <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] px-2.5 py-1 rounded-lg font-bold">
                      <Check size={12} /> Image Attached
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  required
                  placeholder="https://i.ibb.co/evidence.jpg (or paste image URL)"
                  value={retakePhotoUrl}
                  onChange={e => setRetakePhotoUrl(e.target.value)}
                  className="w-full bg-[#12121a] border border-slate-800 text-slate-100 rounded-lg p-3 text-xs focus:outline-none focus:border-amber-500/50"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Upload directly from your device or paste a photo link. Required for merchant verification.
                </p>
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowRetakeModal(false)}
                  className="flex-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 font-bold text-xs py-2.5 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={retakeSubmitting}
                  className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs py-2.5 rounded-lg transition-all border-none cursor-pointer"
                >
                  {retakeSubmitting ? "Submitting..." : "Submit Retake Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

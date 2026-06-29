"use client";
import React, { useState, useEffect } from "react";
import { useCart } from "@/context/CartContext";
import { X, ShoppingBag, Plus, Minus, Trash, ArrowLeft, CreditCard, Truck, Upload, CheckCircle, AlertCircle, Loader } from "lucide-react";
import Link from "next/link";
import { getImageUrl } from "@/utils/imageUrl";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Pakistani major cities
const CITIES = [
  "Faisalabad", "Lahore", "Karachi", "Islamabad", "Rawalpindi", 
  "Peshawar", "Multan", "Sialkot", "Gujranwala", "Quetta"
];

export default function CartDrawer() {
  const { cart, isCartOpen, setIsCartOpen, removeFromCart, updateQuantity, clearCart } = useCart();
  const [checkoutStoreId, setCheckoutStoreId] = useState<string | null>(null);
  
  // Checkout states
  const [shippingAddress, setShippingAddress] = useState("");
  const [city, setCity] = useState(CITIES[0]);
  const [deliveryType, setDeliveryType] = useState<"in-city" | "out-of-city">("in-city");
  const [customNotes, setCustomNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponError, setCouponError] = useState("");
  const [verifyingCoupon, setVerifyingCoupon] = useState(false);
  const [storeCoupons, setStoreCoupons] = useState<any[]>([]);
  const [isCouponsDrawerOpen, setIsCouponsDrawerOpen] = useState(false);
  
  // Payment states
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "bank_transfer">("cod");
  const [referenceId, setReferenceId] = useState("");
  const [storeDetails, setStoreDetails] = useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [ocrResult, setOcrResult] = useState<any>(null);
  
  // Submission states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<any>(null);
  const [successStoreSlug, setSuccessStoreSlug] = useState("");
  const [orderError, setOrderError] = useState("");
  const [user, setUser] = useState<any>(null);

  // RTO Protection states
  const [rtoData, setRtoData] = useState<any>(null);
  const [rtoChecked, setRtoChecked] = useState(false);
  const [checkingRto, setCheckingRto] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("bazaar_user");
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch {}
    }
  }, [isCartOpen]);

  // Group cart items by store
  const itemsByStore: Record<string, { storeName: string; storeSlug: string; items: any[] }> = {};
  cart.forEach(item => {
    const sId = item.storeId || "unknown";
    if (!itemsByStore[sId]) {
      itemsByStore[sId] = {
        storeName: item.storeName || "Local Merchant Store",
        storeSlug: item.storeSlug || "store",
        items: []
      };
    }
    itemsByStore[sId].items.push(item);
  });

  // Fetch store bank credentials and active coupons when checkout store changes
  useEffect(() => {
    if (!checkoutStoreId) {
      setStoreDetails(null);
      setStoreCoupons([]);
      setIsCouponsDrawerOpen(false);
      return;
    }
    const storeInfo = cart.find(item => item.storeId === checkoutStoreId);
    if (!storeInfo?.storeSlug) return;

    fetch(`${API}/api/auth/store/slug/${storeInfo.storeSlug}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStoreDetails(data.store);
        }
      })
      .catch(err => console.error("Failed to load store credentials:", err));

    // Fetch active coupons for discovery drawer
    fetch(`${API}/api/coupons/public/store/${checkoutStoreId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStoreCoupons(data.coupons || []);
        }
      })
      .catch(err => console.error("Failed to load store coupons:", err));
  }, [checkoutStoreId]);

  const checkRtoStatus = async () => {
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;
    setCheckingRto(true);
    try {
      const res = await fetch(`${API}/api/orders/rto-check`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setRtoData(data);
      }
    } catch (err) {
      console.error("Failed to check RTO status:", err);
    } finally {
      setCheckingRto(false);
      setRtoChecked(true);
    }
  };

  useEffect(() => {
    if (checkoutStoreId && paymentMethod === "cod") {
      checkRtoStatus();
    } else {
      setRtoData(null);
      setRtoChecked(false);
    }
  }, [checkoutStoreId, paymentMethod]);

  if (!isCartOpen) return null;

  // Address Validation - Pakistan format colony/sector/block check (supporting urban & rural Chak numbers)
  const validateAddress = (addr: string) => {
    const clean = addr.toLowerCase();
    
    // Check if rural "Chak" format is used
    const isRuralChak = clean.includes("chak") && (/\d+/.test(clean) || clean.includes("no") || clean.includes("number") || clean.includes("#"));
    if (isRuralChak) return true;

    const hasSector = clean.includes("sector") || clean.includes("phase") || clean.includes("town") || clean.includes("colony") || clean.includes("scheme");
    const hasBlock = clean.includes("block") || clean.includes("street") || clean.includes("st ") || clean.includes("house") || clean.includes("h#") || clean.includes("flat");
    return hasSector && hasBlock;
  };

  const handleVerifyCoupon = async () => {
    if (!couponCode.trim() || !checkoutStoreId) return;
    setVerifyingCoupon(true);
    setCouponError("");
    setAppliedCoupon(null);
    setCouponDiscount(0);

    const storeItems = itemsByStore[checkoutStoreId].items;
    const subtotal = storeItems.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
    const token = localStorage.getItem("bazaar_token");

    try {
      const res = await fetch(`${API}/api/coupons/validate`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ storeId: checkoutStoreId, code: couponCode, cartAmount: subtotal })
      });
      const data = await res.json();
      if (data.success) {
        setAppliedCoupon(data.coupon);
        setCouponDiscount(data.discountAmount);
      } else {
        setCouponError(data.message || "Failed to validate coupon");
      }
    } catch (err) {
      setCouponError("Server connection error validating code");
    } finally {
      setVerifyingCoupon(false);
    }
  };

  // Handle receipt upload & OCR extraction
  const handleReceiptChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
    setUploadingReceipt(true);
    setOrderError("");

    const token = localStorage.getItem("bazaar_token");
    const formData = new FormData();
    formData.append("receipt", file);

    try {
      const res = await fetch(`${API}/api/orders/upload-receipt`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setReceiptUrl(data.paymentReceiptUrl);
        setOcrResult(data.ocrResult);
        if (data.ocrResult?.referenceNumber) {
          setReferenceId(data.ocrResult.referenceNumber);
        }
      } else {
        setOrderError(data.message || "OCR analysis failed on receipt upload");
      }
    } catch (err) {
      setOrderError("Network error uploading bank receipt");
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutStoreId) return;

    // Validate Pakistani Address
    if (!validateAddress(shippingAddress)) {
      setOrderError("Pakistan Address Validation: Please specify a block, housing colony/colony/sector, street and house number, or a valid Chak Number (for rural areas).");
      return;
    }

    const SERVICEABLE_CITIES = ["karachi", "lahore", "islamabad", "faisalabad", "rawalpindi"];
    if (!SERVICEABLE_CITIES.includes(city.toLowerCase())) {
      setOrderError(`Fulfillment Serviceability Alert: City '${city}' is not a serviceable logistics hub. We only deliver to Karachi, Lahore, Islamabad, Faisalabad, and Rawalpindi.`);
      return;
    }

    if (paymentMethod === "bank_transfer") {
      if (!receiptUrl) {
        setOrderError("Please upload a bank transaction receipt screenshot.");
        return;
      }
      if (!referenceId.trim()) {
        setOrderError("Alphanumeric reference ID is required for bank transfer verification.");
        return;
      }
    }

    setIsSubmitting(true);
    setOrderError("");
    const token = localStorage.getItem("bazaar_token");
    const storeItems = itemsByStore[checkoutStoreId].items;
    const subtotal = storeItems.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
    const totalQty = storeItems.reduce((sum, item) => sum + item.quantity, 0);
    const originCity = storeDetails?.originCity || "Lahore";
    const isInCity = originCity.toLowerCase() === city.toLowerCase();
    const dynamicShippingFee = isInCity ? 60 : (250 + (totalQty * 50) + 20);
    const calculatedDeliveryType = isInCity ? "in-city" : "out-of-city";

    const payload = {
      storeId: checkoutStoreId,
      items: storeItems.map(i => ({ productId: i.productId, quantity: i.quantity, title: i.title, price: i.price })),
      totalAmount: subtotal - couponDiscount + dynamicShippingFee,
      shippingAddress,
      city,
      deliveryType: calculatedDeliveryType,
      customNotes,
      couponCode: appliedCoupon?.code || "",
      paymentMethod,
      referenceId,
      paymentReceiptUrl: receiptUrl,
      ocrResult
    };

    try {
      const res = await fetch(`${API}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessStoreSlug(itemsByStore[checkoutStoreId].storeSlug);
        setOrderSuccess(data.order);
        // Clear checked-out items from the global cart
        storeItems.forEach(i => removeFromCart(i.productId));
        // Reset states
        setCheckoutStoreId(null);
        setShippingAddress("");
        setCouponCode("");
        setAppliedCoupon(null);
        setCouponDiscount(0);
        setReferenceId("");
        setReceiptUrl("");
        setOcrResult(null);
        setReceiptFile(null);
        setReceiptPreview(null);
      } else {
        setOrderError(data.message || "Failed to submit checkout order");
      }
    } catch (err) {
      setOrderError("Network transaction timeout during submission");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", justifyContent: "flex-end" }}>
      <div 
        style={{
          width: "100%",
          maxWidth: "460px",
          height: "100vh",
          background: "#ffffff",
          color: "#1a1a1a",
          borderLeft: "1px solid rgba(0,0,0,0.08)",
          display: "flex",
          flexDirection: "column",
          position: "relative"
        }}
      >
        {/* Header */}
        <div style={{ padding: "1.2rem 1.5rem", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {checkoutStoreId && (
              <button type="button" onClick={() => { setCheckoutStoreId(null); setOrderError(""); }} style={{ background: "none", border: "none", cursor: "pointer", marginRight: "0.25rem", color: "var(--text-muted)" }}>
                <ArrowLeft size={20} />
              </button>
            )}
            <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>
              {checkoutStoreId ? "Direct Vendor Routing" : "Your Shopping Basket"}
            </h3>
          </div>
          <button type="button" onClick={() => setIsCartOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(0,0,0,0.4)" }}>
            <X size={22} />
          </button>
        </div>

        {/* Dynamic Inner views */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column" }}>
          
          {orderSuccess ? (
            <div style={{ textAlign: "center", padding: "3rem 1rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
              <CheckCircle size={56} style={{ color: "#10b981" }} />
              <h2 style={{ fontSize: "1.3rem", fontWeight: 800 }}>Order Placed Successfully!</h2>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5, maxWidth: "300px" }}>
                Order #{orderSuccess._id.slice(-8).toUpperCase()} has been submitted. The merchant will review details shortly.
              </p>
              <div style={{ display: "flex", gap: "1rem", marginTop: "1rem", width: "100%" }}>
                <Link 
                  href={`/shop/${successStoreSlug}/order/${orderSuccess._id}`} 
                  onClick={() => { setOrderSuccess(null); setIsCartOpen(false); }}
                  className="btn-primary" 
                  style={{ flex: 1, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
                >
                  Track Order
                </Link>
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={() => { setOrderSuccess(null); setIsCartOpen(false); }} 
                  style={{ flex: 1 }}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : !user ? (
            <div style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--text-muted)" }}>
              <ShoppingBag size={48} style={{ margin: "0 auto 1.2rem", opacity: 0.3 }} />
              <p style={{ fontSize: "0.9rem", marginBottom: "1.5rem" }}>Please log in to complete checkout.</p>
              <Link href="/auth/login" className="btn-primary" onClick={() => setIsCartOpen(false)}>
                Log In to Account
              </Link>
            </div>
          ) : cart.length === 0 ? (
            <div style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--text-muted)" }}>
              <ShoppingBag size={48} style={{ margin: "0 auto 1.2rem", opacity: 0.3 }} />
              <p style={{ fontSize: "0.9rem" }}>Your shopping basket is empty.</p>
            </div>
          ) : !checkoutStoreId ? (
            /* 1. Basket Groups View */
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
              {Object.keys(itemsByStore).map(storeId => {
                const group = itemsByStore[storeId];
                const subtotal = group.items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);

                return (
                  <div key={storeId} style={{ border: "1px solid rgba(0,0,0,0.06)", borderRadius: "12px", padding: "1rem", background: "#fdfdfd" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(0,0,0,0.04)", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
                      <h4 style={{ fontWeight: 800, fontSize: "0.9rem", color: storeId === "unknown" ? "#ef4444" : "#7c3aed" }}>
                        {storeId === "unknown" ? "⚠️ Legacy Cart Items (Please Re-Add)" : `Store: ${group.storeName}`}
                      </h4>
                      {storeId !== "unknown" && (
                        <Link href={`/shop/${group.storeSlug}`} onClick={() => setIsCartOpen(false)} style={{ fontSize: "0.75rem", color: "var(--text-muted)", textDecoration: "none", fontWeight: 600 }}>
                          Visit Store
                        </Link>
                      )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {group.items.map(item => (
                        <div key={item.productId} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                          <div style={{ width: "48px", height: "48px", borderRadius: "6px", background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.04)", overflow: "hidden" }}>
                            {item.image ? (
                              <img src={getImageUrl(item.image)} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <div style={{ width: "100%", height: "100%", background: "#7c3aed10" }} />
                            )}
                          </div>
                          
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: "0.82rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.title}
                            </p>
                            <p style={{ fontSize: "0.8rem", color: "#7c3aed", fontWeight: 800, marginTop: "0.1rem" }}>
                              Rs. {item.price}
                            </p>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(0,0,0,0.03)", padding: "0.2rem", borderRadius: "6px" }}>
                            <button type="button" onClick={() => updateQuantity(item.productId, item.quantity - 1)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)" }}>
                              <Minus size={11} />
                            </button>
                            <span style={{ fontSize: "0.78rem", fontWeight: 700, minWidth: "14px", textAlign: "center" }}>{item.quantity}</span>
                            <button type="button" onClick={() => updateQuantity(item.productId, item.quantity + 1)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)" }}>
                              <Plus size={11} />
                            </button>
                          </div>

                          <button type="button" onClick={() => removeFromCart(item.productId)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444" }}>
                            <Trash size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div style={{ borderTop: "1px solid rgba(0,0,0,0.04)", marginTop: "1rem", paddingTop: "0.8rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Store Subtotal</p>
                        <p style={{ fontSize: "1.1rem", fontWeight: 900, color: "#1a1a1a" }}>Rs. {subtotal.toLocaleString()}</p>
                      </div>
                      {storeId === "unknown" ? (
                        <span style={{ fontSize: "0.72rem", color: "#ef4444", fontWeight: 700, maxWidth: "200px", textAlign: "right" }}>
                          Please remove and re-add items to checkout
                        </span>
                      ) : (
                        <button 
                          type="button"
                          className="btn-primary" 
                          onClick={() => setCheckoutStoreId(storeId)}
                          style={{ fontSize: "0.8rem", padding: "0.45rem 1rem" }}
                        >
                          Checkout Store Order
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 2. Direct Vendor Routing Checkout Form */
            <form onSubmit={handleCheckoutSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div style={{ borderBottom: "1px solid rgba(0,0,0,0.05)", paddingBottom: "0.75rem" }}>
                <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Checking out order for:</p>
                <h4 style={{ fontWeight: 800, fontSize: "1rem", color: "#7c3aed" }}>
                  {itemsByStore[checkoutStoreId].storeName}
                </h4>
              </div>

              {/* Delivery Details */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <h5 style={{ fontSize: "0.82rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em" }}>Delivery Address</h5>
                
                {/* Pakistan Local Address Guidelines Info Tip */}
                <div style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: "8px", padding: "0.6rem 0.8rem", fontSize: "0.72rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                  🇵🇰 <strong>Pakistan Address Standard</strong>: Ensure you include your Colony/Town/Sector AND Block/House Number (e.g. <i>House 12, Block C, Anarkali Colony</i>), or a valid Chak Number (e.g. <i>Chak No. 203 RB</i>).
                </div>

                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", marginBottom: "0.25rem" }}>Select City</label>
                  <select 
                    className="input-field" 
                    value={city} 
                    onChange={e => setCity(e.target.value)}
                    style={{ height: "38px", fontSize: "0.85rem", padding: "0 0.5rem" }}
                  >
                    {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", marginBottom: "0.25rem" }}>Residential Address Details</label>
                  <textarea 
                    className="input-field" 
                    rows={2}
                    placeholder="Enter Colony, Block, House No OR Chak Number (e.g. Chak No. 203 RB)..."
                    value={shippingAddress}
                    onChange={e => setShippingAddress(e.target.value)}
                    style={{ fontSize: "0.85rem", resize: "none" }}
                    required
                  />
                </div>

                {(() => {
                  const totalQty = itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + item.quantity, 0);
                  const origin = storeDetails?.originCity || "Lahore";
                  const isInCity = origin.toLowerCase() === city.toLowerCase();
                  
                  return (
                    <div style={{ 
                      background: isInCity ? "rgba(16,185,129,0.06)" : "rgba(124,58,237,0.06)", 
                      border: isInCity ? "1px solid rgba(16,185,129,0.15)" : "1px solid rgba(124,58,237,0.15)",
                      borderRadius: "8px", 
                      padding: "0.8rem", 
                      fontSize: "0.78rem" 
                    }}>
                      <p style={{ fontWeight: 800, color: isInCity ? "#10b981" : "#a855f7", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                        ⚡ {isInCity ? "In-City Geo-Match" : "Out-of-City Geo-Route"}
                      </p>
                      <p style={{ color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                        Store Origin: <strong>{origin}</strong> → Customer Destination: <strong>{city}</strong>
                      </p>
                      <p style={{ color: "var(--text-muted)", marginTop: "0.2rem", fontSize: "0.72rem" }}>
                        Fulfillment SLA: <strong>{isInCity ? "24-48 Hours" : "3-5 operational business days"}</strong>
                      </p>
                    </div>
                  );
                })()}

                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", marginBottom: "0.25rem" }}>Fulfillment Notes (Optional)</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="Rider instructions, Gate code..."
                    value={customNotes}
                    onChange={e => setCustomNotes(e.target.value)}
                    style={{ fontSize: "0.85rem" }}
                  />
                </div>
              </div>

              {/* Coupon Verification Code */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700 }}>Promo Coupon Code</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="e.g. PAK011, EID500"
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    style={{ fontSize: "0.85rem", height: "38px" }}
                    disabled={!!appliedCoupon}
                  />
                  {appliedCoupon ? (
                    <button 
                      type="button" 
                      onClick={() => { setAppliedCoupon(null); setCouponDiscount(0); }} 
                      className="btn-secondary" 
                      style={{ fontSize: "0.75rem", height: "38px", borderColor: "#ef4444", color: "#ef4444", padding: "0 1rem" }}
                    >
                      Clear
                    </button>
                  ) : (
                    <button 
                      type="button" 
                      onClick={handleVerifyCoupon} 
                      className="btn-primary" 
                      style={{ fontSize: "0.75rem", height: "38px", padding: "0 1.2rem" }}
                      disabled={verifyingCoupon || !couponCode.trim()}
                    >
                      {verifyingCoupon ? "Checking..." : "Verify"}
                    </button>
                  )}
                </div>
                {couponError && <p style={{ fontSize: "0.72rem", color: "#ef4444", fontWeight: 600 }}>{couponError}</p>}
                {appliedCoupon && (
                  <p style={{ fontSize: "0.72rem", color: "#10b981", fontWeight: 700 }}>
                    ✓ Promo Applied! Discounting Rs. {couponDiscount} ({appliedCoupon.discountType === "percentage" ? `${appliedCoupon.discountValue}%` : "Fixed"})
                  </p>
                )}

                {/* Expandable Store Coupons Drawer */}
                {storeCoupons.length > 0 && (
                  <div style={{ border: "1px solid rgba(0,0,0,0.06)", borderRadius: "8px", overflow: "hidden", marginTop: "0.25rem" }}>
                    <button
                      type="button"
                      onClick={() => setIsCouponsDrawerOpen(!isCouponsDrawerOpen)}
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        background: "rgba(0,0,0,0.02)",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "0.75rem",
                        fontWeight: 800,
                        color: "var(--text-secondary)"
                      }}
                    >
                      <span>View Available Store Coupons ({storeCoupons.length})</span>
                      <span>{isCouponsDrawerOpen ? "▲" : "▼"}</span>
                    </button>

                    {isCouponsDrawerOpen && (
                      <div style={{ padding: "0.75rem", background: "#ffffff", display: "flex", flexDirection: "column", gap: "0.5rem", borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                        {storeCoupons.map((coupon: any) => (
                          <div 
                            key={coupon._id} 
                            onClick={() => {
                              if (!appliedCoupon) {
                                setCouponCode(coupon.code);
                                setCouponError("");
                              }
                            }}
                            style={{
                              padding: "0.5rem 0.6rem",
                              borderRadius: "6px",
                              border: "1px solid rgba(124,58,237,0.15)",
                              background: "rgba(124,58,237,0.02)",
                              cursor: appliedCoupon ? "not-allowed" : "pointer",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontSize: "0.72rem",
                              transition: "all 0.15s"
                            }}
                          >
                            <div>
                              <span style={{ fontWeight: 900, color: "#7c3aed", background: "rgba(124,58,237,0.1)", padding: "0.1rem 0.3rem", borderRadius: "4px" }}>
                                {coupon.code}
                              </span>
                              <span style={{ marginLeft: "0.5rem", color: "var(--text-primary)", fontWeight: 700 }}>
                                {coupon.discountType === "percentage" ? `${coupon.discountValue}% Off` : `Rs. ${coupon.discountValue} Off`}
                              </span>
                              <p style={{ margin: "0.15rem 0 0 0", fontSize: "0.62rem", color: "var(--text-muted)" }}>
                                Min Spend: Rs. {coupon.minSpend.toLocaleString()}
                              </p>
                            </div>
                            {!appliedCoupon && (
                              <span style={{ fontSize: "0.68rem", color: "#7c3aed", fontWeight: 800 }}>Apply</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Payment Split Direct Routing */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <h5 style={{ fontSize: "0.82rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em" }}>Payment Route Options</h5>
                
                {/* Tabs */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <button 
                    type="button"
                    onClick={() => { setPaymentMethod("cod"); setOrderError(""); }}
                    style={{ 
                      display: "flex", gap: "0.4rem", alignItems: "center", justifyContent: "center",
                      padding: "0.5rem", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer",
                      border: `1.5px solid ${paymentMethod === "cod" ? "#7c3aed" : "rgba(0,0,0,0.08)"}`,
                      background: paymentMethod === "cod" ? "rgba(124,58,237,0.05)" : "#ffffff",
                      color: paymentMethod === "cod" ? "#7c3aed" : "var(--text-secondary)"
                    }}
                  >
                    <Truck size={14} /> Cash on Delivery
                  </button>
                  <button 
                    type="button"
                    onClick={() => { setPaymentMethod("bank_transfer"); setOrderError(""); }}
                    style={{ 
                      display: "flex", gap: "0.4rem", alignItems: "center", justifyContent: "center",
                      padding: "0.5rem", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer",
                      border: `1.5px solid ${paymentMethod === "bank_transfer" ? "#7c3aed" : "rgba(0,0,0,0.08)"}`,
                      background: paymentMethod === "bank_transfer" ? "rgba(124,58,237,0.05)" : "#ffffff",
                      color: paymentMethod === "bank_transfer" ? "#7c3aed" : "var(--text-secondary)"
                    }}
                  >
                    <CreditCard size={14} /> Bank / Wallet Transfer
                  </button>
                </div>

                {/* Cash on Delivery Notice */}
                {paymentMethod === "cod" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "10px", padding: "0.8rem 1rem", fontSize: "0.78rem", lineHeight: 1.4, color: "var(--text-secondary)" }}>
                      🏍️ <strong>COD Shipping</strong>: Payment will be physically collected by the merchant's private delivery rider or their logistics partner (e.g. Trax/TCS) upon delivery.
                    </div>
                    {rtoData?.isHighRisk && (
                      <div style={{
                        background: "rgba(239, 68, 68, 0.08)",
                        border: "1px solid rgba(239, 68, 68, 0.25)",
                        borderRadius: "10px",
                        padding: "0.85rem 1rem",
                        marginTop: "0.25rem"
                      }}>
                        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "#ef4444", fontWeight: 700, fontSize: "0.78rem" }}>
                          <AlertCircle size={14} />
                          <span>RTO Logistics Downpayment Flagged</span>
                        </div>
                        <p style={{ fontSize: "0.74rem", color: "var(--text-secondary)", margin: "0.25rem 0", lineHeight: 1.4 }}>
                          Attention: Due to a history of cancelled/refused COD orders, the platform requires a <strong>15% partial down-payment (Rs. {Math.round((itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0) - couponDiscount + (() => {
                            const totalQty = itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + item.quantity, 0);
                            const origin = storeDetails?.originCity || "Lahore";
                            const isInCity = origin.toLowerCase() === city.toLowerCase();
                            return isInCity ? 60 : (250 + (totalQty * 50) + 20);
                          })()) * 0.15)}</strong>) from your digital wallet balance to secure this shipment.
                        </p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem", borderTop: "1px dashed rgba(239,68,68,0.2)", paddingTop: "0.4rem", fontSize: "0.74rem" }}>
                          <span style={{ color: "var(--text-muted)" }}>Shopper Wallet Balance:</span>
                          <strong style={{ color: rtoData.walletBalance >= Math.round((itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0) - couponDiscount + (() => {
                            const totalQty = itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + item.quantity, 0);
                            const origin = storeDetails?.originCity || "Lahore";
                            const isInCity = origin.toLowerCase() === city.toLowerCase();
                            return isInCity ? 60 : (250 + (totalQty * 50) + 20);
                          })()) * 0.15) ? "#10b981" : "#ef4444" }}>
                            Rs. {rtoData.walletBalance.toLocaleString()}
                          </strong>
                        </div>
                        {rtoData.walletBalance < Math.round((itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0) - couponDiscount + (() => {
                          const totalQty = itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + item.quantity, 0);
                          const origin = storeDetails?.originCity || "Lahore";
                          const isInCity = origin.toLowerCase() === city.toLowerCase();
                          return isInCity ? 60 : (250 + (totalQty * 50) + 20);
                        })()) * 0.15) && (
                          <p style={{ fontSize: "0.7rem", color: "#ef4444", fontWeight: 700, margin: "0.3rem 0 0 0" }}>
                            ⚠️ Insufficient wallet balance. Please top up your shopper wallet in your profile to checkout.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Direct Manual Vendor Transfer instructions and credentials */}
                {paymentMethod === "bank_transfer" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", background: "rgba(124,58,237,0.02)", border: "1px solid rgba(124,58,237,0.08)", borderRadius: "10px", padding: "1rem" }}>
                    
                    {storeDetails?.bankDetails?.bankName ? (
                      <div style={{ fontSize: "0.8rem", color: "var(--text-primary)", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                        <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Merchant Payment Credentials</p>
                        <p><strong>Bank/Wallet:</strong> {storeDetails.bankDetails.bankName}</p>
                        <p><strong>Account Name:</strong> {storeDetails.bankDetails.accountName}</p>
                        <p><strong>Account/Mobile Number:</strong> <code style={{ background: "rgba(0,0,0,0.04)", padding: "0.1rem 0.3rem", borderRadius: "4px" }}>{storeDetails.bankDetails.accountNumber}</code></p>
                        <p style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontStyle: "italic", marginTop: "0.25rem" }}>
                          ℹ️ Instruction: {storeDetails.bankDetails.instruction || "Transfer money inside your bank app, take screenshot, and upload receipt."}
                        </p>
                      </div>
                    ) : (
                      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Loading store bank details...</p>
                    )}

                    <hr style={{ border: "none", borderTop: "1px dashed rgba(0,0,0,0.08)" }} />

                    {/* Media uploader zone */}
                    <div>
                      <label style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", marginBottom: "0.4rem" }}>Upload Receipt Screenshot</label>
                      
                      <div style={{ position: "relative", border: "2px dashed rgba(124,58,237,0.25)", borderRadius: "10px", padding: "1rem", textAlign: "center", cursor: "pointer", background: "#ffffff" }}>
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleReceiptChange}
                          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}
                        />
                        {uploadingReceipt ? (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem" }}>
                            <Loader size={20} style={{ animation: "spin 1s linear infinite", color: "#7c3aed" }} />
                            <span style={{ fontSize: "0.72rem" }}>Analyzing Receipt via OCR...</span>
                          </div>
                        ) : receiptUrl ? (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem" }}>
                            <CheckCircle size={20} style={{ color: "#10b981" }} />
                            <span style={{ fontSize: "0.72rem", color: "#10b981", fontWeight: 700 }}>Receipt Linked Successfully</span>
                            {ocrResult && (
                              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                                OCR Detected Reference: {ocrResult.referenceNumber || "Unknown"}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem", color: "#7c3aed" }}>
                            <Upload size={20} />
                            <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>Click or Drag image file</span>
                            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>PNG, JPG up to 5MB</span>
                          </div>
                        )}
                      </div>

                      {receiptPreview && (
                        <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "center" }}>
                          <img src={receiptPreview} alt="Receipt Preview" style={{ maxHeight: "80px", borderRadius: "6px", border: "1px solid rgba(0,0,0,0.08)" }} />
                        </div>
                      )}
                    </div>

                    {/* Reference ID manual field */}
                    <div>
                      <label style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", marginBottom: "0.25rem" }}>Alphanumeric Transaction Reference ID</label>
                      <input 
                        type="text" 
                        className="input-field" 
                        placeholder="Enter bank transaction reference number..."
                        value={referenceId}
                        onChange={e => setReferenceId(e.target.value)}
                        style={{ fontSize: "0.85rem", height: "38px" }}
                        required={paymentMethod === "bank_transfer"}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Error messages */}
              {orderError && (
                <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)", borderRadius: "8px", padding: "0.6rem 0.8rem", fontSize: "0.75rem", color: "#ef4444", display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <AlertCircle size={14} style={{ flexShrink: 0 }} />
                  <span>{orderError}</span>
                </div>
              )}

              {/* Invoice Breakdown */}
              <div style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.04)", borderRadius: "12px", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.8rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Items Subtotal:</span>
                  <span style={{ fontWeight: 600 }}>Rs. {itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0).toLocaleString()}</span>
                </div>
                {couponDiscount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#10b981" }}>
                    <span>Coupon Discount:</span>
                    <span style={{ fontWeight: 700 }}>-Rs. {couponDiscount.toLocaleString()}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Delivery Premium ({(() => {
                    const origin = storeDetails?.originCity || "Lahore";
                    const isInCity = origin.toLowerCase() === city.toLowerCase();
                    return isInCity ? "Same-City Rider" : "Courier SLA";
                  })()}):</span>
                  <span style={{ fontWeight: 600 }}>+Rs. {(() => {
                    const totalQty = itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + item.quantity, 0);
                    const origin = storeDetails?.originCity || "Lahore";
                    const isInCity = origin.toLowerCase() === city.toLowerCase();
                    return isInCity ? 60 : (250 + (totalQty * 50) + 20);
                  })().toLocaleString()}</span>
                </div>
                <hr style={{ margin: "0.25rem 0", border: "none", borderTop: "1px solid rgba(0,0,0,0.06)" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", fontWeight: 900 }}>
                  <span>Total Payable:</span>
                  <span style={{ color: "#7c3aed" }}>
                    Rs. {(
                      itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0) - 
                      couponDiscount + 
                      (() => {
                        const totalQty = itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + item.quantity, 0);
                        const origin = storeDetails?.originCity || "Lahore";
                        const isInCity = origin.toLowerCase() === city.toLowerCase();
                        return isInCity ? 60 : (250 + (totalQty * 50) + 20);
                      })()
                    ).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Submit Button */}
              <button 
                type="submit" 
                className="btn-primary" 
                style={{ width: "100%", height: "44px", justifyContent: "center", fontSize: "0.9rem" }}
                disabled={
                  isSubmitting || 
                  uploadingReceipt || 
                  (paymentMethod === "cod" && rtoData?.isHighRisk && rtoData.walletBalance < Math.round((itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0) - couponDiscount + (() => {
                    const totalQty = itemsByStore[checkoutStoreId].items.reduce((sum, item) => sum + item.quantity, 0);
                    const origin = storeDetails?.originCity || "Lahore";
                    const isInCity = origin.toLowerCase() === city.toLowerCase();
                    return isInCity ? 60 : (250 + (totalQty * 50) + 20);
                  })()) * 0.15))
                }
              >
                {isSubmitting ? (
                  <span style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> Submitting Order...
                  </span>
                ) : (
                  "Confirm Order Submission"
                )}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}

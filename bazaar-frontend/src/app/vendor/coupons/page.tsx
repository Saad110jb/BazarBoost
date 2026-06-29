"use client";
import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import StoreSwitcher from "@/components/StoreSwitcher";
import { 
  Tag, Clock, Percent, DollarSign, Calendar, AlertCircle, 
  CheckCircle, Plus, Sparkles, Loader, ShoppingBag, Eye, Package, X 
} from "lucide-react";
import { getImageUrl } from "@/utils/imageUrl";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function VendorCouponsPage() {
  const [activeTab, setActiveTab] = useState<"coupons" | "flash-sales">("coupons");
  const [coupons, setCoupons] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [activeStoreId, setActiveStoreId] = useState("");
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // Coupon Form state
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"fixed" | "percentage">("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  // Flash Sale Row Form states (per product id)
  const [salePrices, setSalePrices] = useState<{[id: string]: string}>({});
  const [saleExpirations, setSaleExpirations] = useState<{[id: string]: string}>({});
  const [saleActiveStates, setSaleActiveStates] = useState<{[id: string]: boolean}>({});

  const loadCoupons = async (storeId: string) => {
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/coupons/store/${storeId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setCoupons(data.coupons);
      }
    } catch (err) {
      console.error("Error loading coupons:", err);
    }
  };

  const loadProducts = async (storeId: string) => {
    try {
      const res = await fetch(`${API}/api/products/store/${storeId}`);
      const data = await res.json();
      if (data.success) {
        setProducts(data.products);
        // Initialize flash sale row inputs from existing database product configurations
        const prices: any = {};
        const expirations: any = {};
        const actives: any = {};
        data.products.forEach((p: any) => {
          if (p.flashSale) {
            prices[p._id] = p.flashSale.salePrice ? p.flashSale.salePrice.toString() : "";
            expirations[p._id] = p.flashSale.expiresAt ? p.flashSale.expiresAt.slice(0, 16) : "";
            actives[p._id] = p.flashSale.isActive || false;
          }
        });
        setSalePrices(prices);
        setSaleExpirations(expirations);
        setSaleActiveStates(actives);
      }
    } catch (err) {
      console.error("Error loading products:", err);
    }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem("bazaar_user");
    if (storedUser) {
      const user = JSON.parse(storedUser);
      
      if (user.role === "storeAdmin") {
        const allowed = user.permissions?.manageCoupons !== false;
        setHasPermission(allowed);
        if (!allowed) return;
      } else {
        setHasPermission(true);
      }

      const storeId = user.activeStoreId || user.storeId;
      if (storeId) {
        setActiveStoreId(storeId);
        loadCoupons(storeId);
        loadProducts(storeId);
      }
    }
  }, []);

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    if (!code || !discountValue || !expiresAt) {
      setError("Please fill out all required fields.");
      setLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/coupons`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          code: code.toUpperCase(),
          discountType,
          discountValue: parseFloat(discountValue),
          minSpend: minSpend ? parseFloat(minSpend) : 0,
          usageLimit: usageLimit ? parseInt(usageLimit) : null,
          expiresAt: new Date(expiresAt).toISOString()
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(`Coupon ${code.toUpperCase()} registered successfully!`);
        setCode("");
        setDiscountValue("");
        setMinSpend("");
        setUsageLimit("");
        setExpiresAt("");
        loadCoupons(activeStoreId);
      } else {
        setError(data.message || "Failed to create coupon");
      }
    } catch (err) {
      setError("Server connection failure. Coupon could not be created.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFlashSale = async (productId: string) => {
    setLoading(true);
    setError("");
    setSuccess("");

    const salePrice = salePrices[productId];
    const expiresAt = saleExpirations[productId];
    const isActive = saleActiveStates[productId] || false;

    if (isActive && (!salePrice || !expiresAt)) {
      setError("Active flash sales require a temporary sale price and expiration time.");
      setLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/products/${productId}/flash-sale`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          salePrice: salePrice ? parseFloat(salePrice) : null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          isActive
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Flash sale schedule updated successfully!");
        loadProducts(activeStoreId);
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.message || "Failed to update flash sale");
      }
    } catch (err) {
      setError("Failed to save flash sale schedule.");
    } finally {
      setLoading(false);
    }
  };

  if (hasPermission === false) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
        <Sidebar role="vendor" />
        <main style={{ flex: 1, padding: "2.5rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="glass-card animate-fade-up" style={{ padding: "3rem", textAlign: "center", maxWidth: 500 }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#ef4444", marginBottom: "1rem" }}>Access Denied</h2>
            <p style={{ color: "var(--text-secondary)" }}>You do not have permission to manage discounts, coupons, and flash sales. Please contact the store owner.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <Sidebar role="vendor" />
      <main style={{ flex: 1, padding: "2.5rem", overflow: "auto" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "0.3rem" }}>Discounts & Flash Sales</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Configure customer coupons and schedule flash sales with live expiration countdown clocks.
            </p>
          </div>
          <StoreSwitcher />
        </div>

        {/* Feedback Banners */}
        {success && (
          <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 10, padding: "0.85rem 1rem", marginBottom: "1.5rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
            <CheckCircle size={15} /> {success}
          </div>
        )}
        {error && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "0.85rem 1rem", marginBottom: "1.5rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {/* Tab Selection */}
        <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.5rem" }}>
          <button 
            onClick={() => setActiveTab("coupons")} 
            style={{ 
              background: "none", border: "none", color: activeTab === "coupons" ? "#a855f7" : "var(--text-muted)", 
              fontSize: "0.95rem", fontWeight: 800, padding: "0.5rem 1rem", cursor: "pointer", 
              borderBottom: activeTab === "coupons" ? "3px solid #a855f7" : "3px solid transparent",
              transition: "all 0.2s"
            }}
          >
            Coupon Factory Manager
          </button>
          <button 
            onClick={() => setActiveTab("flash-sales")} 
            style={{ 
              background: "none", border: "none", color: activeTab === "flash-sales" ? "#a855f7" : "var(--text-muted)", 
              fontSize: "0.95rem", fontWeight: 800, padding: "0.5rem 1rem", cursor: "pointer", 
              borderBottom: activeTab === "flash-sales" ? "3px solid #a855f7" : "3px solid transparent",
              transition: "all 0.2s"
            }}
          >
            Flash Sale Scheduler
          </button>
        </div>

        {/* TAB 1: COUPON FACTORY */}
        {activeTab === "coupons" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr", gap: "2rem", alignItems: "start" }}>
            {/* Creation Form */}
            <div className="glass-card" style={{ padding: "2rem" }}>
              <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", marginBottom: "1.5rem" }}>
                <Sparkles size={16} style={{ color: "#a855f7" }} />
                <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Generate Promo Code</h3>
              </div>

              <form onSubmit={handleCreateCoupon} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Coupon Code (e.g. EID500)</label>
                  <input className="input-field" type="text" placeholder="EID500" required value={code} onChange={e => setCode(e.target.value.toUpperCase())} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Deduction Type</label>
                    <select 
                      className="input-field" 
                      style={{ width: "100%", background: "#151521", border: "1px solid var(--border-subtle)", color: "#ffffff", padding: "0.5rem" }}
                      value={discountType} 
                      onChange={e => setDiscountType(e.target.value as any)}
                    >
                      <option value="fixed">Fixed PKR Amount</option>
                      <option value="percentage">Percentage (%)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Deduction Value</label>
                    <input className="input-field" type="number" min="1" placeholder="500" required value={discountValue} onChange={e => setDiscountValue(e.target.value)} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Min Spend (PKR)</label>
                    <input className="input-field" type="number" min="0" placeholder="1000" value={minSpend} onChange={e => setMinSpend(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Customer Usage Limit</label>
                    <input className="input-field" type="number" min="1" placeholder="Unlimited" value={usageLimit} onChange={e => setUsageLimit(e.target.value)} />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Expiration Date</label>
                  <input className="input-field" type="datetime-local" required value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
                </div>

                <button type="submit" disabled={loading} className="btn-primary" style={{ justifyContent: "center", marginTop: "0.5rem", padding: "0.75rem" }}>
                  {loading ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />} Create Coupon
                </button>
              </form>
            </div>

            {/* Coupons Table */}
            <div className="glass-card" style={{ padding: "1.5rem" }}>
              <div style={{ marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Active Store Coupons</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: "0.2rem" }}>Discounts dynamically verified on shopper checkouts.</p>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    {["Code", "Discount Type", "Deduction", "Min Spend", "Usage Count", "Expires"].map(h => (
                      <th key={h} style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coupons.map(c => {
                    const isExpired = new Date() > new Date(c.expiresAt);
                    return (
                      <tr key={c._id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "0.75rem 1rem", fontWeight: 800, color: "#a855f7" }}>{c.code}</td>
                        <td style={{ padding: "0.75rem 1rem", fontSize: "0.82rem", textTransform: "capitalize" }}>{c.discountType}</td>
                        <td style={{ padding: "0.75rem 1rem", fontSize: "0.82rem", fontWeight: 700 }}>
                          {c.discountType === "fixed" ? `Rs. ${c.discountValue}` : `${c.discountValue}%`}
                        </td>
                        <td style={{ padding: "0.75rem 1rem", fontSize: "0.82rem" }}>Rs. {c.minSpend}</td>
                        <td style={{ padding: "0.75rem 1rem", fontSize: "0.82rem" }}>
                          {c.usageCount} / {c.usageLimit || "∞"}
                        </td>
                        <td style={{ padding: "0.75rem 1rem", fontSize: "0.78rem" }}>
                          <span style={{ color: isExpired ? "#ef4444" : "var(--text-muted)", fontWeight: isExpired ? 700 : 500 }}>
                            {new Date(c.expiresAt).toLocaleDateString()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {coupons.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem" }}>No coupons created yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: FLASH SALE SCHEDULER */}
        {activeTab === "flash-sales" && (
          <div className="glass-card" style={{ padding: "1.5rem" }}>
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Flash Sale Scheduler</h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: "0.2rem" }}>Input promo prices and establish specific expiration dates to display countdown timers on the catalog.</p>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.01)" }}>
                  <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "80px" }}>Preview</th>
                  <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Product Title</th>
                  <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "120px" }}>Orig. Price</th>
                  <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "160px" }}>Promo Price (PKR)</th>
                  <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "220px" }}>Sale Expiration Clock</th>
                  <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "140px" }}>Status Toggle</th>
                  <th style={{ padding: "1rem 1.25rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", width: "150px" }}>Fulfillment Action</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const primaryImg = (p.images || []).find((img: any) => img.isPrimary) || (p.images || [])[0];
                  
                  return (
                    <tr key={p._id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      {/* Visual Preview */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: 8, overflow: "hidden",
                          background: "rgba(124,58,237,0.05)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          border: "1px solid var(--border-subtle)"
                        }}>
                          {primaryImg?.url
                            ? <img src={getImageUrl(primaryImg.url)} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <Package size={18} style={{ color: "#a855f7" }} />
                          }
                        </div>
                      </td>

                      {/* Title */}
                      <td style={{ padding: "0.75rem 1.25rem", fontWeight: 600, fontSize: "0.88rem" }}>{p.title}</td>

                      {/* Original Price */}
                      <td style={{ padding: "0.75rem 1.25rem", fontSize: "0.85rem", color: "var(--text-secondary)", fontWeight: 700 }}>Rs. {p.price}</td>

                      {/* Promo Sale Price */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <input 
                          className="input-field" 
                          type="number" 
                          min="0"
                          style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem" }}
                          placeholder="Sale Price"
                          value={salePrices[p._id] || ""}
                          onChange={e => setSalePrices({ ...salePrices, [p._id]: e.target.value })}
                        />
                      </td>

                      {/* Expiration Clock */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <input 
                          className="input-field" 
                          type="datetime-local" 
                          style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                          value={saleExpirations[p._id] || ""}
                          onChange={e => setSaleExpirations({ ...saleExpirations, [p._id]: e.target.value })}
                        />
                      </td>

                      {/* Status Toggle */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <button 
                          onClick={() => setSaleActiveStates({ ...saleActiveStates, [p._id]: !saleActiveStates[p._id] })}
                          style={{
                            background: saleActiveStates[p._id] ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.05)",
                            border: "none",
                            borderRadius: "6px",
                            padding: "0.35rem 0.75rem",
                            fontSize: "0.75rem",
                            color: saleActiveStates[p._id] ? "#10b981" : "var(--text-muted)",
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            transition: "all 0.15s"
                          }}
                        >
                          {saleActiveStates[p._id] ? <CheckCircle size={12} /> : <X size={12} />}
                          {saleActiveStates[p._id] ? "Active Alert" : "Inactive"}
                        </button>
                      </td>

                      {/* Schedule Button */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <button 
                          onClick={() => handleSaveFlashSale(p._id)}
                          className="btn-primary"
                          style={{
                            padding: "0.35rem 0.85rem",
                            fontSize: "0.75rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            fontWeight: 700
                          }}
                        >
                          <Clock size={12} /> Save Schedule
                        </button>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </main>
    </div>
  );
}

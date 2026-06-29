"use client";
import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import StoreSwitcher from "@/components/StoreSwitcher";
import { CheckCircle, AlertCircle, Loader, Palette, Settings, ShieldCheck, ShieldAlert, Eye, X, MapPin, Clock } from "lucide-react";
import { getImageUrl } from "@/utils/imageUrl";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

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

export default function VendorStorefrontPage() {
  const [form, setForm] = useState<any>({
    name: "",
    description: "",
    slug: "",
    primaryColor: "#3b82f6",
    backgroundColor: "#ffffff",
    textColor: "#1f2937",
    bankName: "",
    accountName: "",
    accountNumber: "",
    logo: "",
    banner: "",
    originCity: "Lahore",
    warehouseAddress: "",
    vacationMode: false,
    businessHours: {
      monday: { startTime: "09:00", endTime: "18:00" },
      tuesday: { startTime: "09:00", endTime: "18:00" },
      wednesday: { startTime: "09:00", endTime: "18:00" },
      thursday: { startTime: "09:00", endTime: "18:00" },
      friday: { startTime: "09:00", endTime: "18:00" },
      saturday: { startTime: "09:00", endTime: "18:00" },
      sunday: { startTime: "09:00", endTime: "18:00" }
    }
  });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [originalSlug, setOriginalSlug] = useState("");
  const [tamperAlert, setTamperAlert] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const slugInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("bazaar_user");
    const token = localStorage.getItem("bazaar_token");
    if (storedUser && token) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      setUserRole(parsedUser.role);

      const decoded = decodeJWT(token);
      const permissionsArray = decoded?.permissions || [];

      if (parsedUser.role === "storeAdmin") {
        const allowed = permissionsArray.includes("MANAGE_COUPONS");
        setHasPermission(allowed);
        if (!allowed) return;
      } else {
        setHasPermission(true);
      }

      // Load current store settings
      setLoading(true);
      fetch(`${API}/api/auth/stores`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.stores && data.stores.length > 0) {
            // Find active store profile matching token activeStoreId
            const activeId = decoded?.activeStoreId || parsedUser.activeStoreId || parsedUser.storeId;
            const currentStore = data.stores.find((s: any) => s._id === activeId) || data.stores[0];
            
            if (currentStore) {
              setForm({
                name: currentStore.name || "",
                description: currentStore.description || "",
                slug: currentStore.slug || "",
                primaryColor: currentStore.theme?.primaryColor || "#3b82f6",
                backgroundColor: currentStore.theme?.backgroundColor || "#ffffff",
                textColor: currentStore.theme?.textColor || "#1f2937",
                bankName: currentStore.bankDetails?.bankName || "",
                accountName: currentStore.bankDetails?.accountName || "",
                accountNumber: currentStore.bankDetails?.accountNumber || "",
                logo: currentStore.logo || "",
                banner: currentStore.banner || "",
                originCity: currentStore.originCity || "Lahore",
                warehouseAddress: currentStore.warehouseAddress || "",
                vacationMode: currentStore.vacationMode || false,
                businessHours: currentStore.businessHours || {
                  monday: { startTime: "09:00", endTime: "18:00" },
                  tuesday: { startTime: "09:00", endTime: "18:00" },
                  wednesday: { startTime: "09:00", endTime: "18:00" },
                  thursday: { startTime: "09:00", endTime: "18:00" },
                  friday: { startTime: "09:00", endTime: "18:00" },
                  saturday: { startTime: "09:00", endTime: "18:00" },
                  sunday: { startTime: "09:00", endTime: "18:00" }
                }
              });
              setOriginalSlug(currentStore.slug || "");
            }
          }
        })
        .catch(err => console.error("Error loading store details:", err))
        .finally(() => setLoading(false));
    }
  }, []);

  // Anti-tampering MutationObserver for Store URL Slug input
  useEffect(() => {
    if (userRole === "storeAdmin" && slugInputRef.current) {
      const targetNode = slugInputRef.current;
      const observerOptions = {
        attributes: true,
        attributeFilter: ["disabled", "readonly"]
      };

      const callback = (mutationsList: MutationRecord[]) => {
        for (const mutation of mutationsList) {
          if (mutation.type === "attributes") {
            if (!targetNode.hasAttribute("disabled")) {
              // Re-enforce instantly
              targetNode.setAttribute("disabled", "true");
              setTamperAlert(true);
              // Revert field to original slug
               setForm((prev: any) => ({ ...prev, slug: originalSlug }));
            }
          }
        }
      };

      const observer = new MutationObserver(callback);
      observer.observe(targetNode, observerOptions);

      return () => {
        observer.disconnect();
      };
    }
  }, [userRole, originalSlug]);

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (userRole === "storeAdmin") {
      setTamperAlert(true);
      setForm({ ...form, slug: originalSlug }); // Revert
      return;
    }
    setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess("");
    setError("");

    try {
      const token = localStorage.getItem("bazaar_token");
      if (!token) throw new Error("No session token found");

      // Verify again before sending to avoid sending modified slug from storeAdmin
      const finalForm = { ...form };
      if (userRole === "storeAdmin") {
        finalForm.slug = originalSlug; // Force original slug
      }

      const res = await fetch(`${API}/api/auth/store/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(finalForm)
      });

      const data = await res.json();
      if (data.success) {
        setSuccess("Store settings and URL slug updated successfully!");
        setOriginalSlug(finalForm.slug);
        
        // Update stored user active store details if necessary
        const storedUser = localStorage.getItem("bazaar_user");
        if (storedUser) {
          const parsed = JSON.parse(storedUser);
          parsed.storeName = finalForm.name;
          localStorage.setItem("bazaar_user", JSON.stringify(parsed));
        }
      } else {
        throw new Error(data.message || "Failed to save settings");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadAsset = async (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'banner') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    const formData = new FormData();
    formData.append(type, file);

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`${API}/api/auth/store/upload-assets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });
      const data = await res.json();
      if (data.success && data.store) {
        setForm((prev: any) => ({
          ...prev,
          logo: data.store.logo || "",
          banner: data.store.banner || ""
        }));
        setSuccess(`Store ${type} uploaded successfully!`);
      } else {
        throw new Error(data.message || `Failed to upload ${type}`);
      }
    } catch (err: any) {
      setError(err.message || `Failed to upload ${type}`);
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
            <p style={{ color: "var(--text-secondary)" }}>You do not have permission to modify storefront settings. Please contact the store owner.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <Sidebar role="vendor" />
      <main style={{ flex: 1, padding: "2.5rem", overflow: "auto" }}>
        
        {/* Floating restriction banner for slug tampering */}
        {tamperAlert && (
          <div style={{
            position: "fixed", top: "1.5rem", left: "50%", transform: "translateX(-50%)",
            background: "rgba(239, 68, 68, 0.95)", backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.15)", borderRadius: "12px",
            padding: "1rem 1.5rem", color: "white", display: "flex", alignItems: "center",
            gap: "0.75rem", boxShadow: "0 10px 25px -5px rgba(239, 68, 68, 0.5)",
            zIndex: 9999, width: "90%", maxWidth: "500px"
          }}>
            <ShieldAlert size={20} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <strong style={{ display: "block", fontSize: "0.85rem", fontWeight: 800 }}>Security Violation Alert</strong>
              <span style={{ fontSize: "0.75rem", opacity: 0.9 }}>
                Storefront URL Slug modification is locked for staff accounts. Attempt logged.
              </span>
            </div>
            <button onClick={() => setTamperAlert(false)} style={{
              background: "none", border: "none", color: "white", cursor: "pointer",
              opacity: 0.8, display: "flex", alignItems: "center", padding: "0.2rem"
            }}>
              <X size={16} />
            </button>
          </div>
        )}

        {/* Header section */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "0.3rem" }}>Storefront Settings</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Customize your storefront brand, design themes, and billing payout methods.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <StoreSwitcher />
          </div>
        </div>

        {/* Content Layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "2rem", alignItems: "start" }}>
          
          {/* Settings form card */}
          <div className="glass-card" style={{ padding: "2rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.5rem" }}>
              <Settings size={18} style={{ color: "#a855f7" }} />
              <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>Customization Control Workspace</h2>
            </div>

            {success && (
              <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                <CheckCircle size={15} /> {success}
              </div>
            )}
            {error && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                <AlertCircle size={15} /> {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              
              {/* General Store Details */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.4rem" }}>General Settings</h3>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Store Front Public Name</label>
                  <input className="input-field" type="text" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Zayan Apparel Store" />
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Store URL Slug</label>
                  <input 
                    ref={slugInputRef}
                    id="slug-input-field"
                    className="input-field" 
                    type="text" 
                    required 
                    disabled={userRole === "storeAdmin"}
                    value={form.slug} 
                    onChange={handleSlugChange} 
                    placeholder="e.g. zayan-apparel-store" 
                  />
                  {userRole === "storeAdmin" && (
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
                      🔒 Slug edit restricted for staff accounts.
                    </span>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Brand Description</label>
                  <textarea className="input-field" style={{ minHeight: "80px", resize: "vertical" }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Write a brief tagline or intro for your public storefront..." />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Store Brand Logo</label>
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={e => handleUploadAsset(e, 'logo')} 
                      style={{ display: "none" }} 
                      id="upload-logo-file"
                    />
                    <label 
                      htmlFor="upload-logo-file" 
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                        padding: "0.6rem", background: "rgba(255,255,255,0.05)", border: "1px dashed var(--border-subtle)",
                        borderRadius: "8px", cursor: "pointer", fontSize: "0.8rem", color: "var(--text-secondary)",
                        fontWeight: 600, transition: "background 0.2s"
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                      onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                    >
                      Change Brand Logo
                    </label>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Cover Banner Graphic</label>
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={e => handleUploadAsset(e, 'banner')} 
                      style={{ display: "none" }} 
                      id="upload-banner-file"
                    />
                    <label 
                      htmlFor="upload-banner-file" 
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                        padding: "0.6rem", background: "rgba(255,255,255,0.05)", border: "1px dashed var(--border-subtle)",
                        borderRadius: "8px", cursor: "pointer", fontSize: "0.8rem", color: "var(--text-secondary)",
                        fontWeight: 600, transition: "background 0.2s"
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                      onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                    >
                      Change Cover Banner
                    </label>
                  </div>
                </div>
              </div>

              {/* Theme Customizer */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <Palette size={14} style={{ color: "#a855f7" }} /> Theme Color Palettes
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Primary Color</label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input type="color" value={form.primaryColor} onChange={e => setForm({ ...form, primaryColor: e.target.value })} style={{ width: "34px", height: "34px", border: "none", borderRadius: "8px", background: "none", cursor: "pointer" }} />
                      <input className="input-field" type="text" style={{ padding: "0.25rem", textAlign: "center", fontSize: "0.8rem" }} value={form.primaryColor} onChange={e => setForm({ ...form, primaryColor: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Background</label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input type="color" value={form.backgroundColor} onChange={e => setForm({ ...form, backgroundColor: e.target.value })} style={{ width: "34px", height: "34px", border: "none", borderRadius: "8px", background: "none", cursor: "pointer" }} />
                      <input className="input-field" type="text" style={{ padding: "0.25rem", textAlign: "center", fontSize: "0.8rem" }} value={form.backgroundColor} onChange={e => setForm({ ...form, backgroundColor: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Text Color</label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input type="color" value={form.textColor} onChange={e => setForm({ ...form, textColor: e.target.value })} style={{ width: "34px", height: "34px", border: "none", borderRadius: "8px", background: "none", cursor: "pointer" }} />
                      <input className="input-field" type="text" style={{ padding: "0.25rem", textAlign: "center", fontSize: "0.8rem" }} value={form.textColor} onChange={e => setForm({ ...form, textColor: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Logistics Origin Location */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <MapPin size={14} style={{ color: "#a855f7" }} /> Logistics Origin Location
                </h3>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Origin City</label>
                  <select 
                    className="input-field" 
                    value={form.originCity} 
                    onChange={e => setForm({ ...form, originCity: e.target.value })}
                    style={{ height: "38px", fontSize: "0.85rem", padding: "0 0.5rem", width: "100%", background: "#111119/90", border: "1px solid rgba(255,255,255,0.08)", color: "#e2e8f0" }}
                  >
                    <option value="Karachi">Karachi</option>
                    <option value="Lahore">Lahore</option>
                    <option value="Islamabad">Islamabad</option>
                    <option value="Faisalabad">Faisalabad</option>
                    <option value="Rawalpindi">Rawalpindi</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Warehouse Physical Address</label>
                  <textarea 
                    className="input-field" 
                    rows={2} 
                    value={form.warehouseAddress} 
                    onChange={e => setForm({ ...form, warehouseAddress: e.target.value })} 
                    placeholder="Enter full physical dispatch warehouse pickup address..." 
                  />
                </div>
              </div>

              {/* Operational Hours Matrix */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.3rem", justifyContent: "space-between" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <Clock size={14} style={{ color: "#a855f7" }} /> Operational Hours Matrix
                  </span>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", cursor: "pointer", fontWeight: 600 }}>
                    <input 
                      type="checkbox" 
                      checked={form.vacationMode} 
                      onChange={e => setForm({ ...form, vacationMode: e.target.checked })} 
                      style={{ accentColor: "#a855f7", width: "14px", height: "14px" }}
                    />
                    🏝️ Vacation Mode Active
                  </label>
                </h3>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "150px", overflowY: "auto", paddingRight: "0.5rem", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px", padding: "0.5rem" }}>
                  {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => (
                    <div key={day} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1.2fr", gap: "0.5rem", alignItems: "center" }}>
                      <span style={{ fontSize: "0.75rem", textTransform: "capitalize", fontWeight: 700, color: "var(--text-secondary)" }}>{day}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Start:</span>
                        <input 
                          type="time" 
                          className="input-field" 
                          style={{ padding: "0.15rem 0.3rem", fontSize: "0.7rem", height: "26px", color: "#fff" }}
                          value={form.businessHours?.[day]?.startTime || "09:00"} 
                          onChange={e => setForm({
                            ...form,
                            businessHours: {
                              ...form.businessHours,
                              [day]: { ...form.businessHours?.[day], startTime: e.target.value }
                            }
                          })} 
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>End:</span>
                        <input 
                          type="time" 
                          className="input-field" 
                          style={{ padding: "0.15rem 0.3rem", fontSize: "0.7rem", height: "26px", color: "#fff" }}
                          value={form.businessHours?.[day]?.endTime || "18:00"} 
                          onChange={e => setForm({
                            ...form,
                            businessHours: {
                              ...form.businessHours,
                              [day]: { ...form.businessHours?.[day], endTime: e.target.value }
                            }
                          })} 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bank Transfer Details */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <ShieldCheck size={14} style={{ color: "#a855f7" }} /> Bank Transfer Billing Config
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Bank Name</label>
                    <input className="input-field" type="text" value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} placeholder="e.g. Bank of Commerce" />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Account Name</label>
                    <input className="input-field" type="text" value={form.accountName} onChange={e => setForm({ ...form, accountName: e.target.value })} placeholder="e.g. Zayan Store Fleet" />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Account Number / IBAN</label>
                  <input className="input-field" type="text" value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} placeholder="e.g. PK82BOCO99827182901A" />
                </div>
              </div>

              <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: "1rem", justifyContent: "center" }}>
                {loading ? <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> Saving Settings...</> : "Save Layout Settings"}
              </button>
            </form>
          </div>

          {/* Right Column: Live Storefront Card Preview */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", position: "sticky", top: "2.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase" }}>
              <Eye size={13} /> Live Storefront Design Preview
            </div>

            {/* Simulated Storefront Shop */}
            {(() => {
              const isDarkColor = (hex?: string) => {
                if (!hex) return false;
                const c = hex.replace("#", "");
                if (c.length !== 6) return false;
                const rgb = parseInt(c, 16);
                const r = (rgb >> 16) & 0xff;
                const g = (rgb >> 8) & 0xff;
                const b = (rgb >> 0) & 0xff;
                const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                return luma < 128;
              };

              const isBgDark = isDarkColor(form.backgroundColor);
              const previewBannerOverlay = isBgDark 
                ? "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(18,18,26,0.9) 100%)" 
                : "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.7) 100%)";
              const previewCardBg = isBgDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.02)";
              const previewCardBorder = isBgDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
              const previewTextMuted = isBgDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.5)";

              return (
                <div style={{ 
                  background: form.backgroundColor, 
                  color: form.textColor, 
                  border: `1px solid ${previewCardBorder}`, 
                  borderRadius: "16px", 
                  overflow: "hidden",
                  transition: "all 0.3s"
                }}>
                  {/* Cover Banner */}
                  <div style={{ 
                    height: "100px", 
                    backgroundImage: form.banner 
                      ? `${previewBannerOverlay}, url(${getImageUrl(form.banner)})` 
                      : `linear-gradient(135deg, ${form.primaryColor}, rgba(0,0,0,0.6))`,
                    backgroundSize: "cover",
                    backgroundPosition: "center"
                  }} />
                  
                  <div style={{ padding: "1.5rem" }}>
                    {/* Store logo placeholder circle */}
                    <div style={{ 
                      width: "55px", 
                      height: "55px", 
                      borderRadius: "50%", 
                      background: form.primaryColor, 
                      border: `4px solid ${form.backgroundColor}`,
                      marginTop: "-40px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.2rem",
                      fontWeight: 800,
                      color: isDarkColor(form.primaryColor) ? "#ffffff" : "#000000",
                      overflow: "hidden",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.1)"
                    }}>
                      {form.logo ? (
                        <img 
                          src={getImageUrl(form.logo)} 
                          alt="Store Logo" 
                          style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                        />
                      ) : (
                        form.name.charAt(0) || "S"
                      )}
                    </div>

                    <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginTop: "0.5rem" }}>{form.name || "My Retail Shopfront"}</h3>
                    <p style={{ fontSize: "0.78rem", color: previewTextMuted, marginTop: "0.3rem", lineHeight: 1.4 }}>
                      {form.description || "Customize description inside control panel to update tagline content."}
                    </p>

                    {/* Operating hours & location badges preview */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
                      <span style={{ fontSize: "0.68rem", background: form.vacationMode ? "rgba(239, 68, 68, 0.15)" : `${form.primaryColor}15`, color: form.vacationMode ? "#ef4444" : form.primaryColor, padding: "0.2rem 0.5rem", borderRadius: "6px", fontWeight: 700 }}>
                        {form.vacationMode ? "🏝️ Closed (Vacation)" : "● Open Now"}
                      </span>
                      <span style={{ fontSize: "0.68rem", background: previewCardBg, border: `1px solid ${previewCardBorder}`, padding: "0.2rem 0.5rem", borderRadius: "6px", fontWeight: 600 }}>
                        📍 {form.originCity || "Lahore"}
                      </span>
                      <span style={{ fontSize: "0.68rem", background: previewCardBg, border: `1px solid ${previewCardBorder}`, padding: "0.2rem 0.5rem", borderRadius: "6px", fontWeight: 600 }}>
                        {form.slug ? `/${form.slug}` : "/store-slug"}
                      </span>
                    </div>

                    {/* Live business hours & physical address details */}
                    <div style={{ marginTop: "1rem", fontSize: "0.72rem", color: previewTextMuted, display: "flex", flexDirection: "column", gap: "0.25rem", borderTop: `1px dashed ${previewCardBorder}`, paddingTop: "0.75rem" }}>
                      {form.warehouseAddress && (
                        <span><strong>Warehouse:</strong> {form.warehouseAddress}</span>
                      )}
                      <span>
                        <strong>Hours Today:</strong> {(() => {
                          const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                          const hrs = form.businessHours?.[today] || { startTime: "09:00", endTime: "18:00" };
                          return `${hrs.startTime} - ${hrs.endTime}`;
                        })()}
                      </span>
                    </div>

                    {/* Mock product display cards preview */}
                    <div style={{ marginTop: "1.2rem", borderTop: `1px solid ${previewCardBorder}`, paddingTop: "1rem" }}>
                      <p style={{ fontSize: "0.75rem", fontWeight: 700, color: form.textColor, opacity: 0.8, marginBottom: "0.6rem" }}>Sample Product Grid</p>
                      
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                        <div style={{ background: previewCardBg, border: `1px solid ${previewCardBorder}`, borderRadius: "10px", padding: "0.5rem" }}>
                          <div style={{ height: "60px", background: isBgDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", borderRadius: "6px" }} />
                          <p style={{ fontSize: "0.7rem", fontWeight: 700, marginTop: "0.4rem" }}>Summer Lawn Suit</p>
                          <p style={{ fontSize: "0.68rem", color: form.primaryColor, fontWeight: 800, marginTop: "0.1rem" }}>Rs. 4,500</p>
                        </div>
                        <div style={{ background: previewCardBg, border: `1px solid ${previewCardBorder}`, borderRadius: "10px", padding: "0.5rem" }}>
                          <div style={{ height: "60px", background: isBgDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", borderRadius: "6px" }} />
                          <p style={{ fontSize: "0.7rem", fontWeight: 700, marginTop: "0.4rem" }}>Leather Wallet</p>
                          <p style={{ fontSize: "0.68rem", color: form.primaryColor, fontWeight: 800, marginTop: "0.1rem" }}>Rs. 1,200</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

        </div>

      </main>
    </div>
  );
}

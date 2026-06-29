"use client";
import { useState, useEffect } from "react";
import { Zap, User, Mail, Lock, Store, Globe, ArrowRight, ArrowLeft, Check, Loader, Palette } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface Props {
  onSuccess: (data: any) => void;
  onCancel: () => void;
}

export default function OnboardingWizard({ onSuccess, onCancel }: Props) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [slugLoading, setSlugLoading] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    storeName: "",
    storeSlug: "",
    description: "",
    primaryColor: "#7c3aed",
    backgroundColor: "#13131a",
    textColor: "#f8f8ff"
  });

  // Auto-generate and validate slug when storeName changes
  useEffect(() => {
    if (step !== 2 || !form.storeName) return;

    const generated = form.storeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

    setForm(prev => ({ ...prev, storeSlug: generated }));
  }, [form.storeName, step]);

  // Check slug availability
  useEffect(() => {
    if (!form.storeSlug) {
      setSlugAvailable(null);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setSlugLoading(true);
      try {
        const res = await fetch(`${API}/api/auth/store/slug/${form.storeSlug}`);
        const data = await res.json();
        // If it returns 404, it means store is NOT found, which means the slug IS available!
        if (res.status === 404) {
          setSlugAvailable(true);
        } else {
          setSlugAvailable(false);
        }
      } catch {
        setSlugAvailable(true);
      } finally {
        setSlugLoading(false);
      }
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [form.storeSlug]);

  const nextStep = () => {
    setError("");
    if (step === 1) {
      if (!form.name || !form.email || !form.password) {
        setError("Please fill in all account details");
        return;
      }
      if (form.password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!form.storeName || !form.storeSlug) {
        setError("Store Name and URL Slug are required");
        return;
      }
      if (slugAvailable === false) {
        setError("This store URL slug is already taken");
        return;
      }
      setStep(3);
    }
  };

  const prevStep = () => {
    setError("");
    setStep(prev => prev - 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step !== 3) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          role: "vendor",
          storeName: form.storeName,
          storeSlug: form.storeSlug,
          description: form.description,
          theme: {
            primaryColor: form.primaryColor,
            backgroundColor: form.backgroundColor,
            textColor: form.textColor
          }
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Registration failed");

      onSuccess(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ width: "100%", color: "var(--text-primary)" }}>
      {/* Wizard Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        {[1, 2, 3].map((s) => (
          <div key={s} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: step >= s ? "linear-gradient(135deg, #7c3aed, #a855f7)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${step >= s ? "#a855f7" : "var(--border-subtle)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.8rem", fontWeight: 700, color: step >= s ? "white" : "var(--text-muted)",
              boxShadow: step >= s ? "0 0 15px rgba(124,58,237,0.3)" : "none",
              transition: "all 0.3s"
            }}>
              {step > s ? <Check size={14} /> : s}
            </div>
            {s < 3 && (
              <div style={{
                flex: 1, height: "2px",
                background: step > s ? "linear-gradient(90deg, #7c3aed, #a855f7)" : "rgba(255,255,255,0.06)",
                margin: "0 0.5rem", transition: "background 0.3s"
              }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 800, marginBottom: "0.3rem" }}>
          {step === 1 && "Create Vendor Account"}
          {step === 2 && "Setup Your Digital Store"}
          {step === 3 && "Customize Shop Theme"}
        </h2>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          {step === 1 && "Start by provisioning your main administrative vendor credentials."}
          {step === 2 && "Define your store details and choose a unique storefront web routing slug."}
          {step === 3 && "Choose brand identity colors for your tenant storefront."}
        </p>
      </div>

      {error && (
        <div style={{
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.25rem",
          color: "#ef4444", fontSize: "0.8rem"
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
        {/* STEP 1: Account Credentials */}
        {step === 1 && (
          <>
            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Full Name</label>
              <div style={{ position: "relative" }}>
                <User size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input-field" style={{ paddingLeft: "2.2rem" }} type="text" placeholder="John Doe" required
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Email Address</label>
              <div style={{ position: "relative" }}>
                <Mail size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input-field" style={{ paddingLeft: "2.2rem" }} type="email" placeholder="you@example.com" required
                  value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Password</label>
              <div style={{ position: "relative" }}>
                <Lock size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input-field" style={{ paddingLeft: "2.2rem" }} type="password" placeholder="Min. 8 characters" required minLength={8}
                  value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
          </>
        )}

        {/* STEP 2: Store Details */}
        {step === 2 && (
          <>
            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Store Name</label>
              <div style={{ position: "relative" }}>
                <Store size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input-field" style={{ paddingLeft: "2.2rem" }} type="text" placeholder="e.g. Tech Haven" required
                  value={form.storeName} onChange={e => setForm({ ...form, storeName: e.target.value })} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>URL Slug Context</label>
              <div style={{ position: "relative" }}>
                <Globe size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input
                  className="input-field"
                  style={{ paddingLeft: "2.2rem", paddingRight: "3rem" }}
                  type="text"
                  placeholder="e.g. tech-haven"
                  required
                  value={form.storeSlug}
                  onChange={e => setForm({ ...form, storeSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                />
                <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center" }}>
                  {slugLoading && <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />}
                  {!slugLoading && slugAvailable === true && <span style={{ color: "#10b981", fontSize: "0.75rem", fontWeight: 700 }}>Available</span>}
                  {!slugLoading && slugAvailable === false && <span style={{ color: "#ef4444", fontSize: "0.75rem", fontWeight: 700 }}>Taken</span>}
                </div>
              </div>
              <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                This is your public web slug: <strong>bazaarboost.com/store/{form.storeSlug || "your-slug"}</strong>
              </p>
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Description</label>
              <textarea className="input-field" placeholder="Briefly describe what your store sells..." rows={3} style={{ resize: "none" }}
                value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
          </>
        )}

        {/* STEP 3: Theme Customization */}
        {step === 3 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Primary Accent</label>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input type="color" style={{ width: "40px", height: "36px", border: "none", background: "none", cursor: "pointer" }}
                    value={form.primaryColor} onChange={e => setForm({ ...form, primaryColor: e.target.value })} />
                  <input className="input-field" style={{ textTransform: "uppercase" }} value={form.primaryColor}
                    onChange={e => setForm({ ...form, primaryColor: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Background</label>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input type="color" style={{ width: "40px", height: "36px", border: "none", background: "none", cursor: "pointer" }}
                    value={form.backgroundColor} onChange={e => setForm({ ...form, backgroundColor: e.target.value })} />
                  <input className="input-field" style={{ textTransform: "uppercase" }} value={form.backgroundColor}
                    onChange={e => setForm({ ...form, backgroundColor: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Theme Visual Preview Card */}
            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Storefront Visual Preview</label>
              <div style={{
                background: form.backgroundColor,
                border: "1px solid var(--border-subtle)",
                borderRadius: "12px",
                padding: "1.25rem",
                color: form.textColor,
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                transition: "all 0.3s"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid rgba(255,255,255,0.07)`, paddingBottom: "0.5rem" }}>
                  <span style={{ fontWeight: 800, fontSize: "0.9rem" }}>🏪 {form.storeName || "My Store"}</span>
                  <span style={{ fontSize: "0.65rem", padding: "0.15rem 0.4rem", borderRadius: "10px", background: `${form.primaryColor}22`, color: form.primaryColor, fontWeight: 700 }}>
                    ONLINE
                  </span>
                </div>
                <p style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.6)", margin: 0 }}>
                  {form.description || "Describe your catalog..."}
                </p>
                <button type="button" style={{
                  background: form.primaryColor,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  padding: "0.4rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.3rem"
                }}>
                  <Palette size={12} /> View Catalog
                </button>
              </div>
            </div>
          </>
        )}

        {/* Navigation Actions */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginTop: "1rem" }}>
          {step > 1 ? (
            <button type="button" onClick={prevStep} className="btn-secondary" style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1.2rem" }} disabled={loading}>
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <button type="button" onClick={onCancel} className="btn-secondary" style={{ padding: "0.6rem 1.2rem" }} disabled={loading}>
              Cancel
            </button>
          )}

          {step < 3 ? (
            <button type="button" onClick={nextStep} className="btn-primary" style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1.2rem", marginLeft: "auto" }}>
              Continue <ArrowRight size={14} />
            </button>
          ) : (
            <button type="submit" className="btn-primary" style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1.2rem", marginLeft: "auto" }} disabled={loading}>
              {loading ? <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> Registering…</> : <><Check size={14} /> Complete Setup</>}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

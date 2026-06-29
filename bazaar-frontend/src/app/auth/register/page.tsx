"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, User, Mail, Lock, Store } from "lucide-react";
import PlatformLogo from "@/components/PlatformLogo";

import OnboardingWizard from "@/components/OnboardingWizard";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "shopper", storeName: "" });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      localStorage.setItem("bazaar_token", data.token);
      localStorage.setItem("bazaar_user", JSON.stringify(data.user));

      if (data.user.role === "vendor") router.push("/vendor/dashboard");
      else if (data.user.role === "admin") router.push("/admin/approvals");
      else router.push("/");
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "var(--gradient-hero)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem"
    }}>
      {/* Background blobs */}
      <div style={{ position: "fixed", top: "10%", left: "20%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,0.12), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: "10%", right: "10%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.08), transparent 70%)", pointerEvents: "none" }} />

      <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 460, padding: "2.5rem" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <PlatformLogo variant="icon-only" size={52} style={{ margin: "0 auto 1rem" }} />
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, marginBottom: "0.3rem" }}>
            Create Account
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Join the intelligent local marketplace
          </p>
        </div>

        {form.role === "vendor" ? (
          <OnboardingWizard
            onSuccess={(data) => {
              localStorage.setItem("bazaar_token", data.token);
              localStorage.setItem("bazaar_user", JSON.stringify(data.user));
              router.push("/vendor/dashboard");
            }}
            onCancel={() => setForm({ ...form, role: "shopper" })}
          />
        ) : (
          <>
            {error && (
              <div style={{
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.25rem",
                color: "#ef4444", fontSize: "0.875rem"
              }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Name */}
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Full Name</label>
                <div style={{ position: "relative" }}>
                  <User size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                  <input id="register-name" className="input-field" style={{ paddingLeft: "2.2rem" }} type="text" placeholder="John Doe" required
                    value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
              </div>

              {/* Email */}
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Email Address</label>
                <div style={{ position: "relative" }}>
                  <Mail size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                  <input id="register-email" className="input-field" style={{ paddingLeft: "2.2rem" }} type="email" placeholder="you@example.com" required
                    value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>

              {/* Password */}
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Password</label>
                <div style={{ position: "relative" }}>
                  <Lock size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                  <input id="register-password" className="input-field" style={{ paddingLeft: "2.2rem", paddingRight: "2.5rem" }}
                    type={showPass ? "text" : "password"} placeholder="Min. 8 characters" required minLength={8}
                    value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
                  <button type="button" onClick={() => setShowPass(!showPass)} style={{
                    position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)"
                  }}>
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Role */}
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Account Type</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  {["shopper", "vendor"].map(role => (
                    <button type="button" key={role} id={`role-${role}`}
                      onClick={() => setForm({ ...form, role })}
                      style={{
                        padding: "0.65rem", borderRadius: 10, cursor: "pointer",
                        border: `1px solid ${form.role === role ? "rgba(124,58,237,0.6)" : "var(--border-subtle)"}`,
                        background: form.role === role ? "rgba(124,58,237,0.12)" : "var(--bg-secondary)",
                        color: form.role === role ? "#a855f7" : "var(--text-secondary)",
                        fontWeight: 600, fontSize: "0.85rem", textTransform: "capitalize",
                        transition: "all 0.2s"
                      }}>
                      {role === "shopper" ? "🛍️" : "🏪"} {role}
                    </button>
                  ))}
                </div>
              </div>

              <button id="register-submit" type="submit" className="btn-primary" disabled={loading}
                style={{ marginTop: "0.5rem", justifyContent: "center", opacity: loading ? 0.7 : 1 }}>
                {loading ? "Creating Account..." : "Create Account"}
              </button>
            </form>
          </>
        )}

        <p style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          Already have an account?{" "}
          <Link href="/auth/login" style={{ color: "#a855f7", fontWeight: 600, textDecoration: "none" }}>Sign In</Link>
        </p>
      </div>
    </div>
  );
}

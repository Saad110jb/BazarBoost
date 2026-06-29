"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import PlatformLogo from "@/components/PlatformLogo";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      localStorage.setItem("bazaar_token", data.token);
      localStorage.setItem("bazaar_user", JSON.stringify(data.user));

      if (data.user.isTempPassword) {
        router.push("/auth/setup-password");
      } else if (data.user.role === "vendor" || data.user.role === "storeAdmin") {
        router.push("/vendor/dashboard");
      } else if (data.user.role === "admin") {
        router.push("/admin/approvals");
      } else {
        router.push("/");
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // Demo login helper
  const demoLogin = (role: string) => {
    const demos: Record<string, any> = {
      vendor:  { id: "demo-vendor-1",  name: "Demo Vendor",  email: "vendor@demo.com",  role: "vendor",  storeId: "demo-store-1" },
      shopper: { id: "demo-shopper-1", name: "Demo Shopper", email: "shopper@demo.com", role: "shopper", storeId: null },
      admin:   { id: "demo-admin-1",   name: "Platform Admin", email: "admin@demo.com", role: "admin",   storeId: null },
    };
    localStorage.setItem("bazaar_token", `demo-token-${role}`);
    localStorage.setItem("bazaar_user", JSON.stringify(demos[role]));
    if (role === "vendor") router.push("/vendor/dashboard");
    else if (role === "admin") router.push("/admin/approvals");
    else router.push("/");
  };

  return (
    <div style={{
      minHeight: "100vh", background: "var(--gradient-hero)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem"
    }}>
      <div style={{ position: "fixed", top: "15%", right: "25%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,0.1), transparent 70%)", pointerEvents: "none" }} />

      <div className="glass-card animate-fade-up" style={{ width: "100%", maxWidth: 440, padding: "2.5rem" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <PlatformLogo variant="icon-only" size={52} style={{ margin: "0 auto 1rem" }} />
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, marginBottom: "0.3rem" }}>Welcome Back</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Sign into your BazaarBoost account
          </p>
        </div>

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
          <div>
            <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Email Address</label>
            <div style={{ position: "relative" }}>
              <Mail size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input id="login-email" className="input-field" style={{ paddingLeft: "2.2rem" }}
                type="email" placeholder="you@example.com" required
                value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Password</label>
            <div style={{ position: "relative" }}>
              <Lock size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input id="login-password" className="input-field" style={{ paddingLeft: "2.2rem", paddingRight: "2.5rem" }}
                type={showPass ? "text" : "password"} placeholder="Your password" required
                value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              <button type="button" onClick={() => setShowPass(!showPass)} style={{
                position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)"
              }}>
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <button id="login-submit" type="submit" className="btn-primary" disabled={loading}
            style={{ marginTop: "0.5rem", justifyContent: "center", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Signing In..." : "Sign In"}
          </button>
        </form>

        {/* Demo access */}
        <div style={{ marginTop: "1.5rem" }}>
          <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            — Quick Demo Access —
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
            {[["Shopper", "shopper"], ["Vendor", "vendor"], ["Admin", "admin"]].map(([label, role]) => (
              <button key={role} id={`demo-${role}`}
                onClick={() => demoLogin(role)}
                style={{
                  padding: "0.5rem", borderRadius: 8, cursor: "pointer", fontSize: "0.75rem",
                  fontWeight: 600, border: "1px solid var(--border-subtle)",
                  background: "var(--bg-secondary)", color: "var(--text-secondary)",
                  transition: "all 0.2s"
                }}
                onMouseEnter={e => { (e.target as HTMLButtonElement).style.color = "#a855f7"; }}
                onMouseLeave={e => { (e.target as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
              >
                {label === "Shopper" ? "🛍️" : label === "Vendor" ? "🏪" : "🛡️"} {label}
              </button>
            ))}
          </div>
        </div>

        <p style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          New to BazaarBoost?{" "}
          <Link href="/auth/register" style={{ color: "#a855f7", fontWeight: 600, textDecoration: "none" }}>Create Account</Link>
        </p>
      </div>
    </div>
  );
}

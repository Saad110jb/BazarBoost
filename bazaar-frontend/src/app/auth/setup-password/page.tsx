"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, CheckCircle, AlertCircle, Loader } from "lucide-react";
import PlatformLogo from "@/components/PlatformLogo";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function SetupPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem("bazaar_token");
    const userStr = localStorage.getItem("bazaar_user");
    if (!token || !userStr) {
      router.push("/auth/login");
      return;
    }
    const user = JSON.parse(userStr);
    if (!user.isTempPassword) {
      router.push("/vendor/dashboard");
    }
  }, [router]);

  if (!mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/auth/profile/setup-password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword: password }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to update password");

      localStorage.setItem("bazaar_token", data.token);
      localStorage.setItem("bazaar_user", JSON.stringify(data.user));

      setSuccess("Permanent password established! Access granted.");
      setTimeout(() => {
        router.push("/vendor/dashboard");
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Error updating password");
    } finally {
      setLoading(false);
    }
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
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, marginBottom: "0.3rem" }}>Security Activation</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Set a new permanent password to access your dashboard
          </p>
        </div>

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.25rem",
            color: "#ef4444", fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "0.5rem"
          }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {success && (
          <div style={{
            background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
            borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.25rem",
            color: "#10b981", fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "0.5rem"
          }}>
            <CheckCircle size={16} /> {success}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>New Permanent Password</label>
            <div style={{ position: "relative" }}>
              <Lock size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input id="new-password" className="input-field" style={{ paddingLeft: "2.2rem", paddingRight: "2.5rem" }}
                type={showPass ? "text" : "password"} placeholder="Minimum 6 characters" required
                value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPass(!showPass)} style={{
                position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)"
              }}>
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>Confirm Password</label>
            <div style={{ position: "relative" }}>
              <Lock size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input id="confirm-password" className="input-field" style={{ paddingLeft: "2.2rem" }}
                type={showPass ? "text" : "password"} placeholder="Confirm your password" required
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            </div>
          </div>

          <button id="setup-submit" type="submit" className="btn-primary" disabled={loading}
            style={{ marginTop: "0.5rem", justifyContent: "center", opacity: loading ? 0.7 : 1 }}>
            {loading ? <><Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> Activating...</> : "Activate Account"}
          </button>
        </form>
      </div>
    </div>
  );
}

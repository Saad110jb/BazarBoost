"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, KeyRound, Loader, CornerDownLeft, Eye, EyeOff } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function GatekeeperLoginPage() {
  const router = useRouter();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  // Validation and loading states
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [securityAlert, setSecurityAlert] = useState(false);

  // Clear session on login mount
  useEffect(() => {
    localStorage.removeItem("bazaar_token");
    localStorage.removeItem("bazaar_user");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSecurityAlert(false);

    const cleanEmail = email.trim();

    // Validate email structural entry mask
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorMsg("Invalid Email Address Mask: Must contain '@' and domain extension (e.g. name@domain.com)");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Secure Entry Check: Password must meet the 6-character length boundary.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API}/api/auth/gatekeeper-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, password })
      });
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 403 && data.securityAlert) {
          setSecurityAlert(true);
          setErrorMsg(data.message || "Security Alert: Concurrent login from different IP detected. SuperAdmin account suspended. Manual database reactivation required.");
        } else {
          setErrorMsg(data.message || "Authentication Denied: Invalid email or password credentials.");
        }
        setLoading(false);
        return;
      }

      if (data.success && data.token) {
        localStorage.setItem("bazaar_token", data.token);
        localStorage.setItem("bazaar_user", JSON.stringify(data.user));
        router.push("/admin/dashboard");
      }
    } catch (err) {
      setErrorMsg("Perimeter connection timeout. Check backend server connectivity.");
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#050508",
      color: "#00ff66",
      fontFamily: "'Courier New', Courier, monospace",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem"
    }}>
      <div style={{
        width: "100%",
        maxWidth: "440px",
        background: "#0a0a0f",
        border: `1.5px solid ${securityAlert ? "#ff3333" : "#00ff66"}`,
        borderRadius: "12px",
        padding: "2.5rem 2rem",
        boxShadow: securityAlert 
          ? "0 0 35px rgba(255,51,51,0.25)" 
          : "0 0 30px rgba(0,255,102,0.12)",
        transition: "all 0.3s ease"
      }}>
        
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "54px",
            height: "54px",
            borderRadius: "50%",
            background: securityAlert ? "rgba(255,51,51,0.1)" : "rgba(0,255,102,0.06)",
            border: `1px solid ${securityAlert ? "#ff3333" : "#00ff66"}`,
            color: securityAlert ? "#ff3333" : "#00ff66",
            marginBottom: "1rem"
          }}>
            {securityAlert ? <ShieldAlert size={26} /> : <KeyRound size={26} />}
          </div>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.15em", color: securityAlert ? "#ff3333" : "#00ff66" }}>
            {securityAlert ? "SYSTEM BREACH SHUTDOWN" : "GATEKEEPER SECURITY PANEL"}
          </h2>
          <p style={{ fontSize: "0.72rem", color: "#888899", marginTop: "0.5rem" }}>
            Unrestricted Platform Governance Authorization
          </p>
        </div>

        {/* Errors & Alerts */}
        {errorMsg && (
          <div style={{
            background: securityAlert ? "rgba(255,51,51,0.08)" : "rgba(0,0,0,0.5)",
            border: `1px solid ${securityAlert ? "#ff3333" : "#00ff66"}`,
            borderRadius: "8px",
            padding: "1rem",
            color: securityAlert ? "#ff3333" : "#ffcc00",
            fontSize: "0.78rem",
            lineHeight: 1.5,
            marginBottom: "1.5rem"
          }}>
            <strong style={{ display: "block", marginBottom: "0.25rem", textTransform: "uppercase" }}>
              {securityAlert ? "PLATFORM LOCKED" : "SYSTEM WARNING:"}
            </strong>
            {errorMsg}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
          
          <div>
            <label style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "0.5rem", color: "#888899" }}>
              Root User ID (Email):
            </label>
            <input 
              type="text" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@domain.com"
              disabled={loading || securityAlert}
              style={{
                width: "100%",
                background: "#020204",
                border: `1px solid ${securityAlert ? "#ff3333" : "rgba(0,255,102,0.25)"}`,
                borderRadius: "6px",
                padding: "0.75rem 1rem",
                color: securityAlert ? "#ff3333" : "#00ff66",
                fontSize: "0.85rem",
                fontFamily: "inherit",
                outline: "none",
                transition: "border-color 0.2s"
              }}
              onFocus={e => !securityAlert && (e.target.style.borderColor = "#00ff66")}
              onBlur={e => !securityAlert && (e.target.style.borderColor = "rgba(0,255,102,0.25)")}
            />
          </div>

          <div>
            <label style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "0.5rem", color: "#888899" }}>
              Access Code (Password):
            </label>
            <div style={{ position: "relative" }}>
              <input 
                type={showPassword ? "text" : "password"} 
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="******"
                disabled={loading || securityAlert}
                style={{
                  width: "100%",
                  background: "#020204",
                  border: `1px solid ${securityAlert ? "#ff3333" : "rgba(0,255,102,0.25)"}`,
                  borderRadius: "6px",
                  padding: "0.75rem 2.5rem 0.75rem 1rem",
                  color: securityAlert ? "#ff3333" : "#00ff66",
                  fontSize: "0.85rem",
                  fontFamily: "inherit",
                  outline: "none",
                  transition: "border-color 0.2s"
                }}
                onFocus={e => !securityAlert && (e.target.style.borderColor = "#00ff66")}
                onBlur={e => !securityAlert && (e.target.style.borderColor = "rgba(0,255,102,0.25)")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={securityAlert}
                style={{
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "rgba(0,255,102,0.5)",
                  cursor: "pointer"
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading || securityAlert}
            style={{
              width: "100%",
              background: securityAlert ? "rgba(255,51,51,0.05)" : "rgba(0,255,102,0.08)",
              border: `1px solid ${securityAlert ? "#ff3333" : "#00ff66"}`,
              borderRadius: "6px",
              padding: "0.85rem",
              color: securityAlert ? "#ff3333" : "#00ff66",
              fontSize: "0.85rem",
              fontWeight: "bold",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              cursor: securityAlert ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              marginTop: "0.5rem",
              transition: "all 0.2s"
            }}
            onMouseEnter={e => {
              if (securityAlert) return;
              e.currentTarget.style.background = "#00ff66";
              e.currentTarget.style.color = "#000000";
            }}
            onMouseLeave={e => {
              if (securityAlert) return;
              e.currentTarget.style.background = "rgba(0,255,102,0.08)";
              e.currentTarget.style.color = "#00ff66";
            }}
          >
            {loading ? (
              <>
                <Loader size={15} style={{ animation: "spin 1.5s linear infinite" }} /> Authenticating...
              </>
            ) : (
              <>
                Initialize Access <CornerDownLeft size={13} />
              </>
            )}
          </button>

        </form>

      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import PlatformLogo from "./PlatformLogo";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Package, Megaphone, MessageCircle,
  Settings, Store, ShieldCheck, Zap, TrendingUp, ShoppingBag, Tag, Wallet,
  ShieldAlert, Upload, Loader, CheckCircle
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface SidebarProps {
  role: "vendor" | "admin" | "shopper";
}

const vendorLinks = [
  { href: "/vendor/dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
  { href: "/vendor/products", label: "Products", icon: <Package size={16} /> },
  { href: "/vendor/orders", label: "Orders", icon: <ShoppingBag size={16} /> },
  { href: "/vendor/coupons", label: "Discounts & Sales", icon: <Tag size={16} /> },
  { href: "/vendor/ads", label: "Ad Bids", icon: <Megaphone size={16} /> },
  { href: "/vendor/negotiation", label: "Negotiations", icon: <MessageCircle size={16} /> },
  { href: "/vendor/wallet", label: "Wallet & Billing", icon: <Wallet size={16} /> },
  { href: "/vendor/staff", label: "Staff & Team", icon: <ShieldCheck size={16} /> },
  { href: "/vendor/storefront", label: "My Storefront", icon: <Store size={16} /> },
];

const adminLinks = [
  { href: "/admin/dashboard", label: "Platform Dashboard", icon: <LayoutDashboard size={16} /> },
  { href: "/admin/escrow-loans", label: "Escrow Loans", icon: <Wallet size={16} /> },
  { href: "/admin/approvals", label: "Ad Approvals", icon: <ShieldCheck size={16} /> },
  { href: "/admin/vendors", label: "Vendor Registry", icon: <Store size={16} /> },
  { href: "/admin/analytics", label: "Platform Analytics", icon: <TrendingUp size={16} /> },
  { href: "/admin/loyalty", label: "Platform Loyalty", icon: <Tag size={16} /> },
];

const shopperLinks = [
  { href: "/", label: "Marketplace", icon: <Store size={16} /> },
  { href: "/negotiation", label: "My Negotiations", icon: <MessageCircle size={16} /> },
];

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

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const [links, setLinks] = useState<any[]>([]);

  // Lockout & Form states
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [lockAmount, setLockAmount] = useState("");
  const [lockRefId, setLockRefId] = useState("");
  const [lockFile, setLockFile] = useState<File | null>(null);
  const [lockFilePreview, setLockFilePreview] = useState<string | null>(null);
  const [lockLoading, setLockLoading] = useState(false);
  const [lockError, setLockError] = useState("");
  const [lockSuccess, setLockSuccess] = useState("");

  useEffect(() => {
    const storedUser = localStorage.getItem("bazaar_user");
    const token = localStorage.getItem("bazaar_token");
    if (!storedUser || !token) {
      setLinks(role === "vendor" ? vendorLinks : role === "admin" ? adminLinks : shopperLinks);
      return;
    }

    const user = JSON.parse(storedUser);
    if (user.isTempPassword) {
      window.location.href = "/auth/setup-password";
      return;
    }

    if (user.role === "storeAdmin" && role === "vendor") {
      const decoded = decodeJWT(token);
      const permissionsArray = decoded?.permissions || [];
      const filtered = vendorLinks.filter((link) => {
        if (link.href === "/vendor/products") return permissionsArray.includes("EDIT_INVENTORY");
        if (link.href === "/vendor/negotiation") return permissionsArray.includes("LIVE_CHAT");
        if (link.href === "/vendor/orders") return permissionsArray.includes("PROCESS_ORDERS");
        if (link.href === "/vendor/coupons") return permissionsArray.includes("MANAGE_COUPONS");
        if (link.href === "/vendor/ads") return permissionsArray.includes("MANAGE_ADS");
        if (link.href === "/vendor/wallet") return permissionsArray.includes("VIEW_BILLING");
        if (link.href === "/vendor/staff") return permissionsArray.includes("MANAGE_COUPONS");
        if (link.href === "/vendor/storefront") return permissionsArray.includes("MANAGE_COUPONS");
        return true;
      });
      setLinks(filtered);
    } else {
      setLinks(role === "vendor" ? vendorLinks : role === "admin" ? adminLinks : shopperLinks);
    }
  }, [role]);

  // Status Polling for Lockout Check
  useEffect(() => {
    if (role !== "vendor") return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    const checkStatus = async () => {
      try {
        const res = await fetch(`${API}/api/wallet/balance`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.store) {
          setStoreInfo(data.store);
          if (data.store.isActive === false || data.store.debtZone === 'red') {
            setIsLocked(true);
          } else {
            setIsLocked(false);
          }
        }
      } catch (err) {
        console.error("Sidebar status check error:", err);
      }
    };

    checkStatus();
    // Poll store status every 10 seconds
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, [role]);

  const handleLockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockAmount || !lockRefId || !lockFile) {
      setLockError("Please specify deposit amount, reference ID, and upload receipt.");
      return;
    }

    setLockLoading(true);
    setLockError("");
    setLockSuccess("");

    const token = localStorage.getItem("bazaar_token");
    const formData = new FormData();
    formData.append("amountPKR", lockAmount);
    formData.append("referenceId", lockRefId);
    formData.append("type", "commission_payment"); // Specifically paying outstanding commission
    formData.append("receipt", lockFile);

    try {
      const res = await fetch(`${API}/api/wallet/topup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      
      if (data.success) {
        setLockSuccess("Payment receipt uploaded successfully! It is currently pending admin review. Your store will be reactivated automatically once the admin approves this payment.");
        setLockAmount("");
        setLockRefId("");
        setLockFile(null);
        setLockFilePreview(null);
      } else {
        setLockError(data.message || "Failed to submit payment request");
      }
    } catch (err: any) {
      setLockError("API communication failure during receipt submission");
    } finally {
      setLockLoading(false);
    }
  };

  if (isLocked) {
    return (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(10, 10, 15, 0.98)",
        backdropFilter: "blur(8px)",
        color: "#ffffff",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
        overflowY: "auto"
      }}>
        <div style={{
          width: "100%",
          maxWidth: "540px",
          background: "linear-gradient(145deg, #1b1b2a, #11111c)",
          border: "2px solid #ef4444",
          borderRadius: "20px",
          padding: "2.5rem",
          boxShadow: "0 0 40px rgba(239, 68, 68, 0.15)",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem"
        }}>
          {/* Header */}
          <div style={{ textAlign: "center" }}>
            <div style={{
              width: "60px",
              height: "60px",
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1rem",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#ef4444"
            }}>
              <ShieldAlert size={32} />
            </div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#ef4444", margin: 0 }}>
              Store Suspended (Red Zone)
            </h2>
            <p style={{ fontSize: "0.9rem", color: "#a9a9c0", marginTop: "0.5rem", lineHeight: 1.5 }}>
              BazaarBoost Governance: Access to your store panel is restricted because your outstanding commission debt exceeds the Rs. 25,000 threshold.
            </p>
          </div>

          {/* Bank details and info */}
          <div style={{
            background: "rgba(0, 0, 0, 0.2)",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            borderRadius: "12px",
            padding: "1.25rem",
            fontSize: "0.88rem",
            lineHeight: 1.6,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255, 255, 255, 0.05)", paddingBottom: "0.5rem", marginBottom: "0.5rem" }}>
              <span style={{ color: "#a9a9c0" }}>Outstanding Debt:</span>
              <strong style={{ color: "#ef4444", fontSize: "1rem" }}>
                Rs. {storeInfo?.wallet?.outstandingCommission?.toLocaleString() || "25,000+"}
              </strong>
            </div>
            <div><strong>Bank Transfer Details:</strong></div>
            <div style={{ fontSize: "0.82rem", color: "#a9a9c0" }}>
              <div>Bank Name: <span style={{ color: "#ffffff" }}>Habib Bank Limited (HBL)</span></div>
              <div>Account Name: <span style={{ color: "#ffffff" }}>BazaarBoost Private Ltd</span></div>
              <div>Account Number: <span style={{ color: "#ffffff" }}>1234-5678-9012-3456</span></div>
              <div>Instruction: <span style={{ color: "#f59e0b" }}>Transfer the outstanding debt and upload the receipt image.</span></div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleLockSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {lockError && (
              <div style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: "8px",
                padding: "0.75rem",
                color: "#ef4444",
                fontSize: "0.8rem",
                textAlign: "center"
              }}>
                {lockError}
              </div>
            )}
            
            {lockSuccess && (
              <div style={{
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.2)",
                borderRadius: "8px",
                padding: "0.75rem",
                color: "#10b981",
                fontSize: "0.8rem",
                textAlign: "center",
                lineHeight: 1.4
              }}>
                {lockSuccess}
              </div>
            )}

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", color: "#a9a9c0", marginBottom: "0.4rem", fontWeight: 700 }}>
                Deposit Amount (PKR)
              </label>
              <input
                type="number"
                required
                placeholder="e.g. 30000"
                value={lockAmount}
                onChange={e => setLockAmount(e.target.value)}
                style={{
                  width: "100%",
                  background: "#12121e",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  color: "#ffffff",
                  fontSize: "0.9rem"
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", color: "#a9a9c0", marginBottom: "0.4rem", fontWeight: 700 }}>
                Bank Transaction Reference ID
              </label>
              <input
                type="text"
                required
                placeholder="e.g. HBL-1234567"
                value={lockRefId}
                onChange={e => setLockRefId(e.target.value)}
                style={{
                  width: "100%",
                  background: "#12121e",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  color: "#ffffff",
                  fontSize: "0.9rem"
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", color: "#a9a9c0", marginBottom: "0.4rem", fontWeight: 700 }}>
                Upload Bank Transfer Receipt Image
              </label>
              <input
                type="file"
                required
                accept="image/*"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setLockFile(file);
                    setLockFilePreview(URL.createObjectURL(file));
                  }
                }}
                style={{ display: "none" }}
                id="lockout-file-upload"
              />
              <label
                htmlFor="lockout-file-upload"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  width: "100%",
                  background: "#12121e",
                  border: "1px dashed rgba(255, 255, 255, 0.2)",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  color: "#a9a9c0",
                  cursor: "pointer",
                  fontSize: "0.85rem"
                }}
              >
                <Upload size={16} /> {lockFile ? lockFile.name : "Select Transfer Receipt Image"}
              </label>
              {lockFilePreview && (
                <div style={{ marginTop: "0.5rem", textAlign: "center" }}>
                  <img src={lockFilePreview} alt="Receipt preview" style={{ maxHeight: "120px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.1)" }} />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={lockLoading}
              style={{
                width: "100%",
                background: "#ef4444",
                border: "none",
                borderRadius: "8px",
                padding: "0.75rem",
                color: "#ffffff",
                fontWeight: 700,
                cursor: lockLoading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                marginTop: "0.5rem",
                transition: "background 0.2s"
              }}
            >
              {lockLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle size={16} />}
              {lockLoading ? "Submitting..." : "Submit Receipt for Approval"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <aside
      style={{
        width: 240,
        minHeight: "100vh",
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border-subtle)",
        padding: "2rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ padding: "0 0.5rem", marginBottom: "2rem" }}>
        <PlatformLogo size={32} />
      </div>

      {/* Role Label */}
      <p style={{
        fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em",
        color: "var(--text-muted)", padding: "0 0.75rem", marginBottom: "0.5rem"
      }}>
        {role === "vendor" ? "Vendor Panel" : role === "admin" ? "Admin Console" : "Shopper"}
      </p>

      {/* Links */}
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`sidebar-link ${pathname === link.href ? "active" : ""}`}
        >
          {link.icon}
          {link.label}
        </Link>
      ))}

      {/* Bottom spacer */}
      <div style={{ flex: 1 }} />
      <div style={{
        background: "linear-gradient(135deg, rgba(124,58,237,0.1), rgba(168,85,247,0.05))",
        border: "1px solid var(--border-accent)",
        borderRadius: 12, padding: "1rem"
      }}>
        <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          🤖 <strong style={{ color: "#a855f7" }}>AI-Powered</strong><br />
          Local models running for tagging & OCR fraud detection.
        </p>
      </div>
    </aside>
  );
}

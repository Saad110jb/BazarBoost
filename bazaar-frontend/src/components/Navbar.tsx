"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import PlatformLogo from "./PlatformLogo";
import {
  ShoppingBag, Search, Bell, User, Menu, X, Zap, LogOut,
  LayoutDashboard, Store, Package, Megaphone
} from "lucide-react";
import { useCart } from "@/context/CartContext";
import CartDrawer from "./CartDrawer";
import NotificationBell from "./NotificationBell";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface NavUser {
  name: string;
  role: "guest" | "shopper" | "vendor" | "admin";
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { cart, setIsCartOpen } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [user, setUser] = useState<NavUser | null>(null);
  const [switchingRole, setSwitchingRole] = useState(false);

  // Route Guard: Redirect shoppers away from /vendor paths
  useEffect(() => {
    const stored = localStorage.getItem("bazaar_user");
    if (stored) {
      try {
        const u = JSON.parse(stored);
        if (u.role === "shopper" && pathname.startsWith("/vendor")) {
          router.replace("/");
        }
      } catch {}
    }
  }, [pathname, router]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", handleScroll);

    // Load user from localStorage (mock auth)
    const stored = localStorage.getItem("bazaar_user");
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch {}
    }

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (dropdownOpen && user && user.role === "shopper") {
      const token = localStorage.getItem("bazaar_token");
      if (!token) return;
      fetch(`${API}/api/orders`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => {
          if (!res.ok) {
            throw new Error(`HTTP error! Status: ${res.status}`);
          }
          return res.json();
        })
        .then(data => {
          if (data.success) {
            setOrders(data.orders || []);
          }
        })
        .catch(err => console.error("Failed to load shopper orders:", err));
    }
  }, [dropdownOpen, user]);

  const handleLogout = () => {
    localStorage.removeItem("bazaar_user");
    localStorage.removeItem("bazaar_token");
    setUser(null);
    setDropdownOpen(false);
    window.location.href = "/";
  };

  const handleRoleSwitch = async () => {
    if (!user) return;
    setSwitchingRole(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const targetRole = user.role === "shopper" ? "vendor" : "shopper";
      const res = await fetch(`${API}/api/auth/role/switch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ targetRole })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem("bazaar_token", data.token);
        localStorage.setItem("bazaar_user", JSON.stringify(data.user));
        setUser(data.user);
        setDropdownOpen(false);
        if (data.user.role === "vendor" || data.user.role === "storeAdmin") {
          window.location.href = "/vendor/dashboard";
        } else {
          window.location.href = "/";
        }
      } else {
        alert(data.message || "Failed to switch role");
      }
    } catch (err: any) {
      console.error("Role switch error:", err);
      alert("Error switching role");
    } finally {
      setSwitchingRole(false);
    }
  };

  const roleLinks = {
    vendor: [
      { href: "/vendor/dashboard", label: "Dashboard", icon: <LayoutDashboard size={14} /> },
      { href: "/vendor/products", label: "Products", icon: <Package size={14} /> },
      { href: "/vendor/ads", label: "Ad Bids", icon: <Megaphone size={14} /> },
      { href: "/vendor/negotiation", label: "Chats", icon: <Store size={14} /> },
    ],
    admin: [
      { href: "/admin/approvals", label: "Approvals", icon: <LayoutDashboard size={14} /> },
    ],
    shopper: [
      { href: "/negotiation", label: "My Chats", icon: <Store size={14} /> },
      { href: "/shopper/disputes", label: "My Disputes", icon: <Megaphone size={14} /> },
    ],
    guest: [],
  };

  const links = user ? (roleLinks[user.role] || []) : [];

  return (
    <nav
      id="main-navbar"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        padding: "0.8rem 2rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        transition: "all 0.3s ease",
        background: scrolled
          ? "rgba(10, 10, 15, 0.95)"
          : "rgba(10, 10, 15, 0.6)",
        backdropFilter: "blur(20px)",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.07)" : "1px solid transparent",
      }}
    >
      {/* Logo */}
      <PlatformLogo size={36} />

      {/* Desktop nav links */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
        <Link href="/" className="sidebar-link" style={{ padding: "0.5rem 0.85rem" }}>Marketplace</Link>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="sidebar-link" style={{ padding: "0.5rem 0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {l.icon}{l.label}
          </Link>
        ))}
      </div>

      {/* Right section */}
      <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
        <button 
          onClick={() => setIsCartOpen(true)}
          style={{ position: "relative", display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", color: "inherit" }}
        >
          <ShoppingBag size={18} style={{ opacity: 0.85 }} />
          {cart.length > 0 && (
            <span style={{
              position: "absolute",
              top: "-8px",
              right: "-8px",
              background: "#7c3aed",
              color: "#ffffff",
              borderRadius: "50%",
              minWidth: "16px",
              height: "16px",
              padding: "0 3px",
              fontSize: "0.6rem",
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 10px rgba(124,58,237,0.3)"
            }}>
              {cart.reduce((sum, item) => sum + item.quantity, 0)}
            </span>
          )}
        </button>

        {user ? (
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* Notification bell for authenticated users */}
            <NotificationBell />
            <div style={{ position: "relative" }}>
            <button
              id="user-menu-btn"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              style={{
                background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)",
                borderRadius: 10, padding: "0.45rem 1rem", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "0.5rem",
                color: "#a855f7", fontWeight: 600, fontSize: "0.85rem"
              }}
            >
              <User size={15} />
              {user.name}
              <span className={`badge badge-info`} style={{ fontSize: "0.65rem", padding: "0.1rem 0.5rem" }}>{user.role}</span>
            </button>
            {dropdownOpen && (
              <div style={{
                position: "absolute", right: 0, top: "110%",
                background: "var(--bg-card)", border: "1px solid var(--border-subtle)",
                borderRadius: 12, padding: "0.5rem", minWidth: 240,
                boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
                animation: "fadeInUp 0.2s ease",
                zIndex: 1001,
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem"
              }}>
                {user.role === "shopper" && (
                  <>
                    <div style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--border-subtle)", fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>
                      My Orders
                    </div>
                    <div style={{ maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.2rem", padding: "0.2rem 0" }}>
                      {orders.length === 0 ? (
                        <p style={{ padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>No orders placed yet</p>
                      ) : (
                        orders.map(o => (
                          <Link
                            key={o._id}
                            href={`/shop/${o.storeId?.slug || 'store'}/order/${o._id}`}
                            onClick={() => setDropdownOpen(false)}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              padding: "0.4rem 0.75rem",
                              borderRadius: 6,
                              fontSize: "0.78rem",
                              textDecoration: "none",
                              color: "var(--text-secondary)",
                              transition: "background 0.2s"
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                            onMouseLeave={e => e.currentTarget.style.background = "none"}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                              <span>#{o._id.slice(-8).toUpperCase()}</span>
                              <span style={{ fontSize: "0.68rem", color: o.status === 'completed' || o.status === 'delivered' ? '#10b981' : '#7c3aed' }}>
                                {o.status.replace('_', ' ')}
                              </span>
                            </div>
                            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>
                              {o.storeId?.name || "Merchant"} • Rs. {o.totalAmount.toLocaleString()}
                            </span>
                          </Link>
                        ))
                      )}
                    </div>
                    <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)", margin: "0.2rem 0" }} />
                  </>
                )}

                <button
                  onClick={handleRoleSwitch}
                  disabled={switchingRole}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.5rem",
                    width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8,
                    background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)",
                    color: "#a855f7", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600,
                    marginBottom: "0.25rem", transition: "all 0.2s"
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(124,58,237,0.2)"}
                  onMouseLeave={e => e.currentTarget.style.background = "rgba(124,58,237,0.1)"}
                >
                  <Zap size={14} className={switchingRole ? "animate-spin" : ""} />
                  {user.role === "shopper" ? "Switch to Seller Portal" : "Switch to Shopper View"}
                </button>

                <button
                  onClick={handleLogout}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.5rem",
                    width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8,
                    background: "none", border: "none", color: "#ef4444",
                    cursor: "pointer", fontSize: "0.875rem", fontWeight: 500
                  }}
                >
                  <LogOut size={14} /> Logout
                </button>
              </div>
            )}
          </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link href="/auth/login" className="btn-secondary" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}>
              Log In
            </Link>
            <Link href="/auth/register" className="btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}>
              Sign Up
            </Link>
          </div>
        )}
      </div>
      <CartDrawer />
    </nav>
  );
}

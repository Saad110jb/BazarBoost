"use client";
import { useEffect, useState, useRef } from "react";
import { Store, ChevronDown, Plus, Check, Loader } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function StoreSwitcher() {
  const [stores, setStores] = useState<any[]>([]);
  const [activeStore, setActiveStore] = useState<any>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowCreateInput(false);
        setNewStoreName("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch all stores for this vendor
  const fetchStores = async () => {
    try {
      const token = localStorage.getItem("bazaar_token");
      if (!token) return;

      const res = await fetch(`${API}/api/auth/stores`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.stores) {
        setStores(data.stores);
        
        // Find active store context from JWT payload
        const payload = parseJwt(token);
        if (payload && payload.activeStoreId) {
          const active = data.stores.find((s: any) => s._id === payload.activeStoreId);
          setActiveStore(active || data.stores[0]);
        } else {
          setActiveStore(data.stores[0]);
        }
      }
    } catch (err) {
      console.error("Error fetching stores:", err);
    }
  };

  useEffect(() => {
    fetchStores();
  }, []);

  const parseJwt = (token: string) => {
    try {
      return JSON.parse(atob(token.split(".")[1]));
    } catch {
      return null;
    }
  };

  // Switch context to different store
  const handleSwitchStore = async (storeId: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/auth/store/switch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ storeId })
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem("bazaar_token", data.token);
        
        // Update user storeId in local profile
        const userStored = localStorage.getItem("bazaar_user");
        if (userStored) {
          const user = JSON.parse(userStored);
          user.storeId = data.activeStoreId;
          localStorage.setItem("bazaar_user", JSON.stringify(user));
        }

        setIsOpen(false);
        // Refresh full page to update all layouts with new store context
        window.location.reload();
      }
    } catch (err) {
      console.error("Failed to switch store:", err);
    } finally {
      setLoading(false);
    }
  };

  // Create new store profile
  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName.trim() || loading) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/auth/store/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ storeName: newStoreName })
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem("bazaar_token", data.token);

        // Update user storeId in local profile
        const userStored = localStorage.getItem("bazaar_user");
        if (userStored) {
          const user = JSON.parse(userStored);
          user.storeId = data.activeStoreId;
          localStorage.setItem("bazaar_user", JSON.stringify(user));
        }

        setNewStoreName("");
        setShowCreateInput(false);
        setIsOpen(false);
        // Refresh page to load new store workspace
        window.location.reload();
      }
    } catch (err) {
      console.error("Failed to create store:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!activeStore) return null;

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      {/* Switcher Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "10px",
          padding: "0.5rem 1rem",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontSize: "0.9rem",
          fontWeight: 600,
          transition: "background 0.2s"
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)")}
      >
        <Store size={15} style={{ color: "#a855f7" }} />
        <span>{activeStore.name}</span>
        <ChevronDown size={14} style={{ color: "var(--text-muted)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="glass-card animate-fade-up"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "250px",
            padding: "0.5rem",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
            border: "1px solid var(--border-subtle)"
          }}
        >
          <div style={{ padding: "0.4rem 0.6rem", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Switch Store Context
          </div>

          {/* Stores List */}
          <div style={{ maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            {stores.map((s) => {
              const isActive = s._id === activeStore._id;
              return (
                <button
                  key={s._id}
                  onClick={() => !isActive && handleSwitchStore(s._id)}
                  disabled={loading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "0.5rem 0.6rem",
                    borderRadius: "8px",
                    background: isActive ? "rgba(124, 58, 237, 0.12)" : "transparent",
                    border: "none",
                    color: isActive ? "#a855f7" : "var(--text-secondary)",
                    cursor: isActive ? "default" : "pointer",
                    fontSize: "0.85rem",
                    fontWeight: isActive ? 600 : 500,
                    textAlign: "left",
                    transition: "all 0.15s"
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "var(--bg-card-hover)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  {isActive && <Check size={14} style={{ color: "#a855f7" }} />}
                </button>
              );
            })}
          </div>

          <div style={{ height: "1px", background: "var(--border-subtle)", margin: "0.4rem 0" }} />

          {/* Create Store Action */}
          {!showCreateInput ? (
            <button
              onClick={() => setShowCreateInput(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                width: "100%",
                padding: "0.5rem 0.6rem",
                borderRadius: "8px",
                background: "transparent",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 600,
                textAlign: "left",
                transition: "all 0.15s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-card-hover)";
                e.currentTarget.style.color = "#a855f7";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <Plus size={14} />
              <span>Add New Store Profile</span>
            </button>
          ) : (
            <form onSubmit={handleCreateStore} style={{ display: "flex", gap: "0.3rem", padding: "0.2rem" }}>
              <input
                autoFocus
                className="input-field"
                style={{ height: "30px", fontSize: "0.8rem", padding: "0.2rem 0.5rem" }}
                placeholder="New Store Name..."
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                required
                disabled={loading}
              />
              <button
                type="submit"
                className="btn-primary"
                style={{ width: "30px", height: "30px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "8px" }}
                disabled={loading || !newStoreName.trim()}
              >
                {loading ? <Loader size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={14} />}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

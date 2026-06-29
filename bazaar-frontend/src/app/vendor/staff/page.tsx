"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import StoreSwitcher from "@/components/StoreSwitcher";
import { UserPlus, Shield, Clock, Trash2, Mail, User, CheckCircle, AlertCircle, Loader, Copy, Check, X } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function VendorStaffPage() {
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    shift: "morning",
    manageProducts: true,
    manageChats: true,
    manageAds: false,
    manageSettings: false
  });

  const [invitedStaff, setInvitedStaff] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/auth/staff`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setStaffList(data.staff);
      }
    } catch (err) {
      console.error("Error fetching staff:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem("bazaar_user");
    if (storedUser) {
      const u = JSON.parse(storedUser);
      if (u.role === "storeAdmin") {
        const allowed = u.permissions?.manageSettings !== false;
        setHasPermission(allowed);
        if (allowed) fetchStaff();
      } else {
        setHasPermission(true);
        fetchStaff();
      }
    } else {
      fetchStaff();
    }
  }, []);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/auth/staff/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          shift: form.shift,
          permissions: {
            manageProducts: form.manageProducts,
            manageChats: form.manageChats,
            manageAds: form.manageAds,
            manageSettings: form.manageSettings
          }
        })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to create staff");

      setSuccess("Staff account provisioned successfully!");
      setInvitedStaff({
        name: data.staff.name,
        email: data.staff.email,
        tempPassword: data.tempPassword
      });
      setForm({
        name: "",
        email: "",
        shift: "morning",
        manageProducts: true,
        manageChats: true,
        manageAds: false,
        manageSettings: false
      });
      fetchStaff();
    } catch (err: any) {
      setError(err.message || "Error adding staff member");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveStaff = async (staffId: string) => {
    if (!confirm("Are you sure you want to remove this staff member?")) return;
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/auth/staff/${staffId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setStaffList(staffList.filter(s => s._id !== staffId));
      }
    } catch (err) {
      console.error("Failed to delete staff:", err);
    }
  };

  const handleCopyCredentials = () => {
    if (!invitedStaff) return;
    const txt = `BazaarBoost Store Admin Credentials\nEmail: ${invitedStaff.email}\nTemporary Password: ${invitedStaff.tempPassword}`;
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (hasPermission === false) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
        <Sidebar role="vendor" />
        <main style={{ flex: 1, padding: "2.5rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="glass-card animate-fade-up" style={{ padding: "3rem", textAlign: "center", maxWidth: 500 }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#ef4444", marginBottom: "1rem" }}>Access Denied</h2>
            <p style={{ color: "var(--text-secondary)" }}>You do not have permission to manage staff settings. Please contact the store owner.</p>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "0.3rem" }}>Staff & Team Settings</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Provision sub-accounts for store administrators and manage shift coverage scopes.
            </p>
          </div>
          <StoreSwitcher />
        </div>

        {/* Success / Error Banners */}
        {success && (
          <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.5rem", color: "#10b981", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <CheckCircle size={15} /> {success}
          </div>
        )}
        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.5rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <AlertCircle size={15} /> {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr", gap: "2rem" }}>
          {/* Column 1: Invite Form */}
          <div className="glass-card" style={{ padding: "1.75rem", height: "fit-content" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <UserPlus size={16} style={{ color: "#a855f7" }} /> Invite New Staff
            </h3>

            <form onSubmit={handleCreateStaff} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Staff Name</label>
                <div style={{ position: "relative" }}>
                  <User size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                  <input className="input-field" style={{ paddingLeft: "2.2rem" }} placeholder="e.g. Alice Smith" required
                    value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Email Address</label>
                <div style={{ position: "relative" }}>
                  <Mail size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                  <input className="input-field" style={{ paddingLeft: "2.2rem" }} type="email" placeholder="alice@store.com" required
                    value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem", fontWeight: 600 }}>Shift Coverage</label>
                <div style={{ position: "relative" }}>
                  <Clock size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                  <select className="input-field" style={{ paddingLeft: "2.2rem", appearance: "none", cursor: "pointer" }}
                    value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}>
                    <option value="morning">🌅 Morning Shift (8 AM - 4 PM)</option>
                    <option value="evening">🌆 Evening Shift (4 PM - 12 AM)</option>
                    <option value="night">🌃 Night Shift (12 AM - 8 AM)</option>
                    <option value="full-time">⏰ Full-Time Shift (9 AM - 6 PM)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>Access Permissions</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "0.75rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={form.manageProducts} onChange={e => setForm({ ...form, manageProducts: e.target.checked })} />
                    <span>Manage Products & Inventory</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={form.manageChats} onChange={e => setForm({ ...form, manageChats: e.target.checked })} />
                    <span>Access Chat & Negotiations</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={form.manageAds} onChange={e => setForm({ ...form, manageAds: e.target.checked })} />
                    <span>Manage Ad Campaigns & Bids</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={form.manageSettings} onChange={e => setForm({ ...form, manageSettings: e.target.checked })} />
                    <span>Modify Settings & Staff</span>
                  </label>
                </div>
              </div>

              <button type="submit" className="btn-primary" style={{ justifyContent: "center", padding: "0.6rem" }} disabled={submitting}>
                {submitting ? <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> Provisioning…</> : <><UserPlus size={14} /> Provision Sub-Account</>}
              </button>
            </form>
          </div>

          {/* Column 2: Staff List */}
          <div className="glass-card" style={{ padding: "1.75rem", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Shield size={16} style={{ color: "#a855f7" }} /> Active Staff Registry
            </h3>

            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem" }}>
                <Loader size={24} style={{ animation: "spin 1s linear infinite", color: "#a855f7" }} />
              </div>
            ) : staffList.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem 2rem", border: "1px dashed var(--border-subtle)", borderRadius: 12, color: "var(--text-muted)", gap: "0.5rem" }}>
                <Shield size={24} style={{ opacity: 0.5 }} />
                <p style={{ fontSize: "0.85rem", fontWeight: 600 }}>No Staff Provisioned</p>
                <p style={{ fontSize: "0.75rem", textAlign: "center" }}>Use the panel on the left to add your first store administrator.</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      {["Staff Member", "Shift Coverage", "Permissions", "Actions"].map(h => (
                        <th key={h} style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {staffList.map((s) => (
                      <tr key={s._id} style={{ borderBottom: "1px solid var(--border-subtle)", transition: "background 0.15s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-card-hover)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{s.name}</span>
                            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{s.email}</span>
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <span className="badge badge-info" style={{ textTransform: "capitalize" }}>
                            ⏱️ {s.shift}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                            {s.permissions?.manageProducts && (
                              <span style={{ fontSize: "0.65rem", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 10, padding: "0.05rem 0.4rem", color: "#3b82f6" }}>
                                Products
                              </span>
                            )}
                            {s.permissions?.manageChats && (
                              <span style={{ fontSize: "0.65rem", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 10, padding: "0.05rem 0.4rem", color: "#10b981" }}>
                                Chats
                              </span>
                            )}
                            {s.permissions?.manageAds && (
                              <span style={{ fontSize: "0.65rem", background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 10, padding: "0.05rem 0.4rem", color: "#a855f7" }}>
                                Ads
                              </span>
                            )}
                            {s.permissions?.manageSettings && (
                              <span style={{ fontSize: "0.65rem", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, padding: "0.05rem 0.4rem", color: "#f59e0b" }}>
                                Settings
                              </span>
                            )}
                            {!s.permissions?.manageProducts && !s.permissions?.manageChats && !s.permissions?.manageAds && !s.permissions?.manageSettings && (
                              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>None</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <button
                            onClick={() => handleRemoveStaff(s._id)}
                            style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", padding: "0.25rem", display: "flex", alignItems: "center" }}
                            title="Remove staff member"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Success Credentials Modal */}
      {invitedStaff && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
          background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center",
          justifyContent: "center", zIndex: 1000, backdropFilter: "blur(10px)"
        }}>
          <div className="glass-card animate-fade-up" style={{
            width: "90%", maxWidth: 440, padding: "2rem",
            border: "1px solid var(--border-accent)",
            boxShadow: "0 0 40px rgba(124,58,237,0.2)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <CheckCircle size={20} color="#10b981" /> Staff Account Invited
              </h3>
              <button onClick={() => setInvitedStaff(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              A placeholder sub-account has been registered. Share these credentials with the employee. They will be forced to choose a secure password upon logging in.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "1rem", marginBottom: "1.5rem" }}>
              <div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase", fontWeight: 700 }}>Full Name</span>
                <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{invitedStaff.name}</span>
              </div>
              <div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase", fontWeight: 700 }}>Email (Username)</span>
                <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{invitedStaff.email}</span>
              </div>
              <div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase", fontWeight: 700 }}>Temporary Password</span>
                <span style={{ fontSize: "0.95rem", fontWeight: 700, fontFamily: "monospace", color: "#a855f7", letterSpacing: "0.05em" }}>{invitedStaff.tempPassword}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button onClick={handleCopyCredentials} className="btn-primary" style={{ flex: 1, justifyContent: "center" }}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy Credentials</>}
              </button>
              <button onClick={() => setInvitedStaff(null)} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


"use client";
import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import StoreSwitcher from "@/components/StoreSwitcher";
import { io, Socket } from "socket.io-client";
import { 
  MessageSquare, Send, Paperclip, Loader, Check, User, 
  CornerDownLeft, Shield, LogOut, CheckCircle, Search, 
  PlusCircle, Eye, ArrowLeft, RefreshCw, X, Sparkles, AlertTriangle, Zap,
  UserCheck, AlertCircle, DollarSign, MessageCircle
} from "lucide-react";
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell 
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const getImageUrl = (url: string) => {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  const cleanUrl = url.startsWith("/") ? url : `/${url}`;
  return `${API}${cleanUrl}`;
};

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

const DEMO_CHATS = [
  { id: "shopper-1", name: "Alice Johnson", lastMessage: "Can you do $55 for the headphones?", status: "unassigned", assignedTo: null },
  { id: "shopper-2", name: "Bob Martinez", lastMessage: "Is the leather wallet still available?", status: "active", assignedTo: "some-op" },
];

const DEMO_MESSAGES_MAP: Record<string, any[]> = {
  "shopper-1": [
    {
      _id: "m1",
      meta: { roomId: "room:mock_store_shopper-1", timestamp: "2026-06-17T09:20:00Z", senderRole: "Customer" },
      content: { messageText: "Hi! I'm interested in the headphones.", mediaUrl: null },
      attachments: { hasProductSnippet: false, productData: null }
    },
    {
      _id: "m2",
      meta: { roomId: "room:mock_store_shopper-1", timestamp: "2026-06-17T09:22:00Z", senderRole: "Vendor" },
      content: { messageText: "Hi Alice! They're in stock. The price is $79.99.", mediaUrl: null },
      attachments: { hasProductSnippet: false, productData: null }
    },
    {
      _id: "m3",
      meta: { roomId: "room:mock_store_shopper-1", timestamp: "2026-06-17T09:30:00Z", senderRole: "Customer" },
      content: { messageText: "Can you do $55 for the headphones?", mediaUrl: null },
      attachments: {
        hasProductSnippet: true,
        productData: {
          productId: "p1",
          name: "Premium Wireless Headphones",
          price: 55,
          thumbnailUrl: "",
          slug: "premium-wireless-headphones"
        }
      }
    },
  ],
  "shopper-2": [
    {
      _id: "m4",
      meta: { roomId: "room:mock_store_shopper-2", timestamp: "2026-06-16T18:00:00Z", senderRole: "Customer" },
      content: { messageText: "Is the leather wallet still available?", mediaUrl: null },
      attachments: { hasProductSnippet: false, productData: null }
    },
  ],
};

export default function VendorNegotiationPage() {
  const [chats, setChats] = useState<any[]>(DEMO_CHATS);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  // Dynamic ML Floor price recommendation states
  const [recommendedFloor, setRecommendedFloor] = useState<number | null>(null);
  const [floorLoading, setFloorLoading] = useState(false);

  // Shift-End summary states
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<any>(null);
  const [fetchingSummary, setFetchingSummary] = useState(false);

  const [userRole, setUserRole] = useState<string>("");
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatError, setChatError] = useState("");
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // Catalog search & snippet integration
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showOfferInput, setShowOfferInput] = useState(false);
  const [offerAmount, setOfferAmount] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  // Parse user info on mount
  useEffect(() => {
    const stored = localStorage.getItem("bazaar_user");
    const token = localStorage.getItem("bazaar_token");
    if (stored && token) {
      const u = JSON.parse(stored);
      setUser(u);
      setUserRole(u.role);

      const decoded = decodeJWT(token);
      const permissionsArray = decoded?.permissions || [];

      if (u.role === "storeAdmin") {
        setHasPermission(permissionsArray.includes("LIVE_CHAT"));
      } else {
        setHasPermission(true);
      }
    }
  }, []);

  // Standardize message format to meta-content-attachments contract
  const standardizeMessage = (msg: any) => {
    if (msg.meta && msg.content) {
      return {
        ...msg,
        priceOffer: msg.priceOffer ?? msg.proposedPrice ?? null,
        offerStatus: msg.offerStatus ?? "none",
        isCardSnippet: msg.isCardSnippet ?? false,
        originalPrice: msg.originalPrice ?? null,
        proposedPrice: msg.proposedPrice ?? null
      };
    }
    const hasProduct = !!msg.productId;
    const isMe = msg.senderId?._id === user?._id || msg.senderId?.role === user?.role || msg.senderId === user?._id;
    return {
      _id: msg._id,
      priceOffer: msg.priceOffer ?? msg.proposedPrice ?? null,
      offerStatus: msg.offerStatus ?? "none",
      isCardSnippet: msg.isCardSnippet ?? false,
      originalPrice: msg.originalPrice ?? null,
      proposedPrice: msg.proposedPrice ?? null,
      meta: {
        roomId: `room:${msg.storeId || user?.activeStoreId || user?.storeId || "mock_store"}_${msg.shopperId}`,
        timestamp: msg.createdAt || msg.timestamp || new Date().toISOString(),
        senderRole: msg.isSystem ? "System" : (isMe ? "Vendor" : "Customer")
      },
      content: {
        messageText: msg.text || "",
        mediaUrl: msg.mediaUrl || null
      },
      attachments: {
        hasProductSnippet: hasProduct,
        productData: hasProduct ? {
          productId: msg.productId?._id || msg.productId,
          name: msg.productId?.title || msg.productId?.name || "Product",
          price: msg.productId?.price || 0,
          thumbnailUrl: msg.productId?.images?.[0]?.url || "",
          slug: msg.productId?.slug || ""
        } : null
      }
    };
  };

  // Fetch active conversations list from backend
  const fetchChats = async () => {
    setLoadingChats(true);
    setChatError("");
    try {
      const token = localStorage.getItem("bazaar_token");
      if (!token) return;

      const storeId = user?.activeStoreId || user?.storeId;
      if (!storeId) return;
      
      const res = await fetch(`${API}/api/negotiation/sessions/${storeId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.sessions) {
        const mapped = data.sessions.map((s: any) => ({
          id: s.shopperId?._id || s.shopperId,
          name: s.shopperId?.name || "Customer Client",
          lastMessage: `Last Activity: ${new Date(s.lastActivity).toLocaleTimeString()}`,
          status: s.status,
          assignedTo: s.assignedOperatorId?._id || s.assignedOperatorId,
          assignedName: s.assignedOperatorId?.name || null
        }));
        setChats(mapped);
      } else {
        setChats(DEMO_CHATS);
      }
    } catch (err) {
      console.warn("Backend negotiation chats fetch failed. Falling back to demo data.", err);
      setChats(DEMO_CHATS);
    } finally {
      setLoadingChats(false);
    }
  };

  useEffect(() => {
    if (hasPermission && user) {
      fetchChats();
    }
  }, [user, hasPermission]);

  // Handle room socket subscriptions and chat history loading
  useEffect(() => {
    if (!activeChat) return;

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    // Disconnect previous socket
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    let socket: any = null;

    // Step 1: Hook Check - Fetch / Resolve Active Thread ID (do not generate a new one)
    const customerId = activeChat;
    const vendorId = user?._id || user?.id;

    if (!customerId || !vendorId) return;

    fetch(`${API}/api/negotiations/resolve-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ customerId, vendorId, productId: null })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.roomId) {
          const resolvedRoomId = data.roomId;
          setRoomId(resolvedRoomId);
          
          if (data.messages) {
            setMessages(data.messages.map((m: any) => standardizeMessage(m)));
          } else {
            setMessages(DEMO_MESSAGES_MAP[activeChat] || []);
          }

          // Step 2: Establish authenticated Socket.io connection (Handshake check)
          socket = io(API, {
            auth: { token },
            transports: ["websocket"],
            forceNew: true
          });
          socketRef.current = socket;

          const storeId = user?.activeStoreId || user?.storeId || "mock_store";

          const handleConnect = () => {
            console.log(`Connected to Socket.IO server. Joining room: ${resolvedRoomId}`);
            socket.emit("join_negotiation_room", { roomId: resolvedRoomId, userType: 'VENDOR' });
            socket.emit("join_store", { storeId });
          };

          if (socket.connected) {
            handleConnect();
          }
          socket.on("connect", handleConnect);

          // Standardize client state hooks to capture incoming payloads cleanly via functional array modifiers
          const handleIncomingMsg = (incomingMsg: any) => {
            const standardized = standardizeMessage(incomingMsg);
            setMessages((prev) => {
              if (prev.some(m => m._id === standardized._id)) return prev;
              // Remove temporary optimistic message if real DB message arrived for same sender & text
              const filtered = prev.filter(m => !(m._id?.startsWith("temp_") && m.content?.messageText === standardized.content?.messageText));
              return [...filtered, standardized];
            });
            fetchChats();
          };

          socket.on("receive_negotiation_msg", handleIncomingMsg);
          socket.on("receive_message", handleIncomingMsg);

          socket.on("chat_session_updated", () => {
            fetchChats();
          });

          socket.on("chat_assigned", () => {
            fetchChats();
          });

          socket.on("shift_ended", () => {
            fetchChats();
            setActiveChat(null);
          });

          socket.on("error_notification", (errData: any) => {
            console.error("Socket error message:", errData.message);
            setChatError(errData.message);
          });
        }
      })
      .catch(err => {
        console.warn("Failed to resolve vendor chat session:", err);
      });

    return () => {
      if (socketRef.current) {
        socketRef.current.off("receive_negotiation_msg");
        socketRef.current.disconnect();
      }
    };
  }, [activeChat, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const lastProduct = [...messages].reverse().find(m => m.attachments?.hasProductSnippet)?.attachments?.productData;
    if (lastProduct?.productId) {
      const fetchFloorPrice = async () => {
        setFloorLoading(true);
        try {
          const token = localStorage.getItem("bazaar_token");
          const res = await fetch(`${API}/api/negotiation/floor-price/${lastProduct.productId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.success && data.recommendedFloorPrice) {
            setRecommendedFloor(data.recommendedFloorPrice);
          } else {
            setRecommendedFloor(null);
          }
        } catch (err) {
          console.error("Failed to fetch floor price:", err);
          setRecommendedFloor(null);
        } finally {
          setFloorLoading(false);
        }
      };
      fetchFloorPrice();
    } else {
      setRecommendedFloor(null);
    }
  }, [messages, activeChat]);

  const sendMessage = (priceOffer?: number) => {
    if (!text.trim() && !priceOffer) return;
    if (!roomId) return;

    const lastProductInChat = [...messages].reverse().find(m => m.attachments?.hasProductSnippet)?.attachments?.productData;
    const messageText = priceOffer ? `Counter-offer: Rs. ${priceOffer.toFixed(2)}` : text;

    const tempMessage = standardizeMessage({
      _id: `temp_${Date.now()}`,
      roomId,
      senderId: user?._id || user?.id,
      text: messageText,
      messageText,
      proposedPrice: priceOffer || null,
      priceOffer: priceOffer || null,
      offerStatus: priceOffer ? "pending" : "none",
      meta: {
        roomId,
        timestamp: new Date().toISOString(),
        senderRole: "Vendor"
      },
      content: { messageText, mediaUrl: null },
      attachments: {
        hasProductSnippet: !!lastProductInChat,
        productData: lastProductInChat || null
      }
    });

    // Optimistically update local state immediately
    setMessages((prev) => [...prev, tempMessage]);

    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("send_negotiation_msg", {
        roomId,
        senderId: user?._id || user?.id,
        text: messageText,
        proposedPrice: priceOffer || null,
        timestamp: new Date()
      });
    }

    setText("");
    setOfferAmount("");
    setShowOfferInput(false);
  };

  // Claim Chat Assignment
  const handleClaimChat = (shopperId: string) => {
    const storeId = user?.activeStoreId || user?.storeId || "mock_store";
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("assign_chat", { storeId, shopperId });
    } else {
      setChats(prev => prev.map(c => c.id === shopperId ? { ...c, status: "active", assignedTo: user?._id, assignedName: user?.name } : c));
    }
  };

  // End Shift Handover & Fetch Summary Report
  const handleEndShiftClick = async () => {
    const storeId = user?.activeStoreId || user?.storeId || "mock_store";
    setFetchingSummary(true);
    try {
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/negotiation/shift-summary/${storeId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setShiftSummary(data.summary);
        setShowShiftModal(true);
      } else {
        alert("Failed to compile shift summary: " + data.message);
      }
    } catch (err) {
      // Offline simulation fallback
      setShiftSummary({
        totalOrders: 4,
        totalRevenue: 15400,
        platformCommission: 770,
        netEarnings: 14630,
        couponsRedeemed: [
          { code: "EID200", count: 2, totalDiscount: 400 },
          { code: "SAVE10", count: 1, totalDiscount: 120 }
        ],
        averageLatencySeconds: 42,
        responseCount: 15
      });
      setShowShiftModal(true);
    } finally {
      setFetchingSummary(false);
    }
  };

  const confirmEndShift = () => {
    const storeId = user?.activeStoreId || user?.storeId || "mock_store";
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("end_shift", { storeId });
    }
    setShowShiftModal(false);
    setShiftSummary(null);
    fetchChats();
    setActiveChat(null);
    alert("Shift handover complete! Operator session closed out.");
  };

  // Search product catalog for snippet attachments
  const handleSearchCatalog = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const storeId = user?.activeStoreId || user?.storeId || "mock_store";
      const token = localStorage.getItem("bazaar_token");
      const res = await fetch(`${API}/api/products/store/${storeId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.products) {
        const filtered = data.products.filter((p: any) => 
          p.title.toLowerCase().includes(query.toLowerCase()) || 
          p.description?.toLowerCase().includes(query.toLowerCase())
        );
        setSearchResults(filtered);
      }
    } catch (err) {
      console.warn("Offline search fallback");
      setSearchResults([]);
    }
  };

  // Send product card snippet
  const sendProductSnippet = (prod: any) => {
    if (!roomId) return;

    const messagePayload = {
      meta: {
        roomId,
        timestamp: new Date().toISOString(),
        senderRole: "Vendor"
      },
      content: {
        messageText: `Product suggestion: ${prod.title}`
      },
      attachments: {
        hasProductSnippet: true,
        productData: {
          productId: prod._id,
          name: prod.title,
          price: prod.price,
          thumbnailUrl: prod.images?.[0]?.url || prod.images?.[0] || "",
          slug: prod.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        }
      }
    };

    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("send_message", messagePayload);
    }
    setSearchQuery("");
    setSearchResults([]);
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "00:00";
    }
  };

  if (hasPermission === false) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
        <Sidebar role="vendor" />
        <main style={{ flex: 1, padding: "2.5rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="glass-card animate-fade-up" style={{ padding: "3rem", textAlign: "center", maxWidth: 500 }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#ef4444", marginBottom: "1rem" }}>Access Denied</h2>
            <p style={{ color: "var(--text-secondary)" }}>You do not have permission to access chats and negotiations. Please contact the store owner.</p>
          </div>
        </main>
      </div>
    );
  }

  const currentChatObj = chats.find(c => c.id === activeChat);
  const isAssignedToMe = !currentChatObj || currentChatObj.assignedTo === user?._id || userRole === "vendor";

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <Sidebar role="vendor" />
      <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        
        {/* Chat list */}
        <div style={{ width: 300, borderRight: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", background: "var(--bg-secondary)" }}>
          
          <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Negotiations</h2>
              <StoreSwitcher />
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {loadingChats ? "Loading channels..." : `${chats.length} active conversations`}
            </p>
          </div>

          {/* Compact Smart Recommendation Banner */}
          <div style={{
            margin: "0.75rem 1rem",
            padding: "0.75rem",
            background: "linear-gradient(135deg, rgba(124, 58, 237, 0.15), rgba(168, 85, 247, 0.05))",
            border: "1px solid rgba(168, 85, 247, 0.25)",
            borderRadius: "10px",
            fontSize: "0.75rem"
          }}>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "#ffffff", fontWeight: 700, marginBottom: "0.3rem" }}>
              <Zap size={12} style={{ color: "#a855f7" }} />
              <span>Ad Bid Insight</span>
            </div>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.3, margin: 0 }}>
              Vendors bidding Rs. 50 more right now are capturing 3.2x more impressions in Lahore.
            </p>
            <button
              onClick={() => { window.location.href = "/vendor/ads?boost=true"; }}
              style={{
                width: "100%",
                background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "0.3rem 0.5rem",
                fontSize: "0.7rem",
                fontWeight: 700,
                marginTop: "0.5rem",
                cursor: "pointer"
              }}
            >
              Boost Bid Now
            </button>
          </div>

          {/* Shift control panel */}
          {userRole === "storeAdmin" && (
            <div style={{
              padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--border-subtle)", 
              background: "rgba(168,85,247,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
              <div>
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Handover Shift</span>
                <p style={{ fontSize: "0.8rem", fontWeight: 800, color: "#a855f7" }}>{user?.shift?.toUpperCase() || "ACTIVE"}</p>
              </div>
              <button 
                onClick={handleEndShiftClick}
                disabled={fetchingSummary}
                style={{
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: "8px", padding: "0.3rem 0.6rem", fontSize: "0.7rem", color: "#ef4444",
                  fontWeight: 700, cursor: fetchingSummary ? "not-allowed" : "pointer", transition: "all 0.2s",
                  opacity: fetchingSummary ? 0.6 : 1
                }}
                onMouseEnter={e => { if (!fetchingSummary) e.currentTarget.style.background = "rgba(239,68,68,0.2)"; }}
                onMouseLeave={e => { if (!fetchingSummary) e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
              >
                {fetchingSummary ? "Summarizing..." : "End Shift"}
              </button>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {chats.map(chat => (
              <div key={chat.id} id={`chat-${chat.id}`}
                onClick={() => setActiveChat(chat.id)}
                style={{
                  padding: "1rem 1.25rem", cursor: "pointer", transition: "background 0.15s",
                  background: activeChat === chat.id ? "rgba(124,58,237,0.08)" : "transparent",
                  borderLeft: activeChat === chat.id ? "3px solid #7c3aed" : "3px solid transparent",
                }}>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg, #7c3aed, #a855f7)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "0.9rem", fontWeight: 700 }}>
                    {chat.name?.charAt(0) || "U"}
                  </div>
                  <div style={{ overflow: "hidden", flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <p style={{ fontWeight: 600, fontSize: "0.875rem" }}>{chat.name}</p>
                      {chat.status === "unassigned" ? (
                        <span style={{ fontSize: "0.6rem", background: "rgba(245,158,11,0.15)", color: "#f59e0b", padding: "0.1rem 0.3rem", borderRadius: "4px", fontWeight: 700 }}>Queue</span>
                      ) : (
                        <span style={{ fontSize: "0.6rem", background: "rgba(16,185,129,0.15)", color: "#10b981", padding: "0.1rem 0.3rem", borderRadius: "4px", fontWeight: 700 }}>Active</span>
                      )}
                    </div>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "0.2rem" }}>
                      {chat.assignedTo === user?._id ? "Assigned to you" : (chat.assignedName ? `Claimed by ${chat.assignedName}` : "Unclaimed chat")}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat window */}
        {activeChat ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-primary)" }}>
            
            {/* Chat header */}
            <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-card)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #7c3aed, #a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", fontWeight: 700 }}>
                  {currentChatObj?.name?.charAt(0) || "U"}
                </div>
                <div>
                  <p style={{ fontWeight: 700 }}>{currentChatObj?.name}</p>
                  <p style={{ fontSize: "0.75rem", color: currentChatObj?.status === "unassigned" ? "#f59e0b" : "#10b981" }}>
                    {currentChatObj?.status === "unassigned" ? "● Waiting for assignment" : "● Claimed Thread"}
                  </p>
                </div>
              </div>

              {/* Assignment controls */}
              {currentChatObj?.status === "unassigned" && (
                <button 
                  onClick={() => handleClaimChat(currentChatObj.id)}
                  className="btn-primary"
                  style={{ display: "flex", gap: "0.3rem", alignItems: "center", fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
                >
                  <UserCheck size={14} /> Claim Conversation
                </button>
              )}
            </div>

            {/* Dynamic Product Context Anchor Card */}
            {(() => {
              const lastProduct = [...messages].reverse().find(m => m.attachments?.hasProductSnippet)?.attachments?.productData;
              if (!lastProduct) return null;
              return (
                <div style={{
                  padding: "0.75rem 1.5rem",
                  background: "rgba(255, 255, 255, 0.02)",
                  borderBottom: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                    <img
                      src={getImageUrl(lastProduct.thumbnailUrl) || undefined}
                      alt={lastProduct.name}
                      style={{ width: "40px", height: "40px", borderRadius: "6px", objectFit: "cover", background: "rgba(0,0,0,0.2)", flexShrink: 0 }}
                      onError={(e) => {
                        e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='%23a855f7' stroke-width='2'><rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/></svg>";
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#ffffff", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {lastProduct.name}
                      </p>
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.15rem 0 0 0" }}>
                        Original Price: <strong style={{ color: "#ffffff" }}>Rs. {lastProduct.price}</strong>
                      </p>
                    </div>
                  </div>
                  {recommendedFloor !== null && (
                    <div style={{
                      background: "rgba(168, 85, 247, 0.1)",
                      border: "1px solid rgba(168, 85, 247, 0.25)",
                      borderRadius: "8px",
                      padding: "0.35rem 0.75rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      fontSize: "0.75rem",
                      color: "#ffffff",
                      flexShrink: 0
                    }}>
                      <Sparkles size={12} style={{ color: "#a855f7" }} />
                      <span>Acceptance Floor: <strong style={{ color: "#a855f7" }}>Rs. {recommendedFloor.toFixed(2)}</strong></span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Error notifications */}
            {chatError && (
              <div style={{ background: "rgba(239,68,68,0.1)", borderBottom: "1px solid rgba(239,68,68,0.2)", padding: "0.75rem 1.5rem", fontSize: "0.8rem", color: "#ef4444", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <AlertCircle size={14} /> {chatError}
                <button onClick={() => setChatError("")} style={{ marginLeft: "auto", background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}><X size={14} /></button>
              </div>
            )}

            {/* Messages list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              {messages.map(msg => {
                const isSystem = msg.meta?.senderRole === "System";
                const isMe = msg.meta?.senderRole === "Vendor" || msg.meta?.senderRole === "StoreAdmin";
                
                if (isSystem) {
                  return (
                    <div key={msg._id} style={{ display: "flex", justifyContent: "center", margin: "0.5rem 0" }}>
                      <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "8px", padding: "0.4rem 1rem", fontSize: "0.75rem", color: "#f59e0b", display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        <Sparkles size={12} /> {msg.content?.messageText}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg._id} style={{ display: "flex", flexDirection: isMe ? "row-reverse" : "row", gap: "0.65rem", alignItems: "flex-end" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: isMe ? "linear-gradient(135deg, #7c3aed, #a855f7)" : "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700, flexShrink: 0 }}>
                      {isMe ? user?.name?.charAt(0) : currentChatObj?.name?.charAt(0)}
                    </div>
                    <div style={{ maxWidth: "65%" }}>
                      
                      {/* Main Message Bubble */}
                      <div style={{
                        background: isMe ? "linear-gradient(135deg, #7c3aed, #a855f7)" : "var(--bg-card)",
                        border: isMe ? "none" : "1px solid var(--border-subtle)",
                        borderRadius: 14, padding: "0.65rem 1rem",
                      }}>
                        <p style={{ fontSize: "0.875rem", lineHeight: 1.5 }}>
                          {msg.content?.messageText || "Message empty"}
                        </p>

                        {/* High-Fidelity Bluetooth Headphones Offer Card */}
                        {msg.isCardSnippet && (
                          <div style={{
                            marginTop: "0.5rem",
                            padding: "0.8rem",
                            background: "rgba(18, 18, 26, 0.95)",
                            border: "1px solid #7c3aed",
                            borderRadius: "12px",
                            boxShadow: "0 4px 15px rgba(124, 58, 237, 0.2)",
                            display: "flex",
                            gap: "0.75rem",
                            alignItems: "center",
                            minWidth: "220px",
                            color: "#ffffff"
                          }}>
                            <div style={{ width: "45px", height: "45px", borderRadius: "8px", overflow: "hidden", background: "rgba(255,255,255,0.05)", flexShrink: 0 }}>
                              <img 
                                src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='45' height='45' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2'><path d='M3 18v-6a9 9 0 0 1 18 0v6'/><path d='M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z'/></svg>"
                                alt="Bluetooth Headphones" 
                                style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                Bluetooth Headphones
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.1rem" }}>
                                <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", textDecoration: "line-through" }}>
                                  Rs. {msg.originalPrice || "199.98"}
                                </span>
                                <span style={{ fontSize: "0.75rem", color: "#10b981", fontWeight: 800 }}>
                                  Rs. {msg.proposedPrice || msg.priceOffer || "170.00"}
                                </span>
                              </div>
                              <div style={{ fontSize: "0.65rem", color: "#f59e0b", fontWeight: 600, marginTop: "0.2rem" }}>
                                Status: {msg.offerStatus === "pending" ? "Pending Response" : msg.offerStatus === "accepted" ? "Accepted" : "Rejected"}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Interactive Product Card attachment snippet */}
                        {msg.attachments?.hasProductSnippet && msg.attachments.productData && !msg.isCardSnippet && (
                          <div 
                            onClick={() => {
                              if (msg.attachments.productData.productId) {
                                window.open(`/shop/${user?.storeSlug || "shop"}/product/${msg.attachments.productData.productId}`, "_blank");
                              }
                            }}
                            style={{
                              background: "rgba(255, 255, 255, 0.08)",
                              border: "1px solid rgba(255, 255, 255, 0.12)",
                              borderRadius: "10px",
                              padding: "0.6rem",
                              marginTop: "0.5rem",
                              cursor: "pointer",
                              display: "flex",
                              gap: "0.65rem",
                              alignItems: "center",
                              transition: "all 0.2s",
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                              e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.4)";
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.12)";
                            }}
                          >
                            <img 
                              src={getImageUrl(msg.attachments.productData.thumbnailUrl) || undefined} 
                              alt={msg.attachments.productData.name} 
                              style={{
                                width: "40px",
                                height: "40px",
                                borderRadius: "6px",
                                objectFit: "cover",
                                background: "rgba(0,0,0,0.2)"
                              }}
                              onError={(e) => {
                                e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='%23a855f7' stroke-width='2'><rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/></svg>";
                              }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: "0.78rem", fontWeight: 700, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {msg.attachments.productData.name ? msg.attachments.productData.name.replace(/\w\S*/g, (txt: string) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()) : ""}
                              </p>
                              <p style={{ fontSize: "0.72rem", fontWeight: 800, color: "#a855f7", marginTop: "0.05rem" }}>
                                Rs. {msg.attachments.productData.price}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", textAlign: isMe ? "right" : "left", marginTop: "0.25rem" }}>
                        {formatTime(msg.meta?.timestamp)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input & Catalog search area */}
            <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-secondary)" }}>
              {showOfferInput && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  {recommendedFloor !== null && (
                    <div style={{
                      fontSize: "0.75rem",
                      background: "rgba(124, 58, 237, 0.1)",
                      border: "1px solid rgba(124, 58, 237, 0.2)",
                      borderRadius: "8px",
                      padding: "0.5rem 0.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      color: "#ffffff"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <Sparkles size={14} style={{ color: "#a855f7" }} />
                        <span>AI Recommended Acceptance Floor: <strong style={{ color: "#a855f7" }}>Rs. {recommendedFloor.toFixed(2)}</strong></span>
                      </div>
                      <button
                        onClick={() => setOfferAmount(recommendedFloor.toString())}
                        style={{
                          background: "#7c3aed",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "4px",
                          padding: "0.2rem 0.5rem",
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          cursor: "pointer"
                        }}
                      >
                        Use Price
                      </button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <DollarSign size={14} style={{ color: "#f59e0b" }} />
                    <input id="offer-amount-input" className="input-field" type="number" min="0" step="0.01" placeholder="Counter-offer amount..."
                      style={{ flex: 1 }} value={offerAmount} onChange={e => setOfferAmount(e.target.value)} />
                    <button id="send-offer-btn" onClick={() => offerAmount && sendMessage(parseFloat(offerAmount))} className="btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }}>
                      Send Offer
                    </button>
                    <button onClick={() => setShowOfferInput(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={16} /></button>
                  </div>
                </div>
              )}

              {/* Chat action controls */}
              {isAssignedToMe ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button id="propose-price-btn" onClick={() => setShowOfferInput(!showOfferInput)}
                      style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "0 1rem", cursor: "pointer", color: "#f59e0b", fontWeight: 600, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                      <DollarSign size={14} /> Offer
                    </button>
                    <input id="chat-message-input" className="input-field" placeholder="Type a message..." value={text} onChange={e => setText(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendMessage())} />
                    <button id="send-message-btn" onClick={() => sendMessage()} className="btn-primary" style={{ padding: "0.5rem 1rem", flexShrink: 0 }}>
                      <Send size={16} />
                    </button>
                  </div>

                  {/* Inline product catalog search snippet integration */}
                  <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 700, flexShrink: 0 }}>Product Catalog:</span>
                      <input 
                        className="input-field" 
                        style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem", flex: 1 }} 
                        placeholder="Search items by name to inject visual card snippet..." 
                        value={searchQuery}
                        onChange={e => handleSearchCatalog(e.target.value)}
                      />
                      {searchQuery && (
                        <button onClick={() => { setSearchQuery(""); setSearchResults([]); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    
                    {searchResults.length > 0 && (
                      <div style={{
                        background: "var(--bg-card)", border: "1px solid var(--border-subtle)",
                        borderRadius: "8px", maxHeight: "150px", overflowY: "auto", display: "flex", flexDirection: "column",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 10
                      }}>
                        {searchResults.map((prod: any) => (
                          <div 
                            key={prod._id}
                            onClick={() => sendProductSnippet(prod)}
                            style={{
                              padding: "0.5rem 0.75rem", cursor: "pointer", display: "flex", justifyContent: "space-between",
                              alignItems: "center", borderBottom: "1px solid var(--border-subtle)", fontSize: "0.8rem", transition: "background 0.2s"
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(124,58,237,0.08)"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                              <img src={getImageUrl(prod.images?.[0]?.url || prod.images?.[0]) || undefined} style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "4px" }} onError={e => e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'></svg>"} />
                              <span>{prod.title}</span>
                            </div>
                            <span style={{ marginLeft: "auto", fontWeight: 700, color: "#a855f7" }}>Rs. {prod.price}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: "1rem", textAlign: "center", background: "rgba(245,158,11,0.05)",
                  border: "1px dashed rgba(245,158,11,0.2)", borderRadius: "10px", color: "#f59e0b", fontSize: "0.85rem"
                }}>
                  ⚠️ This conversation is unassigned or claimed by another operator. Claim it above to participate.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "1rem", color: "var(--text-muted)" }}>
            <MessageCircle size={48} style={{ opacity: 0.3 }} />
            <p style={{ fontWeight: 600 }}>Select a conversation to start</p>
            <p style={{ fontSize: "0.85rem" }}>Real-time negotiations powered by Socket.io</p>
          </div>
        )}
      </main>

      {/* Shift-End Analytics Report Modal */}
      {showShiftModal && shiftSummary && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: "1.5rem" }}>
          <div className="glass-card animate-fade-up" style={{ padding: "2rem", maxWidth: "600px", width: "95%", maxHeight: "90vh", overflowY: "auto" }}>
            
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <div>
                <h3 style={{ fontWeight: 900, fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Sparkles size={20} style={{ color: "#a855f7" }} /> Shift-End Analytics Report
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginTop: "0.25rem" }}>
                  Performance metrics aggregated for the active 12-hour work shift.
                </p>
              </div>
              <button 
                onClick={() => setShowShiftModal(false)} 
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0.25rem" }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Grid Layout: Left: Recharts graph, Right: Latency & Badges */}
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
              
              {/* Recharts Grid */}
              <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "1rem" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase" }}>
                  Fulfillment & Revenue Splits
                </span>
                
                <div style={{ height: 160, width: "100%", marginTop: "0.75rem" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: "Gross", value: shiftSummary.totalRevenue, fill: "#7c3aed" },
                      { name: "Net Payout", value: shiftSummary.netEarnings, fill: "#10b981" },
                      { name: "Plat. Fee", value: shiftSummary.platformCommission, fill: "#ef4444" }
                    ]} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                      <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#151521", border: "1px solid var(--border-subtle)", borderRadius: 8 }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {[
                          <Cell key="cell-0" fill="#7c3aed" />,
                          <Cell key="cell-1" fill="#10b981" />,
                          <Cell key="cell-2" fill="#ef4444" />
                        ]}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Engagement & Badges */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                
                {/* Revenue metrics badges */}
                <div style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: "12px", padding: "0.85rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", textTransform: "uppercase", display: "block" }}>Orders Processed</span>
                    <strong style={{ fontSize: "1.1rem", color: "#a855f7" }}>{shiftSummary.totalOrders} Orders</strong>
                  </div>
                  <div style={{ background: "rgba(124,58,237,0.12)", color: "#a855f7", borderRadius: "8px", padding: "0.3rem 0.5rem", fontSize: "0.72rem", fontWeight: 800 }}>
                    Rs. {shiftSummary.totalRevenue}
                  </div>
                </div>

                {/* Latency Gauge Indicator */}
                <div style={{ 
                  background: shiftSummary.averageLatencySeconds < 60 ? "rgba(16,185,129,0.05)" : shiftSummary.averageLatencySeconds < 120 ? "rgba(245,158,11,0.05)" : "rgba(239,68,68,0.05)", 
                  border: shiftSummary.averageLatencySeconds < 60 ? "1px solid rgba(16,185,129,0.2)" : shiftSummary.averageLatencySeconds < 120 ? "1px solid rgba(245,158,11,0.2)" : "1px solid rgba(239,68,68,0.2)", 
                  borderRadius: "12px", 
                  padding: "0.85rem" 
                }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", textTransform: "uppercase", display: "block" }}>WebSocket Chat Latency</span>
                  <strong style={{ 
                    fontSize: "1.1rem", 
                    color: shiftSummary.averageLatencySeconds < 60 ? "#10b981" : shiftSummary.averageLatencySeconds < 120 ? "#f59e0b" : "#ef4444",
                    display: "block",
                    marginTop: "0.2rem"
                  }}>
                    {shiftSummary.averageLatencySeconds} seconds
                  </strong>
                  <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.15rem", display: "block" }}>
                    {shiftSummary.averageLatencySeconds < 60 ? "Excellent response speed" : shiftSummary.averageLatencySeconds < 120 ? "Average response speed" : "Delayed responses detected"}
                  </span>
                </div>
              </div>

            </div>

            {/* Coupon log */}
            <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "1.2rem", marginBottom: "1.5rem" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: "0.75rem" }}>
                Marketing & Promotions Log
              </span>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    <th style={{ paddingBottom: "0.4rem" }}>Coupon Code</th>
                    <th style={{ paddingBottom: "0.4rem" }}>Redemptions</th>
                    <th style={{ paddingBottom: "0.4rem", textAlign: "right" }}>Discount Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {shiftSummary.couponsRedeemed?.map((cp: any) => (
                    <tr key={cp.code} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: "0.4rem 0", fontWeight: 700, color: "#a855f7" }}>{cp.code}</td>
                      <td style={{ padding: "0.4rem 0" }}>{cp.count} uses</td>
                      <td style={{ padding: "0.4rem 0", textAlign: "right", fontWeight: 700 }}>Rs. {cp.totalDiscount}</td>
                    </tr>
                  ))}
                  {(!shiftSummary.couponsRedeemed || shiftSummary.couponsRedeemed.length === 0) && (
                    <tr>
                      <td colSpan={3} style={{ padding: "1rem 0", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                        No promo codes redeemed during this shift.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Confirm end shift and close out */}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button onClick={() => setShowShiftModal(false)} className="btn-secondary" style={{ flex: 1, justifyContent: "center" }}>
                Back to Workspace
              </button>
              <button 
                onClick={confirmEndShift} 
                className="btn-primary" 
                style={{ flex: 1, justifyContent: "center", background: "#ef4444", border: "1px solid #ef4444", color: "#ffffff" }}
              >
                Confirm Handover & Log Off
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import React, { useState, useEffect, useRef } from "react";
import Navbar from "@/components/Navbar";
import { useCart } from "@/context/CartContext";
import { getImageUrl } from "@/utils/imageUrl";
import { io, Socket } from "socket.io-client";
import { 
  MessageSquare, Send, Store, Loader, Check, 
  ShoppingBag, DollarSign, AlertCircle, Sparkles, CheckCircle, X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function ShopperNegotiationPage() {
  const router = useRouter();
  const { addToCart, setIsCartOpen } = useCart();
  const [user, setUser] = useState<any>(null);
  
  // Chats list states
  const [chats, setChats] = useState<any[]>([]);
  const [activeChat, setActiveChat] = useState<any | null>(null);
  const [loadingChats, setLoadingChats] = useState(true);
  
  // Message feed states
  const [messages, setMessages] = useState<any[]>([]);
  const [chatText, setChatText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Parse user info on mount
  useEffect(() => {
    const stored = localStorage.getItem("bazaar_user");
    const token = localStorage.getItem("bazaar_token");
    if (!stored || !token) {
      router.push("/auth/login");
      return;
    }
    setUser(JSON.parse(stored));
  }, []);

  // Fetch active shopper conversations list
  useEffect(() => {
    if (!user) return;
    
    const fetchChatsList = async () => {
      setLoadingChats(true);
      const token = localStorage.getItem("bazaar_token");
      try {
        const res = await fetch(`${API}/api/negotiation/chats`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
          setChats(data.chats || []);
          // Automatically pick first chat if any exist
          if (data.chats?.length > 0) {
            setActiveChat(data.chats[0]);
          }
        }
      } catch (err) {
        console.error("Failed to load shopper chat list:", err);
      } finally {
        setLoadingChats(false);
      }
    };
    
    fetchChatsList();
  }, [user]);

  // Standardize backend message schema to client format
  const standardizeMessage = (msg: any) => {
    if (msg.meta && msg.content) return msg;
    const hasProduct = !!msg.productId;
    const isMe = msg.senderId?._id === user?.id || msg.senderId?._id === user?._id || msg.senderId === user?.id;
    return {
      _id: msg._id,
      meta: {
        roomId: `room:${msg.storeId || activeChat?.storeId || "mock"}_${user?.id}`,
        timestamp: msg.createdAt || msg.timestamp || new Date().toISOString(),
        senderRole: msg.isSystem ? "System" : (isMe ? "Customer" : "Vendor")
      },
      content: {
        messageText: msg.text || "",
        mediaUrl: msg.mediaUrl || null
      },
      priceOffer: msg.priceOffer || null,
      offerStatus: msg.offerStatus || 'none',
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

  // Connect socket and fetch history for selected active chat
  useEffect(() => {
    if (!activeChat || !user) return;

    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    // Disconnect old socket
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    setLoadingMessages(true);

    // 1. Fetch message history
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API}/api/negotiation/chat/${activeChat.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.messages) {
          setMessages(data.messages.map((m: any) => standardizeMessage(m)));
        }
      } catch (err) {
        console.error("Failed to load chat history:", err);
      } finally {
        setLoadingMessages(false);
      }
    };

    fetchHistory();

    // 2. Connect to Socket.IO Namespace
    const socket = io(API, {
      auth: { token },
      transports: ["websocket"]
    });
    socketRef.current = socket;

    const roomId = `room:${activeChat.storeId}_${user.id}`;
    socket.on("connect", () => {
      socket.emit("join_room", { roomId });
      console.log(`[Shopper Chat] Joined room ${roomId}`);
    });

    socket.on("receive_message", (newMsg: any) => {
      setMessages(prev => {
        if (prev.some(m => m._id === newMsg._id)) return prev;
        return [...prev, standardizeMessage(newMsg)];
      });
    });

    socket.on("offer_status_update", (updatedOffer: any) => {
      setMessages(prev => prev.map(m => {
        if (m._id === updatedOffer.messageId) {
          return { ...m, offerStatus: updatedOffer.status };
        }
        return m;
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, [activeChat, user]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim() || !activeChat || !user) return;

    setSending(true);
    const roomId = `room:${activeChat.storeId}_${user.id}`;
    const payload = {
      meta: {
        roomId,
        timestamp: new Date().toISOString(),
        senderRole: "Customer"
      },
      content: {
        messageText: chatText,
        mediaUrl: null
      },
      attachments: {
        hasProductSnippet: false,
        productData: null
      }
    };

    if (socketRef.current?.connected) {
      socketRef.current.emit("send_message", payload);
    } else {
      // Mock fallback
      const mockMsg = {
        _id: Date.now().toString(),
        meta: { roomId, timestamp: new Date().toISOString(), senderRole: "Customer" },
        content: { messageText: chatText, mediaUrl: null },
        attachments: { hasProductSnippet: false, productData: null }
      };
      setMessages(prev => [...prev, mockMsg]);
    }
    setChatText("");
    setSending(false);
  };

  // Respond to price offer (Accept/Reject)
  const handleRespondToOffer = async (messageId: string, action: 'accepted' | 'rejected') => {
    const token = localStorage.getItem("bazaar_token");
    try {
      const res = await fetch(`${API}/api/negotiation/offer/${messageId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => prev.map(m => {
          if (m._id === messageId) {
            return { ...m, offerStatus: action };
          }
          return m;
        }));

        if (socketRef.current) {
          // Notify the room
          socketRef.current.emit("send_message", {
            meta: {
              roomId: `room:${activeChat.storeId}_${user.id}`,
              timestamp: new Date().toISOString(),
              senderRole: "Customer"
            },
            content: {
              messageText: `I have ${action} the price offer of Rs. ${data.negotiatedMessage.priceOffer}.`,
              mediaUrl: null
            },
            attachments: {
              hasProductSnippet: false,
              productData: null
            }
          });
        }
      }
    } catch (err) {
      console.error("Failed to respond to offer:", err);
    }
  };

  return (
    <div style={{ background: "var(--bg-main)", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar />
      
      {/* Spacer for fixed Navbar */}
      <div style={{ height: "64px" }} />

      <main style={{ flex: 1, maxWidth: "1200px", width: "100%", margin: "1.5rem auto", display: "flex", gap: "1.5rem", padding: "0 1rem", height: "calc(100vh - 112px)" }}>
        
        {/* Left Column: Stores list */}
        <section style={{ width: "320px", background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "16px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "1.2rem", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
            <h3 className="sidebar-heading" style={{ color: "#111827", fontWeight: 700, fontSize: "1.125rem" }}>Store Chats</h3>
            <p className="sidebar-subtitle" style={{ color: "#6B7280", fontWeight: 400, fontSize: "0.875rem", marginTop: "0.2rem" }}>Direct price negotiations</p>
          </div>

          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {loadingChats ? (
              <div style={{ padding: "3rem", textAlign: "center" }}>
                <Loader size={24} style={{ animation: "spin 1s linear infinite", color: "#7c3aed", margin: "0 auto" }} />
              </div>
            ) : chats.length === 0 ? (
              <div style={{ padding: "3rem 1.5rem", textAlign: "center", color: "var(--text-muted)" }}>
                <MessageSquare size={36} style={{ opacity: 0.25, margin: "0 auto 0.75rem" }} />
                <p style={{ fontSize: "0.82rem" }}>No store chats found. Message a store storefront to start price haggling!</p>
              </div>
            ) : (
              chats.map(c => {
                const isActive = activeChat?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveChat(c)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      padding: "1rem 1.2rem",
                      background: isActive ? "rgba(124,58,237,0.05)" : "none",
                      border: "none",
                      borderBottom: "1px solid rgba(0,0,0,0.04)",
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                      transition: "background 0.2s"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <span style={{ fontWeight: 800, fontSize: "0.85rem", color: isActive ? "#7c3aed" : "inherit" }}>
                        {c.storeName || "Merchant Store"}
                      </span>
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                      {c.lastMessage}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Chat thread details */}
        <section style={{ flex: 1, background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "16px", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          
          {!activeChat ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", padding: "2rem" }}>
              <Sparkles size={48} style={{ opacity: 0.15, marginBottom: "1rem", color: "#7c3aed" }} />
              <h4 style={{ fontWeight: 800, fontSize: "1rem" }}>Select a Store Chat</h4>
              <p style={{ fontSize: "0.82rem", marginTop: "0.25rem" }}>Haggle deals and review custom product listings directly with vendors.</p>
            </div>
          ) : (
            <>
              {/* Active Header */}
              <div style={{ padding: "1.2rem 1.5rem", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafafa" }}>
                <div>
                  <h4 style={{ fontWeight: 800, fontSize: "1rem", color: "#7c3aed" }}>{activeChat.storeName}</h4>
                  <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Haggling with: {activeChat.name}</p>
                </div>
                <Link href={`/shop/${activeChat.storeSlug}`} style={{ fontSize: "0.8rem", color: "#7c3aed", fontWeight: 700, textDecoration: "none" }}>
                  Visit Storefront
                </Link>
              </div>

              {/* Message Feed */}
              <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem", background: "#fcfcfc" }}>
                {loadingMessages ? (
                  <div style={{ padding: "4rem", textAlign: "center" }}>
                    <Loader size={28} style={{ animation: "spin 1s linear infinite", color: "#7c3aed", margin: "0 auto" }} />
                  </div>
                ) : messages.length === 0 ? (
                  <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    No messages in this chat yet. Send a query to begin.
                  </div>
                ) : (
                  messages.map(msg => {
                    const isSystem = msg.meta?.senderRole === "System";
                    const isCustomer = msg.meta?.senderRole === "Customer";
                    
                    if (isSystem) {
                      return (
                        <div key={msg._id} style={{ display: "flex", justifyContent: "center", margin: "0.5rem 0" }}>
                          <span style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "8px", padding: "0.3rem 0.8rem", fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                            ⚙️ {msg.content.messageText}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div key={msg._id} style={{ display: "flex", flexDirection: isCustomer ? "row-reverse" : "row", gap: "0.5rem", alignItems: "flex-end" }}>
                        <div style={{
                          background: isCustomer ? "#7c3aed" : "#f1f1f1",
                          color: isCustomer ? "#ffffff" : "#1a1a1a",
                          borderRadius: "12px",
                          padding: "0.6rem 0.85rem",
                          maxWidth: "60%",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
                        }}>
                          <p style={{ fontSize: "0.85rem", lineHeight: 1.4, wordBreak: "break-word" }}>
                            {msg.content.messageText}
                          </p>

                          {/* Custom Price Offers */}
                          {msg.priceOffer && (
                            <div style={{ 
                              background: isCustomer ? "rgba(0,0,0,0.15)" : "rgba(124,58,237,0.06)", 
                              borderRadius: "8px", 
                              padding: "0.6rem", 
                              marginTop: "0.5rem",
                              border: isCustomer ? "none" : "1px solid rgba(124,58,237,0.15)",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.4rem"
                            }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", color: isCustomer ? "#ffffff" : "#7c3aed" }}>
                                <DollarSign size={14} />
                                <span style={{ fontSize: "0.78rem", fontWeight: 800 }}>Custom Negotiation Offer</span>
                              </div>
                              <p style={{ fontSize: "0.85rem", fontWeight: 900 }}>
                                Offered Price: Rs. {msg.priceOffer.toLocaleString()}
                              </p>
                              
                              {/* Respond UI */}
                              {msg.offerStatus === 'pending' ? (
                                !isCustomer ? (
                                  <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.2rem" }}>
                                    <button
                                      onClick={() => handleRespondToOffer(msg._id, 'accepted')}
                                      style={{ background: "#10b981", color: "#ffffff", border: "none", borderRadius: "4px", padding: "0.25rem 0.6rem", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer" }}
                                    >
                                      Accept Offer
                                    </button>
                                    <button
                                      onClick={() => handleRespondToOffer(msg._id, 'rejected')}
                                      style={{ background: "#ef4444", color: "#ffffff", border: "none", borderRadius: "4px", padding: "0.25rem 0.6rem", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer" }}
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ fontSize: "0.68rem", opacity: 0.8, fontStyle: "italic" }}>
                                    Waiting for vendor to respond...
                                  </span>
                                )
                              ) : (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.7rem", fontWeight: 800, color: msg.offerStatus === 'accepted' ? '#10b981' : '#ef4444', marginTop: "0.2rem" }}>
                                  {msg.offerStatus === 'accepted' ? (
                                    <>✓ Offer Accepted</>
                                  ) : (
                                    <>✗ Offer Rejected</>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Product Card Attachments */}
                          {msg.attachments?.hasProductSnippet && msg.attachments.productData && (
                            <div 
                              onClick={(e) => {
                                if ((e.target as HTMLElement).closest('button')) return;
                                router.push(`/shop/${activeChat.storeSlug}/product/${msg.attachments.productData.productId}`);
                              }}
                              style={{ 
                                background: isCustomer ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.8)", 
                                borderRadius: "8px", 
                                padding: "0.6rem", 
                                marginTop: "0.5rem",
                                display: "flex",
                                gap: "0.6rem",
                                alignItems: "center",
                                cursor: "pointer",
                                border: isCustomer ? "none" : "1px solid rgba(0,0,0,0.06)",
                                transition: "all 0.2s ease"
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.background = isCustomer ? "rgba(0,0,0,0.18)" : "#f6f6f6";
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.background = isCustomer ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.8)";
                              }}
                            >
                              {/* Image Thumbnail */}
                              <div style={{ width: "38px", height: "38px", borderRadius: "6px", overflow: "hidden", background: "rgba(255,255,255,0.2)", flexShrink: 0 }}>
                                {msg.attachments.productData.thumbnailUrl ? (
                                  <img 
                                    src={getImageUrl(msg.attachments.productData.thumbnailUrl)} 
                                    alt={msg.attachments.productData.name} 
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                                  />
                                ) : (
                                  <div style={{ width: "100%", height: "100%", background: "rgba(0,0,0,0.05)" }} />
                                )}
                              </div>

                              {/* Product Details & Add to Cart button */}
                              <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
                                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: isCustomer ? "#ffffff" : "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {msg.attachments.productData.name ? msg.attachments.productData.name.replace(/\w\S*/g, (txt: string) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()) : ""}
                                </span>
                                <span style={{ fontSize: "0.68rem", fontWeight: 800, color: isCustomer ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.7)", marginTop: "0.1rem" }}>
                                  Rs. {msg.attachments.productData.price.toLocaleString()}
                                </span>

                                <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.3rem", alignItems: "center" }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      addToCart(msg.attachments.productData.productId, {
                                        title: msg.attachments.productData.name,
                                        price: msg.attachments.productData.price,
                                        image: msg.attachments.productData.thumbnailUrl || "",
                                        storeId: activeChat.storeId,
                                        storeName: activeChat.storeName,
                                        storeSlug: activeChat.storeSlug
                                      });
                                      setIsCartOpen(true);
                                    }}
                                    style={{
                                      background: isCustomer ? "#ffffff" : "#7c3aed",
                                      color: isCustomer ? "#000000" : "#ffffff",
                                      border: "none",
                                      borderRadius: "6px",
                                      padding: "0.3rem 0.6rem",
                                      fontSize: "0.68rem",
                                      fontWeight: 800,
                                      cursor: "pointer",
                                      boxShadow: "0 1px 3px rgba(0,0,0,0.15)"
                                    }}
                                  >
                                    + Add to Cart
                                  </button>
                                  
                                  <span style={{ fontSize: "0.68rem", color: isCustomer ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.5)", fontWeight: 700, textDecoration: "underline" }}>
                                    View
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Bar */}
              <form onSubmit={handleSendMessage} style={{ padding: "1rem 1.5rem", borderTop: "1px solid rgba(0,0,0,0.06)", background: "#fafafa", display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <input 
                  type="text" 
                  placeholder="Type a message or haggle offer..." 
                  value={chatText} 
                  onChange={e => setChatText(e.target.value)}
                  style={{
                    flex: 1,
                    background: "#ffffff",
                    border: "1px solid rgba(0,0,0,0.12)",
                    borderRadius: "10px",
                    padding: "0.6rem 1rem",
                    fontSize: "0.85rem",
                    outline: "none",
                    color: "#1a1a1a"
                  }}
                  disabled={sending}
                />
                <button 
                  type="submit" 
                  style={{ 
                    background: "#7c3aed", 
                    border: "none", 
                    borderRadius: "10px", 
                    width: "40px", 
                    height: "40px", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center", 
                    cursor: "pointer", 
                    color: "#ffffff",
                    boxShadow: "0 2px 8px rgba(124,58,237,0.25)" 
                  }}
                  disabled={sending}
                >
                  <Send size={16} />
                </button>
              </form>
            </>
          )}

        </section>

      </main>
    </div>
  );
}

"use client";
import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader, MessageCircle, X, Send, CheckCircle, AlertCircle, ShoppingBag } from "lucide-react";
import { io, Socket } from "socket.io-client";
import Link from "next/link";
import { getImageUrl } from "@/utils/imageUrl";
import { useCart } from "@/context/CartContext";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface StoreContextType {
  store: any;
  loading: boolean;
  error: string;
}

const StoreContext = createContext<StoreContextType>({ store: null, loading: true, error: "" });
export const useStore = () => useContext(StoreContext);

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;
  const { addToCart, removeFromCart, setIsCartOpen: setGlobalCartOpen } = useCart();

  const [store, setStore] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Chat Drawer state
  const [isOpen, setIsOpen] = useState(false);
  const [messagesList, setMessagesList] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [user, setUser] = useState<any>(null);
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  
  // Bargaining console state variables
  const [activeProduct, setActiveProduct] = useState<any>(null);
  const [counterPrice, setCounterPrice] = useState<string>("0.00");
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(true);

  // Fetch store details by slug
  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`${API}/api/auth/store/slug/${slug}`)
      .then(res => {
        if (!res.ok) {
          if (res.status === 404) throw new Error("Store Not Found");
          if (res.status === 403) throw new Error("Store is Suspended");
          throw new Error("Failed to load storefront");
        }
        return res.json();
      })
      .then(data => {
        if (data.success && data.store) {
          setStore(data.store);
        } else {
          throw new Error(data.message || "Storefront unavailable");
        }
      })
      .catch(err => {
        setError(err.message || "Could not resolve store path");
      })
      .finally(() => setLoading(false));
  }, [slug]);

  // Load user info for live chat negotiations
  useEffect(() => {
    const stored = localStorage.getItem("bazaar_user");
    if (stored) setUser(JSON.parse(stored));
  }, []);

  // Standardize socket event message
  const standardizeMessage = (msg: any) => {
    const currentUserId = user?.id || user?._id;
    const isMe = msg.senderId === currentUserId || (msg.senderId && (msg.senderId === currentUserId || msg.senderId._id === currentUserId)) || msg.senderId?.role === user?.role;
    
    if (msg.meta && msg.content) {
      return {
        ...msg,
        senderId: msg.senderId || (msg.meta.senderRole === "Customer" ? currentUserId : "vendor"),
        priceOffer: msg.priceOffer ?? msg.proposedPrice ?? null,
        offerStatus: msg.offerStatus ?? "none",
        isCardSnippet: msg.isCardSnippet ?? false,
        originalPrice: msg.originalPrice ?? null,
        proposedPrice: msg.proposedPrice ?? null
      };
    }
    const hasProduct = !!msg.productId;
    return {
      _id: msg._id,
      senderId: msg.senderId || (isMe ? currentUserId : "vendor"),
      priceOffer: msg.priceOffer ?? msg.proposedPrice ?? null,
      offerStatus: msg.offerStatus ?? "none",
      isCardSnippet: msg.isCardSnippet ?? false,
      originalPrice: msg.originalPrice ?? null,
      proposedPrice: msg.proposedPrice ?? null,
      meta: {
        roomId: roomId || `room:${store?._id}_${user?.id}`,
        timestamp: msg.createdAt || msg.timestamp || new Date().toISOString(),
        senderRole: isMe ? "Customer" : "Vendor"
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

  // Connect socket and handle negotiation thread lifecycle when drawer is toggled
  useEffect(() => {
    if (!isOpen || !store || !user) return;
    const token = localStorage.getItem("bazaar_token");
    if (!token) return;

    let socket: any = null;

    // Step 1: Hook Check - Fetch / Resolve Active Thread ID (do not generate a new one)
    const customerId = user.id || user._id;
    const vendorId = store.vendorId;
    const productId = activeProduct?._id || null;

    fetch(`${API}/api/negotiations/resolve-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ customerId, vendorId, productId })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.roomId) {
          const resolvedRoomId = data.roomId;
          setRoomId(resolvedRoomId);
          
          if (data.messages) {
            setMessagesList(data.messages.map((m: any) => standardizeMessage(m)));
          }

          // Step 2: Establish Socket & Step 3: Mount Listeners
          socket = io(API, {
            auth: { token },
            transports: ["websocket"],
            forceNew: true
          });
          socketRef.current = socket;

          const joinRoom = () => {
            setIsSocketConnected(true);
            console.log(`Shopper connected. Joining isolated negotiation room: ${resolvedRoomId}`);
            socket.emit("join_negotiation_room", { roomId: resolvedRoomId, userType: 'CUSTOMER' });
          };

          if (socket.connected) {
            joinRoom();
          }
          socket.on("connect", joinRoom);

          socket.on("disconnect", () => {
            setIsSocketConnected(false);
          });

          socket.on("connect_error", () => {
            setIsSocketConnected(false);
          });

          // Standardize client state hooks to capture incoming payloads cleanly via functional array modifiers
          const handleShopperIncoming = (incomingMsg: any) => {
            const standardized = standardizeMessage(incomingMsg);
            setMessagesList((prev) => {
              if (prev.some(m => m._id === standardized._id)) return prev;
              const filtered = prev.filter(m => !(m._id?.startsWith("temp_") && m.content?.messageText === standardized.content?.messageText));
              return [...filtered, standardized];
            });
          };

          socket.on("receive_negotiation_msg", handleShopperIncoming);
          socket.on("receive_message", handleShopperIncoming);
        }
      })
      .catch(err => console.warn("Failed to resolve chat session:", err));

    // Step 4: Component Teardown cleanup
    return () => {
      if (socketRef.current) {
        socketRef.current.off("receive_negotiation_msg");
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [isOpen, store, user, activeProduct]);

  // Listen for custom negotiation events triggered from child product details pages
  useEffect(() => {
    const handleNegotiateEvent = (e: Event) => {
      const prod = (e as CustomEvent).detail;
      setIsOpen(true); // Open slideout drawer
      setActiveProduct(prod);
      
      const token = localStorage.getItem("bazaar_token");
      const activeStore = store;
      const activeUser = user;
      
      if (!token || !activeStore || !activeUser) return;

      const currentRoomId = roomId || `room:${activeStore._id}_${activeUser.id}`;

      // Emit after small delay to let drawer mount socket
      setTimeout(() => {
        if (socketRef.current?.connected) {
          socketRef.current.emit("send_negotiation_msg", {
            roomId: currentRoomId,
            senderId: activeUser.id || activeUser._id,
            text: `Hi! I want to negotiate a deal for the "${prod.title}".`,
            proposedPrice: null,
            timestamp: new Date()
          });
        }
      }, 800);
    };

    window.addEventListener("negotiate-product", handleNegotiateEvent);
    return () => window.removeEventListener("negotiate-product", handleNegotiateEvent);
  }, [store, user, roomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesList]);

  // Standardized selector for product details context
  const currentProduct = activeProduct ? {
    productId: activeProduct._id || activeProduct.productId || "cricket_bat_default",
    name: activeProduct.title || activeProduct.name || "CRICKET BAT",
    price: activeProduct.price || 199.98,
    thumbnailUrl: activeProduct.images?.[0]?.url || activeProduct.thumbnailUrl || "",
    slug: activeProduct.slug || "cricket-bat"
  } : (
    messagesList.slice().reverse().find(m => m.attachments?.hasProductSnippet)?.attachments?.productData || {
      productId: "cricket_bat_default",
      name: "CRICKET BAT",
      price: 199.98,
      thumbnailUrl: "",
      slug: "cricket-bat"
    }
  );

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!store || !user || !roomId) return;

    const cleanText = inputText.trim();
    const priceVal = parseFloat(counterPrice);
    const hasPrice = !isNaN(priceVal) && priceVal > 0;

    if (!cleanText && !hasPrice) return;

    const currentUserId = user.id || user._id;
    const priceOffer = hasPrice ? priceVal : null;
    const messageText = cleanText || (priceOffer ? `Proposed Counter Price: Rs. ${priceOffer.toFixed(2)}` : "");

    const tempMessage = standardizeMessage({
      _id: `temp_${Date.now()}`,
      roomId,
      senderId: currentUserId,
      text: messageText,
      messageText,
      proposedPrice: priceOffer,
      priceOffer,
      offerStatus: priceOffer ? "pending" : "none",
      meta: {
        roomId,
        timestamp: new Date().toISOString(),
        senderRole: "Customer"
      },
      content: { messageText, mediaUrl: null },
      attachments: {
        hasProductSnippet: !!activeProduct,
        productData: currentProduct
      }
    });

    // Optimistically update local message list
    setMessagesList((prev) => [...prev, tempMessage]);

    if (socketRef.current?.connected) {
      socketRef.current.emit("send_negotiation_msg", {
        roomId,
        senderId: currentUserId,
        text: messageText,
        proposedPrice: priceOffer,
        timestamp: new Date()
      });
    }

    setInputText("");
    setCounterPrice("0.00");
  };

  const handleAcceptOffer = (msg: any) => {
    if (!store || !user || !roomId) return;
    
    if (socketRef.current?.connected) {
      socketRef.current.emit("respond_offer", {
        shopperId: user.id,
        vendorId: store.vendorId,
        messageId: msg._id,
        action: "accepted",
        roomId
      });
    } else {
      // Offline fallback state change
      setMessagesList(prev => prev.map(m => m._id === msg._id ? { ...m, offerStatus: "accepted" } : m));
    }

    // Instantly update the primary cart checkout balance payload in the background
    const productData = msg.attachments?.productData || currentProduct;
    if (productData) {
      removeFromCart(productData.productId);
      addToCart(productData.productId, {
        title: productData.name,
        price: msg.priceOffer || msg.proposedPrice, // Accepted negotiated price
        image: productData.thumbnailUrl || "",
        storeId: store?._id,
        storeName: store?.name,
        storeSlug: slug
      });
      setGlobalCartOpen(true);
    }
  };

  const handleRejectOffer = (msg: any) => {
    if (!store || !user || !roomId) return;
    
    if (socketRef.current?.connected) {
      socketRef.current.emit("respond_offer", {
        shopperId: user.id,
        vendorId: store.vendorId,
        messageId: msg._id,
        action: "rejected",
        roomId
      });
    } else {
      // Offline fallback state change
      setMessagesList(prev => prev.map(m => m._id === msg._id ? { ...m, offerStatus: "rejected" } : m));
    }
  };

  // 404 Exception View
  if (error) {
    return (
      <div className="light-theme" style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f8f9fa", color: "#1a1a1a", padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", maxWidth: "480px", background: "#ffffff", padding: "2.5rem", borderRadius: "16px", border: "1px solid rgba(0,0,0,0.08)" }}>
          <AlertCircle size={48} style={{ color: "#ef4444", marginBottom: "1rem" }} />
          <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "0.5rem" }}>Storefront Offline</h2>
          <p style={{ color: "rgba(0,0,0,0.6)", fontSize: "0.88rem", lineHeight: 1.5, marginBottom: "1.5rem" }}>
            BazaarBoost Alert: This local market storefront ({slug}) does not exist or has been suspended by administration.
          </p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
            <Link href="/" style={{ background: "#7c3aed", color: "#ffffff", padding: "0.6rem 1.2rem", borderRadius: "8px", textDecoration: "none", fontSize: "0.85rem", fontWeight: 700 }}>
              Main Directory
            </Link>
            <Link href="/auth/login" style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)", color: "#1a1a1a", padding: "0.6rem 1.2rem", borderRadius: "8px", textDecoration: "none", fontSize: "0.85rem", fontWeight: 700 }}>
              Vendor Log In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="light-theme" style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f8f9fa", color: "#1a1a1a" }}>
        <div style={{ textAlign: "center" }}>
          <Loader size={32} style={{ animation: "spin 1s linear infinite", color: "#7c3aed", marginBottom: "0.75rem" }} />
          <p style={{ fontSize: "0.85rem", opacity: 0.6 }}>Resolving storefront slug routes...</p>
        </div>
      </div>
    );
  }

  // Inject theme variables onto DOM
  const primaryColor = store?.theme?.primaryColor || "#7c3aed";
  const backgroundColor = store?.theme?.backgroundColor || "#f8f9fa";
  const textColor = store?.theme?.textColor || "#1a1a1a";

  const isDarkColor = (hex?: string) => {
    if (!hex) return false;
    const c = hex.replace("#", "");
    if (c.length !== 6) return false;
    const rgb = parseInt(c, 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = (rgb >> 0) & 0xff;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luma < 128;
  };

  const isBgDark = isDarkColor(backgroundColor);
  const navBg = isBgDark ? "rgba(18, 18, 26, 0.8)" : "rgba(255, 255, 255, 0.8)";
  const navBorder = isBgDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)";

  const RenderEmptyPlaceholder = () => (
    <div style={{ textAlign: "center", padding: "2rem", color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>
      No messages yet. Send a greeting to begin price negotiations.
    </div>
  );

  const RenderActiveTimeline = () => (
    <>
      {messagesList.map(msg => {
        const currentUserId = user?.id || user?._id;
        const isMe = msg.senderId === currentUserId || (msg.meta?.senderRole === "Customer");
        
        const messageText = msg.content?.messageText || msg.text || "";
        const isCard = msg.isCardSnippet ?? false;
        const origPrice = msg.originalPrice || (msg.attachments?.productData?.price) || 199.98;
        const propPrice = msg.proposedPrice || msg.priceOffer || null;
        const status = msg.offerStatus || (propPrice ? "pending" : "none");
        const hasAttachment = msg.attachments?.hasProductSnippet || (propPrice ? true : false);
        const attachmentData = msg.attachments?.productData || (propPrice ? currentProduct : null);

        return (
          <div 
            key={msg._id} 
            className={isMe 
              ? "ml-auto bg-purple-600 text-white rounded-l-xl rounded-tr-xl max-w-[85%] px-4 py-2.5 shadow-md" 
              : "mr-auto bg-[#111119] border border-slate-800 text-slate-200 rounded-r-xl rounded-tl-xl max-w-[85%] px-4 py-2.5"
            }
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.3rem",
              alignSelf: isMe ? "flex-end" : "flex-start",
              textAlign: "left",
              color: isMe ? "#ffffff" : "#cbd5e1"
            }}
          >
            <p style={{ fontSize: "0.82rem", lineHeight: 1.4 }}>{messageText}</p>

            {/* High-Fidelity Bluetooth Headphones Offer Card */}
            {isCard && (
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
                color: "#ffffff",
                textAlign: "left"
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
                      Rs. {origPrice}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "#10b981", fontWeight: 800 }}>
                      Rs. {propPrice}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "#f59e0b", fontWeight: 600, marginTop: "0.2rem" }}>
                    Status: {status === "pending" ? "Pending Response" : status === "accepted" ? "Accepted" : "Rejected"}
                  </div>
                  
                  {/* Accept / Reject button controls for vendor offers inside customer view */}
                  {!isMe && status === "pending" && (
                    <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem" }}>
                      <button
                        type="button"
                        onClick={() => handleAcceptOffer(msg)}
                        style={{
                          flex: 1,
                          background: "#10b981",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "5px",
                          padding: "0.2rem 0.35rem",
                          fontSize: "0.65rem",
                          fontWeight: 800,
                          cursor: "pointer"
                        }}
                      >
                        ✓ Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRejectOffer(msg)}
                        style={{
                          flex: 1,
                          background: "#ef4444",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "5px",
                          padding: "0.2rem 0.35rem",
                          fontSize: "0.65rem",
                          fontWeight: 800,
                          cursor: "pointer"
                        }}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Structured Bargaining Cards */}
            {propPrice && !isCard && (
              isMe ? (
                <div style={{ 
                  marginTop: "0.5rem", 
                  padding: "0.5rem 0.75rem", 
                  background: "rgba(0,0,0,0.25)", 
                  border: "1px solid rgba(255,255,255,0.08)", 
                  borderRadius: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.15rem"
                }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#f59e0b" }}>
                    📊 Counter-Offer Proposed: Rs. {propPrice.toFixed(2)}
                  </span>
                  <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
                    Status: {status === "pending" ? "Pending Response" : status === "accepted" ? "Accepted" : "Rejected"}
                  </span>
                </div>
              ) : (
                <div style={{ 
                  marginTop: "0.5rem", 
                  padding: "0.5rem 0.75rem", 
                  background: "rgba(255,255,255,0.03)", 
                  border: "1px solid rgba(255,255,255,0.08)", 
                  borderRadius: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.35rem",
                  minWidth: "180px"
                }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#10b981" }}>
                    💰 Merchant Counter-Offer: Rs. {propPrice.toFixed(2)}
                  </span>
                  
                  {status === "pending" ? (
                    <div style={{ display: "flex", gap: "0.35rem" }}>
                      <button
                        type="button"
                        onClick={() => handleAcceptOffer(msg)}
                        style={{
                          flex: 1,
                          background: "#10b981",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "5px",
                          padding: "0.25rem 0.4rem",
                          fontSize: "0.68rem",
                          fontWeight: 800,
                          cursor: "pointer",
                          transition: "transform 0.1s"
                        }}
                      >
                        ✓ Accept Price
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRejectOffer(msg)}
                        style={{
                          flex: 1,
                          background: "#ef4444",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "5px",
                          padding: "0.25rem 0.4rem",
                          fontSize: "0.68rem",
                          fontWeight: 800,
                          cursor: "pointer",
                          transition: "transform 0.1s"
                        }}
                      >
                        ✕ Counter/Reject
                      </button>
                    </div>
                  ) : (
                    <span style={{ 
                      fontSize: "0.68rem", 
                      color: status === "accepted" ? "#10b981" : "#ef4444", 
                      fontWeight: 700
                    }}>
                      {status === "accepted" ? "✓ Offer Accepted" : "✕ Offer Countered/Rejected"}
                    </span>
                  )}
                </div>
              )
            )}
            
            {/* Product Card attachment inside shopper drawer */}
            {hasAttachment && attachmentData && (
              <div 
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  setIsOpen(false);
                  router.push(`/shop/${slug}/product/${attachmentData.productId}`);
                }}
                style={{ 
                  background: isMe ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.05)", 
                  borderRadius: "10px", 
                  padding: "0.6rem", 
                  marginTop: "0.5rem",
                  display: "flex",
                  gap: "0.6rem",
                  alignItems: "center",
                  cursor: "pointer",
                  border: isMe ? "1px solid rgba(0,0,0,0.1)" : "1px solid rgba(255,255,255,0.08)",
                  transition: "all 0.2s ease"
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = isMe ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.1)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = isMe ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.05)";
                }}
              >
                {/* Image Thumbnail */}
                <div style={{ width: "38px", height: "38px", borderRadius: "6px", overflow: "hidden", background: "rgba(255,255,255,0.15)", flexShrink: 0 }}>
                  {attachmentData.thumbnailUrl ? (
                    <img 
                      src={getImageUrl(attachmentData.thumbnailUrl)} 
                      alt={attachmentData.name} 
                      style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                    />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.05)" }} />
                  )}
                </div>

                {/* Product details and actions */}
                <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {attachmentData.name}
                  </span>
                  <span style={{ fontSize: "0.68rem", fontWeight: 800, color: isMe ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.8)", marginTop: "0.1rem" }}>
                    Rs. {attachmentData.price.toLocaleString()}
                  </span>

                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.3rem", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        addToCart(attachmentData.productId, {
                          title: attachmentData.name,
                          price: attachmentData.price,
                          image: attachmentData.thumbnailUrl || "",
                          storeId: store?._id,
                          storeName: store?.name,
                          storeSlug: slug
                        });
                        setGlobalCartOpen(true);
                      }}
                      style={{
                        background: isMe ? "#000000" : primaryColor,
                        color: isMe ? "#ffffff" : (isDarkColor(primaryColor) ? "#ffffff" : "#000000"),
                        border: "none",
                        borderRadius: "4px",
                        padding: "0.2rem 0.45rem",
                        fontSize: "0.62rem",
                        fontWeight: 800,
                        cursor: "pointer",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)"
                      }}
                    >
                      + Add to Cart
                    </button>
                    
                    <span style={{ fontSize: "0.62rem", color: isMe ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.7)", fontWeight: 700, textDecoration: "underline" }}>
                      View
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  return (
    <StoreContext.Provider value={{ store, loading, error }}>
      <div style={{ background: "#07070A", color: "#f1f5f9", minHeight: "100vh", fontFamily: "system-ui, sans-serif", position: "relative", overflowX: "hidden" }}>
        
        {/* Subtle glowing vendor-themed background blob */}
        <div 
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: "100%",
            maxWidth: "80rem",
            height: "500px",
            backgroundImage: `linear-gradient(to bottom, ${primaryColor}1a, transparent)`,
            filter: "blur(64px)",
            pointerEvents: "none",
            zIndex: 0
          }}
        />

        {/* Dynamic style block to inject branding globally onto the body / browser frame */}
        <style dangerouslySetInnerHTML={{ __html: `
          body {
            background-color: #07070A !important;
            color: #f1f5f9 !important;
          }
          :root {
            --vendor-color: ${primaryColor};
            --vendor-bg-color: ${backgroundColor};
          }
          /* Custom theme selections overrides */
          .storefront-primary-bg {
            background-color: ${primaryColor} !important;
          }
          .storefront-primary-text {
            color: ${primaryColor} !important;
          }
        `}} />

        {/* Public Storefront Navbar */}
        <header style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.08)", background: "rgba(10, 10, 15, 0.8)", backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "1rem 2rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Link href={`/shop/${slug}`} style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div style={{ 
                width: "32px", 
                height: "32px", 
                borderRadius: "50%", 
                background: primaryColor, 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center", 
                color: isDarkColor(primaryColor) ? "#ffffff" : "#000000", 
                fontWeight: 900,
                overflow: "hidden",
                border: "1px solid rgba(255, 255, 255, 0.2)"
              }}>
                {store?.logo ? (
                  <img 
                    src={getImageUrl(store.logo)} 
                    alt={store.name} 
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                  />
                ) : (
                  store?.name?.charAt(0) || "S"
                )}
              </div>
              <span style={{ fontWeight: 800, fontSize: "1.1rem" }}>{store?.name}</span>
            </Link>

            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", background: `${primaryColor}15`, color: primaryColor, padding: "0.2rem 0.5rem", borderRadius: "6px", fontWeight: 700 }}>
                ● Storefront Active
              </span>
              <Link href="/" style={{ fontSize: "0.82rem", opacity: 0.7, color: "#f1f5f9", textDecoration: "none" }}>
                Exit Storefront
              </Link>
            </div>
          </div>
        </header>

        {/* Dynamic page content */}
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem", position: "relative", zIndex: 10 }}>
          {children}
        </div>

        {/* Sticky Communication Drawer Button */}
        <button 
          onClick={() => setIsOpen(true)}
          style={{
            position: "fixed",
            bottom: "2rem",
            right: "2rem",
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: primaryColor,
            color: isDarkColor(primaryColor) ? "#ffffff" : "#000000",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            transition: "transform 0.2s"
          }}
          onMouseEnter={e => e.currentTarget.style.transform = "scale(1.08)"}
          onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
        >
          <MessageCircle size={24} />
        </button>

        {/* Chat Drawer Slideout */}
        {isOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", justifyContent: "flex-end" }}>
            <div 
              style={{
                width: "100%",
                maxWidth: "380px",
                height: "100vh",
                background: "#0d0d14",
                color: "#f1f5f9",
                borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                flexDirection: "column"
              }}
              className="animate-fade-left"
            >
              {/* Drawer Header */}
              <div style={{ padding: "1.2rem 1.5rem", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ fontWeight: 800, fontSize: "1rem" }}>Negotiation Chat</h3>
                  <p style={{ fontSize: "0.7rem", color: primaryColor }}>Store Operator Online</p>
                </div>
                <button onClick={() => setIsOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)" }}>
                  <X size={20} />
                </button>
              </div>

              {/* Product Anchor Context Card */}
              {user && currentProduct && (
                <div style={{ padding: "1rem 1.5rem 0 1.5rem" }}>
                  <div className="bg-[#12121A] border border-slate-800 rounded-xl p-3 mb-1 flex items-center gap-3" style={{ background: "#12121A", border: "1px solid #1e293b", borderRadius: "0.75rem", padding: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "8px", overflow: "hidden", background: "rgba(255,255,255,0.05)", flexShrink: 0 }}>
                      {currentProduct.thumbnailUrl ? (
                        <img 
                          src={getImageUrl(currentProduct.thumbnailUrl)} 
                          alt={currentProduct.name} 
                          style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                        />
                      ) : (
                        <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <ShoppingBag size={18} style={{ color: "rgba(255,255,255,0.4)" }} />
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {currentProduct.name}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#10b981", fontWeight: 800, marginTop: "0.1rem" }}>
                        Rs. {typeof currentProduct.price === 'number' ? currentProduct.price.toFixed(2) : currentProduct.price}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Chat Thread */}
              <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                {!user ? (
                  <div style={{ textAlign: "center", padding: "2rem 1rem", color: "rgba(255,255,255,0.5)" }}>
                    <ShoppingBag size={32} style={{ margin: "0 auto 0.75rem", opacity: 0.3 }} />
                    <p style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>Please log in to chat or negotiate prices directly with the merchant.</p>
                    <Link href="/auth/login" style={{ background: primaryColor, color: isDarkColor(primaryColor) ? "#ffffff" : "#000000", padding: "0.5rem 1rem", borderRadius: "8px", textDecoration: "none", fontSize: "0.8rem", fontWeight: 700 }}>
                      Log In to Chat
                    </Link>
                  </div>
                ) : messagesList.length === 0 ? (
                  <RenderEmptyPlaceholder />
                ) : (
                  <RenderActiveTimeline />
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Persistent Lower Counter-Offer Utility Rig */}
              {user && (
                <div className="bg-[#07070A] border-t border-slate-900 p-4" style={{ background: "#07070A", borderTop: "1px solid rgba(15, 23, 42, 0.8)", padding: "1rem" }}>
                  {!isSocketConnected ? (
                    <div style={{
                      background: "rgba(245, 158, 11, 0.1)",
                      border: "1px solid rgba(245, 158, 11, 0.25)",
                      color: "#f59e0b",
                      borderRadius: "8px",
                      padding: "0.75rem 1rem",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      textAlign: "center"
                    }}>
                      ⚠️ Connection interrupted. Waiting for store operator to reconnect...
                    </div>
                  ) : (
                    <div>
                      {/* Counter price input & offset tags */}
                      <div style={{ marginBottom: "0.75rem" }}>
                        <label style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.6)", display: "block", marginBottom: "0.25rem", fontWeight: 700 }}>
                          Propose Counter Price (PKR)
                        </label>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          <input 
                            type="number" 
                            step="0.01"
                            placeholder="0.00" 
                            value={counterPrice} 
                            onChange={e => setCounterPrice(e.target.value)}
                            style={{
                              flex: 1,
                              background: "#12121a",
                              border: "1px solid rgba(255,255,255,0.08)",
                              borderRadius: "8px",
                              padding: "0.4rem 0.60rem",
                              color: "#f1f5f9",
                              fontSize: "0.82rem",
                              outline: "none"
                            }}
                          />
                          <div style={{ display: "flex", gap: "0.25rem" }}>
                            {[-5, -10, -15].map(pct => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => {
                                  if (currentProduct) {
                                    const calculated = currentProduct.price * (1 + pct / 100);
                                    setCounterPrice(calculated.toFixed(2));
                                  }
                                }}
                                style={{
                                  background: "rgba(255, 255, 255, 0.05)",
                                  border: "1px solid rgba(255, 255, 255, 0.08)",
                                  borderRadius: "6px",
                                  padding: "0.3rem 0.5rem",
                                  color: "#f1f5f9",
                                  fontSize: "0.68rem",
                                  cursor: "pointer",
                                  transition: "background 0.2s"
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)"}
                                onMouseLeave={e => e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)"}
                              >
                                {pct}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Main Message Form */}
                      <form onSubmit={sendChatMessage} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <input 
                          type="text" 
                          placeholder={counterPrice ? "Add custom counter-offer message..." : "Type a message..."} 
                          value={inputText} 
                          onChange={e => setInputText(e.target.value)}
                          style={{
                            flex: 1,
                            background: "#12121a",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "8px",
                            padding: "0.5rem 0.75rem",
                            color: "#f1f5f9",
                            fontSize: "0.82rem",
                            outline: "none"
                          }}
                        />
                        <button type="submit" style={{ background: primaryColor, border: "none", borderRadius: "8px", width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: isDarkColor(primaryColor) ? "#ffffff" : "#000000" }}>
                          <Send size={14} />
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </StoreContext.Provider>
  );
}

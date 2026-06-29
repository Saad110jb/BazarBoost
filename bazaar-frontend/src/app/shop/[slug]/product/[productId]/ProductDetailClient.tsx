"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useStore } from "../../layout";
import { ShoppingCart, MessageSquare, Tag, AlertCircle, ArrowLeft, Loader, Zap, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { getImageUrl } from "@/utils/imageUrl";

import { io } from "socket.io-client";

interface ProductDetailClientProps {
  initialProduct: any;
}

export default function ProductDetailClient({ initialProduct }: ProductDetailClientProps) {
  const params = useParams();
  const slug = params?.slug as string;
  const { store } = useStore();

  const [product] = useState<any>(initialProduct);
  const [added, setAdded] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState("");
  const { addToCart, setIsCartOpen } = useCart();

  const [pairedRecs, setPairedRecs] = useState<any[]>([]);
  const [viewedRecs, setViewedRecs] = useState<any[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  // Live WebSocket variables
  const [liveRating, setLiveRating] = useState<number>(initialProduct?.rating || 4.8);
  const [liveRatingCount, setLiveRatingCount] = useState<number>(initialProduct?.ratingCount || 248);
  const [liveNegotiatingCount, setLiveNegotiatingCount] = useState<number>(12);
  const [activeCoupons, setActiveCoupons] = useState<any[]>([]);

  useEffect(() => {
    if (!store?._id) return;
    const fetchCoupons = async () => {
      try {
        const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
        const res = await fetch(`${API}/api/coupons/public/store/${store._id}`);
        const data = await res.json();
        if (data.success) {
          setActiveCoupons(data.coupons || []);
        }
      } catch (err) {
        console.error("Failed to load store coupons:", err);
      }
    };
    fetchCoupons();
  }, [store?._id]);  useEffect(() => {
    if (!product?._id) return;
    const fetchRecommendations = async () => {
      try {
        const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
        const [resPaired, resViewed] = await Promise.all([
          fetch(`${API}/api/products/${product._id}/recommendations?strategy=paired&limit=4`),
          fetch(`${API}/api/products/${product._id}/recommendations?strategy=viewed&limit=4`)
        ]);

        const dataPaired = await resPaired.json();
        const dataViewed = await resViewed.json();

        if (dataPaired.success) setPairedRecs(dataPaired.recommendations);
        if (dataViewed.success) setViewedRecs(dataViewed.recommendations);
      } catch (err) {
        console.error("Failed to fetch product recommendations:", err);
      } finally {
        setLoadingRecs(false);
      }
    };
    fetchRecommendations();
  }, [product?._id]);

  useEffect(() => {
    if (!product?.flashSale?.isActive || !product?.flashSale?.expiresAt) return;

    const interval = setInterval(() => {
      const difference = new Date(product.flashSale.expiresAt).getTime() - new Date().getTime();
      if (difference <= 0) {
        setTimeLeft("EXPIRED");
        clearInterval(interval);
      } else {
        const hours = Math.floor(difference / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);
        
        const pad = (n: number) => n.toString().padStart(2, '0');
        setTimeLeft(`${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [product]);

  useEffect(() => {
    const stored = localStorage.getItem("bazaar_user");
    if (stored) setUser(JSON.parse(stored));
  }, []);

  // Connect to Socket.io and listen for real-time rating and engagement events
  useEffect(() => {
    if (!product?._id) return;
    const token = localStorage.getItem("bazaar_token");
    const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
    
    const socket = io(API, {
      auth: { token },
      transports: ["websocket"]
    });

    socket.on("connect", () => {
      console.log("[Live Rating Socket] Connected for product:", product._id);
      socket.emit("join_room", { roomId: `product_live:${product._id}` });
    });

    socket.on("on_realtime_rating_update", (data: any) => {
      console.log("[Live Rating Update] Received:", data);
      if (data && data.productId === product._id) {
        if (data.rating) setLiveRating(Number(data.rating.toFixed(1)));
        if (data.ratingCount) setLiveRatingCount(data.ratingCount);
      }
    });

    socket.on("on_live_engagement_stream", (data: any) => {
      console.log("[Live Engagement Update] Received:", data);
      if (data && data.productId === product._id) {
        if (data.negotiatingCount) setLiveNegotiatingCount(data.negotiatingCount);
      }
    });

    // Periodic simulation to keep UI animated in local environments
    const interval = setInterval(() => {
      setLiveNegotiatingCount(prev => {
        const delta = Math.random() > 0.5 ? 1 : -1;
        const newVal = prev + delta;
        return newVal > 3 ? (newVal < 35 ? newVal : 30) : 5;
      });
    }, 5000);

    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [product?._id]);

  const handleNegotiate = () => {
    if (!user) {
      window.dispatchEvent(new CustomEvent("negotiate-product", { detail: product }));
      return;
    }
    const event = new CustomEvent("negotiate-product", { detail: product });
    window.dispatchEvent(event);
  };

  const handleAddToCart = () => {
    addToCart(product._id, {
      title: product.title,
      price: product.price,
      image: product.images?.[0]?.url || "",
      storeId: store?._id || product.storeId?._id || product.storeId,
      storeName: store?.name || product.storeId?.name || "Local Store",
      storeSlug: store?.slug || product.storeId?.slug || "store"
    });
    setAdded(true);
    setIsCartOpen(true);
    setTimeout(() => setAdded(false), 2000);
  };

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
  const cardBg = "rgba(255, 255, 255, 0.04)";
  const cardBorder = "rgba(255, 255, 255, 0.08)";
  const textMutedColor = "rgba(255, 255, 255, 0.6)";

  if (!product) {
    return (
      <div style={{ padding: "4rem 2rem", textAlign: "center", background: "#111119", borderRadius: "16px", border: `1px solid ${cardBorder}`, maxWidth: "500px", margin: "2rem auto", color: "#f1f5f9" }}>
        <AlertCircle size={36} style={{ color: "#ef4444", marginBottom: "1rem", marginLeft: "auto", marginRight: "auto" }} />
        <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "0.5rem", color: "#ffffff" }}>Product Unavailable</h3>
        <p style={{ fontSize: "0.85rem", color: textMutedColor, marginBottom: "1.5rem" }}>The requested item is out of stock or was removed.</p>
        <Link href={`/shop/${slug}`} style={{ background: primaryColor, color: isDarkColor(primaryColor) ? "#ffffff" : "#000000", padding: "0.5rem 1rem", borderRadius: "8px", textDecoration: "none", fontSize: "0.85rem", fontWeight: 700 }}>
          Back to Storefront
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 relative z-10">
      
      {/* Back button */}
      <div>
        <Link href={`/shop/${slug}`} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors font-semibold text-decoration-none">
          <ArrowLeft size={14} /> Back to Catalog
        </Link>
      </div>

      {/* Main product card layout - 12 columns grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 max-w-7xl mx-auto w-full pt-4">
        
        {/* Gallery Wrapper (5 Columns) */}
        <div className="lg:col-span-5 aspect-square bg-[#111119] border border-slate-800/60 rounded-2xl overflow-hidden flex items-center justify-center p-6 relative">
          <img 
            src={getImageUrl(product.images?.[0]?.url) || undefined} 
            alt={product.title} 
            className="max-w-full max-h-full object-contain rounded-xl transition-all duration-300 hover:scale-[1.02]"
            onError={e => {
              e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 24 24' fill='none' stroke='%23dee2e6' stroke-width='1'><rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/></svg>";
            }}
          />
        </div>

        {/* Transaction Control Board (7 Columns) */}
        <div className="lg:col-span-7 flex flex-col justify-start">
          
          <div className="flex flex-wrap gap-2">
            <span className="text-xs bg-slate-900 border border-slate-800 text-slate-400 px-2.5 py-1 rounded-md font-semibold tracking-wider uppercase">
              ID: {product._id?.slice(-8).toUpperCase()}
            </span>
            {product.category && (
              <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-md font-semibold tracking-wider uppercase">
                {product.category}
              </span>
            )}
          </div>

          <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mt-4 leading-none">{product.title}</h2>
          
          {/* Live WebSocket Star rating index & engagement metrics */}
          <div className="flex flex-wrap items-center gap-3 mt-4 text-sm">
            {/* 5 Premium SVG Stars */}
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((starIdx) => {
                const fillAmount = Math.max(0, Math.min(1, liveRating - (starIdx - 1)));
                return (
                  <svg
                    key={starIdx}
                    className="w-4 h-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <defs>
                      <linearGradient id={`starGrad-${starIdx}`}>
                        <stop offset={`${fillAmount * 100}%`} stopColor="rgb(251, 191, 36)" />
                        <stop offset={`${fillAmount * 100}%`} stopColor="rgba(255,255,255,0.15)" />
                      </linearGradient>
                    </defs>
                    <path
                      fill={`url(#starGrad-${starIdx})`}
                      d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                    />
                  </svg>
                );
              })}
            </div>
            <span className="text-slate-400 text-xs font-semibold bg-slate-900/60 border border-slate-800/80 px-2.5 py-1 rounded-md">
              ⭐ {liveRating.toFixed(1)} ({liveRatingCount.toLocaleString()} verified ratings) • <span className="text-amber-400 font-bold">🔥 {liveNegotiatingCount} users negotiating now</span>
            </span>
          </div>

          {/* Price display with Flash Sale Countdown Clock */}
          {product.flashSale && product.flashSale.isActive && new Date() < new Date(product.flashSale.expiresAt) ? (
            <div className="flex flex-col gap-2 mt-5">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-mono font-bold text-emerald-400">
                  Rs. {product.flashSale.salePrice.toLocaleString()}
                </span>
                <span className="text-lg text-slate-500 line-through">
                  Rs. {product.price.toLocaleString()}
                </span>
              </div>
              
              {timeLeft && (
                <div className="inline-flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-1.5 w-fit text-rose-400 text-xs font-bold">
                  <Zap size={13} className="animate-pulse" />
                  <span>FLASH SALE ENDS IN: <span className="font-mono text-sm font-extrabold">{timeLeft}</span></span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-3xl font-mono font-bold text-emerald-400 mt-5">
              Rs. {product.price.toLocaleString()}
            </div>
          )}
          {/* Coupon High-Contrast Badge */}
          {activeCoupons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeCoupons.map((coupon: any) => (
                <div 
                  key={coupon._id}
                  className="inline-flex items-center gap-1.5 bg-purple-500/10 border border-purple-500/30 text-purple-400 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider animate-pulse animate-duration-1000"
                >
                  <Tag size={13} />
                  <span>
                    Save {coupon.discountType === "percentage" ? `${coupon.discountValue}%` : `Rs. ${coupon.discountValue}`} via code {coupon.code}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Description Card */}
          <div className="bg-[#12121A] border border-slate-800/60 rounded-xl p-5 mt-5 text-sm text-slate-300 leading-relaxed">
            <p>{product.description}</p>
          </div>

          {/* AI Auto-tags list */}
          {product.aiTags && product.aiTags.length > 0 && (
            <div className="mt-5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Categories</p>
              <div className="flex flex-wrap gap-2">
                {product.aiTags.map((t: string) => (
                  <span key={t} className="inline-flex items-center gap-1 text-xs bg-violet-500/10 border border-violet-500/20 text-violet-400 px-2.5 py-1 rounded-md font-semibold">
                    <Tag size={12} /> {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stock availability */}
          <div className="flex items-center gap-2 text-xs font-semibold mt-4">
            <span className={`w-2 h-2 rounded-full ${product.stock > 0 ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
            <span className="text-slate-400">
              {product.stock > 0 ? `In Stock: ${product.stock} items remaining` : "Out of Stock"}
            </span>
          </div>

          {/* Actions panel */}
          <div className="flex flex-col gap-3 mt-6">
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={handleAddToCart}
                disabled={product.stock <= 0}
                className="flex items-center justify-center gap-2 text-white hover:opacity-90 font-bold text-sm px-6 py-3 rounded-xl transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--vendor-color)',
                  boxShadow: `0 4px 12px ${primaryColor}33`
                }}
              >
                {added ? "✓ Added to Cart" : <><ShoppingCart size={16} /> Add to Cart</>}
              </button>

              <button 
                onClick={handleNegotiate}
                className="flex items-center justify-center gap-2 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500 text-amber-400 font-bold text-sm px-6 py-3 rounded-xl transition-all"
              >
                <MessageSquare size={16} /> Negotiate Price
              </button>
            </div>
            
            <p className="text-[10px] text-slate-500 text-center flex items-center justify-center gap-1 font-semibold mt-1">
              <Zap size={11} className="text-amber-400 animate-bounce" /> Negotiate directly with the merchant over real-time WebSockets.
            </p>
          </div>

        </div>

      </div>

      {/* Divider */}
      <hr className="border-slate-800/80 my-8" />

      {/* Privacy Notice Banner */}
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-[var(--vendor-color)]" style={{ color: 'var(--vendor-color)' }} />
          <span>
            <strong>Privacy-First Marketplace:</strong> Product recommendations are computed offline on our server using local text-embeddings. No tracking cookies or pixels are loaded.
          </span>
        </div>
        <span className="text-[9px] bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider whitespace-nowrap">
          100% Offline AI
        </span>
      </div>

      {/* Recommendation Rails */}
      <div className="flex flex-col gap-10 mt-6">
        {/* Rail 1: Frequently Paused With */}
        {pairedRecs.length > 0 && (
          <div>
            <h3 className="text-lg font-bold text-white mb-4">
              Frequently Paused With
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {pairedRecs.map(rec => (
                <RecommendationCard key={rec._id} product={rec} slug={slug} primaryColor={primaryColor} />
              ))}
            </div>
          </div>
        )}

        {/* Rail 2: Users Also Viewed */}
        {viewedRecs.length > 0 && (
          <div>
            <h3 className="text-lg font-bold text-white mb-4">
              Users Also Viewed
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {viewedRecs.map(rec => (
                <RecommendationCard key={rec._id} product={rec} slug={slug} primaryColor={primaryColor} />
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

function RecommendationCard({ product, slug, primaryColor }: { product: any; slug: string; primaryColor: string }) {
  const primaryImg = (product.images || []).find((img: any) => img.isPrimary)
    || (product.images || [])[0]
    || null;

  return (
    <div 
      className="bg-[#0D0D14] border border-slate-900 rounded-xl overflow-hidden group transition-all duration-300 hover:border-slate-800/80 hover:-translate-y-1 flex flex-col relative"
    >
      <div className="w-full aspect-square bg-[#111119] border-b border-slate-900/60 overflow-hidden relative">
        <img 
          src={getImageUrl(primaryImg?.url) || undefined} 
          alt={product.title} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          onError={e => {
            e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='140' viewBox='0 0 24 24' fill='none' stroke='%23e9ecef' stroke-width='1.5'><rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/></svg>";
          }}
        />
        
        <Link 
          href={`/shop/${slug}/product/${product._id}`} 
          className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-white font-bold text-xs text-decoration-none"
        >
          Inspect Details <ArrowRight size={13} className="ml-1" />
        </Link>
      </div>

      <div className="p-4 bg-slate-950/40 backdrop-blur-md flex flex-col flex-1 border-t border-slate-900/40">
        <Link href={`/shop/${slug}/product/${product._id}`} className="text-decoration-none">
          <h4 className="text-xs font-semibold text-slate-100 group-hover:text-white truncate">
            {product.title}
          </h4>
        </Link>
        <div className="flex justify-between items-center mt-3 gap-2">
          <p className="text-xs font-bold text-emerald-400 font-mono">
            Rs. {Number(product.price).toLocaleString()}
          </p>
          <Link 
            href={`/shop/${slug}/product/${product._id}`}
            className="border text-[9px] px-2 py-1 rounded-md text-decoration-none transition-all font-bold"
            style={{
              borderColor: 'var(--vendor-color)',
              color: 'var(--vendor-color)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = '#000000';
              e.currentTarget.style.backgroundColor = 'var(--vendor-color)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--vendor-color)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Buy Now
          </Link>
        </div>
      </div>
    </div>
  );
}

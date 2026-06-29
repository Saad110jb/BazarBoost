"use client";
import { useState } from "react";
import { useStore } from "./layout";
import { ShoppingCart, Star, MapPin, Clock, Zap, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { getImageUrl } from "@/utils/imageUrl";

interface StorefrontClientProps {
  initialProducts: any[];
}

export default function StorefrontClient({ initialProducts }: StorefrontClientProps) {
  const { store } = useStore();
  const [products] = useState<any[]>(initialProducts);
  const [addedItem, setAddedItem] = useState<string | null>(null);
  const { addToCart, cart, setIsCartOpen } = useCart();

  const handleAddToCart = (prod: any) => {
    addToCart(prod._id, {
      title: prod.title,
      price: prod.price,
      image: prod.images?.[0]?.url || "",
      storeId: store?._id || prod.storeId,
      storeName: store?.name || "Local Store",
      storeSlug: store?.slug || "store"
    });
    setAddedItem(prod._id);
    setIsCartOpen(true);
    setTimeout(() => setAddedItem(null), 2000);
  };

  const primaryColor = store?.theme?.primaryColor || "#7c3aed";
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Separate sponsored/promoted products (simulating high-contrast Top Ad Row)
  const sponsoredProducts = products.slice(0, 2); // Show first 2 products as sponsored highlights if available
  const organicProducts = products.slice(2);

  // Time conversion helpers
  const timeToMinutes = (timeStr: string) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  const format12Hour = (timeStr: string) => {
    if (!timeStr) return "";
    let [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12; // the hour '0' should be '12'
    const mStr = m < 10 ? '0' + m : m;
    return `${h}:${mStr} ${ampm}`;
  };

  // Dynamic live system temporal hours logic
  const getStoreStatus = () => {
    if (!store) return { isOpen: false, text: "Closed" };
    if (store.vacationMode) {
      return { isOpen: false, text: "Closed (Vacation Mode)" };
    }

    const now = new Date();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayIndex = now.getDay();
    const currentDayName = days[currentDayIndex];
    
    const currentHours = store.businessHours?.[currentDayName] || { startTime: "09:00", endTime: "22:00" };
    const startMin = timeToMinutes(currentHours.startTime || "09:00");
    const endMin = timeToMinutes(currentHours.endTime || "22:00");
    const nowMin = now.getHours() * 60 + now.getMinutes();

    if (nowMin >= startMin && nowMin < endMin) {
      return {
        isOpen: true,
        text: `Open Now (${format12Hour(currentHours.startTime || "09:00")} - ${format12Hour(currentHours.endTime || "22:00")})`
      };
    }

    // It is closed today. Find the next opening gate.
    for (let i = 0; i < 7; i++) {
      const checkDayIndex = (currentDayIndex + i) % 7;
      const checkDayName = days[checkDayIndex];
      const checkHours = store.businessHours?.[checkDayName] || { startTime: "09:00", endTime: "22:00" };
      
      // If it's today (i === 0) and we already determined it's closed because it's before start time
      if (i === 0 && nowMin < startMin) {
        return {
          isOpen: false,
          text: `Closed (Opens today at ${format12Hour(checkHours.startTime || "09:00")})`
        };
      }
      
      // If checked day is open in the future
      if (i > 0) {
        const dayLabel = i === 1 ? "tomorrow" : checkDayName.charAt(0).toUpperCase() + checkDayName.slice(1);
        return {
          isOpen: false,
          text: `Closed (Opens ${dayLabel} at ${format12Hour(checkHours.startTime || "09:00")})`
        };
      }
    }

    return { isOpen: false, text: "Closed" };
  };

  const statusInfo = getStoreStatus();

  // Location Ticker calculation
  const locationText = store?.warehouseAddress
    ? (store.warehouseAddress.includes(store.originCity || '') 
        ? store.warehouseAddress 
        : `${store.warehouseAddress}, ${store.originCity || 'Faisalabad'}`)
    : `Anarkali Bazaar, ${store?.originCity || 'Faisalabad'}`;

  return (
    <div className="flex flex-col gap-10 bg-[#07070A] text-slate-100 min-h-screen">
      
      {/* 1. Shop Header Hero Banner */}
      <div className="w-full aspect-[16/5] md:aspect-[21/6] rounded-2xl overflow-hidden border border-slate-800 relative bg-[#0D0D14] flex items-end">
        {store?.banner ? (
          <img 
            src={getImageUrl(store.banner) || undefined} 
            alt={store.name} 
            className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-overlay z-0"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-[#0D0D14] to-slate-950 z-0" />
        )}
        
        {/* Subtle grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none z-0" />

        {/* Floating Cart Counter Badge */}
        {cartCount > 0 && (
          <button 
            onClick={() => setIsCartOpen(true)}
            className="absolute top-4 right-4 z-20 bg-purple-600 hover:bg-purple-500 text-white border border-purple-500/30 cursor-pointer px-4 py-2 rounded-full text-xs font-black flex items-center gap-1.5 shadow-lg shadow-purple-500/20 transition-all hover:scale-105"
          >
            <ShoppingCart size={14} /> {cartCount} items in cart
          </button>
        )}

        {/* Glassmorphic Identity Block Layout positioned over lower-left edge */}
        <div className="absolute bottom-4 left-4 right-4 md:bottom-6 md:left-6 md:right-auto md:max-w-2xl bg-[#0D0D14]/70 backdrop-blur-xl border border-white/10 p-5 rounded-2xl flex flex-col gap-4 shadow-2xl z-10">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full border-2 border-white/10 bg-slate-900 overflow-hidden flex items-center justify-center text-2xl font-black text-white shrink-0 shadow-lg">
              {store?.logo ? (
                <img 
                  src={getImageUrl(store.logo) || undefined} 
                  alt={store.name} 
                  className="w-full h-full object-cover" 
                />
              ) : (
                store?.name?.charAt(0) || "S"
              )}
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight leading-tight">{store?.name}</h1>
              <p className="text-xs md:text-sm text-slate-400 mt-1 line-clamp-1">{store?.description || "Welcome to our digital storefront!"}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            {/* Status Ticker */}
            {statusInfo.isOpen ? (
              <span className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-full font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span>● {statusInfo.text}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-3 py-1.5 rounded-full font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                <span>{statusInfo.text}</span>
              </span>
            )}

            {/* Geolocation Ticker */}
            <span className="flex items-center gap-1.5 bg-slate-800/50 border border-slate-700/50 px-3 py-1.5 rounded-full font-semibold">
              <span>📍 {locationText}</span>
            </span>

            {/* Live Rating Cluster */}
            <span className="flex items-center gap-1.5 bg-slate-800/50 border border-slate-700/50 px-3 py-1.5 rounded-full font-semibold">
              <Star size={12} className="text-yellow-500 fill-yellow-500 shrink-0" />
              <span>⭐ 4.9 (1,240 Verified Reviews)</span>
            </span>
          </div>
        </div>
      </div>

      {/* 2. Top Ad Row (Sponsored Placements) */}
      {sponsoredProducts.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className="text-purple-500" />
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Sponsored Highlights</h2>
          </div>

          <div className="flex flex-col gap-4 w-full">
            {sponsoredProducts.map(prod => (
              <div 
                key={prod._id}
                className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 p-6 rounded-2xl bg-[#0D0D14] border border-slate-800/80 relative overflow-hidden group hover:border-slate-700 transition-all"
              >
                {/* Sponsored tag at top right */}
                <span className="absolute top-4 right-4 text-[9px] font-black tracking-widest uppercase text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded-md border border-purple-500/20">
                  Sponsored Boost
                </span>

                <div className="flex items-center gap-6 w-full md:w-auto">
                  {/* Left image block */}
                  <div className="w-40 h-40 bg-[#111119] rounded-xl border border-slate-800/80 p-2 flex items-center justify-center shrink-0 overflow-hidden">
                    <img 
                      src={getImageUrl(prod.images?.[0]?.url) || undefined} 
                      alt={prod.title} 
                      className="max-w-full max-h-full object-contain rounded-lg transition-transform duration-300 group-hover:scale-105"
                      onError={e => {
                        e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='1.5'><rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/></svg>";
                      }}
                    />
                  </div>

                  {/* Right data panel */}
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded w-fit mb-2 font-mono">
                      {prod.category || "Premium"}
                    </span>
                    <Link href={`/shop/${store?.slug}/product/${prod._id}`}>
                      <h3 className="text-2xl font-black text-white tracking-tight hover:text-purple-400 transition-colors truncate max-w-sm md:max-w-md">
                        {prod.title}
                      </h3>
                    </Link>
                    <div className="flex items-center gap-3 mt-2">
                      {prod.flashSale && prod.flashSale.isActive && new Date() < new Date(prod.flashSale.expiresAt) ? (
                        <>
                          <span className="text-xl font-mono font-bold text-emerald-400">
                            Rs. {prod.flashSale.salePrice.toLocaleString()}
                          </span>
                          <span className="text-sm font-mono text-slate-500 line-through">
                            Rs. {prod.price.toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <span className="text-xl font-mono font-bold text-emerald-400">
                          Rs. {prod.price.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Add to Cart button aligned cleanly to the right */}
                <div className="w-full md:w-auto shrink-0 flex justify-end">
                  <button 
                    onClick={() => handleAddToCart(prod)}
                    className="bg-gradient-to-r from-purple-600 to-purple-700 text-xs font-bold tracking-wider uppercase px-6 py-3 rounded-lg hover:from-purple-500 hover:to-purple-600 transition-all shadow-md shadow-purple-600/10 text-white shrink-0"
                  >
                    {addedItem === prod._id ? "✓ Added" : "Add to Cart"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Main Product Showcase Grid (Organic Items) */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
          All Products
        </h2>

        {organicProducts.length === 0 && sponsoredProducts.length === 0 ? (
          <div className="text-center py-16 px-4 bg-[#0D0D14] rounded-2xl border border-slate-800 text-slate-400">
            No products listed in this storefront directory yet. Check back soon!
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full">
            {(organicProducts.length > 0 ? organicProducts : products).map(prod => (
              <div 
                key={prod._id}
                className="flex flex-col bg-[#0D0D14] border border-slate-800/80 rounded-xl overflow-hidden hover:border-slate-700 transition-all duration-300 group"
              >
                {/* Top Slot */}
                <div className="aspect-square overflow-hidden bg-[#111119] rounded-t-xl relative">
                  <img 
                    src={getImageUrl(prod.images?.[0]?.url) || undefined} 
                    alt={prod.title} 
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    onError={e => {
                      e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='1.5'><rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/></svg>";
                    }}
                  />
                  
                  {/* Translucent tag at top right if boosted or running sale */}
                  {((prod.flashSale && prod.flashSale.isActive && new Date() < new Date(prod.flashSale.expiresAt)) || prod.isBoosted) && (
                    <div className="absolute top-2 right-2 bg-slate-950/70 backdrop-blur-md border border-slate-800 px-2 py-1 rounded text-[9px] font-bold text-amber-400 tracking-wider uppercase z-10">
                      {prod.flashSale && prod.flashSale.isActive && new Date() < new Date(prod.flashSale.expiresAt) ? "⚡ Sale" : "Boosted"}
                    </div>
                  )}

                  <Link 
                    href={`/shop/${store?.slug}/product/${prod._id}`}
                    className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1"
                  >
                    Inspect Details <ArrowRight size={13} />
                  </Link>
                </div>

                {/* Bottom Slot */}
                <div className="p-4 flex flex-col justify-between flex-1 gap-3">
                  <div>
                    <Link href={`/shop/${store?.slug}/product/${prod._id}`}>
                      <h4 className="text-sm font-semibold text-slate-200 group-hover:text-purple-400 transition-colors line-clamp-1">
                        {prod.title}
                      </h4>
                    </Link>
                    {/* Live Star Tracking Row */}
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-400">
                      <Star size={11} className="text-yellow-500 fill-yellow-500 shrink-0" />
                      <span>4.9 (Live Feedback)</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-800/40">
                    <div className="flex flex-col">
                      {prod.flashSale && prod.flashSale.isActive && new Date() < new Date(prod.flashSale.expiresAt) ? (
                        <>
                          <span className="text-sm font-mono font-bold text-emerald-400">
                            Rs. {prod.flashSale.salePrice.toLocaleString()}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500 line-through">
                            Rs. {prod.price.toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm font-mono font-bold text-emerald-400">
                          Rs. {prod.price.toLocaleString()}
                        </span>
                      )}
                    </div>

                    <button 
                      onClick={() => handleAddToCart(prod)}
                      className="bg-purple-600/10 border border-purple-500/20 hover:bg-purple-600 hover:text-white transition-all text-[11px] font-bold text-purple-400 px-3 py-1.5 rounded-md"
                    >
                      {addedItem === prod._id ? "✓ Added" : "+ Cart"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

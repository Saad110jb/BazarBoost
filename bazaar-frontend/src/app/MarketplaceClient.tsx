"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import ProductImagePlaceholder from "@/components/ProductImagePlaceholder";
import { Search, ShoppingBag, Tag, Zap, ArrowRight, Store, Eye } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { getImageUrl } from "@/utils/imageUrl";
import { io } from "socket.io-client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const TAG_COLORS: Record<string, string> = {
  "electronics":          "#3b82f6",
  "clothing & apparel":   "#ec4899",
  "home & kitchen":       "#f59e0b",
  "groceries & food":     "#10b981",
  "beauty & personal care": "#a855f7",
  "toys & games":         "#f97316",
  "automotive":           "#6b7280",
  "books & stationery":   "#8b5cf6",
  "services":             "#14b8a6",
  "audio":                "#3b82f6",
};

interface MarketplaceClientProps {
  initialProducts: any[];
}

export default function MarketplaceClient({ initialProducts }: MarketplaceClientProps) {
  const { addToCart } = useCart();
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [heroVisible, setHeroVisible] = useState(false);

  // Search recommendation states
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [searchRecData, setSearchRecData] = useState<{
    products: any[];
    stores: any[];
    tags: string[];
    autocomplete: string[];
    personalized: any[];
  }>({
    products: [],
    stores: [],
    tags: [],
    autocomplete: [],
    personalized: []
  });
  const [recLoading, setRecLoading] = useState(false);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowRecommendations(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const fetchSearchRecommendations = async () => {
      setRecLoading(true);
      const token = localStorage.getItem("bazaar_token");
      try {
        const url = `${API}/api/products/search/recommendations?q=${encodeURIComponent(search)}`;
        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (data.success) {
          setSearchRecData({
            products: data.products || [],
            stores: data.stores || [],
            tags: data.tags || [],
            autocomplete: data.autocomplete || [],
            personalized: data.personalized || []
          });
        }
      } catch (err) {
        console.error("Failed to fetch search recommendations:", err);
      } finally {
        setRecLoading(false);
      }
    };

    const timer = setTimeout(() => {
      fetchSearchRecommendations();
    }, 200); // 200ms debounce

    return () => clearTimeout(timer);
  }, [search]);

  const [sponsoredAds, setSponsoredAds] = useState<any[]>([]);
  const [heroAds, setHeroAds] = useState<any[]>([]);
  const [sidebarAds, setSidebarAds] = useState<any[]>([]);
  const [activeHeroIdx, setActiveHeroIdx] = useState(0);
  const [bufferedHeroIdx, setBufferedHeroIdx] = useState<number | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [overlayAdIdx, setOverlayAdIdx] = useState(0);
  const [overlayFade, setOverlayFade] = useState(true);

  // Coordination and Animation Refs
  const midpointTimerRef = useRef<NodeJS.Timeout | null>(null);
  const endTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heroAdsRef = useRef<any[]>([]);

  // Keep heroAdsRef in sync with state
  useEffect(() => {
    heroAdsRef.current = heroAds;
  }, [heroAds]);

  // Sync overlayAdIdx on initial load
  useEffect(() => {
    if (heroAds.length > 0 && !isTransitioning) {
      setOverlayAdIdx(activeHeroIdx);
    }
  }, [heroAds, activeHeroIdx, isTransitioning]);

  // Preloading & Transition Coordinator
  const preloadAndTransition = (nextIdx: number, currentAdsList: any[]) => {
    const ad = currentAdsList[nextIdx];
    if (!ad) return;

    const activeVariant = ad.variants?.[0];
    const imgUrl = activeVariant?.bannerGraphic || ad.bannerGraphic;
    if (!imgUrl) return;

    const resolvedUrl = getImageUrl(imgUrl);

    // Step 1: Pre-instantiate a JavaScript Image object in memory
    const img = new Image();

    // Step 2: Bind execution directly to the 'img.onload' success event callback
    img.onload = () => {
      // Clear any pending timers from previous transitions
      if (midpointTimerRef.current) clearTimeout(midpointTimerRef.current);
      if (endTimerRef.current) clearTimeout(endTimerRef.current);

      // Step 3: Pass state execution to transition coordinator once cached
      setBufferedHeroIdx(nextIdx);
      setIsTransitioning(true);
      setOverlayFade(false);

      // Step 4: Midpoint content swap at 175ms of 350ms cross-fade animation
      midpointTimerRef.current = setTimeout(() => {
        setOverlayAdIdx(nextIdx);
        setOverlayFade(true);
      }, 175);

      // Step 5: End transition at 350ms
      endTimerRef.current = setTimeout(() => {
        setActiveHeroIdx(nextIdx);
        setIsTransitioning(false);
      }, 350);
    };

    img.onerror = () => {
      // If 'img.onerror' trips, abort the swap instantly to prevent layout blinking
      console.warn(`[Preloader Error] Failed to cache image: ${resolvedUrl}. Aborting swap.`);
    };

    img.src = resolvedUrl;
  };


  // Pop-Up Ad Engine States
  const [showEntryPop, setShowEntryPop] = useState(false);
  const [entryAdCountdown, setEntryAdCountdown] = useState(3);
  const [hasShownEntryPop, setHasShownEntryPop] = useState(false);
  const [showSearchPop, setShowSearchPop] = useState(false);
  const [searchPopAd, setSearchPopAd] = useState<any>(null);
  const [showLifecyclePop, setShowLifecyclePop] = useState(false);
  const [activeLifecycleIdx, setActiveLifecycleIdx] = useState(0);
  const [pendingTagTransition, setPendingTagTransition] = useState<string | null>(null);

  const [activeEntryVariant, setActiveEntryVariant] = useState<any>(null);
  const [activeSearchVariant, setActiveSearchVariant] = useState<any>(null);
  const [activeLifecycleVariant, setActiveLifecycleVariant] = useState<any>(null);
  const [searchPopCampaign, setSearchPopCampaign] = useState<any>(null);

  const maxHeroBid = heroAds.length > 0 ? Math.max(...heroAds.map(ad => ad.bidAmount || 0)) : 0;
  const topBiddingHeroAds = heroAds.filter(ad => (ad.bidAmount || 0) === maxHeroBid);

  const selectVariantIdx = (adId: string, variantsCount: number) => {
    if (variantsCount <= 1) return 0;
    try {
      const key = `bazaar_ad_idx_${adId}`;
      const lastIdx = parseInt(localStorage.getItem(key) || "-1", 10);
      const nextIdx = (lastIdx + 1) % variantsCount;
      localStorage.setItem(key, nextIdx.toString());
      return nextIdx;
    } catch (e) {
      return 0;
    }
  };

  const trackAdEvent = async (bidId: string, type: 'impression' | 'conversion', variantId: string) => {
    if (!bidId || !variantId) return;
    try {
      const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
      await fetch(`${API}/api/ads/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId, type, variantId })
      });
    } catch (err) {
      console.error("Failed to send ad tracking event:", err);
    }
  };


  useEffect(() => {
    setHeroVisible(true);

    const fetchAds = async () => {
      try {
        const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
        const url = selectedTag 
          ? `${API}/api/ads/active?category=${encodeURIComponent(selectedTag)}`
          : `${API}/api/ads/active`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.success && data.ads) {
          setSponsoredAds(data.ads['search-top'] || []);
          setHeroAds(data.ads['homepage-hero'] || []);
          setSidebarAds(data.ads['sidebar-featured'] || []);
          setActiveHeroIdx(0);
        }
      } catch (err) {
        console.error("Failed to fetch active ads:", err);
      }
    };
    fetchAds();
  }, [selectedTag]);

  // Automated rotation for the hero banner ad carousel with preloader
  useEffect(() => {
    if (heroAds.length <= 1) {
      setActiveHeroIdx(0);
      return;
    }

    const interval = setInterval(() => {
      const nextIdx = (activeHeroIdx + 1) % heroAds.length;
      preloadAndTransition(nextIdx, heroAds);
    }, 5000); // Wait 5 seconds between rotations

    return () => {
      clearInterval(interval);
      if (midpointTimerRef.current) clearTimeout(midpointTimerRef.current);
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
    };
  }, [heroAds, activeHeroIdx]);

  // Setup Socket.IO listener for real-time hero ad rotation payloads
  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
    const socket = io(API, {
      transports: ["websocket"]
    });

    socket.on("connect", () => {
      console.log("[Hero Ad Socket] Connected to real-time ad channel");
    });

    socket.on("on_hero_ad_rotation", (payload: any) => {
      console.log("[Hero Ad Socket] Received real-time rotation payload:", payload);
      if (!payload || !payload.optimizedRectangleBannerImg) return;

      const currentAds = heroAdsRef.current;
      // Search for match in existing ad pool
      let targetIdx = currentAds.findIndex((ad) => {
        const imgUrl = ad.variants?.[0]?.bannerGraphic || ad.bannerGraphic;
        return imgUrl === payload.optimizedRectangleBannerImg || ad._id === payload._id;
      });

      if (targetIdx === -1) {
        // Create new ad structure to append dynamically
        const newAd = {
          _id: payload._id || `socket_${Date.now()}`,
          bannerGraphic: payload.optimizedRectangleBannerImg,
          textHeader: payload.textHeader || payload.title || "Premium Cricket Gear",
          variants: [
            {
              variantId: payload.variantId || 'default',
              bannerGraphic: payload.optimizedRectangleBannerImg,
              textHeader: payload.textHeader || payload.title || "Premium Cricket Gear"
            }
          ],
          productId: {
            _id: payload.productId || '',
            title: payload.textHeader || payload.title || "Premium Cricket Gear",
            description: payload.textSubheader || payload.description || "Up to 20% Off",
            storeId: {
              slug: payload.storeSlug || 'store',
              name: payload.storeName || 'Local Vendor'
            }
          },
          bidAmount: payload.bidAmount || 0
        };

        // Append to ad pool, then transition to it
        setHeroAds((prev) => {
          const updated = [...prev, newAd];
          // Trigger transition in the next tick
          setTimeout(() => {
            preloadAndTransition(updated.length - 1, updated);
          }, 0);
          return updated;
        });
      } else {
        preloadAndTransition(targetIdx, currentAds);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Real-time impression tracking for hero carousel ads
  useEffect(() => {
    if (heroAds.length > 0) {
      const currentAd = heroAds[activeHeroIdx];
      if (currentAd) {
        const activeVariant = currentAd.variants?.[0];
        trackAdEvent(currentAd._id, 'impression', activeVariant?.variantId || 'default');
      }
    }
  }, [activeHeroIdx, heroAds]);

  // Automated rotation for the lifecycle banner pop-up (fast 2s rotation for top bidders fallback)
  useEffect(() => {
    if (!showLifecyclePop || topBiddingHeroAds.length <= 1) return;
    const interval = setInterval(() => {
      setActiveLifecycleIdx((prev) => (prev + 1) % topBiddingHeroAds.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [showLifecyclePop, topBiddingHeroAds.length]);


  // Entry Trigger Pop-Up logic (Sidebar Featured Deals Repurposed)
  useEffect(() => {
    if (sidebarAds.length > 0 && !hasShownEntryPop) {
      const ad = sidebarAds[0];
      const variants = ad.variants || [];
      const idx = selectVariantIdx(ad._id, variants.length);
      const variant = variants[idx] || { variantId: 'default', name: 'Default', bannerGraphic: ad.bannerGraphic, textHeader: ad.textHeader };
      setActiveEntryVariant(variant);
      trackAdEvent(ad._id, 'impression', variant.variantId);

      setShowEntryPop(true);
      setHasShownEntryPop(true);
      setEntryAdCountdown(3);
    }
  }, [sidebarAds, hasShownEntryPop]);

  useEffect(() => {
    if (!showEntryPop || entryAdCountdown <= 0) return;
    const timer = setTimeout(() => {
      setEntryAdCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [showEntryPop, entryAdCountdown]);

  // Update active variant and track impression when lifecycle ad changes
  useEffect(() => {
    if (!showLifecyclePop || topBiddingHeroAds.length === 0) return;
    const ad = topBiddingHeroAds[activeLifecycleIdx];
    if (!ad) return;
    const variants = ad.variants || [];
    const idx = selectVariantIdx(ad._id, variants.length);
    const variant = variants[idx] || { variantId: 'default', name: 'Default', bannerGraphic: ad.bannerGraphic, textHeader: ad.textHeader };
    setActiveLifecycleVariant(variant);
    trackAdEvent(ad._id, 'impression', variant.variantId);
  }, [showLifecyclePop, activeLifecycleIdx, topBiddingHeroAds.length]);

  // Search takeover interceptor
  const handleSearchSubmit = () => {
    setAppliedSearch(search);

    if (search.trim()) {
      // Find matching sponsored search-top ad campaigns
      const matchingCampaigns = sponsoredAds.filter(ad => {
        const p = ad.productId;
        if (!p) return false;
        return p.title.toLowerCase().includes(search.toLowerCase()) || 
               p.description?.toLowerCase().includes(search.toLowerCase()) ||
               (p.aiTags && p.aiTags.some((t: string) => t.toLowerCase().includes(search.toLowerCase())));
      });

      if (matchingCampaigns.length > 0) {
        const winningAd = matchingCampaigns[0];
        const variants = winningAd.variants || [];
        const idx = selectVariantIdx(winningAd._id, variants.length);
        const variant = variants[idx] || { variantId: 'default', name: 'Default', bannerGraphic: winningAd.bannerGraphic, textHeader: winningAd.textHeader };
        
        setSearchPopCampaign(winningAd);
        setSearchPopAd(winningAd.productId);
        setActiveSearchVariant(variant);
        trackAdEvent(winningAd._id, 'impression', variant.variantId);

        setShowSearchPop(true);
      }
    }
  };

  // Category tag transition interceptor (Lifecycle Banner Interstitial)
  const handleTagClick = (tag: string) => {
    if (heroAds.length > 0) {
      setPendingTagTransition(tag);
      setActiveLifecycleIdx(0);
      setShowLifecyclePop(true);
    } else {
      setSelectedTag(tag);
    }
  };

  const allTags = Array.from(new Set(products.flatMap(p => p.aiTags || [])));

  // 1. Filter sponsored products matching current search/category
  const filteredSponsored = sponsoredAds
    .map(ad => ad.productId)
    .filter(p => p !== null && p !== undefined)
    .filter(p => {
      const matchSearch = p.title.toLowerCase().includes(appliedSearch.toLowerCase()) ||
        p.description?.toLowerCase().includes(appliedSearch.toLowerCase());
      const matchTag = !selectedTag || p.aiTags?.includes(selectedTag);
      return matchSearch && matchTag;
    });

  // 2. Filter organic products matching current search/category
  const filteredOrganic = products.filter(p => {
    const matchSearch = p.title.toLowerCase().includes(appliedSearch.toLowerCase()) ||
      p.description?.toLowerCase().includes(appliedSearch.toLowerCase());
    const matchTag = !selectedTag || p.aiTags?.includes(selectedTag);
    return matchSearch && matchTag;
  });

  // 3. Deduplicate: remove organic products that are already displayed as sponsored
  const sponsoredIds = new Set(filteredSponsored.map(p => p._id));
  const finalOrganic = filteredOrganic.filter(p => !sponsoredIds.has(p._id));

  // 4. Combine: sponsored items injected at index 0 and every N-th position (N = 4)
  const finalFiltered: any[] = [];
  let organicIdx = 0;
  let sponsoredIdx = 0;
  const N = 4;

  const totalCount = finalOrganic.length + filteredSponsored.length;
  for (let i = 0; i < totalCount; i++) {
    if (i % N === 0 && sponsoredIdx < filteredSponsored.length) {
      finalFiltered.push({ ...filteredSponsored[sponsoredIdx], isSponsored: true });
      sponsoredIdx++;
    } else if (organicIdx < finalOrganic.length) {
      finalFiltered.push({ ...finalOrganic[organicIdx], isSponsored: false });
      organicIdx++;
    } else if (sponsoredIdx < filteredSponsored.length) {
      finalFiltered.push({ ...filteredSponsored[sponsoredIdx], isSponsored: true });
      sponsoredIdx++;
    }
  }

  return (
    <div className="light-theme" style={{ minHeight: "100vh" }}>
      <Navbar />

      {/* Hero Section */}
      {/* Hero Section */}
      <section className="w-full min-h-screen flex flex-col items-center justify-start text-center bg-[#07070A] px-4 sm:px-6 lg:px-8 pb-16 pt-4 overflow-hidden relative">
        {/* Background Accent Glassmorphism Blobs & Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-40" />
        <div className="absolute top-0 left-0 right-0 h-[300px] bg-gradient-to-b from-purple-900/10 to-transparent pointer-events-none" />
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] rounded-full bg-purple-600/10 blur-[130px] pointer-events-none animate-pulse" style={{ animationDuration: '6s' }} />
        <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[450px] h-[450px] rounded-full bg-blue-600/10 blur-[130px] pointer-events-none animate-pulse" style={{ animationDuration: '8s' }} />

        {/* Defensive Navbar Spacer to decouple fixed header footprint */}
        <div className="h-20 sm:h-28 md:h-36 w-full block shrink-0" aria-hidden="true" />

        <div className="max-w-4xl mx-auto w-full flex flex-col items-center justify-start text-center space-y-6 sm:space-y-8 relative z-10">
          {/* Marketing Content & Search */}
          <div className={`flex flex-col items-center text-center w-full transition-all duration-1000 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
            {/* Inline Micro-Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-purple-500/20 bg-purple-950/30 backdrop-blur-md w-fit mb-4 text-purple-300 text-xs font-semibold tracking-wider uppercase shadow-[0_0_15px_rgba(168,85,247,0.1)]">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-ping" />
              <span>⚡ AI-Powered Ecosystem</span>
            </div>

            {/* Title */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-white tracking-tight leading-[1.12] mb-4 sm:mb-6">
              Discover Local Products<br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400">
                Driven by Smart AI
              </span>
            </h1>

            {/* Description */}
            <p className="text-xs sm:text-sm md:text-base text-slate-400 max-w-2xl font-normal leading-relaxed mb-6 sm:mb-8">
              Browse products from local vendors with smart AI recommendations, real-time negotiations, and easy checkout.
            </p>

            {/* Search Pill Container */}
            <div className="w-full max-w-2xl transition-all duration-300 relative z-20" ref={searchContainerRef}>
              <div 
                className="flex items-center gap-3 bg-[#111119]/90 border border-slate-800 rounded-xl p-1.5 focus-within:ring-2 focus-within:ring-purple-500/30 focus-within:border-purple-500 transition-all duration-300 shadow-2xl"
                style={{ minHeight: "58px" }}
              >
                <Search size={20} className="text-slate-400 shrink-0 ml-3" />
                <input
                  id="marketplace-search"
                  type="text"
                  placeholder="Search products, stores…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={() => setShowRecommendations(true)}
                  onKeyDown={e => e.key === 'Enter' && handleSearchSubmit()}
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    boxShadow: "none",
                    padding: "0.5rem 0",
                    color: "#fff",
                    fontSize: "0.95rem",
                    width: "100%",
                    height: "100%",
                    margin: 0,
                  }}
                />
                <button 
                  onClick={handleSearchSubmit}
                  className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-sm px-6 py-3 rounded-lg transition-all duration-300 hover:shadow-[0_0_15px_rgba(168,85,247,0.4)] tracking-wide active:scale-95 shrink-0"
                  style={{ minWidth: "100px" }}
                >
                  Search
                </button>
              </div>

              {/* Dynamic Search Autocomplete & Recommendation Dropdown */}
              {showRecommendations && (
                <div 
                  className="absolute left-0 right-0 mt-2 bg-[#0d0d14]/95 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-[0_10px_50px_rgba(0,0,0,0.8)] text-left z-50 overflow-hidden"
                  style={{ maxHeight: "480px", display: "flex", flexDirection: "column" }}
                >
                  <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-6 overflow-y-auto" style={{ maxHeight: "440px" }}>
                    
                    {/* Left Column: Autocomplete Phrases & Category Tags */}
                    <div className="flex flex-col gap-4 border-r border-slate-850/50 pr-4">
                      {/* Suggested Phrases */}
                      <div>
                        <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2">Suggested Keywords</h4>
                        {searchRecData.autocomplete.length === 0 ? (
                          <div className="text-slate-500 text-xs font-medium">Type to see suggestions...</div>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {searchRecData.autocomplete.map((phrase, idx) => (
                              <button
                                key={idx}
                                onClick={() => {
                                  setSearch(phrase);
                                  setAppliedSearch(phrase);
                                  setShowRecommendations(false);
                                }}
                                className="flex items-center gap-2 text-slate-300 hover:text-white hover:bg-white/5 transition-all py-1 px-2 rounded-lg text-xs font-semibold text-left w-full"
                              >
                                <Search size={12} className="text-purple-400" />
                                <span className="truncate">{phrase}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Matching Categories */}
                      <div>
                        <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2">Suggested Categories</h4>
                        {searchRecData.tags.length === 0 ? (
                          <div className="text-slate-500 text-xs font-medium">No matching categories</div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {searchRecData.tags.map((tag, idx) => (
                              <button
                                key={idx}
                                onClick={() => {
                                  handleTagClick(tag);
                                  setShowRecommendations(false);
                                }}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all"
                                style={{
                                  background: `${TAG_COLORS[tag.toLowerCase()] || '#8b5cf6'}18`,
                                  border: `1px solid ${TAG_COLORS[tag.toLowerCase()] || '#8b5cf6'}40`,
                                  color: TAG_COLORS[tag.toLowerCase()] || '#c084fc',
                                }}
                              >
                                <Tag size={10} />
                                {tag}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Middle Column: Matching Stores & Personalization */}
                    <div className="flex flex-col gap-4 border-r border-slate-850/50 pr-4">
                      {/* Matching Stores */}
                      <div>
                        <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2">Matching Stores</h4>
                        {searchRecData.stores.length === 0 ? (
                          <div className="text-slate-500 text-xs font-medium">No matching vendor stores</div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {searchRecData.stores.map((st: any) => (
                              <Link
                                key={st._id}
                                href={`/shop/${st.slug}`}
                                onClick={() => setShowRecommendations(false)}
                                className="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.02] border border-slate-800/40 hover:border-purple-500/30 hover:bg-white/[0.05] transition-all"
                              >
                                <div className="h-7 w-7 rounded-md bg-purple-950 flex items-center justify-center text-xs font-black text-purple-400 shrink-0">
                                  {st.name.charAt(0)}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-slate-200 text-xs font-bold truncate">{st.name}</div>
                                  <div className="text-slate-500 text-[10px] font-medium truncate">/{st.slug}</div>
                                </div>
                                <ArrowRight size={10} className="text-slate-600 ml-auto shrink-0" />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Personalized recommendations */}
                      <div>
                        <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2">Recommended for You</h4>
                        <div className="flex flex-col gap-2">
                          {searchRecData.personalized.slice(0, 3).map((p: any) => (
                            <Link
                              key={p._id}
                              href={`/shop/${p.storeId?.slug}/product/${p._id}`}
                              onClick={() => setShowRecommendations(false)}
                              className="flex items-center gap-2 p-1.5 rounded-lg bg-purple-950/10 border border-purple-500/10 hover:border-purple-500/30 transition-all w-full"
                            >
                              <div className="h-8 w-8 rounded bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center">
                                {p.images?.[0]?.url ? (
                                  <img src={getImageUrl(p.images[0].url)} alt={p.title} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-[9px] text-slate-600">📦</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-slate-200 text-xs font-bold truncate leading-tight">{p.title}</div>
                                <div className="text-[10px] text-purple-300 font-bold mt-0.5">Rs. {p.price.toLocaleString()}</div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Semantically Matched Products */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2">
                        {search.trim() ? "Semantic Product Matches" : "Trending Products"}
                      </h4>
                      {recLoading ? (
                        <div className="flex flex-col gap-2">
                          {[1, 2, 3].map(i => (
                            <div key={i} className="h-[48px] rounded bg-white/[0.02] animate-pulse" />
                          ))}
                        </div>
                      ) : searchRecData.products.length === 0 ? (
                        <div className="text-slate-500 text-xs font-medium">No product matches</div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {searchRecData.products.slice(0, 4).map((p: any) => (
                            <Link
                              key={p._id}
                              href={`/shop/${p.storeId?.slug}/product/${p._id}`}
                              onClick={() => setShowRecommendations(false)}
                              className="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.02] border border-slate-800/40 hover:border-purple-500/30 hover:bg-white/[0.05] transition-all"
                            >
                              <div className="h-9 w-9 rounded-md bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center">
                                {p.images?.[0]?.url ? (
                                  <img src={getImageUrl(p.images[0].url)} alt={p.title} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-xs text-slate-600">📦</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-slate-200 text-xs font-bold truncate leading-tight">{p.title}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-slate-400 text-[10px]">Rs. {p.price}</span>
                                  {p.searchRelevanceScore !== undefined && (
                                    <span className="text-emerald-400 text-[9px] font-bold">
                                      {p.searchRelevanceScore}% Match
                                    </span>
                                  )}
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Giant Landscape Rectangle Banner */}
          <div className={`w-full max-w-4xl mt-2 transition-all duration-1000 delay-200 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
            {(() => {
              const hasAds = heroAds.length > 0;
              
              // Foreground Active Layer data
              const activeAd = hasAds ? heroAds[activeHeroIdx] : null;
              const activeVariant = activeAd?.variants?.[0];
              const activeBanner = activeVariant?.bannerGraphic || activeAd?.bannerGraphic;
              const activeStoreSlug = activeAd?.productId?.storeId?.slug || 'store';
              const activeProductId = activeAd?.productId?._id;
              const activeTargetHref = hasAds 
                ? `/shop/${activeStoreSlug}/product/${activeProductId}` 
                : '/shop?search=cricket';

              // Background Buffered Layer data
              const bufferedAd = (hasAds && bufferedHeroIdx !== null) ? heroAds[bufferedHeroIdx] : null;
              const bufferedVariant = bufferedAd?.variants?.[0];
              const bufferedBanner = bufferedVariant?.bannerGraphic || bufferedAd?.bannerGraphic;

              // Text Overlay dynamic data (derived from overlayAdIdx)
              const overlayAd = hasAds ? heroAds[overlayAdIdx] : null;
              const overlayVariant = overlayAd?.variants?.[0];
              const adHeader = overlayVariant?.textHeader || overlayAd?.textHeader || overlayAd?.productId?.title || "Premium Cricket Gear";
              const adDesc = overlayAd?.productId?.description || "Up to 20% Off";

              return (
                <div className="relative w-full aspect-[16/9] md:aspect-[21/9] rounded-2xl overflow-hidden border border-slate-800 bg-[#0A0A0F] group hover:border-purple-500/40 transition-all duration-300 shadow-2xl shadow-purple-950/10">
                  
                  {/* Glossy Sheen Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out pointer-events-none z-30" />

                  {/* Carousel Indicators at the top-right */}
                  {hasAds && heroAds.length > 1 && (
                    <div className="absolute top-6 right-6 flex gap-1.5 items-center bg-[#0a0a0f]/65 backdrop-blur-md px-2.5 py-1.5 rounded-full border border-slate-800/80 z-30 shadow-md">
                      {heroAds.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            preloadAndTransition(idx, heroAds);
                          }}
                          className={`h-1.5 rounded-full transition-all duration-300 ${
                            idx === (bufferedHeroIdx !== null ? bufferedHeroIdx : activeHeroIdx) ? "w-4 bg-purple-400" : "w-1.5 bg-white/40"
                          }`}
                          aria-label={`Go to slide ${idx + 1}`}
                        />
                      ))}
                    </div>
                  )}

                  {/* DOUBLE-BUFFERED DOM NODE TECHNIQUE */}
                  
                  {/* ActiveBuffer (Foreground) */}
                  <Link 
                    href={activeTargetHref}
                    onClick={() => {
                      if (hasAds && activeAd) {
                        trackAdEvent(activeAd._id, 'conversion', activeVariant?.variantId || 'default');
                      }
                    }}
                    className={`ActiveBuffer absolute inset-0 w-full h-full z-10 transition-all duration-350 ease-in-out will-change-transform will-change-opacity ${
                      isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                    }`}
                  >
                    {activeBanner ? (
                      <div className="absolute inset-0 w-full h-full overflow-hidden">
                        <img 
                          src={getImageUrl(activeBanner)} 
                          alt="Promoted Banner Active" 
                          className="w-full h-full object-cover object-center transition-transform duration-750 ease-out group-hover:scale-[1.02]"
                          style={{ objectFit: 'cover', objectPosition: 'center' }}
                        />
                        {/* Overlay dark gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-[#07070a] via-[#07070a]/30 to-transparent" />
                      </div>
                    ) : (
                      <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-slate-900 via-purple-950/20 to-slate-950 flex flex-col justify-between p-8">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(124,58,237,0.1),transparent_60%)] pointer-events-none" />
                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
                      </div>
                    )}
                  </Link>

                  {/* IncomingBuffer (Background - pointer-events-none) */}
                  <div 
                    className="IncomingBuffer absolute inset-0 w-full h-full z-0 pointer-events-none will-change-transform will-change-opacity"
                  >
                    {bufferedBanner ? (
                      <div className="absolute inset-0 w-full h-full overflow-hidden">
                        <img 
                          src={getImageUrl(bufferedBanner)} 
                          alt="Promoted Banner Buffered" 
                          className="w-full h-full object-cover object-center"
                          style={{ objectFit: 'cover', objectPosition: 'center' }}
                        />
                        {/* Overlay dark gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-[#07070a] via-[#07070a]/30 to-transparent" />
                      </div>
                    ) : (
                      <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-slate-900 via-purple-950/20 to-slate-950">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(124,58,237,0.1),transparent_60%)] pointer-events-none" />
                      </div>
                    )}
                  </div>

                  {/* PRESTIGE HIGH-CONTRAST CENTRAL TYPOGRAPHY */}
                  <div className="absolute inset-0 flex flex-col justify-center items-center text-center p-6 bg-slate-950/40 backdrop-blur-[4px] z-20 pointer-events-none">
                    {/* Header Tag */}
                    <span className={`text-purple-400 font-black tracking-widest text-[10px] uppercase mb-2 transform transition-all duration-175 ease-out ${
                      overlayFade ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                    }`}>
                      SPONSORED PREMIER DEAL
                    </span>

                    {/* Main Title */}
                    <h2 className={`text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-none max-w-3xl transform transition-all duration-175 ease-out delay-75 ${
                      overlayFade ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                    }`}>
                      {adHeader}
                    </h2>

                    {/* Promotional Offer Badge */}
                    <span className={`text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400 font-bold font-mono mt-3 transform transition-all duration-175 ease-out delay-150 ${
                      overlayFade ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                    }`}>
                      {adDesc}
                    </span>
                  </div>

                </div>
              );
            })()}
          </div>

          {/* Trust Indicators */}
          <div className={`w-full transition-all duration-1000 delay-300 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
            <div className="w-full pt-6 border-t border-slate-900/80 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[10px] font-bold text-slate-500 tracking-widest uppercase">
              <span className="flex items-center gap-1.5 hover:text-slate-350 transition-colors duration-300">
                <span className="text-purple-400">🔥</span> Live Bidding Active
              </span>
              <span className="flex items-center gap-1.5 hover:text-slate-350 transition-colors duration-300">
                <span className="text-purple-400">⚡</span> 5% Commission Tier
              </span>
              <span className="flex items-center gap-1.5 hover:text-slate-350 transition-colors duration-300">
                <span className="text-purple-400">🛡️</span> Encrypted Disputes
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem 2rem 4rem" }}>
        {/* Tag filter bar */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "2rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginRight: "0.25rem", fontWeight: 600 }}>Categories:</span>
          <button
            id="tag-all"
            onClick={() => handleTagClick("")}
            style={{
              padding: "0.35rem 0.9rem",
              borderRadius: 20,
              fontSize: "0.78rem",
              cursor: "pointer",
              border: `1px solid ${!selectedTag ? "rgba(124,58,237,0.5)" : "var(--border-subtle)"}`,
              background: !selectedTag ? "rgba(124,58,237,0.08)" : "var(--bg-card)",
              color: !selectedTag ? "#7c3aed" : "var(--text-secondary)",
              fontWeight: 600,
              transition: "all 0.2s",
            }}
          >All</button>
          {allTags.map(tag => (
            <button
              key={tag}
              id={`tag-${tag.replace(/\s+/g, "-")}`}
              onClick={() => handleTagClick(tag === selectedTag ? "" : tag)}
              style={{
                padding: "0.35rem 0.9rem",
                borderRadius: 20,
                fontSize: "0.78rem",
                cursor: "pointer",
                border: `1px solid ${selectedTag === tag ? "rgba(124,58,237,0.5)" : "var(--border-subtle)"}`,
                background: selectedTag === tag ? "rgba(124,58,237,0.08)" : "var(--bg-card)",
                color: selectedTag === tag ? "#7c3aed" : "var(--text-secondary)",
                fontWeight: 500,
                transition: "all 0.2s",
                textTransform: "capitalize",
              }}
            >{tag}</button>
          ))}
        </div>

        {/* Section header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 800 }}>
            {selectedTag ? <><span className="gradient-text">{selectedTag}</span> Items</> : "Featured Products"}
          </h2>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 600 }}>{finalFiltered.length} results</span>
        </div>

        {/* Product Grid and Sidebar Layout */}
        <div style={{ display: "grid", gridTemplateColumns: sidebarAds.length > 0 ? "1fr 280px" : "1fr", gap: "2rem", alignItems: "start" }}>
          <div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "1.5rem",
            }}>
              {finalFiltered.map((product, i) => (
                <ProductCard
                  key={product._id}
                  product={product}
                  delay={i * 30}
                  tagColors={TAG_COLORS}
                  isSponsored={product.isSponsored}
                />
              ))}
            </div>

            {finalFiltered.length === 0 && (
              <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-muted)" }}>
                <ShoppingBag size={40} style={{ margin: "0 auto 1rem", opacity: 0.3 }} />
                <p>No products found for &ldquo;{search}&rdquo;</p>
              </div>
            )}
          </div>

          {/* Right Column: Sponsored Deals Sidebar */}
          {sidebarAds.length > 0 && (
            <aside style={{ display: "flex", flexDirection: "column", gap: "1.5rem", position: "sticky", top: "2.5rem" }}>
              <h4 style={{
                fontSize: "0.85rem",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--text-secondary)",
                borderBottom: "1px solid var(--border-subtle)",
                paddingBottom: "0.5rem",
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: "0.4rem"
              }}>
                ⭐ Promoted Deals
              </h4>

              {sidebarAds.slice(0, 4).map((ad: any) => {
                const prod = ad.productId;
                if (!prod) return null;
                const primaryImg = (prod.images || []).find((img: any) => img.isPrimary) || (prod.images || [])[0] || null;

                return (
                  <Link 
                    key={ad._id}
                    href={`/shop/${prod.storeId?.slug || 'store'}/product/${prod._id}`}
                    style={{ textDecoration: "none" }}
                  >
                    <div 
                      className="product-card" 
                      style={{
                        background: "#ffffff",
                        border: "1.2px solid rgba(124, 58, 237, 0.3)",
                        boxShadow: "0 6px 16px rgba(124, 58, 237, 0.05)",
                        borderRadius: "12px",
                        padding: "0.85rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.6rem",
                        transition: "transform 0.2s, box-shadow 0.2s"
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.transform = "translateY(-2px)";
                        e.currentTarget.style.boxShadow = "0 8px 24px rgba(124, 58, 237, 0.1)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.transform = "none";
                        e.currentTarget.style.boxShadow = "0 6px 16px rgba(124, 58, 237, 0.05)";
                      }}
                    >
                      <div style={{ aspectRatio: "16/10", overflow: "hidden", borderRadius: "8px", position: "relative" }}>
                        {ad.bannerGraphic ? (
                          <img src={getImageUrl(ad.bannerGraphic)} alt={ad.textHeader || prod.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : primaryImg?.url ? (
                          <img src={getImageUrl(primaryImg.url)} alt={prod.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", background: "#a855f7", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: "bold" }}>Promo</div>
                        )}
                        <span style={{
                          position: "absolute", top: 6, right: 6,
                          fontSize: "0.58rem", fontWeight: 800,
                          background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                          color: "#fff", borderRadius: "4px", padding: "0.15rem 0.35rem",
                          boxShadow: "0 2px 6px rgba(124,58,237,0.25)"
                        }}>Sponsored</span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", margin: 0 }}>
                          {prod.storeId?.name || "Local Store"}
                        </p>
                        <h5 style={{
                          fontSize: "0.78rem", fontWeight: 700,
                          color: "var(--text-primary)", margin: 0,
                          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                          overflow: "hidden", height: "2.4em", lineHeight: 1.2
                        }}>
                          {ad.textHeader || prod.title}
                        </h5>
                        <p style={{ fontSize: "0.9rem", fontWeight: 800, color: "#7c3aed", margin: "0.2rem 0 0" }}>
                          Rs. {Number(prod.price).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </aside>
          )}
        </div>

      </section>

      {/* Vendor CTA */}
      <section style={{
        background: "linear-gradient(135deg, rgba(124,58,237,0.04), rgba(59,130,246,0.02))",
        borderTop: "1px solid var(--border-subtle)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "4rem 2rem",
        textAlign: "center",
      }}>
        <Store size={32} style={{ color: "#7c3aed", margin: "0 auto 1rem" }} />
        <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginBottom: "0.75rem" }}>Are you a local vendor?</h2>
        <p style={{ color: "var(--text-secondary)", maxWidth: 500, margin: "0 auto 1.5rem", lineHeight: 1.6, fontSize: "0.9rem" }}>
          Open your digital storefront today. Promote your products with our manual bank transfer ad bidding system.
        </p>
        <Link href="/auth/register" className="btn-primary" style={{ fontSize: "0.88rem", padding: "0.7rem 1.8rem" }}>
          Open Your Store <ArrowRight size={14} />
        </Link>
      </section>

      {/* 1. Session Entry Pop-Up Modal (Sidebar Featured Deals Repurposed) */}
      {showEntryPop && sidebarAds.length > 0 && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(11, 11, 20, 0.85)",
          backdropFilter: "blur(10px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 99999,
          padding: "2rem"
        }}>
          <div className="glass-card animate-fade-up" style={{
            width: "100%",
            maxWidth: "460px",
            background: "#ffffff",
            borderRadius: "16px",
            overflow: "hidden",
            border: "1.5px solid rgba(124, 58, 237, 0.3)",
            boxShadow: "0 20px 50px rgba(124, 58, 237, 0.15)",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            padding: "1.5rem"
          }}>
            {/* Timed close button at top-right */}
            <button
              disabled={entryAdCountdown > 0}
              onClick={() => setShowEntryPop(false)}
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                padding: "0.4rem 0.8rem",
                borderRadius: "20px",
                background: entryAdCountdown > 0 ? "rgba(0,0,0,0.06)" : "#7c3aed",
                color: entryAdCountdown > 0 ? "var(--text-muted)" : "#ffffff",
                border: "none",
                fontSize: "0.75rem",
                fontWeight: 700,
                cursor: entryAdCountdown > 0 ? "default" : "pointer",
                transition: "all 0.2s"
              }}
            >
              {entryAdCountdown > 0 ? `Skip Ad in ${entryAdCountdown}s` : "Skip Ad →"}
            </button>

            {/* Ad Content */}
            {(() => {
              const ad = sidebarAds[0];
              const prod = ad?.productId;
              if (!prod) return <p style={{ color: "var(--text-muted)", padding: "2rem", textAlign: "center" }}>Loading Entry Deal...</p>;
              const primaryImg = (prod.images || []).find((img: any) => img.isPrimary) || (prod.images || [])[0] || null;

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1.5rem" }}>
                  <div style={{ aspectRatio: "16/10", overflow: "hidden", borderRadius: "10px", position: "relative" }}>
                    {activeEntryVariant?.bannerGraphic ? (
                      <img src={getImageUrl(activeEntryVariant.bannerGraphic)} alt={activeEntryVariant.textHeader || prod.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : ad?.bannerGraphic ? (
                      <img src={getImageUrl(ad.bannerGraphic)} alt={ad.textHeader || prod.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : primaryImg?.url ? (
                      <img src={getImageUrl(primaryImg.url)} alt={prod.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #7c3aed, #a855f7)" }} />
                    )}
                    <span style={{
                      position: "absolute", top: 10, left: 10,
                      fontSize: "0.6rem", fontWeight: 800,
                      background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                      color: "#fff", borderRadius: "4px", padding: "0.2rem 0.5rem"
                    }}>Sponsored Entry Deal ({activeEntryVariant?.name || 'Default'})</span>
                  </div>

                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", margin: 0 }}>
                      {prod.storeId?.name || "Featured Store"}
                    </p>
                    <h4 style={{ fontSize: "1.15rem", fontWeight: 800, margin: "0.3rem 0 0.5rem", color: "var(--text-primary)" }}>
                      {activeEntryVariant?.textHeader || ad.textHeader || prod.title}
                    </h4>
                    <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0.3rem 0 1rem", lineHeight: 1.4 }}>
                      {prod.description}
                    </p>
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem" }}>
                      <span style={{ fontSize: "1.2rem", fontWeight: 800, color: "#7c3aed" }}>
                        Rs. {Number(prod.price).toLocaleString()}
                      </span>
                      <Link
                        href={`/shop/${prod.storeId?.slug || 'store'}/product/${prod._id}`}
                        onClick={() => {
                          if (activeEntryVariant) {
                            trackAdEvent(ad._id, 'conversion', activeEntryVariant.variantId);
                          }
                          setShowEntryPop(false);
                        }}
                        className="btn-primary"
                        style={{ padding: "0.5rem 1.2rem", fontSize: "0.8rem", fontWeight: 700 }}
                      >
                        Claim Deal
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 2. Intent-Based Search Takeover Pop-Up Modal (Search Result Premium Boost Repurposed) */}
      {showSearchPop && searchPopAd && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(11, 11, 20, 0.8)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 99999,
          padding: "2rem"
        }}>
          <div className="glass-card animate-fade-up" style={{
            width: "100%",
            maxWidth: "480px",
            background: "#ffffff",
            borderRadius: "16px",
            overflow: "hidden",
            border: "1.5px solid rgba(124, 58, 237, 0.3)",
            boxShadow: "0 25px 60px rgba(124, 58, 237, 0.2)",
            padding: "1.5rem",
            position: "relative"
          }}>
            <button
              onClick={() => setShowSearchPop(false)}
              style={{
                position: "absolute", top: 16, right: 16,
                background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)"
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{
                  fontSize: "0.62rem", fontWeight: 800,
                  background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                  color: "#fff", borderRadius: "4px", padding: "0.2rem 0.5rem",
                  textTransform: "uppercase", letterSpacing: "0.05em"
                }}>Search Takeover Match ({activeSearchVariant?.name || 'Default'})</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "1rem", alignItems: "center" }}>
                <div style={{ width: 100, height: 100, borderRadius: "8px", overflow: "hidden" }}>
                  {activeSearchVariant?.bannerGraphic ? (
                    <img src={getImageUrl(activeSearchVariant.bannerGraphic)} alt={activeSearchVariant.textHeader || searchPopAd.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    (() => {
                      const primaryImg = (searchPopAd.images || []).find((img: any) => img.isPrimary) || (searchPopAd.images || [])[0] || null;
                      return primaryImg?.url ? (
                        <img src={getImageUrl(primaryImg.url)} alt={searchPopAd.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", background: "var(--bg-secondary)" }} />
                      );
                    })()
                  )}
                </div>

                <div>
                  <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", margin: 0 }}>
                    {searchPopAd.storeId?.name || "Local Seller"}
                  </p>
                  <h4 style={{ fontSize: "1.0rem", fontWeight: 800, color: "var(--text-primary)", margin: "0.2rem 0" }}>
                    {activeSearchVariant?.textHeader || searchPopAd.title}
                  </h4>
                  <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "#7c3aed" }}>
                    Rs. {Number(searchPopAd.price).toLocaleString()}
                  </span>
                </div>
              </div>

              <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4, margin: 0 }}>
                {searchPopAd.description}
              </p>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  onClick={() => {
                    if (searchPopCampaign && activeSearchVariant) {
                      trackAdEvent(searchPopCampaign._id, 'conversion', activeSearchVariant.variantId);
                    }
                    const primaryImg = (searchPopAd.images || []).find((img: any) => img.isPrimary) || (searchPopAd.images || [])[0] || null;
                    addToCart(searchPopAd._id, {
                      title: searchPopAd.title,
                      price: searchPopAd.price,
                      image: primaryImg?.url || "",
                      storeId: searchPopAd.storeId?._id || searchPopAd.storeId,
                      storeName: searchPopAd.storeId?.name || "Local Store",
                      storeSlug: searchPopAd.storeId?.slug || "store"
                    });
                    setShowSearchPop(false);
                  }}
                  className="btn-primary"
                  style={{
                    flex: 1, padding: "0.6rem", fontSize: "0.85rem", fontWeight: 700,
                    background: "linear-gradient(135deg, #7c3aed, #a855f7)", border: "none", color: "#fff",
                    borderRadius: "8px", cursor: "pointer"
                  }}
                >
                  ⚡ Add to Cart & Close
                </button>
                <button
                  onClick={() => setShowSearchPop(false)}
                  style={{
                    padding: "0.6rem 1rem", borderRadius: "8px", border: "1px solid var(--border-subtle)",
                    background: "var(--bg-secondary)", color: "var(--text-secondary)", fontSize: "0.85rem", cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Full-Screen Lifecycle Shift Pop-Up Modal (Lifecycle Banner Placement Repurposed) */}
      {showLifecyclePop && topBiddingHeroAds.length > 0 && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "#0b0b14",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 99999,
          padding: "2rem"
        }}>
          <div style={{
            width: "100%",
            maxWidth: "720px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.5rem",
            animation: "fadeIn 0.5s ease-in-out"
          }}>
            <span style={{
              fontSize: "0.65rem", fontWeight: 800,
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: "#fff", borderRadius: "4px", padding: "0.25rem 0.65rem",
              textTransform: "uppercase", letterSpacing: "0.08em"
            }}>Premium Lifecycle Segment Ad ({activeLifecycleVariant?.name || 'Default'})</span>

            <div style={{
              width: "100%", aspectRatio: "16/9", overflow: "hidden", borderRadius: "16px",
              boxShadow: "0 25px 60px rgba(124,58,237,0.25)", border: "1.5px solid rgba(124,58,237,0.3)",
              position: "relative"
            }}>
              {activeLifecycleVariant?.bannerGraphic ? (
                <img 
                  key={activeLifecycleIdx}
                  src={getImageUrl(activeLifecycleVariant.bannerGraphic)} 
                  alt="Premium Banner" 
                  style={{ width: "100%", height: "100%", objectFit: "cover", animation: "fadeIn 0.5s ease-in-out" }} 
                />
              ) : topBiddingHeroAds[activeLifecycleIdx]?.bannerGraphic ? (
                <img 
                  key={activeLifecycleIdx}
                  src={getImageUrl(topBiddingHeroAds[activeLifecycleIdx].bannerGraphic)} 
                  alt="Premium Banner" 
                  style={{ width: "100%", height: "100%", objectFit: "cover", animation: "fadeIn 0.5s ease-in-out" }} 
                />
              ) : (
                <div style={{ width: "100%", height: "100%", background: "radial-gradient(circle, rgba(124,58,237,0.2), transparent 70%)" }} />
              )}
            </div>

            <div style={{ textAlign: "center", color: "#ffffff", maxWidth: "600px" }} key={activeLifecycleIdx}>
              <p style={{ fontSize: "0.75rem", color: "#a855f7", fontWeight: 700, textTransform: "uppercase", margin: 0 }}>
                {topBiddingHeroAds[activeLifecycleIdx]?.productId?.storeId?.name || "Featured Store"}
              </p>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 900, color: "#ffffff", margin: "0.4rem 0 0.8rem", lineHeight: 1.2 }}>
                {activeLifecycleVariant?.textHeader || topBiddingHeroAds[activeLifecycleIdx]?.textHeader || topBiddingHeroAds[activeLifecycleIdx]?.productId?.title}
              </h2>
              <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: "0 0 1.5rem" }}>
                {topBiddingHeroAds[activeLifecycleIdx]?.productId?.description}
              </p>
            </div>

            <div style={{ display: "flex", gap: "1rem" }}>
              <Link
                href={`/shop/${topBiddingHeroAds[activeLifecycleIdx]?.productId?.storeId?.slug || 'store'}/product/${topBiddingHeroAds[activeLifecycleIdx]?.productId?._id}`}
                onClick={() => {
                  if (activeLifecycleVariant) {
                    trackAdEvent(topBiddingHeroAds[activeLifecycleIdx]._id, 'conversion', activeLifecycleVariant.variantId);
                  }
                  const targetTag = pendingTagTransition;
                  setSelectedTag(targetTag !== null ? targetTag : "");
                  setPendingTagTransition(null);
                  setShowLifecyclePop(false);
                }}
                className="btn-primary"
                style={{ padding: "0.75rem 2rem", fontSize: "0.9rem", fontWeight: 700 }}
              >
                Claim This Offer
              </Link>

              <button
                onClick={() => {
                  const targetTag = pendingTagTransition;
                  setSelectedTag(targetTag !== null ? targetTag : "");
                  setPendingTagTransition(null);
                  setShowLifecyclePop(false);
                }}
                style={{
                  padding: "0.75rem 1.5rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.25)",
                  background: "transparent", color: "rgba(255,255,255,0.8)", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer"
                }}
              >
                Skip Ad & Continue →
              </button>
            </div>
          </div>
        </div>
      )}

      <footer style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: 600 }}>
        © 2026 BazaarBoost — Intelligent Multi-Tenant Marketplace for Local Commerce
      </footer>
    </div>
  );
}

function ProductCard({ product, delay, tagColors, isSponsored }: { product: any; delay: number; tagColors: Record<string, string>; isSponsored?: boolean }) {
  const tagColor = tagColors[product.aiTags?.[0]] || "#7c3aed";
  const primaryImg = (product.images || []).find((img: any) => img.isPrimary)
    || (product.images || [])[0]
    || null;
  const extraCount = Math.max(0, (product.images || []).length - 1);
  const hasImage = !!primaryImg?.url;

  const { addToCart } = useCart();
  const [added, setAdded] = useState(false);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart(product._id, {
      title: product.title,
      price: product.price,
      image: primaryImg?.url || "",
      storeId: product.storeId?._id || product.storeId,
      storeName: product.storeId?.name || "Local Store",
      storeSlug: product.storeId?.slug || "store"
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const shopSlug = product.storeId?.slug || "store";
  const detailLink = `/shop/${shopSlug}/product/${product._id}`;

  const borderStyle = isSponsored 
    ? "1.5px solid var(--accent-primary)" 
    : "1px solid rgba(0,0,0,0.06)";
  
  const shadowStyle = isSponsored 
    ? "0 10px 25px rgba(124, 58, 237, 0.12), 0 0 15px rgba(124, 58, 237, 0.08)" 
    : undefined;

  return (
    <Link href={detailLink} style={{ textDecoration: "none" }} id={`product-card-${product._id}`}>
      <article
        className="product-card"
        style={{
          animationDelay: `${delay}ms`,
          display: "flex",
          flexDirection: "column",
          borderRadius: "12px",
          background: "#ffffff",
          border: borderStyle,
          boxShadow: shadowStyle,
          overflow: "hidden",
        }}
        aria-label={product.title}
      >
        <div className="product-image-wrapper" style={{ aspectRatio: "1/1", position: "relative" }}>
          {hasImage ? (
            <>
              <img
                src={getImageUrl(primaryImg.url)}
                alt={primaryImg.altText || product.title}
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              {extraCount > 0 && (
                <div className="image-count-badge" aria-hidden="true">
                  +{extraCount} more
                </div>
              )}
            </>
          ) : (
            <ProductImagePlaceholder tagColor={tagColor} size={36} showLabel />
          )}

          {product.aiTags?.[0] && (
            <div style={{
              position: "absolute", top: 10, left: 10, zIndex: 2,
              background: `rgba(255,255,255,0.9)`, border: `1px solid ${tagColor}40`,
              borderRadius: 20, padding: "0.2rem 0.55rem", fontSize: "0.65rem",
              color: tagColor, fontWeight: 700, textTransform: "capitalize",
              backdropFilter: "blur(4px)",
            }}>
              <Tag size={8} style={{ marginRight: 2, display: "inline", verticalAlign: "middle" }} />
              {product.aiTags[0]}
            </div>
          )}

          {isSponsored && (
            <div style={{
              position: "absolute", top: 10, right: 10, zIndex: 2,
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: "#ffffff", borderRadius: "6px", padding: "0.2rem 0.5rem",
              fontSize: "0.62rem", fontWeight: 800, textTransform: "uppercase",
              letterSpacing: "0.05em", boxShadow: "0 2px 6px rgba(124,58,237,0.3)"
            }}>
              Sponsored
            </div>
          )}

          <div className="product-quickview-overlay" aria-hidden="true">
            <span className="product-quickview-btn" style={{ fontSize: "0.7rem", padding: "0.35rem 0.85rem" }}>
              <Eye size={12} /> Inspect Details
            </span>
          </div>
        </div>

        <div style={{ padding: "0.85rem", flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>
            {product.storeId?.name || "Local Store"}
          </p>

          <h3 style={{
            fontWeight: 700,
            fontSize: "0.85rem",
            color: "var(--text-primary)",
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            height: "2.6em",
          }}>
            {product.title}
          </h3>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: "0.5rem" }}>
            <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#7c3aed" }}>
              Rs. {Number(product.price).toLocaleString()}
            </span>

            <button
              onClick={handleAdd}
              style={{
                background: added ? "#10b981" : "rgba(124, 58, 237, 0.08)",
                border: "none",
                borderRadius: "8px",
                padding: "0.4rem 0.8rem",
                color: added ? "#ffffff" : "#7c3aed",
                fontSize: "0.72rem",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              {added ? "Added" : "Add"}
            </button>
          </div>
        </div>
      </article>
    </Link>
  );
}

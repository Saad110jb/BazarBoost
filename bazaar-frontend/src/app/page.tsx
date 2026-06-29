import MarketplaceClient from "./MarketplaceClient";

export const dynamic = 'force-dynamic';

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const DEMO_PRODUCTS = [
  {
    _id: "1", title: "Premium Wireless Headphones", price: 79.99, aiTags: ["electronics", "audio"],
    storeId: { name: "Tech Haven", slug: "tech-haven" },
    description: "High-fidelity sound with noise cancellation and 40-hour battery life.",
    images: [], stock: 8,
  },
  {
    _id: "2", title: "Handwoven Leather Wallet", price: 34.99, aiTags: ["clothing & apparel"],
    storeId: { name: "Craft Corner", slug: "craft-corner" },
    description: "Genuine leather bifold wallet with RFID protection. Slim and durable.",
    images: [], stock: 25,
  },
  {
    _id: "3", title: "Organic Green Tea (100g)", price: 12.50, aiTags: ["groceries & food"],
    storeId: { name: "Nature's Best", slug: "natures-best" },
    description: "Certified organic loose-leaf green tea sourced from Himalayan farms.",
    images: [], stock: 50,
  },
  {
    _id: "4", title: "Ceramic Plant Pot Set (3pc)", price: 28.00, aiTags: ["home & kitchen"],
    storeId: { name: "Casa Verde", slug: "casa-verde" },
    description: "Minimalist ceramic pots with drainage holes. Perfect for indoor plants.",
    images: [], stock: 15,
  },
];

async function getProducts() {
  try {
    const res = await fetch(`${API}/api/products`, { cache: 'no-store' });
    if (!res.ok) return DEMO_PRODUCTS;
    const data = await res.json();
    return data.success && data.products && data.products.length > 0 ? data.products : DEMO_PRODUCTS;
  } catch (err) {
    console.error("Failed to fetch products on server-side rendering:", err);
    return DEMO_PRODUCTS;
  }
}

export default async function MarketplacePage() {
  const products = await getProducts();
  return <MarketplaceClient initialProducts={products} />;
}

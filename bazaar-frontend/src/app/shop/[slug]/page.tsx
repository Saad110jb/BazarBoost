import StorefrontClient from "./StorefrontClient";

export const dynamic = 'force-dynamic';

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

async function getStoreDetails(slug: string) {
  try {
    const res = await fetch(`${API}/api/auth/store/slug/${slug}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data.store : null;
  } catch (err) {
    console.error("Failed to fetch store details on server:", err);
    return null;
  }
}

async function getStoreProducts(storeId: string) {
  try {
    const res = await fetch(`${API}/api/products/store/${storeId}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.success ? data.products : [];
  } catch (err) {
    console.error("Failed to fetch storefront products on server:", err);
    return [];
  }
}

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getStoreDetails(slug);
  
  let products: any[] = [];
  if (store) {
    products = await getStoreProducts(store._id);
  }

  return <StorefrontClient initialProducts={products} />;
}

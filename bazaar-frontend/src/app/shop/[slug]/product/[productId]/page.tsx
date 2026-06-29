import ProductDetailClient from "./ProductDetailClient";

export const dynamic = 'force-dynamic';

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

async function getProductDetails(productId: string) {
  try {
    const res = await fetch(`${API}/api/products/${productId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data.product : null;
  } catch (err) {
    console.error("Failed to fetch product details on server:", err);
    return null;
  }
}

export default async function ProductDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await getProductDetails(productId);
  return <ProductDetailClient initialProduct={product} />;
}

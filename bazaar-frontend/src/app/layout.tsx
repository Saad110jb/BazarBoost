import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/context/CartContext";
import { NotificationContextProvider } from "@/context/NotificationContext";
import PushToast from "@/components/PushToast";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BazaarBoost — Intelligent Multi-Tenant Marketplace",
  description:
    "The intelligent, ad-driven multi-tenant marketplace for local commerce. Powered by local AI for product tagging, fraud detection, and smart recommendations.",
  keywords: "marketplace, local commerce, multi-tenant, vendors, AI, e-commerce",
  openGraph: {
    title: "BazaarBoost",
    description: "Intelligent Marketplace for Local Commerce",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={inter.className} suppressHydrationWarning>
        <CartProvider>
          <NotificationContextProvider>
            {children}
            <PushToast />
          </NotificationContextProvider>
        </CartProvider>
      </body>
    </html>
  );
}


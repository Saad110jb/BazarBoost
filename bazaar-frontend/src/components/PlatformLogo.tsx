import Image from 'next/image';
import Link from 'next/link';

interface PlatformLogoProps {
  variant?: 'default' | 'icon-only';
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function PlatformLogo({ variant = 'default', size = 32, className = '', style }: PlatformLogoProps) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`} style={{ textDecoration: "none", color: "inherit", display: "inline-flex", alignItems: "center", gap: "0.5rem", ...style }}>
      <Image
        src="/logo.png"
        alt="BazaarBoost Logo"
        width={size}
        height={size}
        priority
        className="object-contain"
        style={{ objectFit: "contain" }}
      />
      {variant !== 'icon-only' && (
        <span style={{ fontWeight: 800, fontSize: size >= 36 ? "1.2rem" : "1.2rem", letterSpacing: "-0.02em" }} className="font-extrabold tracking-tight text-slate-900 dark:text-white">
          Bazaar<span style={{ color: "#a855f7" }}>Boost</span>
        </span>
      )}
    </Link>
  );
}

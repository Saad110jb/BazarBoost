/**
 * ProductImagePlaceholder
 *
 * High-contrast fallback shown on the storefront grid when a vendor has not
 * uploaded any product photos. Uses an inline SVG so it:
 *   - Never makes a network request
 *   - Renders at any resolution without pixelation
 *   - Adapts to the category colour palette of the product
 *
 * Props:
 *   tagColor  — hex/CSS colour derived from product.aiTags[0] (default purple)
 *   size      — icon size in px (default 44)
 *   showLabel — whether to render "No Image Yet" text below the icon
 */

interface Props {
  tagColor?: string;
  size?: number;
  showLabel?: boolean;
}

export default function ProductImagePlaceholder({
  tagColor = "#7c3aed",
  size = 44,
  showLabel = true,
}: Props) {
  const bg1 = `${tagColor}22`;  // 13% alpha — subtle tinted background
  const bg2 = `${tagColor}08`;  // 3% alpha — near-transparent end of gradient

  return (
    <div
      className="product-image-placeholder"
      style={{
        background: `linear-gradient(145deg, ${bg1} 0%, ${bg2} 100%)`,
      }}
    >
      {/* SVG camera / image icon */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity: 0.45 }}
        aria-hidden="true"
      >
        {/* Outer camera body */}
        <rect x="2" y="6" width="20" height="15" rx="2.5" fill={tagColor} opacity="0.25" />
        {/* Lens ring */}
        <circle cx="12" cy="13" r="4" stroke={tagColor} strokeWidth="1.8" fill="none" opacity="0.7" />
        {/* Lens centre dot */}
        <circle cx="12" cy="13" r="1.4" fill={tagColor} opacity="0.6" />
        {/* Viewfinder bump */}
        <path
          d="M9 6V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"
          stroke={tagColor}
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.5"
        />
        {/* Flash dot */}
        <circle cx="18.5" cy="9.5" r="1" fill={tagColor} opacity="0.5" />
      </svg>

      {showLabel && (
        <span
          style={{
            fontSize: "0.65rem",
            fontWeight: 600,
            color: tagColor,
            opacity: 0.55,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          No Image Yet
        </span>
      )}
    </div>
  );
}

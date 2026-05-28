'use client';

/**
 * Brand marks for the accounting integrations. Simplified, recognisable
 * glyphs rendered in the workspace's amber/bone palette rather than the
 * vendors' full-colour logos — the dark workspace would clash with the
 * official blues, and using a tinted monogram keeps the surface native
 * while staying clearly identifiable (the provider name sits beside it).
 */

export function XeroIcon({ size = 22, color = '#13B5EA' }: { size?: number; color?: string }) {
  // Xero's mark is an "X" formed by a circle outline with a bold X.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="Xero">
      <circle cx="16" cy="16" r="15" fill={color} />
      <path
        d="M11 11 L16 16 L11 21 M21 11 L16 16 L21 21"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function MyobIcon({ size = 22, color = '#6100A5' }: { size?: number; color?: string }) {
  // MYOB's mark is a rounded purple square with a white "m".
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="MYOB">
      <rect x="1" y="1" width="30" height="30" rx="7" fill={color} />
      <path
        d="M8 22 V12 L13 18 L18 12 V22 M22 12 V22"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="22" cy="11.5" r="1.4" fill="#fff" />
    </svg>
  );
}

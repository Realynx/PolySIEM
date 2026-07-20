import type { SVGProps } from "react";

/**
 * PolySIEM mark: three rounded dashboard tiles form an abstract “L”, while the
 * AI spark completes the grid. `currentColor` lets every surface supply its
 * active theme color without coupling the mark to a specific palette.
 */
export function AppLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="8" height="8" rx="2.5" fill="currentColor" />
      <rect x="13" y="3" width="8" height="8" rx="2.5" fill="currentColor" opacity="0.68" />
      <rect x="3" y="13" width="8" height="8" rx="2.5" fill="currentColor" opacity="0.68" />
      <path
        d="M17 12.5c.15 2.55 1.95 4.35 4.5 4.5-2.55.15-4.35 1.95-4.5 4.5-.15-2.55-1.95-4.35-4.5-4.5 2.55-.15 4.35-1.95 4.5-4.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

"use client";

/**
 * Minimal inline sparkline for overlay rows: one series, no axes, no chart
 * lib. Null points are measurement gaps and break the line (a gap is not
 * zero). Stroke uses currentColor so the parent picks the token.
 */
export function Sparkline({
  points,
  width = 72,
  height = 16,
  className,
}: {
  points: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const finite = points.filter((p): p is number => p !== null && Number.isFinite(p));
  if (finite.length === 0) return null;
  const max = Math.max(...finite, 1e-9);
  const pad = 1.5;
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const y = (v: number) => pad + (1 - v / max) * (height - pad * 2);

  // Consecutive non-null runs become their own polyline; single points a dot.
  const segments: string[] = [];
  const dots: { cx: number; cy: number }[] = [];
  let run: string[] = [];
  points.forEach((p, i) => {
    if (p === null || !Number.isFinite(p)) {
      if (run.length === 1) {
        const [x, yv] = run[0].split(",").map(Number);
        dots.push({ cx: x, cy: yv });
      } else if (run.length > 1) segments.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${(pad + i * stepX).toFixed(1)},${y(p).toFixed(1)}`);
  });
  if (run.length === 1) {
    const [x, yv] = run[0].split(",").map(Number);
    dots.push({ cx: x, cy: yv });
  } else if (run.length > 1) segments.push(run.join(" "));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
      focusable="false"
    >
      {segments.map((seg, i) => (
        <polyline
          key={i}
          points={seg}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {dots.map((dot, i) => (
        <circle key={`d${i}`} cx={dot.cx} cy={dot.cy} r={1.5} fill="currentColor" />
      ))}
    </svg>
  );
}

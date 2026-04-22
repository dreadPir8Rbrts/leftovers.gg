/** Least-squares linear regression. Returns slope and intercept. */
export function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };
  const sumX  = points.reduce((s, p) => s + p.x, 0);
  const sumY  = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/** Generate evenly-spaced points for a best-fit line between minX and maxX. */
export function regressionLinePoints(
  points: { x: number; y: number }[],
  steps = 40,
): { x: number; y: number }[] {
  if (points.length < 2) return [];
  const { slope, intercept } = linearRegression(points);
  const xs   = points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const step = (maxX - minX) / steps;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = minX + i * step;
    return { x, y: slope * x + intercept };
  });
}

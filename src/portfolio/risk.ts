export function maxDrawdown(equityCurve: Iterable<number>): number {
  let peak: number | undefined;
  let worst = 0;
  for (const value of equityCurve) {
    if (peak === undefined || value > peak) peak = value;
    if (peak > 0) worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

export function hardStopTriggered(equityCurve: Iterable<number>, limit = -0.3): boolean {
  return maxDrawdown(equityCurve) <= limit;
}

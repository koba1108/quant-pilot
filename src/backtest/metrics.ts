export function cumulativeReturn(returns: Iterable<number>): number {
  let wealth = 1;
  for (const r of returns) wealth *= 1 + r;
  return wealth - 1;
}

export function annualizedReturn(monthlyReturns: number[]): number {
  if (monthlyReturns.length === 0) return 0;
  const wealth = monthlyReturns.reduce((w, r) => w * (1 + r), 1);
  const years = monthlyReturns.length / 12;
  return wealth ** (1 / years) - 1;
}

export function annualizedVolatility(monthlyReturns: number[]): number {
  if (monthlyReturns.length < 2) return 0;
  const mean = monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length;
  const variance = monthlyReturns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (monthlyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);
}

export function sharpe(monthlyReturns: number[], monthlyCashReturn = 0): number {
  const excess = monthlyReturns.map((r) => r - monthlyCashReturn);
  const vol = annualizedVolatility(excess);
  if (vol === 0 || excess.length === 0) return 0;
  return ((excess.reduce((a, b) => a + b, 0) / excess.length) * 12) / vol;
}

export function sortino(monthlyReturns: number[], monthlyCashReturn = 0): number {
  const excess = monthlyReturns.map((r) => r - monthlyCashReturn);
  if (excess.length === 0) return 0;
  const downside = excess.map((r) => Math.min(0, r));
  const downsideDev = Math.sqrt(downside.reduce((a, r) => a + r * r, 0) / downside.length) * Math.sqrt(12);
  if (downsideDev === 0) return 0;
  return ((excess.reduce((a, b) => a + b, 0) / excess.length) * 12) / downsideDev;
}

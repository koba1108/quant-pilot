import { compareText } from "../determinism.ts";

function followingMonth(label: string): string {
  if (!/^\d{4}-\d{2}$/.test(label)) throw new Error(`Invalid monthly return label: ${label}.`);
  const [year, month] = label.split("-").map(Number);
  if (month! < 1 || month! > 12) throw new Error(`Invalid monthly return label: ${label}.`);
  return new Date(Date.UTC(year!, month!, 1)).toISOString().slice(0, 7);
}

export function assertConsecutiveMonthlyLabels(labels: readonly string[]): void {
  if (labels.length > 0) followingMonth(labels[0]!);
  for (let index = 1; index < labels.length; index++) {
    const expected = followingMonth(labels[index - 1]!);
    if (labels[index] !== expected) {
      throw new Error(
        `Annualized robustness metrics require consecutive monthly frames; expected ${expected} after ${labels[index - 1]}, received ${labels[index]}.`,
      );
    }
  }
}

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

export interface LabeledReturn {
  label: string;
  return: number;
}

export function worstMonth(labels: readonly string[], monthlyReturns: readonly number[]): LabeledReturn | undefined {
  if (labels.length !== monthlyReturns.length) throw new Error("labels and monthlyReturns must have equal length.");
  return monthlyReturns
    .map((value, index) => ({ label: labels[index]!, return: value }))
    .sort((left, right) => left.return - right.return || compareText(left.label, right.label))[0];
}

export function worstYear(labels: readonly string[], monthlyReturns: readonly number[]): LabeledReturn | undefined {
  if (labels.length !== monthlyReturns.length) throw new Error("labels and monthlyReturns must have equal length.");
  const annual = new Map<string, number>();
  for (let index = 0; index < labels.length; index++) {
    const year = labels[index]!.slice(0, 4);
    annual.set(year, (annual.get(year) ?? 1) * (1 + monthlyReturns[index]!));
  }
  return [...annual].map(([label, wealth]) => ({ label, return: wealth - 1 }))
    .sort((left, right) => left.return - right.return || compareText(left.label, right.label))[0];
}

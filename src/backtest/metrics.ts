import { compareText } from "../determinism.ts";

function followingMonth(label: string): string {
  if (!/^\d{4}-\d{2}$/.test(label)) throw new Error(`Invalid monthly return label: ${label}.`);
  const [year, month] = label.split("-").map(Number);
  if (month! < 1 || month! > 12) throw new Error(`Invalid monthly return label: ${label}.`);
  return new Date(Date.UTC(year!, month!, 1)).toISOString().slice(0, 7);
}

function assertMonthlyReturn(value: number, index: number): void {
  if (!Number.isFinite(value) || value < -1) {
    throw new Error(`Invalid monthly return at index ${index}: ${value}.`);
  }
}

function assertMonthlyReturns(returns: readonly number[]): void {
  returns.forEach(assertMonthlyReturn);
}

function assertOrderedMonthlyLabels(labels: readonly string[]): void {
  let previous = "";
  for (const label of labels) {
    followingMonth(label);
    if (previous !== "" && label <= previous) {
      throw new Error(`Monthly return labels must be unique and ordered; received ${label} after ${previous}.`);
    }
    previous = label;
  }
}

export function assertConsecutiveMonthlyLabels(labels: readonly string[]): void {
  assertOrderedMonthlyLabels(labels);
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
  let index = 0;
  for (const r of returns) {
    assertMonthlyReturn(r, index);
    wealth *= 1 + r;
    index += 1;
  }
  return wealth - 1;
}

export function annualizedReturn(monthlyReturns: number[]): number {
  assertMonthlyReturns(monthlyReturns);
  if (monthlyReturns.length === 0) return 0;
  const wealth = monthlyReturns.reduce((w, r) => w * (1 + r), 1);
  const years = monthlyReturns.length / 12;
  return wealth ** (1 / years) - 1;
}

export function annualizedVolatility(monthlyReturns: number[]): number {
  assertMonthlyReturns(monthlyReturns);
  if (monthlyReturns.length < 2) return 0;
  const mean = monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length;
  const variance = monthlyReturns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (monthlyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);
}

export function sharpe(monthlyReturns: number[], monthlyCashReturn = 0): number {
  assertMonthlyReturns(monthlyReturns);
  if (!Number.isFinite(monthlyCashReturn) || monthlyCashReturn < -1) {
    throw new Error(`Invalid monthly cash return: ${monthlyCashReturn}.`);
  }
  const excess = monthlyReturns.map((r) => r - monthlyCashReturn);
  const vol = annualizedVolatility(excess);
  if (vol === 0 || excess.length === 0) return 0;
  return ((excess.reduce((a, b) => a + b, 0) / excess.length) * 12) / vol;
}

export function sortino(monthlyReturns: number[], monthlyCashReturn = 0): number {
  assertMonthlyReturns(monthlyReturns);
  if (!Number.isFinite(monthlyCashReturn) || monthlyCashReturn < -1) {
    throw new Error(`Invalid monthly cash return: ${monthlyCashReturn}.`);
  }
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

export interface LabeledAnnualReturn extends LabeledReturn {
  observedMonths: number;
  complete: boolean;
}

export function worstMonth(labels: readonly string[], monthlyReturns: readonly number[]): LabeledReturn | undefined {
  if (labels.length !== monthlyReturns.length) throw new Error("labels and monthlyReturns must have equal length.");
  assertOrderedMonthlyLabels(labels);
  assertMonthlyReturns(monthlyReturns);
  return monthlyReturns
    .map((value, index) => ({ label: labels[index]!, return: value }))
    .sort((left, right) => left.return - right.return || compareText(left.label, right.label))[0];
}

export function worstYear(
  labels: readonly string[],
  monthlyReturns: readonly number[],
): LabeledAnnualReturn | undefined {
  if (labels.length !== monthlyReturns.length) throw new Error("labels and monthlyReturns must have equal length.");
  assertConsecutiveMonthlyLabels(labels);
  assertMonthlyReturns(monthlyReturns);
  const annual = new Map<string, { wealth: number; months: string[] }>();
  for (let index = 0; index < labels.length; index++) {
    const year = labels[index]!.slice(0, 4);
    const existing = annual.get(year) ?? { wealth: 1, months: [] };
    existing.wealth *= 1 + monthlyReturns[index]!;
    existing.months.push(labels[index]!.slice(5, 7));
    annual.set(year, existing);
  }
  return [...annual].map(([label, value]) => ({
    label,
    return: value.wealth - 1,
    observedMonths: value.months.length,
    complete: value.months.length === 12
      && value.months[0] === "01"
      && value.months.at(-1) === "12",
  }))
    .sort((left, right) => left.return - right.return || compareText(left.label, right.label))[0];
}

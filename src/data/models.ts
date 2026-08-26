export interface UniverseMember {
  code: string;
  assetGroup: string;
  subgroup: string;
  role: string;
  listingDate: string;
  delistingDate?: string;
  minHistoryDays?: number;
  theme?: boolean;
}

export interface DailyBar {
  code: string;
  tradingDate: string;
  close: number;
  adjustedClose: number;
  volume?: number;
  tradingValue?: number;
}

export interface QuoteQuality {
  code: string;
  tradingDate: string;
  spreadBps?: number;
  depthJpy?: number;
}

export interface EligibilityPolicy {
  minHistoryDaysCore: number;
  minHistoryDaysTheme: number;
  minMonthlyTradingValueJpy: number;
  maxSpreadBpsCore: number;
  maxSpreadBpsTheme: number;
}

export const defaultEligibilityPolicy: EligibilityPolicy = {
  minHistoryDaysCore: 252,
  minHistoryDaysTheme: 504,
  minMonthlyTradingValueJpy: 50_000_000,
  maxSpreadBpsCore: 100,
  maxSpreadBpsTheme: 75,
};

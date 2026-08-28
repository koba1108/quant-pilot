export interface AssetSnapshot {
  code: string;
  r3m: number;
  r6m: number;
  r12m: number;
  volatility: number;
  eligible?: boolean;
}

export interface RankedAsset {
  code: string;
  score: number;
  volatility: number;
}

export interface TrendStrategyParameters {
  r3mWeight: number;
  r6mWeight: number;
  r12mWeight: number;
  requirePositiveR12m: boolean;
}

export interface RotationStrategyParameters {
  r6mWeight: number;
  r12mWeight: number;
  volatilityPenalty: number;
  requirePositiveR12m: boolean;
}

export interface StrategyParameterOverrides {
  trend?: TrendStrategyParameters;
  rotation?: RotationStrategyParameters;
}

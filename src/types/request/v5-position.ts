import {
  CategoryV5,
  ExecTypeV5,
  OrderTriggerByV5,
  OrderTypeV5,
  PositionIdx,
  TPSLModeV5,
} from '../v5-shared';

export interface PositionInfoParamsV5 {
  category: CategoryV5;
  symbol?: string;
  baseCoin?: string;
  settleCoin?: string;
  limit?: number;
  cursor?: string;
}

export interface SetLeverageParamsV5 {
  category: 'linear' | 'inverse';
  symbol: string;
  buyLeverage: string;
  sellLeverage: string;
}

export interface SwitchIsolatedMarginParamsV5 {
  category: 'linear' | 'inverse';
  symbol: string;
  tradeMode: 0 | 1;
  buyLeverage: string;
  sellLeverage: string;
}

export interface SetTPSLModeParamsV5 {
  category: 'linear' | 'inverse';
  symbol: string;
  tpSlMode: TPSLModeV5;
}

export interface SwitchPositionModeParamsV5 {
  category: 'linear' | 'inverse';
  symbol?: string;
  coin?: string;
  mode: 0 | 3;
}

export interface SetRiskLimitParamsV5 {
  category: 'linear' | 'inverse';
  symbol: string;
  riskId: number;
  positionIdx?: PositionIdx;
}

export interface SetTradingStopParamsV5 {
  category: CategoryV5;
  symbol: string;
  takeProfit?: string;
  stopLoss?: string;
  trailingStop?: string;
  tpTriggerBy?: OrderTriggerByV5;
  slTriggerBy?: OrderTriggerByV5;
  activePrice?: string;
  tpslMode?: TPSLModeV5;
  tpSize?: string;
  slSize?: string;
  tpLimitPrice?: string;
  slLimitPrice?: string;
  tpOrderType?: OrderTypeV5;
  slOrderType?: OrderTypeV5;
  positionIdx: PositionIdx;
}

export interface SetAutoAddMarginParamsV5 {
  category: 'linear';
  symbol: string;
  autoAddMargin: 0 | 1;
  positionIdx?: PositionIdx;
}

export interface AddOrReduceMarginParamsV5 {
  category: 'linear' | 'inverse';
  symbol: string;
  margin: string;
  positionIDex?: PositionIdx;
}

export interface GetExecutionListParamsV5 {
  category: CategoryV5;
  symbol?: string;
  orderId?: string;
  orderLinkId?: string;
  baseCoin?: string;
  startTime?: number;
  endTime?: number;
  execType?: ExecTypeV5;
  limit?: number;
  cursor?: string;
}

export interface GetClosedPnLParamsV5 {
  category: CategoryV5;
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  cursor?: string;
}

import { RestClientV5 } from '../rest-client-v5';

export type RESTClient =
  | RestClientV5;

export type numberInString = string;

export type OrderSide = 'Buy' | 'Sell';

export type KlineInterval =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '12h'
  | '1d'
  | '1w'
  | '1M';

export type KlineIntervalV5 =
  | '1'
  | '3'
  | '5'
  | '15'
  | '30'
  | '60'
  | '120'
  | '240'
  | '360'
  | '720'
  | 'D'
  | 'W'
  | 'M';

export interface APIResponse<T> {
  ret_code: number;
  ret_msg: 'OK' | string;
  ext_code: string | null;
  ext_info: string | null;
  result: T;
}

export interface APIRateLimit {
  /** Remaining requests to this endpoint before the next reset */
  remainingRequests: number;
  /** Max requests for this endpoint per rollowing window (before next reset) */
  maxRequests: number;
  /**
   * Timestamp when the rate limit resets if you have exceeded your current maxRequests.
   * Otherwise, this is approximately your current timestamp.
   */
  resetAtTimestamp: number;
}

export interface APIResponseV3<T> {
  retCode: number;
  retMsg: 'OK' | string;
  result: T;
  /**
   * These are per-UID per-endpoint rate limits, automatically parsed from response headers if available.
   *
   * Note:
   * - this is primarily for V5 (or newer) APIs.
   * - these rate limits are per-endpoint per-account, so will not appear for public API calls
   */
  rateLimitApi?: APIRateLimit;
}

export type APIResponseV3WithTime<T> = APIResponseV3<T> & { time: number };

export interface APIResponseWithTime<T = {}> extends APIResponse<T> {
  /** UTC timestamp */
  time_now: numberInString;
}
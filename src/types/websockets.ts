import { RestClientOptions, WS_KEY_MAP } from "../util";


/** For spot markets, spotV3 is recommended */
export type APIMarket =
  | 'v5';

export type WsPublicTopics = | string;

export type WsPrivateTopic = string;

export type WsTopic = WsPublicTopics | WsPrivateTopic;

/** This is used to differentiate between each of the available websocket streams (as bybit has multiple websockets) */
export type WsKey = (typeof WS_KEY_MAP)[keyof typeof WS_KEY_MAP];

export interface WSClientConfigurableOptions {
  key?: string;
  secret?: string;
  testnet?: boolean;

  /**
   * The API group this client should connect to.
   *
   * For the V3 APIs use `v3` as the market (spot/unified margin/usdc/account asset/copy trading)
   */
  market: APIMarket;

  pongTimeout?: number;
  pingInterval?: number;
  reconnectTimeout?: number;
  /** Override the recv window for authenticating over websockets (default: 5000 ms) */
  recvWindow?: number;
  restOptions?: RestClientOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestOptions?: any;
  wsUrl?: string;
  /** If true, fetch server time before trying to authenticate (disabled by default) */
  fetchTimeOffsetBeforeAuth?: boolean;
}

export interface WebsocketClientOptions extends WSClientConfigurableOptions {
  testnet?: boolean;
  market: APIMarket;
  pongTimeout: number;
  pingInterval: number;
  reconnectTimeout: number;
}

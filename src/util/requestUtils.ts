import { APIRateLimit } from '../types';
import { WebsocketSucceededTopicSubscriptionConfirmationEvent } from '../types/ws-events/succeeded-topic-subscription-confirmation';
import { WebsocketTopicSubscriptionConfirmationEvent } from '../types/ws-events/topic-subscription-confirmation';

export interface RestClientOptions {
  /** Your API key */
  key?: string;

  /** Your API secret */
  secret?: string;

  /** Set to `true` to connect to testnet. Uses the live environment by default. */
  testnet?: boolean;

  /** Override the max size of the request window (in ms) */
  recv_window?: number;

  /**
   * Disabled by default.
   * This can help on machines with consistent latency problems.
   *
   * Note: this feature is not recommended as one slow request can cause problems
   */
  enable_time_sync?: boolean;

  /** How often to sync time drift with bybit servers */
  sync_interval_ms?: number | string;

  /** Determines whether to perform time synchronization before sending private requests */
  syncTimeBeforePrivateRequests?: false;

  /** Default: false. If true, we'll throw errors if any params are undefined */
  strict_param_validation?: boolean;

  /**
   * Default: true.
   * If true, request parameters will be URI encoded during the signing process.
   * New behaviour introduced in v3.2.1 to fix rare parameter-driven sign errors with unified margin cursors containing "%".
   */
  encodeSerialisedValues?: boolean;

  /**
   * Optionally override API protocol + domain
   * e.g baseUrl: 'https://api.bytick.com'
   **/
  baseUrl?: string;

  /** Default: true. whether to try and post-process request exceptions. */
  parse_exceptions?: boolean;

  /** Default: false. Enable to parse/include per-API/endpoint rate limits in responses. */
  parseAPIRateLimits?: boolean;

  /** Default: false. Enable to throw error if rate limit parser fails */
  throwOnFailedRateLimitParse?: boolean;
}

/**
 * Serialise a (flat) object into a query string
 * @param params the object to serialise
 * @param strict_validation throw if any properties are undefined
 * @param sortProperties sort properties alphabetically before building a query string
 * @param encodeSerialisedValues URL encode value before serialising
 * @returns the params object as a serialised string key1=value1&key2=value2&etc
 */
export function serializeParams(
  params: Record<string, string | undefined> = {},
  strict_validation = false,
  sortProperties = true,
  encodeSerialisedValues = true,
): string {
  const properties = sortProperties
    ? Object.keys(params).sort()
    : Object.keys(params);

  return properties
    .map((key) => {
      const value = encodeSerialisedValues
        ? encodeURIComponent(params[key] || '')
        : params[key];

      if (strict_validation === true && typeof value === 'undefined') {
        throw new Error(
          'Failed to sign API request due to undefined parameter',
        );
      }
      return `${key}=${value}`;
    })
    .join('&');
}

export function getRestBaseUrl(
  useTestnet: boolean,
  restInverseOptions: RestClientOptions,
): string {
  const exchangeBaseUrls = {
    livenet: 'https://api.bybit.com',
    testnet: 'https://api-testnet.bybit.com',
  };

  if (restInverseOptions.baseUrl) {
    return restInverseOptions.baseUrl;
  }

  if (useTestnet) {
    return exchangeBaseUrls.testnet;
  }

  return exchangeBaseUrls.livenet;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isWsPong(msg: any): boolean {
  if (!msg) {
    return false;
  }
  if (msg.pong || msg.ping) {
    return true;
  }

  if (msg['op'] === 'pong') {
    return true;
  }

  if (msg['ret_msg'] === 'pong') {
    return true;
  }

  return (
    msg.request &&
    msg.request.op === 'ping' &&
    msg.ret_msg === 'pong' &&
    msg.success === true
  );
}

export function isTopicSubscriptionConfirmation(
  msg: unknown,
): msg is WebsocketTopicSubscriptionConfirmationEvent {
  if (!msg || typeof msg !== 'object') {
    return false;
  }

  const message = msg as WebsocketTopicSubscriptionConfirmationEvent;

  if (message.op !== 'subscribe') {
    return false;
  }

  return true;
}

export function isTopicSubscriptionSuccess(
  msg: unknown,
): msg is WebsocketSucceededTopicSubscriptionConfirmationEvent {
  if (!isTopicSubscriptionConfirmation(msg)) return false;
  return msg.success === true;
}

export const APIID = 'bybitapinode';

/**
 * Used to switch how authentication/requests work under the hood (primarily for SPOT since it's different there)
 */
export const REST_CLIENT_TYPE_ENUM = {
  accountAsset: 'accountAsset',
  inverse: 'inverse',
  inverseFutures: 'inverseFutures',
  linear: 'linear',
  spot: 'spot',
  v3: 'v3',
} as const;

export type RestClientType =
  (typeof REST_CLIENT_TYPE_ENUM)[keyof typeof REST_CLIENT_TYPE_ENUM];

/** Parse V5 rate limit response headers, if enabled */
export function parseRateLimitHeaders(
  headers: Record<string, string | undefined> = {},
  throwOnFailedRateLimitParse: boolean,
): APIRateLimit | undefined {
  try {
    const remaining = headers['x-bapi-limit-status'];
    const max = headers['x-bapi-limit'];
    const resetAt = headers['x-bapi-limit-reset-timestamp'];

    if (
      typeof remaining === 'undefined' ||
      typeof max === 'undefined' ||
      typeof resetAt === 'undefined'
    ) {
      return;
    }

    const result: APIRateLimit = {
      remainingRequests: Number(remaining),
      maxRequests: Number(max),
      resetAtTimestamp: Number(resetAt),
    };

    if (
      isNaN(result.remainingRequests) ||
      isNaN(result.maxRequests) ||
      isNaN(result.resetAtTimestamp)
    ) {
      return;
    }

    return result;
  } catch (e) {
    if (throwOnFailedRateLimitParse) {
      console.log(
        new Date(),
        'parseRateLimitHeaders()',
        'Failed to parse rate limit headers',
        {
          headers,
          exception: e,
        },
      );
      throw e;
    }
  }

  return undefined;
}
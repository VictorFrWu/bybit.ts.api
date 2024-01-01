import { APIMarket, CategoryV5, WsKey } from '../types';
import { DefaultLogger } from './logger';

interface NetworkMapV3 {
  livenet: string;
  livenet2?: string;
  testnet: string;
  testnet2?: string;
}

type PublicPrivateNetwork = 'public' | 'private';

/**
 * The following WS keys are logical.
 *
 * They're not directly used as a market. They usually have one private endpoint but many public ones,
 * so they need a bit of extra handling for seamless messaging between endpoints.
 *
 * For the unified keys, the "split" happens using the symbol. Symbols suffixed with USDT are obviously USDT topics.
 * For the v5 endpoints, the subscribe/unsubscribe call must specify the category the subscription should route to.
 */
type PublicOnlyWsKeys =
  | 'v5SpotPublic'
  | 'v5LinearPublic'
  | 'v5InversePublic'
  | 'v5OptionPublic';

export const WS_BASE_URL_MAP: Record<
  APIMarket,
  Record<PublicPrivateNetwork, NetworkMapV3>
> &
  Record<PublicOnlyWsKeys, Record<'public', NetworkMapV3>> = {
  v5: {
    public: {
      livenet: 'public topics are routed internally via the public wskeys',
      testnet: 'public topics are routed internally via the public wskeys',
    },
    private: {
      livenet: 'wss://stream.bybit.com/v5/private',
      testnet: 'wss://stream-testnet.bybit.com/v5/private',
    },
  },
  v5SpotPublic: {
    public: {
      livenet: 'wss://stream.bybit.com/v5/public/spot',
      testnet: 'wss://stream-testnet.bybit.com/v5/public/spot',
    },
  },
  v5LinearPublic: {
    public: {
      livenet: 'wss://stream.bybit.com/v5/public/linear',
      testnet: 'wss://stream-testnet.bybit.com/v5/public/linear',
    },
  },
  v5InversePublic: {
    public: {
      livenet: 'wss://stream.bybit.com/v5/public/inverse',
      testnet: 'wss://stream-testnet.bybit.com/v5/public/inverse',
    },
  },
  v5OptionPublic: {
    public: {
      livenet: 'wss://stream.bybit.com/v5/public/option',
      testnet: 'wss://stream-testnet.bybit.com/v5/public/option',
    },
  },
};

export const WS_KEY_MAP = {
  v5SpotPublic: 'v5SpotPublic',
  v5LinearPublic: 'v5LinearPublic',
  v5InversePublic: 'v5InversePublic',
  v5OptionPublic: 'v5OptionPublic',
  v5Private: 'v5Private',
} as const;

export const WS_AUTH_ON_CONNECT_KEYS: WsKey[] = [
  WS_KEY_MAP.v5Private,
];

export const PUBLIC_WS_KEYS = [
  WS_KEY_MAP.v5SpotPublic,
  WS_KEY_MAP.v5LinearPublic,
  WS_KEY_MAP.v5InversePublic,
  WS_KEY_MAP.v5OptionPublic,
] as string[];

/** Used to automatically determine if a sub request should be to the public or private ws (when there's two) */
const PRIVATE_TOPICS = [
  // v5
  'position',
  'execution',
  'order',
  'wallet',
  'greeks',
  'dcp',
];

export function isPrivateWsTopic(topic: string): boolean {
  return PRIVATE_TOPICS.includes(topic);
}

export function getWsKeyForTopic(
  market: APIMarket,
  topic: string,
  isPrivate?: boolean,
  category?: CategoryV5,
): WsKey {
  const isPrivateTopic = isPrivate === true || PRIVATE_TOPICS.includes(topic);
  switch (market) {
    case 'v5': {
      if (isPrivateTopic) {
        return WS_KEY_MAP.v5Private;
      }

      switch (category) {
        case 'spot': {
          return WS_KEY_MAP.v5SpotPublic;
        }
        case 'linear': {
          return WS_KEY_MAP.v5LinearPublic;
        }
        case 'inverse': {
          return WS_KEY_MAP.v5InversePublic;
        }
        case 'option': {
          return WS_KEY_MAP.v5OptionPublic;
        }
        case undefined: {
          throw new Error('Category cannot be undefined');
        }
        default: {
          throw neverGuard(
            category,
            'getWsKeyForTopic(v5): Unhandled v5 category',
          );
        }
      }
    }
    default: {
      throw neverGuard(market, 'getWsKeyForTopic(): Unhandled market');
    }
  }
}

export function getWsUrl(
  wsKey: WsKey,
  wsUrl: string | undefined,
  isTestnet: boolean,
  logger: typeof DefaultLogger,
): string {
  if (wsUrl) {
    return wsUrl;
  }

  const networkKey = isTestnet ? 'testnet' : 'livenet';

  switch (wsKey) {
    case WS_KEY_MAP.v5Private: {
      return WS_BASE_URL_MAP.v5.private[networkKey];
    }
    case WS_KEY_MAP.v5SpotPublic: {
      return WS_BASE_URL_MAP.v5SpotPublic.public[networkKey];
    }
    case WS_KEY_MAP.v5LinearPublic: {
      return WS_BASE_URL_MAP.v5LinearPublic.public[networkKey];
    }
    case WS_KEY_MAP.v5InversePublic: {
      return WS_BASE_URL_MAP.v5InversePublic.public[networkKey];
    }
    case WS_KEY_MAP.v5OptionPublic: {
      return WS_BASE_URL_MAP.v5OptionPublic.public[networkKey];
    }
    default: {
      logger.error('getWsUrl(): Unhandled wsKey: ', {
        category: 'bybit-ws',
        wsKey,
      });
      throw neverGuard(wsKey, 'getWsUrl(): Unhandled wsKey');
    }
  }
}

export function getMaxTopicsPerSubscribeEvent(
  market: APIMarket,
  wsKey: WsKey,
): number | null {
  const topicsPerEventSpot = 10;
  switch (market) {
    case 'v5': {
      if (wsKey === WS_KEY_MAP.v5SpotPublic) {
        return topicsPerEventSpot;
      }
      return null;
    }
    default: {
      throw neverGuard(market, 'getWsKeyForTopic(): Unhandled market');
    }
  }
}

export function neverGuard(x: never, msg: string): Error {
  return new Error(`Unhandled value exception "x", ${msg}`);
}
/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import WebSocket from 'isomorphic-ws';

import { signMessage } from './util/node-support';
import WsStore from './util/WsStore';

import {
  APIMarket,
  CategoryV5,
  KlineInterval,
  RESTClient,
  WSClientConfigurableOptions,
  WebsocketClientOptions,
  WsKey,
  WsTopic,
} from './types';

import {
  DefaultLogger,
  PUBLIC_WS_KEYS,
  WS_AUTH_ON_CONNECT_KEYS,
  WS_KEY_MAP,
  WsConnectionStateEnum,
  getMaxTopicsPerSubscribeEvent,
  getWsKeyForTopic,
  getWsUrl,
  isTopicSubscriptionConfirmation,
  isTopicSubscriptionSuccess,
  isWsPong,
  neverGuard,
  serializeParams,
} from './util';
import { RestClientV5 } from './rest-client-v5';
import { WebsocketTopicSubscriptionConfirmationEvent } from './types/ws-events/topic-subscription-confirmation';

const loggerCategory = { category: 'bybit-ws' };

export type WsClientEvent =
  | 'open'
  | 'update'
  | 'close'
  | 'error'
  | 'reconnect'
  | 'reconnected'
  | 'response';

interface WebsocketClientEvents {
  /** Connection opened. If this connection was previously opened and reconnected, expect the reconnected event instead */
  open: (evt: { wsKey: WsKey; event: any }) => void;
  /** Reconnecting a dropped connection */
  reconnect: (evt: { wsKey: WsKey; event: any }) => void;
  /** Successfully reconnected a connection that dropped */
  reconnected: (evt: { wsKey: WsKey; event: any }) => void;
  /** Connection closed */
  close: (evt: { wsKey: WsKey; event: any }) => void;
  /** Received reply to websocket command (e.g. after subscribing to topics) */
  response: (response: any) => void;
  /** Received data for topic */
  update: (response: any) => void;
  /** Exception from ws client OR custom listeners */
  error: (response: any) => void;
}

type TopicsPendingSubscriptionsResolver = () => void;
type TopicsPendingSubscriptionsRejector = (reason: string) => void;

interface TopicsPendingSubscriptions {
  wsKey: string;
  failedTopicsSubscriptions: Set<string>;
  pendingTopicsSubscriptions: Set<string>;
  resolver: TopicsPendingSubscriptionsResolver;
  rejector: TopicsPendingSubscriptionsRejector;
}

// Type safety for on and emit handlers: https://stackoverflow.com/a/61609010/880837
export declare interface WebsocketClient {
  on<U extends keyof WebsocketClientEvents>(
    event: U,
    listener: WebsocketClientEvents[U],
  ): this;

  emit<U extends keyof WebsocketClientEvents>(
    event: U,
    ...args: Parameters<WebsocketClientEvents[U]>
  ): boolean;
}

// eslint-disable-next-line no-redeclare
export class WebsocketClient extends EventEmitter {
  private logger: typeof DefaultLogger;

  private restClient?: RESTClient;

  private options: WebsocketClientOptions;

  private wsStore: WsStore;

  private pendingTopicsSubscriptions: TopicsPendingSubscriptions[] = [];

  constructor(
    options: WSClientConfigurableOptions,
    logger?: typeof DefaultLogger,
  ) {
    super();

    this.logger = logger || DefaultLogger;
    this.wsStore = new WsStore(this.logger);

    this.options = {
      testnet: false,
      pongTimeout: 1000,
      pingInterval: 10000,
      reconnectTimeout: 500,
      recvWindow: 5000,
      fetchTimeOffsetBeforeAuth: false,
      ...options,
    };
    this.options.restOptions = {
      ...this.options.restOptions,
      testnet: this.options.testnet,
    };

    this.prepareRESTClient();

    // add default error handling so this doesn't crash node (if the user didn't set a handler)
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    this.on('error', () => {});
  }

  /** Get the WsStore that tracks websockets & topics */
  public getWsStore(): WsStore {
    return this.wsStore;
  }

  public isTestnet(): boolean {
    return this.options.testnet === true;
  }

  /**
   * Subscribe to V5 topics & track/persist them.
   * @param wsTopics - topic or list of topics
   * @param category - the API category this topic is for (e.g. "linear"). The value is only important when connecting to public topics and will be ignored for private topics.
   * @param isPrivateTopic - optional - the library will try to detect private topics, you can use this to mark a topic as private (if the topic isn't recognised yet)
   */
  public subscribeV5(
    wsTopics: WsTopic[] | WsTopic,
    category: CategoryV5,
    isPrivateTopic?: boolean,
  ) {
    const topics = Array.isArray(wsTopics) ? wsTopics : [wsTopics];

    return new Promise<void>((resolver, rejector) => {
      topics.forEach((topic) => {
        const wsKey = getWsKeyForTopic(
          this.options.market,
          topic,
          isPrivateTopic,
          category,
        );

        // Persist topic for reconnects
        this.wsStore.addTopic(wsKey, topic);
        this.upsertPendingTopicsSubscriptions(wsKey, topic, resolver, rejector);

        // if connected, send subscription request
        if (
          this.wsStore.isConnectionState(wsKey, WsConnectionStateEnum.CONNECTED)
        ) {
          return this.requestSubscribeTopics(wsKey, [topic]);
        }

        // start connection process if it hasn't yet begun. Topics are automatically subscribed to on-connect
        if (
          !this.wsStore.isConnectionState(
            wsKey,
            WsConnectionStateEnum.CONNECTING,
          ) &&
          !this.wsStore.isConnectionState(
            wsKey,
            WsConnectionStateEnum.RECONNECTING,
          )
        ) {
          return this.connect(wsKey);
        }
      });
    });
  }

  private upsertPendingTopicsSubscriptions(
    wsKey: string,
    topic: string,
    resolver: TopicsPendingSubscriptionsResolver,
    rejector: TopicsPendingSubscriptionsRejector,
  ) {
    const existingWsKeyPendingSubscriptions =
      this.pendingTopicsSubscriptions.find((s) => s.wsKey === wsKey);
    if (!existingWsKeyPendingSubscriptions) {
      this.pendingTopicsSubscriptions.push({
        wsKey,
        resolver,
        rejector,
        failedTopicsSubscriptions: new Set(),
        pendingTopicsSubscriptions: new Set([topic]),
      });
      return;
    }

    existingWsKeyPendingSubscriptions.pendingTopicsSubscriptions.add(topic);
  }

  /**
   * Unsubscribe from V5 topics & remove them from memory. They won't be re-subscribed to if the connection reconnects.
   * @param wsTopics - topic or list of topics
   * @param category - the API category this topic is for (e.g. "linear"). The value is only important when connecting to public topics and will be ignored for private topics.
   * @param isPrivateTopic - optional - the library will try to detect private topics, you can use this to mark a topic as private (if the topic isn't recognised yet)
   */
  public unsubscribeV5(
    wsTopics: WsTopic[] | WsTopic,
    category: CategoryV5,
    isPrivateTopic?: boolean,
  ) {
    const topics = Array.isArray(wsTopics) ? wsTopics : [wsTopics];
    topics.forEach((topic) => {
      const wsKey = getWsKeyForTopic(
        this.options.market,
        topic,
        isPrivateTopic,
        category,
      );

      // Remove topic from persistence for reconnects
      this.wsStore.deleteTopic(wsKey, topic);
      this.removeTopicPendingSubscription(wsKey, topic);

      // unsubscribe request only necessary if active connection exists
      if (
        this.wsStore.isConnectionState(wsKey, WsConnectionStateEnum.CONNECTED)
      ) {
        this.requestUnsubscribeTopics(wsKey, [topic]);
      }
    });
  }

  private removeTopicPendingSubscription(wsKey: string, topic: string) {
    const existingWsKeyPendingSubscriptions =
      this.pendingTopicsSubscriptions.find((s) => s.wsKey === wsKey);
    if (existingWsKeyPendingSubscriptions) {
      existingWsKeyPendingSubscriptions.pendingTopicsSubscriptions.delete(
        topic,
      );
      if (!existingWsKeyPendingSubscriptions.pendingTopicsSubscriptions.size) {
        this.pendingTopicsSubscriptions =
          this.pendingTopicsSubscriptions.filter((s) => s.wsKey !== wsKey);
      }
    }
  }

  private clearTopicsPendingSubscriptions(wsKey: string) {
    this.pendingTopicsSubscriptions = this.pendingTopicsSubscriptions.filter(
      (s) => s.wsKey !== wsKey,
    );
  }

  /**
   * @private Only used if we fetch exchange time before attempting auth. Disabled by default.
   * I've removed this for ftx and it's working great, tempted to remove this here
   */
  private prepareRESTClient(): void {
    switch (this.options.market) {
      case 'v5': {
        this.restClient = new RestClientV5(
          this.options.restOptions,
          this.options.requestOptions,
        );
        break;
      }
      default: {
        throw neverGuard(
          this.options.market,
          'prepareRESTClient(): Unhandled market',
        );
      }
    }
  }

  public close(wsKey: WsKey, force?: boolean) {
    this.logger.info('Closing connection', { ...loggerCategory, wsKey });
    this.setWsState(wsKey, WsConnectionStateEnum.CLOSING);
    this.clearTimers(wsKey);

    const ws = this.getWs(wsKey);
    ws?.close();
    if (force) {
      ws?.terminate();
    }
  }

  public closeAll(force?: boolean) {
    const keys = this.wsStore.getKeys();
    this.logger.info(`Closing all ws connections: ${keys}`);
    keys.forEach((key) => {
      this.close(key, force);
    });
  }

  /**
   * Request connection of all dependent (public & private) websockets, instead of waiting for automatic connection by library
   */
  public connectAll(): Promise<WebSocket | undefined>[] {
    switch (this.options.market) {
      case 'v5': {
        return [this.connectPrivate()];
      }
      default: {
        throw neverGuard(this.options.market, 'connectAll(): Unhandled market');
      }
    }
  }

  public connectPublic(): Promise<WebSocket | undefined>[] {
    switch (this.options.market) {
      case 'v5': {
        return [
          this.connect(WS_KEY_MAP.v5SpotPublic),
          this.connect(WS_KEY_MAP.v5LinearPublic),
          this.connect(WS_KEY_MAP.v5InversePublic),
          this.connect(WS_KEY_MAP.v5OptionPublic),
        ];
      }
      default: {
        throw neverGuard(
          this.options.market,
          'connectPublic(): Unhandled market',
        );
      }
    }
  }

  public connectPrivate(): Promise<WebSocket | undefined> {
    switch (this.options.market) {
      case 'v5': {
        return this.connect(WS_KEY_MAP.v5Private);
      }
      default: {
        throw neverGuard(
          this.options.market,
          'connectPrivate(): Unhandled market',
        );
      }
    }
  }

  private async connect(wsKey: WsKey): Promise<WebSocket | undefined> {
    try {
      if (this.wsStore.isWsOpen(wsKey)) {
        this.logger.error(
          'Refused to connect to ws with existing active connection',
          { ...loggerCategory, wsKey },
        );
        return this.wsStore.getWs(wsKey);
      }

      if (
        this.wsStore.isConnectionState(wsKey, WsConnectionStateEnum.CONNECTING)
      ) {
        this.logger.error(
          'Refused to connect to ws, connection attempt already active',
          { ...loggerCategory, wsKey },
        );
        return;
      }

      if (
        !this.wsStore.getConnectionState(wsKey) ||
        this.wsStore.isConnectionState(wsKey, WsConnectionStateEnum.INITIAL)
      ) {
        this.setWsState(wsKey, WsConnectionStateEnum.CONNECTING);
      }

      const authParams = await this.getAuthParams(wsKey);
      const url = getWsUrl(
        wsKey,
        this.options.wsUrl,
        this.isTestnet(),
        this.logger,
      );
      const ws = this.connectToWsUrl(url + authParams, wsKey);

      return this.wsStore.setWs(wsKey, ws);
    } catch (err) {
      this.parseWsError('Connection failed', err, wsKey);
      this.reconnectWithDelay(wsKey, this.options.reconnectTimeout);
    }
  }

  private parseWsError(context: string, error: any, wsKey: WsKey) {
    if (!error.message) {
      this.logger.error(`${context} due to unexpected error: `, error);
      this.emit('error', error);
      return;
    }

    switch (error.message) {
      case 'Unexpected server response: 401':
        this.logger.error(`${context} due to 401 authorization failure.`, {
          ...loggerCategory,
          wsKey,
        });
        break;

      default:
        if (
          this.wsStore.getConnectionState(wsKey) !==
          WsConnectionStateEnum.CLOSING
        ) {
          this.logger.error(
            `${context} due to unexpected response error: "${
              error?.msg || error?.message || error
            }"`,
            { ...loggerCategory, wsKey, error },
          );
          this.executeReconnectableClose(wsKey, 'unhandled onWsError');
        } else {
          this.logger.info(
            `${wsKey} socket forcefully closed. Will not reconnect.`,
          );
        }
        break;
    }
    this.emit('error', error);
  }

  /**
   * Return params required to make authorized request
   */
  private async getAuthParams(wsKey: WsKey): Promise<string> {
    if (PUBLIC_WS_KEYS.includes(wsKey)) {
      this.logger.debug('Starting public only websocket client.', {
        ...loggerCategory,
        wsKey,
      });
      return '';
    }

    try {
      const { signature, expiresAt } = await this.getWsAuthSignature(wsKey);

      const authParams = {
        api_key: this.options.key,
        expires: expiresAt.toString(),
        signature,
      };

      return '?' + serializeParams(authParams);
    } catch (e) {
      this.logger.error(e, { ...loggerCategory, wsKey });
      return '';
    }
  }

  private async sendAuthRequest(wsKey: WsKey): Promise<void> {
    try {
      const { signature, expiresAt } = await this.getWsAuthSignature(wsKey);

      const request = {
        op: 'auth',
        args: [this.options.key, expiresAt, signature],
        req_id: `${wsKey}-auth`,
      };

      return this.tryWsSend(wsKey, JSON.stringify(request));
    } catch (e) {
      this.logger.error(e, { ...loggerCategory, wsKey });
    }
  }

  private async getWsAuthSignature(
    wsKey: WsKey,
  ): Promise<{ expiresAt: number; signature: string }> {
    const { key, secret } = this.options;

    if (!key || !secret) {
      this.logger.warning(
        'Cannot authenticate websocket, either api or private keys missing.',
        { ...loggerCategory, wsKey },
      );
      throw new Error('Cannot auth - missing api or secret in config');
    }

    this.logger.debug("Getting auth'd request params", {
      ...loggerCategory,
      wsKey,
    });

    const timeOffset = this.options.fetchTimeOffsetBeforeAuth
      ? (await this.restClient?.fetchTimeOffset()) || 0
      : 0;

    const recvWindow = this.options.recvWindow || 5000;

    const signatureExpiresAt = Date.now() + timeOffset + recvWindow;

    const signature = await signMessage(
      'GET/realtime' + signatureExpiresAt,
      secret,
    );

    return {
      expiresAt: signatureExpiresAt,
      signature,
    };
  }

  private reconnectWithDelay(wsKey: WsKey, connectionDelayMs: number) {
    this.clearTimers(wsKey);

    if (
      this.wsStore.getConnectionState(wsKey) !==
      WsConnectionStateEnum.CONNECTING
    ) {
      this.setWsState(wsKey, WsConnectionStateEnum.RECONNECTING);
    }

    if (this.wsStore.get(wsKey)?.activeReconnectTimer) {
      this.clearReconnectTimer(wsKey);
    }

    this.wsStore.get(wsKey, true).activeReconnectTimer = setTimeout(() => {
      this.logger.info('Reconnecting to websocket', {
        ...loggerCategory,
        wsKey,
      });
      this.clearReconnectTimer(wsKey);
      this.connect(wsKey);
    }, connectionDelayMs);
  }

  private ping(wsKey: WsKey) {
    if (this.wsStore.get(wsKey, true).activePongTimer) {
      return;
    }

    this.clearPongTimer(wsKey);

    this.logger.silly('Sending ping', { ...loggerCategory, wsKey });
    this.tryWsSend(wsKey, JSON.stringify({ op: 'ping' }));

    this.wsStore.get(wsKey, true).activePongTimer = setTimeout(
      () => this.executeReconnectableClose(wsKey, 'Pong timeout'),
      this.options.pongTimeout,
    );
  }

  /**
   * Closes a connection, if it's even open. If open, this will trigger a reconnect asynchronously.
   * If closed, trigger a reconnect immediately
   */
  private executeReconnectableClose(wsKey: WsKey, reason: string) {
    this.logger.info(`${reason} - closing socket to reconnect`, {
      ...loggerCategory,
      wsKey,
      reason,
    });

    const wasOpen = this.wsStore.isWsOpen(wsKey);

    this.getWs(wsKey)?.terminate();
    delete this.wsStore.get(wsKey, true).activePongTimer;
    this.clearPingTimer(wsKey);
    this.clearPongTimer(wsKey);

    if (!wasOpen) {
      this.logger.info(
        `${reason} - socket already closed - trigger immediate reconnect`,
        {
          ...loggerCategory,
          wsKey,
          reason,
        },
      );
      this.reconnectWithDelay(wsKey, this.options.reconnectTimeout);
    }
  }

  private clearTimers(wsKey: WsKey) {
    this.clearPingTimer(wsKey);
    this.clearPongTimer(wsKey);
    this.clearReconnectTimer(wsKey);
  }

  // Send a ping at intervals
  private clearPingTimer(wsKey: WsKey) {
    const wsState = this.wsStore.get(wsKey);
    if (wsState?.activePingTimer) {
      clearInterval(wsState.activePingTimer);
      wsState.activePingTimer = undefined;
    }
  }

  // Expect a pong within a time limit
  private clearPongTimer(wsKey: WsKey) {
    const wsState = this.wsStore.get(wsKey);
    if (wsState?.activePongTimer) {
      clearTimeout(wsState.activePongTimer);
      wsState.activePongTimer = undefined;
    }
  }

  private clearReconnectTimer(wsKey: WsKey) {
    const wsState = this.wsStore.get(wsKey);
    if (wsState?.activeReconnectTimer) {
      clearTimeout(wsState.activeReconnectTimer);
      wsState.activeReconnectTimer = undefined;
    }
  }

  /**
   * @private Use the `subscribe(topics)` method to subscribe to topics. Send WS message to subscribe to topics.
   */
  private requestSubscribeTopics(wsKey: WsKey, topics: string[]) {
    if (!topics.length) {
      return;
    }

    const maxTopicsPerEvent = getMaxTopicsPerSubscribeEvent(
      this.options.market,
      wsKey,
    );
    if (maxTopicsPerEvent && topics.length > maxTopicsPerEvent) {
      this.logger.silly(
        `Subscribing to topics in batches of ${maxTopicsPerEvent}`,
      );
      for (let i = 0; i < topics.length; i += maxTopicsPerEvent) {
        const batch = topics.slice(i, i + maxTopicsPerEvent);
        this.logger.silly(`Subscribing to batch of ${batch.length}`);
        this.requestSubscribeTopics(wsKey, batch);
      }
      this.logger.silly(
        `Finished batch subscribing to ${topics.length} topics`,
      );
      return;
    }

    const wsMessage = JSON.stringify({
      req_id: topics.join(','),
      op: 'subscribe',
      args: topics,
    });

    this.tryWsSend(wsKey, wsMessage);
  }

  /**
   * @private Use the `unsubscribe(topics)` method to unsubscribe from topics. Send WS message to unsubscribe from topics.
   */
  private requestUnsubscribeTopics(wsKey: WsKey, topics: string[]) {
    if (!topics.length) {
      return;
    }

    const maxTopicsPerEvent = getMaxTopicsPerSubscribeEvent(
      this.options.market,
      wsKey,
    );
    if (maxTopicsPerEvent && topics.length > maxTopicsPerEvent) {
      this.logger.silly(
        `Unsubscribing to topics in batches of ${maxTopicsPerEvent}`,
      );
      for (let i = 0; i < topics.length; i += maxTopicsPerEvent) {
        const batch = topics.slice(i, i + maxTopicsPerEvent);
        this.logger.silly(`Unsubscribing to batch of ${batch.length}`);
        this.requestUnsubscribeTopics(wsKey, batch);
      }
      this.logger.silly(
        `Finished batch unsubscribing to ${topics.length} topics`,
      );
      return;
    }

    const wsMessage = JSON.stringify({
      op: 'unsubscribe',
      args: topics,
    });

    this.tryWsSend(wsKey, wsMessage);
  }

  public tryWsSend(wsKey: WsKey, wsMessage: string) {
    try {
      this.logger.silly('Sending upstream ws message: ', {
        ...loggerCategory,
        wsMessage,
        wsKey,
      });
      if (!wsKey) {
        throw new Error(
          'Cannot send message due to no known websocket for this wsKey',
        );
      }
      const ws = this.getWs(wsKey);
      if (!ws) {
        throw new Error(
          `${wsKey} socket not connected yet, call "connect(${wsKey}) first then try again when the "open" event arrives`,
        );
      }
      ws.send(wsMessage);
    } catch (e) {
      this.logger.error('Failed to send WS message', {
        ...loggerCategory,
        wsMessage,
        wsKey,
        exception: e,
      });
    }
  }

  private connectToWsUrl(url: string, wsKey: WsKey): WebSocket {
    this.logger.silly(`Opening WS connection to URL: ${url}`, {
      ...loggerCategory,
      wsKey,
    });

    const agent = this.options.requestOptions?.agent;
    const ws = new WebSocket(url, undefined, agent ? { agent } : undefined);
    ws.onopen = (event: any) => this.onWsOpen(event, wsKey);
    ws.onmessage = (event: any) => this.onWsMessage(event, wsKey);
    ws.onerror = (event: any) =>
      this.parseWsError('Websocket onWsError', event, wsKey);
    ws.onclose = (event: any) => this.onWsClose(event, wsKey);

    return ws;
  }

  private async onWsOpen(event: any, wsKey: WsKey) {
    if (
      this.wsStore.isConnectionState(wsKey, WsConnectionStateEnum.CONNECTING)
    ) {
      this.logger.info('Websocket connected', {
        ...loggerCategory,
        wsKey,
        testnet: this.isTestnet(),
        market: this.options.market,
      });
      this.emit('open', { wsKey, event });
    } else if (
      this.wsStore.isConnectionState(wsKey, WsConnectionStateEnum.RECONNECTING)
    ) {
      this.logger.info('Websocket reconnected', { ...loggerCategory, wsKey });
      this.emit('reconnected', { wsKey, event });
    }

    this.setWsState(wsKey, WsConnectionStateEnum.CONNECTED);

    // Some websockets require an auth packet to be sent after opening the connection
    if (WS_AUTH_ON_CONNECT_KEYS.includes(wsKey)) {
      this.logger.info('Sending auth request...');
      await this.sendAuthRequest(wsKey);
    }

    this.wsStore.get(wsKey, true)!.activePingTimer = setInterval(
      () => this.ping(wsKey),
      this.options.pingInterval,
    );
  }

  private onWsMessage(event: { data: any; }, wsKey: WsKey) {
    try {
      // any message can clear the pong timer - wouldn't get a message if the ws dropped
      this.clearPongTimer(wsKey);

      const msg = JSON.parse((event && event.data) || event);

      if (isTopicSubscriptionConfirmation(msg)) {
        this.updatePendingTopicSubscriptionStatus(wsKey, msg);
      }

      // TODO: cleanme
      if (msg['success'] || msg?.pong || isWsPong(msg)) {
        if (isWsPong(msg)) {
          this.logger.silly('Received pong', { ...loggerCategory, wsKey });
        } else {
          this.emit('response', { ...msg, wsKey });
        }
        return;
      }

      if (msg['finalFragment']) {
        return this.emit('response', { ...msg, wsKey });
      }
      if (msg?.topic) {
        return this.emit('update', { ...msg, wsKey });
      }

      this.logger.warning('Unhandled/unrecognised ws event message', {
        ...loggerCategory,
        message: msg,
        event,
        wsKey,
      });
    } catch (e) {
      this.logger.error('Failed to parse ws event message', {
        ...loggerCategory,
        error: e,
        event,
        wsKey,
      });
    }
  }

  private updatePendingTopicSubscriptionStatus(
    wsKey: string,
    msg: WebsocketTopicSubscriptionConfirmationEvent,
  ) {
    const requestsIds = msg.req_id as string;
    const pendingTopicsSubscriptions = this.pendingTopicsSubscriptions.find(
      (s) => s.wsKey === wsKey,
    );

    if (!pendingTopicsSubscriptions) return;

    const splitRequestsIds = requestsIds.split(',');
    if (!isTopicSubscriptionSuccess(msg)) {
      splitRequestsIds.forEach((req_id) =>
        pendingTopicsSubscriptions.failedTopicsSubscriptions.add(req_id),
      );
    }

    splitRequestsIds.forEach((req_id) => {
      this.removeTopicPendingSubscription(wsKey, req_id);

      if (
        !pendingTopicsSubscriptions.pendingTopicsSubscriptions.size &&
        !pendingTopicsSubscriptions.failedTopicsSubscriptions.size
      ) {
        // all topics have been subscribed successfully, so we can resolve the subscription request
        pendingTopicsSubscriptions.resolver();
        this.clearTopicsPendingSubscriptions(wsKey);
      }

      if (
        !pendingTopicsSubscriptions.pendingTopicsSubscriptions.size &&
        pendingTopicsSubscriptions.failedTopicsSubscriptions.size
      ) {
        // not all topics have been subscribed successfully, so we reject the subscription request
        // and let the caller handle the situation by providing the list of failed subscriptions requests
        const failedSubscriptionsMessage = `(${[
          ...pendingTopicsSubscriptions.failedTopicsSubscriptions,
        ].toString()}) failed to subscribe`;
        pendingTopicsSubscriptions.rejector(failedSubscriptionsMessage);
        this.clearTopicsPendingSubscriptions(wsKey);
      }
    });
  }

  private onWsClose(event: any, wsKey: WsKey) {
    this.logger.info('Websocket connection closed', {
      ...loggerCategory,
      wsKey,
    });

    if (
      this.wsStore.getConnectionState(wsKey) !== WsConnectionStateEnum.CLOSING
    ) {
      this.reconnectWithDelay(wsKey, this.options.reconnectTimeout);
      this.emit('reconnect', { wsKey, event });
    } else {
      this.setWsState(wsKey, WsConnectionStateEnum.INITIAL);
      this.emit('close', { wsKey, event });
    }
  }

  private getWs(wsKey: WsKey) {
    return this.wsStore.getWs(wsKey);
  }

  private setWsState(wsKey: WsKey, state: WsConnectionStateEnum) {
    this.wsStore.setConnectionState(wsKey, state);
  }

  private wrongMarketError(market: APIMarket) {
    return new Error(
      `This WS client was instanced for the ${this.options.market} market. Make another WebsocketClient instance with "market: '${market}'" to listen to ${market} topics`,
    );
  }

  //ws.send('{"symbol":"BTCUSDT","topic":"depth","event":"sub","params":{"binary":false}}');
  //ws.send('{"symbol":"BTCUSDT","topic":"mergedDepth","event":"sub","params":{"binary":false,"dumpScale":1}}');
  //ws.send('{"symbol":"BTCUSDT","topic":"diffDepth","event":"sub","params":{"binary":false}}');
}

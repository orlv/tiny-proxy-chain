import { SocksProxyAgent } from "socks-proxy-agent";

declare namespace TinyProxy {
  export class TinyProxyChain {
    constructor(options: TinyProxyOptions);

    listenPort: number;

    defaultProxyOptions: TinyProxyOptions;

    debug: number;

    onRequest: (
      req: http.IncomingMessage,
      options: TinyProxyOptions
    ) => TinyProxyOptions;

    connectionTimeout: number | null;

    proxy: http.Server;

    lastId: number;

    connections: Map<number, { id: number; url: string | undefined }>;

    static makeProxyOptions: (
      proxyURL: string,
      proxyUsername: string,
      proxyPassword: string
    ) => TinyProxyOptions | null;

    static makeAuth: (proxyUsername: string, proxyPassword: string) => string;

    listen: () => TinyProxyChain;

    close: () => TinyProxyChain;

    static makeSocksRequestOptions: (
      proxyOptions: TinyProxyOptions,
      req: http.IncomingMessage
    ) => MakeSocksRequestOptions;

    static makeHttpRequestOptions: (
      proxyOptions: TinyProxyOptions,
      req: http.IncomingMessage
    ) => MakeHttpRequestOptions;

    makeRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void;

    makeSocksConnection: (
      proxyOptions: TinyProxyOptions,
      req: http.IncomingMessage,
      clientSocket: stream.Duplex
    ) => Promise<net.Socket>;

    makeHTTPProxyConnection: (
      proxyOptions: TinyProxyOptions,
      req: http.IncomingMessage,
      clientSocket: stream.Duplex
    ) => Promise<net.Socket>;

    makeConnection: (
      req: http.IncomingMessage,
      clientSocket: stream.Duplex,
      head: Buffer
    ) => void;

    addReq: (id: number, req: http.IncomingMessage) => void;

    rmReq: (id: number) => void;
  }

  export interface TinyProxyOptions {
    listenPort: number;
    proxyURL: string;
    proxyUsername: string;
    proxyPassword: string;
    /* @default 0 */
    debug?: number;
    onRequest?: (
      req: http.IncomingMessage,
      options: TinyProxyOptions
    ) => TinyProxyOptions;
    key?: string;
    cert?: string;
    ca?: string;
    /* @default null */
    connectionTimeout?: number | null;
  }

  export interface MakeHttpRequestOptions {
    hostname: string;
    port: string;
    path: string;
    method: string;
    headers: Record<string, string>;
  }

  export interface MakeSocksRequestOptions extends MakeHttpRequestOptions {
    agent: SocksProxyAgent;
  }
}

export = TinyProxy;

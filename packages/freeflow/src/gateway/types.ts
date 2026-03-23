/** Configuration for the gateway HTTP server. */
export interface GatewayConfig {
  /** TCP port to listen on (default: 8080). */
  port: number;
  /** Host/IP to bind (default: '0.0.0.0'). */
  host: string;
  /** Bearer token for API authentication. */
  apiKey: string;
  /** Root directory for freeflow run storage. */
  storeRoot: string;
}

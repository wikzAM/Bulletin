/** A failure with a JSON-RPC error code. Anything else thrown while handling a request is reported as -32603. */
export class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

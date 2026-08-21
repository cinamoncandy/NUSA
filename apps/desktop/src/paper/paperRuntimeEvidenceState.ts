export type MarketConnectionEvidence = "WEBSOCKET_DISCONNECT_RECOVERED" | undefined;

export class PaperRuntimeEvidenceState {
  private reconnectPending = false;
  private reconnectRecorded = false;

  observeMarketStatus(status: string): MarketConnectionEvidence {
    if (status.startsWith("reconnecting-in-")) {
      this.reconnectPending = true;
      return undefined;
    }
    if (status === "connected" && this.reconnectPending && !this.reconnectRecorded) {
      this.reconnectPending = false;
      this.reconnectRecorded = true;
      return "WEBSOCKET_DISCONNECT_RECOVERED";
    }
    return undefined;
  }
}

(function createNUSAMobileViewModel(global) {
  "use strict";

  const money = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
  const quantity = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
  const finite = (value) => typeof value === "number" && Number.isFinite(value);

  function formatMoney(value) { return finite(value) ? money.format(value) : "-"; }
  function formatQuantity(value) { return finite(value) ? quantity.format(value) : "-"; }
  function formatSignedMoney(value) { return finite(value) ? `${value > 0 ? "+" : ""}${money.format(value)}` : "-"; }
  function formatSignedPercent(value) { return finite(value) ? `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "-"; }
  function normalizeConnection(value) {
    const code = String(value ?? "").toLowerCase();
    if (code.includes("reconnect")) return ["reconnecting", "재연결 중"];
    if (["disconnect", "stale", "offline"].some((item) => code.includes(item))) return ["disconnected", "연결 끊김"];
    if (code === "connected" || ["online", "healthy", "fresh"].some((item) => code.includes(item))) return ["connected", "연결됨"];
    if (code.includes("connect")) return ["connecting", "연결 중"];
    if (["error", "fault"].some((item) => code.includes(item))) return ["error", "오류"];
    return ["unknown", "확인 중"];
  }
  function summarize(snapshot, markPrice) {
    const position = snapshot?.position || {};
    const heldValue = finite(markPrice) && finite(position.quantity) ? Math.max(0, position.quantity * markPrice) : null;
    const cash = finite(snapshot?.cash) ? Math.max(0, snapshot.cash) : null;
    const total = finite(snapshot?.equity) ? Math.max(0, snapshot.equity) : null;
    return Object.freeze({
      position,
      quantity: finite(position.quantity) ? position.quantity : 0,
      cash,
      heldValue,
      total,
      hasPosition: finite(position.quantity) && position.quantity > 0,
      orderCount: Array.isArray(snapshot?.orders) ? snapshot.orders.length : null,
      unrealizedPnl: finite(snapshot?.unrealizedPnl) ? snapshot.unrealizedPnl : null,
      realizedPnl: finite(position.realizedPnl) ? position.realizedPnl : null
    });
  }

  global.NUSAMobileViewModel = Object.freeze({ formatMoney, formatQuantity, formatSignedMoney, formatSignedPercent, normalizeConnection, summarize });
})(window);

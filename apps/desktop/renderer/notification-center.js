(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NusaNotificationCenter = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  const MAX_SEEN = 256;
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    priceAlerts: true,
    fillAlerts: true,
    orderStatusAlerts: true,
    systemErrorAlerts: true,
    priceAbove: null,
    priceBelow: null
  });

  function normalizeSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    const finiteOrNull = (candidate) => candidate == null ? null : (Number.isFinite(candidate) && candidate > 0 ? candidate : null);
    return Object.freeze({
      enabled: source.enabled !== false,
      priceAlerts: source.priceAlerts !== false,
      fillAlerts: source.fillAlerts !== false,
      orderStatusAlerts: source.orderStatusAlerts !== false,
      systemErrorAlerts: source.systemErrorAlerts !== false,
      priceAbove: finiteOrNull(source.priceAbove),
      priceBelow: finiteOrNull(source.priceBelow)
    });
  }

  function kindEnabled(kind, settings) {
    if (!settings.enabled) return false;
    return kind === "PRICE_ALERT" ? settings.priceAlerts
      : kind === "FILL" ? settings.fillAlerts
      : kind === "ORDER_STATUS" ? settings.orderStatusAlerts
      : kind === "SYSTEM_ERROR" ? settings.systemErrorAlerts
      : false;
  }

  class NotificationCenter {
    constructor() { this.seen = new Set(); }
    reset() { this.seen.clear(); }
    consume(event, settingsInput, background) {
      const settings = normalizeSettings(settingsInput);
      if (!event || !kindEnabled(event.kind, settings)) return null;
      const key = String(event.dedupeKey || event.id || "");
      if (!key || this.seen.has(key)) return null;
      this.seen.add(key);
      if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value);
      return Object.freeze({
        id: event.id || key,
        kind: event.kind,
        title: `NUSA Paper - ${event.title}`,
        body: String(event.body || ""),
        delivery: background ? "SYSTEM" : "IN_APP",
        timestamp: event.timestamp || new Date().toISOString()
      });
    }
  }

  return Object.freeze({ DEFAULT_SETTINGS, NotificationCenter, normalizeSettings });
});

# Paper Notification System

NUSA notifications are a read-only renderer feature. They observe existing public ticker, Paper snapshot, and control snapshot events; they never create orders or change account state.

## Events

- `PRICE_ALERT`: optional upper/lower KRW threshold from local notification settings.
- `FILL`: a newly observed Paper fill ID.
- `ORDER_STATUS`: control-plane status events.
- `SYSTEM_ERROR`: disconnected market data or control-plane system events.

## Safety

Every title is prefixed with `NUSA Paper`. Notifications are disabled by the master toggle and each category has its own setting. Event IDs are retained in a bounded in-memory set, so repeated IPC snapshots cannot create duplicate notifications. No live adapter, private API, credential, cancellation, withdrawal, or execution path is used.

Foreground events are rendered in the in-app notification list. Background events may use the native Notification API when permission is already granted; failure to show a native notification does not affect Paper state.

Settings are stored in renderer `localStorage` under `nusa.notification-settings.v1`. Invalid or unavailable storage falls back to defaults for the current session.

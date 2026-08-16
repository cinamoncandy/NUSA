# PAPER Server Local Development Setup

## Overview

This guide explains how to set up and run the NUSA PAPER Cloud server locally for development and testing. The PAPER server provides:

- **Personal paper trading simulation** for cryptocurrency trading with initial capital
- **Real-time market data** integration with Upbit
- **Mobile API endpoints** for NUSA mobile app connection
- **Bearer token authentication** for secure credential management

## Architecture

The NUSA system consists of two main components:

```
┌─────────────────────────────────────────────────────────────────┐
│ Mobile App (React Native)                                       │
│ ├─ Authentication → Bearer Token                                │
│ ├─ Configuration → Cloud Endpoint URL                           │
│ └─ APIs                                                         │
│    ├─ GET /api/dashboard → Portfolio, Markets, AI Status       │
│    ├─ GET /api/paper-operations → Trading State                │
│    ├─ POST /api/paper-order → Submit Manual Trade              │
│    ├─ GET /api/investment-allocation → Capital Allocation      │
│    └─ POST /api/investment-allocation → Update Allocation      │
│                                                                 │
│ Settings Screen Configuration                                   │
│ └─ Cloud endpoint: http://localhost:8000 (local dev)           │
│ └─ Session token: dev-test-token-12345 (from .env.cloud.local) │
└─────────────────────────────────────────┬───────────────────────┘
                                          │
                         HTTP Bearer Token Auth
                                          │
                    ┌─────────────────────▼───────────────────────┐
                    │ PAPER Cloud Server (Node.js)                │
                    ├─────────────────────────────────────────────┤
                    │ Core Components                             │
                    ├─ Cloud Runtime Coordinator                  │
                    │ └─ Initializes market data, trading loop    │
                    ├─ Dashboard State Provider                   │
                    │ └─ Manages portfolio, orders, positions     │
                    ├─ Paper Trading Execution Loop               │
                    │ └─ Processes buy/sell orders via risk gate  │
                    ├─ Market Data Client (Upbit WebSocket)       │
                    │ └─ Real-time ticker updates                 │
                    └─ HTTP Server (Express-like)                 │
                       └─ REST API endpoints                      │
                                                                  │
                    SQLite Database                               │
                    └─ ./nusa-cloud-dev.db (persistent state)     │
                                                                  │
                    Upbit Exchange (Public API)                   │
                    └─ Market data only (no auth required)        │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Environment Configuration

The local server configuration is stored in `.env.cloud.local`:

```bash
# PAPER Cloud Server Configuration
NUSA_DASHBOARD_TOKEN=dev-test-token-12345
NUSA_PAPER_INITIAL_CAPITAL_KRW=1000000
NUSA_CLOUD_STATE_DB_PATH=./nusa-cloud-dev.db
NUSA_UPBIT_PUBLIC_DATA_ENABLED=true
NODE_ENV=development
```

### Configuration Parameters

| Parameter | Purpose | Default | Notes |
|-----------|---------|---------|-------|
| `NUSA_DASHBOARD_TOKEN` | Bearer token for mobile auth | Required | Used as Bearer token in mobile app |
| `NUSA_PAPER_INITIAL_CAPITAL_KRW` | Starting PAPER cash (₩) | 1,000,000 | Sets initial portfolio value |
| `NUSA_CLOUD_STATE_DB_PATH` | SQLite database file path | ./nusa-cloud-dev.db | Persists portfolio state across restarts |
| `NUSA_UPBIT_PUBLIC_DATA_ENABLED` | Enable market data | true | Connects to Upbit WebSocket for tickers |
| `NODE_ENV` | Environment mode | development | Affects logging and error handling |

## Step 2: Start the Cloud Runtime

### Option A: Local Development (Recommended)

```bash
# From repository root
npm run cloud:runtime

# Output:
# [cloud-runtime] listening on localhost:8000
```

This command:
1. Loads configuration from `.env.cloud.local`
2. Initializes SQLite database at path specified
3. Starts Upbit WebSocket connection for market data
4. Begins HTTP server on port 8000
5. Registers graceful shutdown handlers

### Option B: With Custom Configuration

```bash
# Set environment variables before running
NUSA_DASHBOARD_TOKEN=custom-token-xyz \
NUSA_PAPER_INITIAL_CAPITAL_KRW=5000000 \
NUSA_CLOUD_STATE_DB_PATH=/tmp/nusa-custom.db \
npm run cloud:runtime
```

### Option C: Docker/Remote Deployment

For production deployment, the server can be containerized:

```bash
# Build container image
docker build -t nusa-cloud-server:latest apps/cloud

# Run with environment file
docker run --env-file .env.cloud.local -p 8000:8000 nusa-cloud-server:latest
```

## Step 3: Verify Server Readiness

The server is ready when you see:
```
[cloud-runtime] listening on localhost:8000
```

Check readiness with:
```bash
curl -H "Authorization: Bearer dev-test-token-12345" \
  http://localhost:8000/api/dashboard
```

Expected response (excerpt):
```json
{
  "mode": "STOPPED",
  "killSwitchActive": false,
  "tradingAllowed": true,
  "portfolio": {
    "mode": "PAPER",
    "account": {
      "cash": 1000000,
      "equity": 1000000,
      "assetValue": 0
    }
  }
}
```

## Step 4: Connect Mobile App to Local Server

In NUSA Mobile Settings screen:

1. **Cloud endpoint**: `http://localhost:8000`
   - Note: Uses HTTP for localhost, HTTPS required for remote servers
   
2. **Session token**: `dev-test-token-12345`
   - This matches NUSA_DASHBOARD_TOKEN from .env file
   
3. **Click**: "저장하고 연결 확인" (Save and Verify Connection)

Expected result: Connection status shows "연결됨" (Connected)

## Available API Endpoints

### Public Endpoints (No Auth Required)

```
GET /api/health
```
Returns server readiness status.

### Authenticated Endpoints (Requires Bearer Token)

All endpoints require header:
```
Authorization: Bearer dev-test-token-12345
```

#### Dashboard Status
```
GET /api/dashboard
```
Returns complete portfolio, trading state, AI status

#### Paper Operations
```
GET /api/paper-operations
```
Returns trading operations snapshot:
- Current portfolio allocation
- Open orders
- Market data with latest tickers
- Runtime state (READY, HALTED, STOPPED)

#### Submit Paper Order
```
POST /api/paper-order
Content-Type: application/json

{
  "market": "KRW-BTC",
  "side": "BUY",
  "orderType": "MARKET",
  "quantity": 0.001,
  "price": 50000000
}
```

#### Investment Allocation Settings
```
GET /api/investment-allocation
```
Returns current capital allocation percentage.

```
POST /api/investment-allocation
Content-Type: application/json

{
  "investmentPercent": 75
}
```

## Database State Management

### SQLite Database

The server persists state in a SQLite database specified by `NUSA_CLOUD_STATE_DB_PATH`:

```bash
# View database schema
sqlite3 ./nusa-cloud-dev.db ".schema"

# Query portfolio state
sqlite3 ./nusa-cloud-dev.db "SELECT * FROM paper_accounts LIMIT 1;"

# Reset database (deletes all trading history)
rm ./nusa-cloud-dev.db
```

### Recovery Mechanisms

1. **Automatic Recovery**: On startup, the server automatically recovers state from the database
2. **Schema Migrations**: Database schema automatically upgrades if needed
3. **Fail-Closed Safety**: If database is corrupted, server exits with error code 1 (supervisor restarts)

## Troubleshooting

### Server Won't Start

**Error**: `NUSA requires Node.js >= 24. Current: 22.x.x`

```bash
# Check Node version
node --version

# Upgrade Node.js (using nvm recommended)
nvm install 24
nvm use 24
npm run cloud:runtime
```

**Error**: `database must not be inside the source tree`

```bash
# Move database outside source directory
export NUSA_CLOUD_STATE_DB_PATH=/tmp/nusa-cloud-dev.db
npm run cloud:runtime
```

### Mobile App Connection Fails

**Symptom**: "연결 실패" (Connection Failed)

1. Verify server is running:
   ```bash
   curl -H "Authorization: Bearer dev-test-token-12345" \
     http://localhost:8000/api/dashboard
   ```

2. Check token matches exactly:
   ```bash
   # In mobile Settings, verify token is: dev-test-token-12345
   # In .env.cloud.local, verify: NUSA_DASHBOARD_TOKEN=dev-test-token-12345
   ```

3. Verify endpoint URL:
   - Local network: Use `http://localhost:8000` from same machine
   - Remote mobile device: Use machine IP address: `http://192.168.x.x:8000`

**Symptom**: "연결 필요" (Connection Required)

This means the server responded but trading runtime not fully initialized yet. Wait 2-3 seconds and try again.

### Paper Orders Blocked

**Reason**: `PAPER_MARKET_DATA_UNAVAILABLE`

- Market data not yet available from Upbit
- Verify `NUSA_UPBIT_PUBLIC_DATA_ENABLED=true` in .env
- Check internet connection for WebSocket connectivity

**Reason**: `PAPER_RUNTIME_UNAVAILABLE`

- Paper trading execution loop not initialized
- Verify `NUSA_PAPER_INITIAL_CAPITAL_KRW` is set (non-zero)
- Wait for server to fully initialize (check logs for initialization messages)

## Development Tips

### Real-time Monitoring

Watch server logs in real-time:
```bash
npm run cloud:runtime 2>&1 | tee server.log
```

### Market Data Simulation

To test with live market data:
- `NUSA_UPBIT_PUBLIC_DATA_ENABLED=true` → Uses real Upbit tickers
- Useful for testing chart updates, signal calculations

To test without market data:
- `NUSA_UPBIT_PUBLIC_DATA_ENABLED=false` → Orders return UNAVAILABLE
- Useful for testing error states

### Database Inspection

```bash
# List all tables
sqlite3 ./nusa-cloud-dev.db ".tables"

# Export as CSV
sqlite3 ./nusa-cloud-dev.db ".mode csv" \
  "SELECT * FROM paper_orders" > orders.csv

# Check schema migrations
sqlite3 ./nusa-cloud-dev.db \
  "SELECT * FROM schema_migrations ORDER BY id DESC LIMIT 5;"
```

### Resetting Portfolio State

```bash
# Complete reset (deletes database)
rm ./nusa-cloud-dev.db

# Restart server (creates fresh database)
npm run cloud:runtime
```

## Security Considerations

### Development Only

⚠️ **This setup is for LOCAL DEVELOPMENT ONLY**

- Token `dev-test-token-12345` is not secure for production
- Database stored unencrypted on disk
- No HTTPS (HTTP only on localhost)
- No rate limiting on development builds

### For Production

1. **Generate secure token**: Use 32+ character random string
   ```bash
   openssl rand -base64 32
   ```

2. **Enable HTTPS**: Use reverse proxy (nginx/caddy) with TLS
   
3. **Restrict database access**: Store outside source tree with proper permissions
   ```bash
   chmod 600 /data/nusa-cloud.db
   ```

4. **Enable rate limiting**: Configure in server.ts

5. **Add API key rotation**: Implement token refresh mechanism

## Next Steps

After setting up the local PAPER server:

1. ✅ Connect mobile app (Settings → Cloud endpoint)
2. ✅ Verify portfolio loads (should show ₩1,000,000 cash)
3. ✅ Test paper order submission
4. ✅ Monitor execution through Dashboard API

## Related Documentation

- [Mobile App Connection Flow](./NUSA_MOBILE_UIUX_V5_OBSIDIAN_FINANCE.md#10-paper-connection)
- [Cloud Runtime Architecture](./CLOUD_RUNTIME_ARCHITECTURE.md)
- [Bearer Token Authentication](./AUTHENTICATION.md)

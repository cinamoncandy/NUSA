# Step 1: PAPER Server Connection - Implementation Checklist

## Overview
This checklist tracks the setup and verification of local PAPER server connection for mobile app development and testing.

## Phase 1: Environment Setup ✓

- [x] **Environment file created**: `.env.cloud.local`
  - Location: `/home/user/NUSA/.env.cloud.local`
  - Contents verified with required variables:
    - `NUSA_DASHBOARD_TOKEN=dev-test-token-12345`
    - `NUSA_PAPER_INITIAL_CAPITAL_KRW=1000000`
    - `NUSA_CLOUD_STATE_DB_PATH=./nusa-cloud-dev.db`
    - `NUSA_UPBIT_PUBLIC_DATA_ENABLED=true`
    - `NODE_ENV=development`

- [x] **Configuration reviewed**
  - All required environment variables documented
  - Initial capital (₩1,000,000) set appropriately for testing
  - Database path configured for local development
  - Market data integration enabled

## Phase 2: Server Startup (Ready to Execute)

### Prerequisites Check
- [ ] Node.js version >= 24.0.0
  ```bash
  node --version
  # Expected: v24.x.x or higher
  ```

- [ ] Dependencies installed
  ```bash
  npm list @anthropic-sdk/sdk
  npm list react-native
  # Verify no missing peer dependencies
  ```

- [ ] Source tree permissions
  ```bash
  # Database path outside source tree
  ls -la ./nusa-cloud-dev.db 2>/dev/null || echo "Database will be created"
  ```

### Start Command
```bash
# From repository root
cd /home/user/NUSA
npm run cloud:runtime
```

**Expected output**:
```
[cloud-runtime] listening on localhost:8000
```

### Post-Startup Verification
- [ ] Server is listening on port 8000
  ```bash
  curl -s http://localhost:8000/api/health \
    -H "Authorization: Bearer dev-test-token-12345" \
    | jq '.'
  ```

- [ ] Dashboard API responds
  ```bash
  curl -s http://localhost:8000/api/dashboard \
    -H "Authorization: Bearer dev-test-token-12345" \
    | jq '.portfolio.account.cash'
  # Expected: 1000000
  ```

- [ ] Database was created
  ```bash
  ls -lh ./nusa-cloud-dev.db
  # File size should grow as trades execute
  ```

## Phase 3: Mobile App Connection

### Settings Screen Configuration
In NUSA Mobile app → Settings → PAPER 서버:

- [ ] **Cloud endpoint**: Enter `http://localhost:8000`
  - Field: "Cloud endpoint"
  - Test ID: `settings-paper-endpoint`
  - Validation: Must be HTTPS for production, HTTP allowed for localhost

- [ ] **Session token**: Enter `dev-test-token-12345`
  - Field: "세션 토큰"
  - Test ID: `settings-paper-token`
  - Security: Token stored in memory only, not persisted

- [ ] **Click verification button**
  - Button label: "저장하고 연결 확인"
  - Test ID: `settings-paper-connect`
  - Action: Saves endpoint and tests bearer token authentication

### Expected Results
- [ ] Connection status: "연결됨" (Connected)
  - Displayed in ScreenHeader statusLabel
  - Tone: "success" (green indicator)
  - Detail: "READY · ONLINE"

- [ ] Disconnect button enabled
  - Button label: "연결 해제"
  - Test ID: `settings-paper-disconnect`
  - Becomes active after successful connection

- [ ] Portfolio data loads
  - Navigate to Home tab
  - Should display: ₩1,000,000 cash balance
  - Status: "PAPER ONLY", "LIVE NONE"

## Phase 4: Functional Testing

### Basic Portfolio Operations
- [ ] **View current portfolio**
  - Home tab shows PAPER mode active
  - Cash available: ₩1,000,000
  - Asset value: ₩0 (no positions yet)
  - Equity: ₩1,000,000

- [ ] **Access Markets**
  - Markets tab loads Upbit market data
  - Chart displays KRW-BTC with real-time candles
  - Watchlist shows multiple markets with live tickers

- [ ] **View Trading Interface**
  - Paper tab loads with active endpoint
  - Runtime status shows "READY"
  - Authority: "PAPER_ONLY"
  - Submit button enabled

### Paper Order Testing
- [ ] **Place sample order**
  - Market: KRW-BTC
  - Side: BUY
  - Type: MARKET
  - Quantity: 0.001 BTC
  - Expected result: Order fills immediately

- [ ] **Verify order execution**
  - Order appears in Order History tab
  - Status: "FILLED"
  - Position shows in Portfolio
  - Cash updated: ₩1,000,000 - (cost + fee)

- [ ] **Check API responses**
  ```bash
  curl -s http://localhost:8000/api/paper-operations \
    -H "Authorization: Bearer dev-test-token-12345" \
    | jq '.operations.runtimeState'
  # Expected: "READY"
  ```

## Phase 5: Data Persistence

### Database Verification
- [ ] **Database file exists**
  ```bash
  file ./nusa-cloud-dev.db
  # Expected: SQLite 3.x database
  ```

- [ ] **Schema initialized**
  ```bash
  sqlite3 ./nusa-cloud-dev.db ".tables" | grep -q paper
  # Exit code 0 = success
  ```

- [ ] **State recovered on restart**
  1. Stop server (Ctrl+C)
  2. Start server again: `npm run cloud:runtime`
  3. Verify previous portfolio state restored
  4. Orders still visible in history

### Data Export
- [ ] **Export trading history**
  ```bash
  sqlite3 ./nusa-cloud-dev.db ".mode csv" \
    "SELECT * FROM paper_orders" > orders.csv
  wc -l orders.csv
  # Should show order records
  ```

## Phase 6: Error Handling & Recovery

### Connection Failure Scenarios
- [ ] **Wrong token**
  - Change token to "invalid-token"
  - Click verify
  - Expected: "연결 실패" (Connection Failed)
  - Detail: "invalid token" or similar

- [ ] **Wrong endpoint**
  - Change endpoint to "http://localhost:9999"
  - Click verify
  - Expected: "연결 필요" (Connection Required)
  - Detail: "ECONNREFUSED" or connection timeout

- [ ] **Server offline**
  - Stop server (Ctrl+C)
  - Try to submit order
  - Expected: Error modal with retry option

### Graceful Recovery
- [ ] **Restart server while app connected**
  1. Stop server
  2. App should show "연결 필요" in settings
  3. Restart server
  4. Click "저장하고 연결 확인" again
  5. Connection restored to "연결됨"

- [ ] **Market data interruption**
  1. Verify `NUSA_UPBIT_PUBLIC_DATA_ENABLED=true`
  2. Disconnect internet temporarily
  3. Watch connection state in server logs
  4. Restore connection
  5. Market data resumes

## Phase 7: Performance Monitoring

### Server Resource Usage
- [ ] **Memory consumption**
  ```bash
  ps aux | grep "cloud:runtime"
  # Check RSS (resident set size)
  # Expected: < 200MB for initial state
  ```

- [ ] **Database size**
  ```bash
  du -h ./nusa-cloud-dev.db
  # Grows as orders accumulate
  # Expected initial: < 10MB
  ```

- [ ] **WebSocket connections**
  ```bash
  # In server logs, verify Upbit connection established
  grep "CONNECTED\|DISCONNECTED" server.log
  ```

### API Response Times
- [ ] **Dashboard query**
  ```bash
  time curl -s http://localhost:8000/api/dashboard \
    -H "Authorization: Bearer dev-test-token-12345" \
    > /dev/null
  # Expected: < 100ms
  ```

- [ ] **Paper operations query**
  ```bash
  time curl -s http://localhost:8000/api/paper-operations \
    -H "Authorization: Bearer dev-test-token-12345" \
    > /dev/null
  # Expected: < 50ms
  ```

## Phase 8: Documentation & Handoff

- [x] **Local setup guide created**
  - File: `docs/PAPER_SERVER_LOCAL_SETUP.md`
  - Covers: Environment, startup, troubleshooting

- [ ] **Team onboarding**
  - Share setup guide with development team
  - Verify each team member can start local server
  - Establish shared database for integration testing (optional)

- [ ] **CI/CD Integration** (Future)
  - Add cloud server tests to GitHub Actions
  - Start server as service for mobile app tests
  - Verify API contracts with automated tests

## Deployment Options Summary

### Option A: Local Development (✓ Setup Complete)
- **When**: Development, testing, debugging
- **Command**: `npm run cloud:runtime`
- **Database**: `./nusa-cloud-dev.db` (local filesystem)
- **Token**: `dev-test-token-12345` (hardcoded for dev)
- **Endpoint**: `http://localhost:8000`

### Option B: Remote Deployment
- **When**: Staging, production, team coordination
- **Deployment**: Docker container on remote server
- **Database**: Persistent volume or managed database
- **Token**: Environment-specific secret
- **Endpoint**: `https://paper.nusa.example.com` (HTTPS required)
- **Status**: Documentation ready, implementation TBD

### Option C: Cloud Hosting
- **When**: Multi-team scaling, 24/7 availability
- **Platform**: AWS, GCP, Vercel, or similar
- **Database**: Managed PostgreSQL/MySQL
- **Auth**: OAuth2 or similar
- **Status**: Requires infrastructure setup, not in scope for Step 1

## Completion Criteria

**Step 1 is COMPLETE when**:
1. ✅ .env.cloud.local exists with correct values
2. ✅ Documentation (PAPER_SERVER_LOCAL_SETUP.md) created
3. ✅ Server starts without errors: `npm run cloud:runtime`
4. ✅ Mobile app connects successfully to local server
5. ✅ Portfolio data loads from PAPER server
6. ✅ Paper orders can be submitted and tracked
7. ✅ Database persistence works (survives restart)
8. ✅ Team can follow setup guide independently

## Next Steps

After Step 1 completion:
- **Step 2**: Branch cleanup and organization
- **Step 3**: Session reliability improvements
- **Step 4**: ✅ UI/UX improvements (COMPLETED)
- **Step 5**: AI intelligence upgrade

## Quick Reference

```bash
# Start server
npm run cloud:runtime

# Test connection
curl -H "Authorization: Bearer dev-test-token-12345" \
  http://localhost:8000/api/dashboard | jq '.portfolio.account.cash'

# View database
sqlite3 ./nusa-cloud-dev.db ".schema"

# Reset state
rm ./nusa-cloud-dev.db && npm run cloud:runtime
```

## Support

- **Issue**: "Node.js version too old"
  - Solution: `nvm install 24 && nvm use 24`

- **Issue**: "Port 8000 already in use"
  - Solution: `lsof -i :8000` and kill process, or change PORT env

- **Issue**: "Database corruption"
  - Solution: Remove DB file and restart: `rm ./nusa-cloud-dev.db`

- **Issue**: "Mobile app won't connect"
  - Solution: Verify token and endpoint match exactly, check firewall

const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
const byId = (id) => document.getElementById(id);
let lastPrice = 0;

function renderSnapshot(snapshot) {
  if (!snapshot) return;
  byId("equity").textContent = won.format(snapshot.equity);
  byId("cash").textContent = won.format(snapshot.cash);
  byId("position").textContent = `${number.format(snapshot.position.quantity)} BTC`;
  byId("average").textContent = snapshot.position.averagePrice ? won.format(snapshot.position.averagePrice) : "-";
  byId("unrealized").textContent = won.format(snapshot.unrealizedPnl);
  byId("realized").textContent = won.format(snapshot.position.realizedPnl);
  byId("orders").innerHTML = snapshot.orders.length
    ? snapshot.orders.map((order) => `<tr><td>${new Date(order.filledAt).toLocaleTimeString("ko-KR")}</td><td class="${order.side.toLowerCase()}">${order.side}</td><td>${number.format(order.quantity)}</td><td>${won.format(order.price)}</td><td>${won.format(order.fee)}</td></tr>`).join("")
    : '<tr><td colspan="5">체결 없음</td></tr>';
}

window.dokkaebi.onStatus((status) => {
  byId("status").textContent = status === "connected" ? "Upbit 연결됨" : status;
  byId("status").classList.toggle("online", status === "connected");
});
window.dokkaebi.onTicker((ticker) => {
  lastPrice = ticker.trade_price;
  byId("price").textContent = won.format(lastPrice);
  byId("change").textContent = ticker.signed_change_rate == null ? "실시간" : `${(ticker.signed_change_rate * 100).toFixed(2)}%`;
});
window.dokkaebi.onSnapshot(renderSnapshot);

async function order(side) {
  byId("error").textContent = "";
  const quantity = Number(byId("quantity").value);
  if (!Number.isFinite(quantity) || quantity <= 0) { byId("error").textContent = "올바른 수량을 입력하세요."; return; }
  if (!lastPrice) { byId("error").textContent = "시세 연결을 기다려 주세요."; return; }
  try { renderSnapshot((await window.dokkaebi.placeOrder(side, quantity)).snapshot); }
  catch (error) { byId("error").textContent = error instanceof Error ? error.message : String(error); }
}
byId("buy").addEventListener("click", () => order("BUY"));
byId("sell").addEventListener("click", () => order("SELL"));
window.dokkaebi.getSnapshot().then(renderSnapshot);

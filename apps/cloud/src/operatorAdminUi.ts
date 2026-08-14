import type { DashboardHttpResponse } from "./mobileDashboardHttp";

const securityHeaders = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
});

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NUSA Admin · User Access</title>
<link rel="stylesheet" href="/admin/operator.css">
</head>
<body>
<main>
  <header>
    <div><p class="eyebrow">NUSA CONTROL PLANE</p><h1>사용자 접근 관리</h1></div>
    <span class="boundary">OWNER ONLY · PAPER AUTHORITY</span>
  </header>
  <section class="auth" aria-labelledby="auth-title">
    <div><h2 id="auth-title">관리자 인증</h2><p>토큰은 브라우저 저장소에 기록하지 않고 현재 페이지 메모리에서만 사용합니다.</p></div>
    <div class="token-row"><input id="token" type="password" autocomplete="off" spellcheck="false" aria-label="Owner bearer token" placeholder="Owner bearer token"><button id="load" type="button">사용자 불러오기</button></div>
    <p id="status" role="status" aria-live="polite"></p>
  </section>
  <section class="summary" aria-label="Access summary">
    <article><span>대기</span><strong id="pending-count">-</strong></article>
    <article><span>활성</span><strong id="active-count">-</strong></article>
    <article><span>중지</span><strong id="suspended-count">-</strong></article>
  </section>
  <section aria-labelledby="users-title">
    <div class="section-title"><h2 id="users-title">사용자</h2><button id="refresh" class="secondary" type="button" disabled>새로고침</button></div>
    <div class="table-wrap"><table><thead><tr><th>사용자</th><th>역할</th><th>상태</th><th>최근 확인</th><th>작업</th></tr></thead><tbody id="users"><tr><td colspan="5" class="empty">Owner 토큰으로 인증하면 목록이 표시됩니다.</td></tr></tbody></table></div>
  </section>
  <section aria-labelledby="audit-title">
    <div class="section-title"><h2 id="audit-title">최근 접근 감사</h2><span>서버 기록 기준</span></div>
    <ol id="audit" class="audit"><li class="empty">아직 불러오지 않았습니다.</li></ol>
  </section>
</main>
<script src="/admin/operator.js" defer></script>
</body>
</html>`;

const css = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:0 auto;padding:40px 24px 64px}header,.section-title,.token-row{display:flex;align-items:center;justify-content:space-between;gap:16px}header{margin-bottom:24px}.eyebrow{margin:0 0 5px;font-size:12px;font-weight:800;letter-spacing:.14em;color:#64748b}h1{margin:0;font-size:30px}h2{margin:0;font-size:18px}.boundary{padding:8px 12px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;font-size:12px;font-weight:800;color:#475569}.auth,section:not(.summary){background:#fff;border:1px solid #dbe2ec;border-radius:16px;padding:20px;margin-bottom:18px;box-shadow:0 8px 28px rgba(15,23,42,.05)}.auth{display:grid;grid-template-columns:minmax(220px,1fr) minmax(360px,1.35fr);gap:20px}.auth p{margin:7px 0 0;color:#64748b;font-size:13px}.token-row{justify-content:flex-end}input{width:100%;min-width:220px;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit}button{border:0;border-radius:10px;padding:11px 14px;background:#172033;color:#fff;font-weight:750;cursor:pointer;white-space:nowrap}button.secondary{background:#eef2f7;color:#263349}button.warn{background:#fff0f0;color:#b42318}button.restore{background:#eef7ff;color:#175cd3}button:disabled{opacity:.42;cursor:not-allowed}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.summary article{background:#fff;border:1px solid #dbe2ec;border-radius:14px;padding:17px 18px}.summary span{font-size:13px;color:#64748b}.summary strong{display:block;margin-top:4px;font-size:25px}.section-title{margin-bottom:14px}.section-title>span{font-size:12px;color:#64748b}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:13px 10px;border-bottom:1px solid #e7ecf3;font-size:13px}th{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.user-main{font-weight:750}.user-sub{display:block;color:#64748b;margin-top:3px}.pill{display:inline-block;padding:5px 8px;border-radius:999px;background:#eef2f7;font-size:11px;font-weight:800}.actions{display:flex;gap:6px;flex-wrap:wrap}.actions button{padding:7px 9px;font-size:12px}.empty{color:#94a3b8;text-align:center}.audit{list-style:none;padding:0;margin:0}.audit li{padding:10px 0;border-bottom:1px solid #e7ecf3;font-size:13px}.audit strong{margin-right:8px}.audit time{float:right;color:#64748b}.error{color:#b42318!important}.ok{color:#067647!important}@media(max-width:760px){main{padding:24px 14px 44px}header,.auth,.token-row{display:block}.boundary{display:inline-block;margin-top:12px}.auth{grid-template-columns:1fr}.token-row{margin-top:14px}.token-row button{width:100%;margin-top:8px}.summary{grid-template-columns:1fr}th:nth-child(4),td:nth-child(4){display:none}}`;

const script = `(() => {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const token = byId("token");
  const status = byId("status");
  const usersBody = byId("users");
  const auditList = byId("audit");
  const refresh = byId("refresh");
  let busy = false;

  const say = (message, kind = "") => { status.textContent = message; status.className = kind; };
  const authHeaders = () => {
    const value = token.value.trim();
    if (!value) throw new Error("Owner bearer token을 입력하세요.");
    return { authorization: "Bearer " + value };
  };
  const request = async (options = {}) => {
    const response = await fetch("/api/operator/users", {
      method: options.method || "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { ...authHeaders(), ...(options.body ? { "content-type": "application/json" } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 401) throw new Error("인증이 거부되었습니다. 승인 상태와 principal identity를 확인하세요.");
      if (response.status === 403) throw new Error("Owner + users:manage 권한이 필요합니다.");
      throw new Error(payload.error || "요청이 거부되었습니다.");
    }
    return payload;
  };
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
  const actionButton = (label, action, user, className = "") => {
    const button = el("button", label, className);
    button.type = "button";
    button.disabled = busy || user.role === "OWNER";
    button.addEventListener("click", () => change(user.id, action));
    return button;
  };
  const formatTime = (value) => value == null ? "-" : new Date(value).toLocaleString("ko-KR");
  const render = (payload) => {
    const users = Array.isArray(payload.users) ? payload.users : [];
    const audit = Array.isArray(payload.audit) ? payload.audit : [];
    const counts = users.reduce((acc, user) => { acc[user.status] = (acc[user.status] || 0) + 1; return acc; }, {});
    byId("pending-count").textContent = String(counts.PENDING || 0);
    byId("active-count").textContent = String(counts.ACTIVE || 0);
    byId("suspended-count").textContent = String(counts.SUSPENDED || 0);
    usersBody.replaceChildren(...(users.length ? users.map((user) => {
      const row = document.createElement("tr");
      const who = document.createElement("td");
      who.append(el("span", user.displayName || user.id, "user-main"), el("span", user.email || user.id, "user-sub"));
      const role = el("td", user.role);
      const state = document.createElement("td"); state.append(el("span", user.status, "pill"));
      const seen = el("td", formatTime(user.lastSeenAt));
      const actions = document.createElement("td"); actions.className = "actions";
      if (user.status === "PENDING") actions.append(actionButton("승인", "APPROVE", user), actionButton("거절", "REJECT", user, "warn"));
      else if (user.status === "ACTIVE") actions.append(actionButton("중지", "SUSPEND", user, "warn"));
      else if (user.status === "SUSPENDED") actions.append(actionButton("복원", "RESTORE", user, "restore"));
      else actions.append(actionButton("복원", "RESTORE", user, "restore"));
      row.append(who, role, state, seen, actions); return row;
    }) : [(() => { const row = document.createElement("tr"); const cell = el("td", "사용자가 없습니다.", "empty"); cell.colSpan = 5; row.append(cell); return row; })()]));
    auditList.replaceChildren(...(audit.length ? audit.map((entry) => {
      const item = document.createElement("li");
      item.append(el("strong", entry.action || "CHANGE"), document.createTextNode((entry.targetUserId ? entry.targetUserId : "unknown") + (entry.reason ? " · " + entry.reason : "")), el("time", formatTime(entry.at)));
      return item;
    }) : [el("li", "감사 기록이 없습니다.", "empty")]));
    refresh.disabled = false;
  };
  const load = async () => {
    if (busy) return;
    busy = true; refresh.disabled = true; say("서버 권한 경계를 확인하는 중입니다…");
    try { render(await request()); say("서버가 승인한 사용자 접근 상태를 불러왔습니다.", "ok"); }
    catch (error) { say(error instanceof Error ? error.message : "불러오기에 실패했습니다.", "error"); }
    finally { busy = false; }
  };
  const change = async (targetUserId, action) => {
    if (busy) return;
    busy = true; refresh.disabled = true; say(action + " 요청을 서버에서 검증하는 중입니다…");
    try { await request({ method: "POST", body: { targetUserId, action } }); render(await request()); say("변경이 서버 권한 경계를 통과해 적용되었습니다.", "ok"); }
    catch (error) { say(error instanceof Error ? error.message : "변경이 거부되었습니다.", "error"); }
    finally { busy = false; refresh.disabled = false; }
  };
  byId("load").addEventListener("click", load);
  refresh.addEventListener("click", load);
  token.addEventListener("keydown", (event) => { if (event.key === "Enter") load(); });
})();`;

const response = (contentType: string, body: string): DashboardHttpResponse => Object.freeze({
  status: 200,
  headers: Object.freeze({ ...securityHeaders, "content-type": contentType }),
  body
});

export function handleOperatorAdminUi(method: string, path: string): DashboardHttpResponse | undefined {
  if (path !== "/admin" && path !== "/admin/" && path !== "/admin/operator.js" && path !== "/admin/operator.css") return undefined;
  if (method.toUpperCase() !== "GET") {
    return Object.freeze({
      status: 405,
      headers: Object.freeze({ ...securityHeaders, allow: "GET", "content-type": "text/plain; charset=utf-8" }),
      body: "METHOD_NOT_ALLOWED"
    });
  }
  if (path === "/admin/operator.js") return response("text/javascript; charset=utf-8", script);
  if (path === "/admin/operator.css") return response("text/css; charset=utf-8", css);
  return response("text/html; charset=utf-8", html);
}

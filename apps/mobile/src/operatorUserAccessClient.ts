export type OperatorUserStatus = "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED";
export type OperatorUserRole = "OWNER" | "USER";
export type OperatorUserAction = "APPROVE" | "REJECT" | "SUSPEND" | "RESTORE";

export interface OperatorUserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName?: string;
  readonly role: OperatorUserRole;
  readonly status: OperatorUserStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastLoginAt?: number;
  readonly lastSeenAt?: number;
}

export interface OperatorUserAccessSnapshot { readonly users: readonly OperatorUserRecord[]; }

const endpoint = (baseUrl: string): string => `${baseUrl.replace(/\/$/, "")}/api/operator/users`;

async function checked(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `HTTP_${response.status}`);
  return payload;
}

function validRecord(value: unknown): value is OperatorUserRecord {
  if (value == null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && record.id.length > 0
    && typeof record.email === "string" && record.email.length > 0
    && (record.role === "OWNER" || record.role === "USER")
    && (record.status === "PENDING" || record.status === "ACTIVE" || record.status === "REJECTED" || record.status === "SUSPENDED");
}

export async function loadOperatorUsers(baseUrl: string, token: string): Promise<OperatorUserAccessSnapshot> {
  if (!token.trim()) throw new Error("운영자 토큰이 필요합니다.");
  const payload = await checked(await fetch(endpoint(baseUrl), { method: "GET", headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json" } }));
  // An empty or malformed user list must never render as a valid empty state:
  // fail closed so the operator sees an error instead of missing approvals.
  if (!Array.isArray(payload.users) || !payload.users.every(validRecord)) {
    throw new Error("운영자 목록 응답이 올바르지 않습니다.");
  }
  return Object.freeze({ users: Object.freeze(payload.users as OperatorUserRecord[]) });
}

export async function changeOperatorUserStatus(baseUrl: string, token: string, targetUserId: string, action: OperatorUserAction): Promise<void> {
  if (!token.trim()) throw new Error("운영자 토큰이 필요합니다.");
  await checked(await fetch(endpoint(baseUrl), { method: "POST", headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ targetUserId, action }) }));
}

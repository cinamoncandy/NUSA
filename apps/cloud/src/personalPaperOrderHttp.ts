import {
  validatePersonalPaperOrderCommand,
  validatePersonalPaperOrderCommandResult,
  type PersonalPaperOrderCommand,
  type PersonalPaperOrderCommandResult
} from "../../../packages/contracts/src/personalPaperOrderCommand";
import type { PersonalPaperOperationsSnapshot } from "../../../packages/contracts/src/personalPaperOperations";
import {
  authorizePaperTradeRequest,
  dashboardJsonResponse,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardPrincipal,
  type DashboardTokenVerifier
} from "./mobileDashboardHttp";

export interface PersonalPaperOrderHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly submitOrder: (principal: DashboardPrincipal, command: PersonalPaperOrderCommand) => PersonalPaperOrderCommandResult;
  readonly loadSnapshot?: (principal: DashboardPrincipal) => PersonalPaperOperationsSnapshot;
}

export function handlePersonalPaperOrderHttp(request: DashboardHttpRequest, body: unknown, dependencies: PersonalPaperOrderHttpDependencies): DashboardHttpResponse {
  const authorization = authorizePaperTradeRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;
  let command: PersonalPaperOrderCommand;
  try { command = validatePersonalPaperOrderCommand(body as PersonalPaperOrderCommand); } catch { return dashboardJsonResponse(400, { error: "INVALID_PAPER_ORDER" }); }
  const idempotencyHeader = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"];
  if (typeof idempotencyHeader !== "string" || idempotencyHeader !== command.idempotencyKey) return dashboardJsonResponse(400, { error: "IDEMPOTENCY_KEY_MISMATCH" });
  try {
    const executionResult = dependencies.submitOrder(authorization.principal, command);
    if (executionResult.status === "BLOCKED" && executionResult.reason === "paper account persistence failed") {
      return dashboardJsonResponse(503, { error: "PAPER_ORDER_UNAVAILABLE" });
    }
    const duplicateSnapshot = executionResult.status === "DUPLICATE" && executionResult.snapshot == null && executionResult.order != null
      ? dependencies.loadSnapshot?.(authorization.principal)
      : undefined;
    const boundResult: PersonalPaperOrderCommandResult = Object.freeze({
      ...executionResult,
      idempotencyKey: command.idempotencyKey,
      market: command.market,
      side: command.side,
      orderType: command.orderType,
      quantity: command.quantity,
      ...(command.limitPrice === undefined ? {} : { limitPrice: command.limitPrice }),
      ...(duplicateSnapshot == null ? {} : { snapshot: duplicateSnapshot })
    });
    const result = validatePersonalPaperOrderCommandResult(boundResult, command);
    return dashboardJsonResponse(200, result);
  } catch { return dashboardJsonResponse(503, { error: "PAPER_ORDER_UNAVAILABLE" }); }
}

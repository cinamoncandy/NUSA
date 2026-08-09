import {
  validatePersonalPaperOrderCommand,
  validatePersonalPaperOrderCommandResult,
  type PersonalPaperOrderCommand,
  type PersonalPaperOrderCommandResult
} from "../../../packages/contracts/src/personalPaperOrderCommand";
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
}

export function handlePersonalPaperOrderHttp(
  request: DashboardHttpRequest,
  body: unknown,
  dependencies: PersonalPaperOrderHttpDependencies
): DashboardHttpResponse {
  const authorization = authorizePaperTradeRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;

  let command: PersonalPaperOrderCommand;
  try { command = validatePersonalPaperOrderCommand(body as PersonalPaperOrderCommand); }
  catch { return dashboardJsonResponse(400, { error: "INVALID_PAPER_ORDER" }); }

  const idempotencyHeader = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"];
  if (typeof idempotencyHeader !== "string" || idempotencyHeader !== command.idempotencyKey) return dashboardJsonResponse(400, { error: "IDEMPOTENCY_KEY_MISMATCH" });

  try {
    const executionResult = dependencies.submitOrder(authorization.principal, command);
    const boundResult: PersonalPaperOrderCommandResult = Object.freeze({
      ...executionResult,
      idempotencyKey: command.idempotencyKey,
      market: command.market,
      side: command.side,
      orderType: command.orderType,
      quantity: command.quantity,
      ...(command.limitPrice === undefined ? {} : { limitPrice: command.limitPrice })
    });
    const result = validatePersonalPaperOrderCommandResult(boundResult, command);
    if (result.liveAuthority !== "NONE" || result.productionMutationAllowed !== false) return dashboardJsonResponse(503, { error: "PAPER_ORDER_AUTHORITY_VIOLATION" });
    return dashboardJsonResponse(200, result);
  } catch {
    return dashboardJsonResponse(503, { error: "PAPER_ORDER_UNAVAILABLE" });
  }
}

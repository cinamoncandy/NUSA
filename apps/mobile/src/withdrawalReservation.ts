export type WithdrawalReservationStatus = "RESERVED" | "RELEASED" | "COMPLETED";

export interface WithdrawalReservation {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly requestedAt: number;
  readonly targetAt?: number;
  readonly status: WithdrawalReservationStatus;
}

export interface TreasuryState {
  readonly totalAssets: number;
  readonly tradingCapital: number;
  readonly reserveCapital: number;
  readonly pendingDepositCapital: number;
  readonly reservations: readonly WithdrawalReservation[];
}

export interface ProtectedTreasuryState extends TreasuryState {
  readonly reservedWithdrawalCapital: number;
  readonly deployableCapital: number;
  readonly activeReservations: readonly WithdrawalReservation[];
}

const assertMoney = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
};

const assertText = (value: string, field: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
};

const validateReservation = (reservation: WithdrawalReservation): WithdrawalReservation => {
  assertText(reservation.id, "reservation.id");
  assertText(reservation.currency, "reservation.currency");
  assertMoney(reservation.amount, "reservation.amount");
  if (reservation.amount === 0) {
    throw new Error("reservation.amount must be greater than zero");
  }
  if (!Number.isSafeInteger(reservation.requestedAt) || reservation.requestedAt < 0) {
    throw new Error("reservation.requestedAt must be a non-negative safe integer");
  }
  if (reservation.targetAt !== undefined) {
    if (!Number.isSafeInteger(reservation.targetAt) || reservation.targetAt < reservation.requestedAt) {
      throw new Error("reservation.targetAt must be a safe integer not earlier than requestedAt");
    }
  }
  return Object.freeze({
    ...reservation,
    id: reservation.id.trim(),
    currency: reservation.currency.trim().toUpperCase()
  });
};

export const protectWithdrawalCapital = (state: TreasuryState): ProtectedTreasuryState => {
  assertMoney(state.totalAssets, "totalAssets");
  assertMoney(state.tradingCapital, "tradingCapital");
  assertMoney(state.reserveCapital, "reserveCapital");
  assertMoney(state.pendingDepositCapital, "pendingDepositCapital");

  const ids = new Set<string>();
  const normalizedReservations = state.reservations.map((reservation) => {
    const normalized = validateReservation(reservation);
    if (ids.has(normalized.id)) {
      throw new Error(`duplicate reservation id: ${normalized.id}`);
    }
    ids.add(normalized.id);
    return normalized;
  });

  const activeReservations = Object.freeze(normalizedReservations
    .filter((reservation) => reservation.status === "RESERVED")
    .sort((left, right) => left.requestedAt - right.requestedAt || left.id.localeCompare(right.id)));

  const reservedWithdrawalCapital = activeReservations.reduce((sum, reservation) => sum + reservation.amount, 0);
  const accounted = state.tradingCapital + state.reserveCapital + state.pendingDepositCapital;

  if (Math.abs(accounted - state.totalAssets) > 1e-8) {
    throw new Error("treasury capital does not reconcile with totalAssets");
  }
  if (reservedWithdrawalCapital > state.tradingCapital) {
    throw new Error("reserved withdrawal capital exceeds trading capital");
  }

  const deployableCapital = state.tradingCapital - reservedWithdrawalCapital;

  return Object.freeze({
    totalAssets: state.totalAssets,
    tradingCapital: state.tradingCapital,
    reserveCapital: state.reserveCapital,
    pendingDepositCapital: state.pendingDepositCapital,
    reservations: Object.freeze([...normalizedReservations]),
    reservedWithdrawalCapital,
    deployableCapital,
    activeReservations
  });
};

export const reserveWithdrawal = (
  state: TreasuryState,
  reservation: WithdrawalReservation
): ProtectedTreasuryState => protectWithdrawalCapital({
  ...state,
  reservations: [...state.reservations, reservation]
});

export const releaseWithdrawalReservation = (
  state: TreasuryState,
  reservationId: string
): ProtectedTreasuryState => {
  assertText(reservationId, "reservationId");
  let found = false;
  const reservations = state.reservations.map((reservation) => {
    if (reservation.id !== reservationId) {
      return reservation;
    }
    found = true;
    if (reservation.status !== "RESERVED") {
      throw new Error(`reservation ${reservationId} is not active`);
    }
    return { ...reservation, status: "RELEASED" as const };
  });
  if (!found) {
    throw new Error(`unknown reservation id: ${reservationId}`);
  }
  return protectWithdrawalCapital({ ...state, reservations });
};

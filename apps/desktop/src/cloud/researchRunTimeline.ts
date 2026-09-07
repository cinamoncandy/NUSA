export interface ResearchRunTimeline {
  readonly snapshotAt: number;
  readonly hypothesisGeneratedAt: string;
  readonly specificationGeneratedAt: string;
  readonly evaluationStartedAt: string;
  readonly evaluationEndedAt: string;
  readonly generatedAt: string;
}

export class ResearchRunTimelineError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchRunTimelineError";
  }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function timestampAt(offset: number, snapshotAt: number): string {
  const value = snapshotAt + offset;
  const date = new Date(value);
  if (!Number.isFinite(value) || Number.isNaN(date.getTime())) {
    throw new ResearchRunTimelineError("TIMELINE_OUT_OF_RANGE", "research run timeline exceeds supported timestamp range");
  }
  return date.toISOString();
}

export function buildResearchRunTimeline(snapshotAt: number): ResearchRunTimeline {
  if (!Number.isSafeInteger(snapshotAt) || snapshotAt < 0) {
    throw new ResearchRunTimelineError(
      "INVALID_SNAPSHOT_TIMESTAMP",
      "research run snapshot timestamp must be a non-negative safe integer",
    );
  }
  return freeze({
    snapshotAt,
    hypothesisGeneratedAt: timestampAt(0, snapshotAt),
    specificationGeneratedAt: timestampAt(1, snapshotAt),
    evaluationStartedAt: timestampAt(2, snapshotAt),
    evaluationEndedAt: timestampAt(3, snapshotAt),
    generatedAt: timestampAt(4, snapshotAt),
  });
}

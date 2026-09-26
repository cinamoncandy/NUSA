export type MotionSpec = Readonly<{
  durationMs: number;
  delayMs?: number;
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
  repeat?: "none" | "whileStateActive";
}>;

export type MotionSystem = Readonly<{
  screenEnter: MotionSpec;
  surfaceEnter: MotionSpec;
  surfaceEmphasis: MotionSpec;
  statusRecovery: MotionSpec;
  statusTransition: MotionSpec;
  signalReveal: MotionSpec;
  metricChange: MotionSpec;
  loading: MotionSpec;
  press: MotionSpec;
  navigationTransition: MotionSpec;
}>;

const REDUCED: MotionSpec = Object.freeze({
  durationMs: 0,
  easing: "linear",
  repeat: "none",
});

export function createMotionSystem(reduceMotion = false): MotionSystem {
  if (reduceMotion) {
    return Object.freeze({
      screenEnter: REDUCED,
      surfaceEnter: REDUCED,
      surfaceEmphasis: REDUCED,
      statusRecovery: REDUCED,
      statusTransition: REDUCED,
      signalReveal: REDUCED,
      metricChange: REDUCED,
      loading: REDUCED,
      press: REDUCED,
      navigationTransition: REDUCED,
    });
  }

  return Object.freeze({
    screenEnter: { durationMs: 260, easing: "easeOut", repeat: "none" },
    surfaceEnter: { durationMs: 220, easing: "easeOut", repeat: "none" },
    surfaceEmphasis: { durationMs: 180, easing: "easeInOut", repeat: "none" },
    statusRecovery: { durationMs: 900, easing: "easeInOut", repeat: "whileStateActive" },
    statusTransition: { durationMs: 180, easing: "easeInOut", repeat: "none" },
    signalReveal: { durationMs: 240, easing: "easeOut", repeat: "none" },
    metricChange: { durationMs: 220, easing: "easeOut", repeat: "none" },
    loading: { durationMs: 900, easing: "easeInOut", repeat: "whileStateActive" },
    press: { durationMs: 100, easing: "easeOut", repeat: "none" },
    navigationTransition: { durationMs: 220, easing: "easeInOut", repeat: "none" },
  });
}

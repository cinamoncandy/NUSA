import type { Theme } from "./designSystem";

/**
 * Stable semantic boundary between product screens and a concrete visual treatment.
 *
 * Screens should ask for meaning (canvas, panel, evidence, danger), not palette
 * implementation details. Runtime/auth/PAPER state must never depend on this module.
 */
export interface VisualSystem {
  readonly color: {
    readonly canvas: string;
    readonly panel: string;
    readonly panelRaised: string;
    readonly text: string;
    readonly textMuted: string;
    readonly border: string;
    readonly accent: string;
    readonly positive: string;
    readonly warning: string;
    readonly danger: string;
  };
  readonly space: {
    readonly screenX: number;
    readonly section: number;
    readonly card: number;
    readonly compact: number;
  };
  readonly radius: {
    readonly card: number;
    readonly hero: number;
    readonly control: number;
    readonly pill: number;
  };
  readonly type: {
    readonly hero: number;
    readonly section: number;
    readonly metric: number;
    readonly body: number;
    readonly meta: number;
  };
  readonly touchTarget: number;
}

export function visualSystem(theme: Theme): VisualSystem {
  return Object.freeze({
    color: Object.freeze({
      canvas: theme.colors.background,
      panel: theme.colors.surface,
      panelRaised: theme.colors.surfaceRaised,
      text: theme.colors.text,
      textMuted: theme.colors.textMuted,
      border: theme.colors.border,
      accent: theme.colors.primary,
      positive: theme.colors.success,
      warning: theme.colors.warning,
      danger: theme.colors.danger,
    }),
    space: Object.freeze({ screenX: 20, section: 16, card: 14, compact: 8 }),
    radius: Object.freeze({ card: 16, hero: 28, control: 10, pill: 999 }),
    type: Object.freeze({ hero: 26, section: 22, metric: 30, body: 12, meta: 9 }),
    touchTarget: 48,
  });
}

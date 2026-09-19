export const MOBILE_ACCEPTANCE_WIDTHS = [360, 390, 430] as const;
export const MOBILE_COMPACT_MAX_WIDTH = 430;
export const MOBILE_NARROW_MAX_WIDTH = 360;
export const MOBILE_MIN_TOUCH_TARGET = 48;

export function getMobileViewportProfile(width: number) {
  return Object.freeze({
    width,
    compact: width <= MOBILE_COMPACT_MAX_WIDTH,
    narrow: width <= MOBILE_NARROW_MAX_WIDTH,
    minTouchTarget: MOBILE_MIN_TOUCH_TARGET,
    navLabelMaxLines: 1,
  });
}

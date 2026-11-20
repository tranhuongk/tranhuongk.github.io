// How the remote screen is sized inside the window.
export type FitMode = 'fit' | 'actual';

/**
 * CSS size of the canvas. `fit` scales the whole remote screen into the box (up or down, aspect kept);
 * `actual` shows one remote pixel per device pixel (so a Retina remote screen is not blurred).
 */
export function canvasSize(
  mode: FitMode, remoteW: number, remoteH: number, boxW: number, boxH: number, dpr: number,
): { width: number; height: number } {
  if (remoteW <= 0 || remoteH <= 0) return { width: 0, height: 0 };
  if (mode === 'actual') return { width: remoteW / Math.max(dpr, 1), height: remoteH / Math.max(dpr, 1) };
  const scale = Math.min(boxW / remoteW, boxH / remoteH);
  if (!Number.isFinite(scale) || scale <= 0) return { width: remoteW, height: remoteH };
  return { width: Math.floor(remoteW * scale), height: Math.floor(remoteH * scale) };
}

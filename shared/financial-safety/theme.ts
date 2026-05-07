import type { SafetyTheme } from './types.js';

/** Clamp `score` (0–10) to presentation helpers. */
function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(10, Math.max(0, score));
}

/**
 * Maps a 0–10 financial safety score to HSL-based CSS variables (green ~145° → amber ~48° → red ~8°).
 */
export function scoreToSafetyTheme(score: number): SafetyTheme {
  const s = clampScore(score);
  const stress = (10 - s) / 10;
  const band: SafetyTheme['band'] = stress < 0.34 ? 'good' : stress < 0.67 ? 'medium' : 'poor';
  const hue = 145 - stress * 137;
  const sat = 52 + stress * 18;
  const lightBg = 96 - stress * 34;
  const lightFg = 18 + stress * 12;
  const borderL = 78 - stress * 38;

  return {
    stress,
    band,
    css: {
      '--fs-score-hue': String(Math.round(hue)),
      '--fs-score-fg': `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(lightFg)}%)`,
      '--fs-score-bg': `hsl(${Math.round(hue)}, ${Math.min(86, Math.round(sat + 26))}%, ${Math.round(lightBg)}%)`,
      '--fs-score-border': `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(borderL)}%)`,
    },
  };
}

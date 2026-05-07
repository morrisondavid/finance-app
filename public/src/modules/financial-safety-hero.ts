/**
 * §2.2 Financial Safety hero — Dashboard tab strip above household liquidity.
 */

import type { AiFinancialSafetyResponse } from '../../../shared/api-contracts.js';
import { scoreToSafetyTheme } from '../../../shared/financial-safety/theme.js';
import { escapeHtml } from '../utils/dom';

function safetyLabel(score: number): string {
  if (score >= 7) return 'Comfortable headroom';
  if (score >= 4) return 'Elevated risk — review pillars';
  return 'High pressure — act on warnings and commitments';
}

export function renderFinancialSafetyHero(fs: AiFinancialSafetyResponse | undefined): string {
  if (fs === undefined) return '';
  const theme = scoreToSafetyTheme(fs.score);
  const styleAttr = Object.entries(theme.css)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
  const nudge =
    fs.warningAdjustment.pointsDeducted > 0
      ? `<p class="financial-safety-hero__nudge">Warnings adjusted score by −${fs.warningAdjustment.pointsDeducted.toFixed(1)}</p>`
      : '';

  return `
    <section class="financial-safety-hero" style="${styleAttr}" aria-label="Financial safety score" data-fs-band="${theme.band}">
      <div class="financial-safety-hero__copy">
        <p class="financial-safety-hero__kicker">Financial safety</p>
        <p class="financial-safety-hero__label">${escapeHtml(safetyLabel(fs.score))}</p>
        ${nudge}
        <p class="financial-safety-hero__meta">Formula v${escapeHtml(fs.formulaVersion)} · multi-factor (liquidity, runway, income, spend/debt) + §1.8 warnings</p>
      </div>
      <div class="financial-safety-hero__score-block" aria-hidden="false">
        <p class="financial-safety-hero__score">${fs.score.toFixed(1)}<span class="financial-safety-hero__out-of">/10</span></p>
      </div>
    </section>`;
}

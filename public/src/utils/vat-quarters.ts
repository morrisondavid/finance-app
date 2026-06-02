/** Calendar years that cover recent VAT quarters (Q1 spans into next calendar year). */
export function recentVatQuarterYears(): number[] {
  const now = new Date().getFullYear();
  return [now + 1, now, now - 1, now - 2];
}

/** VAT quarter `<option>` groups by calendar year (newest year first). */
export function buildVatQuarterOptionGroups(years: number[]): string {
  const sorted = [...years].sort((a, b) => b - a);
  return sorted
    .map(
      year =>
        `<optgroup label="${year}">${buildVatQuarterOptionsHtml(year, false)}</optgroup>`,
    )
    .join('');
}

/** VAT Stagger-2 quarter `<option>` markup for a calendar year (shared by statements + reporting readiness). */
export function buildVatQuarterOptionsHtml(year: number, includePlaceholder = true): string {
  const prevYear = year - 1;
  const placeholder = includePlaceholder ? '<option value="">VAT Quarter</option>\n' : '';
  return `${placeholder}<option value="Q1-${year}">Q1 Nov-Jan ${prevYear}/${year.toString().slice(-2)}</option>
    <option value="Q2-${year}">Q2 Feb-Apr ${year}</option>
    <option value="Q3-${year}">Q3 May-Jul ${year}</option>
    <option value="Q4-${year}">Q4 Aug-Oct ${year}</option>`;
}

/** Financial year labels (May–Apr) for corporation-tax readiness. */
export function buildFyPeriodOptions(): Array<{ value: string; label: string }> {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const startYear = month < 4 ? year - 1 : year;
  return [0, 1].map(offset => {
    const sy = startYear - offset;
    const ey = sy + 1;
    const value = `${sy}/${String(ey).slice(-2)}`;
    return { value, label: `FY ${value} (May ${sy} – Apr ${ey})` };
  });
}

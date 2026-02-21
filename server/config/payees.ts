/**
 * Payee Configuration
 * 
 * Defines directors, salary patterns, and payment identification rules.
 * Update these when adding new directors or changing salary structures.
 */

export interface Director {
  /** Director's name as it appears in bank statements */
  name: string;
  /** SQL LIKE pattern to match the name (handles spacing/tabs) */
  namePattern: string;
  /** Minimum salary amount (for identifying salary vs dividends) */
  salaryMin: number;
  /** Maximum salary amount (for identifying salary vs dividends) */
  salaryMax: number;
  /** Display label for UI */
  label: string;
  /** Short code for UI badges */
  code: string;
}

/**
 * Company directors and their payment patterns
 */
export const DIRECTORS: Director[] = [
  {
    name: 'David Morrison',
    namePattern: '%DAVID MORRISON%',
    salaryMin: 758,
    salaryMax: 770,
    label: "David's Tax",
    code: 'DM',
  },
  {
    name: 'Heena Tailor',
    namePattern: '%HEENA%TAILOR%', // Using % between to handle tabs/spaces
    salaryMin: 758,
    salaryMax: 770,
    label: "Heena's Tax",
    code: 'HT',
  },
];

/**
 * Get director by name (case-insensitive partial match)
 */
export function getDirectorByName(name: string): Director | undefined {
  const lowerName = name.toLowerCase();
  return DIRECTORS.find(d => 
    lowerName.includes(d.name.toLowerCase().split(' ')[0]) // Match first name
  );
}

/**
 * HMRC Payment Patterns
 * 
 * VAT payments appear differently depending on payment method:
 * - Bank: "HMRC VAT..."
 * - Credit card: "HMRC ETMP - GLASGOW..."
 */
export const HMRC_PATTERNS = {
  /** VAT payment patterns - bank and credit card payments */
  VAT: ['HMRC VAT%', 'HMRC ETMP%'] as const,
  
  /** Self Assessment pattern */
  SELF_ASSESSMENT: 'HMRC GOV.UK SA%',
  
  // Corporation Tax pattern TBD when first payment made
} as const;

/**
 * Check if a payment amount falls within salary range for any director
 */
export function isSalaryAmount(amount: number): boolean {
  const absAmount = Math.abs(amount);
  return DIRECTORS.some(d => absAmount >= d.salaryMin && absAmount <= d.salaryMax);
}

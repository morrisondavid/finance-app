import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  matchRentalProperty,
  assertOwnershipIntegrity,
  sumRentalIncomeForPerson,
  RENTAL_PROPERTIES,
  type RentalProperty,
} from './rental-properties.js';

describe('matchRentalProperty', () => {
  it('matches Stoneshaw Estates on monzo-joint', () => {
    const result = matchRentalProperty('Stoneshaw Estates', 'monzo-joint', 1292.72);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('78 Hunters Square');
  });

  it('matches Prospect Holdings on monzo-joint', () => {
    const result = matchRentalProperty('Prospect Holdings', 'monzo-joint', 979.2);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('56 Thorney House');
  });

  it('matches even when amount is lower due to agent deductions', () => {
    const result = matchRentalProperty('Stoneshaw Estates', 'monzo-joint', 776.72);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('78 Hunters Square');
  });

  it('returns null for unknown merchant', () => {
    expect(matchRentalProperty('Unknown Agent', 'monzo-joint', 1000)).toBeNull();
  });

  it('returns null for wrong account', () => {
    expect(matchRentalProperty('Stoneshaw Estates', 'natwest', 1292.72)).toBeNull();
  });
});

describe('assertOwnershipIntegrity', () => {
  it('passes on the real RENTAL_PROPERTIES config', () => {
    expect(() => assertOwnershipIntegrity()).not.toThrow();
  });

  it('throws when ownership does not sum to 1', () => {
    const bad: RentalProperty[] = [{
      id: 'bad-sum',
      name: 'Bad sum',
      merchant: 'Nobody',
      grossRent: 100,
      account: 'monzo-joint',
      ownership: { david: 0.4, heena: 0.4 },
    }];
    expect(() => assertOwnershipIntegrity(bad)).toThrow(/must sum to 1/);
  });

  it('throws when ownership references an unknown person', () => {
    const bad = [{
      id: 'bad-person',
      name: 'Bad person',
      merchant: 'Nobody',
      grossRent: 100,
      account: 'monzo-joint' as const,
      ownership: { ghost: 1 } as unknown as RentalProperty['ownership'],
    }] as unknown as RentalProperty[];
    expect(() => assertOwnershipIntegrity(bad)).toThrow(/unknown person/);
  });
});

describe('sumRentalIncomeForPerson', () => {
  function makeDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT UNIQUE NOT NULL,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        account TEXT NOT NULL,
        type TEXT NOT NULL
      );
    `);
    return db;
  }

  let hashSeq = 0;
  function insert(db: Database.Database, date: string, desc: string, amount: number, account: string): void {
    hashSeq++;
    db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES (?, ?, ?, ?, ?, 'income')
    `).run(`h-${hashSeq}`, date, desc, amount, account);
  }

  it('splits income by per-property ownership share', () => {
    const db = makeDb();
    const property = RENTAL_PROPERTIES[0];
    insert(db, '2024-05-01', `Rent ${property.merchant} May`, 1000, property.account);
    insert(db, '2024-06-01', `Rent ${property.merchant} Jun`, 1000, property.account);

    const davidShare = property.ownership.david ?? 0;
    const heenaShare = property.ownership.heena ?? 0;

    expect(sumRentalIncomeForPerson(db, 'david', '2024-04-06', '2025-04-05')).toBeCloseTo(2000 * davidShare, 2);
    expect(sumRentalIncomeForPerson(db, 'heena', '2024-04-06', '2025-04-05')).toBeCloseTo(2000 * heenaShare, 2);
    db.close();
  });

  it('ignores rows outside the window', () => {
    const db = makeDb();
    const property = RENTAL_PROPERTIES[0];
    insert(db, '2023-01-01', `Rent ${property.merchant}`, 500, property.account);
    insert(db, '2026-06-01', `Rent ${property.merchant}`, 500, property.account);

    expect(sumRentalIncomeForPerson(db, 'david', '2024-04-06', '2025-04-05')).toBe(0);
    db.close();
  });

  it('ignores rows on a non-property account', () => {
    const db = makeDb();
    const property = RENTAL_PROPERTIES[0];
    insert(db, '2024-05-01', `Rent ${property.merchant}`, 1000, 'barclays-current');

    expect(sumRentalIncomeForPerson(db, 'david', '2024-04-06', '2025-04-05')).toBe(0);
    db.close();
  });
});

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildDeclaredCommitmentRegistry } from './registry.js';
import {
  assertRentalOwnershipIntegrity,
  sumRentalIncomeForPerson,
} from './rental-income.js';
import {
  matchRentalCommitment,
  matchRentalCommitmentByAmount,
} from './lookups.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

function mkRegistry(rows: string[]) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-'));
  const header = [
    'id', 'category', 'cadence', 'merchant', 'display_name', 'account', 'amount',
    'currency', 'notes', 'ownership_david', 'ownership_heena', 'person_id',
    'amount_tolerance', 'due_date',
  ].join(',');
  fs.writeFileSync(path.join(tmpDir, 'seed.csv'), [header, ...rows].join('\n'));
  return { registry: buildDeclaredCommitmentRegistry(tmpDir), cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
}

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

describe('matchRentalCommitment', () => {
  it('returns the rental commitment for a matching merchant+account', () => {
    const { registry, cleanup } = mkRegistry([
      'r1,rental-income,monthly,Stoneshaw Estates,78 HS,monzo-joint,1292.72,GBP,,0.5,0.5,,,',
    ]);
    try {
      const hit = matchRentalCommitment(registry, 'Stoneshaw Estates', 'monzo-joint');
      expect(hit?.displayName).toBe('78 HS');
    } finally { cleanup(); }
  });

  it('returns null for non-rental matches', () => {
    const { registry, cleanup } = mkRegistry([
      'f1,fixed-bill,monthly,EE,,barclays-current,180,GBP,,,,,,',
    ]);
    try {
      expect(matchRentalCommitment(registry, 'EE', 'barclays-current')).toBeNull();
    } finally { cleanup(); }
  });
});

describe('matchRentalCommitmentByAmount', () => {
  it('picks the rental commitment closest to the transaction amount', () => {
    const { registry, cleanup } = mkRegistry([
      'r1,rental-income,monthly,Agent,Property A,monzo-joint,1000,GBP,,0.5,0.5,,,',
      'r2,rental-income,monthly,Agent,Property B,monzo-joint,500,GBP,,0.5,0.5,,,',
    ]);
    try {
      expect(matchRentalCommitmentByAmount(registry, 'Agent', 'monzo-joint', 520)?.displayName).toBe('Property B');
      expect(matchRentalCommitmentByAmount(registry, 'Agent', 'monzo-joint', 950)?.displayName).toBe('Property A');
    } finally { cleanup(); }
  });

  it('returns null when no candidate matches merchant+account', () => {
    const { registry, cleanup } = mkRegistry([
      'r1,rental-income,monthly,Agent,Property A,monzo-joint,1000,GBP,,0.5,0.5,,,',
    ]);
    try {
      expect(matchRentalCommitmentByAmount(registry, 'Other', 'monzo-joint', 1000)).toBeNull();
    } finally { cleanup(); }
  });
});

describe('assertRentalOwnershipIntegrity', () => {
  it('passes on the real registry', () => {
    expect(() => assertRentalOwnershipIntegrity()).not.toThrow();
  });

  it('throws when ownership does not sum to 1', () => {
    const { registry, cleanup } = mkRegistry([
      'bad,rental-income,monthly,X,,monzo-joint,100,GBP,,0.4,0.4,,,',
    ]);
    try {
      expect(() => assertRentalOwnershipIntegrity(registry)).toThrow(/must sum to 1/);
    } finally { cleanup(); }
  });
});

describe('sumRentalIncomeForPerson', () => {
  it('splits income by per-property ownership share', () => {
    const { registry, cleanup } = mkRegistry([
      'r1,rental-income,monthly,Stoneshaw,,monzo-joint,1000,GBP,,0.6,0.4,,,',
    ]);
    const db = makeDb();
    try {
      insert(db, '2024-05-01', 'Rent Stoneshaw May', 1000, 'monzo-joint');
      insert(db, '2024-06-01', 'Rent Stoneshaw Jun', 1000, 'monzo-joint');
      expect(sumRentalIncomeForPerson(db, 'david', '2024-04-06', '2025-04-05', registry)).toBeCloseTo(1200, 2);
      expect(sumRentalIncomeForPerson(db, 'heena', '2024-04-06', '2025-04-05', registry)).toBeCloseTo(800, 2);
    } finally { db.close(); cleanup(); }
  });

  it('ignores rows outside the window', () => {
    const { registry, cleanup } = mkRegistry([
      'r1,rental-income,monthly,Stoneshaw,,monzo-joint,1000,GBP,,0.5,0.5,,,',
    ]);
    const db = makeDb();
    try {
      insert(db, '2023-01-01', 'Rent Stoneshaw', 500, 'monzo-joint');
      insert(db, '2026-06-01', 'Rent Stoneshaw', 500, 'monzo-joint');
      expect(sumRentalIncomeForPerson(db, 'david', '2024-04-06', '2025-04-05', registry)).toBe(0);
    } finally { db.close(); cleanup(); }
  });

  it('ignores rows on a non-property account', () => {
    const { registry, cleanup } = mkRegistry([
      'r1,rental-income,monthly,Stoneshaw,,monzo-joint,1000,GBP,,0.5,0.5,,,',
    ]);
    const db = makeDb();
    try {
      insert(db, '2024-05-01', 'Rent Stoneshaw', 1000, 'barclays-current');
      expect(sumRentalIncomeForPerson(db, 'david', '2024-04-06', '2025-04-05', registry)).toBe(0);
    } finally { db.close(); cleanup(); }
  });
});

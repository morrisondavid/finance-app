import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildObligationRegistry } from './registry.js';
import {
  assertRentalOwnershipIntegrity,
  assertRentalMerchantsClassify,
  sumRentalIncomeForPerson,
} from './rental-income.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

function mkRegistry(rows: string[]) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-'));
  const header = [
    'id', 'category', 'frequency', 'merchant', 'display_name', 'account', 'amount',
    'currency', 'notes', 'ownership_david', 'ownership_heena', 'person_id',
    'amount_tolerance', 'due_date',
  ].join(',');
  fs.writeFileSync(path.join(tmpDir, 'obligations-seed.csv'), [header, ...rows].join('\n'));
  return { registry: buildObligationRegistry(tmpDir), cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
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

describe('assertRentalMerchantsClassify', () => {
  it('passes on the real registry (every rental merchant is in merchant-registry)', () => {
    expect(() => assertRentalMerchantsClassify()).not.toThrow();
  });

  it('throws when a rental merchant does not classify as Property', () => {
    const { registry, cleanup } = mkRegistry([
      'orphan,rental-income,monthly,Zzz Unmapped Merchant,,monzo-joint,1000,GBP,,0.5,0.5,,,',
    ]);
    try {
      expect(() => assertRentalMerchantsClassify(registry)).toThrow(/classifies as/);
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

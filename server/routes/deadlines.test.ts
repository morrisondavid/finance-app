import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import {
  createInMemoryTestDb,
  resetTestData,
  type TestDbHandles,
} from '../db/test-harness/in-memory-db.js';

/**
 * Regression-lock every /api/deadlines route. Covers: CRUD, mark/unmark
 * done, unified feed shape, and ICS content-type/body. The whole router
 * is wired up against an in-memory DB so a bug in the repo → CSV → feed
 * → ICS chain surfaces here rather than in a manual smoke test.
 */
const harness: { current: TestDbHandles | null } = { current: null };

vi.mock('../db/connection.js', () => ({
  getDb: () => {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.db;
  },
  get DEADLINES_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.deadlinesDir;
  },
  get OBLIGATIONS_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.obligationsDir;
  },
}));

import deadlinesRouter from './deadlines.js';

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/deadlines', deadlinesRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function stopServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
}

describe('/api/deadlines routes', () => {
  beforeAll(async () => {
    harness.current = createInMemoryTestDb();
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    harness.current?.cleanup();
  });

  beforeEach(() => {
    if (harness.current) resetTestData(harness.current.db);
  });

  it('GET / returns an empty list initially', async () => {
    const resp = await fetch(`${baseUrl}/api/deadlines`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { deadlines: unknown[] };
    expect(body.deadlines).toEqual([]);
  });

  it('POST / creates a deadline and echoes it back', async () => {
    const resp = await fetch(`${baseUrl}/api/deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'ch-2026',
        type: 'companies-house',
        title: 'Confirmation statement',
        dueDate: '2026-11-01',
        recurrence: 'annual',
      }),
    });
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as { deadline: { id: string; title: string } };
    expect(body.deadline.id).toBe('ch-2026');
    expect(body.deadline.title).toBe('Confirmation statement');
  });

  it('POST / returns 400 for invalid body', async () => {
    const resp = await fetch(`${baseUrl}/api/deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', dueDate: 'not-a-date' }),
    });
    expect(resp.status).toBe(400);
  });

  it('PUT /:id updates fields', async () => {
    await fetch(`${baseUrl}/api/deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'to-edit',
        type: 'other',
        title: 'Before',
        dueDate: '2026-01-01',
        recurrence: 'one-off',
      }),
    });
    const resp = await fetch(`${baseUrl}/api/deadlines/to-edit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'After' }),
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { deadline: { title: string } };
    expect(body.deadline.title).toBe('After');
  });

  it('PUT /:id returns 404 for unknown id', async () => {
    const resp = await fetch(`${baseUrl}/api/deadlines/missing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'nope' }),
    });
    expect(resp.status).toBe(404);
  });

  it('DELETE /:id removes a deadline', async () => {
    await fetch(`${baseUrl}/api/deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'goner',
        type: 'other',
        title: 'Gone',
        dueDate: '2026-01-01',
        recurrence: 'one-off',
      }),
    });
    const del = await fetch(`${baseUrl}/api/deadlines/goner`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const list = await (await fetch(`${baseUrl}/api/deadlines`)).json() as { deadlines: unknown[] };
    expect(list.deadlines).toEqual([]);
  });

  it('POST /:id/complete marks done, DELETE /:id/complete reopens', async () => {
    await fetch(`${baseUrl}/api/deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'toggle',
        type: 'other',
        title: 'Toggle',
        dueDate: '2026-01-01',
        recurrence: 'one-off',
      }),
    });
    const doneResp = await fetch(`${baseUrl}/api/deadlines/toggle/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completedDate: '2026-01-05' }),
    });
    expect(doneResp.status).toBe(200);
    const done = (await doneResp.json()) as { deadline: { completedDate: string | null } };
    expect(done.deadline.completedDate).toBe('2026-01-05');

    const reopen = await fetch(`${baseUrl}/api/deadlines/toggle/complete`, { method: 'DELETE' });
    expect(reopen.status).toBe(200);
    const reopened = (await reopen.json()) as { deadline: { completedDate: string | null } };
    expect(reopened.deadline.completedDate).toBeNull();
  });

  it('GET /feed merges deadlines (obligations table is empty in this test suite)', async () => {
    await fetch(`${baseUrl}/api/deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'feed-a',
        type: 'other',
        title: 'Feed A',
        dueDate: '2026-06-01',
        recurrence: 'one-off',
      }),
    });
    const resp = await fetch(`${baseUrl}/api/deadlines/feed`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { items: { id: string; source: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].source).toBe('deadline');
    expect(body.items[0].id).toBe('deadline:feed-a');
  });

  it('GET /.ics returns a well-formed ICS body with correct content-type', async () => {
    await fetch(`${baseUrl}/api/deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'ics-a',
        type: 'other',
        title: 'ICS A',
        dueDate: '2026-06-15',
        recurrence: 'one-off',
      }),
    });
    const resp = await fetch(`${baseUrl}/api/deadlines/.ics`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/text\/calendar/);
    const text = await resp.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('END:VCALENDAR');
    expect(text).toContain('DTSTART;VALUE=DATE:20260615');
    expect(text).toContain('SUMMARY:ICS A');
  });
});

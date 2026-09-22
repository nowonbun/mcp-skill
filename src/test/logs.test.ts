import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LogStore } from '../lib/logs.ts';

async function temporaryLogRoot(t: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skillport-logs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('기존 NDJSON은 가져오지 않고 새 로그만 SQLite에 기록한다', async t => {
  const root = await temporaryLogRoot(t);
  const legacyFile = path.join(root, 'access.ndjson');
  const original = '{"time":"2026-01-01T00:00:00.000Z","requestId":"old"}\n';
  await fs.writeFile(legacyFile, original, 'utf8');

  const first = new LogStore(root);
  await first.init();
  assert.deepEqual(await first.list(), []);
  await first.add({
    kind: 'tool',
    skill: 'new',
    operation: 'search',
    status: 'success',
  });
  await first.close();

  const second = new LogStore(root);
  await second.init();
  assert.deepEqual((await second.list()).map(row => row.skill), ['new']);
  await second.close();

  assert.equal(await fs.readFile(legacyFile, 'utf8'), original);
  const database = new DatabaseSync(path.join(root, 'access.sqlite'), { readOnly: true });
  assert.equal((database.prepare('SELECT COUNT(*) AS total FROM access_logs').get() as {
    total: number;
  }).total, 1);
  database.close();
});

test('새 로그를 SQLite에 저장하고 최신 순서·필터·오프셋으로 조회한다', async t => {
  const root = await temporaryLogRoot(t);
  const logs = new LogStore(root);
  try {
    await logs.add({
      kind: 'tool', skill: 'alpha', operation: 'search',
      status: 'success', agent: 'client-a',
    });
    await logs.add({
      kind: 'tool', skill: 'beta', operation: 'get',
      status: 'error', message: '실패',
    });
    await logs.add({
      kind: 'resource', skill: 'alpha', operation: 'read',
      status: 'error', message: '다시 실패',
    });

    const all = await logs.list();
    assert.equal(all.length, 3);
    assert.deepEqual(all.map(row => row.skill), ['alpha', 'beta', 'alpha']);
    assert.equal((await logs.list({ limit: 1, offset: 1 }))[0].skill, 'beta');
    assert.equal((await logs.list({ status: 'error' })).length, 2);
    assert.equal((await logs.list({ skill: 'alpha', status: 'error' })).length, 1);
    assert.equal((await logs.list({ query: '다시 실패' }))[0].skill, 'alpha');
    assert.equal((await logs.list({ query: 'CLIENT-A' }))[0].skill, 'alpha');
    assert.deepEqual(await logs.list({ query: '없는 검색어' }), []);
    await assert.rejects(fs.access(path.join(root, 'access.ndjson')));
  } finally {
    await logs.close();
  }
});

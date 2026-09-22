import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Registry, normalize, parseYaml, toYaml, validSourceUrl } from '../lib/registry.ts';

const sample = {
  name: 'db-design',
  version: '1.0.0',
  description: '데이터베이스 모델 설계',
  tags: ['database', 'design'],
  category: 'database',
  content: '# DB Design\n\n지침',
};

async function setup(t: test.TestContext): Promise<Registry> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skillport-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new Registry(path.join(directory, 'skills'));
}

test('YAML 파싱과 정규화', () => {
  const metadata = normalize(parseYaml([
    'name: db-design',
    'version: 1.0.0',
    'description: >',
    '  데이터베이스 모델 설계',
    'tags:',
    '  - database',
  ].join('\n')));

  assert.equal(metadata.description, '데이터베이스 모델 설계');
  assert.deepEqual(metadata.tags, ['database']);
});

test('등록, 검색, 버전, 상태', async t => {
  const registry = await setup(t);
  await registry.save(sample);

  assert.equal((await registry.list({ query: 'database' })).length, 1);
  assert.equal((await registry.get('db-design')).content, sample.content);
  await assert.rejects(registry.save(sample), /이미 등록/);

  await registry.save(
    { ...sample, version: '1.1.0', content: '# Revised' },
    { overwrite: true },
  );
  assert.deepEqual((await registry.versions('db-design')).versions, ['1.1.0', '1.0.0']);
  assert.equal((await registry.get('db-design', '1.0.0')).content, sample.content);

  await registry.setStatus('db-design', 'paused');
  assert.equal((await registry.list({ status: 'deployed' })).length, 0);
});

test('경로 이탈과 잘못된 메타데이터를 차단', async t => {
  const registry = await setup(t);
  await assert.rejects(registry.get('../x'), /이름/);
  await assert.rejects(registry.save({ ...sample, name: '../x' }), /이름/);
  await assert.rejects(registry.save({ ...sample, version: 'v1' }), /버전/);
});

test('GitHub 원본 URL과 해시를 메타데이터에 보존', async t => {
  const source_url = 'https://github.com/owner/repo/blob/main/SKILL.md';
  const source_hash = 'a'.repeat(64);
  assert.equal(validSourceUrl(source_url), true);
  assert.equal(validSourceUrl('https://example.com/SKILL.md'), false);

  const metadata = normalize({
    ...sample, source_url, source_hash,
  });
  const restored = normalize(parseYaml(toYaml(metadata)));
  assert.equal(restored.source_url, source_url);
  assert.equal(restored.source_hash, source_hash);

  const registry = await setup(t);
  await registry.save({ ...sample, source_url, source_hash });
  const saved = await registry.get(sample.name);
  assert.equal(saved.source_url, source_url);
  assert.equal(saved.source_hash, source_hash);
});

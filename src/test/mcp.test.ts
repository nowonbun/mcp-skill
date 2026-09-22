import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { Registry } from '../lib/registry.ts';
import { LogStore } from '../lib/logs.ts';
import { createSkillServer, type SkillPolicy } from '../lib/mcp.ts';

async function setup(t: test.TestContext, policy: SkillPolicy) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skillport-mcp-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const registry = new Registry(path.join(directory, 'skills'));
  const logs = new LogStore(path.join(directory, 'data'));
  await registry.save({
    name: 'db-design',
    version: '1.0.0',
    description: 'DB 설계 지침',
    tags: ['database'],
    content: '# DB Design\n\n본문',
  });

  const handler = createMcpHandler(
    () => createSkillServer(registry, logs, async () => policy),
    { responseMode: 'json' },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL('http://test.local/mcp'),
    { fetch: (url, init) => handler.fetch(new Request(url, init)) },
  );
  const client = new Client({ name: 'skillport-test', version: '1.0.0' });
  await client.connect(transport);

  t.after(async () => {
    await client.close();
    await handler.close();
  });
  return { registry, client };
}

test('공식 SDK: 메타데이터 조회 후 본문 지연 로딩', async t => {
  const { client } = await setup(t, { allowedSkills: [], allowedCategories: [] });
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 5);

  const usage = await client.callTool({ name: 'usage', arguments: {} });
  assert.ok(JSON.stringify(usage).includes('search_skills'));

  const listed = await client.callTool({
    name: 'list_skills',
    arguments: {},
  });
  assert.ok(!JSON.stringify(listed).includes('# DB Design'));

  const resource = await client.readResource({ uri: 'skill://db-design' });
  assert.equal(resource.contents[0].text, '# DB Design\n\n본문');
});

test('공식 SDK: 전역 허용 정책으로 Skill 접근 제한', async t => {
  const { client } = await setup(t, {
    allowedSkills: ['another-skill'],
    allowedCategories: [],
  });

  const listed = await client.callTool({
    name: 'list_skills',
    arguments: {},
  });
  assert.equal(JSON.stringify(listed).includes('db-design'), false);
  await assert.rejects(client.readResource({ uri: 'skill://db-design' }));
});

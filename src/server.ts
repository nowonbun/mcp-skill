import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  Registry, AppError, normalize, parseYaml, validSourceUrl,
  type Skill, type SkillMetadata, type SkillStatus,
} from './lib/registry.js';
import { LogStore } from './lib/logs.js';
import { createSkillServer, type SkillPolicy } from './lib/mcp.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.basename(moduleDirectory) === 'dist'
  ? path.dirname(moduleDirectory)
  : moduleDirectory;
const registry = new Registry(path.join(root, 'skills'));
const logs = new LogStore(path.join(root, 'data'));
const settingsFile = path.join(root, 'data', 'settings.json');
const updatingSkills = new Set<string>();

async function registerBuiltinUsage(): Promise<void> {
  try {
    await registry.get('usage');
    return;
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 404) throw error;
  }

  const directory = path.join(root, 'builtin-skills', 'usage');
  const [yaml, content] = await Promise.all([
    fs.readFile(path.join(directory, 'skill.yaml'), 'utf8'),
    fs.readFile(path.join(directory, 'SKILL.md'), 'utf8'),
  ]);
  await registry.save({ ...parseYaml(yaml), content });
}

const host = process.env.HOST || '127.0.0.1';
const webPort = Number(process.env.WEB_PORT || process.env.PORT || 3200);
const mcpPort = Number(process.env.MCP_PORT || 3201);
const publicWebAccess = process.env.PUBLIC_WEB_ACCESS === 'true';
const publicMcpAccess = process.env.PUBLIC_MCP_ACCESS === 'true';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
};

async function getPolicy(): Promise<SkillPolicy> {
  try {
    const stored = JSON.parse(await fs.readFile(settingsFile, 'utf8')) as Partial<SkillPolicy>;
    return {
      allowedSkills: Array.isArray(stored.allowedSkills) ? stored.allowedSkills : [],
      allowedCategories: Array.isArray(stored.allowedCategories)
        ? stored.allowedCategories
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { allowedSkills: [], allowedCategories: [] };
    }
    throw error;
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(data));
}

async function readRaw(request: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new AppError('요청 크기 제한을 초과했습니다.', 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse((await readRaw(request)).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('JSON 형식이 올바르지 않습니다.');
  }
}

function validateRequest(request: IncomingMessage, allowPublicHost: boolean): void {
  const hostHeader = request.headers.host || '';
  const origin = request.headers.origin;

  if (!hostHeader) {
    throw new AppError('Host 헤더가 필요합니다.', 403);
  }

  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError('Origin이 올바르지 않습니다.', 403);
    }
    if (originHost !== hostHeader) {
      throw new AppError('다른 출처의 요청은 허용되지 않습니다.', 403);
    }
  }

  if (!allowPublicHost) {
    const requestedHost = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!['127.0.0.1', 'localhost', '::1'].includes(requestedHost)) {
      throw new AppError('로컬 Host만 허용합니다.', 403);
    }
  }
}

async function fetchSkillFile(value: unknown): Promise<string> {
  if (!validSourceUrl(value)) {
    throw new AppError('공개 GitHub의 SKILL.md HTTPS URL을 입력하세요.');
  }

  let url = new URL(value);

  if (url.hostname === 'github.com') {
    const match = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+\/)?SKILL\.md$/.exec(url.pathname);
    if (!match) throw new AppError('GitHub의 SKILL.md 파일 URL을 입력하세요.');
    url = new URL(
      `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4] || ''}SKILL.md`,
    );
  }

  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new AppError(`URL을 가져올 수 없습니다: HTTP ${response.status}`);
  }

  const size = Number(response.headers.get('content-length') || 0);
  if (size > 1024 * 1024) throw new AppError('파일은 1MB 이하만 허용합니다.', 413);
  const content = await response.text();
  if (Buffer.byteLength(content) > 1024 * 1024) {
    throw new AppError('파일은 1MB 이하만 허용합니다.', 413);
  }
  return content;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function remoteSkill(current: Skill, markdown: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  const parsed = frontmatter ? parseYaml(frontmatter[1]) : {};
  if (parsed.name && parsed.name !== current.name) {
    throw new AppError('원본 Skill 이름이 등록된 이름과 다릅니다.', 409);
  }

  const content = frontmatter ? markdown.slice(frontmatter[0].length) : markdown;
  const metadata = normalize({
    ...current,
    ...parsed,
    name: current.name,
    version: current.version,
    status: current.status,
    source_url: current.source_url,
    source_hash: hashContent(markdown),
  });
  return { metadata, content };
}

async function inspectSkillSource(name: string) {
  const current = await registry.get(name);
  if (!current.source_url) {
    throw new AppError('원본 URL이 없습니다. 수정 화면에서 먼저 연결하세요.', 409);
  }

  const markdown = await fetchSkillFile(current.source_url);
  const candidate = remoteSkill(current, markdown);
  const fields: (keyof SkillMetadata)[] = [
    'description', 'category', 'keywords', 'tags', 'compatible',
    'dependencies', 'author', 'license',
  ];
  const available = current.source_hash
    ? current.source_hash !== candidate.metadata.source_hash
    : current.content !== candidate.content || fields.some(field =>
      JSON.stringify(current[field]) !== JSON.stringify(candidate.metadata[field]));

  return { current, candidate, available };
}

function nextPatchVersion(version: string): string {
  const [major, minor, patch] = version.split('.');
  return `${major}.${minor}.${BigInt(patch) + 1n}`;
}

async function preview(input: Record<string, unknown>) {
  const content = input.url ? await fetchSkillFile(input.url) : input.content;
  if (typeof content !== 'string') throw new AppError('SKILL.md 내용이 필요합니다.');

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  let metadata: Record<string, unknown>;

  if (frontmatter) {
    const parsed = parseYaml(frontmatter[1]);
    metadata = {
      ...parsed,
      name: parsed.name || input.name,
      version: parsed.version || input.version || '1.0.0',
      description: parsed.description || input.description,
      tags: parsed.tags || input.tags || [],
    };
  } else if (typeof input.yaml === 'string') {
    metadata = parseYaml(input.yaml);
  } else {
    metadata = {
      name: input.name || '',
      version: input.version || '1.0.0',
      description: input.description || '',
      tags: input.tags || [],
      compatible: input.compatible || [],
    };
  }

  return {
    metadata: normalize({
      ...metadata,
      ...(input.url ? {
        source_url: input.url,
        source_hash: hashContent(content),
      } : {}),
    }),
    content: frontmatter ? content.slice(frontmatter[0].length) : content,
  };
}

const mcpHandler = createMcpHandler(
  () => createSkillServer(registry, logs, getPolicy),
  { responseMode: 'json' },
);

async function handleMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || '/mcp', `http://${request.headers.host || 'localhost'}`);
  const rawBody = ['POST', 'PUT', 'PATCH'].includes(request.method || '')
    ? await readRaw(request)
    : undefined;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const webRequest = new Request(url, {
    method: request.method,
    headers,
    body: rawBody?.toString('utf8'),
  });
  const result = await mcpHandler.fetch(webRequest);

  response.statusCode = result.status;
  result.headers.forEach((value, key) => response.setHeader(key, value));
  if (result.body) {
    const reader = result.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(value)) await once(response, 'drain');
    }
  }
  response.end();
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const segments = url.pathname.split('/').filter(Boolean);
  const method = request.method;
  const section = segments[1];

  if (section === 'runtime' && segments.length === 2 && method === 'GET') {
    sendJson(response, 200, { mcpPort, publicMcpAccess });
    return;
  }

  if (section === 'skills' && segments.length === 2) {
    if (method === 'GET') {
      sendJson(response, 200, await registry.list(Object.fromEntries(url.searchParams)));
      return;
    }
    if (method === 'POST') {
      sendJson(response, 201, await registry.save(await readJson(request)));
      return;
    }
  }

  if (section === 'skills' && segments.length === 3) {
    const name = segments[2];
    if (method === 'GET') {
      sendJson(response, 200, await registry.get(name, url.searchParams.get('version') || 'latest'));
      return;
    }
    if (method === 'PUT') {
      const input = await readJson(request);
      sendJson(response, 200, await registry.save(
        { ...input, name },
        { overwrite: true },
      ));
      return;
    }
    if (method === 'DELETE') {
      await registry.remove(name);
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  if (section === 'skills' && segments.length === 4) {
    const name = segments[2];
    if (segments[3] === 'update-check' && method === 'GET') {
      const { current, available } = await inspectSkillSource(name);
      sendJson(response, 200, {
        available,
        currentVersion: current.version,
        nextVersion: available ? nextPatchVersion(current.version) : null,
      });
      return;
    }
    if (segments[3] === 'update' && method === 'POST') {
      if (updatingSkills.has(name)) {
        throw new AppError('이미 업데이트가 진행 중입니다.', 409);
      }
      updatingSkills.add(name);
      try {
        const { current, candidate, available } = await inspectSkillSource(name);
        if (!available) {
          sendJson(response, 200, { updated: false, version: current.version });
          return;
        }
        const version = nextPatchVersion(current.version);
        await registry.save(
          { ...candidate.metadata, version, content: candidate.content },
          { overwrite: true },
        );
        sendJson(response, 200, { updated: true, version });
      } finally {
        updatingSkills.delete(name);
      }
      return;
    }
    if (segments[3] === 'versions' && method === 'GET') {
      sendJson(response, 200, await registry.versions(name));
      return;
    }
    if (segments[3] === 'status' && method === 'PATCH') {
      const input = await readJson(request);
      sendJson(response, 200, await registry.setStatus(name, input.status as SkillStatus));
      return;
    }
  }

  if (section === 'logs' && method === 'GET') {
    sendJson(response, 200, await logs.list(Object.fromEntries(url.searchParams)));
    return;
  }
  if (section === 'preview' && method === 'POST') {
    sendJson(response, 200, await preview(await readJson(request)));
    return;
  }

  sendJson(response, 404, { error: 'API를 찾을 수 없습니다.' });
}

async function routeWeb(request: IncomingMessage, response: ServerResponse): Promise<void> {
  validateRequest(request, publicWebAccess);
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    await handleApi(request, response, url);
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: '허용되지 않은 요청입니다.' });
    return;
  }

  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['index.html', 'app.js', 'style.css', 'favicon.ico'].includes(name)) {
    sendJson(response, 404, { error: '페이지를 찾을 수 없습니다.' });
    return;
  }

  const file = path.join(root, 'public', name);
  const data = await fs.readFile(file);
  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  response.end(data);
}

async function routeMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
  validateRequest(request, publicMcpAccess);
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === '/mcp') {
    await handleMcp(request, response);
    return;
  }

  sendJson(response, 404, { error: 'MCP 엔드포인트를 찾을 수 없습니다.' });
}

function createHttpServer(
  route: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Server {
  return http.createServer((request, response) => {
    route(request, response).catch(error => {
      if (!response.headersSent) {
        const status = error instanceof AppError ? error.status : 500;
        sendJson(response, status, { error: (error as Error).message });
      } else {
        response.destroy(error as Error);
      }
    });
  });
}

await logs.init();
await registerBuiltinUsage();

if (process.argv.includes('--stdio')) {
  void serveStdio(() => createSkillServer(registry, logs, getPolicy));
} else {
  for (const [label, port] of [['WEB_PORT', webPort], ['MCP_PORT', mcpPort]] as const) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${label}가 올바르지 않습니다.`);
    }
  }
  if (webPort === mcpPort) {
    throw new Error('WEB_PORT와 MCP_PORT는 달라야 합니다.');
  }
  createHttpServer(routeWeb).listen(webPort, host, () => {
    console.log(`SkillPort Web: http://${host}:${webPort}`);
  });
  createHttpServer(routeMcp).listen(mcpPort, host, () => {
    console.log(`SkillPort MCP: http://${host}:${mcpPort}/mcp`);
  });
}

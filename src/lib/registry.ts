import fs from 'node:fs/promises';
import path from 'node:path';

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_CONTENT_BYTES = 1024 * 1024;

const FIELDS = new Set([
  'name', 'version', 'description', 'category', 'keywords', 'tags',
  'entrypoint', 'compatible', 'auto_load', 'priority', 'dependencies',
  'status', 'author', 'license', 'source_url', 'source_hash',
]);
const LIST_FIELDS = new Set(['keywords', 'tags', 'compatible', 'dependencies']);

export type SkillStatus = 'deployed' | 'testing' | 'paused';

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  category: string;
  keywords: string[];
  tags: string[];
  entrypoint: 'SKILL.md';
  compatible: string[];
  auto_load: false;
  priority: string;
  dependencies: string[];
  status: SkillStatus;
  author: string;
  license: string;
  source_url: string;
  source_hash: string;
}

export interface Skill extends SkillMetadata {
  content: string;
}

export interface SkillFilter {
  query?: string;
  status?: string;
  tag?: string;
  category?: string;
  agent?: string;
}

export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validName(value: unknown): value is string {
  return typeof value === 'string' && NAME_PATTERN.test(value);
}

export function validVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

export function validSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password
      || url.search || url.hash || url.port) return false;
    if (url.hostname === 'github.com') {
      return /^\/[^/]+\/[^/]+\/blob\/[^/]+\/(?:.+\/)?SKILL\.md$/.test(url.pathname);
    }
    return url.hostname === 'raw.githubusercontent.com'
      && /^\/[^/]+\/[^/]+\/[^/]+\/(?:.+\/)?SKILL\.md$/.test(url.pathname);
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('메타데이터가 필요합니다.');
  }
  return value as Record<string, unknown>;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new AppError('잘못된 YAML 문자열입니다.');
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

/** Skill 메타데이터에 필요한 제한적인 YAML 구문만 해석합니다. */
export function parseYaml(source: string): Record<string, unknown> {
  if (source.length > 65536) {
    throw new AppError('메타데이터가 너무 큽니다.');
  }

  const result: Record<string, unknown> = {};
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  let current: string | null = null;
  let block: string[] | null = null;

  for (const line of lines) {
    if (block) {
      if (/^  /.test(line) || !line.trim()) {
        block.push(line.replace(/^  /, ''));
        continue;
      }
      result[current!] = block.join('\n').trim();
      block = null;
    }

    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const field = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (field) {
      current = field[1];
      if (!FIELDS.has(current) || Object.hasOwn(result, current)) {
        throw new AppError('지원하지 않거나 중복된 메타데이터 필드입니다.');
      }

      const value = field[2];
      if (value === '>' || value === '|') {
        block = [];
      } else if (LIST_FIELDS.has(current)) {
        if (value === '') {
          result[current] = [];
        } else if (value.startsWith('[')) {
          try {
            result[current] = JSON.parse(value);
          } catch {
            throw new AppError('목록 형식이 올바르지 않습니다.');
          }
        } else {
          throw new AppError(`${current}는 목록이어야 합니다.`);
        }
      } else {
        result[current] = parseScalar(value);
      }
      continue;
    }

    const item = /^  -\s+(.+)$/.exec(line);
    if (item && current && LIST_FIELDS.has(current)) {
      (result[current] as unknown[]).push(parseScalar(item[1]));
      continue;
    }
    throw new AppError('지원하지 않는 YAML 형식입니다.');
  }

  if (block) result[current!] = block.join('\n').trim();
  return result;
}

export function normalize(value: unknown): SkillMetadata {
  const input = asRecord(value);
  if (!validName(input.name)) {
    throw new AppError('Skill 이름은 소문자, 숫자, 하이픈만 사용할 수 있습니다.');
  }
  if (!validVersion(input.version)) {
    throw new AppError('버전은 MAJOR.MINOR.PATCH 형식이어야 합니다.');
  }
  if (typeof input.description !== 'string' || !input.description.trim()) {
    throw new AppError('설명이 필요합니다.');
  }
  if (input.entrypoint && input.entrypoint !== 'SKILL.md') {
    throw new AppError('entrypoint는 SKILL.md만 허용합니다.');
  }

  const metadata: SkillMetadata = {
    name: input.name,
    version: input.version,
    description: input.description.trim(),
    category: (input.category || 'general') as string,
    keywords: (input.keywords || []) as string[],
    tags: (input.tags || []) as string[],
    entrypoint: 'SKILL.md',
    compatible: (input.compatible || []) as string[],
    auto_load: false,
    priority: (input.priority || 'normal') as string,
    dependencies: (input.dependencies || []) as string[],
    status: (input.status || 'deployed') as SkillStatus,
    author: (input.author || '') as string,
    license: (input.license || '') as string,
    source_url: (input.source_url || '') as string,
    source_hash: (input.source_hash || '') as string,
  };

  for (const key of ['category', 'priority', 'status', 'author', 'license'] as const) {
    if (typeof metadata[key] !== 'string') {
      throw new AppError(`${key} 형식이 올바르지 않습니다.`);
    }
  }
  if (!['deployed', 'testing', 'paused'].includes(metadata.status)) {
    throw new AppError('배포 상태가 올바르지 않습니다.');
  }
  if (metadata.source_url && !validSourceUrl(metadata.source_url)) {
    throw new AppError('원본 URL은 공개 GitHub의 SKILL.md HTTPS 주소여야 합니다.');
  }
  if (typeof metadata.source_url !== 'string'
    || typeof metadata.source_hash !== 'string'
    || (metadata.source_hash && !/^[a-f0-9]{64}$/.test(metadata.source_hash))
    || (!metadata.source_url && metadata.source_hash)) {
    throw new AppError('원본 URL 또는 해시 형식이 올바르지 않습니다.');
  }
  for (const key of ['keywords', 'tags', 'compatible', 'dependencies'] as const) {
    const items = metadata[key];
    if (!Array.isArray(items) || items.some(item => typeof item !== 'string' || item.length > 100)) {
      throw new AppError(`${key} 형식이 올바르지 않습니다.`);
    }
  }
  if (metadata.dependencies.some(name => !validName(name) || name === metadata.name)) {
    throw new AppError('의존 Skill 이름이 올바르지 않습니다.');
  }
  return metadata;
}

export function toYaml(metadata: SkillMetadata): string {
  const fields = [
    'name', 'version', 'description', 'category', 'keywords', 'tags',
    'entrypoint', 'compatible', 'auto_load', 'priority', 'dependencies',
    'status', 'author', 'license', 'source_url', 'source_hash',
  ] as const;

  return fields.map(key => {
    const value = metadata[key];
    if (Array.isArray(value)) {
      return `${key}:\n${value.map(item => `  - ${JSON.stringify(item)}\n`).join('')}`;
    }
    return `${key}: ${typeof value === 'boolean' ? value : JSON.stringify(value)}\n`;
  }).join('');
}

function compareVersion(left: string, right: string): number {
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export class Registry {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private directory(name: string): string {
    if (!validName(name)) throw new AppError('Skill 이름이 올바르지 않습니다.');
    return path.join(this.root, name);
  }

  async list(filter: SkillFilter = {}): Promise<SkillMetadata[]> {
    await fs.mkdir(this.root, { recursive: true });
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const skills: SkillMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !validName(entry.name)) continue;
      try {
        const yaml = await fs.readFile(path.join(this.directory(entry.name), 'skill.yaml'), 'utf8');
        const metadata = normalize(parseYaml(yaml));
        if (metadata.name === entry.name) skills.push(metadata);
      } catch {
        // Invalid drafts are not advertised to MCP clients.
      }
    }

    const query = (filter.query || '').trim().toLocaleLowerCase();
    return skills.filter(skill => {
      const searchable = [
        skill.name, skill.description, skill.category, ...skill.tags, ...skill.keywords,
      ].join(' ').toLocaleLowerCase();

      return (!query || searchable.includes(query))
        && (!filter.status || skill.status === filter.status)
        && (!filter.tag || skill.tags.includes(filter.tag))
        && (!filter.category || skill.category === filter.category)
        && (!filter.agent || !skill.compatible.length || skill.compatible.includes(filter.agent));
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(name: string, version = 'latest'): Promise<Skill> {
    const directory = this.directory(name);
    const stat = await fs.lstat(directory).catch(error => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new AppError('Skill을 찾을 수 없습니다.', 404);
    }

    try {
      let metadata: SkillMetadata;
      let content: string;
      if (version === 'latest') {
        const yaml = await fs.readFile(path.join(directory, 'skill.yaml'), 'utf8');
        metadata = normalize(parseYaml(yaml));
        content = await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8');
      } else {
        if (!validVersion(version)) throw new AppError('버전 형식이 올바르지 않습니다.');
        const file = path.join(directory, '.versions', `${version}.json`);
        const snapshot = JSON.parse(await fs.readFile(file, 'utf8')) as {
          metadata: unknown;
          content: unknown;
        };
        metadata = normalize(snapshot.metadata);
        content = snapshot.content as string;
      }

      if (metadata.name !== name) {
        throw new AppError('Skill 메타데이터 이름이 일치하지 않습니다.', 409);
      }
      if (typeof content !== 'string') {
        throw new AppError('Skill 내용이 손상되었습니다.', 500);
      }
      return { ...metadata, content };
    } catch (error) {
      if (isMissing(error)) throw new AppError('Skill 또는 버전을 찾을 수 없습니다.', 404);
      throw error;
    }
  }

  async versions(name: string): Promise<{
    name: string;
    current: string;
    latest: string;
    versions: string[];
  }> {
    const current = await this.get(name);
    const directory = path.join(this.directory(name), '.versions');
    const files = await fs.readdir(directory).catch(error => {
      if (isMissing(error)) return [];
      throw error;
    });
    const versions = files
      .filter(file => file.endsWith('.json') && validVersion(file.slice(0, -5)))
      .map(file => file.slice(0, -5))
      .sort(compareVersion)
      .reverse();

    return {
      name,
      current: current.version,
      latest: versions[0] || current.version,
      versions,
    };
  }

  async save(input: unknown, options: { overwrite?: boolean } = {}): Promise<SkillMetadata> {
    const record = asRecord(input);
    const metadata = normalize(record);
    const content = record.content;
    if (typeof content !== 'string' || !content.trim()
      || Buffer.byteLength(content) > MAX_CONTENT_BYTES) {
      throw new AppError('SKILL.md 내용은 1MB 이하의 비어 있지 않은 텍스트여야 합니다.');
    }

    await fs.mkdir(this.root, { recursive: true });
    const directory = this.directory(metadata.name);
    const exists = await fs.stat(directory).then(() => true, error => {
      if (isMissing(error)) return false;
      throw error;
    });

    if (exists && !options.overwrite) throw new AppError('이미 등록된 Skill입니다.', 409);
    if (exists) {
      const old = await this.get(metadata.name);
      if (compareVersion(metadata.version, old.version) < 0) {
        throw new AppError('기존 버전보다 낮은 버전으로 저장할 수 없습니다.', 409);
      }
    } else {
      await fs.mkdir(directory);
    }

    const versionDirectory = path.join(directory, '.versions');
    await fs.mkdir(versionDirectory, { recursive: true });
    const snapshot = path.join(versionDirectory, `${metadata.version}.json`);
    const snapshotExists = await fs.stat(snapshot).then(() => true, error => {
      if (isMissing(error)) return false;
      throw error;
    });
    if (snapshotExists) throw new AppError('이미 존재하는 버전입니다.', 409);

    await fs.writeFile(snapshot, JSON.stringify({ metadata, content }, null, 2), 'utf8');
    await fs.writeFile(path.join(directory, 'skill.yaml'), toYaml(metadata), 'utf8');
    await fs.writeFile(path.join(directory, 'SKILL.md'), content, 'utf8');
    return metadata;
  }

  async setStatus(name: string, status: SkillStatus): Promise<SkillMetadata> {
    if (!['deployed', 'testing', 'paused'].includes(status)) {
      throw new AppError('배포 상태가 올바르지 않습니다.');
    }
    const skill = await this.get(name);
    skill.status = status;
    await fs.writeFile(path.join(this.directory(name), 'skill.yaml'), toYaml(skill), 'utf8');
    return normalize(skill);
  }

  async remove(name: string): Promise<void> {
    await this.get(name);
    await fs.rm(this.directory(name), { recursive: true });
  }
}

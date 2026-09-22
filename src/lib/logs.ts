import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface AccessLog {
  time: string;
  requestId: string;
  agent: string;
  kind: string;
  skill: string;
  operation: string;
  status: 'success' | 'error';
  message?: string;
}

export class LogStore {
  private readonly file: string;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
    this.file = path.join(root, 'access.ndjson');
  }

  async add(entry: Omit<AccessLog, 'time' | 'requestId' | 'agent'> & {
    agent?: string;
  }): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const row: AccessLog = {
      time: new Date().toISOString(),
      requestId: randomUUID().slice(0, 8),
      agent: entry.agent || 'MCP Client',
      ...entry,
    };
    await fs.appendFile(this.file, `${JSON.stringify(row)}\n`, 'utf8');
  }

  async list(filter: {
    limit?: number | string;
    query?: string;
    status?: string;
    skill?: string;
  } = {}): Promise<AccessLog[]> {
    let raw = '';
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const rows = raw.trim().split('\n').filter(Boolean).flatMap(line => {
      try {
        return [JSON.parse(line) as AccessLog];
      } catch {
        return [];
      }
    }).reverse();

    const query = (filter.query || '').toLowerCase();
    const limit = Math.min(500, Math.max(1, Number(filter.limit) || 100));
    return rows.filter(row => {
      return (!filter.status || row.status === filter.status)
        && (!filter.skill || row.skill === filter.skill)
        && (!query || JSON.stringify(row).toLowerCase().includes(query));
    }).slice(0, limit);
  }
}

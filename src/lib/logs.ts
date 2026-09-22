import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

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

export interface LogFilter {
  limit?: number | string;
  offset?: number | string;
  query?: string;
  status?: string;
  skill?: string;
}

type SqlLog = {
  time: string;
  request_id: string;
  agent: string;
  kind: string;
  skill: string;
  operation: string;
  status: 'success' | 'error';
  message: string | null;
};

function fromSql(row: SqlLog): AccessLog {
  return {
    time: row.time,
    requestId: row.request_id,
    agent: row.agent,
    kind: row.kind,
    skill: row.skill,
    operation: row.operation,
    status: row.status,
    ...(row.message === null ? {} : { message: row.message }),
  };
}

export class LogStore {
  private readonly root: string;
  private readonly databaseFile: string;
  private opening?: Promise<DatabaseSync>;

  constructor(root: string) {
    this.root = root;
    this.databaseFile = path.join(root, 'access.sqlite');
  }

  private async database(): Promise<DatabaseSync> {
    if (!this.opening) {
      this.opening = this.open().catch(error => {
        this.opening = undefined;
        throw error;
      });
    }
    return this.opening;
  }

  async init(): Promise<void> {
    await this.database();
  }

  async close(): Promise<void> {
    if (!this.opening) return;
    const database = await this.opening;
    database.close();
    this.opening = undefined;
  }

  private async open(): Promise<DatabaseSync> {
    await fs.mkdir(this.root, { recursive: true });
    const database = new DatabaseSync(this.databaseFile);
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS access_logs (
          id INTEGER PRIMARY KEY,
          time TEXT NOT NULL,
          request_id TEXT NOT NULL,
          agent TEXT NOT NULL,
          kind TEXT NOT NULL,
          skill TEXT NOT NULL,
          operation TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('success', 'error')),
          message TEXT,
          search_text TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS access_logs_status_latest
          ON access_logs(status, id DESC);
        CREATE INDEX IF NOT EXISTS access_logs_skill_latest
          ON access_logs(skill, id DESC);
        CREATE INDEX IF NOT EXISTS access_logs_skill_status_latest
          ON access_logs(skill, status, id DESC);
      `);
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async add(entry: Omit<AccessLog, 'time' | 'requestId' | 'agent'> & {
    agent?: string;
  }): Promise<void> {
    const database = await this.database();
    const row: AccessLog = {
      time: new Date().toISOString(),
      requestId: randomUUID().slice(0, 8),
      agent: entry.agent || 'MCP Client',
      ...entry,
    };
    database.prepare(`
      INSERT INTO access_logs (
        time, request_id, agent, kind, skill, operation, status,
        message, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.time, row.requestId, row.agent, row.kind, row.skill,
      row.operation, row.status, row.message ?? null,
      JSON.stringify(row).toLowerCase(),
    );
  }

  async list(filter: LogFilter = {}): Promise<AccessLog[]> {
    const database = await this.database();
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (filter.status) {
      conditions.push('status = ?');
      values.push(filter.status);
    }
    if (filter.skill) {
      conditions.push('skill = ?');
      values.push(filter.skill);
    }
    if (filter.query) {
      conditions.push('instr(search_text, ?) > 0');
      values.push(filter.query.toLowerCase());
    }

    const requestedLimit = Number(filter.limit) || 100;
    const requestedOffset = Number(filter.offset) || 0;
    const limit = Math.min(500, Math.max(1, Math.trunc(requestedLimit)));
    const offset = Number.isFinite(requestedOffset)
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(requestedOffset)))
      : 0;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = database.prepare(`
      SELECT time, request_id, agent, kind, skill, operation, status, message
      FROM access_logs
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as unknown as SqlLog[];
    return rows.map(fromSql);
  }
}

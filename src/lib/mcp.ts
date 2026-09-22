import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { LogStore } from './logs.js';
import { Registry, type SkillFilter, type SkillMetadata } from './registry.js';

export interface SkillPolicy {
  allowedSkills: string[];
  allowedCategories: string[];
}

type PolicyLoader = () => Promise<SkillPolicy>;

function publicMetadata(skill: SkillMetadata) {
  const {
    name, version, description, tags, category, keywords,
    compatible, dependencies, status,
  } = skill;
  return {
    name, version, description, tags, category, keywords,
    compatible, dependencies, status,
  };
}

function isAllowed(skill: SkillMetadata, policy: SkillPolicy): boolean {
  return (!policy.allowedSkills.length || policy.allowedSkills.includes(skill.name))
    && (!policy.allowedCategories.length
      || policy.allowedCategories.includes(skill.category));
}

function usage() {
  return {
    purpose: '필요한 Skill만 검색하고 선택적으로 본문을 읽습니다.',
    workflow: [
      {
        step: 1,
        action: '현재 요청에 별도 Skill이 필요한지 판단합니다. 필요 없으면 조회하지 않습니다.',
      },
      {
        step: 2,
        tool: 'search_skills',
        arguments: { query: '작업 관련 검색어' },
        optionalArguments: ['agent'],
        action: '이름·설명·태그 등의 메타데이터로 후보를 찾습니다.',
      },
      {
        step: 3,
        tool: 'list_skills',
        arguments: {},
        optionalArguments: ['category', 'agent'],
        action: '검색어를 정하기 어렵거나 전체 목록이 필요할 때만 사용합니다.',
      },
      {
        step: 4,
        tool: 'get_skill_version',
        arguments: { name: '선택한 Skill 이름' },
        action: '고정 버전이나 버전 비교가 필요할 때만 본문 조회 전에 사용합니다.',
      },
      {
        step: 5,
        tool: 'get_skill',
        arguments: { name: '선택한 Skill 이름' },
        optionalArguments: ['version'],
        action: '선택한 Skill의 본문만 가져옵니다. version을 생략하면 현재 버전입니다.',
      },
    ],
    resources: ['skill://<name>', 'skill://<name>/<version>'],
    constraints: [
      '목록과 검색은 본문을 반환하지 않습니다.',
      '모든 Skill 본문을 미리 가져오거나 의존 Skill을 자동 로딩하지 않습니다.',
      '조회 결과가 없거나 오류가 나면 Skill 내용을 추측하지 않습니다.',
    ],
  };
}

/** HTTP 요청 또는 stdio 연결마다 독립적인 공식 SDK 서버를 만듭니다. */
export function createSkillServer(
  registry: Registry,
  logs: LogStore,
  loadPolicy: PolicyLoader,
): McpServer {
  const server = new McpServer(
    { name: 'skillport', version: '0.2.0' },
    {
      instructions: '사용법이 필요하면 usage 도구를 한 번 호출하세요. Skill 본문을 미리 전부 읽지 말고, 검색 결과에서 필요한 Skill만 선택해 읽으세요.',
    },
  );

  async function visibleSkills(filter: SkillFilter = {}) {
    const [skills, policy] = await Promise.all([
      registry.list({ ...filter, status: 'deployed' }),
      loadPolicy(),
    ]);
    return skills.filter(skill => isAllowed(skill, policy));
  }

  async function availableSkill(name: string, version = 'latest') {
    const [current, policy] = await Promise.all([
      registry.get(name),
      loadPolicy(),
    ]);
    if (current.status !== 'deployed' || !isAllowed(current, policy)) {
      throw new Error('Skill을 사용할 수 없습니다.');
    }
    return registry.get(name, version);
  }

  async function toolResult(
    operation: string,
    skill: string,
    action: () => Promise<unknown>,
  ) {
    try {
      const value = await action();
      await logs.add({ kind: 'tool', skill, operation, status: 'success' });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(value) }],
        structuredContent: { result: value },
      };
    } catch (error) {
      const message = (error as Error).message;
      await logs.add({
        kind: 'tool', skill, operation, status: 'error', message,
      }).catch(() => {});
      return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
      };
    }
  }

  server.registerTool(
    'usage',
    {
      description: 'SkillPort MCP 도구의 사용 순서와 인수를 안내합니다. 처음 연결했거나 사용법이 불명확할 때 호출하세요.',
      inputSchema: z.object({}),
    },
    async () => toolResult('usage', '', async () => usage()),
  );

  server.registerTool(
    'list_skills',
    {
      description: '사용 가능한 Skill 메타데이터만 조회합니다. 본문은 반환하지 않습니다.',
      inputSchema: z.object({
        agent: z.string().optional().describe('선택적 Agent 이름'),
        category: z.string().optional().describe('선택적 카테고리'),
      }),
    },
    async ({ agent, category }) => toolResult('list_skills', '', async () => {
      return (await visibleSkills({ agent, category })).map(publicMetadata);
    }),
  );

  server.registerTool(
    'search_skills',
    {
      description: '이름, 설명, 태그, 카테고리, 키워드로 Skill을 검색합니다.',
      inputSchema: z.object({
        query: z.string().describe('검색어'),
        agent: z.string().optional().describe('선택적 Agent 이름'),
      }),
    },
    async ({ query, agent }) => toolResult('search_skills', '', async () => {
      return (await visibleSkills({ query, agent })).map(publicMetadata);
    }),
  );

  server.registerTool(
    'get_skill',
    {
      description: '선택한 Skill 본문을 필요할 때만 가져옵니다.',
      inputSchema: z.object({
        name: z.string().describe('Skill 이름'),
        version: z.string().optional().describe('고정 버전 또는 latest'),
      }),
    },
    async ({ name, version }) => toolResult('get_skill', name, () => {
      return availableSkill(name, version);
    }),
  );

  server.registerTool(
    'get_skill_version',
    {
      description: '현재 버전과 등록된 버전을 확인합니다.',
      inputSchema: z.object({
        name: z.string().describe('Skill 이름'),
      }),
    },
    async ({ name }) => toolResult('get_skill_version', name, async () => {
      await availableSkill(name);
      return registry.versions(name);
    }),
  );

  async function readResource(uri: URL, name: string, version = 'latest') {
    try {
      const skill = await availableSkill(name, version);
      await logs.add({
        kind: 'resource', skill: name, operation: 'read', status: 'success',
      });
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/markdown',
          text: skill.content,
        }],
      };
    } catch (error) {
      await logs.add({
        kind: 'resource',
        skill: name,
        operation: 'read',
        status: 'error',
        message: (error as Error).message,
      }).catch(() => {});
      throw error;
    }
  }

  server.registerResource(
    'skill',
    new ResourceTemplate('skill://{name}', {
      list: async () => ({
        resources: (await visibleSkills()).map(skill => ({
          uri: `skill://${skill.name}`,
          name: skill.name,
          description: skill.description,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      description: '필요한 Skill의 현재 본문',
      mimeType: 'text/markdown',
    },
    async (uri, { name }) => readResource(uri, String(name)),
  );

  server.registerResource(
    'skill-version',
    new ResourceTemplate('skill://{name}/{version}', { list: undefined }),
    {
      description: '특정 버전의 Skill 본문',
      mimeType: 'text/markdown',
    },
    async (uri, { name, version }) => readResource(uri, String(name), String(version)),
  );

  return server;
}

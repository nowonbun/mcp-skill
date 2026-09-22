# MCP 기반 AI Skill 관리 시스템 요구사항

## 1. 목적

여러 AI Agent가 공통 Skill 저장소를 사용하면서, 모든 Skill을 Agent Context에 미리 로딩하지 않고 **필요한 Skill만 동적으로 선택하여 로딩**할 수 있는 시스템을 구축한다.

MCP(Model Context Protocol)를 Skill Repository와 Agent 사이의 표준 인터페이스로 사용한다.

핵심 목표는 다음과 같다.

* Skill 중앙 관리
* Agent별 Skill 공유
* 필요한 Skill만 선택적 로딩
* 불필요한 Context 소비 방지
* Skill 검색 및 자동 선택
* Skill 버전 관리
* Git 기반 Skill 관리 가능
* Claude, Codex, ChatGPT 및 자체 Agent 등 다양한 Agent에서 사용 가능

---

## 2. 기본 아키텍처

```text
User
  │
  ▼
AI Agent
  │
  │ Skill 선택
  ▼
Skill Selector
  │
  │ MCP
  ▼
Skill MCP Server
  │
  ├── list_skills
  ├── search_skills
  ├── get_skill
  └── get_skill_version
  │
  ▼
Skill Repository
  │
  ├── coding/
  ├── database/
  ├── project/
  └── security/
```

Agent는 전체 Skill 본문을 사전에 로딩하지 않는다.

Agent가 기본적으로 알고 있는 정보는 Skill의 이름, 설명, 태그 등 최소한의 Metadata로 제한한다.

실제 Skill 내용은 해당 Skill이 필요하다고 판단된 시점에 MCP를 통해 가져온다.

---

## 3. Skill 기본 구조

각 Skill은 독립적인 디렉터리로 관리한다.

```text
skills/
├── db-design/
│   ├── skill.yaml
│   └── SKILL.md
│
├── java-code-review/
│   ├── skill.yaml
│   └── SKILL.md
│
└── jira-planning/
    ├── skill.yaml
    └── SKILL.md
```

### skill.yaml 예시

```yaml
name: db-design
version: 1.0.0

description: >
  데이터베이스 모델링 및 테이블 설계 작업에 사용하는 Skill

tags:
  - database
  - modeling
  - temporal
  - sql

entrypoint: SKILL.md

compatible:
  - claude
  - codex
  - chatgpt

auto_load: false
priority: normal

dependencies: []
```

`SKILL.md`에는 Agent가 실제 작업할 때 따라야 할 상세 지침을 작성한다.

---

## 4. Skill 선택 방식

SkillPort MCP가 연결된 Agent는 새 사용자 작업마다 작업 내용으로 Skill을 한 번 검색한다. 검색 결과에서 현재 작업에 필요한 Skill이 있는지 판단한다.

예:

```text
User:
"valid_from / valid_to를 사용하는 데이터 모델을 검토해줘."

        ↓

Agent:
사용자 작업에서 검색어 추출

        ↓

search_skills("temporal database modeling")

        ↓

db-design 발견

        ↓

get_skill("db-design")

        ↓

SKILL.md 로딩

        ↓

Skill 지침을 적용하여 작업 수행
```

일치하는 Skill이 없거나 본문 지침이 필요하지 않은 요청은 `get_skill`을 호출하지 않고 일반 방식으로 처리한다. 검색 자체는 생략하지 않는다.

---

## 5. Lazy Loading

본 시스템의 핵심 요구사항이다.

Agent 시작 시 모든 Skill의 `SKILL.md`를 Context에 삽입하지 않는다.

초기에는 최소 Metadata만 제공한다.

예:

```json
[
  {
    "name": "db-design",
    "description": "데이터 모델링 작업에 사용",
    "tags": ["database", "modeling"]
  },
  {
    "name": "java-code-review",
    "description": "Java/Spring 코드 리뷰에 사용",
    "tags": ["java", "spring", "review"]
  },
  {
    "name": "jira-planning",
    "description": "Jira 기반 프로젝트 관리 작업에 사용",
    "tags": ["jira", "project"]
  }
]
```

Agent가 실제 Skill 사용을 결정한 경우에만 Skill 본문을 가져온다.

```text
get_skill("db-design")
```

이를 통해 Skill 수가 증가하더라도 Agent Context 사용량을 최소화한다.

---

## 6. MCP 인터페이스

### list_skills

사용 가능한 Skill 목록을 반환한다.

```text
list_skills()
```

응답 예:

```json
[
  {
    "name": "db-design",
    "version": "1.2.0",
    "description": "Database modeling skill"
  },
  {
    "name": "java-code-review",
    "version": "2.1.0",
    "description": "Java code review skill"
  }
]
```

---

### search_skills

사용자 작업과 관련된 Skill을 검색한다.

```text
search_skills("temporal database")
```

검색 대상:

* name
* description
* tags
* category
* keywords

필요한 경우 Semantic Search를 추가할 수 있다.

---

### get_skill

특정 Skill의 실제 내용을 반환한다.

```text
get_skill("db-design")
```

응답 예:

```json
{
  "name": "db-design",
  "version": "1.2.0",
  "content": "...SKILL.md content..."
}
```

---

### get_skill_version

Skill 버전 정보를 조회한다.

```text
get_skill_version("db-design")
```

응답 예:

```json
{
  "name": "db-design",
  "current": "1.2.0",
  "latest": "1.3.0"
}
```

---

## 7. MCP Resource 지원

Skill 본문은 MCP Tool 호출뿐 아니라 MCP Resource로 제공할 수 있어야 한다.

예:

```text
skill://db-design
skill://java-code-review
skill://jira-planning
```

Agent는 필요한 경우 Resource를 읽어 Skill 내용을 Context에 추가한다.

권장 구조:

```text
MCP Tools
 ├── list_skills
 ├── search_skills
 ├── get_skill_version
 └── 기타 관리 기능

MCP Resources
 ├── skill://db-design
 ├── skill://java-code-review
 └── skill://jira-planning
```

즉, **Skill 검색·관리에는 Tool을 사용하고 실제 Skill 문서 제공에는 Resource를 사용할 수 있다.**

---

## 8. Skill Repository

Skill 원본은 Git Repository에서 관리할 수 있어야 한다.

```text
Git Repository
       │
       ▼
Skill Registry
       │
       ▼
MCP Skill Server
       │
       ▼
AI Agents
```

Git을 사용할 경우 다음 기능을 활용할 수 있다.

* Skill 변경 이력
* Pull Request 기반 리뷰
* 버전 관리
* Rollback
* Branch 관리
* 팀 단위 Skill 공유

---

## 9. Agent 호환성

동일한 Skill Repository를 여러 Agent가 사용할 수 있도록 설계한다.

대상 예:

```text
                 Skill MCP Server
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
      Claude          Codex       Custom Agent
```

Skill 내부에서 특정 Agent에 종속되는 기능이 필요한 경우 Metadata를 통해 호환성을 정의한다.

```yaml
compatible:
  - claude
  - codex
```

---

## 10. Skill Dependency

Skill이 다른 Skill을 필요로 할 수 있도록 Dependency 기능을 제공한다.

예:

```yaml
name: spring-code-review

dependencies:
  - java-code-review
  - security-review
```

Agent가 `spring-code-review`를 로딩하면 필요한 Dependency Skill도 확인할 수 있어야 한다.

단, Dependency 역시 무조건 로딩하지 않고 실제 필요 여부에 따라 선택적으로 로딩할 수 있도록 한다.

---

## 11. Skill Version 관리

Skill은 Semantic Versioning 사용을 기본으로 한다.

```text
MAJOR.MINOR.PATCH

1.0.0
1.1.0
1.1.1
2.0.0
```

Agent 또는 프로젝트별로 특정 Skill 버전을 고정할 수 있어야 한다.

예:

```yaml
skills:
  db-design: 1.4.2
  java-code-review: 2.1.0
```

또는 최신 버전을 사용할 수 있다.

```yaml
skills:
  db-design: latest
```

---

## 12. Skill 활성화 정책

프로젝트 또는 Agent별로 사용할 Skill을 제한할 수 있어야 한다.

예:

```yaml
allowed_skills:
  - db-design
  - java-code-review
  - security-review
```

또는 Category 단위로 허용할 수 있다.

```yaml
allowed_categories:
  - coding
  - database
```

이를 통해 특정 Agent가 불필요한 Skill을 검색하거나 실행하는 것을 방지할 수 있다.

---

## 13. Skill 자동 선택

최종적으로 Agent는 다음 순서로 Skill을 선택한다.

```text
User Request
     │
     ▼
Intent 분석
     │
     ▼
Skill 검색
     │
     ▼
Candidate Skill
     │
     ▼
Skill 필요 여부 판단
     │
     ├── 필요 없음 ──→ 일반 Agent 처리
     │
     ▼
필요 Skill 선택
     │
     ▼
Skill Lazy Loading
     │
     ▼
Dependency 확인
     │
     ▼
Skill 적용
     │
     ▼
Task 실행
```

Skill Server가 특정 Skill 사용을 강제하기보다는 **Agent가 사용자 요청과 Skill Metadata를 바탕으로 적절한 Skill을 선택하는 구조**를 기본으로 한다.

---

## 14. Context 관리

Skill 시스템은 Agent Context를 효율적으로 사용해야 한다.

피해야 할 구조:

```text
Agent Start

↓
100개의 SKILL.md 전체 로딩

↓
Context 낭비
```

권장 구조:

```text
Agent Start

↓
Skill Metadata

↓
User Request

↓
Skill Search

↓
필요 Skill 1~2개 선택

↓
SKILL.md Lazy Loading
```

Skill 실행이 끝난 이후 해당 Skill 내용이 계속 필요하지 않다면 이후 작업 Context에서 제거할 수 있는 구조도 고려한다.

---

## 15. 확장 목표

향후 다음 기능을 추가할 수 있도록 설계한다.

```text
Skill Registry
Skill Marketplace
Skill Dependency Manager
Skill Version Manager
Skill Permission
Skill Rating
Skill Validation
Skill Testing
Skill Auto Update
Skill Cache
Skill Recommendation
```

궁극적으로 다음과 같은 구조를 목표로 한다.

```text
             AI Skill Platform

                   │
        ┌──────────┼──────────┐
        │          │          │
     Registry   Repository   Search
        │          │          │
        └──────────┼──────────┘
                   │
                  MCP
                   │
        ┌──────────┼──────────┐
        │          │          │
      Claude      Codex     Other Agent
```

즉, MCP를 단순 Tool Server로 사용하는 것이 아니라 **AI Agent가 필요한 Skill을 검색하고 필요한 시점에만 가져와 사용할 수 있는 공통 Skill Distribution Layer**로 활용하는 것을 목표로 한다.

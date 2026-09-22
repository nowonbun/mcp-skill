# SkillPort

Skill 메타데이터를 검색하고, 선택한 본문만 가져오는 TypeScript MCP 서버와 관리 웹 화면입니다. `project_design/request.md`의 기능 요건 및 시안 4장을 기준으로 작성했습니다. MCP 통신은 공식 `@modelcontextprotocol/server` SDK를 사용합니다.

## Docker Compose 실행

Docker Engine과 Docker Compose가 실행 중이어야 합니다. 토큰 설정 없이 실행할 수 있습니다. 포트를 변경할 때만 `.env.example`을 `.env`로 복사해 값을 수정하세요. `.env`는 Git에서 제외됩니다.

```powershell
cd D:\work\mcp-skill\src
docker compose up --build -d
docker compose ps
```

웹 화면은 기본값 `http://127.0.0.1:3200`입니다. MCP 클라이언트는 **별도 포트** `http://127.0.0.1:3201/mcp`를 사용합니다. 인증 헤더는 필요하지 않습니다. 포트는 `.env`의 `WEB_PORT`, `MCP_PORT`로 변경할 수 있습니다.

Compose는 웹 `127.0.0.1:3200`과 MCP `127.0.0.1:3201`만 공개합니다. Skill 파일과 로그·설정은 각각 호스트의 `src/data/skills`, `src/data/data`를 컨테이너에 연결해 유지합니다. `docker compose down`은 이 호스트 파일을 삭제하지 않습니다.

## 로컬 Node.js 실행

Node.js 22 이상이 필요합니다. 첫 실행 전 의존 패키지 설치와 TypeScript 빌드가 필요합니다.

```powershell
cd D:\work\mcp-skill\src
npm install
npm run build
npm start
```

웹 화면: `http://127.0.0.1:3200` · MCP HTTP: `http://127.0.0.1:3201/mcp`

웹 포트는 `WEB_PORT`(기본 3200), MCP 포트는 `MCP_PORT`(기본 3201)로 변경할 수 있습니다. 두 포트는 서로 달라야 합니다. 기존 `PORT` 환경 변수는 웹 포트의 대체 값으로만 사용됩니다.

stdio 방식 MCP 클라이언트에서는 명령 `node`, 인수 `D:\work\mcp-skill\src\dist\server.js --stdio`를 등록합니다. 또는 이 디렉터리에서 `npm run mcp`를 사용할 수 있습니다. stdio 실행 중 로그는 표준 출력에 기록하지 않고 `data/access.ndjson`에 저장합니다.

기본 Node.js 실행은 `127.0.0.1`에만 바인딩됩니다. Docker는 컨테이너 내부에서 `0.0.0.0`으로 대기하지만 Compose가 호스트 포트를 `127.0.0.1`에만 공개합니다. 인증이 없으므로 포트를 외부 네트워크에 공개하지 마세요.

## 기능

- MCP Tools: `usage`, `list_skills`, `search_skills`, `get_skill`, `get_skill_version`
- MCP Resources: `skill://<name>` 및 `skill://<name>/<version>`
- `/mcp`는 공식 SDK의 Streamable HTTP 핸들러로 제공합니다. JSON 응답 모드와 stdio 실행을 지원합니다.
- 관리 화면: 대시보드, Skill 검색·상세·상태 변경·새 버전 편집, URL 원본 업데이트 확인·수동 적용, GitHub URL·파일 업로드·직접 입력 등록, MCP HTTP 포트가 표시되는 접속 로그
- 저장 위치: `skills/<name>/skill.yaml`, `SKILL.md`, `.versions/<version>.json`; 로그는 `data/access.ndjson`에 저장합니다.
- 신규 버전은 `PUT /api/skills/<name>`으로 등록합니다. 기존 버전을 덮어쓰지 않습니다.

## 웹 등록 데이터 저장 위치

SQLite는 사용하지 않습니다. 웹에서 등록한 Skill은 서버의 `skills/<name>/skill.yaml`(메타데이터), `skills/<name>/SKILL.md`(본문), `skills/<name>/.versions/<version>.json`(버전 스냅샷)에 파일로 저장됩니다. 접속 로그는 `data/access.ndjson`에 저장됩니다.

- Docker Compose: 컨테이너의 `/app/skills`와 `/app/data`가 각각 `D:\work\mcp-skill\src\data\skills`, `D:\work\mcp-skill\src\data\data`에 연결됩니다.
- 로컬 Node.js 실행: `D:\work\mcp-skill\src\skills`와 `D:\work\mcp-skill\src\data`에 저장됩니다.
- `D:\work\mcp-skill\skills`의 클라이언트 부트스트랩 스킬은 서버 저장소와 별개입니다.

내장 `usage` Skill 원본은 `builtin-skills/usage`에 있습니다. 서버 시작 시 등록된 `usage`가 없을 때만 이를 저장소에 추가하며, 웹에서 이미 등록·변경한 `usage`는 덮어쓰지 않습니다.

## Skill 등록 형식

`SKILL.md` 파일 본문 앞에 YAML Frontmatter를 넣거나 관리 화면에서 이름·버전·설명을 입력합니다.

```markdown
---
name: db-design
version: 1.0.0
description: 데이터베이스 모델 설계 지침
tags:
  - database
  - design
---
# 데이터베이스 설계
...
```

URL 가져오기는 공개 GitHub의 `SKILL.md` 파일만 허용합니다. 등록 파일은 1MB 이하입니다. 메타데이터는 안전한 제한적 YAML 구문만 지원하며, 복잡한 YAML 구조는 지원하지 않습니다.

URL로 새로 등록한 Skill은 원본 URL과 당시 파일의 해시를 함께 저장합니다. Skill 목록을 열면 화면에 보이는 URL 연결 Skill을 한 번 비교하며, `다시 확인`으로 재검사할 수 있습니다. 변경이 있을 때 `업데이트`를 누르면 현재 버전의 마지막 자리(PATCH)를 1 올려 새 버전으로 저장합니다. 자동 주기 갱신이나 자동 저장은 하지 않습니다. 기존에 등록된 Skill에 원본 URL 정보가 없다면 `수정` 화면에서 URL을 연결하고 새 버전으로 저장한 뒤 확인할 수 있습니다.

## 주의할 점

- 웹의 에이전트 관리와 시스템 설정 화면은 제공하지 않습니다. 기존 `data/settings.json`이 있다면 `allowedSkills`·`allowedCategories` 정책은 MCP 조회에 계속 적용되지만, 웹에서 수정할 수 없습니다. 에이전트별 인증과 권한 집행은 구현되지 않았습니다. HTTP 서버는 로컬 전용이며, 외부 공유 시 별도 인증·TLS·네트워크 정책이 필요합니다.
- Git 변경 이력은 `skills/` 폴더를 Git으로 버전 관리하여 활용합니다. URL 원본의 수동 확인·업데이트 외에 Git push·PR·롤백 자동화는 구현되지 않았습니다.
- Semantic Search, 의존 Skill 자동 로딩, Context 제거, Marketplace 기능은 확장 목표로 남아 있습니다. 의존성은 메타데이터로만 제공됩니다.

## 테스트

```powershell
npm test
```

테스트는 공식 MCP 클라이언트 SDK로 Tool·Resource를 호출합니다. `npm run build`는 TypeScript 타입 검사와 JavaScript 출력을 수행합니다.

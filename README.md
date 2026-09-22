# SkillPort

Skill을 등록·관리하는 웹 화면과, 등록된 Skill을 검색하고 필요한 본문을 읽는 TypeScript MCP 서버입니다. 웹과 MCP HTTP는 서로 다른 포트를 사용합니다.

## 폴더 구성

| 경로 | 내용 |
| --- | --- |
| [`src/`](src/) | 서버 소스, 관리 웹, Docker 설정 및 상세 실행 안내 |
| [`skills/skillport-client/`](skills/skillport-client/) | MCP에 접속하는 에이전트용 클라이언트 Skill |
| [`project_design/`](project_design/) | 기능 요건과 디자인 자료 |

## Docker로 시작하기

```powershell
cd D:\work\mcp-skill\src
docker compose up --build -d
docker compose ps
```

기본 접속 주소는 관리 웹 `http://<서버-IP>:3200`, MCP HTTP `http://<서버-IP>:3201/mcp`입니다. 포트와 공개 범위는 [`src/.env.example`](src/.env.example)을 참고해 `src/.env`에서 조정할 수 있습니다.

**웹과 MCP에는 인증 기능이 없습니다.** 외부에 공개할 경우 방화벽에서 접근 IP를 제한하고 TLS 적용을 검토하세요.

## 데이터 위치

Docker Compose 실행 시 등록된 Skill은 호스트의 `src/data/skills/`, MCP 도구·리소스 호출 로그는 SQLite 파일 `src/data/data/access.sqlite`에 저장됩니다. 기존 `access.ndjson`은 가져오거나 삭제하지 않습니다. 루트의 `skills/`는 서버 등록 데이터가 아니라 클라이언트 Skill을 위한 폴더입니다.

로컬 Node.js 실행 방법, Codex 연결 설정, Skill 등록·업데이트 방식과 테스트 명령은 [`src/README.md`](src/README.md)를 참고하세요.

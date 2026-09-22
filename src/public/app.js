const view = document.querySelector('#view');
const notice = document.querySelector('#notice');

const pages = {
  dashboard: ['대시보드', 'AI 에이전트의 확장된 능력을 관리하는 MCP 기반 Skill 플랫폼입니다.'],
  skills: ['Skill 목록', '등록된 Skill을 조회하고 관리할 수 있습니다.'],
  create: ['새 Skill 등록', '새로운 Skill을 등록하여 AI 에이전트가 사용할 수 있도록 설정합니다.'],
  logs: ['접속 로그', 'Skill 호출 및 사용 이력을 확인할 수 있습니다.'],
};

const state = {
  page: 'dashboard',
  tab: 'url',
  pageNumber: 1,
  skillQuery: '',
  skillTag: '',
  skillStatus: '',
  skillSort: 'name',
  logQuery: '',
  logSkill: '',
  logStatus: '',
  skills: [],
  logs: [],
  updateChecks: {},
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function encode(value) {
  return encodeURIComponent(value);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function showMessage(text, error = false) {
  notice.innerHTML = `
    <div class="notice ${error ? 'bad' : 'ok'}">${escapeHtml(text)}</div>
  `;
  setTimeout(() => { notice.innerHTML = ''; }, 5000);
}

function badge(status) {
  const labels = {
    deployed: '배포됨',
    testing: '테스트 중',
    paused: '중지됨',
    success: '성공',
    error: '실패',
  };
  return `
    <span class="badge ${escapeHtml(status)}">
      ${escapeHtml(labels[status] || status)}
    </span>
  `;
}

function tags(items = []) {
  return items.map(item => `
    <span class="tag">${escapeHtml(item)}</span>
  `).join('') || '—';
}

function date(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function panel(title, action, content) {
  return `
    <section class="card panel">
      <div class="section-head">
        <h2>${title}</h2>
        <span class="muted">${action}</span>
      </div>
      ${content}
    </section>
  `;
}

function pagination(total, pageSize) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  state.pageNumber = Math.min(state.pageNumber, count);
  const start = total ? (state.pageNumber - 1) * pageSize + 1 : 0;
  const end = Math.min(state.pageNumber * pageSize, total);

  return `
    <div class="pagination">
      <span class="muted" style="margin-right:auto;align-self:center">
        전체 ${total}개 중 ${start}–${end}개
      </span>
      ${Array.from({ length: count }, (_, index) => `
        <button class="button slim ${index + 1 === state.pageNumber ? 'active' : ''}"
                data-page-number="${index + 1}">
          ${index + 1}
        </button>
      `).join('')}
    </div>
  `;
}

async function navigate(page) {
  state.page = page;
  state.pageNumber = 1;
  location.hash = page;
  document.querySelector('#page-title').textContent = pages[page][0];
  document.querySelector('#page-description').textContent = pages[page][1];
  document.querySelectorAll('.sidebar nav button').forEach(button => {
    button.classList.toggle('active', button.dataset.page === page);
  });
  notice.innerHTML = '';
  await render();
}

async function render() {
  try {
    switch (state.page) {
      case 'dashboard': await renderDashboard(); break;
      case 'skills': await renderSkills(); break;
      case 'create': renderCreate(); break;
      case 'logs': await renderLogs(); break;
    }
  } catch (error) {
    view.innerHTML = `<div class="notice bad">${escapeHtml(error.message)}</div>`;
  }
}

function logTable(rows, compact = false) {
  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>시간</th><th>요청 ID</th><th>에이전트</th>
            <th>동작</th><th>대상 Skill</th><th>상태</th>
            ${compact ? '' : '<th>메시지</th>'}
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td>${date(row.time)}</td>
              <td>${escapeHtml(row.requestId)}</td>
              <td>${escapeHtml(row.agent)}</td>
              <td>${escapeHtml(row.operation)}</td>
              <td>${escapeHtml(row.skill || '—')}</td>
              <td>${badge(row.status)}</td>
              ${compact ? '' : `<td>${escapeHtml(row.message || '완료')}</td>`}
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${rows.length ? '' : '<div class="empty">접속 기록이 없습니다.</div>'}
    </div>
  `;
}

async function renderDashboard() {
  [state.skills, state.logs] = await Promise.all([
    api('/skills'),
    api('/logs?limit=500'),
  ]);

  const today = new Date().toDateString();
  const todayCalls = state.logs.filter(log => new Date(log.time).toDateString() === today);
  const failures = state.logs.filter(log => log.status === 'error');
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    return state.logs.filter(log => new Date(log.time).getHours() === hour).length;
  });
  const maximum = Math.max(1, ...hourly);
  const deployedSkills = state.skills.filter(skill => skill.status === 'deployed');
  const errorRate = state.logs.length
    ? (failures.length / state.logs.length * 100).toFixed(1)
    : '0.0';

  const statistics = [
    ['⬡', '등록된 Skill', state.skills.length, '전체 등록', ''],
    ['▥', '오늘의 호출 수', todayCalls.length.toLocaleString(), '오늘 기록', ''],
    ['♧', '배포된 Skill', deployedSkills.length, '현재 사용 가능', 'green'],
    ['⚠', '오류율', `${errorRate}%`, `최근 ${state.logs.length}건 기준`, 'red'],
  ];

  const chart = `
    <div class="chart" aria-label="시간대별 호출 수">
      ${hourly.map((count, hour) => `
        <div class="bar" title="${hour}시: ${count}건"
             style="height:${Math.max(2, count / maximum * 100)}%"></div>
      `).join('')}
    </div>
    <div class="muted" style="display:flex;justify-content:space-between;margin-top:7px">
      <span>00시</span><span>06시</span><span>12시</span>
      <span>18시</span><span>23시</span>
    </div>
  `;

  const skillRows = state.skills.slice(0, 5).map(skill => `
    <div class="skill-line">
      <span class="dot ${skill.status === 'deployed' ? '' : 'off'}"></span>
      <span class="initial">S</span>
      <strong>${escapeHtml(skill.name)}</strong>
      <span class="muted">${escapeHtml(skill.version)}</span>
      <small>${skill.status === 'deployed' ? '배포됨' : '중지'}</small>
    </div>
  `).join('') || '<div class="empty">등록된 Skill이 없습니다.</div>';

  view.innerHTML = `
    <div class="section-head"><h2>운영 현황</h2><span class="muted">최근 기록 기준</span></div>
    <div class="stat-grid">
      ${statistics.map(([icon, label, value, hint, tone]) => `
        <div class="card stat ${tone}">
          <span class="symbol">${icon}</span>
          <div>
            <small>${label}</small>
            <strong>${value}</strong>
            <span class="trend ${tone === 'red' ? 'red' : ''}">${hint}</span>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="dashboard-grid">
      ${panel('요청 수 추이', '최근 기록 · 시간대별', chart)}
      ${panel('Skill 배포 현황', '<button class="button slim" data-go="skills">전체 보기 ›</button>', skillRows)}
    </div>
    ${panel('최근 호출 내역', '', logTable(state.logs.slice(0, 5), true))}
  `;
}

function sourceUpdateCell(skill) {
  if (!skill.source_url) {
    return '<span class="muted" title="수정 화면에서 원본 URL을 연결할 수 있습니다.">URL 없음</span>';
  }

  const check = state.updateChecks[skill.name];
  if (check?.status === 'checking' || check?.status === 'updating') {
    return `<span class="muted">${check.status === 'checking' ? '확인 중...' : '업데이트 중...'}</span>`;
  }
  if (check?.status === 'available') {
    return `
      <span class="update-label available" title="새 버전 v${escapeHtml(check.nextVersion)}으로 저장됩니다.">업데이트 있음</span>
      <button class="button slim" data-source-update="${escapeHtml(skill.name)}">업데이트</button>
    `;
  }
  if (check?.status === 'current') {
    return `
      <span class="update-label current">최신</span>
      <button class="button slim" data-source-check="${escapeHtml(skill.name)}">다시 확인</button>
    `;
  }
  return `
    ${check?.status === 'error' ? '<span class="update-label error">확인 실패</span>' : ''}
    <button class="button slim" data-source-check="${escapeHtml(skill.name)}">
      ${check?.status === 'error' ? '재확인' : '업데이트 확인'}
    </button>
  `;
}

function skillTable(rows) {
  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>#</th><th>Skill 이름</th><th>설명</th><th>태그</th>
            <th>버전</th><th>배포 상태</th><th>원본 업데이트</th><th>작업</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((skill, index) => `
            <tr>
              <td>${(state.pageNumber - 1) * 8 + index + 1}</td>
              <td><strong>${escapeHtml(skill.name)}</strong></td>
              <td>${escapeHtml(skill.description)}</td>
              <td>${tags(skill.tags)}</td>
              <td>v${escapeHtml(skill.version)}</td>
              <td>
                <select class="status-select ${escapeHtml(skill.status)}"
                        data-skill-status="${escapeHtml(skill.name)}"
                        aria-label="${escapeHtml(skill.name)} 배포 상태 변경"
                        title="배포 상태 변경">
                  <option value="deployed" ${skill.status === 'deployed' ? 'selected' : ''}>배포됨</option>
                  <option value="testing" ${skill.status === 'testing' ? 'selected' : ''}>테스트 중</option>
                  <option value="paused" ${skill.status === 'paused' ? 'selected' : ''}>중지됨</option>
                </select>
              </td>
              <td class="source-update">${sourceUpdateCell(skill)}</td>
              <td class="actions">
                <button data-detail="${escapeHtml(skill.name)}" title="상세 보기">보기</button>
                <button data-edit="${escapeHtml(skill.name)}" title="새 버전으로 수정">수정</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${rows.length ? '' : '<div class="empty">조건에 맞는 Skill이 없습니다.</div>'}
    </div>
  `;
}

async function renderSkills() {
  state.skills = await api('/skills');
  for (const skill of state.skills) {
    const check = state.updateChecks[skill.name];
    if (check?.version && check.version !== skill.version) {
      delete state.updateChecks[skill.name];
    }
  }
  const query = state.skillQuery.toLowerCase();
  const filtered = state.skills.filter(skill => {
    const text = [
      skill.name, skill.description, skill.category,
      ...skill.tags, ...skill.keywords,
    ].join(' ').toLowerCase();
    return text.includes(query)
      && (!state.skillTag || skill.tags.includes(state.skillTag))
      && (!state.skillStatus || skill.status === state.skillStatus);
  });
  filtered.sort((a, b) => state.skillSort === 'version'
    ? b.version.localeCompare(a.version, undefined, { numeric: true })
    : a.name.localeCompare(b.name));

  const allTags = [...new Set(state.skills.flatMap(skill => skill.tags))].sort();
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  state.pageNumber = Math.min(state.pageNumber, pages);
  const visible = filtered.slice((state.pageNumber - 1) * 8, state.pageNumber * 8);
  const toCheck = visible
    .filter(skill => skill.source_url && !state.updateChecks[skill.name])
    .map(skill => skill.name);
  for (const name of toCheck) {
    state.updateChecks[name] = { status: 'checking' };
  }

  view.innerHTML = `
    <div class="toolbar">
      <input id="skill-search" class="input search"
             placeholder="⌕ Skill 이름, 설명, 태그로 검색하세요..."
             value="${escapeHtml(state.skillQuery)}">
      <select id="skill-tag" class="select">
        <option value="">전체 태그</option>
        ${allTags.map(tag => `
          <option ${tag === state.skillTag ? 'selected' : ''}>${escapeHtml(tag)}</option>
        `).join('')}
      </select>
      <select id="skill-status" class="select">
        <option value="">전체 상태</option>
        ${['deployed', 'testing', 'paused'].map(status => `
          <option value="${status}" ${status === state.skillStatus ? 'selected' : ''}>
            ${{ deployed: '배포됨', testing: '테스트 중', paused: '중지됨' }[status]}
          </option>
        `).join('')}
      </select>
      <select id="skill-sort" class="select">
        <option value="name" ${state.skillSort === 'name' ? 'selected' : ''}>이름순</option>
        <option value="version" ${state.skillSort === 'version' ? 'selected' : ''}>버전순</option>
      </select>
      <button class="button primary" data-go="create">＋ 새 Skill 등록</button>
    </div>
    <section class="card">${skillTable(visible)}</section>
    ${pagination(filtered.length, 8)}
  `;
  for (const name of toCheck) {
    void checkSkillUpdate(name, true);
  }
}

async function checkSkillUpdate(name, alreadyMarked = false) {
  if (!alreadyMarked) {
    state.updateChecks[name] = { status: 'checking' };
    if (state.page === 'skills') await renderSkills();
  }

  try {
    const result = await api(`/skills/${encode(name)}/update-check`);
    state.updateChecks[name] = {
      status: result.available ? 'available' : 'current',
      version: result.currentVersion,
      nextVersion: result.nextVersion,
    };
  } catch (error) {
    state.updateChecks[name] = { status: 'error' };
    showMessage(`${name} 업데이트 확인 실패: ${error.message}`, true);
  }
  if (state.page === 'skills') {
    await renderSkills().catch(error => showMessage(error.message, true));
  }
}

async function updateSkillFromSource(name) {
  if (state.updateChecks[name]?.status !== 'available') return;
  state.updateChecks[name] = { status: 'updating' };
  if (state.page === 'skills') {
    await renderSkills().catch(error => showMessage(error.message, true));
  }

  try {
    const result = await api(`/skills/${encode(name)}/update`, { method: 'POST' });
    state.updateChecks[name] = { status: 'current', version: result.version };
    showMessage(result.updated
      ? `${name} v${result.version}으로 업데이트했습니다.`
      : `${name}은 이미 최신입니다.`);
  } catch (error) {
    state.updateChecks[name] = { status: 'error' };
    showMessage(`${name} 업데이트 실패: ${error.message}`, true);
  }
  if (state.page === 'skills') {
    await renderSkills().catch(error => showMessage(error.message, true));
  }
}

async function renderLogs() {
  const [logs, runtime] = await Promise.all([
    api('/logs?limit=500'),
    api('/runtime'),
  ]);
  state.logs = logs;
  const query = state.logQuery.toLowerCase();
  const filtered = state.logs.filter(log => {
    return (!query || JSON.stringify(log).toLowerCase().includes(query))
      && (!state.logSkill || log.skill === state.logSkill)
      && (!state.logStatus || log.status === state.logStatus);
  });
  const names = [...new Set(state.logs.map(log => log.skill).filter(Boolean))];
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  state.pageNumber = Math.min(state.pageNumber, pages);
  const visible = filtered.slice((state.pageNumber - 1) * 10, state.pageNumber * 10);

  view.innerHTML = `
    <div class="mcp-endpoint">
      <strong>MCP HTTP 포트</strong>
      <code>${escapeHtml(runtime.mcpPort)}</code>
      <span>${runtime.publicMcpAccess ? 'MCP 접속 주소' : '서버 내부 주소'}: http://${escapeHtml(runtime.publicMcpAccess ? window.location.hostname : '127.0.0.1')}:${escapeHtml(runtime.mcpPort)}/mcp</span>
      <small>${runtime.publicMcpAccess ? 'MCP HTTP 공개 접속이 허용되어 있습니다. 인증이 없으므로 방화벽에서 접근 IP를 제한하세요.' : 'MCP HTTP는 서버 로컬 전용입니다.'} stdio 연결은 포트를 사용하지 않습니다.</small>
    </div>
    <div class="toolbar">
      <input id="log-search" class="input search"
             placeholder="요청 ID, 에이전트, 메시지 검색"
             value="${escapeHtml(state.logQuery)}">
      <select id="log-skill" class="select">
        <option value="">전체 Skill</option>
        ${names.map(name => `
          <option ${name === state.logSkill ? 'selected' : ''}>${escapeHtml(name)}</option>
        `).join('')}
      </select>
      <select id="log-status" class="select">
        <option value="">전체 상태</option>
        <option value="success" ${state.logStatus === 'success' ? 'selected' : ''}>성공</option>
        <option value="error" ${state.logStatus === 'error' ? 'selected' : ''}>실패</option>
      </select>
      <button class="button primary" id="log-refresh">검색</button>
    </div>
    <section class="card">${logTable(visible)}</section>
    ${pagination(filtered.length, 10)}
  `;
}

function sourceCard() {
  if (state.tab === 'url') {
    return `
      <h2>GitHub URL</h2>
      <p>공개 GitHub 저장소의 SKILL.md 파일을 불러와 등록할 수 있습니다.</p>
      <div class="field">
        <input id="skill-url" class="input" style="width:100%"
               placeholder="https://github.com/owner/repo/blob/main/SKILL.md">
      </div>
      <div class="hint">공개 SKILL.md 파일 URL만 허용합니다.</div>
    `;
  }
  if (state.tab === 'upload') {
    return `
      <h2>파일 업로드</h2>
      <p>로컬의 SKILL.md 파일을 업로드하여 등록할 수 있습니다.</p>
      <label class="drop" for="skill-file">
        <svg class="upload-icon" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M12 18v-7m-3 3 3-3 3 3" />
        </svg>
        <strong>SKILL.md 파일을 선택하세요</strong>
        <span class="drop-hint">지원 형식: .md · 최대 1MB</span>
        <input id="skill-file" type="file" accept=".md,text/markdown" hidden>
      </label>
      <div id="file-name" class="hint"></div>
    `;
  }
  return `
    <h2>직접 입력</h2>
    <p>Markdown 본문을 입력하세요. YAML Frontmatter를 포함할 수 있습니다.</p>
    <div class="field">
      <textarea id="skill-content" placeholder="# Skill 제목&#10;&#10;상세 지침을 작성하세요."></textarea>
    </div>
  `;
}

function renderCreate() {
  view.innerHTML = `
    <div class="tabs">
      ${['url', 'upload', 'manual'].map((tab, index) => `
        <button data-tab="${tab}" class="${state.tab === tab ? 'active' : ''}">
          ${['URL', '파일 업로드', '직접 입력'][index]}
        </button>
      `).join('')}
    </div>

    <div class="form-grid">
      <div>
        <section class="card form-card">${sourceCard()}</section>
        <section class="card form-card" style="margin-top:15px">
          <h2>기본 정보</h2>
          <p>Frontmatter가 없으면 아래 정보를 입력하세요.</p>
          <div class="field">
            <label for="skill-name">Skill 이름</label>
            <input class="input" id="skill-name" placeholder="db-design">
          </div>
          <div class="field">
            <label for="skill-version">버전</label>
            <input class="input" id="skill-version" value="1.0.0">
          </div>
          <div class="field">
            <label for="skill-description">설명</label>
            <input class="input" id="skill-description" placeholder="Skill의 사용 목적">
          </div>
          <div class="field">
            <label for="skill-tags">태그</label>
            <input class="input" id="skill-tags" placeholder="database, design, sql">
          </div>
        </section>
      </div>

      <section class="card form-card">
        <h2>메타데이터 검증 결과</h2>
        <div id="preview-area">
          <div class="empty">내용을 입력하고 검증을 눌러주세요.</div>
        </div>
      </section>
    </div>

    <div class="form-actions">
      <button class="button" data-go="skills">취소</button>
      <div>
        <button class="button" id="validate" style="margin-right:7px">메타데이터 검증</button>
        <button class="button primary" id="register">Skill 등록</button>
      </div>
    </div>
  `;
}

async function readCreateForm() {
  let content;
  let url;
  if (state.tab === 'url') {
    url = document.querySelector('#skill-url').value.trim();
    if (!url) throw new Error('GitHub URL을 입력하세요.');
  } else if (state.tab === 'upload') {
    const file = document.querySelector('#skill-file').files[0];
    if (!file) throw new Error('SKILL.md 파일을 선택하세요.');
    if (file.size > 1024 * 1024) throw new Error('파일 크기는 1MB 이하이어야 합니다.');
    content = await file.text();
  } else {
    content = document.querySelector('#skill-content').value;
  }

  return {
    url,
    content,
    name: document.querySelector('#skill-name').value.trim(),
    version: document.querySelector('#skill-version').value.trim(),
    description: document.querySelector('#skill-description').value.trim(),
    tags: document.querySelector('#skill-tags').value.split(',').map(x => x.trim()).filter(Boolean),
  };
}

async function validateCreateForm() {
  const input = await readCreateForm();
  const result = await api('/preview', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const metadata = result.metadata;
  const rows = [
    ['Skill 이름', metadata.name],
    ['버전', metadata.version],
    ['설명', metadata.description],
    ['지원 도구', metadata.compatible.join(', ') || '전체'],
    ['태그', metadata.tags.join(', ') || '—'],
    ['작성자', metadata.author || '—'],
    ['라이선스', metadata.license || '—'],
  ];

  document.querySelector('#preview-area').innerHTML = `
    <div class="valid">✔ 유효한 SKILL.md 파일입니다.</div>
    <table class="meta-table">
      ${rows.map(([label, value]) => `
        <tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>
      `).join('')}
    </table>
    <div class="valid">✔ 등록 가능한 형식의 Skill입니다.</div>
  `;
  return result;
}

function openModal(content, className = '') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-back';
  overlay.innerHTML = `<div class="modal ${className}">${content}</div>`;
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-close]')) {
      overlay.remove();
    }
  });
  document.body.append(overlay);
  return overlay;
}

async function showSkill(name) {
  const [skill, history] = await Promise.all([
    api(`/skills/${encode(name)}`),
    api(`/skills/${encode(name)}/versions`),
  ]);
  openModal(`
    <div class="section-head">
      <h2>${escapeHtml(skill.name)}</h2>
      <div>
        <button class="button slim" data-edit="${escapeHtml(skill.name)}">수정</button>
        <button class="button slim" data-close>닫기 ✕</button>
      </div>
    </div>
    <p><strong>버전</strong> ${escapeHtml(skill.version)} ${badge(skill.status)}</p>
    <p>${escapeHtml(skill.description)}</p>
    <p>${tags(skill.tags)}</p>
    <p class="muted">버전 기록: ${escapeHtml(history.versions.join(', '))}</p>
    <p class="muted">의존 Skill: ${escapeHtml(skill.dependencies.join(', ') || '없음')}</p>
    <h2>SKILL.md</h2>
    <pre class="detail">${escapeHtml(skill.content)}</pre>
  `);
}

function nextPatchVersion(version) {
  const [major, minor, patch] = version.split('.');
  return `${major}.${minor}.${BigInt(patch) + 1n}`;
}

function compareVersions(left, right) {
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function commaList(value) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

async function editSkill(name) {
  const skill = await api(`/skills/${encode(name)}`);
  const overlay = openModal(`
    <div class="section-head">
      <h2>${escapeHtml(skill.name)} 수정</h2>
      <button class="button slim" data-close>닫기 ✕</button>
    </div>
    <p class="muted">기존 버전 v${escapeHtml(skill.version)}은 보존됩니다. 저장하면 새 버전이 등록됩니다.</p>
    <div class="edit-grid">
      <div class="field">
        <label for="edit-version">새 버전</label>
        <input id="edit-version" class="input" value="${escapeHtml(nextPatchVersion(skill.version))}">
      </div>
      <div class="field">
        <label for="edit-category">카테고리</label>
        <input id="edit-category" class="input" value="${escapeHtml(skill.category)}">
      </div>
      <div class="field full">
        <label for="edit-description">설명</label>
        <input id="edit-description" class="input" value="${escapeHtml(skill.description)}">
      </div>
      <div class="field full">
        <label for="edit-source-url">원본 GitHub SKILL.md URL</label>
        <input id="edit-source-url" class="input" value="${escapeHtml(skill.source_url)}"
               placeholder="https://github.com/owner/repo/blob/main/SKILL.md">
        <div class="hint">기존 URL 등록 Skill의 주소가 없다면 여기에 연결하세요.</div>
      </div>
      <div class="field">
        <label for="edit-tags">태그 (쉼표로 구분)</label>
        <input id="edit-tags" class="input" value="${escapeHtml(skill.tags.join(', '))}">
      </div>
      <div class="field">
        <label for="edit-keywords">검색 키워드 (쉼표로 구분)</label>
        <input id="edit-keywords" class="input" value="${escapeHtml(skill.keywords.join(', '))}">
      </div>
      <div class="field">
        <label for="edit-compatible">지원 에이전트 (쉼표로 구분)</label>
        <input id="edit-compatible" class="input" value="${escapeHtml(skill.compatible.join(', '))}">
      </div>
      <div class="field">
        <label for="edit-dependencies">의존 Skill (쉼표로 구분)</label>
        <input id="edit-dependencies" class="input" value="${escapeHtml(skill.dependencies.join(', '))}">
      </div>
      <div class="field">
        <label for="edit-author">작성자</label>
        <input id="edit-author" class="input" value="${escapeHtml(skill.author)}">
      </div>
      <div class="field">
        <label for="edit-license">라이선스</label>
        <input id="edit-license" class="input" value="${escapeHtml(skill.license)}">
      </div>
      <div class="field full">
        <label for="edit-content">SKILL.md 본문</label>
        <textarea id="edit-content">${escapeHtml(skill.content)}</textarea>
      </div>
    </div>
    <div id="edit-error" class="notice bad" role="alert" hidden></div>
    <div class="edit-actions">
      <button class="button" data-close>취소</button>
      <button class="button primary" id="edit-save">새 버전 저장</button>
    </div>
  `, 'edit-modal');
  overlay.skill = skill;
  overlay.querySelector('#edit-version').focus();
}

async function saveSkillEdit(button) {
  const overlay = button.closest('.modal-back');
  const skill = overlay.skill;
  const field = id => overlay.querySelector(`#edit-${id}`).value.trim();
  const errorArea = overlay.querySelector('#edit-error');

  button.disabled = true;
  errorArea.hidden = true;
  try {
    const version = field('version');
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
      || compareVersions(version, skill.version) <= 0) {
      throw new Error('새 버전은 현재 버전보다 높은 MAJOR.MINOR.PATCH 형식이어야 합니다.');
    }

    const description = field('description');
    const content = overlay.querySelector('#edit-content').value;
    if (!description || !content.trim()) {
      throw new Error('설명과 SKILL.md 본문을 입력하세요.');
    }
    if (new TextEncoder().encode(content).length > 1024 * 1024) {
      throw new Error('SKILL.md 본문은 1MB 이하이어야 합니다.');
    }

    const current = await api(`/skills/${encode(skill.name)}`);
    if (current.version !== skill.version) {
      throw new Error('다른 작업에서 새 버전이 등록되었습니다. 편집 화면을 다시 열어주세요.');
    }

    await api(`/skills/${encode(skill.name)}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...current,
        version,
        description,
        category: field('category'),
        tags: commaList(field('tags')),
        keywords: commaList(field('keywords')),
        compatible: commaList(field('compatible')),
        dependencies: commaList(field('dependencies')),
        author: field('author'),
        license: field('license'),
        source_url: field('source-url'),
        source_hash: field('source-url') === current.source_url ? current.source_hash : '',
        content,
      }),
    });
    overlay.remove();
    delete state.updateChecks[skill.name];
    showMessage(`${skill.name} v${version}이 저장되었습니다.`);
    await renderSkills().catch(error => {
      showMessage(`저장되었지만 목록을 새로고침하지 못했습니다: ${error.message}`, true);
    });
  } catch (error) {
    errorArea.textContent = error.message;
    errorArea.hidden = false;
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('click', async event => {
  const target = event.target.closest([
    '[data-page]', '[data-go]', '[data-tab]', '[data-page-number]',
    '[data-detail]', '[data-edit]', '#edit-save', '#validate', '#register',
    '#log-refresh', '[data-source-check]', '[data-source-update]',
  ].join(','));
  if (!target) return;

  try {
    if (target.dataset.page) return navigate(target.dataset.page);
    if (target.dataset.go) return navigate(target.dataset.go);
    if (target.dataset.tab) {
      state.tab = target.dataset.tab;
      return renderCreate();
    }
    if (target.dataset.pageNumber) {
      state.pageNumber = Number(target.dataset.pageNumber);
      return render();
    }
    if (target.dataset.detail) return showSkill(target.dataset.detail);
    if (target.dataset.edit) {
      target.closest('.modal-back')?.remove();
      return editSkill(target.dataset.edit);
    }
    if (target.id === 'edit-save') return saveSkillEdit(target);
    if (target.dataset.sourceCheck) return checkSkillUpdate(target.dataset.sourceCheck);
    if (target.dataset.sourceUpdate) return updateSkillFromSource(target.dataset.sourceUpdate);

    if (target.id === 'validate') return validateCreateForm();
    if (target.id === 'register') {
      const result = await validateCreateForm();
      await api('/skills', {
        method: 'POST',
        body: JSON.stringify({ ...result.metadata, content: result.content }),
      });
      await navigate('skills');
      return showMessage('Skill이 등록되었습니다.');
    }
    if (target.id === 'log-refresh') return renderLogs();
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.addEventListener('change', async event => {
  const target = event.target;
  if (target.matches('[data-skill-status]')) {
    const skill = state.skills.find(item => item.name === target.dataset.skillStatus);
    if (!skill || target.value === skill.status) return;

    const previousStatus = skill.status;
    target.disabled = true;
    try {
      await api(`/skills/${encode(skill.name)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: target.value }),
      });
      await renderSkills();
      showMessage(`${skill.name}의 배포 상태가 변경되었습니다.`);
    } catch (error) {
      target.value = previousStatus;
      target.disabled = false;
      showMessage(error.message, true);
    }
    return;
  }

  if (target.id === 'skill-file') {
    document.querySelector('#file-name').textContent = target.files[0]?.name || '';
  }

  const filters = {
    'skill-tag': 'skillTag',
    'skill-status': 'skillStatus',
    'skill-sort': 'skillSort',
    'log-skill': 'logSkill',
    'log-status': 'logStatus',
  };
  if (filters[target.id]) {
    state[filters[target.id]] = target.value;
    state.pageNumber = 1;
    void render();
  }
});

let searchTimer;
document.addEventListener('input', event => {
  const target = event.target;
  const key = target.id === 'skill-search' ? 'skillQuery'
    : target.id === 'log-search' ? 'logQuery'
      : null;
  if (!key) return;

  state[key] = target.value;
  state.pageNumber = 1;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    await render();
    const refreshed = document.getElementById(target.id);
    refreshed?.focus();
    refreshed?.setSelectionRange(state[key].length, state[key].length);
  }, 300);
});

window.addEventListener('hashchange', () => {
  const requested = location.hash.slice(1);
  if (pages[requested] && requested !== state.page) void navigate(requested);
});

const initialPage = location.hash.slice(1);
void navigate(pages[initialPage] ? initialPage : 'dashboard');

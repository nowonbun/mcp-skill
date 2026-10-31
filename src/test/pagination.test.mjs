import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function app(page = 1) {
  const context = vm.createContext({
    document: { querySelector: () => ({}), addEventListener() {} },
    window: { addEventListener() {} },
  });
  vm.runInContext(source.slice(0, source.indexOf('const initialPage =')), context);
  vm.runInContext(`state.pageNumber = ${page}`, context);
  return context;
}

function render(context, total) {
  return vm.runInContext(`pagination(${total}, 10)`, context);
}

function numberedPages(html) {
  return [...html.matchAll(/data-page-number="(\d+)"[^>]*>\s*(\d+)\s*<\/button>/g)]
    .map(match => Number(match[2]));
}

test('441건이어도 모든 페이지를 펼치지 않고 처음과 끝을 제공한다', () => {
  const html = render(app(), 441);
  assert.deepEqual(numberedPages(html), [1, 2, 3, 4, 5, 45]);
  assert.match(html, /전체 441개 중 1–10개/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /disabled[^>]*>이전/);
  assert.match(html, /data-page-number="2"[^>]*>다음/);
});

test('중간 페이지에서는 주변 번호와 양끝으로 이동할 수 있다', () => {
  const html = render(app(23), 441);
  assert.deepEqual(numberedPages(html), [1, 21, 22, 23, 24, 25, 45]);
  assert.match(html, /data-page-number="22"[^>]*>이전/);
  assert.match(html, /data-page-number="24"[^>]*>다음/);
  assert.match(html, /전체 441개 중 221–230개/);
});

test('마지막 페이지에서는 다음 버튼을 비활성화한다', () => {
  const html = render(app(45), 441);
  assert.deepEqual(numberedPages(html), [1, 41, 42, 43, 44, 45]);
  assert.match(html, /전체 441개 중 441–441개/);
  assert.match(html, /disabled[^>]*>다음/);
});

test('검색 결과 감소 시 유효한 페이지로 보정한다', () => {
  const context = app(45);
  const html = render(context, 12);
  assert.deepEqual(numberedPages(html), [1, 2]);
  assert.equal(vm.runInContext('state.pageNumber', context), 2);
  assert.match(html, /전체 12개 중 11–12개/);
});

test('빈 결과와 한 페이지도 유효한 범위를 표시한다', () => {
  for (const total of [0, 1, 10]) {
    const html = render(app(), total);
    assert.deepEqual(numberedPages(html), [1]);
    assert.match(html, new RegExp(`전체 ${total}개 중 ${total ? 1 : 0}–${total}개`));
    assert.equal((html.match(/disabled/g) || []).length, 2);
  }
});

test('건수가 증가해도 번호 버튼 수는 최대 7개로 제한한다', () => {
  for (const page of [1, 2, 4, 25, 49, 50]) {
    const html = render(app(page), 500);
    const numbers = numberedPages(html);
    assert.ok(numbers.length <= 7);
    assert.ok(numbers.includes(page));
    assert.equal(new Set(numbers).size, numbers.length);
  }
});

test('접속 로그 화면에서 다음 페이지와 마지막 페이지의 실제 행을 표시한다', async () => {
  const context = app();
  context.fetch = async url => ({
    ok: true,
    json: async () => url.includes('/logs')
      ? Array.from({ length: 441 }, (_, index) => ({
        time: '2026-10-31T12:00:00Z', requestId: `request-${index + 1}`,
        client: 'MCP Client', tool: 'search_skills', status: 'success',
      }))
      : { mcpPort: 3201, publicMcpAccess: false },
  });
  for (const [page, firstRow, lastRow] of [[1, 1, 10], [2, 11, 20], [45, 441, 441]]) {
    vm.runInContext(`state.pageNumber = ${page}`, context);
    await vm.runInContext('renderLogs()', context);
    const html = vm.runInContext('view.innerHTML', context);
    const rows = [...html.matchAll(/request-(\d+)/g)].map(match => Number(match[1]));
    assert.deepEqual(rows, Array.from({ length: lastRow - firstRow + 1 }, (_, index) => firstRow + index));
    assert.ok(numberedPages(html).length <= 7);
  }
});

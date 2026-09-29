'use strict';
/* =====================================================
   추첨 규칙 (서버에서만 실행됩니다)
   - 팀 4개, 팀당 정원 8명, 총 32명
   - 뽑는 순간 "남은 자리" 전체에서 무작위로 한 자리를 고릅니다.
     (팀 카드 32장을 섞어 두고 한 장씩 뽑는 것과 같은 확률)
   - 정원이 찬 팀은 남은 자리가 0이라 절대 뽑히지 않습니다.
   ===================================================== */
var crypto = require('crypto');

var TEAMS = ['red', 'yellow', 'green', 'blue'];
var TEAM_SIZE = 8;
var TOTAL = TEAMS.length * TEAM_SIZE;   // 32
var NAME_MAX = 10;

function createState(round) {
  return { version: 1, round: round || 1, nextN: 1, members: [] };
}

function countsOf(state) {
  var c = {};
  TEAMS.forEach(function (t) { c[t] = 0; });
  state.members.forEach(function (m) { c[m.team]++; });
  return c;
}

/* 이름 정리: 보이지 않는 글자 제거, 공백 정리, 10글자까지 */
function cleanName(raw) {
  if (typeof raw !== 'string') { return ''; }
  var s = raw.normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}

function validCid(cid) {
  return typeof cid === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(cid);
}

/* 한 명 뽑기. 결과: { status: 'ok'|'already'|'full'|'bad_name'|'bad_id', member } */
function drawFor(state, cid, rawName) {
  if (!validCid(cid)) { return { status: 'bad_id' }; }

  var existing = null;
  for (var i = 0; i < state.members.length; i++) {
    if (state.members[i].cid === cid) { existing = state.members[i]; break; }
  }
  if (existing) { return { status: 'already', member: existing }; }

  var name = cleanName(rawName);
  if (!name) { return { status: 'bad_name' }; }
  if (state.members.length >= TOTAL) { return { status: 'full' }; }

  var counts = countsOf(state);
  var left = TEAMS.map(function (t) { return TEAM_SIZE - counts[t]; });
  var leftTotal = left.reduce(function (a, b) { return a + b; }, 0);
  var r = crypto.randomInt(leftTotal);          // 남은 자리 중 한 자리
  var team = null;
  for (var k = 0; k < TEAMS.length; k++) {
    if (r < left[k]) { team = TEAMS[k]; break; }
    r -= left[k];
  }
  var member = { n: state.nextN++, name: name, team: team, cid: cid, at: Date.now() };
  state.members.push(member);
  return { status: 'ok', member: member };
}

function removeMember(state, n) {
  var before = state.members.length;
  state.members = state.members.filter(function (m) { return m.n !== n; });
  return state.members.length !== before;
}

/* 화면에 보내는 형태 (cid는 절대 내보내지 않습니다) */
function publicView(state, cid) {
  var me = null;
  var list = state.members.map(function (m) {
    if (cid && m.cid === cid) { me = { n: m.n, name: m.name, team: m.team }; }
    return { n: m.n, name: m.name, team: m.team };
  });
  return {
    round: state.round,
    total: state.members.length,
    capacity: TOTAL,
    full: state.members.length >= TOTAL,
    counts: countsOf(state),
    members: list,
    me: me
  };
}

/* 상태 점검: 이상이 있으면 false */
function validateState(state) {
  if (!state || !Array.isArray(state.members)) { return false; }
  if (state.members.length > TOTAL) { return false; }
  var seenN = {}, seenC = {};
  var counts = {};
  TEAMS.forEach(function (t) { counts[t] = 0; });
  for (var i = 0; i < state.members.length; i++) {
    var m = state.members[i];
    if (TEAMS.indexOf(m.team) === -1) { return false; }
    if (seenN[m.n] || seenC[m.cid]) { return false; }
    seenN[m.n] = true; seenC[m.cid] = true;
    counts[m.team]++;
    if (counts[m.team] > TEAM_SIZE) { return false; }
  }
  return true;
}

module.exports = {
  TEAMS: TEAMS, TEAM_SIZE: TEAM_SIZE, TOTAL: TOTAL, NAME_MAX: NAME_MAX,
  createState: createState, countsOf: countsOf, cleanName: cleanName, validCid: validCid,
  drawFor: drawFor, removeMember: removeMember, publicView: publicView, validateState: validateState
};

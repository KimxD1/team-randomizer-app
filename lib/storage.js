'use strict';
/* 추첨 현황을 파일 하나에 저장합니다 (서버가 다시 시작돼도 유지). */
var fs = require('fs');
var path = require('path');
var draw = require('./draw');

function load(file) {
  try {
    var raw = fs.readFileSync(file, 'utf8');
    var s = JSON.parse(raw);
    if (!draw.validateState(s)) { throw new Error('저장된 데이터가 올바르지 않아 새로 시작합니다.'); }
    s.round = s.round || 1;
    s.nextN = s.nextN || (s.members.reduce(function (a, m) { return Math.max(a, m.n); }, 0) + 1);
    return s;
  } catch (e) {
    if (e && e.code !== 'ENOENT') { console.warn('[저장소] 불러오기 실패:', e.message); }
    return draw.createState(1);
  }
}

function save(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    var tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);       // 통째로 바꿔치기해서 저장 중 끊겨도 깨지지 않음
    return true;
  } catch (e) {
    console.warn('[저장소] 저장 실패(메모리에서만 계속 동작):', e.message);
    return false;
  }
}

module.exports = { load: load, save: save };

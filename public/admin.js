'use strict';
(function () {
  var TEAM = { red: '🔴 빨강팀', yellow: '🟡 노랑팀', green: '🟢 초록팀', blue: '🔵 파랑팀' };
  var $ = function (id) { return document.getElementById(id); };
  var pin = '';

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { status: res.status, data: d }; }); });
  }
  function setMsg(el, text, isError) { el.textContent = text; el.className = 'status' + (isError ? ' error' : ''); }

  function load() {
    return fetch('/api/state', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
      $('aTotal').textContent = s.total;
      var ul = $('list'); ul.textContent = '';
      s.members.forEach(function (m) {
        var li = document.createElement('li'); li.className = 'a-item';
        var name = document.createElement('span'); name.className = 'a-name'; name.textContent = m.name;
        var team = document.createElement('span'); team.className = 'a-team'; team.textContent = TEAM[m.team] || m.team;
        var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'a-btn'; btn.textContent = '삭제';
        btn.addEventListener('click', function () { removeOne(m); });
        li.appendChild(name); li.appendChild(team); li.appendChild(btn); ul.appendChild(li);
      });
      if (!s.members.length) { setMsg($('adminMsg'), '아직 아무도 뽑지 않았어요.'); } else { setMsg($('adminMsg'), ''); }
    }).catch(function () { setMsg($('adminMsg'), '현황을 불러오지 못했어요.', true); });
  }

  function login() {
    var value = $('pin').value;
    setMsg($('loginMsg'), '확인 중...');
    post('/api/admin/check', { pin: value }).then(function (r) {
      if (r.status === 200) { pin = value; $('loginBox').hidden = true; $('panel').hidden = false; load(); }
      else { setMsg($('loginMsg'), r.data.message || '확인하지 못했어요.', true); }
    }).catch(function () { setMsg($('loginMsg'), '인터넷 연결을 확인해 주세요.', true); });
  }
  function removeOne(m) {
    if (!window.confirm('"' + m.name + '" 님의 기록을 지울까요?')) { return; }
    post('/api/admin/remove', { pin: pin, n: m.n }).then(function (r) {
      if (r.status !== 200) { setMsg($('adminMsg'), r.data.message || '지우지 못했어요.', true); }
      return load();
    });
  }
  function resetAll() {
    if (!window.confirm('모든 추첨 기록을 지우고 처음부터 다시 시작할까요?\n(되돌릴 수 없어요)')) { return; }
    post('/api/admin/reset', { pin: pin }).then(function (r) {
      if (r.status !== 200) { setMsg($('adminMsg'), r.data.message || '초기화하지 못했어요.', true); return; }
      return load().then(function () { setMsg($('adminMsg'), '초기화했어요. 이제 새로 뽑을 수 있어요.'); });
    });
  }

  $('btnLogin').addEventListener('click', login);
  $('pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') { login(); } });
  $('btnRefresh').addEventListener('click', load);
  $('btnReset').addEventListener('click', resetAll);
})();

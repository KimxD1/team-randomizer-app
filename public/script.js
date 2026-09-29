'use strict';
(function () {
  var TEAMS = [
    { id: 'red',    name: '빨강팀', emoji: '🔴' },
    { id: 'yellow', name: '노랑팀', emoji: '🟡' },
    { id: 'green',  name: '초록팀', emoji: '🟢' },
    { id: 'blue',   name: '파랑팀', emoji: '🔵' }
  ];
  var TEAM_SIZE = 8, TOTAL = 32;
  var POLL_MS = 2500;
  var MIN_SPIN_MS = 2400;

  var $ = function (id) { return document.getElementById(id); };
  var teamById = {};
  TEAMS.forEach(function (t) { teamById[t.id] = t; });

  var boardOnly = /[?&]board=1(&|$)/.test(location.search);
  if (boardOnly) {
    document.body.classList.add('board-only');
    $('title').textContent = '🎲 팀 현황판';
  }
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ----- 이 기기 구분값 (한 기기에서 한 번만 뽑기 위해) ----- */
  var cid = (function () {
    var key = 'teamRandomizer.cid';
    try {
      var saved = window.localStorage.getItem(key);
      if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) { return saved; }
    } catch (e) { /* 저장이 막힌 브라우저 */ }
    var id = '';
    if (window.crypto && window.crypto.randomUUID) { id = window.crypto.randomUUID(); }
    else {
      var a = new Uint8Array(16); window.crypto.getRandomValues(a);
      id = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    try { window.localStorage.setItem(key, id); } catch (e) { /* 무시 */ }
    return id;
  })();
  function savedName() { try { return window.localStorage.getItem('teamRandomizer.name') || ''; } catch (e) { return ''; } }
  function saveName(n) { try { window.localStorage.setItem('teamRandomizer.name', n); } catch (e) { /* 무시 */ } }

  var els = {
    spotlight: $('spotlight'), spotLabel: $('spotLabel'), spotTeam: $('spotTeam'),
    form: $('entryForm'), input: $('nameInput'), btnDraw: $('btnDraw'), status: $('status'),
    btnSound: $('btnSound'), teams: $('teams'), total: $('totalCount'),
    done: $('doneBanner'), conn: $('conn')
  };
  var ui = {};
  var latest = null;          // 서버에서 받은 가장 최근 현황
  var me = null;              // 내 결과 { n, name, team }
  var spinning = false;       // 추첨 연출 중
  var hiddenN = null;         // 연출이 끝날 때까지 현황판에서 숨길 내 번호
  var stateVersion = 0;       // 추첨 응답이 온 뒤 오래된 현황이 덮어쓰지 않게 하는 표시
  var justRevealedN = null;

  /* ----- 화면 만들기 ----- */
  TEAMS.forEach(function (t) {
    var card = document.createElement('section');
    card.className = 'team-card team-' + t.id;
    var head = document.createElement('div'); head.className = 'team-head';
    var h = document.createElement('h3'); h.className = 'team-title'; h.textContent = t.emoji + ' ' + t.name;
    var cnt = document.createElement('span'); cnt.className = 'team-count'; cnt.textContent = '0 / ' + TEAM_SIZE;
    head.appendChild(h); head.appendChild(cnt);
    var ol = document.createElement('ol'); ol.className = 'slots';
    var slots = [];
    for (var k = 0; k < TEAM_SIZE; k++) {
      var li = document.createElement('li'); li.className = 'slot'; ol.appendChild(li); slots.push(li);
    }
    card.appendChild(head); card.appendChild(ol); els.teams.appendChild(card);
    ui[t.id] = { count: cnt, slots: slots };
  });

  function render() {
    var by = {}, shown = 0;
    TEAMS.forEach(function (t) { by[t.id] = []; });
    ((latest && latest.members) || []).forEach(function (m) {
      if (m.n === hiddenN) { return; }
      if (by[m.team] && by[m.team].length < TEAM_SIZE) { by[m.team].push(m); }
    });
    TEAMS.forEach(function (t) {
      var list = by[t.id]; shown += list.length;
      var u = ui[t.id];
      u.slots.forEach(function (slot, k) {
        var m = list[k];
        var cls = 'slot';
        if (m) {
          cls += ' filled';
          if (me && m.n === me.n) { cls += ' mine-slot'; }
          if (m.n === justRevealedN) { cls += ' pop'; }
        }
        slot.className = cls;
        slot.textContent = m ? m.name : '';
        slot.title = m ? m.name : '';
      });
      u.count.textContent = list.length + ' / ' + TEAM_SIZE;
    });
    els.total.textContent = shown;
    var allEight = TEAMS.every(function (t) { return by[t.id].length === TEAM_SIZE; });
    els.done.hidden = !(allEight && shown === TOTAL);
  }

  function showSpot(label, teamId, landed) {
    els.spotLabel.textContent = label;
    els.spotTeam.textContent = teamId ? teamById[teamId].emoji + ' ' + teamById[teamId].name : '🎲';
    els.spotlight.className = 'spotlight' + (teamId ? ' t-' + teamId : ' idle') + (landed ? ' landed' : '');
  }
  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.className = 'status' + (isError ? ' error' : '');
  }

  /* 내 상태에 맞게 위쪽 화면 정리 */
  function updateMine() {
    if (boardOnly || spinning) { return; }
    if (me) {
      els.form.hidden = true;
      showSpot(me.name + '님은', me.team, false);
      setStatus('아래 현황판에서 우리 팀 친구들을 확인해요.');
    } else if (latest && latest.full) {
      els.form.hidden = true;
      showSpot('자리가 없어요', null, false);
      els.spotTeam.textContent = '😢';
      setStatus('32명이 모두 뽑았어요. 진행하는 선생님께 알려 주세요.', true);
    } else {
      els.form.hidden = false;
      if (els.spotLabel.textContent.indexOf('님은') !== -1 || els.spotLabel.textContent === '자리가 없어요') { showSpot('내 팀은 어디일까요?', null, false); }
      if (els.status.textContent.indexOf('현황판에서') !== -1 || els.status.textContent.indexOf('32명이 모두') !== -1) { setStatus(''); }
    }
  }

  /* ----- 서버와 통신 ----- */
  function api(path, body) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    var opts = body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    if (ctrl) { opts.signal = ctrl.signal; }
    return fetch(path, opts).then(function (res) {
      if (timer) { clearTimeout(timer); }
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
    }, function (err) { if (timer) { clearTimeout(timer); } throw err; });
  }

  var failCount = 0, pollTimer = null;
  function poll() {
    clearTimeout(pollTimer);
    if (document.hidden) { pollTimer = setTimeout(poll, POLL_MS); return; }
    var v = stateVersion;
    api('/api/state?cid=' + encodeURIComponent(cid)).then(function (r) {
      failCount = 0; els.conn.hidden = true;
      if (r.status !== 200 || v !== stateVersion) { return; }
      latest = r.data;
      if (spinning) { if (latest.me) { hiddenN = latest.me.n; } }
      else { me = latest.me || null; }
      render(); updateMine();
    }).catch(function () {
      failCount++; if (failCount >= 2) { els.conn.hidden = false; }
    }).then(function () { pollTimer = setTimeout(poll, POLL_MS); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { poll(); } });

  /* ----- 효과음 (파일 없이 브라우저가 직접 만듭니다) ----- */
  var soundOn = true, audioCtx = null;
  function ensureAudio() {
    if (!soundOn) { return; }
    try {
      if (!audioCtx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) { audioCtx = new AC(); } }
      if (audioCtx && audioCtx.state === 'suspended') { audioCtx.resume(); }
    } catch (e) { audioCtx = null; }
  }
  function tone(freq, dur, type, vol, delay, endFreq) {
    if (!soundOn || !audioCtx) { return; }
    try {
      var t0 = audioCtx.currentTime + (delay || 0);
      var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (endFreq) { osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur); }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    } catch (e) { /* 소리 오류는 무시 */ }
  }
  function soundHeartbeat() { tone(120, 0.14, 'sine', 0.35, 0, 55); tone(110, 0.16, 'sine', 0.3, 0.16, 50); }
  function soundTick()      { tone(700 + Math.random() * 500, 0.04, 'square', 0.04); }
  function soundLand()      { tone(660, 0.1, 'triangle', 0.25); tone(880, 0.16, 'triangle', 0.25, 0.09); }
  function soundFanfare() {
    [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.3, i * 0.14); });
    tone(1047, 0.7, 'triangle', 0.3, 0.6); tone(784, 0.7, 'sine', 0.2, 0.6); tone(523, 0.7, 'sine', 0.2, 0.6);
  }
  els.btnSound.addEventListener('click', function () {
    soundOn = !soundOn;
    els.btnSound.textContent = soundOn ? '🔊 소리 켜짐' : '🔇 소리 꺼짐';
    els.btnSound.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    if (soundOn) { ensureAudio(); soundLand(); }
  });

  /* ----- 내 팀 뽑기 ----- */
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (spinning) { return; }
    var name = els.input.value.replace(/\s+/g, ' ').trim();
    if (!name) { setStatus('이름을 먼저 적어 주세요.', true); els.input.focus(); return; }
    startDraw(name);
  });

  async function startDraw(name) {
    ensureAudio();
    saveName(name);
    spinning = true; hiddenN = null;
    els.btnDraw.disabled = true; els.input.disabled = true; els.btnDraw.textContent = '뽑는 중...';
    setStatus('');
    soundHeartbeat();

    var result = null, failure = null;
    api('/api/draw', { cid: cid, name: name }).then(function (r) { result = r; }, function (err) { failure = err || new Error('network'); });

    var started = Date.now();
    var minMs = reduceMotion ? 400 : MIN_SPIN_MS;
    while (!(result || failure) || Date.now() - started < minMs) {
      showSpot(name + '님은', TEAMS[Math.floor(Math.random() * TEAMS.length)].id, false);
      soundTick();
      await sleep(70);
    }

    if (failure || !result || result.status !== 200) {
      spinning = false;
      els.btnDraw.disabled = false; els.input.disabled = false; els.btnDraw.textContent = '내 팀 뽑기!';
      showSpot('내 팀은 어디일까요?', null, false);
      var msg = (result && result.data && result.data.message) || '인터넷 연결을 확인하고 다시 눌러 주세요.';
      if (result && result.data && result.data.state) { latest = result.data.state; render(); }
      setStatus(msg, true);
      updateMine();
      return;
    }

    stateVersion++;
    me = result.data.me; latest = result.data.state; hiddenN = me.n;
    showSpot(me.name + '님은', me.team, true);
    soundLand();
    await sleep(reduceMotion ? 100 : 500);
    spinning = false; hiddenN = null; justRevealedN = me.n;
    render();
    soundFanfare();
    els.form.hidden = true;
    setStatus(result.data.already ? '이미 뽑았어요. 그대로 팀이 유지돼요!' : '아래 현황판에서 우리 팀 친구들을 확인해요.');
    setTimeout(function () { justRevealedN = null; }, 600);
  }

  els.input.value = savedName();
  showSpot('내 팀은 어디일까요?', null, false);
  render();
  poll();
})();

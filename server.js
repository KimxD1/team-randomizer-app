'use strict';
/* =====================================================
   랜덤 팀 추첨 서버 (외부 프로그램 설치 없이 Node.js만으로 동작)
   - 화면 파일(public 폴더)과 추첨 기능(/api)을 함께 제공합니다.
   - 32명이 동시에 눌러도 한 명씩 차례로 처리되므로 8명을 넘지 않습니다.
   ===================================================== */
var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var draw = require('./lib/draw');
var storage = require('./lib/storage');

var PUBLIC_DIR = path.join(__dirname, 'public');
var MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
var SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
};

function defaultDataFile() {
  if (process.env.DATA_FILE) { return process.env.DATA_FILE; }
  // Azure App Service: /home 폴더는 재시작·재배포 후에도 남아 있습니다.
  if (process.env.WEBSITE_SITE_NAME && process.env.HOME) { return path.join(process.env.HOME, 'team-randomizer-data', 'state.json'); }
  return path.join(__dirname, 'data', 'state.json');
}

function createServer(options) {
  options = options || {};
  var dataFile = options.dataFile || defaultDataFile();
  var adminPin = options.adminPin !== undefined ? options.adminPin : (process.env.ADMIN_PIN || '');
  var state = storage.load(dataFile);

  function persist() { storage.save(dataFile, state); }

  function sendJson(res, code, obj) {
    var body = JSON.stringify(obj);
    var h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS);
    res.writeHead(code, h);
    res.end(body);
  }

  function readJson(req, cb) {
    var size = 0, chunks = [], done = false;
    req.on('data', function (c) {
      size += c.length;
      if (size > 4096) { if (!done) { done = true; cb(new Error('too_large')); req.destroy(); } return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (done) { return; }
      done = true;
      try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { cb(new Error('bad_json')); }
    });
    req.on('error', function () { if (!done) { done = true; cb(new Error('read_error')); } });
  }

  function pinOk(pin) {
    if (!adminPin || typeof pin !== 'string') { return false; }
    var a = crypto.createHash('sha256').update(pin).digest();
    var b = crypto.createHash('sha256').update(adminPin).digest();
    return crypto.timingSafeEqual(a, b);
  }

  function handleAdmin(req, res, pathname) {
    readJson(req, function (err, body) {
      if (err) { return sendJson(res, 400, { error: 'bad_request', message: '요청을 읽지 못했어요.' }); }
      if (!adminPin) { return sendJson(res, 503, { error: 'no_pin', message: '관리자 비밀번호(ADMIN_PIN)가 서버에 설정되지 않았어요.' }); }
      if (!pinOk(body.pin)) {
        return setTimeout(function () { sendJson(res, 401, { error: 'wrong_pin', message: '비밀번호가 맞지 않아요.' }); }, 600);
      }
      if (pathname === '/api/admin/check') { return sendJson(res, 200, { ok: true }); }
      if (pathname === '/api/admin/reset') {
        state = draw.createState(state.round + 1);
        persist();
        return sendJson(res, 200, { ok: true, state: draw.publicView(state) });
      }
      if (pathname === '/api/admin/remove') {
        var removed = draw.removeMember(state, Number(body.n));
        if (removed) { persist(); }
        return sendJson(res, removed ? 200 : 404, { ok: removed, state: draw.publicView(state) });
      }
      return sendJson(res, 404, { error: 'not_found' });
    });
  }

  function handleApi(req, res, url) {
    var p = url.pathname;

    if (p === '/api/state' && req.method === 'GET') {
      var cid = url.searchParams.get('cid');
      return sendJson(res, 200, draw.publicView(state, draw.validCid(cid) ? cid : null));
    }

    if (p === '/api/draw' && req.method === 'POST') {
      return readJson(req, function (err, body) {
        if (err) { return sendJson(res, 400, { error: 'bad_request', message: '요청을 읽지 못했어요. 다시 눌러 주세요.' }); }
        // 여기부터는 중간에 멈추는 곳이 없어 한 명씩 차례로 처리됩니다.
        var r = draw.drawFor(state, body.cid, body.name);
        if (r.status === 'ok') { persist(); }
        if (r.status === 'ok' || r.status === 'already') {
          return sendJson(res, 200, { ok: true, already: r.status === 'already', me: { n: r.member.n, name: r.member.name, team: r.member.team }, state: draw.publicView(state, body.cid) });
        }
        if (r.status === 'full') { return sendJson(res, 409, { error: 'full', message: '32명이 모두 뽑아서 자리가 없어요.', state: draw.publicView(state, body.cid) }); }
        if (r.status === 'bad_name') { return sendJson(res, 400, { error: 'bad_name', message: '이름을 적어 주세요.' }); }
        return sendJson(res, 400, { error: 'bad_id', message: '이 기기를 확인하지 못했어요. 페이지를 새로 고쳐 주세요.' });
      });
    }

    if (req.method === 'POST' && (p === '/api/admin/check' || p === '/api/admin/reset' || p === '/api/admin/remove')) {
      return handleAdmin(req, res, p);
    }
    return sendJson(res, 404, { error: 'not_found', message: '없는 주소예요.' });
  }

  function serveStatic(req, res, url) {
    var rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400, SECURITY_HEADERS); return res.end('Bad request'); }
    if (rel === '/') { rel = '/index.html'; }
    if (rel === '/admin') { rel = '/admin.html'; }
    var file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (file.indexOf(PUBLIC_DIR + path.sep) !== 0) { res.writeHead(403, SECURITY_HEADERS); return res.end('Forbidden'); }
    fs.readFile(file, function (err, data) {
      if (err) { res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS)); return res.end('페이지를 찾을 수 없어요.'); }
      var type = MIME[path.extname(file).toLowerCase()];
      if (!type) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
      res.writeHead(200, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache' }, SECURITY_HEADERS));
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  var server = http.createServer(function (req, res) {
    var url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }
    if (url.pathname.indexOf('/api/') === 0) { return handleApi(req, res, url); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end('Method not allowed'); }
    return serveStatic(req, res, url);
  });
  server.getState = function () { return state; };
  server.dataFile = dataFile;
  return server;
}

module.exports = { createServer: createServer };

if (require.main === module) {
  var port = process.env.PORT || 3000;
  var srv = createServer();
  srv.listen(port, function () {
    console.log('랜덤 팀 추첨 서버 시작: 포트 ' + port);
    console.log('저장 위치: ' + srv.dataFile);
    if (!process.env.ADMIN_PIN) { console.warn('주의: ADMIN_PIN이 설정되지 않아 관리자 기능(초기화)을 쓸 수 없어요.'); }
  });
}

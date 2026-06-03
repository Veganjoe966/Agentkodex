'use strict';

const http = require('http');
const path = require('path');
const { URL } = require('url');
const { parseArgs, stringFlag, booleanFlag, listFlag } = require('./args');
const { ensureKodex, kodexPath } = require('./kodexStore');
const { readText, readJson } = require('./utils');
const { sanitizeError } = require('./security/controlPlane');
const { writeAuditEvidence } = require('./audit/evidence');
const { assertSafeBind, createCockpitAuth, rejectUnauthorized } = require('./cockpitAuth');
const {
  sendToSession,
  interruptSession,
  killSession,
  closeSessionStdin,
  finalizeSession,
  getSessionStatus,
  listSessionStatuses,
  replaySession,
  approveSession,
  denySession,
} = require('./runtime/sessionManager');
const { listApprovals, resolveApproval, markApproval } = require('./runtime/approvalQueue');

function cwdFromFlags(flags) {
  return path.resolve(stringFlag(flags, 'repo', stringFlag(flags, 'cwd', stringFlag(flags, 'root', process.cwd()))));
}

async function cockpitCommand(argv) {
  const { flags } = parseArgs(argv);
  const root = cwdFromFlags(flags);
  ensureKodex(root);
  if (booleanFlag(flags, 'json')) {
    console.log(JSON.stringify(snapshot(root), null, 2));
    return;
  }
  if (booleanFlag(flags, 'once') || booleanFlag(flags, 'snapshot')) {
    console.log(renderTextSnapshot(root));
    return;
  }
  const host = stringFlag(flags, 'host', '127.0.0.1');
  const port = Number(stringFlag(flags, 'port', process.env.AGENTKODEX_COCKPIT_PORT || '3919'));
  const auth = createCockpitAuth(root, { token: stringFlag(flags, 'token', '') });
  const server = await startCockpit(root, { host, port, auth, unsafePublic: booleanFlag(flags, 'unsafe-public') });
  const address = server.address();
  const url = `http://${host}:${address.port}`;
  console.log(`Agentkodex Cockpit running at ${url}`);
  console.log(`Auth token: ${booleanFlag(flags, 'show-token') || booleanFlag(flags, 'print-token') ? auth.token : `(hidden; stored at ${auth.tokenPath})`}`);
  console.log(`Project root: ${root}`);
  console.log('Press Ctrl+C to stop.');
  if (booleanFlag(flags, 'open')) openBrowser(url);
}

function startCockpit(root, options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port ?? 3919);
  assertSafeBind(host, Boolean(options.unsafePublic));
  const auth = options.auth || createCockpitAuth(root, options);
  const server = http.createServer((req, res) => handleRequest(root, req, res, { auth, host }));
  server.agentkodexAuth = { tokenPath: auth.tokenPath };
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function handleRequest(root, req, res, context = {}) {
  try {
    const url = new URL(req.url, 'http://agentkodex.local');
    if (url.pathname.startsWith('/api/')) {
      const rejected = rejectUnauthorized(req, url, context.auth, context.host);
      if (rejected) return json(res, rejected.body, rejected.status);
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return html(res, renderHtml(root));
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, { ok: true, root, time: new Date().toISOString() });
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, snapshot(root));
    if (req.method === 'GET' && url.pathname === '/api/sessions') return json(res, { sessions: listSessionStatuses(root) });
    if (req.method === 'GET' && url.pathname === '/api/approvals') return json(res, { approvals: pendingApprovals(root) });

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(status|transcript|events|send|interrupt|kill|close-stdin|finalize))?$/);
    if (sessionMatch) return await handleSessionRoute(root, req, res, sessionMatch[1], sessionMatch[2] || 'status', url);

    const legacySessionMatch = url.pathname.match(/^\/api\/session\/([^/]+)$/);
    if (req.method === 'GET' && legacySessionMatch) return json(res, sessionPayload(root, legacySessionMatch[1], url.searchParams));

    const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
    if (approvalMatch && req.method === 'POST') return await handleApprovalDecision(root, req, res, approvalMatch[1], approvalMatch[2]);

    return notFound(res);
  } catch (error) {
    return json(res, { ok: false, error: sanitizeError(error) }, 500);
  }
}

async function handleSessionRoute(root, req, res, id, action, url) {
  if (req.method === 'GET' && action === 'status') {
    const session = getSessionStatus(root, id);
    if (!session) return notFound(res);
    return json(res, { session });
  }
  if (req.method === 'GET' && action === 'transcript') {
    const session = getSessionStatus(root, id);
    if (!session) return notFound(res);
    const limit = Number(url.searchParams.get('limit') || 120000);
    return text(res, tail(readText(session.files?.transcript || '', ''), limit));
  }
  if (req.method === 'GET' && action === 'events') {
    const session = getSessionStatus(root, id);
    if (!session) return notFound(res);
    const limit = Number(url.searchParams.get('limit') || 120000);
    return text(res, tail(readText(session.files?.events || '', ''), limit));
  }
  if (req.method === 'POST' && action === 'send') {
    const body = await readBody(req);
    auditCockpitAction(root, 'session:send', id);
    return json(res, { ok: true, result: await sendToSession(root, id, body.text || body.message || '', { newline: body.newline !== false }) });
  }
  if (req.method === 'POST' && action === 'interrupt') { auditCockpitAction(root, 'session:interrupt', id); return json(res, { ok: true, result: await interruptSession(root, id) }); }
  if (req.method === 'POST' && action === 'kill') { auditCockpitAction(root, 'session:kill', id); return json(res, { ok: true, result: await killSession(root, id) }); }
  if (req.method === 'POST' && action === 'close-stdin') { auditCockpitAction(root, 'stdin:close', id); return json(res, { ok: true, result: await closeSessionStdin(root, id) }); }
  if (req.method === 'POST' && action === 'finalize') {
    const body = await readBody(req);
    auditCockpitAction(root, 'session:finalize', id);
    return json(res, {
      ok: true,
      result: await finalizeSession(root, id, {
        force: Boolean(body.force),
        yes: Boolean(body.yes),
        gates: Array.isArray(body.gates) ? body.gates : String(body.gates || '').split(',').map((x) => x.trim()).filter(Boolean),
        echo: false,
      }),
    });
  }
  return notFound(res);
}

async function handleApprovalDecision(root, req, res, id, action) {
  const body = await readBody(req);
  const approval = resolveApproval(root, id);
  if (!approval) return notFound(res);
  auditCockpitAction(root, `approval:${action}`, approval.sessionId || id);
  let result;
  if (approval.sessionId) {
    result = action === 'approve'
      ? await approveSession(root, approval.sessionId, approval.id, body.input)
      : await denySession(root, approval.sessionId, approval.id, body.input);
  } else {
    result = { approval: markApproval(root, approval.id, action === 'approve' ? 'approved' : 'denied') };
  }
  return json(res, { ok: true, result });
}

function auditCockpitAction(root, action, target) {
  writeAuditEvidence(root, { type: 'cockpit_action', allowed: true, action, target });
}

function snapshot(root) {
  const sessions = listSessionStatuses(root);
  const approvals = listApprovals(root, {});
  return {
    ok: true,
    root,
    kodex: kodexPath(root),
    time: new Date().toISOString(),
    sessions,
    approvals,
    pendingApprovals: approvals.filter((item) => item.status === 'open' || item.status === 'pending'),
    latest: sessions[0] || null,
  };
}

function pendingApprovals(root) {
  return listApprovals(root, {}).filter((item) => item.status === 'open' || item.status === 'pending');
}

function sessionPayload(root, id, searchParams) {
  const session = getSessionStatus(root, id || 'last');
  if (!session) return { error: 'session not found' };
  const events = searchParams.get('events') === '1' || searchParams.get('events') === 'true';
  const transcript = replaySession(root, session.id, { events });
  const status = session.runDir ? readJson(path.join(session.runDir, 'status.json'), null) : null;
  const finalReport = session.runDir ? readText(path.join(session.runDir, 'final-report.md'), '') : '';
  return { session, transcript, status, finalReport };
}

function renderTextSnapshot(root) {
  const data = snapshot(root);
  const lines = ['Agentkodex Cockpit Snapshot', `root: ${data.root}`, `sessions: ${data.sessions.length}`, `pending approvals: ${data.pendingApprovals.length}`];
  for (const session of data.sessions.slice(0, 10)) lines.push(`- ${session.id} ${session.status}/${session.state} agent=${session.agent} live=${session.live ? 'yes' : 'no'} task=${session.task || ''}`);
  return lines.join('\n');
}

function renderHtml(root) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agentkodex Cockpit</title>
<style>:root{color-scheme:dark;background:#0b0e14;color:#e6edf3;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0;background:radial-gradient(circle at top left,#172033,#0b0e14 42%)}header{padding:18px 24px;border-bottom:1px solid #273244;background:rgba(11,14,20,.82);position:sticky;top:0;backdrop-filter:blur(10px);z-index:2}h1{margin:0;font-size:22px}.muted{color:#8b949e}.grid{display:grid;grid-template-columns:340px 1fr;gap:16px;padding:16px}.panel{background:rgba(16,22,31,.88);border:1px solid #273244;border-radius:14px;overflow:hidden}.panel h2{margin:0;padding:12px 14px;font-size:14px;border-bottom:1px solid #273244;background:#111827}.body{padding:12px 14px}.item{padding:10px;border:1px solid #273244;border-radius:10px;margin-bottom:10px;cursor:pointer;background:#0f1623}.item:hover{border-color:#3b82f6}.item.active{outline:2px solid #3b82f6}.badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#1f2937;color:#bfdbfe;font-size:12px;margin-right:6px}button,input,textarea{font:inherit}button{background:#1f6feb;color:white;border:0;border-radius:8px;padding:8px 10px;cursor:pointer}button.secondary{background:#30363d}button.danger{background:#b42318}textarea{width:100%;box-sizing:border-box;min-height:84px;border-radius:10px;border:1px solid #30363d;background:#0b0e14;color:#e6edf3;padding:10px}pre{margin:0;white-space:pre-wrap;word-break:break-word;background:#05070b;color:#d1d5db;padding:14px;min-height:440px;max-height:70vh;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.45}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.small{font-size:12px}.empty{padding:20px;color:#8b949e}.approval{border-left:3px solid #f59e0b}.footer{padding:10px 14px;border-top:1px solid #273244;background:#0f1623}</style></head>
<body><header><h1>Agentkodex Cockpit <span class="muted">Runtime v2</span></h1><div class="muted small">Live session control, transcript replay, approvals, and gates.</div></header>
<main class="grid"><section class="panel"><h2>Sessions</h2><div id="sessions" class="body empty">Loading…</div><h2>Approvals</h2><div id="approvals" class="body empty">Loading…</div></section><section class="panel"><h2 id="title">No session selected</h2><div class="body"><div id="meta" class="muted small"></div><div class="toolbar"><button onclick="refresh()">Refresh</button><button class="secondary" onclick="interruptSelected()">Interrupt</button><button class="danger" onclick="killSelected()">Kill</button><button class="secondary" onclick="closeStdinSelected()">Close stdin</button></div><textarea id="input" placeholder="Send a message or keystrokes into the live agent session..."></textarea><div class="toolbar"><button onclick="sendSelected()">Send</button><button class="secondary" onclick="loadEvents()">Show events</button><button class="secondary" onclick="loadTranscript()">Show transcript</button></div></div><pre id="terminal">Select a session from the left.</pre><div class="footer muted small">Auto-refreshes every 2 seconds while open.</div></section></main>
<script>
let selected=null;let cockpitToken=localStorage.getItem('agentkodexCockpitToken')||prompt('Agentkodex Cockpit token');if(cockpitToken)localStorage.setItem('agentkodexCockpitToken',cockpitToken);function opts(o={}){const h=Object.assign({},o.headers||{},{authorization:'Bearer '+cockpitToken});if((o.method||'GET').toUpperCase()!=='GET')h['x-agentkodex-csrf']='1';return Object.assign({},o,{headers:h})}async function api(p,o){const r=await fetch(p,opts(o));const t=await r.text();try{return JSON.parse(t)}catch{return t}}async function txt(p){return fetch(p,opts()).then(r=>r.text())}function esc(s){return String(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}async function refresh(){await loadSessions();await loadApprovals();if(selected)await loadTranscript()}async function loadSessions(){const data=await api('/api/sessions');const box=document.getElementById('sessions');const sessions=data.sessions||[];if(!sessions.length){box.className='body empty';box.textContent='No sessions yet. Start one with agentkodex session start.';return}box.className='body';box.innerHTML=sessions.map(s=>'<div class="item '+(selected===s.id?'active':'')+'" onclick="selectSession(\''+s.id+'\')"><div><span class="badge">'+esc(s.status||'')+'</span><span class="badge">'+esc(s.state||'')+'</span></div><b>'+esc(s.id)+'</b><div class="muted small">'+esc(s.agent||'')+' · '+esc(s.task||'')+'</div></div>').join('');if(!selected)await selectSession(sessions[0].id)}async function loadApprovals(){const data=await api('/api/approvals');const box=document.getElementById('approvals');const list=data.approvals||[];if(!list.length){box.className='body empty';box.textContent='No pending approvals.';return}box.className='body';box.innerHTML=list.map(a=>'<div class="item approval"><b>'+esc(a.id)+'</b><div class="small">'+esc(a.kind||'')+' · session '+esc(a.sessionId||'-')+'</div><div class="muted small">'+esc(a.reason||a.prompt||a.text||'')+'</div><div class="toolbar"><button onclick="approve(\''+a.id+'\')">Approve</button><button class="danger" onclick="deny(\''+a.id+'\')">Deny</button></div></div>').join('')}async function selectSession(id){selected=id;document.getElementById('title').textContent='Session '+id;const data=await api('/api/sessions/'+id);const s=data.session||{};document.getElementById('meta').innerHTML='<span class="badge">'+esc(s.status||'')+'</span><span class="badge">'+esc(s.state||'')+'</span> PID '+esc(s.pid||'-')+' · '+esc(s.command||'');await loadTranscript()}async function loadTranscript(){if(!selected)return;const t=await txt('/api/sessions/'+selected+'/transcript');const term=document.getElementById('terminal');term.textContent=t||'(no transcript yet)';term.scrollTop=term.scrollHeight}async function loadEvents(){if(!selected)return;const t=await txt('/api/sessions/'+selected+'/events');document.getElementById('terminal').textContent=t||'(no events yet)'}async function sendSelected(){if(!selected)return;const text=document.getElementById('input').value;await api('/api/sessions/'+selected+'/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});document.getElementById('input').value='';await loadTranscript()}async function interruptSelected(){if(selected)await api('/api/sessions/'+selected+'/interrupt',{method:'POST'});await refresh()}async function killSelected(){if(selected&&confirm('Kill this session?'))await api('/api/sessions/'+selected+'/kill',{method:'POST'});await refresh()}async function closeStdinSelected(){if(selected)await api('/api/sessions/'+selected+'/close-stdin',{method:'POST'});await refresh()}async function approve(id){await api('/api/approvals/'+id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await refresh()}async function deny(id){await api('/api/approvals/'+id+'/deny',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await refresh()}refresh();setInterval(refresh,2000);
</script></body></html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString();
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        try { req.destroy(); } catch (_) {}
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({ text: raw }); }
    });
    req.on('error', reject);
  });
}

function tail(value, max) {
  const text = String(value || '');
  return text.length > max ? text.slice(text.length - max) : text;
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value, null, 2));
}

function text(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(value);
}

function html(res, value) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(value);
}

function notFound(res) {
  json(res, { ok: false, error: 'not found' }, 404);
}

function openBrowser(url) {
  const { spawn } = require('child_process');
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (_) {}
}

module.exports = {
  cockpitCommand,
  startCockpit,
  snapshot,
  renderHtml,
  renderTextSnapshot,
};

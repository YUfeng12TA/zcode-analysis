'use strict';
/* DeskCoder renderer 逻辑：会话、流式事件渲染、设置、极简安全 Markdown 渲染。 */

/* ---------- 极简 Markdown 渲染（安全：先转义再生成标签） ---------- */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(md) {
  let t = esc(md);
  // 行内代码
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // 链接：仅允许 http/https
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
  // 加粗
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return t;
}

function mdToHtml(md) {
  if (!md) return '';
  const lines = String(md).split(/\r?\n/);
  let html = '';
  let inCode = false;
  let codeBuf = [];
  let listType = null; // 'ul' | 'ol' | null
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      html += `<p>${paraBuf.map(inline).join('<br>')}</p>`;
      paraBuf = [];
    }
  };
  const flushList = () => {
    if (listType) { html += `</${listType}>`; listType = null; }
  };
  const flushCode = () => {
    if (inCode) {
      html += `<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`;
      codeBuf = [];
      inCode = false;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim().startsWith('```')) {
      flushPara(); flushList();
      if (inCode) flushCode();
      else { inCode = true; codeBuf = []; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (/^-\s+/.test(line) || /^\*\s+/.test(line)) {
      flushPara();
      if (listType !== 'ul') { flushList(); html += '<ul>'; listType = 'ul'; }
      html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`;
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== 'ol') { flushList(); html += '<ol>'; listType = 'ol'; }
      html += `<li>${inline(ol[1])}</li>`;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara(); flushList();
      html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`;
      continue;
    }
    if (line.trim() === '') { flushPara(); flushList(); continue; }
    flushList();
    paraBuf.push(line);
  }
  flushCode(); flushPara(); flushList();
  return html;
}

/* ---------- DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const messagesEl = $('#messages');
const inputEl = $('#input');
const sendBtn = $('#sendBtn');
const stopBtn = $('#stopBtn');
const sessionListEl = $('#sessionList');
const workspaceBar = $('#workspaceBar');

const state = {
  settings: null,
  sessionId: null,
  running: false,
  currentAssistant: null,   // {el, buffer, renderTimer}
  toolCards: new Map(),     // tool_call_id -> {el, bodyEl}
};

/* ---------- 消息渲染 ---------- */
function addUserMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg user';
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  el.appendChild(b);
  messagesEl.appendChild(el);
  scrollBottom();
}

function newAssistantMsg() {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const body = document.createElement('div');
  body.className = 'body';
  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
  return { wrap, body, buffer: '' };
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderAssistant(assistant) {
  assistant.body.innerHTML = mdToHtml(assistant.buffer);
  scrollBottom();
}

function showThinking(label) {
  const el = document.createElement('div');
  el.className = 'thinking';
  el.innerHTML = `<span class="spinner"></span><span>${esc(label || '思考中…')}</span>`;
  messagesEl.appendChild(el);
  return el;
}

function showError(msg) {
  const el = document.createElement('div');
  el.className = 'error-msg';
  el.textContent = msg;
  messagesEl.appendChild(el);
  scrollBottom();
}

function addToolCard(call) {
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.innerHTML = `
    <div class="tool-head">
      <span class="dot"></span>
      <span class="name">${esc(call.name)}</span>
      <span class="chevron">▾</span>
    </div>
    <div class="tool-body">
      <div class="label">参数</div>
      <pre></pre>
      <div class="label">结果</div>
      <pre class="result"></pre>
    </div>`;
  card.querySelector('.tool-body pre').textContent = JSON.stringify(call.args, null, 2);
  const head = card.querySelector('.tool-head');
  head.addEventListener('click', () => card.classList.toggle('open'));
  messagesEl.appendChild(card);
  scrollBottom();
  return card;
}

/* ---------- 会话 ---------- */
async function refreshSessions() {
  const list = await window.deskCoder.listSessions();
  sessionListEl.innerHTML = '';
  for (const s of list) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === state.sessionId ? ' active' : '');
    item.textContent = s.title || '(新会话)';
    item.title = new Date(s.createdAt).toLocaleString();
    item.addEventListener('click', async () => {
      const r = await window.deskCoder.loadSession(s.id);
      if (r.error) { showError(r.error); return; }
      state.sessionId = s.id;
      messagesEl.innerHTML = '';
      for (const m of r.messages || []) {
        if (m.role === 'user') addUserMsg(m.content);
        else if (m.role === 'assistant' && m.content) {
          const a = newAssistantMsg();
          a.buffer = m.content;
          renderAssistant(a);
        }
      }
      refreshSessions();
    });
    sessionListEl.appendChild(item);
  }
}

/* ---------- 事件流 ---------- */
window.deskCoder.onEvent((ev) => {
  switch (ev.type) {
    case 'thinking': {
      if (state.thinkingEl) state.thinkingEl.remove();
      state.thinkingEl = showThinking(`第 ${ev.step} 轮工具调度`);
      break;
    }
    case 'delta': {
      if (!state.currentAssistant) state.currentAssistant = newAssistantMsg();
      state.currentAssistant.buffer += ev.value;
      clearTimeout(state.currentAssistant.renderTimer);
      state.currentAssistant.renderTimer = setTimeout(() => renderAssistant(state.currentAssistant), 80);
      break;
    }
    case 'tool_start': {
      if (state.thinkingEl) { state.thinkingEl.remove(); state.thinkingEl = null; }
      const card = addToolCard({ name: ev.name, args: ev.args });
      state.toolCards.set(ev.id, card);
      break;
    }
    case 'tool_end': {
      const card = state.toolCards.get(ev.id);
      if (card) {
        const resultPre = card.querySelector('.tool-body pre.result');
        resultPre.textContent = JSON.stringify(ev.result, null, 2).slice(0, 4000);
        card.querySelector('.tool-head').classList.add('done');
        scrollBottom();
      }
      break;
    }
    case 'done': {
      if (state.thinkingEl) { state.thinkingEl.remove(); state.thinkingEl = null; }
      if (state.currentAssistant) {
        clearTimeout(state.currentAssistant.renderTimer);
        renderAssistant(state.currentAssistant);
        state.currentAssistant = null;
      }
      setRunning(false);
      break;
    }
    case 'error': {
      if (state.thinkingEl) { state.thinkingEl.remove(); state.thinkingEl = null; }
      showError(ev.message);
      setRunning(false);
      break;
    }
  }
});

/* ---------- 发送 / 停止 ---------- */
function setRunning(r) {
  state.running = r;
  sendBtn.disabled = r;
  stopBtn.classList.toggle('hidden', !r);
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || state.running) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  addUserMsg(text);
  setRunning(true);
  state.currentAssistant = null;
  state.toolCards.clear();
  try {
    await window.deskCoder.sendMessage(text);
  } catch (e) {
    showError(e.message);
    setRunning(false);
  }
  refreshSessions();
}

sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', async () => { await window.deskCoder.abort(); setRunning(false); });

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
  if (e.key === 'Enter') {
    setTimeout(() => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
    }, 0);
  }
});

/* ---------- 设置 ---------- */
const modal = $('#settingsModal');
$('#settingsBtn').addEventListener('click', openSettings);
$('#settingsCancel').addEventListener('click', () => modal.classList.add('hidden'));

function openSettings() {
  const s = state.settings || {};
  $('#sBaseURL').value = s.baseURL || '';
  $('#sApiKey').value = s.apiKey || '';
  $('#sModel').value = s.model || '';
  $('#sTemp').value = s.temperature ?? 0.2;
  $('#sWorkspace').value = s.workspace || '';
  modal.classList.remove('hidden');
}

$('#pickWorkspaceBtn').addEventListener('click', async () => {
  const dir = await window.deskCoder.pickWorkspace();
  if (dir) $('#sWorkspace').value = dir;
});

$('#settingsSave').addEventListener('click', async () => {
  const next = {
    baseURL: $('#sBaseURL').value.trim(),
    apiKey: $('#sApiKey').value.trim(),
    model: $('#sModel').value.trim(),
    temperature: parseFloat($('#sTemp').value) || 0.2,
    workspace: $('#sWorkspace').value.trim(),
  };
  await window.deskCoder.setSettings(next);
  state.settings = next;
  modal.classList.add('hidden');
  updateWorkspaceBar(next.workspace);
});

function updateWorkspaceBar(ws) {
  workspaceBar.textContent = ws || '未选择工作目录';
  workspaceBar.title = ws || '未选择工作目录';
}

$('#newSessionBtn').addEventListener('click', async () => {
  const r = await window.deskCoder.newSession();
  state.sessionId = r.id;
  messagesEl.innerHTML = '';
  refreshSessions();
});

/* ---------- 启动 ---------- */
(async function init() {
  state.settings = await window.deskCoder.getSettings();
  updateWorkspaceBar(state.settings.workspace);
  const r = await window.deskCoder.newSession();
  state.sessionId = r.id;
  refreshSessions();
})();

'use strict';
/**
 * Agent 引擎冒烟测试：mock LLM（不联网），验证工具调度循环正确性。
 * 运行：npm run test:agent
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-coder-test-'));
fs.writeFileSync(path.join(fixture, 'README.md'), '# 测试项目\n\nhello world\n', 'utf8');
fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
fs.writeFileSync(path.join(fixture, 'src', 'app.js'), 'console.log(1)\n', 'utf8');

const llm = require('../main/llm');
const { AgentSession } = require('../main/agent');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  // ---- 场景 1：工具调度 → 工具结果回填 → 最终文本 ----
  console.log('场景 1：工具调度循环');
  let callCount = 0;
  const seenMessages = [];
  llm.chatCompletion = async (opts) => {
    callCount++;
    seenMessages.push(opts.messages.map((m) => m.role).join(','));
    if (callCount === 1) {
      return { text: '先看目录', toolCalls: [{ id: 'c1', name: 'list_dir', arguments: { path: '.' } }] };
    }
    if (callCount === 2) {
      return { text: '读 README', toolCalls: [{ id: 'c2', name: 'read_file', arguments: { path: 'README.md' } }] };
    }
    return { text: '分析完成，项目包含一个 README 和 src 目录。', toolCalls: [] };
  };

  const events = [];
  const s = new AgentSession({ settings: {}, workspace: fixture, onEvent: (ev) => events.push(ev) });
  const result = await s.run('分析这个项目');

  check('最终返回模型文本', result === '分析完成，项目包含一个 README 和 src 目录。', result);
  check('共调用 3 次 LLM', callCount === 3, `got ${callCount}`);
  check('tool_start 事件 2 次', events.filter((e) => e.type === 'tool_start').length === 2);
  check('tool_end 事件 2 次', events.filter((e) => e.type === 'tool_end').length === 2);
  check('list_dir 工具真实执行', JSON.stringify(events.find((e) => e.type === 'tool_end' && e.name === 'list_dir').result).includes('README.md'));
  check('read_file 工具返回内容', JSON.stringify(events.find((e) => e.type === 'tool_end' && e.name === 'read_file').result).includes('hello world'));
  check('done 事件已发出', events.some((e) => e.type === 'done'));

  // history 格式（OpenAI 兼容）
  const h = s.getMessages();
  // user + assistant(tool_calls) + tool + assistant(tool_calls) + tool + assistant(final)
  check('history 长度 6', h.length === 6, `got ${h.length}`);
  const asst1 = h[1];
  check('assistant 消息携带 tool_calls 字段', Array.isArray(asst1.tool_calls) && asst1.tool_calls[0].function.name === 'list_dir');
  check('tool 消息带 tool_call_id', h[2].role === 'tool' && h[2].tool_call_id === 'c1');
  check('第二轮 messages 含 tool 回填', seenMessages[1] === 'system,user,assistant,tool', seenMessages[1]);

  // ---- 场景 2：路径越界防护 ----
  console.log('场景 2：路径穿越防护');
  let callCount2 = 0;
  llm.chatCompletion = async (opts) => {
    callCount2++;
    if (callCount2 === 1) {
      return { text: '', toolCalls: [{ id: 'x1', name: 'read_file', arguments: { path: '../../etc/passwd' } }] };
    }
    return { text: '越界被拒绝。', toolCalls: [] };
  };
  const s2 = new AgentSession({ settings: {}, workspace: fixture, onEvent: () => {} });
  const ev2 = [];
  s2.onEvent = (ev) => ev2.push(ev);
  await s2.run('读一个越界文件');
  const end = ev2.find((e) => e.type === 'tool_end' && e.name === 'read_file');
  check('越界路径被拒绝且不抛未捕获错误', !!end && JSON.stringify(end.result).includes('error'));

  // ---- 场景 3：未知工具 ----
  console.log('场景 3：未知工具');
  let callCount3 = 0;
  llm.chatCompletion = async (opts) => {
    callCount3++;
    if (callCount3 === 1) {
      return { text: '', toolCalls: [{ id: 'y1', name: 'rm_rf_system', arguments: {} }] };
    }
    return { text: '未知工具被拒绝。', toolCalls: [] };
  };
  const s3 = new AgentSession({ settings: {}, workspace: fixture, onEvent: () => {} });
  const ev3 = [];
  s3.onEvent = (ev) => ev3.push(ev);
  await s3.run('调用未知工具');
  const end3 = ev3.find((e) => e.type === 'tool_end');
  check('未知工具返回 error', !!end3 && JSON.stringify(end3.result).includes('未知工具'));

  // ---- 场景 4：中止 ----
  console.log('场景 4：中止');
  llm.chatCompletion = async (opts) => {
    await new Promise((r) => setTimeout(r, 500));
    if (opts.signal && opts.signal.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    return { text: '不该出现', toolCalls: [] };
  };
  const s4 = new AgentSession({ settings: {}, workspace: fixture, onEvent: () => {} });
  const runPromise = s4.run('慢请求');
  setTimeout(() => s4.abort(), 50);
  try {
    await runPromise;
    check('中止后不返回结果（抛出错误）', false);
  } catch (e) {
    check('中止抛 AbortError', e.name === 'AbortError' || /abort/i.test(e.message), `${e.name}: ${e.message}`);
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  fs.rmSync(fixture, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试崩溃：', e); process.exit(1); });

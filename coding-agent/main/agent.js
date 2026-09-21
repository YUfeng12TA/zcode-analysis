'use strict';
/**
 * Agent 引擎：模型调用 + 工具调度主循环。
 *
 * 循环语义（参考 ZCode 逆向分析中的工具调度模式，自研实现）：
 *   1. 组装 system + 历史消息
 *   2. 调用 LLM（流式，带工具 schema）
 *   3. 若模型返回 tool_calls → 逐个执行工具，把结果以 tool 消息回填，回到 2
 *   4. 若模型只返回文本 → 结束本轮，把最终文本交给 UI
 *
 * 事件（onEvent）：{type:'delta'|'tool_start'|'tool_end'|'done'|'error', ...}
 */

const llm = require('./llm');
const { toolSchemas, executeTool } = require('./tools');

const MAX_STEPS = 20; // 单轮最多工具调用轮数，防止死循环

function systemPrompt(workspace) {
  return [
    '你是一个运行在桌面端的 AI 编程助手（DeskCoder），通过工具在用户的本地项目里工作。',
    '',
    `当前工作目录：${workspace}`,
    '',
    '行为准则：',
    '- 先探查再动手：用 list_dir / glob / read_file / grep 了解项目结构，再决定如何修改。',
    '- 写代码时一次性给出完整文件内容（write_file），小改动用 edit_file。',
    '- 需要验证时用 run_command 运行测试或构建命令。',
    '- 工具调用失败时读取错误信息并修正，不要重复同样的失败调用。',
    '- 回答用中文，输出简洁、要点优先。',
    '- 永远不要编造文件内容或命令输出：一切以工具返回为准。',
  ].join('\n');
}

class AgentSession {
  /**
   * @param {object} opts { settings, workspace, onEvent }
   */
  constructor(opts) {
    this.settings = opts.settings;
    this.workspace = opts.workspace;
    this.onEvent = opts.onEvent || (() => {});
    this.history = [];
    this.abortController = null;
    this.running = false;
  }

  /** 载入历史（会话恢复用）。 */
  loadHistory(messages) {
    this.history = Array.isArray(messages) ? messages.filter((m) => ['user', 'assistant'].includes(m.role)) : [];
  }

  getMessages() {
    return this.history;
  }

  async run(userText) {
    if (this.running) throw new Error('Agent 正在运行中');
    this.running = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.history.push({ role: 'user', content: userText });

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const messages = [{ role: 'system', content: systemPrompt(this.workspace) }, ...this.history];

        this.onEvent({ type: 'thinking', step: step + 1 });
        const res = await llm.chatCompletion({
          settings: this.settings,
          messages,
          tools: toolSchemas(),
          signal,
          onDelta: (d) => this.onEvent({ type: 'delta', ...d }),
        });

        const hasToolCalls = res.toolCalls && res.toolCalls.length > 0;
        if (hasToolCalls) {
          // OpenAI 格式要求：assistant 消息携带 tool_calls（含 id + 函数参数），
          // 后续 tool 消息用 tool_call_id 回填。
          this.history.push({
            role: 'assistant',
            content: res.text || '',
            tool_calls: res.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.arguments) },
            })),
          });
        } else {
          this.history.push({ role: 'assistant', content: res.text || '' });
        }

        if (!hasToolCalls) {
          this.onEvent({ type: 'done', message: res.text || '' });
          return res.text || '';
        }

        // 工具调度
        for (const call of res.toolCalls) {
          if (signal.aborted) throw new Error('已中止');
          this.onEvent({ type: 'tool_start', name: call.name, args: call.arguments, id: call.id });
          const result = await executeTool(this.workspace, call);
          this.onEvent({ type: 'tool_end', name: call.name, id: call.id, result });
          this.history.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify(result).slice(0, 8000),
          });
        }
      }
      throw new Error(`超过最大工具调用轮数（${MAX_STEPS}）`);
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  abort() {
    if (this.abortController) this.abortController.abort();
  }
}

module.exports = { AgentSession };

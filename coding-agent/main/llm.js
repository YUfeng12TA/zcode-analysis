'use strict';
/**
 * LLM 客户端 —— OpenAI 兼容 Chat Completions 接口。
 * 支持：流式输出（SSE）、function calling（工具调用）、自定义 baseURL / apiKey / model。
 * 兼容几乎所有 OpenAI 兼容网关（OpenAI / DeepSeek / Moonshot / 智谱 / vLLM / Ollama 等）。
 */

function normalizeSettings(s) {
  return {
    baseURL: (s && s.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: (s && s.apiKey) || '',
    model: (s && s.model) || 'gpt-4o-mini',
    temperature: typeof s?.temperature === 'number' ? s.temperature : 0.2,
  };
}

/**
 * 将内部工具定义转换为 OpenAI function 格式。
 * @param {Array<{name:string, description:string, parameters:object}>} tools
 */
function toOpenAITools(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } },
  }));
}

/**
 * 解析 SSE 数据流，逐块回调。
 */
async function streamSSE(res, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') {
          onChunk(JSON.parse(payload));
        }
      }
    }
  }
}

/**
 * 发起一次聊天补全（流式），返回最终结果。
 * @returns {Promise<{text:string, toolCalls:Array<{id:string,name:string,arguments:object}>}>}
 */
async function chatCompletion(opts) {
  const { settings, messages, tools, signal, onDelta } = opts;
  const cfg = normalizeSettings(settings);

  const body = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    stream: true,
  };
  if (tools && tools.length) {
    body.tools = toOpenAITools(tools);
    body.tool_choice = 'auto';
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const res = await fetch(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${errText.slice(0, 500)}`);
  }

  let text = '';
  const toolCalls = [];
  await streamSSE(res, (chunk) => {
    const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
    if (!delta) return;
    if (delta.content) {
      text += delta.content;
      if (onDelta) onDelta({ type: 'text', value: delta.content });
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        let slot = toolCalls.find((t) => t.index === tc.index);
        if (!slot) {
          slot = { index: tc.index, id: tc.id || '', name: '', args: '' };
          toolCalls.push(slot);
        }
        if (tc.id) slot.id = tc.id;
        if (tc.function) {
          if (tc.function.name) slot.name += tc.function.name;
          if (tc.function.arguments) slot.args += tc.function.arguments;
        }
      }
    }
  });

  const parsed = toolCalls.map((t) => {
    let args = {};
    try { args = t.args ? JSON.parse(t.args) : {}; } catch { args = { _raw: t.args }; }
    return { id: t.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: t.name, arguments: args };
  });

  return { text, toolCalls: parsed };
}

module.exports = { chatCompletion, normalizeSettings };

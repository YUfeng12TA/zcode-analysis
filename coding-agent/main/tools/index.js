'use strict';
/**
 * 工具注册表：把工具定义与执行函数绑定，供 agent 循环调度。
 * 设计参考 ZCode 逆向分析中的工具调度模式（toolCall → startTool → runTool），自研实现。
 */
const files = require('./files');
const exec = require('./exec');

const TOOLS = [
  {
    name: 'list_dir',
    description: '列出目录内容（含文件大小与类型）。用于了解工作区结构。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '目录相对路径，默认 "."' } },
    },
    handler: files.list_dir,
  },
  {
    name: 'read_file',
    description: '读取文本文件内容（上限 200KB）。编码 UTF-8。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '文件相对路径' } },
      required: ['path'],
    },
    handler: files.read_file,
  },
  {
    name: 'write_file',
    description: '创建或覆盖写入一个文本文件（自动创建父目录）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件相对路径' },
        content: { type: 'string', description: '完整文件内容' },
      },
      required: ['path', 'content'],
    },
    handler: files.write_file,
  },
  {
    name: 'edit_file',
    description: '在文件中做精确字符串替换（先 read_file 拿到原文再调用）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件相对路径' },
        old: { type: 'string', description: '要被替换的原文片段，必须唯一存在于文件中' },
        replacement: { type: 'string', description: '替换后的内容' },
      },
      required: ['path', 'old', 'replacement'],
    },
    handler: files.edit_file,
  },
  {
    name: 'glob',
    description: '按 glob 模式查找文件（如 "src/**/*.ts"）。优先用 git 文件清单，忽略 node_modules/.git。',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string', description: 'glob 模式，默认 **/*' } },
    },
    handler: files.glob,
  },
  {
    name: 'grep',
    description: '在项目内搜索文本（需 ripgrep，优先用 rg 二进制，速度快）。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '搜索的正则或关键字' },
        glob: { type: 'string', description: '可选文件过滤，如 "*.js"' },
      },
      required: ['pattern'],
    },
    handler: files.grep,
  },
  {
    name: 'run_command',
    description: '在工作目录内执行 shell 命令并返回输出（限时 5 分钟、输出上限 60KB）。可用于运行测试、构建、git 操作。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的完整 shell 命令' },
        cwd: { type: 'string', description: '相对子目录，默认工作目录根' },
        timeout_ms: { type: 'number', description: '超时毫秒，默认 60000' },
      },
      required: ['command'],
    },
    handler: exec.run_command,
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** 供 LLM 看到的工具定义（不含 handler）。 */
function toolSchemas() {
  return TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

/**
 * 执行一个工具调用。
 * @param {string} workspace 工作目录
 * @param {{name:string, arguments:object}} call
 */
async function executeTool(workspace, call) {
  const t = BY_NAME.get(call.name);
  if (!t) return { error: `未知工具：${call.name}` };
  try {
    const result = await t.handler(workspace, call.arguments || {});
    return typeof result === 'string' ? { text: result } : result;
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { toolSchemas, executeTool };

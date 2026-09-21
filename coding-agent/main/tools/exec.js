'use strict';
/**
 * 命令执行工具：在用户指定工作目录内执行 shell 命令（限时、限输出量）。
 * 默认在 Electron 主进程内执行，不使用 node-pty（简化）；输出截断保护。
 */
const { exec } = require('child_process');

const MAX_OUTPUT = 60 * 1024; // 60KB 输出上限

function runCommand(workspace, args) {
  const command = String(args.command || '').trim();
  if (!command) throw new Error('run_command 需要 command');
  const cwd = args.cwd ? require('path').resolve(workspace || process.cwd(), String(args.cwd)) : (workspace || process.cwd());
  const timeoutMs = Math.min(Number(args.timeout_ms) || 60000, 300000);

  return new Promise((resolve) => {
    const child = exec(command, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_OUTPUT }, (err, stdout, stderr) => {
      let exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      let timedOut = false;
      let truncated = false;
      let out = stdout || '';
      let errOut = stderr || '';
      if (out.length > MAX_OUTPUT) { out = out.slice(0, MAX_OUTPUT); truncated = true; }
      if (errOut.length > MAX_OUTPUT) { errOut = errOut.slice(0, MAX_OUTPUT); truncated = true; }
      if (err && err.killed) { timedOut = true; exitCode = 124; }
      resolve({
        exit_code: exitCode,
        timed_out: timedOut,
        truncated,
        stdout: out,
        stderr: errOut,
      });
    });
  });
}

module.exports = { run_command: runCommand };

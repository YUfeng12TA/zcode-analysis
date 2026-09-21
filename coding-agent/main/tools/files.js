'use strict';
/**
 * 文件系统工具：读/写/编辑/列目录/搜索。
 * 所有路径基于当前工作目录（workspace）解析，防止越界访问（路径穿越防护）。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/** 将用户提供的相对路径解析到工作区内，拒绝越界（.. 逃逸）。 */
function resolveInWorkspace(workspace, p) {
  const base = path.resolve(workspace || process.cwd());
  const target = path.resolve(base, String(p || '.'));
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`路径越界：${p} 不在工作目录 ${base} 内`);
  }
  return target;
}

async function listDir(workspace, args) {
  const dir = resolveInWorkspace(workspace, args.path || '.');
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const items = entries
    .filter((e) => !e.name.startsWith('.git'))
    .map((e) => {
      const full = path.join(dir, e.name);
      let size = null;
      if (e.isFile()) {
        try { size = fs.statSync(full).size; } catch {}
      }
      return {
        name: e.name,
        type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
        size,
      };
    })
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { path: dir, count: items.length, items };
}

async function readFile(workspace, args) {
  const file = resolveInWorkspace(workspace, args.path);
  const stat = await fsp.stat(file);
  if (stat.isDirectory()) return { error: `${file} 是目录，请用 list_dir` };
  const MAX = 200 * 1024; // 200KB 上限
  const buf = await fsp.readFile(file);
  if (buf.length > MAX) {
    return { error: `文件过大（${buf.length} 字节），仅预览前 200KB`, content: buf.toString('utf8', 0, MAX) };
  }
  return { path: file, size: buf.length, content: buf.toString('utf8') };
}

async function writeFile(workspace, args) {
  const file = resolveInWorkspace(workspace, args.path);
  const content = String(args.content ?? '');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, 'utf8');
  return { ok: true, path: file, bytes: Buffer.byteLength(content, 'utf8') };
}

async function editFile(workspace, args) {
  const file = resolveInWorkspace(workspace, args.path);
  const old = String(args.old ?? '');
  const replacement = String(args.replacement ?? '');
  if (!old) throw new Error('edit_file 需要非空 old 片段');
  const text = await fsp.readFile(file, 'utf8');
  if (!text.includes(old)) {
    return { error: `未在 ${file} 中找到目标片段，请先 read_file 确认内容` };
  }
  const count = text.split(old).length - 1;
  const updated = count === 1 ? text.replace(old, replacement) : text.split(old).join(replacement);
  await fsp.writeFile(file, updated, 'utf8');
  return { ok: true, path: file, replacements: count };
}

async function glob(workspace, args) {
  const pattern = String(args.pattern || '**/*');
  const base = path.resolve(workspace || process.cwd());
  const { execFile } = require('child_process');
  const out = await execFileAsync('git', ['ls-files', '--others', '--cached', '--exclude-standard'], base);
  // 优先用 git 文件清单（快且尊重 .gitignore），再叠加自定义 pattern 过滤
  const { minimatch } = (() => { try { return require('minimatch'); } catch { return { minimatch: null }; } })();
  let files = [];
  if (out && minimatch) {
    files = out.split('\n').filter((f) => f && minimatch(f, pattern, { dot: true, matchBase: true }));
  }
  if (!files.length) {
    // 兜底：递归扫描（忽略 node_modules/.git）
    files = await walk(base, base, pattern, 0, minimatch);
  }
  return { count: files.length, files: files.slice(0, 500) };
}

async function grep(workspace, args) {
  const pattern = String(args.pattern || '');
  if (!pattern) throw new Error('grep 需要 pattern');
  const base = path.resolve(workspace || process.cwd());
  const { execFile } = require('child_process');
  const globFilter = args.glob ? [args.glob] : [];
  const cmdArgs = ['--line-number', '--no-heading', '--color', 'never', '--', pattern, '.'];
  try {
    const out = await execFileAsync('rg', cmdArgs, base, globFilter);
    const lines = out.split('\n').filter(Boolean).slice(0, 300);
    return { count: lines.length, matches: lines };
  } catch (e) {
    if (e && e.code === 2) return { count: 0, matches: [] }; // rg 未匹配
    return { error: `rg 不可用（${e.message}），请安装 ripgrep` };
  }
}

/** 执行子进程并返回 stdout（限时、限量）。 */
function execFileAsync(cmd, args, cwd, extra) {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) { err.code = err.code || 1; err.stderr = stderr; reject(err); }
      else resolve(stdout);
    });
  });
}

async function walk(base, dir, pattern, depth, minimatch) {
  if (depth > 6) return [];
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const results = [];
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (e.isDirectory()) {
      results.push(...await walk(base, full, pattern, depth + 1, minimatch));
    } else if (!minimatch || minimatch(rel, pattern, { dot: true, matchBase: true })) {
      results.push(rel);
    }
  }
  return results;
}

module.exports = {
  list_dir: listDir,
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  glob,
  grep,
  resolveInWorkspace,
};

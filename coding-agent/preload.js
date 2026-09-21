'use strict';
/**
 * preload：通过 contextBridge 向渲染进程暴露受控 API（不暴露 Node 能力）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskCoder', {
  // 会话
  newSession: () => ipcRenderer.invoke('sessions:new'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  loadSession: (id) => ipcRenderer.invoke('sessions:load', id),
  // Agent
  sendMessage: (text) => ipcRenderer.invoke('agent:send', text),
  abort: () => ipcRenderer.invoke('agent:abort'),
  onEvent: (cb) => ipcRenderer.on('agent:event', (_e, ev) => cb(ev)),
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
});

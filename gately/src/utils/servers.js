/**
 * 服务器清单
 *
 * 一个导航页可以同时监控好几台 Gately。清单存在数据节点的 servers 键里，
 * 每张卡片用 widget:<id> 记住自己看哪一台，主窗口顶部也能切换。
 *
 * 旧版只存了一台（conn 键），读取时自动迁移成清单里的第一台，不用重填。
 */

import { normalizeHost, hostOf } from './api.js';

export const NODE = 'gately';
export const KEY_SERVERS = 'servers';
export const KEY_SETTINGS = 'settings';
export const KEY_CONN = 'conn'; // 旧版单实例配置，仅用于迁移

/** 卡片级覆盖存在 widget:<widgetId> */
export function widgetKey(widgetId) {
  return `widget:${widgetId}`;
}

export function newId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 卡片和切换条上显示的名字：用户起的名字优先，其次退回主机名 */
export function serverLabel(s) {
  const name = String(s?.name || '').trim();
  if (name) return name;
  return hostOf(s?.host) || '未命名';
}

/** 地址去掉协议，用于副标题 */
export function serverHost(s) {
  return normalizeHost(s?.host).replace(/^https?:\/\//, '');
}

/**
 * 清洗服务器清单：
 *   - 丢掉没有地址的条目；
 *   - 同一 host + token 只留第一条（重复添加不算两台机器）；
 *   - 补齐 id / name。
 */
export function normalizeServers(list) {
  const out = [];
  const seen = new Set();
  const usedIds = new Set();
  (Array.isArray(list) ? list : []).forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const host = normalizeHost(raw.host);
    if (!host) return;
    const token = String(raw.token || '').trim();
    const key = `${host}::${token}`;
    if (seen.has(key)) return;
    seen.add(key);
    // id 撞车会让两台机器在状态表里互相顶掉，撞了就重新生成
    let id = String(raw.id || '') || newId();
    if (usedIds.has(id)) id = newId();
    usedIds.add(id);
    out.push({
      id,
      name: String(raw.name || '').trim(),
      host,
      token,
    });
  });
  return out;
}

/** 旧版 conn → 清单 */
export function migrateConn(conn) {
  const host = normalizeHost(conn?.host);
  if (!host) return [];
  return [
    {
      id: newId(),
      name: hostOf(host),
      host,
      token: String(conn?.token || '').trim(),
    },
  ];
}

/**
 * 从数据节点读出完整配置。
 * 返回 { servers, settings, defaultId, migrated }，migrated 为真说明是旧版迁移来的。
 */
export async function readConfig(dn) {
  if (!dn?.getByKeys) return { servers: [], settings: null, defaultId: '', migrated: false };
  let raw = {};
  try {
    raw = (await dn.getByKeys(NODE, [KEY_SERVERS, KEY_SETTINGS, KEY_CONN])) || {};
  } catch {
    return { servers: [], settings: null, defaultId: '', migrated: false };
  }
  const settings = raw[KEY_SETTINGS] || null;
  let servers = normalizeServers(raw[KEY_SERVERS]);
  let migrated = false;
  if (!servers.length && raw[KEY_CONN]) {
    servers = migrateConn(raw[KEY_CONN]);
    migrated = servers.length > 0;
  }
  const defaultId = servers.some((s) => s.id === settings?.defaultServerId)
    ? settings.defaultServerId
    : servers[0]?.id || '';
  return { servers, settings, defaultId, migrated };
}

/** 保存清单（同时清掉旧版 conn 键，避免下次又迁移一遍） */
export async function writeServers(dn, servers) {
  if (!dn?.setByKeys) return;
  await dn.setByKeys(NODE, { [KEY_SERVERS]: servers });
  try {
    await dn.delByKey?.(NODE, KEY_CONN);
  } catch {
    /* 老版本没有 delByKey，留着也不影响：有 servers 就不会再迁移 */
  }
}

/** 读某张卡片的覆盖项 */
export async function readWidgetConfig(dn, widgetId) {
  if (!dn?.getByKey || !widgetId) return null;
  try {
    return (await dn.getByKey(NODE, widgetKey(widgetId))) || null;
  } catch {
    return null;
  }
}

export async function writeWidgetConfig(dn, widgetId, patch) {
  if (!dn?.setByKey || !widgetId) return;
  await dn.setByKey(NODE, widgetKey(widgetId), patch);
}

/** 配置保存后广播一次：同文档里的卡片收到就重读，不用重开窗口 */
export const CONFIG_EVENT = 'gately:config-saved';

export function emitConfigSaved(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail }));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

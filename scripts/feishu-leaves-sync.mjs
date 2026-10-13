/**
 * Server-side only: Feishu credentials must never be bundled with the website.
 * Wire contracts verified against the official larksuite/cli source (2026-10-12):
 * https://github.com/larksuite/cli/blob/main/shortcuts/base/record_ops.go
 * https://github.com/larksuite/cli/blob/main/shortcuts/base/recordexport/dataset.go
 * Auth: https://github.com/larksuite/cli/blob/main/internal/credential/tat_fetch.go
 * Pages deployment: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const ORIGIN = 'https://open.feishu.cn';
const ACCOUNTS_ORIGIN = 'https://accounts.feishu.cn';
const LEAVE_FIELDS = ['标题', '状态', '申请时间', '总耗时长', '姓名（示例）', '学号（示例）', '学院', '专业', '班级', '请假事由', '请假开始时间', '请假结束时间', '发布', '排序'];

// Only fixed messages are reported. Do not echo API messages, response bodies,
// request URLs, credentials, record values, or underlying fetch exceptions.
export class SyncError extends Error {
  constructor(code) { super(`Feishu sync failed (${code}); ${code === 'FILE_ROLLBACK_REQUIRED' ? 'restore site files from Git before publishing' : 'existing site content is retained'}.`); this.name = 'SyncError'; this.code = code; }
}
const fail = code => { throw new SyncError(code); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const defaultSleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function readConfig(env = process.env) {
  const keys = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_BASE_TOKEN', 'FEISHU_LEAVES_TABLE_ID'];
  for (const key of keys) if (typeof env[key] !== 'string' || !env[key].trim()) fail('MISSING_CONFIGURATION');
  for (const key of keys.slice(2)) if (!/^[A-Za-z0-9_-]+$/.test(env[key])) fail('INVALID_CONFIGURATION');
  return {
    appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET,
    baseToken: env.FEISHU_BASE_TOKEN, leavesTableId: env.FEISHU_LEAVES_TABLE_ID,
    outputDir: path.resolve(env.SITE_DIR || env.FEISHU_OUTPUT_DIR || '.')
  };
}

export function createClient(config, { fetchImpl = fetch, sleep = defaultSleep, maxRetries = 4 } = {}) {
  const sensitive = new Set([config.appId, config.appSecret]);
  let tenantToken;
  async function request(apiPath, { body, auth = true, oauth = false } = {}) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response;
      try {
        response = await fetchImpl(`${oauth ? ACCOUNTS_ORIGIN : ORIGIN}${apiPath}`, {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': oauth ? 'application/x-www-form-urlencoded' : 'application/json', ...(auth ? { Authorization: `Bearer ${tenantToken}` } : {}) },
          ...(body ? { body: oauth ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(20_000), redirect: 'error'
        });
      } catch {
        if (attempt === maxRetries) fail('NETWORK_OR_TIMEOUT');
        await sleep(Math.min(1000 * 2 ** attempt, 16_000));
        continue;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable) {
        if (attempt === maxRetries) fail(response.status === 429 ? 'RATE_LIMIT' : 'REMOTE_UNAVAILABLE');
        const retryHeader = response.headers.get('retry-after');
        const seconds = retryHeader === null ? NaN : Number(retryHeader);
        const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryHeader) - Date.now();
        await sleep(Math.min(60_000, Math.max(1000 * 2 ** attempt, Number.isFinite(requested) ? requested : 0)));
        continue;
      }
      if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'ACCESS_DENIED' : 'HTTP_ERROR');
      let payload;
      try { payload = await response.json(); } catch { fail('INVALID_JSON'); }
      if (!isObject(payload)) fail('INVALID_ENVELOPE');
      if (payload.code === 99991400) {
        if (attempt === maxRetries) fail('RATE_LIMIT');
        await sleep(Math.min(1000 * 2 ** attempt, 16_000)); continue;
      }
      if (oauth) { if (payload.error || (payload.code !== undefined && payload.code !== 0)) fail('AUTH_REJECTED'); return payload; }
      if (typeof payload.code !== 'number') fail('INVALID_ENVELOPE');
      if (payload.code !== 0) fail('API_REJECTED');
      return payload;
    }
    fail('RETRY_EXHAUSTED');
  }
  return {
    sensitive,
    async authenticate() {
      const payload = await request('/oauth/v3/token', { auth: false, oauth: true, body: { grant_type: 'client_credentials', client_id: config.appId, client_secret: config.appSecret } });
      if (typeof payload.access_token !== 'string' || !payload.access_token || typeof payload.expires_in !== 'number' || payload.expires_in <= 0) fail('INVALID_AUTH_RESPONSE');
      if (payload.token_type !== undefined && String(payload.token_type).toLowerCase() !== 'bearer') fail('UNSUPPORTED_TOKEN_TYPE');
      tenantToken = payload.access_token; sensitive.add(tenantToken);
    },
    async listPage(tableId, offset, limit) {
      if (!tenantToken) fail('NOT_AUTHENTICATED');
      const url = `/open-apis/base/v3/bases/${encodeURIComponent(config.baseToken)}/tables/${encodeURIComponent(tableId)}/records?offset=${offset}&limit=${limit}`;
      const payload = await request(url);
      if (!isObject(payload.data)) fail('INVALID_RECORD_RESPONSE');
      return payload.data;
    }
  };
}

// Base v3 is a parallel-array matrix. Named records are accepted only as a
// documented compatibility boundary for a wrapper; v3 always takes priority.
export function parsePage(data) {
  if (!isObject(data) || typeof data.has_more !== 'boolean') fail('INVALID_PAGINATION');
  for (const key of ['ignored_fields', 'record_not_found']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length > 0)) fail('INCOMPLETE_FIELDS');
  }
  let records, schema;
  if (Array.isArray(data.fields) && Array.isArray(data.data)) {
    const { fields, field_id_list: ids, field_type_list: types, record_id_list: recordIds, data: rows } = data;
    if (![fields, ids, types, recordIds].every(array => Array.isArray(array) && array.every(value => typeof value === 'string' && value.length > 0))) fail('INVALID_MATRIX');
    if (fields.length !== ids.length || fields.length !== types.length || rows.length !== recordIds.length || new Set(fields).size !== fields.length) fail('INVALID_MATRIX');
    if (typeof data.timezone !== 'string' || !data.timezone) fail('INVALID_TIMEZONE');
    schema = JSON.stringify([fields, ids, types, data.timezone]);
    records = rows.map((row, index) => {
      if (!Array.isArray(row) || row.length !== fields.length) fail('INVALID_MATRIX');
      return { record_id: recordIds[index], fields: Object.fromEntries(fields.map((field, position) => [field, row[position]])), timezone: data.timezone };
    });
  } else {
    const items = Array.isArray(data.items) ? data.items : data.records;
    if (!Array.isArray(items) || !items.every(record => isObject(record) && isObject(record.fields) && typeof record.record_id === 'string' && record.record_id)) fail('INVALID_RECORDS');
    records = items.map(record => ({ record_id: record.record_id, fields: record.fields, timezone: data.timezone || 'Asia/Shanghai' }));
    schema = 'named-records';
  }
  const total = data.total ?? data.total_count;
  if (total !== undefined && (!Number.isSafeInteger(total) || total < 0)) fail('INVALID_TOTAL');
  if (data.rev !== undefined && (!Number.isSafeInteger(data.rev) || data.rev < 0)) fail('INVALID_REVISION');
  return { records, schema, fieldNames: Array.isArray(data.fields) ? data.fields : null, hasMore: data.has_more, total, revision: data.rev };
}

export async function listAllRecords(client, tableId, { pageSize = 200, maxPages = 100, expectedFields = [] } = {}) {
  const records = [], seen = new Set();
  let schema, total, revision;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const page = parsePage(await client.listPage(tableId, records.length, pageSize));
    if (page.fieldNames && !expectedFields.every(field => page.fieldNames.includes(field))) fail('REQUIRED_COLUMN_MISSING');
    if (pageIndex === 0) { schema = page.schema; total = page.total; revision = page.revision; }
    else if (page.schema !== schema || page.total !== total || page.revision !== revision) fail('TABLE_CHANGED_DURING_SYNC');
    if (page.records.length > pageSize || (page.hasMore && !page.records.length)) fail('PAGINATION_STALLED');
    for (const record of page.records) {
      if (seen.has(record.record_id)) fail('DUPLICATE_RECORD_OR_LOOP');
      seen.add(record.record_id); records.push(record);
    }
    if (!page.hasMore) {
      if (total !== undefined && total !== records.length) fail('INCOMPLETE_PAGINATION');
      return records;
    }
  }
  fail('PAGINATION_LIMIT');
}

function text(value, { required = false, max = 6000 } = {}) {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string' || value.length > max) fail('INVALID_TEXT_FIELD');
  value = value.trim(); if (required && !value) fail('REQUIRED_FIELD_EMPTY');
  return value;
}
export function dateInShanghai(value, timezone = 'Asia/Shanghai') {
  // Matrix datetime strings without an offset use the Base timezone. This
  // database is configured for Asia/Shanghai, so accept no ambiguous zones.
  let milliseconds;
  if (typeof value === 'number' && Number.isSafeInteger(value)) milliseconds = value;
  else if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const day = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
      if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)) fail('INVALID_DATE');
    }
    if (/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/.test(value)) {
      if (!['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Hong_Kong', '+08:00'].includes(timezone)) fail('AMBIGUOUS_DATE_TIMEZONE');
      const iso = value.length === 10 ? `${value}T00:00:00` : value.replace(' ', 'T');
      milliseconds = Date.parse(`${iso}+08:00`);
      // Reject date rollover such as February 31, rather than silently changing it.
      if (Number.isFinite(milliseconds) && new Date(milliseconds + 8 * 3600_000).toISOString().slice(0, 19) !== iso) fail('INVALID_DATE');
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) milliseconds = Date.parse(value);
    else fail('INVALID_DATE');
  } else fail('INVALID_DATE');
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15 - 8 * 3600_000) fail('INVALID_DATE');
  return new Date(milliseconds + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
}

function status(value) {
  // Native Base v3 encodes even single-select values as an array of strings.
  if (Array.isArray(value)) {
    if (value.length > 1 || !value.every(item => typeof item === 'string')) fail('INVALID_STATUS');
    value = value[0];
  }
  const result = text(value, { max: 40 }) || '草稿';
  if (!['进行中', '已完成', '已批准', '已驳回', '已撤销', '草稿'].includes(result)) fail('INVALID_STATUS');
  return result;
}

export function buildPublicContent(records, sensitive = []) {
  const published = [];
  for (const record of records) {
    const fields = record.fields;
    if (!Object.hasOwn(fields, '发布')) fail('REQUIRED_COLUMN_MISSING');
    // Strings such as "true", numbers, and any unchecked value remain private.
    if (fields['发布'] !== true) continue;
    const order = fields['排序'] ?? Number.MAX_SAFE_INTEGER;
    if (typeof order !== 'number' || !Number.isFinite(order)) fail('INVALID_ORDER');
    const optionalDate = value => value === null || value === undefined || value === '' ? '' : dateInShanghai(value, record.timezone);
    published.push({
      id: `leave-${createHash('sha256').update(record.record_id).digest('hex').slice(0, 24)}`,
      title: text(fields['标题'], { required: true, max: 300 }),
      status: status(fields['状态']),
      appliedAt: dateInShanghai(fields['申请时间'], record.timezone),
      elapsed: text(fields['总耗时长'], { max: 100 }) || '—',
      order,
      details: {
        studentName: text(fields['姓名（示例）'], { max: 100 }) || '示例同学',
        studentId: text(fields['学号（示例）'], { max: 100 }) || 'DEMO0000001',
        college: text(fields['学院'], { max: 200 }) || '示例学院',
        major: text(fields['专业'], { max: 200 }) || '示例专业',
        className: text(fields['班级'], { max: 200 }) || '示例班级',
        reason: text(fields['请假事由'], { max: 6000 }) || '演示请假事由',
        startAt: optionalDate(fields['请假开始时间']),
        endAt: optionalDate(fields['请假结束时间'])
      }
    });
  }
  published.sort((a, b) => a.order - b.order || b.appliedAt.localeCompare(a.appliedAt) || a.id.localeCompare(b.id));
  const content = { schemaVersion: 1, records: published };
  const serialized = JSON.stringify(content);
  for (const secret of sensitive) if (typeof secret === 'string' && secret && serialized.includes(secret)) fail('SECRET_FOUND_IN_PUBLIC_DATA');
  return content;
}

export async function saveContent(outputDir, content) {
  const jsonPath = path.join(outputDir, 'leaves.json'), fallbackPath = path.join(outputDir, 'js', 'leaves-data.js');
  let oldJson, oldFallback;
  try { [oldJson, oldFallback] = await Promise.all([fs.readFile(jsonPath, 'utf8'), fs.readFile(fallbackPath, 'utf8')]); }
  catch { fail('EXISTING_SITE_UNREADABLE'); }
  const json = JSON.stringify(content, null, 2);
  const nextJson = `${json}\n`;
  const safeJsJson = json.replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const nextFallback = `// Generated public snapshot; synchronized with leaves.json.\nwindow.QAU_LEAVES = ${safeJsJson};\n`;
  if (oldJson === nextJson && oldFallback === nextFallback) return false;
  const suffix = `.feishu-sync-${randomUUID()}.tmp`, jsonTemp = jsonPath + suffix, fallbackTemp = fallbackPath + suffix;
  let changed = false;
  try {
    await fs.writeFile(jsonTemp, nextJson, { flag: 'wx' });
    await fs.writeFile(fallbackTemp, nextFallback, { flag: 'wx' });
    await fs.rename(fallbackTemp, fallbackPath); changed = true;
    await fs.rename(jsonTemp, jsonPath);
  } catch {
    if (changed) {
      try { await fs.writeFile(fallbackPath, oldFallback); await fs.writeFile(jsonPath, oldJson); }
      catch { fail('FILE_ROLLBACK_REQUIRED'); }
    }
    fail('FILE_UPDATE_FAILED');
  } finally {
    await Promise.all([jsonTemp, fallbackTemp].map(file => fs.rm(file, { force: true }).catch(() => {})));
  }
  return true;
}

export async function runSync({ env = process.env, fetchImpl, sleep } = {}) {
  const config = readConfig(env), client = createClient(config, { fetchImpl, sleep });
  await client.authenticate();
  const records = await listAllRecords(client, config.leavesTableId, { expectedFields: LEAVE_FIELDS });
  const content = buildPublicContent(records, client.sensitive);
  const changed = await saveContent(config.outputDir, content);
  return { changed, publishedCount: content.records.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await runSync();
    console.log(`Feishu sync succeeded: ${result.publishedCount} public leaves; ${result.changed ? 'snapshot updated' : 'no changes'}.`);
  } catch (error) {
    console.error(error instanceof SyncError ? error.message : new SyncError('UNEXPECTED_FAILURE').message);
    process.exitCode = 1;
  }
}


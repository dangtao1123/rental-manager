const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const rentalDatabase = require('./rental-db');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');
const INVITERS_FILE = path.join(DATA_DIR, 'inviters.json');
const POSTERS_FILE = path.join(DATA_DIR, 'posters.json');
const POSTER_SETTINGS_FILE = path.join(DATA_DIR, 'poster-settings.json');
const POSTER_GENERATION_EVENTS_FILE = path.join(DATA_DIR, 'poster-generation-events.json');
const ADMIN_AUTH_FILE = path.join(DATA_DIR, 'admin-auth.json');
const ADMIN_USERS_FILE = path.join(DATA_DIR, 'admin-users.json');
const REFERRAL_VISITS_FILE = path.join(DATA_DIR, 'referral-visits.json');
const REFERRAL_OPENINGS_FILE = path.join(DATA_DIR, 'referral-openings.json');
const BROKER_OPENINGS_FILE = path.join(DATA_DIR, 'broker-openings.json');
const CONTACT_SETTINGS_FILE = path.join(DATA_DIR, 'contact-settings.json');
const CONTACT_CLICKS_FILE = path.join(DATA_DIR, 'contact-clicks.json');
const CUSTOMER_CALL_RECORDS_FILE = path.join(DATA_DIR, 'customer-call-records.json');
const RENTAL_ROOMS_FILE = path.join(DATA_DIR, 'rental-rooms.json');
const RENTAL_LEASES_FILE = path.join(DATA_DIR, 'rental-leases.json');
const RENTAL_MAINTENANCE_FILE = path.join(DATA_DIR, 'rental-maintenance.json');
const RENTAL_CHECKOUTS_FILE = path.join(DATA_DIR, 'rental-checkouts.json');
const RENTAL_COSTS_FILE = path.join(DATA_DIR, 'rental-costs.json');
const RENTAL_ITEMS_FILE = path.join(DATA_DIR, 'rental-room-items.json');
const RENTAL_LEDGER_FILE = path.join(DATA_DIR, 'rental-ledger.json');
const RENTAL_RENEWALS_FILE = path.join(DATA_DIR, 'rental-renewals.json');
const RENTAL_BILLS_FILE = path.join(DATA_DIR, 'rental-bills.json');
const RENTAL_MAINTENANCE_BATCHES_FILE = path.join(DATA_DIR, 'rental-maintenance-batches.json');
const RENTAL_SETTINGS_FILE = path.join(DATA_DIR, 'rental-settings.json');
const RENTAL_MOVE_INS_FILE = path.join(DATA_DIR, 'rental-move-ins.json');
const RENTAL_FILES_DIR = path.join(DATA_DIR, 'rental-maintenance');
const POSTERS_DIR = path.join(DATA_DIR, 'posters');
const MAX_BODY_BYTES = 32 * 1024;
const MAX_RENTAL_BODY_BYTES = 16 * 1024 * 1024;
const MAX_RENTAL_IMAGE_BYTES = 3 * 1024 * 1024;
const RENTAL_FILE_URL_TTL_SECONDS = 30 * 60;
const MAX_POSTER_BODY_BYTES = 40 * 1024 * 1024;
const MAX_POSTER_BYTES = 5 * 1024 * 1024;
const MAX_POSTERS_PER_UPLOAD = 6;
const MAX_POSTER_GENERATION_EVENTS = 10_000;
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin123').replace(/[\r\n]+$/, '');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PASSWORD_HASH_BYTES = 32;
const REFERRAL_VISIT_WINDOW_MS = 30 * 60 * 1000;
const MAX_REFERRAL_VISITS = 10_000;
const MAX_REFERRAL_OPENINGS = 10_000;
const MAX_BROKER_OPENINGS = 10_000;
const MAX_CONTACT_CLICKS = 10_000;
const IP_GEOLOCATION_URL = cleanText(process.env.IP_GEOLOCATION_URL, 500);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

let writeQueue = Promise.resolve();
const recentRequests = new Map();
const recentVisitRequests = new Map();
const ipLocationCache = new Map();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('请求内容过大'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求格式不正确'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isValidAdminPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 72;
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, PASSWORD_HASH_BYTES, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt);
  return {
    algorithm: 'scrypt',
    salt,
    hash: key.toString('hex'),
    updatedAt: new Date().toISOString(),
  };
}

async function readAdminAuth() {
  try {
    const current = await fs.readFile(ADMIN_AUTH_FILE, 'utf8');
    const data = JSON.parse(current);
    if (data?.algorithm === 'scrypt' && typeof data.salt === 'string' && typeof data.hash === 'string') {
      return data;
    }
    return null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAdminAuth(auth) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = ADMIN_AUTH_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(auth, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, ADMIN_AUTH_FILE);
}

async function verifyAdminPassword(password) {
  if (typeof password !== 'string' || password.length < 1) return false;
  const saved = await readAdminAuth();
  if (!saved) {
    const suppliedBuffer = Buffer.from(password);
    const expectedBuffer = Buffer.from(ADMIN_PASSWORD);
    return suppliedBuffer.length === expectedBuffer.length
      && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
  }

  const supplied = await scryptAsync(password, saved.salt);
  const expected = Buffer.from(saved.hash, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function readAdminUsers() {
  try {
    const data = JSON.parse(await fs.readFile(ADMIN_USERS_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAdminUsers(users) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = ADMIN_USERS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(users, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, ADMIN_USERS_FILE);
}

async function verifyUserPassword(password, auth) {
  if (!auth?.salt || !auth?.hash || typeof password !== 'string') return false;
  const supplied = await scryptAsync(password, auth.salt);
  const expected = Buffer.from(auth.hash, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function getAdminUser(request) {
  const username = cleanText(request.headers['x-admin-user'] || 'admin', 40) || 'admin';
  const password = cleanText(request.headers['x-admin-password'], 128);
  if (username === 'admin' && await verifyAdminPassword(password)) return { username: 'admin', displayName: '管理员', role: 'admin' };
  const users = await readAdminUsers();
  const user = users.find((item) => item.username === username && item.enabled !== false);
  if (!user || !await verifyUserPassword(password, user.auth)) return null;
  return { username: user.username, displayName: user.displayName || user.username, role: 'user' };
}

function isValidPhone(value) {
  return /^1[3-9]\d{9}$/.test(value);
}

function isValidPersonName(value) {
  return /^[\p{L}·.]{1,20}$/u.test(value);
}

function validateApplication(input) {
  const data = {
    contactName: cleanText(input.contactName, 20),
    phone: cleanText(input.phone, 20).replace(/[\s-]/g, ''),
  };
  const errors = {};

  if (!isValidPersonName(data.contactName)) {
    errors.contactName = '请输入正确的联系人姓名';
  }
  if (!isValidPhone(data.phone)) {
    errors.phone = '请输入正确的 11 位手机号';
  }

  return { data, errors };
}

function getClientAddress(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

function normalizeIpAddress(value) {
  const address = cleanText(value, 80);
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function isPrivateIpAddress(address) {
  return address === '::1'
    || address === '127.0.0.1'
    || address.startsWith('10.')
    || address.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
    || address.startsWith('fc')
    || address.startsWith('fd')
    || address.startsWith('fe80:');
}

function isValidVisitorId(value) {
  return /^[a-zA-Z0-9-]{16,64}$/.test(value);
}

function isRateLimited(request) {
  const now = Date.now();
  const address = getClientAddress(request);
  const timestamps = (recentRequests.get(address) || []).filter((time) => now - time < 60_000);
  if (timestamps.length >= 8) return true;
  timestamps.push(now);
  recentRequests.set(address, timestamps);
  return false;
}

function isVisitRateLimited(request) {
  const now = Date.now();
  const address = getClientAddress(request);
  const timestamps = (recentVisitRequests.get(address) || []).filter((time) => now - time < 60_000);
  if (timestamps.length >= 60) return true;
  timestamps.push(now);
  recentVisitRequests.set(address, timestamps);
  return false;
}

async function persistApplication(application) {
  const operation = async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const records = await readApplications();
    records.push(application);
    await writeApplications(records);
  };

  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  return result;
}

async function readApplications() {
  try {
    const current = await fs.readFile(DATA_FILE, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeApplications(records) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = DATA_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, DATA_FILE);
}

async function readCustomerCallRecords() {
  try {
    const current = await fs.readFile(CUSTOMER_CALL_RECORDS_FILE, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeCustomerCallRecords(records) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = CUSTOMER_CALL_RECORDS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, CUSTOMER_CALL_RECORDS_FILE);
}

function normalizeCustomerCallRecord(record) {
  const fields = {};
  if (record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)) {
    Object.entries(record.fields).slice(0, 100).forEach(([key, value]) => {
      const fieldName = cleanText(key, 80);
      const values = (Array.isArray(value) ? value : [value])
        .map((item) => cleanText(item, 500)).filter(Boolean);
      if (fieldName && values.length) fields[fieldName] = values.length === 1 ? values[0] : values;
    });
  }
  const followHistory = Array.isArray(record.followHistory)
    ? record.followHistory.slice(-100).map((item) => ({
      time: cleanText(item?.time, 40),
      content: cleanText(item?.content, 2_000),
    })).filter((item) => item.content)
    : [];
  return {
    ...record,
    customerName: cleanText(record.customerName, 20),
    customerPhone: cleanText(record.customerPhone, 20),
    summary: cleanText(record.summary, 20_000),
    fields,
    status: record.status === 'invalid' ? 'invalid' : 'active',
    nextFollowUp: cleanText(record.nextFollowUp, 40),
    followHistory,
  };
}

async function handleCustomerCallRecordCreate(request, response) {
  try {
    const input = await readJsonBody(request);
    const summary = cleanText(input.summary, 20_000);
    if (!summary && input.source !== 'backend') {
      sendJson(response, 422, { ok: false, message: '请先生成客户资料' });
      return;
    }
    const record = normalizeCustomerCallRecord({
      id: crypto.randomUUID(),
      customerName: cleanText(input.customerName, 20),
      customerPhone: cleanText(input.customerPhone, 20),
      summary: summary || `客户称呼：${cleanText(input.customerName, 20) || '未填写'}；联系电话：${cleanText(input.customerPhone, 20) || '未填写'}`,
      fields: input.fields,
      status: input.status,
      nextFollowUp: input.nextFollowUp,
      followHistory: [],
      source: input.source === 'backend' ? 'backend' : 'customer-call',
      createdAt: new Date().toISOString(),
    });
    const operation = async () => {
      const records = await readCustomerCallRecords();
      records.push(record);
      await writeCustomerCallRecords(records);
    };
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    await result;
    sendJson(response, 201, { ok: true, data: record });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, { ok: false, message: '客户资料保存失败，请稍后重试' });
  }
}

async function handleCustomerCallRecords(response) {
  try {
    const records = (await readCustomerCallRecords()).map(normalizeCustomerCallRecord);
    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    sendJson(response, 200, { ok: true, data: records });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '客户记录读取失败，请稍后重试' });
  }
}

async function handleCustomerCallRecordUpdate(request, response, id) {
  try {
    const input = await readJsonBody(request);
    const operation = async () => {
      const records = await readCustomerCallRecords();
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
      const current = normalizeCustomerCallRecord(records[index]);
      const updated = normalizeCustomerCallRecord({
        ...current,
        customerName: input.customerName === undefined ? current.customerName : input.customerName,
        customerPhone: input.customerPhone === undefined ? current.customerPhone : input.customerPhone,
        summary: input.summary === undefined ? current.summary : input.summary,
        fields: input.fields === undefined ? current.fields : input.fields,
        status: input.status === undefined ? current.status : input.status,
        nextFollowUp: input.nextFollowUp === undefined ? current.nextFollowUp : input.nextFollowUp,
        updatedAt: new Date().toISOString(),
      });
      records[index] = updated;
      await writeCustomerCallRecords(records);
      return updated;
    };
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    const record = await result;
    sendJson(response, 200, { ok: true, data: record });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '客户资料更新失败，请稍后重试' });
  }
}

async function handleCustomerCallFollowUpCreate(request, response, id) {
  try {
    const input = await readJsonBody(request);
    const content = cleanText(input.content, 2_000);
    if (!content) {
      sendJson(response, 422, { ok: false, message: '请填写本次跟进内容' });
      return;
    }
    const operation = async () => {
      const records = await readCustomerCallRecords();
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
      const current = normalizeCustomerCallRecord(records[index]);
      if (current.status === 'invalid') throw Object.assign(new Error('无效客户不能新增跟进'), { statusCode: 422 });
      current.followHistory.push({
        time: cleanText(input.time, 40) || new Date().toISOString(),
        content,
      });
      current.followHistory = current.followHistory.slice(-100);
      if (input.nextFollowUp !== undefined) current.nextFollowUp = cleanText(input.nextFollowUp, 40);
      current.updatedAt = new Date().toISOString();
      records[index] = current;
      await writeCustomerCallRecords(records);
      return current;
    };
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    const record = await result;
    sendJson(response, 201, { ok: true, data: record });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '跟进记录保存失败，请稍后重试' });
  }
}

async function handleCustomerCallRecordDelete(response, id) {
  try {
    const operation = async () => {
      const records = await readCustomerCallRecords();
      const nextRecords = records.filter((record) => record.id !== id);
      if (nextRecords.length === records.length) {
        throw Object.assign(new Error('记录不存在或已经删除'), { statusCode: 404 });
      }
      await writeCustomerCallRecords(nextRecords);
    };
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    await result;
    sendJson(response, 200, { ok: true, message: '历史记录已删除' });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '删除失败，请稍后重试' });
  }
}

async function readRentalFile(file) {
  const databaseRecords = rentalDatabase.readRecords(file, DATA_DIR);
  if (databaseRecords) return databaseRecords;
  try {
    const current = await fs.readFile(file, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeRentalFile(file, records) {
  if (rentalDatabase.writeRecords(file, records, DATA_DIR)) return;
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = file + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, file);
}

function rentalText(value, max = 200) { return cleanText(value, max); }
function rentalIdCard(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  if (!text) return '';
  if (!/^(?:\d{15}|\d{17}[\dX])$/.test(text)) throw Object.assign(new Error('身份证号格式不正确，请输入15位或18位，18位末位可为X'), { statusCode: 422 });
  return text;
}
function rentalMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
}
function rentalRate(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 1000) / 1000 : 0;
}
function rentalSignedMoney(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * (10 ** digits)) / (10 ** digits) : 0;
}
function rentalDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : ''; }
function rentalId() { return crypto.randomUUID(); }
function normalizeRentalSettings(input = {}, current = {}) {
  return {
    reminderDays: Math.min(365, Math.max(0, Math.round(Number(input.reminderDays ?? current.reminderDays ?? 10) || 0))),
    propertyUnitPrice: rentalMoney(input.propertyUnitPrice ?? current.propertyUnitPrice),
    waterUnitPrice: rentalMoney(input.waterUnitPrice ?? current.waterUnitPrice),
    electricityUnitPrice: rentalRate(input.electricityUnitPrice ?? current.electricityUnitPrice),
    contractTemplateFile: normalizeRentalFileUrl(input.contractTemplateFile ?? current.contractTemplateFile),
    contractTemplateName: rentalText(input.contractTemplateName ?? current.contractTemplateName, 160),
    contractTemplateUpdatedAt: input.contractTemplateUpdatedAt ?? current.contractTemplateUpdatedAt ?? '',
    updatedAt: new Date().toISOString(),
  };
}
async function readRentalSettings() {
  const databaseSettings = rentalDatabase.readSettings(DATA_DIR);
  if (databaseSettings) return normalizeRentalSettings(databaseSettings);
  try { return normalizeRentalSettings(JSON.parse(await fs.readFile(RENTAL_SETTINGS_FILE, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return normalizeRentalSettings(); throw error; }
}
async function writeRentalSettings(settings) {
  if (rentalDatabase.writeSettings(DATA_DIR, settings)) return;
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  await fs.writeFile(RENTAL_SETTINGS_FILE, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o640 });
}
function rentalMonthCount(start, end) {
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || last < first) return 0;
  return Math.max(1, Math.round((last - first) / (30 * 86400000)));
}
function rentalLeaseTotal(lease) {
  const rent = rentalMoney(lease.monthlyRent);
  const propertyFee = rentalMoney(lease.monthlyPropertyFee);
  const months = Math.max(1, Number(lease.months) || rentalMonthCount(lease.startDate, lease.endDate) || 1);
  return { months, rentTotal: Math.round(rent * months * 100) / 100, propertyFeeTotal: Math.round(propertyFee * months * 100) / 100, total: Math.round((rent + propertyFee) * months * 100) / 100 };
}
async function saveRentalImage(value, prefix = 'maintenance') {
  if (typeof value !== 'string' || !value) return '';
  if (!value.startsWith('data:')) return normalizeRentalFileUrl(value);
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error('维护图片格式不支持，请上传 JPG、PNG 或 WebP 图片'), { statusCode: 422 });
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_RENTAL_IMAGE_BYTES) throw Object.assign(new Error('单张图片不能超过 3MB'), { statusCode: 413 });
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].slice(6);
  await fs.mkdir(RENTAL_FILES_DIR, { recursive: true, mode: 0o750 });
  const filename = `${prefix}-${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(RENTAL_FILES_DIR, filename), buffer, { mode: 0o640 });
  return `/api/zufang/files/${filename}`;
}
async function saveRentalContract(value) {
  if (typeof value !== 'string' || !value) return '';
  if (!value.startsWith('data:')) return normalizeRentalFileUrl(value);
  const match = value.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error('托管合同仅支持 PDF 文件'), { statusCode: 422 });
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw Object.assign(new Error('托管合同 PDF 不能超过 10MB'), { statusCode: 413 });
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw Object.assign(new Error('托管合同 PDF 文件无效'), { statusCode: 422 });
  await fs.mkdir(RENTAL_FILES_DIR, { recursive: true, mode: 0o750 });
  const filename = `landlord-contract-${crypto.randomUUID()}.pdf`;
  await fs.writeFile(path.join(RENTAL_FILES_DIR, filename), buffer, { mode: 0o640 });
  return `/api/zufang/files/${filename}`;
}
function decodeRentalDataFile(value, allowedMimes, label, maxBytes = 12 * 1024 * 1024) {
  if (typeof value !== 'string' || !value) return null;
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !allowedMimes.includes(match[1])) throw Object.assign(new Error(`${label}格式不受支持`), { statusCode: 422 });
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > maxBytes) throw Object.assign(new Error(`${label}不能超过${Math.round(maxBytes / 1024 / 1024)}MB`), { statusCode: 413 });
  return { mime: match[1], buffer };
}
async function saveRentalDocument(value, prefix = 'move-in-document') {
  if (typeof value !== 'string' || !value) return '';
  if (!value.startsWith('data:')) return normalizeRentalFileUrl(value);
  const decoded = decodeRentalDataFile(value, ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'], '合同文件');
  if (!decoded) return '';
  const extension = decoded.mime === 'application/pdf' ? 'pdf' : 'docx';
  if (extension === 'pdf' && decoded.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw Object.assign(new Error('PDF合同文件无效'), { statusCode: 422 });
  if (extension === 'docx' && decoded.buffer.subarray(0, 2).toString('ascii') !== 'PK') throw Object.assign(new Error('上传的文件不是有效的 Word .docx 文件，请不要上传 .doc、图片或仅修改扩展名的文件'), { statusCode: 422 });
  await fs.mkdir(RENTAL_FILES_DIR, { recursive: true, mode: 0o750 });
  const filename = `${prefix}-${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(RENTAL_FILES_DIR, filename), decoded.buffer, { mode: 0o640 });
  return `/api/zufang/files/${filename}`;
}
function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}
function zipEntries(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw Object.assign(new Error('合同模板不是有效的DOCX文件'), { statusCode: 422 });
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw Object.assign(new Error('合同模板压缩结构无效'), { statusCode: 422 });
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const compressed = buffer.subarray(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw Object.assign(new Error('合同模板使用了不支持的压缩方式'), { statusCode: 422 });
    entries.push({ name, data, method });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function fillDocxTemplate(buffer, fields) {
  const entries = zipEntries(buffer);
  const replacements = Object.fromEntries(Object.entries(fields).map(([key, value]) => [`{{${key}}}`, xmlEscape(value)]));
  let replaced = 0;
  const updated = entries.map((entry) => {
    if (!/^word\/(?:document|header\d+|footer\d+)\.xml$/.test(entry.name)) return entry;
    let xml = entry.data.toString('utf8');
    for (const [token, value] of Object.entries(replacements)) {
      if (xml.includes(token)) { xml = xml.split(token).join(value); replaced += 1; }
    }
    return { ...entry, data: Buffer.from(xml), method: 8 };
  });
  if (!replaced) throw Object.assign(new Error('模板中未找到可填充字段，请在Word中使用 {{tenantName}}、{{tenantIdCard}} 这类占位符'), { statusCode: 422 });
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of updated) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = entry.method === 8 ? zlib.deflateRawSync(entry.data) : entry.data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6); header.writeUInt16LE(entry.method, 8);
    header.writeUInt32LE(crc32(entry.data), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(entry.data.length, 22); header.writeUInt16LE(name.length, 26); header.writeUInt16LE(0, 28);
    const local = Buffer.concat([header, name, compressed]); locals.push(local);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(entry.method, 10); central.writeUInt32LE(crc32(entry.data), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42); centrals.push(Buffer.concat([central, name]));
    offset += local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(updated.length, 8); eocd.writeUInt16LE(updated.length, 10); eocd.writeUInt32LE(centralDirectory.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}
function rentalFilenameFromUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const parsed = new URL(value, 'http://rental.local');
    const match = parsed.pathname.match(/^\/(?:loan\/)?api\/zufang\/files\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}
function normalizeRentalFileUrl(value) {
  const filename = rentalFilenameFromUrl(value);
  return filename ? `/api/zufang/files/${encodeURIComponent(filename)}` : rentalText(value, 500);
}
function normalizeRentalHttpUrl(value) {
  const text = rentalText(value, 1000);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}
function rentalDownloadFilename(name, extension) {
  const base = rentalText(name, 160).replace(/[\\/:*?"<>|\r\n]+/g, '').trim();
  return `${base || '租房文件'}${extension}`;
}
function encodeRFC5987ValueChars(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function signRentalFileUrl(value, now = Date.now(), downloadName = '') {
  const filename = rentalFilenameFromUrl(value);
  if (!filename) return value;
  const expires = Math.floor(now / 1000) + RENTAL_FILE_URL_TTL_SECONDS;
  const signature = crypto.createHmac('sha256', ADMIN_PASSWORD).update(`${filename}:${expires}`).digest('hex');
  const download = downloadName ? `&download=${encodeURIComponent(downloadName)}` : '';
  return `../api/zufang/files/${encodeURIComponent(filename)}?expires=${expires}&signature=${signature}${download}`;
}
function withSignedRentalFiles(type, record, now = Date.now()) {
  const signed = { ...record };
  const singleFields = type === 'rooms'
    ? ['landlordContractFile']
    : type === 'leases'
    ? ['idCardFront', 'idCardBack']
    : type === 'items'
      ? ['image']
      : type === 'maintenance'
        ? ['beforeImage', 'afterImage', 'paymentProof']
        : type === 'move-ins'
          ? ['idCardFront', 'idCardBack', 'generatedContractFile', 'signedContractFile']
        : [];
  for (const field of singleFields) {
    if (signed[field]) signed[field] = signRentalFileUrl(
      signed[field],
      now,
      field === 'generatedContractFile'
        ? (signed.generatedContractName || rentalDownloadFilename([signed.propertyName || '', signed.roomNo || '', signed.tenantName || '', '租赁合同'].filter(Boolean).join('-'), '.docx'))
        : ''
    );
  }
  if (Array.isArray(signed.images)) signed.images = signed.images.map((item) => signRentalFileUrl(item, now));
  return signed;
}
function buildRentalReimbursementReport(maintenanceRecords, rooms, now = Date.now()) {
  const roomById = new Map(rooms.filter((room) => room.id).map((room) => [room.id, room]));
  const activeRoomsByNo = new Map(rooms.filter((room) => !room.archivedAt && room.roomNo).map((room) => [room.roomNo, room]));
  const typeLabels = { new: '新增物品', remove: '删除物品', repair: '房间日常维护' };
  const rows = maintenanceRecords
    .filter((item) => !item.archivedAt && item.status === 'done')
    .sort((a, b) => String(b.maintenanceDate || '').localeCompare(String(a.maintenanceDate || '')) || String(b.completedAt || '').localeCompare(String(a.completedAt || '')))
    .map((item) => {
      const room = (item.roomId && roomById.get(item.roomId)) || activeRoomsByNo.get(item.roomNo) || {};
      const signed = withSignedRentalFiles('maintenance', item, now);
      return {
        id: signed.id,
        propertyName: room.propertyName || signed.propertyName || '',
        roomNo: signed.roomNo || room.roomNo || '',
        roomLabel: [room.propertyName || signed.propertyName || '', signed.roomNo || room.roomNo || ''].filter(Boolean).join(' · '),
        maintenanceDate: signed.maintenanceDate || '',
        maintenanceType: signed.maintenanceType || 'repair',
        maintenanceTypeLabel: typeLabels[signed.maintenanceType] || '房间日常维护',
        item: signed.item || '',
        note: signed.note || '',
        amount: Number(signed.amount || 0),
        completedAt: signed.completedAt || '',
        beforeImage: signed.beforeImage || '',
        afterImage: signed.afterImage || '',
        paymentProof: signed.paymentProof || '',
      };
    });
  return {
    generatedAt: new Date(now).toISOString(),
    count: rows.length,
    totalAmount: Math.round(rows.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 100) / 100,
    rows,
  };
}
function hasValidRentalFileSignature(filename, expiresValue, signatureValue, now = Date.now()) {
  const expires = Number(expiresValue);
  if (!Number.isInteger(expires) || expires < Math.floor(now / 1000) || expires > Math.floor(now / 1000) + RENTAL_FILE_URL_TTL_SECONDS + 60) return false;
  if (!/^[0-9a-f]{64}$/.test(String(signatureValue || ''))) return false;
  const expected = crypto.createHmac('sha256', ADMIN_PASSWORD).update(`${filename}:${expires}`).digest('hex');
  const supplied = Buffer.from(String(signatureValue), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return supplied.length === expectedBuffer.length && crypto.timingSafeEqual(supplied, expectedBuffer);
}
async function prepareRentalInput(type, input) {
  if (type === 'rooms') {
    const prepared = { ...input };
    if (Array.isArray(input.images)) {
      const existing = input.images.filter((item) => typeof item === 'string' && !item.startsWith('data:image/')).slice(0, 20).map(normalizeRentalFileUrl);
      const uploads = input.images.filter((item) => typeof item === 'string' && item.startsWith('data:image/')).slice(0, 10);
      prepared.images = [...existing, ...await Promise.all(uploads.map((item) => saveRentalImage(item, 'room')))].slice(-20);
    }
    if (typeof input.landlordContractFile === 'string' && input.landlordContractFile.startsWith('data:')) {
      prepared.landlordContractFile = await saveRentalContract(input.landlordContractFile);
    } else if (Object.hasOwn(input, 'landlordContractFile')) {
      prepared.landlordContractFile = normalizeRentalFileUrl(input.landlordContractFile);
    }
    return prepared;
  }
  if (type === 'leases') {
    const prepared = { ...input };
    for (const key of ['idCardFront', 'idCardBack']) {
      if (input[key]?.startsWith('data:image/')) prepared[key] = await saveRentalImage(input[key], `id-card-${key === 'idCardFront' ? 'front' : 'back'}`);
      else delete prepared[key];
    }
    return prepared;
  }
  if (type === 'items') {
    const prepared = { ...input };
    if (input.image?.startsWith('data:image/')) prepared.image = await saveRentalImage(input.image, 'item');
    else if (input.image) prepared.image = normalizeRentalFileUrl(input.image);
    else delete prepared.image;
    return prepared;
  }
  if (type === 'move-ins') {
    const prepared = { ...input };
    for (const key of ['idCardFront', 'idCardBack']) {
      if (input[key]?.startsWith('data:image/')) prepared[key] = await saveRentalImage(input[key], `move-in-${key === 'idCardFront' ? 'front' : 'back'}`);
      else if (Object.hasOwn(input, key)) prepared[key] = normalizeRentalFileUrl(input[key]);
    }
    if (input.signedContractData?.startsWith('data:')) prepared.signedContractFile = await saveRentalDocument(input.signedContractData, 'move-in-signed');
    delete prepared.signedContractData;
    return prepared;
  }
  if (type !== 'maintenance') return input;
  const prepared = { ...input };
  for (const key of ['beforeImage', 'afterImage', 'paymentProof']) {
    if (input[key]) prepared[key] = await saveRentalImage(input[key]);
    else if (Object.hasOwn(input, key)) prepared[key] = '';
    else delete prepared[key];
  }
  if (Array.isArray(input.images) && input.images.length) prepared.images = await Promise.all(input.images.slice(0, 8).map((item) => saveRentalImage(item)));
  else delete prepared.images;
  return prepared;
}
function normalizeRentalRoom(input, current = {}) {
  const area = rentalMoney(input.area ?? current.area);
  const propertyUnitPrice = rentalMoney(input.propertyUnitPrice ?? current.propertyUnitPrice);
  const suppliedFee = input.monthlyPropertyFee ?? current.monthlyPropertyFee;
  const annualInput = input.landlordAnnualRent ?? current.landlordAnnualRent;
  const legacyMonthly = input.landlordMonthlyRent ?? current.landlordMonthlyRent;
  const annualRent = annualInput === undefined || annualInput === '' ? Math.round(rentalMoney(legacyMonthly) * 12 * 100) / 100 : rentalMoney(annualInput);
  const propertyFeeModeInput = input.propertyFeeMode ?? current.propertyFeeMode;
  const propertyFeeMode = ['tenant_self', 'included'].includes(propertyFeeModeInput)
    ? propertyFeeModeInput
    : (current.monthlyPropertyFee > 0 || suppliedFee > 0 ? 'included' : 'tenant_self');
  const requestedStatus = input.status ?? current.status;
  const status = ['maintenance', 'occupied'].includes(requestedStatus) ? requestedStatus : 'vacant';
  const contractTypeInput = input.landlordContractType ?? current.landlordContractType;
  const landlordContractType = ['paper', 'electronic'].includes(contractTypeInput) ? contractTypeInput : '';
  const landlordContractFile = landlordContractType === 'paper' ? normalizeRentalFileUrl(input.landlordContractFile ?? current.landlordContractFile) : '';
  const landlordContractUrl = landlordContractType === 'electronic' ? normalizeRentalHttpUrl(input.landlordContractUrl ?? current.landlordContractUrl) : '';
  return { ...current, id: current.id || rentalId(), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), propertyName: rentalText(input.propertyName ?? current.propertyName, 80), status, area, propertyUnitPrice, propertyFeeMode, monthlyPropertyFee: suppliedFee === undefined || suppliedFee === '' ? Math.round(area * propertyUnitPrice * 100) / 100 : rentalMoney(suppliedFee), images: Array.isArray(input.images) ? input.images.slice(0, 20).map((item) => rentalText(item, 500)) : (current.images || []), landlordLeaseStart: rentalDate(input.landlordLeaseStart ?? current.landlordLeaseStart), landlordLeaseEnd: rentalDate(input.landlordLeaseEnd ?? current.landlordLeaseEnd), landlordAnnualRent: annualRent, landlordMonthlyRent: Math.round(annualRent / 12 * 100) / 100, landlordAnnualCost: annualRent, landlordContractType, landlordContractFile, landlordContractUrl, note: rentalText(input.note ?? current.note, 500), updatedAt: new Date().toISOString(), createdAt: current.createdAt || new Date().toISOString() };
}
function normalizeRentalLease(input, current = {}) {
  const reminderInput = input.reminderEnabled ?? current.reminderEnabled;
  const cycleInput = input.paymentMethod ?? input.billingCycle ?? current.paymentMethod ?? current.billingCycle;
  const cycleMap = { '月付': 'monthly', '季付': 'quarterly', '年付': 'yearly' };
  const billingCycle = ['monthly', 'quarterly', 'yearly'].includes(cycleInput) ? cycleInput : (cycleMap[cycleInput] || 'monthly');
  const leaseStatus = input.status === undefined ? (current.status || 'active') : (input.status === 'ended' ? 'ended' : 'active');
  const propertyFeeMode = ['tenant_self', 'included'].includes(input.propertyFeeMode ?? current.propertyFeeMode) ? (input.propertyFeeMode ?? current.propertyFeeMode) : 'included';
  const depositStatusInput = input.depositStatus ?? current.depositStatus;
  const depositStatus = ['pending', 'refunded'].includes(depositStatusInput) ? depositStatusInput : (leaseStatus === 'ended' ? 'pending' : '');
  const lease = { ...current, id: current.id || input.id || rentalId(), roomId: rentalText(input.roomId ?? current.roomId, 80), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), tenantName: rentalText(input.tenantName ?? current.tenantName, 30), tenantPhone: rentalText(input.tenantPhone ?? current.tenantPhone, 30), tenantIdCard: rentalIdCard(input.tenantIdCard ?? current.tenantIdCard), purpose: rentalText(input.purpose ?? current.purpose, 40), paymentMethod: billingCycle, propertyFeeMode, monthlyRent: rentalMoney(input.monthlyRent ?? current.monthlyRent), monthlyPropertyFee: rentalMoney(input.monthlyPropertyFee ?? current.monthlyPropertyFee), deposit: rentalMoney(input.deposit ?? current.deposit), startDate: rentalDate(input.startDate ?? current.startDate), endDate: rentalDate(input.endDate ?? current.endDate), paidThrough: rentalDate(input.paidThrough ?? current.paidThrough), reminderEnabled: true, moveInElectricity: rentalMoney(input.moveInElectricity ?? current.moveInElectricity), moveInWater: rentalMoney(input.moveInWater ?? current.moveInWater), status: leaseStatus, depositStatus, depositRefundedAt: rentalText(input.depositRefundedAt ?? current.depositRefundedAt, 40), depositRefundAmount: rentalMoney(input.depositRefundAmount ?? current.depositRefundAmount), note: rentalText(input.note ?? current.note, 500), updatedAt: new Date().toISOString(), createdAt: current.createdAt || input.createdAt || new Date().toISOString() };
  lease.idCardFront = rentalText(input.idCardFront ?? current.idCardFront, 500);
  lease.idCardBack = rentalText(input.idCardBack ?? current.idCardBack, 500);
  lease.billingCycle = billingCycle;
  lease.contractNo = rentalText(input.contractNo ?? current.contractNo, 80);
  lease.contractStatus = ['draft', 'active', 'expired', 'terminated'].includes(input.contractStatus ?? current.contractStatus)
    ? (input.contractStatus ?? current.contractStatus)
    : 'active';
  lease.contractFileUrl = rentalText(input.contractFileUrl ?? current.contractFileUrl, 500);
  return { ...lease, ...rentalLeaseTotal(lease) };
}
function rentalAuditDetails(resource, record = {}, previous = null, action = '') {
  const fieldNames = {
    rooms: { propertyName: '小区', roomNo: '房间号', status: '状态', area: '面积', propertyUnitPrice: '物业费单价', monthlyPropertyFee: '每月物业费', landlordLeaseStart: '托管开始', landlordLeaseEnd: '托管结束', landlordAnnualRent: '房东年租', landlordContractType: '托管合同类型', landlordContractFile: '纸质托管合同', landlordContractUrl: '电子托管合同地址', images: '房间照片' },
    leases: { roomNo: '房间号', tenantName: '租户姓名', tenantPhone: '租户电话', tenantIdCard: '身份证号', purpose: '住房目的', paymentMethod: '支付方式', propertyFeeMode: '物业费方式', monthlyRent: '月租金', monthlyPropertyFee: '每月物业费', deposit: '押金', depositStatus: '押金状态', depositRefundAmount: '退还押金', startDate: '入住时间', endDate: '合同结束', paidThrough: '已付至', moveInWater: '入住水表', moveInElectricity: '入住电表' },
    renewals: { roomNo: '房间号', tenantName: '租户姓名', renewalDate: '续费日期', durationValue: '续费时长', monthlyRent: '月租金', monthlyPropertyFee: '物业费', amount: '续费金额', endDate: '续费后到期' },
    maintenance: { roomNo: '房间号', maintenanceDate: '维护日期', maintenanceType: '维护类型', item: '维护事项', amount: '金额', status: '状态', reimbursementBatchId: '报销批次', completedAt: '完成时间', reimbursedAt: '报销时间', note: '备注' },
    checkouts: { roomNo: '房间号', tenantName: '租户姓名', checkoutDate: '退房日期', totalDeduction: '扣费合计', refundAmount: '应退押金', waterAmount: '水费扣除', electricityAmount: '电费扣除', propertyAmount: '物业费扣除' },
    costs: { roomNo: '房间号', costDate: '费用日期', costType: '费用类型', amount: '金额', period: '所属周期', note: '备注' },
    items: { roomNo: '房间号', name: '物品名称', note: '备注' },
    ledger: { roomNo: '房间号', direction: '收支方向', category: '收支分类', amount: '金额', recordDate: '发生日期', note: '备注' },
    bills: { roomNo: '房间号', tenantName: '租户姓名', periodStart: '账期开始', periodEnd: '账期结束', total: '应收金额', paidAmount: '已收金额', status: '账单状态' },
    settings: { reminderDays: '到期提醒天数', propertyUnitPrice: '物业费单价', waterUnitPrice: '水费单价', electricityUnitPrice: '电费单价' },
    users: { username: '账号', displayName: '名称', enabled: '状态' },
  }[resource] || {};
  const snapshot = (value) => Object.fromEntries(Object.entries(fieldNames).map(([key, label]) => [label, value?.[key]]).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  const after = snapshot(record);
  if (action === 'update' && previous) {
    const before = snapshot(previous);
    const changes = {};
    for (const label of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (String(before[label] ?? '') !== String(after[label] ?? '')) changes[label] = { before: before[label] ?? '', after: after[label] ?? '' };
    }
    return { summary: `${resource}记录已修改`, changes };
  }
  return { summary: action === 'archive' ? `${resource}记录已归档` : action === 'purge' ? `${resource}归档记录已彻底删除` : `${resource}记录已${action === 'create' ? '新增' : '更新'}`, fields: after };
}
function normalizeRentalMaintenance(input, current = {}) {
  const images = Array.isArray(input.images) ? input.images.slice(0, 8).map((item) => rentalText(item, 500)) : (current.images || []);
  const maintenanceType = ['new', 'remove', 'repair'].includes(input.maintenanceType ?? current.maintenanceType) ? (input.maintenanceType ?? current.maintenanceType) : 'repair';
  const status = ['pending', 'done', 'reimbursed'].includes(input.status ?? current.status) ? (input.status ?? current.status) : 'pending';
  return { ...current, id: current.id || rentalId(), roomId: rentalText(input.roomId ?? current.roomId, 80), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), maintenanceType, amount: rentalMoney(input.amount ?? current.amount), item: rentalText(input.item ?? current.item, 80), note: rentalText(input.note ?? current.note, 2_000), beforeImage: rentalText(input.beforeImage ?? current.beforeImage, 500), afterImage: rentalText(input.afterImage ?? current.afterImage, 500), paymentProof: rentalText(input.paymentProof ?? current.paymentProof, 500), images, status, maintenanceDate: rentalDate(input.maintenanceDate ?? current.maintenanceDate) || new Date().toISOString().slice(0, 10), reimbursementBatchId: rentalText(input.reimbursementBatchId ?? current.reimbursementBatchId, 80), completedAt: status === 'pending' ? '' : (input.completedAt ?? current.completedAt ?? new Date().toISOString()), reimbursedAt: status === 'reimbursed' ? (input.reimbursedAt ?? current.reimbursedAt ?? new Date().toISOString()) : '', createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function normalizeRentalMaintenanceBatch(input, current = {}) {
  return {
    ...current,
    id: current.id || rentalId(),
    name: rentalText(input.name ?? current.name, 80) || '未命名批次',
    note: rentalText(input.note ?? current.note, 500),
    createdAt: current.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
function normalizeRentalCost(input, current = {}) {
  const types = ['water', 'electricity', 'property', 'other'];
  return { ...current, id: current.id || rentalId(), roomId: rentalText(input.roomId ?? current.roomId, 80), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), costType: types.includes(input.costType ?? current.costType) ? (input.costType ?? current.costType) : 'other', amount: rentalMoney(input.amount ?? current.amount), costDate: rentalDate(input.costDate ?? current.costDate) || new Date().toISOString().slice(0, 10), period: rentalText(input.period ?? current.period, 30), note: rentalText(input.note ?? current.note, 1_000), createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function normalizeRentalItem(input, current = {}) {
  return { ...current, id: current.id || rentalId(), roomId: rentalText(input.roomId ?? current.roomId, 80), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), name: rentalText(input.name ?? current.name, 100), quantity: Math.max(1, Math.trunc(Number(input.quantity ?? current.quantity) || 1)), note: rentalText(input.note ?? current.note, 500), image: normalizeRentalFileUrl(input.image ?? current.image), createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function rentalItemMaintenanceInput(item, maintenanceType, now = new Date()) {
  const action = maintenanceType === 'remove' ? '删除' : '新增';
  const quantity = Math.max(1, Math.trunc(Number(item.quantity || 1) || 1));
  return {
    roomId: item.roomId,
    roomNo: item.roomNo,
    maintenanceType: maintenanceType === 'remove' ? 'remove' : 'new',
    item: item.name,
    amount: 0,
    status: 'done',
    maintenanceDate: getChinaDate(now),
    note: `物品清单${action}：${item.note || item.name}${quantity > 1 ? ` ×${quantity}` : ''}`,
  };
}
async function appendRentalItemMaintenance(item, maintenanceType) {
  const maintenance = await readRentalFile(RENTAL_MAINTENANCE_FILE);
  maintenance.unshift(normalizeRentalMaintenance(rentalItemMaintenanceInput(item, maintenanceType)));
  await writeRentalFile(RENTAL_MAINTENANCE_FILE, maintenance);
}
function buildRentalMaintenanceBatchList(batches, maintenanceRecords, now = Date.now()) {
  const stats = new Map();
  for (const item of maintenanceRecords.filter((record) => !record.archivedAt && record.reimbursementBatchId)) {
    const current = stats.get(item.reimbursementBatchId) || { count: 0, totalAmount: 0, latestAt: '' };
    current.count += 1;
    current.totalAmount = Math.round((current.totalAmount + Number(item.amount || 0)) * 100) / 100;
    if (String(item.updatedAt || item.completedAt || item.createdAt || '') > String(current.latestAt || '')) current.latestAt = item.updatedAt || item.completedAt || item.createdAt || '';
    stats.set(item.reimbursementBatchId, current);
  }
  return batches
    .filter((batch) => !batch.archivedAt)
    .map((batch) => {
      const info = stats.get(batch.id) || { count: 0, totalAmount: 0, latestAt: '' };
      return {
        ...batch,
        count: info.count,
        totalAmount: info.totalAmount,
        latestAt: info.latestAt,
        updatedAt: batch.updatedAt || batch.createdAt || new Date(now).toISOString(),
      };
    })
    .sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')));
}
function buildRentalMaintenanceBatchReport(maintenanceRecords, rooms, batches, batchId, now = Date.now()) {
  const batch = batches.find((item) => item.id === batchId && !item.archivedAt);
  if (!batch) throw Object.assign(new Error('报销批次不存在'), { statusCode: 404 });
  const roomById = new Map(rooms.filter((room) => room.id).map((room) => [room.id, room]));
  const activeRoomsByNo = new Map(rooms.filter((room) => !room.archivedAt && room.roomNo).map((room) => [room.roomNo, room]));
  const typeLabels = { new: '新增物品', remove: '删除物品', repair: '房间日常维护' };
  const rows = maintenanceRecords
    .filter((item) => !item.archivedAt && item.reimbursementBatchId === batchId)
    .sort((a, b) => String(b.maintenanceDate || '').localeCompare(String(a.maintenanceDate || '')) || String(b.completedAt || '').localeCompare(String(a.completedAt || '')))
    .map((item) => {
      const room = (item.roomId && roomById.get(item.roomId)) || activeRoomsByNo.get(item.roomNo) || {};
      const signed = withSignedRentalFiles('maintenance', item, now);
      return {
        id: signed.id,
        propertyName: room.propertyName || signed.propertyName || '',
        roomNo: signed.roomNo || room.roomNo || '',
        roomLabel: [room.propertyName || signed.propertyName || '', signed.roomNo || room.roomNo || ''].filter(Boolean).join(' · '),
        maintenanceDate: signed.maintenanceDate || '',
        maintenanceType: signed.maintenanceType || 'repair',
        maintenanceTypeLabel: typeLabels[signed.maintenanceType] || '房间日常维护',
        item: signed.item || '',
        note: signed.note || '',
        amount: Number(signed.amount || 0),
        status: signed.status || 'done',
        completedAt: signed.completedAt || '',
        beforeImage: signed.beforeImage || '',
        afterImage: signed.afterImage || '',
        paymentProof: signed.paymentProof || '',
      };
    });
  return {
    generatedAt: new Date(now).toISOString(),
    batch: { id: batch.id, name: batch.name || '未命名批次', note: batch.note || '', createdAt: batch.createdAt || '', updatedAt: batch.updatedAt || '' },
    count: rows.length,
    totalAmount: Math.round(rows.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 100) / 100,
    rows,
  };
}
function normalizeRentalLedger(input, current = {}) {
  const directions = ['income', 'expense'];
  const categories = ['rent', 'otherIncome', 'landlordRent', 'maintenance', 'depositRefund', 'otherExpense'];
  const direction = directions.includes(input.direction ?? current.direction) ? (input.direction ?? current.direction) : 'income';
  const fallbackCategory = direction === 'income' ? 'rent' : 'otherExpense';
  const category = categories.includes(input.category ?? current.category) ? (input.category ?? current.category) : fallbackCategory;
  return { ...current, id: current.id || rentalId(), direction, category, roomId: rentalText(input.roomId ?? current.roomId, 80), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), amount: rentalMoney(input.amount ?? current.amount), recordDate: rentalDate(input.recordDate ?? current.recordDate) || new Date().toISOString().slice(0, 10), note: rentalText(input.note ?? current.note, 1_000), sourceType: rentalText(input.sourceType ?? current.sourceType, 30), sourceId: rentalText(input.sourceId ?? current.sourceId, 80), createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function normalizeRentalBill(input, current = {}) {
  const status = ['planned', 'partial', 'paid', 'overdue', 'void'].includes(input.status ?? current.status)
    ? (input.status ?? current.status)
    : 'planned';
  const rent = rentalMoney(input.rent ?? current.rent);
  const propertyFee = rentalMoney(input.propertyFee ?? current.propertyFee);
  const total = Math.round((rent + propertyFee) * 100) / 100;
  const paidAmount = Math.min(total, rentalMoney(input.paidAmount ?? current.paidAmount));
  return { ...current, id: current.id || rentalId(), leaseId: rentalText(input.leaseId ?? current.leaseId, 80), roomId: rentalText(input.roomId ?? current.roomId, 80), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), tenantName: rentalText(input.tenantName ?? current.tenantName, 30), periodStart: rentalDate(input.periodStart ?? current.periodStart), periodEnd: rentalDate(input.periodEnd ?? current.periodEnd), dueDate: rentalDate(input.dueDate ?? current.dueDate), rent, propertyFee, total, paidAmount, status, note: rentalText(input.note ?? current.note, 500), createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function normalizeRentalRenewal(input, current = {}) {
  return { ...current, id: current.id || rentalId(), leaseId: rentalText(input.leaseId ?? current.leaseId, 80), roomId: rentalText(input.roomId ?? current.roomId, 80), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), tenantName: rentalText(input.tenantName ?? current.tenantName, 30), tenantPhone: rentalText(input.tenantPhone ?? current.tenantPhone, 30), renewalDate: rentalDate(input.renewalDate ?? current.renewalDate) || new Date().toISOString().slice(0, 10), startDate: rentalDate(input.startDate ?? current.startDate), endDate: rentalDate(input.endDate ?? current.endDate), durationUnit: input.durationUnit === 'days' ? 'days' : 'months', durationValue: Math.max(1, Number(input.durationValue ?? current.durationValue) || 1), monthlyRent: rentalMoney(input.monthlyRent ?? current.monthlyRent), monthlyPropertyFee: rentalMoney(input.monthlyPropertyFee ?? current.monthlyPropertyFee), deposit: rentalMoney(input.deposit ?? current.deposit), amount: rentalMoney(input.amount ?? current.amount), paymentType: input.paymentType === 'initial' ? 'initial' : (current.paymentType || 'renewal'), paymentMethod: rentalText(input.paymentMethod ?? current.paymentMethod, 20), note: rentalText(input.note ?? current.note, 500), createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function normalizeRentalCheckout(input, current = {}) {
  const status = input.status === 'draft' ? 'draft' : 'completed';
  const waterAmount = rentalMoney(input.waterAmount ?? current.waterAmount);
  const electricityAmount = rentalSignedMoney(input.electricityAmount ?? current.electricityAmount, 1);
  let suppliedOtherItems = input.otherItems;
  if (typeof suppliedOtherItems === 'string') { try { suppliedOtherItems = JSON.parse(suppliedOtherItems); } catch { suppliedOtherItems = []; } }
  const otherItems = Array.isArray(suppliedOtherItems) ? suppliedOtherItems.slice(0, 30).map((item) => ({ item: rentalText(item.item, 120), amount: rentalMoney(item.amount), mode: item.mode === 'refund' ? 'refund' : 'deduct' })).filter((item) => item.item || item.amount > 0) : (Array.isArray(current.otherItems) ? current.otherItems : []);
  const otherAmount = Math.round(otherItems.reduce((sum, item) => sum + (item.mode === 'refund' ? -Number(item.amount || 0) : Number(item.amount || 0)), 0) * 100) / 100;
  const totalDeduction = Math.round((waterAmount + electricityAmount + otherAmount) * 100) / 100;
  current.otherItems = otherItems;
  const deposit = rentalMoney(input.deposit ?? current.deposit);
  const checkoutDate = rentalDate(input.checkoutDate ?? current.checkoutDate) || new Date().toISOString().slice(0, 10);
  return { ...current, id: current.id || rentalId(), status, leaseId: rentalText(input.leaseId ?? current.leaseId, 80), roomId: rentalText(input.roomId ?? current.roomId, 80), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), tenantName: rentalText(input.tenantName ?? current.tenantName, 30), tenantPhone: rentalText(input.tenantPhone ?? current.tenantPhone, 30), leaseStart: rentalDate(input.leaseStart ?? current.leaseStart), leaseEnd: checkoutDate, checkoutDate, deposit, waterStart: rentalMoney(input.waterStart ?? current.waterStart), waterEnd: rentalMoney(input.waterEnd ?? current.waterEnd), waterUnitPrice: rentalMoney(input.waterUnitPrice ?? current.waterUnitPrice), waterAmount, electricityStart: rentalMoney(input.electricityStart ?? current.electricityStart), electricityEnd: rentalMoney(input.electricityEnd ?? current.electricityEnd), electricityUnitPrice: rentalRate(input.electricityUnitPrice ?? current.electricityUnitPrice), electricityAmount, propertyAmount: 0, otherAmount, otherItems, otherNote: rentalText(input.otherNote ?? current.otherNote, 1_000), totalDeduction, refundAmount: Math.round((deposit - totalDeduction) * 100) / 100, bankName: rentalText(input.bankName ?? current.bankName, 80), accountName: rentalText(input.accountName ?? current.accountName, 40), accountNo: rentalText(input.accountNo ?? current.accountNo, 40), note: rentalText(input.note ?? current.note, 1_000), inventorySnapshot: Array.isArray(input.inventorySnapshot) ? input.inventorySnapshot.slice(0, 100).map((item) => ({ name: rentalText(item.name, 120), quantity: Math.max(1, Math.trunc(Number(item.quantity || 1) || 1)), note: rentalText(item.note, 300), image: normalizeRentalFileUrl(item.image) })).filter((item) => item.name) : (current.inventorySnapshot || []), images: Array.isArray(input.images) ? input.images.slice(0, 10).map((item) => normalizeRentalFileUrl(item)) : (current.images || []), createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function normalizeRentalMoveIn(input, current = {}) {
  const allowedStatus = ['draft', 'contract_pending', 'contract_signed', 'payment_pending', 'completed', 'cancelled'];
  const allowedContractStatus = ['not_generated', 'generated', 'uploaded_signed'];
  const allowedDurationPreset = ['1month', '3months', '6months', '1year', 'days'];
  const durationPreset = allowedDurationPreset.includes(input.durationPreset ?? current.durationPreset)
    ? (input.durationPreset ?? current.durationPreset)
    : '1month';
  const durationUnit = input.durationUnit === 'days' ? 'days' : 'months';
  const durationValue = Math.max(1, Number(input.durationValue ?? current.durationValue) || 1);
  const monthlyRent = rentalMoney(input.monthlyRent ?? current.monthlyRent);
  const monthlyPropertyFee = rentalMoney(input.monthlyPropertyFee ?? current.monthlyPropertyFee);
  const deposit = rentalMoney(input.deposit ?? current.deposit);
  const status = allowedStatus.includes(input.status ?? current.status) ? (input.status ?? current.status) : 'draft';
  const contractStatus = allowedContractStatus.includes(input.contractStatus ?? current.contractStatus) ? (input.contractStatus ?? current.contractStatus) : 'not_generated';
  const snapshot = Array.isArray(input.inventorySnapshot) ? input.inventorySnapshot.slice(0, 100).map((item) => ({ name: rentalText(item.name, 120), quantity: Math.max(1, Math.trunc(Number(item.quantity || 1) || 1)), note: rentalText(item.note, 300), image: normalizeRentalFileUrl(item.image) })).filter((item) => item.name) : (Array.isArray(current.inventorySnapshot) ? current.inventorySnapshot : []);
  return {
    ...current,
    id: current.id || rentalId(),
    roomId: rentalText(input.roomId ?? current.roomId, 80), roomNo: rentalText(input.roomNo ?? current.roomNo, 40), propertyName: rentalText(input.propertyName ?? current.propertyName, 80),
    tenantName: rentalText(input.tenantName ?? current.tenantName, 30), tenantPhone: rentalText(input.tenantPhone ?? current.tenantPhone, 30), tenantIdCard: rentalIdCard(input.tenantIdCard ?? current.tenantIdCard),
    purpose: rentalText(input.purpose ?? current.purpose, 30),
    idCardFront: normalizeRentalFileUrl(input.idCardFront ?? current.idCardFront), idCardBack: normalizeRentalFileUrl(input.idCardBack ?? current.idCardBack),
    paymentMethod: rentalText(input.paymentMethod ?? current.paymentMethod, 20), propertyFeeMode: ['tenant_self', 'included'].includes(input.propertyFeeMode ?? current.propertyFeeMode) ? (input.propertyFeeMode ?? current.propertyFeeMode) : 'included',
    monthlyRent, monthlyPropertyFee, deposit, startDate: rentalDate(input.startDate ?? current.startDate), endDate: rentalDate(input.endDate ?? current.endDate),
    moveInWater: rentalMoney(input.moveInWater ?? current.moveInWater), moveInElectricity: rentalMoney(input.moveInElectricity ?? current.moveInElectricity), note: rentalText(input.note ?? current.note, 1_000),
    durationPreset, durationUnit, durationValue, status, contractStatus, inventorySnapshot: snapshot,
    generatedContractFile: normalizeRentalFileUrl(input.generatedContractFile ?? current.generatedContractFile), generatedContractName: rentalText(input.generatedContractName ?? current.generatedContractName, 120), signedContractFile: normalizeRentalFileUrl(input.signedContractFile ?? current.signedContractFile),
    contractGeneratedAt: input.contractGeneratedAt ?? current.contractGeneratedAt ?? '', signedAt: input.signedAt ?? current.signedAt ?? '',
    paymentDate: rentalDate(input.paymentDate ?? current.paymentDate), paidThrough: rentalDate(input.paidThrough ?? current.paidThrough),
    completedLeaseId: rentalText(input.completedLeaseId ?? current.completedLeaseId, 80), contractNo: rentalText(input.contractNo ?? current.contractNo, 80), createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), cancelledAt: input.cancelledAt ?? current.cancelledAt ?? ''
  };
}
function rentalSummary(type, record) {
  const amountText = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}元`;
  const presetMonths = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 };
  const durationUnit = record.durationUnit === 'days' || record.durationPreset === 'days' ? 'days' : 'months';
  const presetValue = Number(presetMonths[record.durationPreset]);
  const durationValue = Math.max(1, presetValue || Number(record.durationValue) || 1);
  const periodText = `${durationValue}${durationUnit === 'days' ? '天' : '个月'}`;
  const monthlyTotal = Number(record.monthlyRent || 0) + Number(record.monthlyPropertyFee || 0);
  const roomText = record.propertyName ? `${record.propertyName} · ${record.roomNo || ''}` : (record.roomNo || '');
  const periodAmount = durationUnit === 'days' ? monthlyTotal / 30 * durationValue : monthlyTotal * durationValue;
  const paidAmount = periodAmount + (type === 'move-in' ? Number(record.deposit || 0) : 0);
  const periodEnd = type === 'move-in'
    ? (record.paidThrough || (record.startDate ? moveInPeriodEnd(record.startDate, durationUnit, durationValue) : record.endDate || ''))
    : type === 'checkout'
      ? (record.checkoutDate || record.leaseEnd || '')
      : (record.endDate || (record.startDate ? moveInPeriodEnd(record.startDate, durationUnit, durationValue) : ''));
  const rentDetails = `房租${amountText(record.monthlyRent)}，物业费${amountText(record.monthlyPropertyFee)}，单月合计${amountText(monthlyTotal)}`;
  if (type === 'renewal') return ['【租户续租】', `房间：${roomText}`, `本次续期：${periodText}`, `单月房租物业：${rentDetails}`, `费用实付：${amountText(paidAmount)}`, `入住时间：${record.moveInDate || record.startDate || ''}`, `到期时间：${periodEnd}`].join('\n');
  if (type === 'move-in') return ['【新租户入住】', `房间：${roomText}`, `本次续期：${periodText}`, `单月房租物业：${rentDetails}`, `租房押金：${amountText(record.deposit)}`, `费用实付：${amountText(paidAmount)}`, `入住时间：${record.startDate || ''}`, `到期时间：${periodEnd}`].join('\n');
  const waterDetail = `（入住水表${record.waterStart ?? 0}方，退房水表${record.waterEnd ?? 0}方，水费${Number(record.waterUnitPrice || 0).toFixed(1).replace(/\.0$/, '')}元/方）`;
  const electricityDetail = `（入住电表${record.electricityStart ?? 0}度，退房电表${record.electricityEnd ?? 0}度，电费${Number(record.electricityUnitPrice || 0).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}元/度）`;
  const electricityText = Number(record.electricityAmount || 0) < 0 ? `电费返还：${amountText(Math.abs(record.electricityAmount))}${electricityDetail}` : `电费扣除：${amountText(record.electricityAmount)}${electricityDetail}`;
  const otherText = Array.isArray(record.otherItems) && record.otherItems.length ? record.otherItems.map((item) => `${item.mode === 'refund' ? '返还' : '扣除'}${item.item || '其他'}${amountText(item.amount)}`).join('、') : '无';
  return ['【租户退租】', `房间：${roomText}`, `租期：${record.leaseStart || ''}-${record.leaseEnd || ''}`, `入住押金：${amountText(record.deposit)}`, `水费扣除：${amountText(record.waterAmount)}${waterDetail}`, electricityText, `其他项目：${otherText}`, `合计应退：${amountText(record.refundAmount)}`, `收款信息：${record.accountNo || ''} ${record.bankName || ''} ${record.accountName || ''}`].join('\n');
}
function addRentalMonths(value, months) {
  if (!rentalDate(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}
function subtractRentalDays(value, days) {
  if (!rentalDate(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
function calculateRentalRenewalPeriod(lease, renewals, input = {}) {
  const presetMonths = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 };
  const durationUnit = input.durationUnit === 'days' ? 'days' : 'months';
  const durationValue = input.durationPreset && presetMonths[input.durationPreset]
    ? presetMonths[input.durationPreset]
    : Math.max(1, Number(input.durationValue) || 1);
  const leaseRenewals = (Array.isArray(renewals) ? renewals : [])
    .filter((item) => !item.archivedAt && item.leaseId === lease.id && rentalDate(item.endDate))
    .sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));
  const previousPaidThrough = rentalDate(lease.paidThrough) || leaseRenewals[0]?.endDate || '';
  const initialPayment = !previousPaidThrough && leaseRenewals.length === 0;
  const startDate = initialPayment ? rentalDate(lease.startDate) : subtractRentalDays(previousPaidThrough, -1);
  const endDate = durationUnit === 'days'
    ? subtractRentalDays(startDate, -durationValue + 1)
    : subtractRentalDays(addRentalMonths(startDate, durationValue), 1);
  return { durationUnit, durationValue, initialPayment, startDate, endDate };
}
async function syncRentalBills(lease) {
  if (!lease?.id || lease.status !== 'active' || !lease.startDate) return;
  const bills = await readRentalFile(RENTAL_BILLS_FILE);
  const existing = new Set(bills.filter((item) => item.leaseId === lease.id && item.status !== 'void').map((item) => item.periodStart));
  const interval = lease.billingCycle === 'yearly' ? 12 : lease.billingCycle === 'quarterly' ? 3 : 1;
  const end = lease.endDate || addRentalMonths(lease.startDate, interval);
  const next = [];
  let cursor = lease.startDate;
  let count = 0;
  while (cursor && cursor < end && count < 120) {
    const nextCursor = addRentalMonths(cursor, interval);
    const periodEnd = nextCursor ? subtractRentalDays(nextCursor, 1) : end;
    if (!existing.has(cursor)) {
      next.push(normalizeRentalBill({ leaseId: lease.id, roomId: lease.roomId, roomNo: lease.roomNo, tenantName: lease.tenantName, periodStart: cursor, periodEnd: periodEnd > end ? end : periodEnd, dueDate: cursor, rent: lease.monthlyRent * interval, propertyFee: lease.monthlyPropertyFee * interval, status: 'planned' }));
    }
    cursor = nextCursor;
    count += 1;
  }
  if (next.length) await writeRentalFile(RENTAL_BILLS_FILE, [...next, ...bills]);
}
async function syncRentalMaintenanceLedger(record, archived = false) {
  if (!record?.id) return;
  const ledger = await readRentalFile(RENTAL_LEDGER_FILE);
  const index = ledger.findIndex((item) => item.sourceType === 'maintenance' && item.sourceId === record.id);
  if (archived || record.status === 'pending' || Number(record.amount || 0) <= 0) {
    if (index >= 0) {
      ledger[index] = { ...ledger[index], archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await writeRentalFile(RENTAL_LEDGER_FILE, ledger);
    }
    return;
  }
  const maintenanceItem = record.item || (record.maintenanceType === 'new' ? '新增物品' : record.maintenanceType === 'remove' ? '删除物品' : '房间日常维护');
  const maintenanceNote = record.note && record.note !== maintenanceItem ? `${maintenanceItem}·${record.note}` : maintenanceItem;
  const entry = normalizeRentalLedger({ direction: 'expense', category: 'maintenance', roomId: record.roomId, roomNo: record.roomNo, amount: record.amount, recordDate: record.maintenanceDate, sourceType: 'maintenance', sourceId: record.id, note: maintenanceNote }, index >= 0 ? ledger[index] : {});
  if (index >= 0) ledger[index] = entry; else ledger.unshift(entry);
  await writeRentalFile(RENTAL_LEDGER_FILE, ledger);
}
async function handleRentalRenewal(request, response, method) {
  try {
    const actor = await getAdminUser(request);
    if (!actor) { sendJson(response, 401, { ok: false, message: '请先登录租房管理后台' }); return; }
    const records = await readRentalFile(RENTAL_RENEWALS_FILE);
    if (method === 'GET') { sendJson(response, 200, { ok: true, data: records.filter((item) => !item.archivedAt) }); return; }
    const input = await readJsonBody(request, MAX_RENTAL_BODY_BYTES);
    const leases = await readRentalFile(RENTAL_LEASES_FILE);
    const lease = leases.find((item) => item.id === input.leaseId && item.status === 'active' && !item.archivedAt);
    if (!lease) { sendJson(response, 422, { ok: false, message: '当前租户不存在或已退租' }); return; }
    const period = calculateRentalRenewalPeriod(lease, records, input);
    const unit = period.durationUnit;
    const value = period.durationValue;
    if (!period.startDate || !period.endDate) { sendJson(response, 422, { ok: false, message: '请先填写租户入住时间' }); return; }
    const rent = rentalMoney(input.monthlyRent ?? lease.monthlyRent);
    const room = (await readRentalFile(RENTAL_ROOMS_FILE)).find((item) => (lease.roomId && item.id === lease.roomId) || item.roomNo === lease.roomNo);
    const fallbackPropertyFee = room?.propertyFeeMode === 'tenant_self' ? 0 : room?.monthlyPropertyFee;
    const suppliedPropertyFee = input.monthlyPropertyFee;
    const propertyFee = suppliedPropertyFee === undefined || suppliedPropertyFee === ''
      ? rentalMoney(lease.monthlyPropertyFee || fallbackPropertyFee)
      : rentalMoney(suppliedPropertyFee);
    const periodAmount = unit === 'days' ? Math.round((rent + propertyFee) / 30 * value * 100) / 100 : Math.round((rent + propertyFee) * value * 100) / 100;
    const startDate = period.startDate;
    const endDate = period.endDate;
    const initialPayment = period.initialPayment;
    const deposit = initialPayment ? rentalMoney(lease.deposit) : 0;
    const amount = Math.round((periodAmount + deposit) * 100) / 100;
    const renewal = normalizeRentalRenewal({ leaseId: lease.id, roomId: lease.roomId, roomNo: lease.roomNo, tenantName: lease.tenantName, tenantPhone: lease.tenantPhone, renewalDate: rentalDate(input.renewalDate) || new Date().toISOString().slice(0, 10), startDate, endDate, durationUnit: unit, durationValue: value, monthlyRent: rent, monthlyPropertyFee: propertyFee, deposit, amount, paymentType: initialPayment ? 'initial' : 'renewal', paymentMethod: lease.paymentMethod, note: input.note });
    records.unshift(renewal);
    await writeRentalFile(RENTAL_RENEWALS_FILE, records);
    lease.monthlyRent = rent; lease.monthlyPropertyFee = propertyFee; lease.paidThrough = endDate; lease.updatedAt = new Date().toISOString();
    await writeRentalFile(RENTAL_LEASES_FILE, leases);
    const ledger = await readRentalFile(RENTAL_LEDGER_FILE);
    ledger.unshift(normalizeRentalLedger({ direction: 'income', category: 'rent', roomId: lease.roomId, roomNo: lease.roomNo, amount, recordDate: renewal.renewalDate, sourceType: initialPayment ? 'initial-payment' : 'renewal', sourceId: renewal.id, note: `${lease.tenantName}${initialPayment ? '首次缴费' : '续费'}${unit === 'days' ? `${value}天` : `${value}个月`}，周期起始${startDate}` }));
    await writeRentalFile(RENTAL_LEDGER_FILE, ledger);
    rentalDatabase.appendAudit(DATA_DIR, { resource: 'renewals', action: 'create', recordId: renewal.id, actor: actor.displayName, details: rentalAuditDetails('renewals', renewal, null, 'create') });
    sendJson(response, 201, { ok: true, data: renewal });
  } catch (error) { if (!error.statusCode) console.error(error); sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '续费记录保存失败，请稍后重试' }); }
}
async function handleRentalSettings(request, response, method) {
  try {
    const actor = await getAdminUser(request);
    if (!actor) { sendJson(response, 401, { ok: false, message: '请先登录租房管理后台' }); return; }
    if (method === 'GET') { const settings = await readRentalSettings(); if (settings.contractTemplateFile) settings.contractTemplateFile = '/api/zufang/settings/contract-template'; sendJson(response, 200, { ok: true, data: settings }); return; }
    const current = await readRentalSettings();
    const input = await readJsonBody(request, MAX_RENTAL_BODY_BYTES);
    if (typeof input.contractTemplateData === 'string' && input.contractTemplateData.startsWith('data:')) {
      input.contractTemplateFile = await saveRentalDocument(input.contractTemplateData, 'move-in-template');
    }
    delete input.contractTemplateData;
    const settings = normalizeRentalSettings(input, current);
    await writeRentalSettings(settings);
    rentalDatabase.appendAudit(DATA_DIR, { resource: 'settings', action: 'update', recordId: 'rental-settings', actor: actor.displayName, details: rentalAuditDetails('settings', settings, current, 'update') });
    sendJson(response, 200, { ok: true, data: settings });
  } catch (error) { console.error(error); sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '租房设置保存失败，请稍后重试' }); }
}

async function handleRentalPublicMaintenanceReport(request, response) {
  try {
    const url = new URL(request.url, 'http://' + request.headers.host);
    const batchId = rentalText(url.searchParams.get('batch'), 80);
    const [maintenance, rooms, batches] = await Promise.all([readRentalFile(RENTAL_MAINTENANCE_FILE), readRentalFile(RENTAL_ROOMS_FILE), readRentalFile(RENTAL_MAINTENANCE_BATCHES_FILE)]);
    if (batchId) {
      sendJson(response, 200, { ok: true, data: buildRentalMaintenanceBatchReport(maintenance, rooms, batches, batchId) });
      return;
    }
    sendJson(response, 200, { ok: true, data: buildRentalReimbursementReport(maintenance, rooms) });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '公开维护明细读取失败，请稍后重试' });
  }
}

async function handleRentalMaintenanceBatches(request, response, method, id) {
  try {
    const actor = await getAdminUser(request);
    if (!actor) { sendJson(response, 401, { ok: false, message: '请先登录租房管理后台' }); return; }
    const [maintenance, batches] = await Promise.all([readRentalFile(RENTAL_MAINTENANCE_FILE), readRentalFile(RENTAL_MAINTENANCE_BATCHES_FILE)]);
    if (method === 'GET') {
      if (id) {
        const batch = batches.find((item) => item.id === id && !item.archivedAt);
        if (!batch) { sendJson(response, 404, { ok: false, message: '报销批次不存在' }); return; }
        sendJson(response, 200, { ok: true, data: buildRentalMaintenanceBatchReport(maintenance, await readRentalFile(RENTAL_ROOMS_FILE), batches, id) });
        return;
      }
      sendJson(response, 200, { ok: true, data: buildRentalMaintenanceBatchList(batches, maintenance) });
      return;
    }
    if (method === 'DELETE') {
      const index = batches.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('报销批次不存在'), { statusCode: 404 });
      if (maintenance.some((item) => !item.archivedAt && item.reimbursementBatchId === id)) throw Object.assign(new Error('该批次下还有维护记录，不能删除'), { statusCode: 422 });
      batches[index] = { ...batches[index], archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await writeRentalFile(RENTAL_MAINTENANCE_BATCHES_FILE, batches);
      rentalDatabase.appendAudit(DATA_DIR, { resource: 'maintenance', action: 'archive', recordId: id, actor: actor.displayName, details: `维护批次已归档 ${batches[index].name || id}` });
      sendJson(response, 200, { ok: true, data: batches[index] });
      return;
    }
    const input = await readJsonBody(request, MAX_RENTAL_BODY_BYTES);
    if (method === 'POST') {
      const batch = normalizeRentalMaintenanceBatch(input);
      if (!batch.name) throw Object.assign(new Error('请填写批次名称'), { statusCode: 422 });
      batches.unshift(batch);
      await writeRentalFile(RENTAL_MAINTENANCE_BATCHES_FILE, batches);
      rentalDatabase.appendAudit(DATA_DIR, { resource: 'maintenance', action: 'create', recordId: batch.id, actor: actor.displayName, details: `创建维护批次 ${batch.name}` });
      sendJson(response, 201, { ok: true, data: batch });
      return;
    }
    if (method === 'PATCH') {
      const index = batches.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('报销批次不存在'), { statusCode: 404 });
      const current = batches[index];
      const batch = normalizeRentalMaintenanceBatch(input, current);
      if (!batch.name) throw Object.assign(new Error('请填写批次名称'), { statusCode: 422 });
      batches[index] = batch;
      await writeRentalFile(RENTAL_MAINTENANCE_BATCHES_FILE, batches);
      rentalDatabase.appendAudit(DATA_DIR, { resource: 'maintenance', action: 'update', recordId: batch.id, actor: actor.displayName, details: `修改维护批次 ${batch.name}` });
      sendJson(response, 200, { ok: true, data: batch });
      return;
    }
    sendJson(response, 405, { ok: false, message: '不支持的请求方式' });
  } catch (error) {
    if (!error.statusCode) console.error(error);
    sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '报销批次操作失败，请稍后重试' });
  }
}

async function handleRentalContractTemplateDownload(request, response) {
  try {
    const actor = await getAdminUser(request);
    if (!actor) { response.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }).end('请先登录租房管理后台'); return; }
    const settings = await readRentalSettings();
    const filename = rentalFilenameFromUrl(settings.contractTemplateFile);
    if (!filename) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('未上传合同模板'); return; }
    const content = await fs.readFile(path.join(RENTAL_FILES_DIR, filename));
    const downloadName = rentalDownloadFilename(settings.contractTemplateName || filename, '.docx');
    const asciiDownloadName = downloadName.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\\r\n]+/g, '').trim() || '入住合同模板.docx';
    response.writeHead(200, {
      'Content-Type': MIME_TYPES['.docx'] || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${asciiDownloadName}"; filename*=UTF-8''${encodeRFC5987ValueChars(downloadName)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.code === 'ENOENT' ? '未找到模板文件' : '模板下载失败');
  }
}
function mergeRentalCollectionInput(method, type, id, input, records) {
  if (method !== 'PATCH' || type !== 'leases' || !id) return input;
  const current = records.find((item) => item.id === id);
  return current ? { ...current, ...input } : input;
}

async function handleRentalCollection(request, response, method, type, id) {
  try {
    const purge = new URL(request.url, 'http://' + request.headers.host).searchParams.get('purge') === '1';
    const actor = await getAdminUser(request);
    if (!actor) {
      sendJson(response, 401, { ok: false, message: '请先登录租房管理后台' });
      return;
    }
    const input = method === 'GET' || method === 'DELETE' ? {} : await readJsonBody(request, MAX_RENTAL_BODY_BYTES);
    const files = { rooms: RENTAL_ROOMS_FILE, leases: RENTAL_LEASES_FILE, maintenance: RENTAL_MAINTENANCE_FILE, checkouts: RENTAL_CHECKOUTS_FILE, costs: RENTAL_COSTS_FILE, items: RENTAL_ITEMS_FILE, ledger: RENTAL_LEDGER_FILE, bills: RENTAL_BILLS_FILE };
    const file = files[type];
    if (!file) { sendJson(response, 404, { ok: false, message: '租房资源不存在' }); return; }
    const operation = async () => {
      const records = await readRentalFile(file);
      if (method === 'GET') {
        if (type === 'rooms') {
          const activeLeases = await readRentalFile(RENTAL_LEASES_FILE);
          return records.map((room) => {
            const annualRent = room.landlordAnnualRent === undefined || room.landlordAnnualRent === ''
              ? Math.round(rentalMoney(room.landlordMonthlyRent) * 12 * 100) / 100
              : rentalMoney(room.landlordAnnualRent);
            const occupied = activeLeases.some((lease) => ((lease.roomId && lease.roomId === room.id) || (!lease.roomId && lease.roomNo === room.roomNo)) && lease.status === 'active' && !lease.archivedAt);
            return withSignedRentalFiles(type, { ...room, status: occupied ? 'occupied' : room.status === 'maintenance' ? 'maintenance' : 'vacant', landlordAnnualRent: annualRent, landlordMonthlyRent: Math.round(annualRent / 12 * 100) / 100, landlordAnnualCost: annualRent });
          });
        }
        if (type === 'leases') return records.map((lease) => withSignedRentalFiles(type, { ...lease, ...rentalLeaseTotal(lease) }));
        return records.map((record) => withSignedRentalFiles(type, record));
      }
      if (method === 'DELETE') {
        const index = records.findIndex((item) => item.id === id);
        if (index < 0) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
        if (purge) {
          if (!records[index].archivedAt) throw Object.assign(new Error('请先归档记录，再进行彻底删除'), { statusCode: 422 });
          const removed = records[index];
          records.splice(index, 1);
          await writeRentalFile(file, records);
          rentalDatabase.appendAudit(DATA_DIR, { resource: type, action: 'purge', recordId: id, actor: actor.displayName, details: rentalAuditDetails(type, removed, removed, 'purge') });
          return removed;
        }
        if (type === 'rooms') {
          const activeLease = (await readRentalFile(RENTAL_LEASES_FILE)).some((item) => ((item.roomId && item.roomId === records[index].id) || (!item.roomId && item.roomNo === records[index].roomNo)) && item.status === 'active');
          if (activeLease) throw Object.assign(new Error('房间还有在租租户，请先办理退房'), { statusCode: 422 });
          records[index] = { ...records[index], status: 'vacant', archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        } else if (type === 'leases') {
          records[index] = { ...records[index], status: 'ended', archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        } else if (type === 'bills') {
          records[index] = { ...records[index], status: 'void', archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        } else {
          records[index] = { ...records[index], archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        }
        await writeRentalFile(file, records);
        if (type === 'items' && !request.headers['x-skip-maintenance-sync']) {
          await appendRentalItemMaintenance(records[index], 'remove');
        }
        if (type === 'maintenance') await syncRentalMaintenanceLedger(records[index], true);
        rentalDatabase.appendAudit(DATA_DIR, { resource: type, action: 'archive', recordId: id, actor: actor.displayName, details: rentalAuditDetails(type, records[index], records[index], 'archive') });
        return records[index];
      }
      const preparedInput = await prepareRentalInput(type, mergeRentalCollectionInput(method, type, id, input, records));
      if (type === 'rooms') {
        preparedInput.propertyName = rentalText(preparedInput.propertyName, 80);
        preparedInput.roomNo = rentalText(preparedInput.roomNo, 40);
        if (!preparedInput.propertyName || !preparedInput.roomNo) throw Object.assign(new Error('小区名称和房间号不能为空'), { statusCode: 422 });
        const currentRoom = id ? records.find((item) => item.id === id) : null;
        const contractFile = preparedInput.landlordContractFile ?? currentRoom?.landlordContractFile;
        const contractUrl = normalizeRentalHttpUrl(preparedInput.landlordContractUrl ?? currentRoom?.landlordContractUrl);
        if (preparedInput.landlordContractType === 'paper' && !contractFile) throw Object.assign(new Error('请选择纸质版托管合同 PDF'), { statusCode: 422 });
        if (preparedInput.landlordContractType === 'electronic' && !contractUrl) throw Object.assign(new Error('请填写有效的电子版托管合同地址'), { statusCode: 422 });
        const identityChanged = !currentRoom || currentRoom.propertyName !== preparedInput.propertyName || currentRoom.roomNo !== preparedInput.roomNo;
        if (identityChanged && records.some((room) => room.id !== id && !room.archivedAt && room.propertyName === preparedInput.propertyName && room.roomNo === preparedInput.roomNo)) {
          throw Object.assign(new Error('该小区的房间号已存在，请勿重复创建'), { statusCode: 409 });
        }
        const settings = await readRentalSettings();
        if (settings.propertyUnitPrice > 0) {
          preparedInput.propertyUnitPrice = settings.propertyUnitPrice;
        }
        const leases = await readRentalFile(RENTAL_LEASES_FILE);
        if (leases.some((lease) => ((lease.roomId && lease.roomId === id) || (!lease.roomId && lease.roomNo === preparedInput.roomNo)) && lease.status === 'active' && !lease.archivedAt)) {
          preparedInput.status = 'occupied';
        }
      }
      if (type === 'leases') {
        const depositRefundPatch = method === 'PATCH' && Boolean(id) && input.depositStatus === 'refunded';
        const rooms = await readRentalFile(RENTAL_ROOMS_FILE);
        const roomMatches = rooms.filter((item) => !item.archivedAt && ((preparedInput.roomId && item.id === preparedInput.roomId) || (!preparedInput.roomId && preparedInput.roomNo && item.roomNo === preparedInput.roomNo)));
        if (!preparedInput.roomId && roomMatches.length > 1) throw Object.assign(new Error('存在多个相同房间号，请在房间管理中处理重复档案后再入住'), { statusCode: 409 });
        const room = roomMatches[0] || rooms.find((item) => !item.archivedAt && preparedInput.roomNo && item.roomNo === preparedInput.roomNo);
        if (!room && !depositRefundPatch) throw Object.assign(new Error('请先创建房间，再登记租户入住'), { statusCode: 422 });
        if (room) {
          if (!depositRefundPatch && room.status === 'inactive') throw Object.assign(new Error('该房间已设为无效，不能新增租户入住'), { statusCode: 422 });
          preparedInput.roomId = room.id;
          preparedInput.roomNo = room.roomNo;
          if (!depositRefundPatch && records.some((lease) => lease.id !== id && !lease.archivedAt && lease.status === 'active' && ((lease.roomId && lease.roomId === room.id) || (!lease.roomId && lease.roomNo === room.roomNo)))) {
            throw Object.assign(new Error('该房间已有在租租户，请使用续费或先办理退房'), { statusCode: 409 });
          }
        }
        preparedInput.propertyFeeMode = ['tenant_self', 'included'].includes(preparedInput.propertyFeeMode) ? preparedInput.propertyFeeMode : (room?.propertyFeeMode || 'included');
        if (preparedInput.propertyFeeMode === 'tenant_self') preparedInput.monthlyPropertyFee = 0;
        else if (preparedInput.monthlyPropertyFee === undefined || preparedInput.monthlyPropertyFee === '') preparedInput.monthlyPropertyFee = room?.monthlyPropertyFee || 0;
      }
      if (type === 'items') {
        const rooms = await readRentalFile(RENTAL_ROOMS_FILE);
        const roomMatches = rooms.filter((item) => !item.archivedAt && ((preparedInput.roomId && item.id === preparedInput.roomId) || (!preparedInput.roomId && item.roomNo === preparedInput.roomNo)));
        if (!preparedInput.roomId && roomMatches.length > 1) throw Object.assign(new Error('存在多个相同房间号，请从房间详情添加物品'), { statusCode: 409 });
        const room = roomMatches[0];
        if (!room) throw Object.assign(new Error('请先创建房间，再添加物品'), { statusCode: 422 });
        preparedInput.roomId = room.id;
        preparedInput.roomNo = room.roomNo;
      }
      if (['maintenance', 'costs', 'ledger'].includes(type) && (preparedInput.roomId || preparedInput.roomNo)) {
        const rooms = await readRentalFile(RENTAL_ROOMS_FILE);
        const roomMatches = rooms.filter((item) => !item.archivedAt && ((preparedInput.roomId && item.id === preparedInput.roomId) || (!preparedInput.roomId && item.roomNo === preparedInput.roomNo)));
        if (!preparedInput.roomId && roomMatches.length > 1) throw Object.assign(new Error('存在多个相同房间号，请从房间详情发起操作'), { statusCode: 409 });
        const room = roomMatches[0];
        if (!room) throw Object.assign(new Error('关联房间不存在或已失效'), { statusCode: 422 });
        preparedInput.roomId = room.id;
        preparedInput.roomNo = room.roomNo;
      }
      if (type === 'maintenance' && preparedInput.reimbursementBatchId) {
        const batches = await readRentalFile(RENTAL_MAINTENANCE_BATCHES_FILE);
        if (!batches.some((batch) => !batch.archivedAt && batch.id === preparedInput.reimbursementBatchId)) {
          throw Object.assign(new Error('报销批次不存在，请刷新后重试'), { statusCode: 422 });
        }
      }
      if (type === 'checkouts') {
        const activeLease = (await readRentalFile(RENTAL_LEASES_FILE)).find((item) => ((preparedInput.leaseId && item.id === preparedInput.leaseId) || (!preparedInput.leaseId && preparedInput.roomId && item.roomId === preparedInput.roomId) || (!preparedInput.leaseId && !preparedInput.roomId && item.roomNo === preparedInput.roomNo)) && item.status === 'active');
        if (activeLease) {
          preparedInput.leaseId = activeLease.id;
          preparedInput.roomId = activeLease.roomId;
          preparedInput.roomNo = activeLease.roomNo;
          if (!preparedInput.tenantName) preparedInput.tenantName = activeLease.tenantName;
          if (!preparedInput.tenantPhone) preparedInput.tenantPhone = activeLease.tenantPhone;
          if (!preparedInput.leaseStart) preparedInput.leaseStart = activeLease.startDate;
          if (!preparedInput.leaseEnd) preparedInput.leaseEnd = activeLease.endDate;
          if (!preparedInput.deposit) preparedInput.deposit = activeLease.deposit;
          if (!preparedInput.waterStart) preparedInput.waterStart = activeLease.moveInWater;
          if (!preparedInput.electricityStart) preparedInput.electricityStart = activeLease.moveInElectricity;
          if (!preparedInput.inventorySnapshot) preparedInput.inventorySnapshot = (await readRentalFile(RENTAL_ITEMS_FILE)).filter((item) => ((activeLease.roomId && item.roomId === activeLease.roomId) || (!item.roomId && item.roomNo === activeLease.roomNo)) && !item.archivedAt).map((item) => ({ name: item.name, quantity: item.quantity, note: item.note, image: item.image }));
        }
        const settings = await readRentalSettings();
        preparedInput.waterUnitPrice = settings.waterUnitPrice;
        preparedInput.electricityUnitPrice = settings.electricityUnitPrice;
        const waterStart = rentalMoney(preparedInput.waterStart);
        const waterEnd = rentalMoney(preparedInput.waterEnd);
        const electricityStart = rentalMoney(preparedInput.electricityStart);
        const electricityEnd = rentalMoney(preparedInput.electricityEnd);
        preparedInput.waterAmount = Math.max(0, rentalSignedMoney((waterEnd - waterStart) * settings.waterUnitPrice, 1));
        preparedInput.electricityAmount = rentalSignedMoney((electricityStart - electricityEnd) * settings.electricityUnitPrice, 1);
      }
      const normalizers = { rooms: normalizeRentalRoom, leases: normalizeRentalLease, maintenance: normalizeRentalMaintenance, checkouts: normalizeRentalCheckout, costs: normalizeRentalCost, items: normalizeRentalItem, ledger: normalizeRentalLedger, bills: normalizeRentalBill };
      let index = id ? records.findIndex((item) => item.id === id) : -1;
      if (method === 'PATCH' && type === 'leases' && index < 0) {
        const matches = records.map((item, candidateIndex) => ({ item, candidateIndex })).filter(({ item }) => !item.archivedAt && item.roomNo === preparedInput.roomNo && item.tenantPhone === preparedInput.tenantPhone && item.startDate === preparedInput.startDate);
        if (matches.length === 1) index = matches[0].candidateIndex;
      }
      if (method === 'PATCH' && index < 0) throw Object.assign(new Error('记录不存在，请刷新页面后重试'), { statusCode: 404 });
      const previousRecord = index >= 0 ? records[index] : null;
      const record = normalizers[type](preparedInput, index >= 0 ? records[index] : {});
      if (index >= 0) records[index] = record; else records.unshift(record);
      await writeRentalFile(file, records);
      if (type === 'items' && index < 0 && !request.headers['x-skip-maintenance-sync']) await appendRentalItemMaintenance(record, 'new');
      if (type === 'maintenance') await syncRentalMaintenanceLedger(record);
      if (type === 'leases' && record.depositStatus === 'refunded' && previousRecord?.depositStatus !== 'refunded') {
        const ledger = await readRentalFile(RENTAL_LEDGER_FILE);
        const sourceId = `deposit:${record.id}`;
        if (!ledger.some((item) => item.sourceType === 'deposit-refund' && item.sourceId === sourceId && !item.archivedAt)) {
          ledger.unshift(normalizeRentalLedger({ direction: 'expense', category: 'depositRefund', roomId: record.roomId, roomNo: record.roomNo, amount: record.depositRefundAmount || record.deposit, recordDate: new Date().toISOString().slice(0, 10), sourceType: 'deposit-refund', sourceId, note: `${record.tenantName || '租户'}押金已退` }));
          await writeRentalFile(RENTAL_LEDGER_FILE, ledger);
        }
      }
      if (type === 'leases' || (type === 'checkouts' && record.status !== 'draft')) {
        const rooms = await readRentalFile(RENTAL_ROOMS_FILE);
        const room = rooms.find((item) => (record.roomId && item.id === record.roomId) || (record.roomNo && item.roomNo === record.roomNo));
        if (room) {
          if (type === 'checkouts' && room.status !== 'maintenance') room.status = 'vacant';
          if (type === 'leases' && record.status === 'active') room.status = 'occupied';
          room.updatedAt = new Date().toISOString();
          await writeRentalFile(RENTAL_ROOMS_FILE, rooms);
        }
        if (type === 'checkouts' && record.roomNo) {
          const leases = await readRentalFile(RENTAL_LEASES_FILE);
          let changed = false;
          for (const lease of leases) {
            if ((record.leaseId ? lease.id === record.leaseId : lease.roomNo === record.roomNo) && lease.status === 'active') {
              lease.status = 'ended';
              lease.depositStatus = 'pending';
              lease.depositRefundAmount = record.refundAmount;
              lease.updatedAt = new Date().toISOString();
              changed = true;
            }
          }
          if (changed) await writeRentalFile(RENTAL_LEASES_FILE, leases);
        }
      }
      if (type === 'leases') await syncRentalBills(record);
      rentalDatabase.appendAudit(DATA_DIR, { resource: type, action: id ? 'update' : 'create', recordId: record.id, actor: actor.displayName, details: rentalAuditDetails(type, record, previousRecord, id ? 'update' : 'create') });
      return record;
    };
    const result = await operation();
    if (method === 'GET') { sendJson(response, 200, { ok: true, data: result }); return; }
    if (method === 'DELETE') { sendJson(response, 200, { ok: true }); return; }
    sendJson(response, id ? 200 : 201, { ok: true, data: result });
  } catch (error) { if (!error.statusCode) console.error(error); sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '租房数据保存失败，请稍后重试' }); }
}

function moveInRoomMatch(rooms, input) {
  return rooms.find((room) => !room.archivedAt && ((input.roomId && room.id === input.roomId) || (!input.roomId && input.roomNo && room.roomNo === input.roomNo)));
}
function addRentalDays(value, days) {
  if (!rentalDate(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}
function moveInPeriodEnd(startDate, unit, value) {
  const amount = Math.max(1, Number(value) || 1);
  return unit === 'days' ? addRentalDays(startDate, amount - 1) : subtractRentalDays(addRentalMonths(startDate, amount), 1);
}
async function handleRentalMoveIns(request, response, method, id) {
  try {
    const actor = await getAdminUser(request);
    if (!actor) { sendJson(response, 401, { ok: false, message: '请先登录租房管理后台' }); return; }
    const records = await readRentalFile(RENTAL_MOVE_INS_FILE);
    if (method === 'GET') {
      sendJson(response, 200, { ok: true, data: records.map((record) => withSignedRentalFiles('move-ins', record)) });
      return;
    }
    if (method === 'DELETE') {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('办理入住记录不存在'), { statusCode: 404 });
      records[index] = { ...records[index], status: 'cancelled', cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await writeRentalFile(RENTAL_MOVE_INS_FILE, records);
      rentalDatabase.appendAudit(DATA_DIR, { resource: 'move-ins', action: 'cancel', recordId: id, actor: actor.displayName, details: '取消入住办理单' });
      sendJson(response, 200, { ok: true, data: records[index] });
      return;
    }
    const input = await readJsonBody(request, MAX_RENTAL_BODY_BYTES);
    const rooms = await readRentalFile(RENTAL_ROOMS_FILE);
    const current = records.find((item) => item.id === id);
    const room = moveInRoomMatch(rooms, { ...(current || {}), ...input });
    if (!room) throw Object.assign(new Error('请先创建并选择有效房间'), { statusCode: 422 });
    const activeLease = (await readRentalFile(RENTAL_LEASES_FILE)).some((lease) => !lease.archivedAt && lease.status === 'active' && ((lease.roomId && lease.roomId === room.id) || (!lease.roomId && lease.roomNo === room.roomNo)));
    if (activeLease && !current) throw Object.assign(new Error('该房间已有在租租户，请使用续费'), { statusCode: 409 });
    const prepared = await prepareRentalInput('move-ins', { ...input, roomId: room.id, roomNo: room.roomNo });
    const record = normalizeRentalMoveIn({ ...prepared, propertyName: room.propertyName, contractNo: current?.contractNo || prepared.contractNo || `DR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${room.roomNo}` }, current || { roomId: room.id, roomNo: room.roomNo, propertyName: room.propertyName, inventorySnapshot: (await readRentalFile(RENTAL_ITEMS_FILE)).filter((item) => item.roomId === room.id && !item.archivedAt).map((item) => ({ name: item.name, quantity: item.quantity, note: item.note, image: item.image })) });
    record.status = current?.status === 'draft' && input.status === 'contract_pending'
      ? 'contract_pending'
      : current?.status || record.status || 'draft';
    if (!record.startDate) record.startDate = new Date().toISOString().slice(0, 10);
    if (!record.monthlyPropertyFee && record.propertyFeeMode === 'included') record.monthlyPropertyFee = room.monthlyPropertyFee || 0;
    if (method === 'PATCH' && !current) throw Object.assign(new Error('办理入住记录不存在，请刷新页面后重试'), { statusCode: 404 });
    if (current) records[records.findIndex((item) => item.id === id)] = record; else records.unshift(record);
    await writeRentalFile(RENTAL_MOVE_INS_FILE, records);
    rentalDatabase.appendAudit(DATA_DIR, { resource: 'move-ins', action: current ? 'update' : 'create', recordId: record.id, actor: actor.displayName, details: `${current ? '修改' : '创建'}入住办理单 ${room.propertyName} ${room.roomNo}` });
    sendJson(response, current ? 200 : 201, { ok: true, data: withSignedRentalFiles('move-ins', record) });
  } catch (error) { if (!error.statusCode) console.error(error); sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '入住办理保存失败，请稍后重试' }); }
}
async function handleRentalMoveInAction(request, response, id, action) {
  try {
    const actor = await getAdminUser(request);
    if (!actor) { sendJson(response, 401, { ok: false, message: '请先登录租房管理后台' }); return; }
    const records = await readRentalFile(RENTAL_MOVE_INS_FILE);
    const index = records.findIndex((item) => item.id === id);
    if (index < 0) throw Object.assign(new Error('办理入住记录不存在'), { statusCode: 404 });
    const record = records[index];
    if (action === 'generate-contract') {
      const settings = await readRentalSettings();
      const templateName = rentalFilenameFromUrl(settings.contractTemplateFile);
      if (!templateName) throw Object.assign(new Error('请先在租房设置中上传Word合同模板'), { statusCode: 422 });
      const template = await fs.readFile(path.join(RENTAL_FILES_DIR, templateName));
      const rooms = await readRentalFile(RENTAL_ROOMS_FILE);
      const room = rooms.find((item) => item.id === record.roomId || item.roomNo === record.roomNo);
      const paymentMethodLabel = ({ monthly: '月付', quarterly: '季付', yearly: '年付' })[record.paymentMethod] || record.paymentMethod || '月付';
      const monthlyTotal = Math.round((Number(record.monthlyRent || 0) + Number(record.monthlyPropertyFee || 0)) * 100) / 100;
      const propertyName = record.propertyName || room?.propertyName || '';
      const propertyAddressName = propertyName.includes('西城') ? propertyName : `西城${propertyName}`;
      const contractNo = record.contractNo || `DR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${record.roomNo}`;
      record.contractNo = contractNo;
      const contractName = rentalDownloadFilename([propertyName, record.roomNo, record.tenantName, '租赁合同'].filter(Boolean).join('-'), '.docx');
      record.generatedContractName = contractName;
      const filled = fillDocxTemplate(template, { propertyName, propertyAddress: `东营市${propertyAddressName}D1-${record.roomNo}`, roomNo: record.roomNo, roomLabel: `${propertyName} · ${record.roomNo}`, contractNo, tenantName: record.tenantName, tenantIdCard: record.tenantIdCard, tenantPhone: record.tenantPhone, purpose: record.purpose, startDate: record.startDate, endDate: record.endDate || '/', area: room?.area || '', paymentMethod: paymentMethodLabel, monthlyRent: record.monthlyRent, monthlyPropertyFee: record.monthlyPropertyFee, monthlyTotal, deposit: record.deposit, moveInWater: record.moveInWater, moveInElectricity: record.moveInElectricity, waterUnitPrice: settings.waterUnitPrice, electricityUnitPrice: settings.electricityUnitPrice, inventory: (record.inventorySnapshot || []).map((item) => item.name ? `${item.name} × ${Math.max(1, Math.trunc(Number(item.quantity || 1) || 1))}` : '').filter(Boolean).join('、') });
      await fs.mkdir(RENTAL_FILES_DIR, { recursive: true, mode: 0o750 });
      const filename = `move-in-contract-${crypto.randomUUID()}.docx`;
      await fs.writeFile(path.join(RENTAL_FILES_DIR, filename), filled, { mode: 0o640 });
      record.generatedContractFile = `/api/zufang/files/${filename}`; record.contractStatus = 'generated'; record.status = 'contract_pending'; record.contractGeneratedAt = new Date().toISOString(); record.updatedAt = new Date().toISOString();
    } else if (action === 'upload-signed') {
      const input = await readJsonBody(request, MAX_RENTAL_BODY_BYTES);
      const prepared = await prepareRentalInput('move-ins', input);
      if (!prepared.signedContractFile) throw Object.assign(new Error('请上传已签署的PDF或DOCX合同'), { statusCode: 422 });
      record.signedContractFile = prepared.signedContractFile; record.contractStatus = 'uploaded_signed'; record.status = 'payment_pending'; record.signedAt = new Date().toISOString(); record.updatedAt = new Date().toISOString();
    } else if (action === 'complete-payment') {
      if (record.contractStatus !== 'uploaded_signed') throw Object.assign(new Error('请先上传已签署合同'), { statusCode: 422 });
      const input = await readJsonBody(request, MAX_RENTAL_BODY_BYTES);
      const rooms = await readRentalFile(RENTAL_ROOMS_FILE);
      const room = rooms.find((item) => item.id === record.roomId || item.roomNo === record.roomNo);
      if (!room) throw Object.assign(new Error('关联房间不存在'), { statusCode: 422 });
      const leases = await readRentalFile(RENTAL_LEASES_FILE);
      if (record.completedLeaseId && leases.some((lease) => lease.id === record.completedLeaseId)) { sendJson(response, 200, { ok: true, data: withSignedRentalFiles('move-ins', record) }); return; }
      if (leases.some((lease) => !lease.archivedAt && lease.status === 'active' && ((lease.roomId && lease.roomId === room.id) || (!lease.roomId && lease.roomNo === room.roomNo)))) throw Object.assign(new Error('该房间已有在租租户'), { statusCode: 409 });
      const durationUnit = input.durationPreset === 'days' || input.durationUnit === 'days' ? 'days' : (record.durationUnit || 'months');
      const presetMonths = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 };
      const durationValue = Math.max(1, Number(presetMonths[input.durationPreset]) || Number(input.durationValue ?? record.durationValue) || 1);
      const startDate = record.startDate || new Date().toISOString().slice(0, 10);
      const paidThrough = moveInPeriodEnd(startDate, durationUnit, durationValue);
      const lease = normalizeRentalLease({ roomId: room.id, roomNo: room.roomNo, tenantName: record.tenantName, tenantPhone: record.tenantPhone, tenantIdCard: record.tenantIdCard, purpose: record.purpose, paymentMethod: record.paymentMethod, propertyFeeMode: record.propertyFeeMode, monthlyRent: record.monthlyRent, monthlyPropertyFee: record.monthlyPropertyFee, deposit: record.deposit, startDate, endDate: record.endDate, paidThrough, moveInWater: input.moveInWater ?? record.moveInWater, moveInElectricity: input.moveInElectricity ?? record.moveInElectricity, note: record.note, idCardFront: record.idCardFront, idCardBack: record.idCardBack, contractStatus: 'active', contractFileUrl: record.signedContractFile });
      leases.unshift(lease); await writeRentalFile(RENTAL_LEASES_FILE, leases);
      const renewals = await readRentalFile(RENTAL_RENEWALS_FILE); const amount = Math.round(((lease.monthlyRent + lease.monthlyPropertyFee) * (durationUnit === 'days' ? durationValue / 30 : durationValue) + lease.deposit) * 100) / 100;
      const renewal = normalizeRentalRenewal({ leaseId: lease.id, roomId: room.id, roomNo: room.roomNo, tenantName: lease.tenantName, tenantPhone: lease.tenantPhone, renewalDate: input.paymentDate || new Date().toISOString().slice(0, 10), startDate, endDate: paidThrough, durationUnit, durationValue, monthlyRent: lease.monthlyRent, monthlyPropertyFee: lease.monthlyPropertyFee, deposit: lease.deposit, amount, paymentType: 'initial', paymentMethod: lease.paymentMethod }); renewals.unshift(renewal); await writeRentalFile(RENTAL_RENEWALS_FILE, renewals);
      const ledger = await readRentalFile(RENTAL_LEDGER_FILE); ledger.unshift(normalizeRentalLedger({ direction: 'income', category: 'rent', roomId: room.id, roomNo: room.roomNo, amount, recordDate: renewal.renewalDate, sourceType: 'initial-payment', sourceId: renewal.id, note: `${lease.tenantName || '租户'}首次缴费，周期起始${startDate}` })); await writeRentalFile(RENTAL_LEDGER_FILE, ledger);
      room.status = 'occupied'; room.updatedAt = new Date().toISOString(); await writeRentalFile(RENTAL_ROOMS_FILE, rooms); await syncRentalBills(lease);
      record.completedLeaseId = lease.id; record.paymentDate = renewal.renewalDate; record.paidThrough = paidThrough; record.durationUnit = durationUnit; record.durationValue = durationValue; record.status = 'completed'; record.updatedAt = new Date().toISOString(); record.completedAt = new Date().toISOString();
    } else throw Object.assign(new Error('不支持的入住办理操作'), { statusCode: 404 });
    await writeRentalFile(RENTAL_MOVE_INS_FILE, records); rentalDatabase.appendAudit(DATA_DIR, { resource: 'move-ins', action, recordId: id, actor: actor.displayName, details: `${action} ${record.propertyName || ''} ${record.roomNo || ''}` }); sendJson(response, 200, { ok: true, data: withSignedRentalFiles('move-ins', record) });
  } catch (error) { if (!error.statusCode) console.error(error); sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '入住办理操作失败，请稍后重试' }); }
}
async function handleRentalSummary(request, response) {
  try {
    if (!await hasAdminAccess(request)) {
      sendJson(response, 401, { ok: false, message: '请先登录租房管理后台' });
      return;
    }
    const input = await readJsonBody(request);
    const type = ['renewal', 'move-in', 'checkout'].includes(input.type) ? input.type : 'renewal';
    let record;
    if (type === 'checkout') {
      const checkout = normalizeRentalCheckout(input);
      const rooms = await readRentalFile(RENTAL_ROOMS_FILE);
      const room = rooms.find((item) => (checkout.roomId && item.id === checkout.roomId) || (!checkout.roomId && checkout.roomNo && item.roomNo === checkout.roomNo));
      record = { ...checkout, propertyName: rentalText(input.propertyName ?? room?.propertyName, 80) };
    } else if (type === 'renewal') {
      record = { ...normalizeRentalRenewal(input), moveInDate: rentalDate(input.moveInDate) };
    } else {
      record = { ...normalizeRentalLease(input), propertyName: rentalText(input.propertyName, 80), durationPreset: input.durationPreset, durationUnit: input.durationUnit, durationValue: input.durationValue };
    }
    sendJson(response, 200, { ok: true, data: { ...record, summary: rentalSummary(type, record) } });
  } catch (error) { sendJson(response, 400, { ok: false, message: '租房模板内容不正确' }); }
}

async function handleRentalAudit(request, response) {
  try {
    if (!await hasAdminAccess(request)) { sendJson(response, 401, { ok: false, message: '请先登录租房管理后台' }); return; }
    sendJson(response, 200, { ok: true, data: rentalDatabase.listAudit(DATA_DIR, 300) });
  } catch (error) { console.error(error); sendJson(response, 500, { ok: false, message: '操作日志读取失败' }); }
}

async function handleRentalUsers(request, response, method, id) {
  try {
    const actor = await getAdminUser(request);
    if (!actor) { sendJson(response, 401, { ok: false, message: '请先登录租房管理后台' }); return; }
    const users = await readAdminUsers();
    if (method === 'GET') {
      sendJson(response, 200, { ok: true, data: [{ username: 'admin', displayName: '管理员', role: 'admin', enabled: true }, ...users.map((item) => ({ username: item.username, displayName: item.displayName || item.username, role: 'user', enabled: item.enabled !== false, createdAt: item.createdAt }))] });
      return;
    }
    if (actor.role !== 'admin') { sendJson(response, 403, { ok: false, message: '只有管理员可以管理账号' }); return; }
    if (method === 'POST') {
      const input = await readJsonBody(request, MAX_RENTAL_BODY_BYTES);
      const username = cleanText(input.username, 40);
      const displayName = cleanText(input.displayName, 40) || username;
      const password = typeof input.password === 'string' ? input.password : '';
      if (!/^[A-Za-z0-9_-]{3,40}$/.test(username) || username === 'admin') throw Object.assign(new Error('账号需为 3 至 40 位字母、数字、下划线或短横线'), { statusCode: 422 });
      if (!isValidAdminPassword(password)) throw Object.assign(new Error('密码长度需为 8 至 72 位'), { statusCode: 422 });
      if (users.some((item) => item.username === username)) throw Object.assign(new Error('账号已存在'), { statusCode: 409 });
      const user = { username, displayName, enabled: true, auth: await hashAdminPassword(password), createdAt: new Date().toISOString() };
      users.push(user);
      await writeAdminUsers(users);
      rentalDatabase.appendAudit(DATA_DIR, { resource: 'users', action: 'create', recordId: username, actor: actor.displayName, details: rentalAuditDetails('users', user, null, 'create') });
      sendJson(response, 201, { ok: true, data: { username, displayName, role: 'user', enabled: true, createdAt: user.createdAt } });
      return;
    }
    if (method === 'PATCH' && id) {
      const index = users.findIndex((item) => item.username === id);
      if (index < 0) { sendJson(response, 404, { ok: false, message: '账号不存在' }); return; }
      const previousUser = { ...users[index] };
      const input = await readJsonBody(request, MAX_RENTAL_BODY_BYTES);
      if (input.password !== undefined) {
        if (!isValidAdminPassword(input.password)) throw Object.assign(new Error('密码长度需为 8 至 72 位'), { statusCode: 422 });
        users[index].auth = await hashAdminPassword(input.password);
      }
      if (input.displayName !== undefined) users[index].displayName = cleanText(input.displayName, 40) || users[index].username;
      if (input.enabled !== undefined) users[index].enabled = Boolean(input.enabled);
      await writeAdminUsers(users);
      rentalDatabase.appendAudit(DATA_DIR, { resource: 'users', action: 'update', recordId: id, actor: actor.displayName, details: rentalAuditDetails('users', users[index], previousUser, 'update') });
      sendJson(response, 200, { ok: true, data: { username: users[index].username, displayName: users[index].displayName, role: 'user', enabled: users[index].enabled } });
      return;
    }
    sendJson(response, 405, { ok: false, message: '账号操作不支持' });
  } catch (error) { sendJson(response, error.statusCode || 500, { ok: false, message: error.statusCode ? error.message : '账号操作失败' }); }
}

async function handleRentalFile(request, response, filename, searchParams) {
  const safeName = path.basename(filename);
  if (safeName !== filename || !/^(?:(?:maintenance|item|room|id-card-front|id-card-back)-[0-9a-f-]+\.(?:jpg|png|webp)|landlord-contract-[0-9a-f-]+\.pdf|move-in-(?:template|contract|signed)-[0-9a-f-]+\.(?:docx|pdf))$/.test(safeName)) {
    response.writeHead(404).end('文件不存在');
    return;
  }
  if (!hasValidRentalFileSignature(safeName, searchParams.get('expires'), searchParams.get('signature'))) {
    response.writeHead(401, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end('文件访问链接无效或已过期');
    return;
  }
  try {
    const content = await fs.readFile(path.join(RENTAL_FILES_DIR, safeName));
    const extension = path.extname(safeName).toLowerCase();
    const downloadName = rentalText(searchParams.get('download') || '', 160);
    const fallbackName = safeName;
    const asciiDownloadName = (downloadName || fallbackName).replace(/[^\x20-\x7E]+/g, '_').replace(/["\\\r\n]+/g, '').trim() || fallbackName;
    const disposition = downloadName
      ? `attachment; filename="${asciiDownloadName}"; filename*=UTF-8''${encodeRFC5987ValueChars(downloadName)}`
      : extension === '.pdf'
        ? `inline; filename="${safeName}"`
        : 'inline';
    response.writeHead(200, { 'Content-Type': MIME_TYPES[extension] || 'application/octet-stream', 'Content-Disposition': disposition, 'Cache-Control': `private, max-age=${RENTAL_FILE_URL_TTL_SECONDS}`, 'X-Content-Type-Options': 'nosniff' });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code === 'ENOENT' ? '文件不存在' : '文件读取失败');
  }
}

async function readInviters() {
  try {
    const current = await fs.readFile(INVITERS_FILE, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeInviters(records) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = INVITERS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, INVITERS_FILE);
}

async function readPosterGenerationEvents() {
  try {
    const current = await fs.readFile(POSTER_GENERATION_EVENTS_FILE, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writePosterGenerationEvents(records) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = POSTER_GENERATION_EVENTS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, POSTER_GENERATION_EVENTS_FILE);
}

async function readReferralVisits() {
  try {
    const current = await fs.readFile(REFERRAL_VISITS_FILE, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeReferralVisits(records) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = REFERRAL_VISITS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, REFERRAL_VISITS_FILE);
}

async function readReferralOpenings() {
  try {
    const current = await fs.readFile(REFERRAL_OPENINGS_FILE, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeReferralOpenings(records) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = REFERRAL_OPENINGS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, REFERRAL_OPENINGS_FILE);
}

async function readBrokerOpenings() {
  try {
    const current = await fs.readFile(BROKER_OPENINGS_FILE, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeBrokerOpenings(records) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = BROKER_OPENINGS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, BROKER_OPENINGS_FILE);
}

function isValidClockTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeContactSettings(input = {}) {
  const phone = cleanText(input.phone, 20).replace(/\D/g, '');
  const startTime = cleanText(input.startTime, 5);
  const endTime = cleanText(input.endTime, 5);
  return {
    phone: isValidPhone(phone) ? phone : '',
    startTime: isValidClockTime(startTime) ? startTime : '09:00',
    endTime: isValidClockTime(endTime) ? endTime : '18:00',
  };
}

function getChinaTimeMinutes(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function isContactSettingsActive(input, date = new Date()) {
  const settings = normalizeContactSettings(input);
  if (!settings.phone) return false;
  const [startHour, startMinute] = settings.startTime.split(':').map(Number);
  const [endHour, endMinute] = settings.endTime.split(':').map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const current = getChinaTimeMinutes(date);
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

async function readContactSettings() {
  try {
    const current = await fs.readFile(CONTACT_SETTINGS_FILE, 'utf8');
    return normalizeContactSettings(JSON.parse(current));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeContactSettings();
    throw error;
  }
}

async function writeContactSettings(settings) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = CONTACT_SETTINGS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(normalizeContactSettings(settings), null, 2), {
    encoding: 'utf8',
    mode: 0o640,
  });
  await fs.rename(temporaryFile, CONTACT_SETTINGS_FILE);
}

async function readContactClicks() {
  try {
    const current = await fs.readFile(CONTACT_CLICKS_FILE, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeContactClicks(records) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = CONTACT_CLICKS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, CONTACT_CLICKS_FILE);
}

async function persistContactClick({ settings, referral, visitorId, ip, userAgent }) {
  const clickedAt = new Date().toISOString();
  const location = await resolveIpLocation(ip);
  const record = {
    id: crypto.randomUUID(),
    servicePhone: settings.phone,
    referralCode: referral?.code || '',
    inviterName: referral?.name || '',
    inviterPhone: referral?.phone || '',
    visitorId,
    ip,
    location,
    userAgent,
    clickedAt,
  };
  const operation = async () => {
    const records = await readContactClicks();
    records.push(record);
    if (records.length > MAX_CONTACT_CLICKS) {
      records.splice(0, records.length - MAX_CONTACT_CLICKS);
    }
    await writeContactClicks(records);
  };
  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  await result;
  return record;
}

function formatIpLocation(input) {
  const data = input?.data || input?.result || input || {};
  const direct = cleanText(data.location || data.address || data.addr, 100);
  if (direct) return direct;
  return [data.country, data.regionName || data.region || data.province, data.city, data.district]
    .map((item) => cleanText(item, 40))
    .filter((item, index, values) => item && values.indexOf(item) === index)
    .join(' ');
}

async function resolveIpLocation(address) {
  if (!address || address === 'unknown') return '未知地址';
  if (isPrivateIpAddress(address)) return '内网地址';
  if (!IP_GEOLOCATION_URL || !IP_GEOLOCATION_URL.includes('{ip}')) return '待配置';
  if (ipLocationCache.has(address)) return ipLocationCache.get(address);

  try {
    const endpoint = IP_GEOLOCATION_URL.replace('{ip}', encodeURIComponent(address));
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(1800) });
    if (!response.ok) return '解析失败';
    const location = formatIpLocation(await response.json()) || '解析失败';
    if (location !== '解析失败') {
      if (ipLocationCache.size >= 5000) ipLocationCache.delete(ipLocationCache.keys().next().value);
      ipLocationCache.set(address, location);
    }
    return location;
  } catch {
    return '解析失败';
  }
}

async function persistReferralVisit({ referral, visitorId, ip, userAgent, isBrokerSelf = false }) {
  const visitedAt = new Date().toISOString();
  const location = await resolveIpLocation(ip);
  let visit;
  let deduplicated = false;
  const operation = async () => {
    const records = await readReferralVisits();
    const openings = await readReferralOpenings();
    openings.push({
      id: crypto.randomUUID(),
      referralCode: referral.code,
      inviterName: referral.name || '',
      inviterPhone: referral.phone,
      visitorId,
      ip,
      userAgent,
      isBrokerSelf,
      openedAt: visitedAt,
    });
    if (openings.length > MAX_REFERRAL_OPENINGS) {
      openings.splice(0, openings.length - MAX_REFERRAL_OPENINGS);
    }
    const recent = [...records].reverse().find((record) => (
      record.referralCode === referral.code
      && record.visitorId === visitorId
      && Date.parse(visitedAt) - Date.parse(record.lastVisitedAt || record.visitedAt) < REFERRAL_VISIT_WINDOW_MS
    ));

    if (recent) {
      recent.lastVisitedAt = visitedAt;
      recent.refreshCount = (Number(recent.refreshCount) || 0) + 1;
      recent.isBrokerSelf = Boolean(recent.isBrokerSelf || isBrokerSelf);
      visit = recent;
      deduplicated = true;
    } else {
      visit = {
        id: crypto.randomUUID(),
        referralCode: referral.code,
        inviterName: referral.name || '',
        inviterPhone: referral.phone,
        visitorId,
        ip,
        location,
        userAgent,
        isBrokerSelf,
        visitedAt,
        lastVisitedAt: visitedAt,
        refreshCount: 0,
      };
      records.push(visit);
      if (records.length > MAX_REFERRAL_VISITS) {
        records.splice(0, records.length - MAX_REFERRAL_VISITS);
      }
    }
    await writeReferralVisits(records);
    await writeReferralOpenings(openings);
  };

  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  await result;
  return { visit, deduplicated };
}

async function persistBrokerOpening({ name = '', phone = '', ip, userAgent }) {
  const openedAt = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    inviterName: name,
    inviterPhone: phone,
    ip,
    userAgent,
    openedAt,
  };
  const operation = async () => {
    const records = await readBrokerOpenings();
    records.push(record);
    if (records.length > MAX_BROKER_OPENINGS) {
      records.splice(0, records.length - MAX_BROKER_OPENINGS);
    }
    await writeBrokerOpenings(records);
  };

  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  await result;
  return record;
}

async function markReferralVisitConverted(referralCode, visitorId, applicationId) {
  if (!referralCode || !visitorId) return;
  const operation = async () => {
    const records = await readReferralVisits();
    const visit = [...records].reverse().find((record) => (
      record.referralCode === referralCode && record.visitorId === visitorId
    ));
    if (!visit) return;
    visit.convertedApplicationId = applicationId;
    visit.convertedAt = new Date().toISOString();
    await writeReferralVisits(records);
  };

  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  await result;
}

async function readPosters() {
  try {
    const current = await fs.readFile(POSTERS_FILE, 'utf8');
    const records = JSON.parse(current);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writePosters(records) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = POSTERS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, POSTERS_FILE);
}

function normalizePosterSettings(input = {}) {
  const templates = Array.isArray(input.customCopyTemplates)
    ? input.customCopyTemplates
      .map((item) => cleanText(item, 100))
      .filter((item) => item.length > 0)
      .filter((item, index, values) => values.indexOf(item) === index)
      .slice(0, 30)
    : [];
  return {
    autoEnabled: input.autoEnabled === true,
    autoCopyEnabled: input.autoCopyEnabled !== false,
    customCopyTemplates: templates,
  };
}

async function readPosterSettings() {
  try {
    const current = await fs.readFile(POSTER_SETTINGS_FILE, 'utf8');
    return normalizePosterSettings(JSON.parse(current));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizePosterSettings();
    throw error;
  }
}

async function writePosterSettings(settings) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  const temporaryFile = POSTER_SETTINGS_FILE + '.' + process.pid + '.tmp';
  await fs.writeFile(temporaryFile, JSON.stringify(normalizePosterSettings(settings), null, 2), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporaryFile, POSTER_SETTINGS_FILE);
}

function detectImageType(buffer) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length >= pngSignature.length && buffer.subarray(0, 8).equals(pngSignature)) {
    return { extension: '.png', mimeType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: '.jpg', mimeType: 'image/jpeg' };
  }
  return null;
}

function publicPoster(record) {
  return {
    id: record.id,
    originalName: record.originalName,
    mimeType: record.mimeType,
    uploadedAt: record.uploadedAt,
  };
}

async function savePosters(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_POSTERS_PER_UPLOAD) {
    throw Object.assign(new Error('每次请选择 1 至 6 张海报'), { statusCode: 422 });
  }

  const prepared = files.map((file) => {
    if (!file || typeof file.data !== 'string') {
      throw Object.assign(new Error('海报文件格式不正确'), { statusCode: 422 });
    }
    const buffer = Buffer.from(file.data, 'base64');
    if (buffer.length < 1 || buffer.length > MAX_POSTER_BYTES) {
      throw Object.assign(new Error('单张海报不能超过 5 MB'), { statusCode: 422 });
    }
    const imageType = detectImageType(buffer);
    if (!imageType) {
      throw Object.assign(new Error('只支持 JPG 和 PNG 海报'), { statusCode: 422 });
    }
    return {
      buffer,
      imageType,
      originalName: cleanText(file.name, 100) || '海报',
    };
  });

  let createdRecords = [];
  const createdPaths = [];
  const operation = async () => {
    await fs.mkdir(POSTERS_DIR, { recursive: true, mode: 0o750 });
    const records = await readPosters();
    const baseTime = Date.now();
    createdRecords = [];

    try {
      for (const [index, file] of prepared.entries()) {
        const id = crypto.randomUUID();
        const filename = id + file.imageType.extension;
        const filePath = path.join(POSTERS_DIR, filename);
        await fs.writeFile(filePath, file.buffer, { mode: 0o640 });
        createdPaths.push(filePath);
        createdRecords.push({
          id,
          filename,
          originalName: file.originalName,
          mimeType: file.imageType.mimeType,
          uploadedAt: new Date(baseTime + index).toISOString(),
        });
      }
      await writePosters(createdRecords);
      await Promise.allSettled(records.map((record) => {
        return fs.unlink(path.join(POSTERS_DIR, path.basename(record.filename || '')));
      }));
    } catch (error) {
      await Promise.all(createdPaths.map((filePath) => fs.unlink(filePath).catch(() => {})));
      throw error;
    }
  };

  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  await result;
  return createdRecords;
}

async function getOrCreateReferral(phone, name = '') {
  let referral;
  const operation = async () => {
    const records = await readInviters();
    referral = records.find((item) => item.phone === phone);
    if (referral) {
      if (name && referral.name !== name) {
        referral.name = name;
        referral.updatedAt = new Date().toISOString();
        await writeInviters(records);
      }
      return;
    }
    referral = {
      code: crypto.randomBytes(8).toString('hex'),
      name,
      phone,
      posterGenerationCount: 0,
      createdAt: new Date().toISOString(),
    };
    records.push(referral);
    await writeInviters(records);
  };

  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  await result;
  return referral;
}

async function recordPosterGeneration(code, phone, ip, userAgent) {
  let referral;
  const operation = async () => {
    const records = await readInviters();
    const events = await readPosterGenerationEvents();
    referral = records.find((item) => item.code === code && item.phone === phone);
    if (!referral) {
      throw Object.assign(new Error('未找到对应的经纪人信息'), { statusCode: 404 });
    }
    const generatedAt = new Date().toISOString();
    referral.posterGenerationCount = Math.max(0, Number(referral.posterGenerationCount) || 0) + 1;
    referral.lastPosterGeneratedAt = generatedAt;
    referral.lastPosterGeneratedIp = ip;
    events.push({
      id: crypto.randomUUID(),
      referralCode: referral.code,
      inviterName: referral.name || '',
      inviterPhone: referral.phone,
      ip,
      userAgent,
      generatedAt,
    });
    if (events.length > MAX_POSTER_GENERATION_EVENTS) {
      events.splice(0, events.length - MAX_POSTER_GENERATION_EVENTS);
    }
    await writeInviters(records);
    await writePosterGenerationEvents(events);
  };

  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  await result;
  return referral;
}

async function findReferral(code) {
  const records = await readInviters();
  return records.find((item) => item.code === code) || null;
}

function matchesBrokerGenerationIp(referral, events, ip) {
  if (!ip || ip === 'unknown') return false;
  if (referral.lastPosterGeneratedIp === ip) return true;
  return events.some((record) => record.referralCode === referral.code && record.ip === ip);
}

async function isBrokerGenerationIp(referral, ip) {
  return matchesBrokerGenerationIp(referral, await readPosterGenerationEvents(), ip);
}

function maskCustomerPhone(value) {
  const phone = cleanText(value, 20).replace(/\D/g, '');
  return /^1[3-9]\d{9}$/.test(phone) ? phone.slice(0, 3) + '****' + phone.slice(-4) : '--';
}

function maskIpAddress(value) {
  const ip = normalizeIpAddress(value);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.');
    return parts.slice(0, 3).join('.') + '.*';
  }
  if (ip.includes(':')) return ip.split(':').filter(Boolean).slice(0, 3).join(':') + ':*';
  return '--';
}

function buildBrokerRecords(
  { applications = [], visits = [], contactClicks = [] },
  referral,
  type = 'customers',
  requestedPage = 1,
  requestedPageSize = 10,
) {
  const pageSize = Math.min(20, Math.max(5, Number.parseInt(requestedPageSize, 10) || 10));
  const matchingApplications = applications
    .filter((record) => (
      record.referralCode === referral.code
      && record.inviterPhone === referral.phone
    ));
  const matchingVisits = visits.filter((record) => (
    record.referralCode === referral.code
    && record.inviterPhone === referral.phone
  ));
  const matchingClicks = contactClicks.filter((record) => (
    record.referralCode === referral.code
    && record.inviterPhone === referral.phone
  ));
  const collections = {
    customers: matchingApplications
      .filter((record) => record.status !== 'invalid')
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
      .map((record) => ({
        id: record.id,
        occurredAt: record.submittedAt,
        customerName: record.contactName || '--',
        customerPhone: maskCustomerPhone(record.phone),
      })),
    visits: matchingVisits
      .sort((a, b) => Date.parse(b.lastVisitedAt || b.visitedAt) - Date.parse(a.lastVisitedAt || a.visitedAt))
      .map((record) => ({
        id: record.id,
        occurredAt: record.lastVisitedAt || record.visitedAt,
        maskedIp: maskIpAddress(record.ip),
        location: record.location || '待配置',
        converted: Boolean(record.convertedApplicationId),
        isBrokerSelf: Boolean(record.isBrokerSelf),
        visitCount: Math.max(1, Number(record.visitCount) || 1),
      })),
    calls: matchingClicks
      .sort((a, b) => Date.parse(b.clickedAt) - Date.parse(a.clickedAt))
      .map((record) => ({
        id: record.id,
        occurredAt: record.clickedAt,
        maskedIp: maskIpAddress(record.ip),
        location: record.location || '待配置',
      })),
  };
  const normalizedType = Object.hasOwn(collections, type) ? type : 'customers';
  const matching = collections[normalizedType];
  const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(Math.max(1, Number.parseInt(requestedPage, 10) || 1), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    type: normalizedType,
    records: matching.slice(offset, offset + pageSize),
    stats: {
      visits: matchingVisits.length,
      calls: matchingClicks.length,
      activeCustomers: matchingApplications.filter((record) => record.status !== 'invalid').length,
    },
    pagination: { page, pageSize, total: matching.length, totalPages },
  };
}

async function updateApplicationStatus(id, status) {
  let updatedRecord;
  const operation = async () => {
    const records = await readApplications();
    const record = records.find((item) => item.id === id);
    if (!record) {
      throw Object.assign(new Error('申请记录不存在'), { statusCode: 404 });
    }

    record.status = status;
    if (status === 'invalid') {
      record.invalidatedAt = new Date().toISOString();
    } else {
      delete record.invalidatedAt;
    }
    updatedRecord = record;
    await writeApplications(records);
  };

  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  await result;
  return updatedRecord;
}

async function clearReferralStatistics(code) {
  let result;
  const operation = async () => {
    const [inviters, applications, visits, customerOpenings, contactClicks, brokerOpenings, posterEvents] = await Promise.all([
      readInviters(),
      readApplications(),
      readReferralVisits(),
      readReferralOpenings(),
      readContactClicks(),
      readBrokerOpenings(),
      readPosterGenerationEvents(),
    ]);
    const referral = inviters.find((record) => record.code === code);
    if (!referral) {
      throw Object.assign(new Error('经纪人记录不存在'), { statusCode: 404 });
    }
    const filteredApplications = applications.filter((record) => record.referralCode !== code);
    const filteredVisits = visits.filter((record) => record.referralCode !== code);
    const filteredCustomerOpenings = customerOpenings.filter((record) => record.referralCode !== code);
    const filteredContactClicks = contactClicks.filter((record) => record.referralCode !== code);
    const filteredBrokerOpenings = brokerOpenings.filter((record) => (
      !record.inviterPhone || record.inviterPhone !== referral.phone
    ));
    const filteredPosterEvents = posterEvents.filter((record) => record.referralCode !== code);
    result = {
      applications: applications.length - filteredApplications.length,
      visits: visits.length - filteredVisits.length,
      customerOpenings: customerOpenings.length - filteredCustomerOpenings.length,
      contactClicks: contactClicks.length - filteredContactClicks.length,
      brokerOpenings: brokerOpenings.length - filteredBrokerOpenings.length,
      posterGenerations: Math.max(0, Number(referral.posterGenerationCount) || 0),
    };
    referral.posterGenerationCount = 0;
    delete referral.lastPosterGeneratedAt;
    delete referral.lastPosterGeneratedIp;
    await writeApplications(filteredApplications);
    await writeReferralVisits(filteredVisits);
    await writeReferralOpenings(filteredCustomerOpenings);
    await writeContactClicks(filteredContactClicks);
    await writeBrokerOpenings(filteredBrokerOpenings);
    await writePosterGenerationEvents(filteredPosterEvents);
    await writeInviters(inviters);
  };

  const queued = writeQueue.then(operation, operation);
  writeQueue = queued.catch(() => {});
  await queued;
  return result;
}

async function hasAdminAccess(request) {
  return Boolean(await getAdminUser(request));
}

function getChinaDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function matchesFilter(record, query) {
  if (query.keyword) {
    const haystack = [record.contactName, record.phone, record.inviterName, record.inviterPhone, record.id]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('zh-CN');
    if (!haystack.includes(query.keyword)) return false;
  }
  if (query.employment && record.employment !== query.employment) return false;
  if (query.socialSecurity && record.socialSecurity !== query.socialSecurity) return false;
  if (query.maritalStatus && record.maritalStatus !== query.maritalStatus) return false;
  return true;
}

function buildTrafficStats(visits, applications) {
  const customerVisits = visits.filter((visit) => !visit.isBrokerSelf);
  const uniqueVisitors = new Set(customerVisits.map((visit) => (
    visit.referralCode + ':' + (visit.visitorId || visit.ip || visit.id)
  ))).size;
  const referredApplications = applications.filter((record) => record.referralCode);
  const submissions = referredApplications.length;
  return {
    visits: customerVisits.length,
    uniqueVisitors,
    submissions,
    validSubmissions: referredApplications.filter((record) => record.status !== 'invalid').length,
    conversionRate: uniqueVisitors > 0 ? Math.round((submissions / uniqueVisitors) * 1000) / 10 : 0,
  };
}

function getTrafficStartTime(period) {
  if (period === 'all') return 0;
  if (period === 'today') return Date.parse(getChinaDate() + 'T00:00:00+08:00');
  const days = ['7', '30', '90'].includes(period) ? Number(period) : 30;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function buildBrokerRanking(
  visits,
  applications,
  inviters,
  contactClicks = [],
  posterGenerationEvents = [],
  useLifetimePosterCount = false,
) {
  const invitersByCode = new Map(inviters.map((record) => [record.code, record]));
  const ranking = new Map();
  const ensure = (code) => {
    if (!ranking.has(code)) {
      const inviter = invitersByCode.get(code) || {};
      ranking.set(code, {
        referralCode: code,
        inviterName: inviter.name || '',
        inviterPhone: inviter.phone || '',
        visits: 0,
        visitorIds: new Set(),
        submissions: 0,
        validSubmissions: 0,
        posterGenerations: 0,
        contactClicks: 0,
        lastActivityAt: '',
      });
    }
    return ranking.get(code);
  };
  const recordActivity = (item, value) => {
    if (value && (!item.lastActivityAt || Date.parse(value) > Date.parse(item.lastActivityAt))) {
      item.lastActivityAt = value;
    }
  };

  for (const visit of visits) {
    if (!visit.referralCode || visit.isBrokerSelf) continue;
    const item = ensure(visit.referralCode);
    item.inviterName = item.inviterName || visit.inviterName || '';
    item.inviterPhone = item.inviterPhone || visit.inviterPhone || '';
    item.visits += 1;
    item.visitorIds.add(visit.visitorId || visit.ip || visit.id);
    recordActivity(item, visit.lastVisitedAt || visit.visitedAt);
  }

  for (const application of applications) {
    if (!application.referralCode) continue;
    const item = ensure(application.referralCode);
    item.inviterName = item.inviterName || application.inviterName || '';
    item.inviterPhone = item.inviterPhone || application.inviterPhone || '';
    item.submissions += 1;
    if (application.status !== 'invalid') item.validSubmissions += 1;
    recordActivity(item, application.submittedAt);
  }

  for (const click of contactClicks) {
    if (!click.referralCode) continue;
    const item = ensure(click.referralCode);
    item.inviterName = item.inviterName || click.inviterName || '';
    item.inviterPhone = item.inviterPhone || click.inviterPhone || '';
    item.contactClicks += 1;
    recordActivity(item, click.clickedAt);
  }

  for (const event of posterGenerationEvents) {
    if (!event.referralCode) continue;
    const item = ensure(event.referralCode);
    item.inviterName = item.inviterName || event.inviterName || '';
    item.inviterPhone = item.inviterPhone || event.inviterPhone || '';
    item.posterGenerations += 1;
    recordActivity(item, event.generatedAt);
  }

  if (useLifetimePosterCount) {
    for (const inviter of inviters) {
      const count = Math.max(0, Number(inviter.posterGenerationCount) || 0);
      if (count < 1) continue;
      const item = ensure(inviter.code);
      item.posterGenerations = count;
      recordActivity(item, inviter.lastPosterGeneratedAt);
    }
  }

  return [...ranking.values()].map(({ visitorIds, ...item }) => ({
    ...item,
    lastVisitedAt: item.lastActivityAt,
    uniqueVisitors: visitorIds.size,
    conversionRate: visitorIds.size > 0
      ? Math.round((item.submissions / visitorIds.size) * 1000) / 10
      : 0,
  })).sort((a, b) => (
    b.validSubmissions - a.validSubmissions
    || b.submissions - a.submissions
    || b.posterGenerations - a.posterGenerations
    || b.contactClicks - a.contactClicks
    || b.uniqueVisitors - a.uniqueVisitors
    || b.visits - a.visits
  ));
}

function buildBrokerActivityDetails(source, referral, type, requestedPage = 1, requestedPageSize = 20) {
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(requestedPageSize, 10) || 20));
  let records = [];
  let untrackedCount = 0;

  if (type === 'posters') {
    records = source.posterGenerationEvents
      .filter((record) => record.referralCode === referral.code)
      .map((record) => ({
        id: record.id,
        occurredAt: record.generatedAt,
        status: '生成成功',
      }));
    untrackedCount = Math.max(0, (Number(referral.posterGenerationCount) || 0) - records.length);
  } else if (type === 'calls') {
    records = source.contactClicks
      .filter((record) => record.referralCode === referral.code)
      .map((record) => ({
        id: record.id,
        occurredAt: record.clickedAt,
        servicePhone: record.servicePhone || '',
        status: '已点击拨打',
      }));
  } else if (type === 'visits') {
    const visitors = new Map();
    for (const visit of source.visits.filter((record) => (
      record.referralCode === referral.code && !record.isBrokerSelf
    ))) {
      const visitorKey = visit.visitorId || visit.ip || visit.id;
      if (!visitors.has(visitorKey)) {
        visitors.set(visitorKey, {
          id: visitorKey,
          occurredAt: visit.visitedAt,
          firstVisitedAt: visit.visitedAt,
          visitCount: 0,
          converted: false,
        });
      }
      const item = visitors.get(visitorKey);
      item.visitCount += 1;
      item.converted = item.converted || Boolean(visit.convertedApplicationId);
      if (Date.parse(visit.visitedAt) < Date.parse(item.firstVisitedAt)) item.firstVisitedAt = visit.visitedAt;
      if (Date.parse(visit.visitedAt) > Date.parse(item.occurredAt)) item.occurredAt = visit.visitedAt;
    }
    records = [...visitors.values()];
  } else {
    throw Object.assign(new Error('明细类型不正确'), { statusCode: 422 });
  }

  records.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const page = Math.min(Math.max(1, Number.parseInt(requestedPage, 10) || 1), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    type,
    inviterName: referral.name || '',
    inviterPhone: referral.phone || '',
    records: records.slice(offset, offset + pageSize),
    untrackedCount,
    pagination: { page, pageSize, total: records.length, totalPages },
  };
}

function buildPosterGenerationStats(inviters, keyword = '', requestedPage = 1, requestedPageSize = 20) {
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(requestedPageSize, 10) || 20));
  const generated = inviters.filter((record) => Math.max(0, Number(record.posterGenerationCount) || 0) > 0);
  const normalizedKeyword = cleanText(keyword, 50).toLocaleLowerCase('zh-CN');
  const matching = generated.filter((record) => {
    if (!normalizedKeyword) return true;
    return [record.name, record.phone]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(normalizedKeyword);
  }).sort((a, b) => Date.parse(b.lastPosterGeneratedAt || 0) - Date.parse(a.lastPosterGeneratedAt || 0));
  const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(Math.max(1, Number.parseInt(requestedPage, 10) || 1), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    records: matching.slice(offset, offset + pageSize).map((record) => ({
      referralCode: record.code,
      inviterName: record.name || '',
      inviterPhone: record.phone || '',
      generationCount: Math.max(0, Number(record.posterGenerationCount) || 0),
      lastGeneratedAt: record.lastPosterGeneratedAt || '',
    })),
    stats: {
      brokers: generated.length,
      totalGenerations: generated.reduce((sum, record) => (
        sum + Math.max(0, Number(record.posterGenerationCount) || 0)
      ), 0),
    },
    pagination: { page, pageSize, total: matching.length, totalPages },
  };
}

function buildOpeningStats(customerOpenings, brokerOpenings, keyword = '', requestedPage = 1, requestedPageSize = 20) {
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(requestedPageSize, 10) || 20));
  const normalizedKeyword = cleanText(keyword, 50).toLocaleLowerCase('zh-CN');
  const matchesKeyword = (record) => !normalizedKeyword || [
    record.inviterName,
    record.inviterPhone,
    record.ip,
  ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(normalizedKeyword);
  const customerRecords = customerOpenings.filter((record) => !record.isBrokerSelf).map((record) => ({
    id: record.id,
    type: '客户打开',
    inviterName: record.inviterName || '',
    inviterPhone: record.inviterPhone || '',
    ip: record.ip || '',
    openedAt: record.openedAt,
  }));
  const brokerSelfRecords = customerOpenings.filter((record) => record.isBrokerSelf).map((record) => ({
    id: record.id,
    type: '经纪人本人',
    inviterName: record.inviterName || '',
    inviterPhone: record.inviterPhone || '',
    ip: record.ip || '',
    openedAt: record.openedAt,
  }));
  const brokerRecords = [...brokerOpenings.map((record) => ({
    id: record.id,
    type: '经纪人打开',
    inviterName: record.inviterName || '',
    inviterPhone: record.inviterPhone || '',
    ip: record.ip || '',
    openedAt: record.openedAt,
  })), ...brokerSelfRecords];
  const allRecords = [...customerRecords, ...brokerRecords]
    .filter(matchesKeyword)
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  const daily = new Map();
  for (const record of allRecords) {
    const date = getChinaDate(record.openedAt);
    const item = daily.get(date) || { date, customerOpens: 0, brokerOpens: 0, total: 0 };
    item.total += 1;
    if (record.type === '客户打开') item.customerOpens += 1;
    else item.brokerOpens += 1;
    daily.set(date, item);
  }
  const totalPages = Math.max(1, Math.ceil(allRecords.length / pageSize));
  const page = Math.min(Math.max(1, Number.parseInt(requestedPage, 10) || 1), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    daily: [...daily.values()].sort((a, b) => b.date.localeCompare(a.date)),
    records: allRecords.slice(offset, offset + pageSize),
    stats: {
      customerOpens: customerRecords.filter(matchesKeyword).length,
      brokerOpens: brokerRecords.filter(matchesKeyword).length,
      totalOpens: allRecords.length,
    },
    pagination: { page, pageSize, total: allRecords.length, totalPages },
  };
}

async function handleReferralVisit(request, response) {
  if (isVisitRateLimited(request)) {
    sendJson(response, 429, { ok: false, message: '访问记录过于频繁' });
    return;
  }

  try {
    const input = await readJsonBody(request);
    const referralCode = cleanText(input.referralCode, 32);
    const visitorId = cleanText(input.visitorId, 64);
    if (!/^[a-f0-9]{16}$/.test(referralCode) || !isValidVisitorId(visitorId)) {
      sendJson(response, 422, { ok: false, message: '访问标识无效' });
      return;
    }

    const referral = await findReferral(referralCode);
    if (!referral) {
      sendJson(response, 404, { ok: false, message: '邀请链接不存在' });
      return;
    }

    const ip = normalizeIpAddress(getClientAddress(request));
    const result = await persistReferralVisit({
      referral,
      visitorId,
      ip,
      userAgent: cleanText(request.headers['user-agent'], 180),
      isBrokerSelf: await isBrokerGenerationIp(referral, ip),
    });
    sendJson(response, 201, {
      ok: true,
      deduplicated: result.deduplicated,
    });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '访问记录失败',
    });
  }
}

async function handleBrokerOpening(request, response) {
  if (isRateLimited(request)) {
    sendJson(response, 429, { ok: false, message: '访问记录过于频繁' });
    return;
  }

  try {
    const input = await readJsonBody(request);
    const name = cleanText(input.name, 20);
    const phone = cleanText(input.phone, 20).replace(/[\s-]/g, '');
    if ((name && !isValidPersonName(name)) || (phone && !isValidPhone(phone))) {
      sendJson(response, 422, { ok: false, message: '经纪人信息不正确' });
      return;
    }
    const record = await persistBrokerOpening({
      name,
      phone,
      ip: normalizeIpAddress(getClientAddress(request)),
      userAgent: cleanText(request.headers['user-agent'], 180),
    });
    sendJson(response, 201, { ok: true, openedAt: record.openedAt });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '经纪人打开记录失败',
    });
  }
}

async function handlePublicContactSettings(response) {
  try {
    const settings = await readContactSettings();
    const active = isContactSettingsActive(settings);
    sendJson(response, 200, {
      ok: true,
      data: {
        active,
        phone: active ? settings.phone : '',
        startTime: settings.startTime,
        endTime: settings.endTime,
      },
    });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '客服电话设置读取失败' });
  }
}

async function handleAdminContactSettings(request, response) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }

  try {
    if (request.method === 'GET') {
      const settings = await readContactSettings();
      sendJson(response, 200, {
        ok: true,
        data: { ...settings, active: isContactSettingsActive(settings) },
      });
      return;
    }

    const input = await readJsonBody(request);
    const phone = cleanText(input.phone, 20).replace(/\D/g, '');
    const startTime = cleanText(input.startTime, 5);
    const endTime = cleanText(input.endTime, 5);
    if (phone && !isValidPhone(phone)) {
      sendJson(response, 422, { ok: false, message: '请输入正确的 11 位客服电话' });
      return;
    }
    if (!isValidClockTime(startTime) || !isValidClockTime(endTime)) {
      sendJson(response, 422, { ok: false, message: '请选择正确的客服电话开放时间' });
      return;
    }
    const settings = normalizeContactSettings({ phone, startTime, endTime });
    const operation = async () => writeContactSettings(settings);
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    await result;
    sendJson(response, 200, {
      ok: true,
      data: { ...settings, active: isContactSettingsActive(settings) },
      message: phone ? '客服电话设置已保存' : '客服电话已关闭',
    });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '客服电话设置保存失败',
    });
  }
}

async function handleContactClick(request, response) {
  if (isVisitRateLimited(request)) {
    sendJson(response, 429, { ok: false, message: '操作过于频繁，请稍后再试' });
    return;
  }

  try {
    const settings = await readContactSettings();
    if (!isContactSettingsActive(settings)) {
      sendJson(response, 409, { ok: false, message: '当前不在客服电话开放时间内' });
      return;
    }
    const input = await readJsonBody(request);
    const visitorId = cleanText(input.visitorId, 64);
    if (!isValidVisitorId(visitorId)) {
      sendJson(response, 422, { ok: false, message: '访问标识无效，请刷新页面重试' });
      return;
    }
    const referralCode = cleanText(input.referralCode, 32);
    if (referralCode && !/^[a-f0-9]{16}$/.test(referralCode)) {
      sendJson(response, 422, { ok: false, message: '邀请链接无效' });
      return;
    }
    const referral = referralCode ? await findReferral(referralCode) : null;
    if (referralCode && !referral) {
      sendJson(response, 404, { ok: false, message: '邀请链接不存在' });
      return;
    }
    await persistContactClick({
      settings,
      referral,
      visitorId,
      ip: normalizeIpAddress(getClientAddress(request)),
      userAgent: cleanText(request.headers['user-agent'], 180),
    });
    sendJson(response, 201, { ok: true });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '电话点击记录失败',
    });
  }
}

async function handleAdminTraffic(request, response, url) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }

  try {
    const period = cleanText(url.searchParams.get('period'), 10) || '30';
    const rankingPeriod = ['all', 'today', '7'].includes(url.searchParams.get('rankingPeriod'))
      ? url.searchParams.get('rankingPeriod')
      : 'today';
    const keyword = cleanText(url.searchParams.get('q'), 50).toLocaleLowerCase('zh-CN');
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page'), 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get('pageSize'), 10) || 20));
    const posterPage = Math.max(1, Number.parseInt(url.searchParams.get('posterPage'), 10) || 1);
    const startTime = getTrafficStartTime(period);
    const [allVisits, allApplications, inviters, allContactClicks, allCustomerOpenings, allBrokerOpenings, allPosterEvents] = await Promise.all([
      readReferralVisits(),
      readApplications(),
      readInviters(),
      readContactClicks(),
      readReferralOpenings(),
      readBrokerOpenings(),
      readPosterGenerationEvents(),
    ]);
    const visits = allVisits.filter((record) => Date.parse(record.visitedAt) >= startTime);
    const applications = allApplications.filter((record) => Date.parse(record.submittedAt) >= startTime);
    const contactClicks = allContactClicks.filter((record) => Date.parse(record.clickedAt) >= startTime);
    const customerOpenings = allCustomerOpenings.filter((record) => Date.parse(record.openedAt) >= startTime);
    const brokerOpenings = allBrokerOpenings.filter((record) => Date.parse(record.openedAt) >= startTime);
    const rankingStartTime = getTrafficStartTime(rankingPeriod);
    const rankingVisits = allVisits.filter((record) => Date.parse(record.visitedAt) >= rankingStartTime);
    const rankingApplications = allApplications.filter((record) => Date.parse(record.submittedAt) >= rankingStartTime);
    const rankingContactClicks = allContactClicks.filter((record) => Date.parse(record.clickedAt) >= rankingStartTime);
    const rankingPosterEvents = allPosterEvents.filter((record) => Date.parse(record.generatedAt) >= rankingStartTime);
    const ranking = buildBrokerRanking(
      rankingVisits,
      rankingApplications,
      inviters,
      rankingContactClicks,
      rankingPosterEvents,
      rankingPeriod === 'all',
    ).filter((record) => {
      if (!keyword) return true;
      return [record.inviterName, record.inviterPhone].join(' ').toLocaleLowerCase('zh-CN').includes(keyword);
    });
    const matchingVisits = [...visits].filter((record) => {
      if (!keyword) return true;
      return [record.inviterName, record.inviterPhone, record.ip, record.location]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(keyword);
    }).sort((a, b) => Date.parse(b.visitedAt) - Date.parse(a.visitedAt));
    const matchingContactClicks = [...contactClicks].filter((record) => {
      if (!keyword) return true;
      return [record.inviterName, record.inviterPhone, record.servicePhone, record.ip, record.location]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(keyword);
    }).sort((a, b) => Date.parse(b.clickedAt) - Date.parse(a.clickedAt));
    const totalPages = Math.max(1, Math.ceil(matchingVisits.length / pageSize));
    const effectivePage = Math.min(page, totalPages);
    const offset = (effectivePage - 1) * pageSize;
    const today = getChinaDate();
    const stats = buildTrafficStats(visits, applications);
    const posterGenerations = buildPosterGenerationStats(inviters, keyword, posterPage, pageSize);
    const openingPage = Math.max(1, Number.parseInt(url.searchParams.get('openingPage'), 10) || 1);
    const openingStats = buildOpeningStats(customerOpenings, brokerOpenings, keyword, openingPage, pageSize);
    const actualCustomerOpenings = customerOpenings.filter((record) => !record.isBrokerSelf);
    const brokerSelfOpenings = customerOpenings.filter((record) => record.isBrokerSelf);

    sendJson(response, 200, {
      ok: true,
      stats: {
        ...stats,
        visits: actualCustomerOpenings.length,
        todayVisits: actualCustomerOpenings.filter((record) => getChinaDate(record.openedAt) === today).length,
        customerOpens: actualCustomerOpenings.length,
        todayCustomerOpens: actualCustomerOpenings.filter((record) => getChinaDate(record.openedAt) === today).length,
        brokerOpens: brokerOpenings.length + brokerSelfOpenings.length,
        todayBrokerOpens: [...brokerOpenings, ...brokerSelfOpenings]
          .filter((record) => getChinaDate(record.openedAt) === today).length,
        contactClicks: contactClicks.length,
        todayContactClicks: contactClicks.filter((record) => getChinaDate(record.clickedAt) === today).length,
      },
      ranking,
      rankingPeriod,
      posterGenerations,
      openingStats,
      visits: matchingVisits.slice(offset, offset + pageSize).map((record) => ({
        id: record.id,
        visitedAt: record.visitedAt,
        inviterName: record.inviterName,
        inviterPhone: record.inviterPhone,
        ip: record.ip,
        location: record.location || '待配置',
        converted: Boolean(record.convertedApplicationId),
        isBrokerSelf: Boolean(record.isBrokerSelf),
      })),
      contactClicks: matchingContactClicks.slice(0, 100).map((record) => ({
        id: record.id,
        clickedAt: record.clickedAt,
        servicePhone: record.servicePhone,
        inviterName: record.inviterName,
        inviterPhone: record.inviterPhone,
        ip: record.ip,
        location: record.location || '待配置',
      })),
      pagination: {
        page: effectivePage,
        pageSize,
        total: matchingVisits.length,
        totalPages,
      },
      locationEnabled: Boolean(IP_GEOLOCATION_URL),
      retentionLimit: MAX_REFERRAL_VISITS,
    });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '推广统计读取失败，请稍后重试' });
  }
}

async function handleAdminBrokerActivity(request, response, url, code) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }

  try {
    const inviters = await readInviters();
    const referral = inviters.find((record) => record.code === code);
    if (!referral) {
      sendJson(response, 404, { ok: false, message: '未找到对应的经纪人' });
      return;
    }
    const type = cleanText(url.searchParams.get('type'), 20);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page'), 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get('pageSize'), 10) || 20));
    const [visits, contactClicks, posterGenerationEvents] = await Promise.all([
      readReferralVisits(),
      readContactClicks(),
      readPosterGenerationEvents(),
    ]);
    sendJson(response, 200, {
      ok: true,
      ...buildBrokerActivityDetails(
        { visits, contactClicks, posterGenerationEvents },
        referral,
        type,
        page,
        pageSize,
      ),
    });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '经纪人明细读取失败，请稍后重试',
    });
  }
}

async function handleAdminReferralStatisticsDelete(request, response, code) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }
  if (!/^[a-f0-9]{16}$/.test(code)) {
    sendJson(response, 422, { ok: false, message: '经纪人标识不正确' });
    return;
  }
  try {
    const deleted = await clearReferralStatistics(code);
    sendJson(response, 200, { ok: true, deleted, message: '经纪人推广统计已删除' });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '推广统计删除失败',
    });
  }
}

async function handleReferral(request, response) {
  if (isRateLimited(request)) {
    sendJson(response, 429, { ok: false, message: '生成过于频繁，请稍后再试' });
    return;
  }

  try {
    const input = await readJsonBody(request);
    const name = cleanText(input.name, 20);
    const phone = cleanText(input.phone, 20).replace(/[\s-]/g, '');
    if (!isValidPersonName(name)) {
      sendJson(response, 422, { ok: false, message: '请输入正确的邀请人姓名' });
      return;
    }
    if (!isValidPhone(phone)) {
      sendJson(response, 422, { ok: false, message: '请输入正确的邀请人手机号' });
      return;
    }
    const referral = await getOrCreateReferral(phone, name);
    sendJson(response, 200, {
      ok: true,
      code: referral.code,
      name: referral.name || '',
      message: '邀请链接已生成',
    });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '生成失败，请稍后重试',
    });
  }
}

async function handlePosterGeneration(request, response) {
  if (isRateLimited(request)) {
    sendJson(response, 429, { ok: false, message: '操作过于频繁，请稍后再试' });
    return;
  }

  try {
    const input = await readJsonBody(request);
    const code = cleanText(input.code, 32);
    const phone = cleanText(input.phone, 20).replace(/[\s-]/g, '');
    if (!/^[a-f0-9]{16}$/.test(code) || !isValidPhone(phone)) {
      sendJson(response, 422, { ok: false, message: '经纪人信息不正确' });
      return;
    }
    const referral = await recordPosterGeneration(
      code,
      phone,
      normalizeIpAddress(getClientAddress(request)),
      cleanText(request.headers['user-agent'], 180),
    );
    sendJson(response, 201, {
      ok: true,
      generationCount: referral.posterGenerationCount,
      lastGeneratedAt: referral.lastPosterGeneratedAt,
    });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '海报生成记录失败',
    });
  }
}

async function handleBrokerRecords(request, response, url) {
  if (isVisitRateLimited(request)) {
    sendJson(response, 429, { ok: false, message: '查询过于频繁，请稍后再试' });
    return;
  }

  try {
    const phone = cleanText(url.searchParams.get('phone'), 20).replace(/[\s-]/g, '');
    const code = cleanText(url.searchParams.get('code'), 32);
    if (!isValidPhone(phone) || !/^[a-f0-9]{16}$/.test(code)) {
      sendJson(response, 422, { ok: false, message: '经纪人信息不正确' });
      return;
    }
    const referral = await findReferral(code);
    if (!referral || referral.phone !== phone) {
      sendJson(response, 404, { ok: false, message: '未找到对应的经纪人信息' });
      return;
    }
    const type = cleanText(url.searchParams.get('type'), 20) || 'customers';
    const [applications, visits, contactClicks] = await Promise.all([
      readApplications(),
      readReferralVisits(),
      readContactClicks(),
    ]);
    const result = buildBrokerRecords(
      { applications, visits, contactClicks },
      referral,
      type,
      url.searchParams.get('page'),
      url.searchParams.get('pageSize'),
    );
    sendJson(response, 200, {
      ok: true,
      inviter: { name: referral.name || '', phone: referral.phone },
      type: result.type,
      data: result.records,
      stats: result.stats,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '邀请记录读取失败，请稍后重试' });
  }
}

async function handleAdminPosters(request, response) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }

  try {
    const posters = await readPosters();
    const sorted = [...posters].sort((a, b) => {
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    });
    sendJson(response, 200, {
      ok: true,
      data: sorted.map(publicPoster),
      latestId: sorted[0]?.id || '',
    });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '海报读取失败，请稍后重试' });
  }
}

async function handlePosterUpload(request, response) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }

  try {
    const input = await readJsonBody(request, MAX_POSTER_BODY_BYTES);
    const created = await savePosters(input.files);
    const latest = created[created.length - 1];
    sendJson(response, 201, {
      ok: true,
      data: created.map(publicPoster),
      latestId: latest.id,
      message: '海报上传成功',
    });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '海报上传失败，请稍后重试',
    });
  }
}

async function handlePublicPosterSettings(response) {
  try {
    const settings = await readPosterSettings();
    sendJson(response, 200, { ok: true, data: settings });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '海报设置读取失败，请稍后重试' });
  }
}

async function handleAdminPosterSettings(request, response) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }

  try {
    if (request.method === 'GET') {
      const settings = await readPosterSettings();
      sendJson(response, 200, { ok: true, data: settings });
      return;
    }

    const input = await readJsonBody(request);
    const current = await readPosterSettings();
    const settings = normalizePosterSettings({ ...current, ...input });
    if (!settings.autoCopyEnabled && settings.customCopyTemplates.length < 1) {
      sendJson(response, 422, { ok: false, message: '关闭自动生成前，请至少填写一条自定义文案' });
      return;
    }
    const operation = async () => writePosterSettings(settings);
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    await result;
    sendJson(response, 200, {
      ok: true,
      data: settings,
      message: Object.hasOwn(input, 'autoCopyEnabled') || Object.hasOwn(input, 'customCopyTemplates')
        ? '文案设置已保存'
        : settings.autoEnabled ? '已开启自动生成海报' : '已切换为使用上传海报',
    });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '海报设置保存失败，请稍后重试',
    });
  }
}

async function handleAdminPasswordChange(request, response) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }

  try {
    const input = await readJsonBody(request);
    const currentPassword = cleanText(input.currentPassword, 128);
    const newPassword = cleanText(input.newPassword, 128);
    if (!await verifyAdminPassword(currentPassword)) {
      sendJson(response, 422, { ok: false, message: '当前密码不正确' });
      return;
    }
    if (!isValidAdminPassword(newPassword)) {
      sendJson(response, 422, { ok: false, message: '新密码长度需为 8 至 72 位' });
      return;
    }

    const auth = await hashAdminPassword(newPassword);
    const operation = async () => writeAdminAuth(auth);
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    await result;
    sendJson(response, 200, { ok: true, message: '管理员密码已修改' });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '密码修改失败，请稍后重试',
    });
  }
}

async function handleLatestPoster(response) {
  try {
    const posters = await readPosters();
    const latest = posters.sort((a, b) => {
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    })[0];
    if (!latest) {
      sendJson(response, 404, { ok: false, message: '后台尚未上传海报' });
      return;
    }
    sendJson(response, 200, { ok: true, data: publicPoster(latest) });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '海报读取失败，请稍后重试' });
  }
}

async function handlePosterFile(response, id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const posters = await readPosters();
    const poster = posters.find((item) => item.id === id);
    if (!poster) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await fs.readFile(path.join(POSTERS_DIR, poster.filename));
    response.writeHead(200, {
      'Content-Type': poster.mimeType,
      'Content-Length': content.length,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
  }
}

async function handleAdminApplications(request, response, url) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }

  try {
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page'), 10) || 1);
    const pageSize = Math.min(50, Math.max(5, Number.parseInt(url.searchParams.get('pageSize'), 10) || 10));
    const query = {
      keyword: cleanText(url.searchParams.get('q'), 50).toLocaleLowerCase('zh-CN'),
      employment: cleanText(url.searchParams.get('employment'), 20),
      socialSecurity: cleanText(url.searchParams.get('socialSecurity'), 20),
      maritalStatus: cleanText(url.searchParams.get('maritalStatus'), 20),
      status: cleanText(url.searchParams.get('status'), 10) || 'active',
    };
    const records = await readApplications();
    const sorted = [...records].sort((a, b) => {
      return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    });
    const filtered = sorted.filter((record) => {
      const recordStatus = record.status === 'invalid' ? 'invalid' : 'active';
      const statusMatches = query.status === 'all' || recordStatus === query.status;
      return statusMatches && matchesFilter(record, query);
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const effectivePage = Math.min(page, totalPages);
    const offset = (effectivePage - 1) * pageSize;
    const today = getChinaDate();

    sendJson(response, 200, {
      ok: true,
      data: filtered.slice(offset, offset + pageSize).map(({ privacyAccepted, ...record }) => ({
        ...record,
        status: record.status === 'invalid' ? 'invalid' : 'active',
      })),
      pagination: {
        page: effectivePage,
        pageSize,
        total: filtered.length,
        totalPages,
      },
      stats: {
        total: records.length,
        today: records.filter((record) => getChinaDate(record.submittedAt) === today).length,
        housingFund: records.filter((record) => record.socialSecurity === 'housing_fund').length,
        invalid: records.filter((record) => record.status === 'invalid').length,
      },
    });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '数据读取失败，请稍后重试' });
  }
}

async function handleAdminStatusUpdate(request, response, id) {
  if (!await hasAdminAccess(request)) {
    sendJson(response, 401, { ok: false, message: '管理员密码不正确' });
    return;
  }

  try {
    const input = await readJsonBody(request);
    if (!['active', 'invalid'].includes(input.status)) {
      sendJson(response, 422, { ok: false, message: '客户状态不正确' });
      return;
    }
    const record = await updateApplicationStatus(id, input.status);
    sendJson(response, 200, {
      ok: true,
      message: input.status === 'invalid' ? '已标记为无效客户' : '客户已恢复有效',
      data: { id: record.id, status: record.status },
    });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '状态更新失败，请稍后重试',
    });
  }
}

async function handleApplication(request, response) {
  if (isRateLimited(request)) {
    sendJson(response, 429, { ok: false, message: '提交过于频繁，请稍后再试' });
    return;
  }

  try {
    const input = await readJsonBody(request);
    const { data, errors } = validateApplication(input);
    if (Object.keys(errors).length > 0) {
      sendJson(response, 422, { ok: false, message: '请检查填写内容', errors });
      return;
    }
    const referralCode = cleanText(input.referralCode, 32);
    if (referralCode && !/^[a-f0-9]{16}$/.test(referralCode)) {
      sendJson(response, 422, { ok: false, message: '邀请链接无效，请联系邀请人重新生成' });
      return;
    }
    const referral = referralCode ? await findReferral(referralCode) : null;
    if (referralCode && !referral) {
      sendJson(response, 422, { ok: false, message: '邀请链接无效，请联系邀请人重新生成' });
      return;
    }
    const visitorId = cleanText(input.visitorId, 64);
    if (visitorId && !isValidVisitorId(visitorId)) {
      sendJson(response, 422, { ok: false, message: '访问标识无效，请刷新页面重试' });
      return;
    }

    const application = {
      id: crypto.randomUUID(),
      ...data,
      inviterName: referral ? referral.name || '' : '',
      inviterPhone: referral ? referral.phone : '',
      referralCode: referral ? referral.code : '',
      status: 'active',
      submittedAt: new Date().toISOString(),
    };
    await persistApplication(application);
    await markReferralVisitConverted(application.referralCode, visitorId, application.id);
    sendJson(response, 201, {
      ok: true,
      id: application.id,
      message: '申请已提交，我们会尽快与您联系',
    });
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : '服务暂时不可用，请稍后重试',
    });
  }
}

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === '/'
    ? '/index.html'
    : pathname === '/customer-call/'
      ? '/customer-call.html'
      : pathname === '/customer-records-7f3c9a2d84e6/'
        ? '/customer-records.html'
        : pathname.startsWith('/customer-records-7f3c9a2d84e6/')
          ? pathname.slice('/customer-records-7f3c9a2d84e6'.length)
      : pathname === '/zufang' || pathname === '/zufang/'
        ? '/zufang.html'
        : pathname.startsWith('/zufang/')
          ? pathname.slice('/zufang'.length)
      : pathname.startsWith('/customer-call/')
        ? pathname.slice('/customer-call'.length)
        : pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  const filePath = path.resolve(PUBLIC_DIR, '.' + decodedPath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const shouldRevalidate = ['.html', '.js', '.css'].includes(extension);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': shouldRevalidate ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end(error.code === 'ENOENT' ? '页面不存在' : '服务器错误');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://' + request.headers.host);

  if (request.method === 'POST' && url.pathname === '/api/applications') {
    await handleApplication(request, response);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/customer-call-records') {
    await handleCustomerCallRecordCreate(request, response);
    return;
  }
  const rentalCollectionRoute = url.pathname.match(/^\/api\/zufang\/(rooms|leases|maintenance|checkouts|costs|items|ledger|bills)(?:\/([0-9a-f-]{36}))?$/);
  if (rentalCollectionRoute && ['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
    await handleRentalCollection(request, response, request.method === 'PATCH' ? 'PATCH' : request.method, rentalCollectionRoute[1], rentalCollectionRoute[2]);
    return;
  }
  const rentalMaintenanceBatchRoute = url.pathname.match(/^\/api\/zufang\/maintenance-batches(?:\/([0-9a-f-]{36}))?$/);
  if (rentalMaintenanceBatchRoute && ['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
    await handleRentalMaintenanceBatches(request, response, request.method, rentalMaintenanceBatchRoute[1] || '');
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/zufang/public/reimbursements') {
    await handleRentalPublicMaintenanceReport(request, response);
    return;
  }
  if (url.pathname === '/api/zufang/renewals' && ['GET', 'POST'].includes(request.method)) {
    await handleRentalRenewal(request, response, request.method);
    return;
  }
  const rentalMoveInAction = url.pathname.match(/^\/api\/zufang\/move-ins\/([0-9a-f-]{36})\/(generate-contract|upload-signed|complete-payment)$/);
  if (rentalMoveInAction && request.method === 'POST') {
    await handleRentalMoveInAction(request, response, rentalMoveInAction[1], rentalMoveInAction[2]);
    return;
  }
  const rentalMoveInRoute = url.pathname.match(/^\/api\/zufang\/move-ins(?:\/([0-9a-f-]{36}))?$/);
  if (rentalMoveInRoute && ['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
    await handleRentalMoveIns(request, response, request.method, rentalMoveInRoute[1]);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/zufang/settings/contract-template') {
    await handleRentalContractTemplateDownload(request, response);
    return;
  }
  if (url.pathname === '/api/zufang/settings' && ['GET', 'PATCH'].includes(request.method)) {
    await handleRentalSettings(request, response, request.method);
    return;
  }
  if (url.pathname === '/api/zufang/audit' && request.method === 'GET') {
    await handleRentalAudit(request, response);
    return;
  }
  const rentalUsersRoute = url.pathname.match(/^\/api\/zufang\/users(?:\/([^/]+))?$/);
  if (rentalUsersRoute && ['GET', 'POST', 'PATCH'].includes(request.method)) {
    await handleRentalUsers(request, response, request.method, rentalUsersRoute[1] ? decodeURIComponent(rentalUsersRoute[1]) : '');
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/zufang/summary') {
    await handleRentalSummary(request, response);
    return;
  }
  const rentalFileRoute = url.pathname.match(/^\/api\/zufang\/files\/([^/]+)$/);
  if (request.method === 'GET' && rentalFileRoute) {
    await handleRentalFile(request, response, decodeURIComponent(rentalFileRoute[1]), url.searchParams);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/customer-records-7f3c9a2d84e6') {
    await handleCustomerCallRecords(response);
    return;
  }
  const customerCallRecordRoute = url.pathname.match(/^\/api\/customer-records-7f3c9a2d84e6\/([0-9a-f-]{36})$/);
  if (request.method === 'PATCH' && customerCallRecordRoute) {
    await handleCustomerCallRecordUpdate(request, response, customerCallRecordRoute[1]);
    return;
  }
  if (request.method === 'DELETE' && customerCallRecordRoute) {
    await handleCustomerCallRecordDelete(response, customerCallRecordRoute[1]);
    return;
  }
  const customerCallFollowUpRoute = url.pathname.match(/^\/api\/customer-records-7f3c9a2d84e6\/([0-9a-f-]{36})\/follow-ups$/);
  if (request.method === 'POST' && customerCallFollowUpRoute) {
    await handleCustomerCallFollowUpCreate(request, response, customerCallFollowUpRoute[1]);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/referrals') {
    await handleReferral(request, response);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/referrals/poster-generations') {
    await handlePosterGeneration(request, response);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/referrals/records') {
    await handleBrokerRecords(request, response, url);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/referral-visits') {
    await handleReferralVisit(request, response);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/broker-openings') {
    await handleBrokerOpening(request, response);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/contact-settings') {
    await handlePublicContactSettings(response);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/contact-clicks') {
    await handleContactClick(request, response);
    return;
  }
  if ((request.method === 'GET' || request.method === 'PATCH') && url.pathname === '/api/admin/contact-settings') {
    await handleAdminContactSettings(request, response);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/posters') {
    await handleAdminPosters(request, response);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/posters') {
    await handlePosterUpload(request, response);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/posters/settings') {
    await handlePublicPosterSettings(response);
    return;
  }
  if ((request.method === 'GET' || request.method === 'PATCH') && url.pathname === '/api/admin/poster-settings') {
    await handleAdminPosterSettings(request, response);
    return;
  }
  if (request.method === 'PATCH' && url.pathname === '/api/admin/password') {
    await handleAdminPasswordChange(request, response);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/posters/latest') {
    await handleLatestPoster(response);
    return;
  }
  const posterFileRoute = url.pathname.match(/^\/api\/posters\/files\/([^/]+)$/);
  if (request.method === 'GET' && posterFileRoute) {
    await handlePosterFile(response, decodeURIComponent(posterFileRoute[1]));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/applications') {
    await handleAdminApplications(request, response, url);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/traffic') {
    await handleAdminTraffic(request, response, url);
    return;
  }
  const brokerActivityRoute = url.pathname.match(/^\/api\/admin\/referrals\/([a-f0-9]{16})\/activity$/);
  if (request.method === 'GET' && brokerActivityRoute) {
    await handleAdminBrokerActivity(request, response, url, brokerActivityRoute[1]);
    return;
  }
  const referralStatisticsRoute = url.pathname.match(/^\/api\/admin\/referrals\/([a-f0-9]{16})\/statistics$/);
  if (request.method === 'DELETE' && referralStatisticsRoute) {
    await handleAdminReferralStatisticsDelete(request, response, referralStatisticsRoute[1]);
    return;
  }
  const statusRoute = url.pathname.match(/^\/api\/admin\/applications\/([^/]+)\/status$/);
  if (request.method === 'PATCH' && statusRoute) {
    await handleAdminStatusUpdate(request, response, decodeURIComponent(statusRoute[1]));
    return;
  }
  if (request.method === 'GET') {
    await serveStatic(request, response, url.pathname);
    return;
  }

  response.writeHead(405, { Allow: 'GET, POST, PATCH, DELETE' });
  response.end('Method not allowed');
});

if (require.main === module) {
  if (IS_PRODUCTION && !process.env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD is required in production');
  }
  server.listen(PORT, HOST, () => {
    console.log('Rental manager is running at http://localhost:' + PORT);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('Admin is using the development password. Set ADMIN_PASSWORD before deployment.');
    }
  });
}

module.exports = {
  server,
  validateApplication,
  persistApplication,
  readApplications,
  matchesFilter,
  isValidPhone,
  isValidPersonName,
  getOrCreateReferral,
  detectImageType,
  normalizePosterSettings,
  isValidAdminPassword,
  isValidVisitorId,
  normalizeContactSettings,
  isContactSettingsActive,
  buildTrafficStats,
  buildBrokerRanking,
  buildBrokerActivityDetails,
  buildPosterGenerationStats,
  buildOpeningStats,
  matchesBrokerGenerationIp,
  buildBrokerRecords,
  buildRentalMaintenanceBatchList,
  buildRentalMaintenanceBatchReport,
  updateApplicationStatus,
  normalizeRentalLease,
  normalizeRentalMoveIn,
  fillDocxTemplate,
  normalizeRentalRenewal,
  normalizeRentalRoom,
  normalizeRentalItem,
  rentalItemMaintenanceInput,
  calculateRentalRenewalPeriod,
  rentalLeaseTotal,
  rentalSummary,
  buildRentalReimbursementReport,
  normalizeRentalFileUrl,
  mergeRentalCollectionInput,
  signRentalFileUrl,
  hasValidRentalFileSignature,
};

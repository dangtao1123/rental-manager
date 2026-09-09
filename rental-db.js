const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

let database;
let dataDirectory;

const FILE_DEFINITIONS = {
  'rental-rooms.json': { table: 'rental_rooms', columns: ['room_no', 'property_name', 'status'] },
  'rental-leases.json': { table: 'rental_leases', columns: ['room_no', 'tenant_name', 'status', 'paid_through'] },
  'rental-maintenance.json': { table: 'rental_maintenance', columns: ['room_no', 'maintenance_date', 'status', 'amount'] },
  'rental-checkouts.json': { table: 'rental_checkouts', columns: ['room_no', 'checkout_date'] },
  'rental-costs.json': { table: 'rental_costs', columns: ['room_no', 'cost_date', 'cost_type', 'amount'] },
  'rental-room-items.json': { table: 'rental_items', columns: ['room_no', 'name'] },
  'rental-ledger.json': { table: 'rental_ledger', columns: ['room_no', 'record_date', 'direction', 'category', 'amount'] },
  'rental-bills.json': { table: 'rental_bills', columns: ['lease_id', 'room_no', 'due_date', 'status', 'amount'] },
  'rental-renewals.json': { table: 'rental_renewals', columns: ['lease_id', 'room_no', 'renewal_date', 'amount'] },
};

function definitionFor(file) {
  return FILE_DEFINITIONS[path.basename(file)] || null;
}

function jsonRecords(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function valueFor(record, column) {
  const aliases = {
    room_no: 'roomNo', property_name: 'propertyName', tenant_name: 'tenantName', paid_through: 'paidThrough',
    maintenance_date: 'maintenanceDate', checkout_date: 'checkoutDate', cost_date: 'costDate', cost_type: 'costType',
    record_date: 'recordDate', lease_id: 'leaseId', renewal_date: 'renewalDate',
  };
  const value = record[column] ?? record[aliases[column]] ?? (column === 'amount' ? record.total : undefined);
  return value === undefined || value === null ? null : String(value);
}

function ensureDatabase(directory) {
  if (!DatabaseSync) return null;
  if (database) return database;
  dataDirectory = directory;
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o750 });
  database = new DatabaseSync(path.join(dataDirectory, 'rental.sqlite'));
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS rental_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_rooms (id TEXT PRIMARY KEY, room_no TEXT, property_name TEXT, status TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_leases (id TEXT PRIMARY KEY, room_no TEXT, tenant_name TEXT, status TEXT, paid_through TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_maintenance (id TEXT PRIMARY KEY, room_no TEXT, maintenance_date TEXT, status TEXT, amount REAL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_checkouts (id TEXT PRIMARY KEY, room_no TEXT, checkout_date TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_costs (id TEXT PRIMARY KEY, room_no TEXT, cost_date TEXT, cost_type TEXT, amount REAL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_items (id TEXT PRIMARY KEY, room_no TEXT, name TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_ledger (id TEXT PRIMARY KEY, room_no TEXT, record_date TEXT, direction TEXT, category TEXT, amount REAL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_bills (id TEXT PRIMARY KEY, lease_id TEXT, room_no TEXT, due_date TEXT, status TEXT, amount REAL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_renewals (id TEXT PRIMARY KEY, lease_id TEXT, room_no TEXT, renewal_date TEXT, amount REAL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_tenants (id TEXT PRIMARY KEY, name TEXT, phone TEXT, status TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_landlords (id TEXT PRIMARY KEY, name TEXT, phone TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_landlord_leases (id TEXT PRIMARY KEY, room_no TEXT, landlord_id TEXT, start_date TEXT, end_date TEXT, annual_rent REAL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rental_audit_log (id TEXT PRIMARY KEY, resource TEXT, action TEXT, record_id TEXT, actor TEXT, created_at TEXT, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_rental_leases_room_status ON rental_leases (room_no, status);
    CREATE INDEX IF NOT EXISTS idx_rental_maintenance_room_date ON rental_maintenance (room_no, maintenance_date);
    CREATE INDEX IF NOT EXISTS idx_rental_costs_room_date ON rental_costs (room_no, cost_date);
    CREATE INDEX IF NOT EXISTS idx_rental_ledger_room_date ON rental_ledger (room_no, record_date);
    CREATE INDEX IF NOT EXISTS idx_rental_renewals_lease_date ON rental_renewals (lease_id, renewal_date);
    CREATE INDEX IF NOT EXISTS idx_rental_audit_created_at ON rental_audit_log (created_at);
  `);
  migrateLegacyFiles();
  const tenantCount = database.prepare('SELECT COUNT(*) AS count FROM rental_tenants').get().count;
  if (!tenantCount) {
    const leaseRows = database.prepare('SELECT data FROM rental_leases').all();
    syncTenantProfiles(leaseRows.map((row) => JSON.parse(row.data)));
  }
  return database;
}

function migrateLegacyFiles() {
  const marker = database.prepare('SELECT value FROM rental_meta WHERE key = ?').get('legacy-json-migrated');
  if (marker) return;
  database.exec('BEGIN');
  try {
    for (const [filename, definition] of Object.entries(FILE_DEFINITIONS)) {
      const records = jsonRecords(path.join(dataDirectory, filename));
      replaceRecords(definition, records);
    }
    syncTenantProfiles(jsonRecords(path.join(dataDirectory, 'rental-leases.json')));
    database.prepare('INSERT OR REPLACE INTO rental_meta (key, value) VALUES (?, ?)').run('legacy-json-migrated', new Date().toISOString());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function replaceRecords(definition, records) {
  database.prepare(`DELETE FROM ${definition.table}`).run();
  const fields = ['id', ...definition.columns, 'data'];
  const placeholders = fields.map(() => '?').join(', ');
  const statement = database.prepare(`INSERT OR REPLACE INTO ${definition.table} (${fields.join(', ')}) VALUES (${placeholders})`);
  for (const record of records) {
    if (!record || !record.id) continue;
    statement.run(record.id, ...definition.columns.map((column) => valueFor(record, column)), JSON.stringify(record));
  }
}

function readRecords(file, directory) {
  const definition = definitionFor(file);
  const db = ensureDatabase(directory);
  if (!db || !definition) return null;
  const rows = db.prepare(`SELECT data FROM ${definition.table}`).all();
  return rows.map((row) => JSON.parse(row.data));
}

function writeRecords(file, records, directory) {
  const definition = definitionFor(file);
  const db = ensureDatabase(directory);
  if (!db || !definition) return false;
  db.exec('BEGIN');
  try {
    replaceRecords(definition, records);
    if (path.basename(file) === 'rental-leases.json') syncTenantProfiles(records);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  fs.writeFileSync(file, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o640 });
  return true;
}

function syncTenantProfiles(leases) {
  if (!database) return;
  const profiles = new Map();
  for (const lease of leases) {
    const phone = String(lease.tenantPhone || '').trim();
    const name = String(lease.tenantName || '').trim();
    if (!phone && !name) continue;
    const id = phone || `name:${name}`;
    profiles.set(id, { id, name, phone, status: lease.status === 'active' ? 'active' : 'archived' });
  }
  database.prepare('DELETE FROM rental_tenants').run();
  const statement = database.prepare('INSERT INTO rental_tenants (id, name, phone, status, data) VALUES (?, ?, ?, ?, ?)');
  for (const profile of profiles.values()) statement.run(profile.id, profile.name, profile.phone, profile.status, JSON.stringify(profile));
}

function appendAudit(directory, entry) {
  const db = ensureDatabase(directory);
  if (!db) return false;
  const record = { id: entry.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`, resource: entry.resource || '', action: entry.action || '', recordId: entry.recordId || '', actor: entry.actor || 'admin', createdAt: entry.createdAt || new Date().toISOString(), ...entry };
  db.prepare('INSERT INTO rental_audit_log (id, resource, action, record_id, actor, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(record.id, record.resource, record.action, record.recordId, record.actor, record.createdAt, JSON.stringify(record));
  return true;
}

function listAudit(directory, limit = 200) {
  const db = ensureDatabase(directory);
  if (!db) return [];
  return db.prepare('SELECT data FROM rental_audit_log ORDER BY created_at DESC LIMIT ?').all(Math.min(1000, Math.max(1, Number(limit) || 200))).map((row) => JSON.parse(row.data));
}

function readSettings(directory) {
  const db = ensureDatabase(directory);
  if (!db) return null;
  const row = db.prepare('SELECT value FROM rental_meta WHERE key = ?').get('settings');
  return row ? JSON.parse(row.value) : null;
}

function writeSettings(directory, settings) {
  const db = ensureDatabase(directory);
  if (!db) return false;
  db.prepare('INSERT OR REPLACE INTO rental_meta (key, value) VALUES (?, ?)').run('settings', JSON.stringify(settings));
  fs.writeFileSync(path.join(directory, 'rental-settings.json'), JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o640 });
  return true;
}

module.exports = { available: Boolean(DatabaseSync), ensureDatabase, readRecords, writeRecords, readSettings, writeSettings, appendAudit, listAudit };

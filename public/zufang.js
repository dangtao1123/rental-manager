const state = { rooms: [], leases: [], maintenance: [], maintenanceBatches: [], checkouts: [], costs: [], items: [], ledger: [], bills: [], renewals: [], audit: [], users: [], workspaces: [], communities: [], session: null, workspaceId: '', settings: { reminderDays: 10, propertyUnitPrice: 0, waterUnitPrice: 0, electricityUnitPrice: 0, gasUnitPrice: 0 }, recordType: '', recordId: '', dialogMode: '', template: 'renewal', maintenanceFilters: { month: '', date: '', room: '' }, maintenanceView: 'records' };
const $ = (selector) => document.querySelector(selector);
state.moveIns = [];
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const money = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}元`;
const today = () => new Date().toISOString().slice(0, 10);
function chinaDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace('T', ' ');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
let rentalPassword = localStorage.getItem('loanAdminPassword') || sessionStorage.getItem('loanAdminPassword') || '';
let rentalUser = localStorage.getItem('loanAdminUser') || sessionStorage.getItem('loanAdminUser') || 'admin';
let rentalRemember = localStorage.getItem('loanAdminRemember') !== '0';
let rentalPasswordPrompt;
let rentalLoginResolve;
let checkoutSubmitMode = 'completed';
function setRentalLoginVisible(visible, message = '') {
  const screen = $('#rental-login-screen');
  if (!screen) return;
  screen.hidden = !visible;
  const error = $('#rental-login-error');
  if (error) error.textContent = message;
}
function renderCurrentUser() {
  const actor = state.session?.actor || {};
  const name = String(actor.displayName || actor.username || '管理员').trim() || '管理员';
  const avatarText = Array.from(name)[0] || '管';
  const topAvatar = $('.avatar-small');
  if (topAvatar) { topAvatar.textContent = name; topAvatar.title = name; topAvatar.setAttribute('aria-label', name); }
  const sidebarAvatar = $('.sidebar-footer .user-avatar');
  if (sidebarAvatar) { sidebarAvatar.textContent = avatarText; sidebarAvatar.title = name; }
  const sidebarName = $('.sidebar-footer strong');
  if (sidebarName) { sidebarName.textContent = name; sidebarName.title = name; }
}
function persistRentalCredentials(credentials) {
  rentalPassword = credentials.value;
  rentalUser = credentials.username;
  rentalRemember = credentials.remember;
  if (rentalRemember) {
    localStorage.setItem('loanAdminPassword', rentalPassword);
    localStorage.setItem('loanAdminUser', rentalUser);
    localStorage.setItem('loanAdminRemember', '1');
    sessionStorage.removeItem('loanAdminPassword');
    sessionStorage.removeItem('loanAdminUser');
  } else {
    sessionStorage.setItem('loanAdminPassword', rentalPassword);
    sessionStorage.setItem('loanAdminUser', rentalUser);
    localStorage.removeItem('loanAdminPassword');
    localStorage.removeItem('loanAdminUser');
    localStorage.setItem('loanAdminRemember', '0');
  }
}
function submitRentalLogin(event) {
  event.preventDefault();
  if (!rentalLoginResolve) return;
  const input = $('#rental-login-password');
  const userInput = $('#rental-login-user');
  const rememberInput = $('#rental-login-remember');
  const error = $('#rental-login-error');
  const value = input?.value.trim() || '';
  const username = userInput?.value.trim() || 'admin';
  if (!value) { if (error) error.textContent = '请输入密码'; return; }
  const button = $('#rental-login-submit');
  if (button) { button.disabled = true; button.textContent = '登录中…'; }
  const resolve = rentalLoginResolve;
  rentalLoginResolve = null;
  resolve({ value, username, remember: Boolean(rememberInput?.checked) });
}
function requestRentalCredentials(message = '') {
  if (!rentalPasswordPrompt) rentalPasswordPrompt = new Promise((resolve) => {
    rentalLoginResolve = resolve;
    const form = $('#rental-login-form');
    const input = $('#rental-login-password');
    const userInput = $('#rental-login-user');
    const rememberInput = $('#rental-login-remember');
    setRentalLoginVisible(true, message);
    const button = $('#rental-login-submit');
    if (button) { button.disabled = false; button.textContent = '登录'; }
    if (userInput) userInput.value = rentalUser;
    if (input) input.value = '';
    if (rememberInput) rememberInput.checked = rentalRemember;
    setTimeout(() => input?.focus(), 30);
  }).finally(() => { rentalPasswordPrompt = null; rentalLoginResolve = null; });
  return rentalPasswordPrompt;
}
function normalizeRentalFileReferences(value) {
  if (Array.isArray(value)) return value.map(normalizeRentalFileReferences);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeRentalFileReferences(item)]));
  if (typeof value !== 'string' || !location.pathname.startsWith('/loan/')) return value;
  if (value.startsWith('../api/zufang/files/')) return `/loan/${value.slice(3)}`;
  if (value.startsWith('/api/zufang/files/')) return `/loan${value}`;
  return value;
}

async function api(path, options = {}, retried = false) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (rentalPassword) { headers['X-Admin-Password'] = rentalPassword; headers['X-Admin-User'] = rentalUser; }
  if (state.workspaceId && !headers['X-Rental-Workspace']) headers['X-Rental-Workspace'] = state.workspaceId;
  const apiBase = location.pathname.startsWith('/loan/') ? '/loan/api/zufang/' : '/api/zufang/';
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && !retried) {
    const promptMessage = rentalPassword ? (payload.message || '账号或密码不正确，请重新输入') : '';
    const credentials = await requestRentalCredentials(promptMessage);
    persistRentalCredentials(credentials);
    return api(path, options, true);
  }
  if (!response.ok) throw Error(payload.message || `租房${path}接口请求失败（${response.status}）`);
  return payload.data;
}
async function load() {
  const session = await api('session');
  setRentalLoginVisible(false);
  state.session = session;
  renderCurrentUser();
  state.workspaces = session.workspaces || [];
  const savedWorkspaceId = localStorage.getItem('rentalWorkspaceId') || '';
  const availableIds = new Set(state.workspaces.map((item) => item.id));
  state.workspaceId = session.actor?.platformAdmin
    ? (availableIds.has(savedWorkspaceId) ? savedWorkspaceId : session.workspace?.id || state.workspaces[0]?.id || '')
    : (session.workspace?.id || '');
  if (state.workspaceId) localStorage.setItem('rentalWorkspaceId', state.workspaceId);
  [state.rooms, state.leases, state.maintenance, state.maintenanceBatches, state.checkouts, state.costs, state.items, state.ledger, state.bills, state.renewals, state.moveIns, state.audit, state.settings, state.users, state.communities] = (await Promise.all(['rooms', 'leases', 'maintenance', 'maintenance-batches', 'checkouts', 'costs', 'items', 'ledger', 'bills', 'renewals', 'move-ins', 'audit', 'settings', 'users', 'communities'].map((type) => api(type)))).map(normalizeRentalFileReferences);
  renderWorkspaceSwitcher();
  syncMoveInInventory();
  if (document.documentElement.dataset.rentalUiReady === '1') document.dispatchEvent(new CustomEvent('rental:data-loaded')); else render();
}
function renderWorkspaceSwitcher() {
  const shell = $('#workspace-switcher');
  if (!shell) return;
  const isPlatform = Boolean(state.session?.actor?.platformAdmin);
  shell.hidden = !isPlatform;
  if (!isPlatform) return;
  shell.innerHTML = `<span>客户空间</span><select aria-label="选择客户工作空间">${state.workspaces.map((item) => `<option value="${esc(item.id)}" ${item.id === state.workspaceId ? 'selected' : ''}>${esc(item.name || item.username)}</option>`).join('')}</select>`;
  shell.querySelector('select')?.addEventListener('change', (event) => { state.workspaceId = event.target.value; localStorage.setItem('rentalWorkspaceId', state.workspaceId); load().catch((error) => alert(error.message)); });
}
function visible(rows) { return rows.filter((row) => !row.archivedAt); }
function render() { renderStats(); renderRooms(); renderRoomAdmin(); renderRoomItems(); renderLeases(); renderTenants(); renderMaintenance(); renderCosts(); renderLedger(); renderCheckouts(); renderTodo(); renderTemplate(); renderSettings(); renderCommunities(); renderUsers(); renderAudit(); if (typeof renderMoveIns === 'function') renderMoveIns(); }
function renderStats() { const rooms = visible(state.rooms); $('#stat-rooms').textContent = rooms.length; $('#stat-occupied').textContent = state.leases.filter((lease) => lease.status === 'active' && !lease.archivedAt).length; $('#stat-vacant').textContent = rooms.filter((room) => room.status === 'vacant').length; const month = today().slice(0, 7); $('#stat-maintenance').textContent = money(state.maintenance.filter((item) => !item.archivedAt && item.maintenanceDate.startsWith(month)).reduce((sum, item) => sum + Number(item.amount || 0), 0)); $('#stat-costs').textContent = money(state.costs.filter((item) => !item.archivedAt && item.costDate.startsWith(month)).reduce((sum, item) => sum + Number(item.amount || 0), 0)); }
function leaseForRoom(roomRef) { const room = typeof roomRef === 'object' ? roomRef : state.rooms.find((item) => item.id === roomRef || item.roomNo === roomRef); return state.leases.find((lease) => ((room?.id && lease.roomId === room.id) || (!lease.roomId && lease.roomNo === (room?.roomNo || roomRef))) && lease.status === 'active' && !lease.archivedAt); }
function roomCommunityName(roomRef) { const room = typeof roomRef === 'object' && roomRef.roomNo !== undefined ? roomRef : state.rooms.find((item) => item.id === roomRef || item.roomNo === roomRef); if (!room) return '未设置小区'; const community = state.communities.find((item) => !item.archivedAt && item.id && String(item.id) === String(room.communityId)) || state.communities.find((item) => !item.archivedAt && item.name && item.name === room.propertyName); return community?.name || room.propertyName || '未设置小区'; }
function roomLabel(roomRef) { const record = typeof roomRef === 'object' ? roomRef : null; const room = state.rooms.find((item) => item.id === record?.roomId || item.id === roomRef || (!record?.roomId && item.roomNo === (record?.roomNo || roomRef))); return room ? `${roomCommunityName(room)} · ${room.roomNo}` : (record?.roomNo || roomRef || '未设置房间'); }
function daysUntil(value) { if (!value) return null; return Math.ceil((new Date(`${value}T23:59:59`) - new Date()) / 86400000); }
function occupiedMonths(startDate, endDate = today()) { if (!startDate) return 0; const start = new Date(`${startDate}T00:00:00Z`); const end = new Date(`${endDate}T00:00:00Z`); if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0; let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth(); const anniversary = new Date(start); anniversary.setUTCDate(1); anniversary.setUTCMonth(anniversary.getUTCMonth() + months); const targetLastDay = new Date(Date.UTC(anniversary.getUTCFullYear(), anniversary.getUTCMonth() + 1, 0)).getUTCDate(); anniversary.setUTCDate(Math.min(start.getUTCDate(), targetLastDay)); const inclusiveEnd = new Date(anniversary); inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1); if (end < inclusiveEnd) months -= 1; return Math.max(0, months); }
function dueDate(lease) { return lease?.paidThrough || ''; }
function paymentLabel(value) { return value === 'yearly' ? '年付' : value === 'quarterly' ? '季付' : '月付'; }
 function sortRentalRooms(rooms) {
  return rooms.map((room, index) => ({ room, index })).sort((left, right) =>
    String(roomCommunityName(left.room) || '').localeCompare(String(roomCommunityName(right.room) || ''), 'zh-CN', { numeric: true, sensitivity: 'base' })
    || String(left.room.roomNo || '').localeCompare(String(right.room.roomNo || ''), 'zh-CN', { numeric: true, sensitivity: 'base' })
    || left.index - right.index
  ).map(({ room }) => room);
}
function renewalsForLease(leaseId) { return state.renewals.filter((item) => item.leaseId === leaseId && !item.archivedAt).sort((a, b) => String(b.renewalDate).localeCompare(String(a.renewalDate))); }
function renewalText(item) { return `${item.renewalDate} · ${item.durationUnit === 'days' ? `${item.durationValue}天` : `${item.durationValue}个月`} · ${money(item.amount)}`; }
function renderLeases() { const list = state.leases.filter((lease) => lease.status === 'active' && !lease.archivedAt); $('#lease-list').innerHTML = list.length ? list.map((lease) => `<div class="lease-card"><div><strong>${esc(roomLabel(lease))}</strong><div class="meta">${esc(lease.tenantName || '未填写租户')} ${esc(lease.tenantPhone || '')}</div></div><div><span class="meta">月租+物业</span><div class="money">${money(Number(lease.monthlyRent) + Number(lease.monthlyPropertyFee))}</div></div><div><span class="meta">交费至</span><div>${esc(dueDate(lease) || '未设置')}</div></div><div class="row-actions"><button class="small" data-show-renewals="${lease.id}">续费记录</button><button class="small" data-edit="leases" data-id="${lease.id}">编辑</button></div></div>`).join('') : '<p class="meta">暂无在租记录</p>'; }
function renderTenants() { const list = state.leases.filter((lease) => !lease.archivedAt); const card = (lease) => `<div class="lease-card tenant-card"><div><strong class="renewal-link" data-show-renewals="${lease.id}">${esc(lease.tenantName || '未填写租户')}</strong><div class="meta">房间 ${esc(roomLabel(lease))} · ${esc(lease.tenantPhone || '')}</div></div><div><span class="meta">入住时间 / 已入住</span><div>${esc(lease.startDate || '未设置')} · ${occupiedMonths(lease.startDate, lease.status === 'active' ? today() : (lease.endDate || today()))}个月</div><div class="meta">交费至：${esc(dueDate(lease) || '未设置')}</div></div><div><span class="meta">住房目的 / 支付方式</span><div>${({ self: '自住', studio: '工作室', homestay: '民宿', other: '其他' }[lease.purpose] || lease.purpose || '未设置')} · ${paymentLabel(lease.paymentMethod || lease.billingCycle)}</div></div><div><span class="meta">状态</span><div>${lease.status === 'active' ? '在租' : '已退租'}</div></div><div class="row-actions"><button class="small" data-show-renewals="${lease.id}">续费记录</button><button class="small" data-edit="leases" data-id="${lease.id}">编辑</button>${lease.status === 'active' ? '' : '<button class="small danger" data-delete="leases" data-id="' + lease.id + '">归档</button>'}</div></div>`; const group = (title, rows) => `<section class="tenant-group"><h3>${title}（${rows.length}）</h3>${rows.length ? rows.map(card).join('') : '<p class="meta">暂无记录</p>'}</section>`; $('#tenant-list').innerHTML = group('在租租户', list.filter((lease) => lease.status === 'active')) + group('已退租租户', list.filter((lease) => lease.status !== 'active')); }
function renderRooms() { const reminderDays = Number(state.settings.reminderDays ?? 10); const rooms = sortRentalRooms(visible(state.rooms), reminderDays); $('#room-list').innerHTML = rooms.length ? rooms.map((room) => { const lease = leaseForRoom(room); const maintenance = room.status === 'maintenance' && !lease; const occupied = Boolean(lease); const days = lease ? daysUntil(dueDate(lease)) : null; const expiring = occupied && days !== null && days >= 0 && days <= reminderDays; const cardClass = maintenance ? 'room-maintenance' : expiring ? 'room-expiring' : occupied ? 'room-occupied' : 'room-vacant'; const status = maintenance ? '装修维护中' : expiring ? '即将到期' : occupied ? '已租出' : '空置'; return `<article class="room-card ${cardClass}"><div class="room-card-head"><strong>${esc(`${roomCommunityName(room)} · ${room.roomNo || '未设置房号'}`)}</strong><span class="room-status">${status}</span></div>${lease ? `<div class="room-tenant">租户：${esc(lease.tenantName || '未填写')} · ${esc(lease.tenantPhone || '')}<br />${paymentLabel(lease.paymentMethod || lease.billingCycle)} · 月租+物业：${money(Number(lease.monthlyRent) + Number(lease.monthlyPropertyFee))}</div><div class="room-expiry ${expiring ? 'urgent' : ''}">${expiring ? `交费到期提醒（${days}天）：` : '交费至：'}${esc(dueDate(lease) || '未设置')}</div>` : '<div class="room-expiry">当前无在租租户</div>'}<div class="room-actions"><button class="small room-admin-link" data-open-room-admin>房间管理</button><button class="small" data-action="add-lease" data-room-no="${esc(room.roomNo)}" data-room-id="${esc(room.id)}">${lease ? '续费' : '新增入住'}</button>${lease ? `<button class="small" data-action="add-checkout" data-room-no="${esc(room.roomNo)}" data-room-id="${esc(room.id)}">退房</button>` : ''}</div></article>`; }).join('') : '<p class="meta">请先添加房间</p>'; }
 function renderRoomAdmin() { const rooms = visible(state.rooms); $('#room-admin-list').innerHTML = table(['小区/房间', '状态', '物业费', '房东年租', '当前租户', '房间照片', '物品清单', '维护', '操作'], rooms.map((room) => { const lease = leaseForRoom(room); const items = state.items.filter((item) => !item.archivedAt && ((item.roomId && item.roomId === room.id) || (!item.roomId && item.roomNo === room.roomNo))); const maintenanceCount = state.maintenance.filter((item) => !item.archivedAt && ((item.roomId && item.roomId === room.id) || (!item.roomId && item.roomNo === room.roomNo))).length; const unitPrice = Number(room.propertyUnitPrice ?? state.settings.propertyUnitPrice ?? 0); const property = money(Number(room.area || 0) * unitPrice || room.monthlyPropertyFee); const annual = Number(room.landlordAnnualRent ?? Number(room.landlordMonthlyRent || 0) * 12); return [
    `<strong>${esc(roomCommunityName(room))} · ${esc(room.roomNo)}</strong><div class="meta">${esc(room.landlordLeaseStart || '未设置')} 至 ${esc(room.landlordLeaseEnd || '未设置')}</div>`,
    lease ? '已租出' : room.status === 'maintenance' ? '装修维护中' : '空置', property,
    `${money(annual)}<div class="meta">托管到期：${esc(room.landlordLeaseEnd || '未设置')}</div>`,
    lease ? `${esc(lease.tenantName || '未填写')}<div class="meta">${esc(lease.tenantPhone || '')}</div>` : '暂无',
    room.images?.length ? `<button class="small" data-show-room-photos="${esc(room.roomNo)}">${room.images.length} 张照片</button>` : `<button class="small" data-show-room-photos="${esc(room.roomNo)}">照片</button>`, items.length ? `<button class="small" data-show-room-items="${esc(room.roomNo)}">${items.length} 项物品</button>` : '<span class="meta">暂无物品</span>', maintenanceCount ? `<button class="small" data-show-room-maintenance="${esc(room.roomNo)}">${maintenanceCount} 条记录</button>` : `<button class="small" data-show-room-maintenance="${esc(room.roomNo)}">维护</button>`,
    `<div class="room-admin-actions"><button class="small" data-edit="rooms" data-id="${room.id}">编辑</button><button class="small" data-show-room-items="${esc(room.roomNo)}">物品</button><button class="small" data-action="add-maintenance" data-room-no="${esc(room.roomNo)}" data-room-id="${esc(room.id)}">维护</button>${room.status === 'inactive' ? '' : `<button class="small danger" data-delete="rooms" data-id="${room.id}">设为无效</button>`}</div>`
  ]; })); }
function renderRoomItems() { const target = $('#items-list'); if (!target) return; const rows = state.items.filter((item) => !item.archivedAt); target.innerHTML = table(['小区/房间', '物品', '数量', '备注', '照片', '操作'], rows.map((item) => [roomLabel(item), `<strong>${esc(item.name)}</strong>`, esc(item.quantity || 1), esc(item.note || ''), item.image ? `<img class="item-thumb item-preview-trigger" src="${esc(item.image)}" data-preview-image="${esc(item.image)}" alt="${esc(item.name)}" />` : '<span class="meta">无照片</span>', `<button class="small" data-edit="items" data-id="${item.id}">编辑</button><button class="small danger" data-delete="items" data-id="${item.id}">归档</button>`])); }
function openRoomItems(roomRef) { const room = state.rooms.find((item) => item.id === roomRef) || state.rooms.find((item) => item.roomNo === roomRef); const roomNo = room?.roomNo || roomRef; state.itemRoomId = room?.id || ''; const allItems = state.items.filter((item) => room?.id ? item.roomId === room.id || (!item.roomId && item.communityId === room.communityId && item.roomNo === roomNo) : item.roomNo === roomNo); const items = allItems.filter((item) => !item.archivedAt); state.itemRoomNo = roomNo; $('#room-items-dialog-title').textContent = `${roomLabel(room?.id || roomNo)} · 物品清单`; const current = table(['物品', '数量', '备注', '照片', '操作'], items.map((item) => [`<strong>${esc(item.name)} × ${esc(Number(item.quantity || 1))}</strong>`, esc(item.quantity || 1), esc(item.note || ''), item.image ? `<img class="item-thumb item-preview-trigger" src="${esc(item.image)}" data-preview-image="${esc(item.image)}" alt="${esc(item.name)}" />` : '<span class="meta">无照片</span>', `<button class="small" data-edit="items" data-id="${item.id}">编辑</button><button class="small danger" data-delete="items" data-id="${item.id}">归档</button>`])); const history = table(['时间', '操作', '物品', '备注'], allItems.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).map((item) => [chinaDateTime(item.archivedAt || item.createdAt), item.archivedAt ? '删除' : '新增/当前', esc(`${item.name} × ${Number(item.quantity || 1)}`), esc(item.note || '')])); $('#room-items-list').innerHTML = `<h3 class="subheading">当前物品（${items.length}）</h3>${current}<h3 class="subheading">物品变更记录</h3>${history}`; const dialog = $('#room-items-dialog'); if (dialog && !dialog.open) dialog.showModal(); }
 function openRoomMaintenance(roomNo) { const rows = state.maintenance.filter((item) => item.roomNo === roomNo && !item.archivedAt).sort((a, b) => String(b.maintenanceDate).localeCompare(String(a.maintenanceDate))); state.maintenanceRoomNo = roomNo; $('#room-maintenance-dialog-title').textContent = `${roomLabel(roomNo)} · 维护记录`; const imageCell = (value, label) => value ? `<button type="button" class="maintenance-image-link" data-preview-image="${esc(value)}"><img src="${esc(value)}" alt="${esc(label)}" /></button>` : '<span class="meta">未上传</span>'; const evidenceCell = (item) => `<div class="maintenance-evidence-grid"><div><span>维护前</span>${imageCell(item.beforeImage, '维护前图片')}</div><div><span>维护后</span>${imageCell(item.afterImage, '维护后图片')}</div><div><span>付款</span>${imageCell(item.paymentProof, '付款截图')}</div></div>`; const itemCell = (item) => `<div class="maintenance-item-cell"><strong>${esc(item.item || '未填写事项')}</strong>${item.note ? `<span>${esc(item.note)}</span>` : ''}</div>`; $('#room-maintenance-list').innerHTML = table(['日期', '类型', '事项 / 备注', '金额', '状态', '图片凭证', '操作'], rows.map((item) => { const statusClass = item.status === 'reimbursed' ? 'status-reimbursed' : item.status === 'done' ? 'status-done' : 'status-pending'; return [item.maintenanceDate, ({ new: '新增物品', remove: '删除物品', repair: '房间日常维护' }[item.maintenanceType] || '房间日常维护'), itemCell(item), money(item.amount), `<span class="maintenance-status ${statusClass}">${maintenanceStatusLabel(item.status)}</span>`, evidenceCell(item), `<div class="row-actions">${item.status === 'pending' ? `<button class="small" data-maint-complete="${item.id}">完成维护</button>` : ''}${item.status === 'done' ? `<button class="small" data-maint-reimburse="${item.id}">已报销</button>` : ''}<button class="small icon-button" data-edit="maintenance" data-id="${item.id}" title="详情/编辑" aria-label="详情/编辑"><iconify-icon icon="hugeicons:edit-02" aria-hidden="true"></iconify-icon></button></div>`]; })); const dialog = $('#room-maintenance-dialog'); if (dialog && !dialog.open) dialog.showModal(); }
function openRoomPhotos(roomNo) { const room = state.rooms.find((item) => item.roomNo === roomNo); if (!room) return; state.photoRoomId = room.id; state.photoRoomNo = roomNo; $('#room-photos-dialog-title').textContent = `${roomLabel(roomNo)} · 房间照片`; const images = room.images || []; $('#room-photos-list').innerHTML = images.length ? images.map((image, index) => `<div class="room-photo-card"><img class="room-photo item-preview-trigger" src="${esc(image)}" data-preview-image="${esc(image)}" alt="房间照片${index + 1}" /><button class="small danger" data-delete-room-photo="${index}">删除</button></div>`).join('') : '<p class="meta">暂无房间照片</p>'; $('#room-photos-status').textContent = `${images.length}/20 张`; const dialog = $('#room-photos-dialog'); if (!dialog.open) dialog.showModal(); }
async function updateMaintenanceStatus(id, status) { const record = state.maintenance.find((item) => item.id === id); if (!record) return; await api(`maintenance/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); if ($('#room-maintenance-dialog').open && state.maintenanceRoomNo) openRoomMaintenance(state.maintenanceRoomNo); }
function selectedMaintenanceIds() { return [...document.querySelectorAll('.maintenance-check:checked')].map((input) => input.value); }
function exportMaintenanceRows(rows) { const headers = ['小区/房间', '维护日期', '维护类型', '维护事项', '金额', '完成时间']; const typeLabels = { new: '新增物品', remove: '删除物品', repair: '房间日常维护' }; const csv = [headers, ...rows.map((item) => [roomLabel(item), item.maintenanceDate, typeLabels[item.maintenanceType] || '房间日常维护', item.item || '', item.amount || 0, item.completedAt || ''])].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `维护待报销-${today()}.csv`; link.click(); URL.revokeObjectURL(link.href); }
async function openPublicReimbursementLink() { const url = `${location.origin}${location.pathname.startsWith('/loan/') ? '/loan' : ''}/zufang-reimbursements.html`; window.open(url, '_blank', 'noopener'); try { await navigator.clipboard.writeText(url); alert('未报销明细链接已复制'); } catch { alert(`未报销明细链接：${url}`); } }
function roomOptions(current = '', includeInactive = true) { const rooms = visible(state.rooms).filter((room) => includeInactive || room.status !== 'inactive').filter((room) => room.roomNo); const selectedRoom = rooms.find((room) => room.id === current || room.roomNo === current); return rooms.map((room) => `${room.id}:${roomCommunityName(room)} · ${room.roomNo}`).join('|') || (selectedRoom ? `${selectedRoom.id}:${roomCommunityName(selectedRoom)} · ${selectedRoom.roomNo}` : '__none__:请先创建房间'); }
function communityOptions(current = '', propertyName = '') { const communities = visible(state.communities).filter((item) => item.name); const selected = current || communities.find((item) => item.name === propertyName)?.id || ''; return communities.map((item) => `${item.id}:${item.name}`).join('|') || '__none__:请先在小区管理中创建小区'; }
function itemOptions(roomRef = '') { const room = state.rooms.find((item) => item.id === roomRef) || state.rooms.find((item) => item.roomNo === roomRef); const items = state.items.filter((item) => (room?.id ? item.roomId === room.id || (!item.roomId && item.roomNo === room.roomNo) : item.roomNo === roomRef) && !item.archivedAt); return items.map((item) => `${esc(item.name)}:${esc(item.name)}`).join('|') || '__none__:该房间暂无物品'; }
function table(headers, rows) { return rows.length ? `<table class="table"><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="meta">暂无记录</p>'; }
function maintenanceStatusLabel(status) { return status === 'reimbursed' ? '已报销' : status === 'done' ? '已完成待报销' : '待处理'; }
function renderMaintenance() { const roomSelect = $('#maintenance-room'); const selected = state.maintenanceFilters.room; roomSelect.innerHTML = '<option value="">全部房间</option>' + [...new Set(state.maintenance.filter((item) => !item.archivedAt).map((item) => item.roomNo).filter(Boolean))].sort().map((roomNo) => `<option value="${esc(roomNo)}">${esc(roomLabel(roomNo))}</option>`).join(''); roomSelect.value = selected; const filter = state.maintenanceFilters; const typeLabels = { new: '新增物品', remove: '删除物品', repair: '房间日常维护' }; const list = state.maintenance.filter((item) => !item.archivedAt && (!filter.month || item.maintenanceDate.startsWith(filter.month)) && (!filter.date || item.maintenanceDate === filter.date) && (!filter.room || item.roomNo === filter.room)); const pendingReimburse = state.maintenance.filter((item) => !item.archivedAt && item.status === 'done'); $('#maintenance-batch-count').textContent = `已完成待报销 ${pendingReimburse.length} 条，共 ${money(pendingReimburse.reduce((sum, item) => sum + Number(item.amount || 0), 0))}`; $('#maintenance-list').innerHTML = table(['选择', '房间', '日期', '类型', '事项', '金额', '状态', '备注', '图片', '操作'], list.map((item) => [item.status === 'reimbursed' ? '' : `<input type="checkbox" class="maintenance-check" value="${esc(item.id)}" />`, roomLabel(item), item.maintenanceDate, typeLabels[item.maintenanceType] || '房间日常维护', esc(item.item || ''), money(item.amount), maintenanceStatusLabel(item.status), esc(item.note || ''), item.beforeImage || item.afterImage || item.paymentProof ? '<span class="image-badge">有图片</span>' : '无', `<div class="row-actions">${item.status === 'pending' ? `<button class="small" data-maint-complete="${item.id}">完成维护</button>` : ''}${item.status === 'done' ? `<button class="small" data-maint-reimburse="${item.id}">已报销</button>` : ''}<button class="small icon-button" data-edit="maintenance" data-id="${item.id}" title="详情/编辑" aria-label="详情/编辑"><iconify-icon icon="hugeicons:edit-02" aria-hidden="true"></iconify-icon></button><button class="small danger" data-delete="maintenance" data-id="${item.id}">归档</button></div>`])); }
function renderCosts() { const filter = state.maintenanceFilters; const names = { water: '水费', electricity: '电费', property: '物业费', gas: '燃气费', other: '其他' }; const list = state.costs.filter((item) => !item.archivedAt && (!filter.month || item.costDate.startsWith(filter.month)) && (!filter.date || item.costDate === filter.date) && (!filter.room || item.roomNo === filter.room)); $('#cost-list').innerHTML = table(['房间', '日期', '类型', '金额', '周期', '备注', '操作'], list.map((item) => [roomLabel(item), item.costDate, names[item.costType] || item.costType, money(item.amount), item.period || '', esc(item.note || ''), `<button class="small" data-edit="costs" data-id="${item.id}">编辑</button><button class="small danger" data-delete="costs" data-id="${item.id}">归档</button>`])); }
function renderLedger() {
  const roomSelect = $('#ledger-room');
  if (!roomSelect) return;
  const selected = roomSelect.value;
  roomSelect.innerHTML = '<option value="">全部房间</option>' + visible(state.rooms).filter((room) => room.roomNo).map((room) => `<option value="${esc(room.roomNo)}">${esc(roomLabel(room.roomNo))}</option>`).join('');
  roomSelect.value = selected;
  const start = $('#ledger-start').value;
  const end = $('#ledger-end').value;
  const room = roomSelect.value;
  const list = state.ledger.filter((item) => !item.archivedAt && (!start || item.recordDate >= start) && (!end || item.recordDate <= end) && (!room || item.roomNo === room));
  const labels = { rent: '租金', otherIncome: '其他收入', landlordRent: '托管房租', maintenance: '维护维修', depositRefund: '押金退还', otherExpense: '其他支出' };
  const income = list.filter((item) => item.direction === 'income').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expense = list.filter((item) => item.direction === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pending = state.maintenance.filter((item) => !item.archivedAt && item.status === 'pending' && (!room || item.roomNo === room) && (!start || item.maintenanceDate >= start) && (!end || item.maintenanceDate <= end));
  $('#ledger-summary').innerHTML = `<div class="income-summary summary-card"><span>收入</span><strong>${money(income)}</strong></div><div class="expense-summary summary-card"><span>支出</span><strong>${money(expense)}</strong></div><div class="balance-summary summary-card"><span>结余</span><strong>${money(income - expense)}</strong></div><div class="pending-summary summary-card"><span>待支出费用</span><strong>${money(pending.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong><small>${pending.length} 条待处理维护</small></div>`;
  $('#ledger-list').innerHTML = table(['日期', '房间', '方向', '分类', '金额', '备注', '操作'], list.map((item) => {
    const incomeRow = item.direction === 'income';
    return [`<span class="${incomeRow ? 'income-text' : 'expense-text'}">${item.recordDate}</span>`, roomLabel(item), `<span class="${incomeRow ? 'income-text' : 'expense-text'}">${incomeRow ? '收入' : '支出'}</span>`, labels[item.category] || item.category, `<span class="${incomeRow ? 'income-text' : 'expense-text'}">${money(item.amount)}</span>`, esc(item.note || ''), `<button class="small" data-edit="ledger" data-id="${item.id}">编辑</button><button class="small danger" data-delete="ledger" data-id="${item.id}">归档</button>`];
  }));
}
function renderCheckouts() { $('#checkout-list').innerHTML = table(['房间', '租户', '退房日期', '扣费合计', '应退押金', '操作'], state.checkouts.filter((item) => !item.archivedAt).map((item) => [`${roomLabel(item)}${item.status === 'draft' ? ' · 暂存' : ''}`, item.tenantName, item.checkoutDate, money(item.totalDeduction), money(item.refundAmount), `<button class="small" data-edit="checkouts" data-id="${item.id}">编辑</button><button class="small" data-copy-checkout="${item.id}">复制文字</button><button class="small danger" data-delete="checkouts" data-id="${item.id}">归档</button>`])); }
function renderTodo() { const reminderDays = Number(state.settings.reminderDays ?? 10); const expiring = state.leases.filter((lease) => lease.status === 'active' && !lease.archivedAt && lease.reminderEnabled !== false && dueDate(lease) && daysUntil(dueDate(lease)) >= 0 && daysUntil(dueDate(lease)) <= reminderDays); const alert = $('#expiry-alert'); if (alert) { alert.hidden = !expiring.length; $('#expiry-alert-text').textContent = expiring.length ? expiring.map((lease) => `${roomLabel(lease)}（交费至${dueDate(lease)}，剩余${daysUntil(dueDate(lease))}天）`).join('、') : ''; } const items = [...state.bills.filter((bill) => !bill.archivedAt && bill.status !== 'paid' && bill.status !== 'void').map((bill) => `<div class="todo-card"><div><strong>${esc(roomLabel(bill))} · ${esc(bill.tenantName)}</strong><span>应收房租${bill.dueDate ? ` · 到期日 ${esc(bill.dueDate)}` : ''}</span></div><b>${money(Number(bill.total || 0) - Number(bill.paidAmount || 0))}</b></div>`), ...state.maintenance.filter((item) => !item.archivedAt && item.status === 'pending').map((item) => `<div class="todo-card"><div><strong>${esc(roomLabel(item))} · ${esc(item.item)}</strong><span>维护维修待处理</span></div><b>${money(item.amount)}</b></div>` )]; $('#todo-list').innerHTML = items.length ? items.join('') : '<p class="meta">暂无待处理事项</p>'; }
function fieldsFor(type, record = {}) { const common = { roomNo: record.roomNo || '', tenantName: record.tenantName || '', tenantPhone: record.tenantPhone || '', propertyName: record.propertyName || '', status: record.status || 'vacant', area: record.area || '', propertyUnitPrice: record.propertyUnitPrice || '', monthlyPropertyFee: record.monthlyPropertyFee || '', note: record.note || '' }; if (type === 'rooms') return [['propertyName', '小区/公寓名称', common.propertyName], ['roomNo', '房间号', common.roomNo], ['status', '状态', common.status, 'select', 'vacant:空置|occupied:在租|reserved:已预订|maintenance:维护中|inactive:无效/停止托管'], ['area', '面积（㎡）', common.area], ['propertyUnitPrice', '物业费单价', common.propertyUnitPrice], ['monthlyPropertyFee', '每月物业费', common.monthlyPropertyFee], ['propertyFeeMode', '物业费收取方式', record.propertyFeeMode || 'included', 'select', 'included:与房租一起交|tenant_self:租户自理'], ['landlordLeaseStart', '房东托管开始', record.landlordLeaseStart || '', 'date'], ['landlordLeaseEnd', '房东托管结束', record.landlordLeaseEnd || '', 'date'], ['landlordAnnualRent', '房东托管年租金', record.landlordAnnualRent ?? Number(record.landlordMonthlyRent || 0) * 12], ['note', '备注', common.note, 'textarea']]; if (type === 'leases') { const readonly = record._new ? 'readonly' : ''; const propertyValue = record._propertyFeeMode === 'tenant_self' ? 0 : (record.monthlyPropertyFee || record._roomMonthlyPropertyFee || 0); return [['roomNo', '房间号', common.roomNo, 'select', roomOptions(common.roomNo, false)], ['tenantName', '租户姓名', common.tenantName], ['tenantPhone', '租户电话', common.tenantPhone], ['tenantIdCard', '乙方身份证号', record.tenantIdCard || ''], ['paymentMethod', '租金支付方式', record.paymentMethod || record.billingCycle || 'monthly', 'select', 'monthly:月付|quarterly:季付|yearly:年付'], ['monthlyRent', '月租金（计费基准）', record.monthlyRent || ''], ['monthlyPropertyFee', record._propertyFeeMode === 'tenant_self' ? 0 : propertyValue, readonly], ['deposit', '押金', record.deposit || ''], ['startDate', '入住时间', record.startDate || today(), 'date'], ['endDate', '合同结束时间', record.endDate || '', 'date'], ['paidThrough', '已付至（提醒依据）', record.paidThrough || '', 'date'], ['reminderEnabled', '开启续费提醒', record.reminderEnabled === false ? '0' : '1', 'select', '1:开启|0:关闭'], ['moveInWater', '入住水表度数', record.moveInWater || ''], ['moveInElectricity', '入住电表度数', record.moveInElectricity || ''], ['note', '备注', record.note || '', 'textarea']]; } if (type === 'renewal') return [['roomNo', '房间号', record.roomNo || '', 'readonly'], ['tenantName', '租户姓名', record.tenantName || '', 'readonly'], ['tenantPhone', '租户电话', record.tenantPhone || '', 'readonly'], ['paymentMethod', '支付方式', record.paymentMethod || record.billingCycle || 'monthly', 'readonly'], ['durationPreset', '续费时长', record.durationPreset || '1month', 'select', 'days:按天|1month:+1个月|3months:+3个月|6months:+6个月|1year:+1年'], ['durationValue', '天数（按天时填写）', record.durationValue || 30], ['monthlyRent', '月租金（可调整）', record.monthlyRent || ''], ['monthlyPropertyFee', '物业费（可调整）', record.monthlyPropertyFee || ''], ['amount', '应付金额', record.amount || '', 'readonly'], ['renewalDate', '续费日期', record.renewalDate || today(), 'date'], ['note', '备注', record.note || '', 'textarea']]; if (type === 'maintenance') return [['roomNo', '房间号', record.roomNo || '', 'select', roomOptions(record.roomNo, true)], ['maintenanceDate', '维护日期', record.maintenanceDate || today(), 'date'], ['item', '维护事项', record.item || ''], ['amount', '金额', record.amount || ''], ['status', '状态', record.status || 'pending', 'select', 'pending:待处理|done:已完成'], ['note', '备注', record.note || '', 'textarea'], ['beforeImage', '维护前图片', '', 'file'], ['afterImage', '维护后图片', '', 'file'], ['paymentProof', '付款截图', '', 'file']]; if (type === 'costs') return [['roomNo', '房间号', record.roomNo || '', 'select', roomOptions(record.roomNo, true)], ['costDate', '费用日期', record.costDate || today(), 'date'], ['costType', '费用类型', record.costType || 'water', 'select', 'water:水费|electricity:电费|property:物业费|other:其他'], ['amount', '金额', record.amount || ''], ['period', '所属周期', record.period || ''], ['note', '备注', record.note || '', 'textarea']]; if (type === 'items') return [['roomNo', '房间号', record.roomNo || '', 'select', roomOptions(record.roomNo, true)], ['name', '物品名称', record.name || ''], ['note', '物品备注', record.note || '', 'textarea'], ['image', '物品照片', '', 'file']]; if (type === 'ledger') return [['direction', '收支方向', record.direction || 'income', 'select', 'income:收入|expense:支出'], ['category', '收支分类', record.category || 'rent', 'select', 'rent:租金|otherIncome:其他收入|landlordRent:托管房租|maintenance:维护维修|otherExpense:其他支出'], ['roomNo', '房间号', record.roomNo || '', 'select', roomOptions(record.roomNo, true)], ['amount', '金额', record.amount || ''], ['recordDate', '发生日期', record.recordDate || today(), 'date'], ['note', '备注', record.note || '', 'textarea']]; return [['roomNo', '房间号', record.roomNo || ''], ['tenantName', '租户姓名', record.tenantName || ''], ['tenantPhone', '租户电话', record.tenantPhone || ''], ['leaseStart', '租期开始', record.leaseStart || '', 'date'], ['leaseEnd', '租期结束', record.leaseEnd || '', 'date'], ['checkoutDate', '退房日期', record.checkoutDate || today(), 'date'], ['deposit', '入住押金', record.deposit || ''], ['waterStart', '入住水表', record.waterStart || ''], ['waterEnd', '退房水表', record.waterEnd || ''], ['waterUnitPrice', '水费单价', record.waterUnitPrice || ''], ['waterAmount', '水费扣除', record.waterAmount || ''], ['electricityStart', '入住电表', record.electricityStart || ''], ['electricityEnd', '退房电表', record.electricityEnd || ''], ['electricityUnitPrice', '电费单价', record.electricityUnitPrice || ''], ['electricityAmount', '电费扣除', record.electricityAmount || ''], ['propertyAmount', '物业费扣除', record.propertyAmount || ''], ['otherAmount', '其他扣除', record.otherAmount || ''], ['otherNote', '其他说明', record.otherNote || '', 'textarea'], ['bankName', '收款银行', record.bankName || ''], ['accountName', '收款人', record.accountName || ''], ['accountNo', '收款账号', record.accountNo || '']]; }
function renderFields(type, record) { $('#dialog-fields').innerHTML = fieldsFor(type, record).map(([key, label, value, inputType, options]) => { const full = inputType === 'textarea' || inputType === 'file'; if (inputType === 'select') return `<label class="${full ? 'full' : ''}">${label}<select name="${key}">${options.split('|').map((option) => { const [optionValue, text] = option.split(':'); return `<option value="${optionValue}" ${String(optionValue) === String(value) ? 'selected' : ''}>${text}</option>`; }).join('')}</select></label>`; if (inputType === 'textarea') return `<label class="full">${label}<textarea name="${key}">${esc(value)}</textarea></label>`; if (inputType === 'file') return `<label class="full">${label}<input name="${key}" type="file" accept="image/jpeg,image/png,image/webp" />${record[key] ? `<img class="upload-preview" src="${esc(record[key])}" alt="已上传图片" />` : ''}</label>`; const readonly = inputType === 'readonly' ? ' readonly' : ''; return `<label>${label}<input name="${key}" type="${inputType === 'date' ? 'date' : 'text'}" value="${esc(value)}"${readonly} /></label>`; }).join(''); }
function openDialog(type, id = '', roomNo = '', seed = {}) { if ((type === 'leases' || type === 'items' || type === 'ledger') && !visible(state.rooms).length) { alert('请先在房间管理中创建房间'); return; } state.recordType = type; state.recordId = id; const existing = (state[type] || []).find((item) => item.id === id); const room = state.rooms.find((item) => item.roomNo === roomNo); const record = existing || { roomNo, ...seed }; if (type === 'leases' && !id) { record._new = true; record._propertyFeeMode = room?.propertyFeeMode || 'included'; record._roomMonthlyPropertyFee = room?.monthlyPropertyFee || 0; } $('#dialog-title').textContent = `${id ? '编辑' : '新增'}${type === 'rooms' ? '房间' : type === 'leases' ? '入住记录' : type === 'renewal' ? '租户续费' : type === 'maintenance' ? '维护记录' : type === 'costs' ? '成本记录' : type === 'items' ? '房间物品' : type === 'ledger' ? '收支流水' : '退房清单'}`; renderFields(type, record); const checkoutTempSave = $('#checkout-temp-save'); if (checkoutTempSave) checkoutTempSave.hidden = type !== 'checkouts'; const checkoutCancel = $('#record-cancel'); if (checkoutCancel) checkoutCancel.textContent = type === 'checkouts' ? '取消退房' : '取消'; checkoutSubmitMode = 'completed'; $('#dialog-error').textContent = ''; $('#record-dialog').showModal(); if (type === 'renewal') updateRenewalAmount(); }
function updateRenewalAmount() { if (state.recordType !== 'renewal') return; const preset = $('#dialog-fields [name="durationPreset"]')?.value || '1month'; const days = Number($('#dialog-fields [name="durationValue"]')?.value || 30); const rent = Number($('#dialog-fields [name="monthlyRent"]')?.value || 0); const fee = Number($('#dialog-fields [name="monthlyPropertyFee"]')?.value || 0); const amount = preset === 'days' ? (rent + fee) / 30 * days : (rent + fee) * ({ '1month': 1, '3months': 3, '6months': 6, '1year': 12 }[preset] || 1); const field = $('#dialog-fields [name="amount"]'); if (field) field.value = amount.toFixed(2).replace(/\.00$/, ''); const dayField = $('#dialog-fields [name="durationValue"]')?.closest('label'); if (dayField) dayField.style.display = preset === 'days' ? '' : 'none'; }
function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败，请重新选择')); reader.readAsDataURL(file); }); }
function imageBlob(canvas, type, quality) { return new Promise((resolve) => canvas.toBlob(resolve, type, quality)); }
async function compressRentalImage(file, input) {
  if (!file?.type?.startsWith('image/')) return fileToDataUrl(file);
  const preserveText = ['idCardFront', 'idCardBack', 'paymentProof'].includes(input?.name);
  const maxEdge = preserveText ? 1920 : 1600;
  const targetBytes = preserveText ? 1500 * 1024 : 900 * 1024;
  if (file.size <= targetBytes) {
    const objectUrl = URL.createObjectURL(file);
    const probe = new Image();
    try {
      await new Promise((resolve, reject) => { probe.onload = resolve; probe.onerror = reject; probe.src = objectUrl; });
      if (Math.max(probe.naturalWidth, probe.naturalHeight) <= maxEdge) return fileToDataUrl(file);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片格式无法识别，请上传 JPG、PNG 或 WebP 图片')); image.src = objectUrl; });
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = preserveText ? 0.82 : 0.78;
    let blob = null;
    while (quality >= (preserveText ? 0.68 : 0.58)) {
      blob = await imageBlob(canvas, 'image/webp', quality);
      if (!blob || blob.type !== 'image/webp') blob = await imageBlob(canvas, 'image/jpeg', quality);
      if (blob && blob.size <= targetBytes) break;
      quality -= 0.06;
    }
    if (!blob) throw new Error('图片压缩失败，请重新选择');
    const originalIsSupported = /image\/(?:jpeg|png|webp)/.test(file.type);
    const output = originalIsSupported && file.size <= blob.size ? file : blob;
    return fileToDataUrl(output);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
async function readFileInput(input) { return input.files?.[0] ? compressRentalImage(input.files[0], input) : ''; }
async function readFileInputs(input) { const images = []; for (const file of input.files) images.push(await compressRentalImage(file, input)); return images; }
async function collectDialog() { const data = {}; for (const input of $('#dialog-fields').querySelectorAll('[name]')) { if (input.type === 'file') { const existing = input.dataset.existing ? JSON.parse(input.dataset.existing) : ''; data[input.name] = input.files?.length ? (input.multiple ? [...(Array.isArray(existing) ? existing : []), ...await readFileInputs(input)] : await readFileInput(input)) : existing; } else data[input.name] = input.value.trim(); } if (state.recordType === 'checkouts' && data.roomNo && !data.roomId) { const room = state.rooms.find((item) => item.id === data.roomNo); if (room) { data.roomId = room.id; data.roomNo = room.roomNo; } } return data; }
async function handleMaintenanceItemLink(data) { const room = state.rooms.find((item) => item.id === data.roomId) || state.rooms.find((item) => item.roomNo === data.roomNo); const roomNo = room?.roomNo || data.roomNo; if (state.recordType !== 'maintenance' || !roomNo || !data.item) return; const items = state.items.filter((item) => item.roomId === room?.id || (!item.roomId && item.roomNo === roomNo)).filter((item) => !item.archivedAt && String(item.name).trim() === String(data.item).trim()); if (data.maintenanceType === 'new' && !items.length) { await api('items', { method: 'POST', headers: { 'X-Skip-Maintenance-Sync': '1' }, body: JSON.stringify({ roomId: room?.id || data.roomId, roomNo, name: data.item, note: data.note || '' }) }); } if (data.maintenanceType === 'remove' && items.length && confirm(`是否同时删除房间内物品“${data.item}”？`)) { for (const item of items) await api(`items/${item.id}`, { method: 'DELETE', headers: { 'X-Skip-Maintenance-Sync': '1' } }); } }
async function saveDialog(event) {
  event.preventDefault();
  try {
    const data = await collectDialog();
    if (state.recordType === 'checkouts') data.status = checkoutSubmitMode === 'draft' ? 'draft' : 'completed';
    checkoutSubmitMode = 'completed';
    if (state.recordType === 'renewal') {
      const lease = state.leases.find((item) => item.id === state.recordId) || {};
      const initialPayment = !lease.paidThrough && !renewalsForLease(lease.id).length;
      await api('renewals', { method: 'POST', body: JSON.stringify({ leaseId: state.recordId, ...data, paymentType: initialPayment ? 'initial' : 'renewal', durationUnit: data.durationPreset === 'days' ? 'days' : 'months' }) });
    } else if (state.recordType === 'items' && Array.isArray(data.batchItems)) {
      const room = state.rooms.find((item) => item.id === data.roomId) || state.rooms.find((item) => item.roomNo === data.roomId);
      for (const item of data.batchItems) await api('items', { method: 'POST', body: JSON.stringify({ roomId: room?.id || data.roomId, roomNo: room?.roomNo || '', ...item }) });
    } else {
      let recordId = state.recordId;
      if (state.recordType === 'leases') {
        const current = state.leases.find((item) => item.id === recordId) || state.leases.find((item) => !item.archivedAt && ((data.roomId && item.roomId === data.roomId) || (!data.roomId && item.roomNo === data.roomNo)) && item.tenantPhone === data.tenantPhone && item.startDate === data.startDate);
        if (current) recordId = current.id;
      }
      const path = `${state.recordType}${recordId ? `/${recordId}` : ''}`;
      await api(path, { method: recordId ? 'PATCH' : 'POST', body: JSON.stringify(data) });
      if (state.recordType === 'maintenance') await handleMaintenanceItemLink(data);
    }
    $('#record-dialog').close();
    await load();
  } catch (error) {
    $('#dialog-error').textContent = error.message;
  }
}
async function generateDialogText() {
  try {
    const data = await collectDialog();
    let payload = { ...data, type: state.recordType === 'leases' ? 'move-in' : state.recordType === 'checkouts' ? 'checkout' : state.recordType };
    if (state.recordType === 'renewal') {
      const lease = state.leases.find((item) => item.id === state.recordId) || {};
      const room = state.rooms.find((item) => item.id === lease.roomId) || state.rooms.find((item) => item.roomNo === lease.roomNo);
      const months = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 };
      const initialPayment = !lease.paidThrough && !renewalsForLease(lease.id).length;
      const durationPreset = data.durationPreset || '1month';
      const durationValue = durationPreset === 'days' ? Math.max(1, Number(data.durationValue || 1)) : (months[durationPreset] || 1);
      payload = { type: initialPayment ? 'move-in' : 'renewal', ...lease, ...data, roomNo: room ? `${roomCommunityName(room)} · ${room.roomNo || ''}` : roomLabel(lease), moveInDate: lease.startDate, durationPreset, durationUnit: durationPreset === 'days' ? 'days' : 'months', durationValue, amount: data.amount };
    }
    const result = await api('summary', { method: 'POST', body: JSON.stringify(payload) });
    try { await navigator.clipboard.writeText(result.summary); $('#dialog-error').className = 'status'; $('#dialog-error').textContent = '文字已生成并复制'; }
    catch { $('#dialog-error').className = 'status'; $('#dialog-error').textContent = result.summary; }
  } catch (error) { $('#dialog-error').className = 'error'; $('#dialog-error').textContent = error.message; }
}
function showRenewals(leaseId) { const lease = state.leases.find((item) => item.id === leaseId); const rows = renewalsForLease(leaseId); $('#renewal-dialog-title').textContent = `${lease?.tenantName || ''} · ${roomLabel(lease)}续费记录`; $('#renewal-list').innerHTML = rows.length ? table(['续费日期', '续费时长', '续费周期', '月租', '物业费', '金额'], rows.map((item) => { const depositText = Number(item.deposit || 0) > 0 ? `（含押金${money(item.deposit)}）` : ''; return [item.renewalDate, item.durationUnit === 'days' ? `${item.durationValue}天` : `${item.durationValue}个月`, `${item.startDate || ''} 至 ${item.endDate || ''}`, money(item.monthlyRent), money(item.monthlyPropertyFee), `${money(item.amount)}${depositText}`]; })) : '<div class="renewal-empty"><strong>暂无续费记录</strong><span>完成一次续费后，日期、金额和续费周期会显示在这里。</span></div>'; $('#renewal-dialog').showModal(); }
function renderTemplate() { const fields = { renewal: [['roomNo', '房间号'], ['months', '续费月数'], ['monthlyRent', '房租'], ['monthlyPropertyFee', '物业费'], ['startDate', '入住时间', 'date'], ['endDate', '到期时间', 'date']], 'move-in': [['roomNo', '房间号'], ['paymentMethod', '支付方式'], ['deposit', '押金'], ['monthlyRent', '房租'], ['monthlyPropertyFee', '物业费'], ['startDate', '入住时间', 'date'], ['endDate', '到期时间', 'date']], checkout: [['roomNo', '房间号'], ['leaseStart', '租期开始', 'date'], ['leaseEnd', '租期结束', 'date'], ['deposit', '入住押金'], ['waterAmount', '水费'], ['electricityAmount', '电费'], ['otherNote', '其他说明']] }[state.template]; $('#template-form').innerHTML = fields.map(([key, label, type]) => `<label>${label}<input name="${key}" type="${type || 'text'}" /></label>`).join(''); }
function leaseFields(record) {
  const room = state.rooms.find((item) => item.id === record.roomId) || state.rooms.find((item) => item.roomNo === record.roomNo);
  const propertyFee = record.propertyFeeMode === 'tenant_self' ? 0 : (record.monthlyPropertyFee ?? record._roomMonthlyPropertyFee ?? room?.monthlyPropertyFee ?? 0);
  return [['roomId', '小区/房间', room?.id || '', 'select', roomOptions(room?.id || record.roomId || record.roomNo, false)], ['tenantName', '租户姓名', record.tenantName || ''], ['tenantPhone', '租户电话', record.tenantPhone || ''], ['purpose', '住房目的', record.purpose || 'self', 'select', 'self:自住|studio:工作室|homestay:民宿|other:其他'], ['startDate', '入住时间', record.startDate || today(), 'date'], ['endDate', '合同结束时间', record.endDate || '', 'date'], ['paidThrough', '已付至', record.paidThrough || '', 'date'], ['paymentMethod', '租金支付方式', record.paymentMethod || record.billingCycle || 'monthly', 'select', 'monthly:月付|quarterly:季付|yearly:年付'], ['monthlyRent', '月租金（计费基准）', record.monthlyRent || ''], ['deposit', '押金', record.deposit || ''], ['propertyFeeMode', '物业费收取方式', record.propertyFeeMode || record._propertyFeeMode || room?.propertyFeeMode || 'included', 'select', 'included:与房租一起交|tenant_self:租户自理'], ['monthlyPropertyFee', '每月物业费', propertyFee, 'readonly'], ['totalMonthly', '合计每月应收', Number(record.monthlyRent || 0) + Number(propertyFee), 'readonly'], ['moveInElectricity', '入住电表读数', record.moveInElectricity || ''], ['moveInWater', '入住水表读数', record.moveInWater || ''], ['idCardFront', '身份证正面', record.idCardFront || '', 'file'], ['idCardBack', '身份证反面', record.idCardBack || '', 'file'], ['note', '备注', record.note || '', 'textarea']];
}
function renewalFields(record) {
  const lease = state.leases.find((item) => item.id === record.leaseId || item.roomNo === record.roomNo) || {};
  const start = lease.paidThrough ? addDays(lease.paidThrough, 1) : (record.startDate || today());
  return [['roomNo', '小区/房间', roomLabel(record.roomNo), 'readonly'], ['tenantName', '租户姓名', record.tenantName || lease.tenantName || '', 'readonly'], ['tenantPhone', '租户电话', record.tenantPhone || lease.tenantPhone || '', 'readonly'], ['renewalDate', '续费日期', record.renewalDate || today(), 'date'], ['durationPreset', '续租周期', record.durationPreset || '1month', 'select', 'days:按天|1month:+1个月|3months:+3个月|6months:+6个月|1year:+1年'], ['durationValue', '天数', record.durationValue || 30], ['startDate', '本次续租开始', start, 'readonly'], ['endDate', '续费后到期', record.endDate || '', 'readonly'], ['monthlyRent', '月租金（可调整）', record.monthlyRent ?? lease.monthlyRent ?? ''], ['monthlyPropertyFee', '物业费（可调整）', record.monthlyPropertyFee ?? lease.monthlyPropertyFee ?? ''], ['amount', '应付金额', record.amount || '', 'readonly'], ['note', '备注', record.note || '', 'textarea']];
}
function checkoutFields(record) {
  const room = state.rooms.find((item) => item.id === record.roomId) || state.rooms.find((item) => item.roomNo === record.roomNo);
  const roomField = record.leaseId
    ? ['roomNo', '小区/房间', roomLabel(record), 'readonly']
    : ['roomId', '小区/房间', room?.id || '', 'select', roomOptions(room?.id || record.roomId || record.roomNo, false)];
  return [roomField, ['tenantName', '租户姓名', record.tenantName || '', 'readonly'], ['tenantPhone', '租户电话', record.tenantPhone || '', 'readonly'], ['leaseStart', '租期开始', record.leaseStart || '', 'readonly'], ['leaseEnd', '合同结束时间', record.leaseEnd || '', 'readonly'], ['paidThrough', '已缴费至', record.paidThrough || '', 'readonly'], ['deposit', '入住押金', record.deposit || '', 'readonly'], ['checkoutDate', '退房时间', record.checkoutDate || today(), 'date'], ['waterStart', '入住水表', record.waterStart || '', 'readonly'], ['waterEnd', '退房水表', record.waterEnd || ''], ['waterUnitPrice', '水费单价', record.waterUnitPrice ?? state.settings.waterUnitPrice, 'readonly'], ['waterAmount', '水费扣除', record.waterAmount || '', 'readonly'], ['electricityStart', '入住电表', record.electricityStart || '', 'readonly'], ['electricityEnd', '退房电表', record.electricityEnd || ''], ['electricityUnitPrice', '电费单价', record.electricityUnitPrice ?? state.settings.electricityUnitPrice, 'readonly'], ['electricityAmount', '电费返还/扣除', record.electricityAmount || '', 'readonly'], ['propertyAmount', '物业费扣除', record.propertyAmount || ''], ['bankHeading', '收款信息', '', 'heading'], ['bankName', '收款银行', record.bankName || ''], ['accountName', '收款人', record.accountName || ''], ['accountNo', '收款账号', record.accountNo || ''], ['otherHeading', '其他扣除', '', 'heading'], ['otherItems', '额外扣除项', record.otherItems || [], 'json'], ['refundAmount', '应退押金', record.refundAmount || '', 'readonly'], ['note', '备注', record.note || '', 'textarea']];
}
function fieldsFor(type, record = {}) {
  if (type === 'leases') return leaseFields(record);
  if (type === 'renewal') return renewalFields(record);
  if (type === 'checkouts') return checkoutFields(record);
  if (type === 'communities') { const publicEnabled = record.publicEnabled === true || record.publicEnabled === 1 || record.publicEnabled === '1' ? '1' : '0'; return [['communityHeading', '小区资料', '', 'heading'], ['name', '小区名称', record.name || ''], ['signingAddress', '合同签约地址', record.signingAddress || ''], ['publicHeading', '对外展示资料', '', 'heading'], ['publicEnabled', '对外展示状态', publicEnabled, 'select', '0:暂不展示|1:公开展示'], ['publicDisplayAddress', '对外显示区域/地址', record.publicDisplayAddress || ''], ['publicDescription', '小区简介', record.publicDescription || '', 'textarea'], ['publicNearby', '周边配套', record.publicNearby || '', 'textarea'], ['publicAmenities', '小区特色', record.publicAmenities || ''], ['publicCoverImage', '小区封面图地址（可选）', record.publicCoverImage || '', 'url'], ['publicSort', '展示顺序', record.publicSort ?? 0], ['ratesHeading', '费用单价', '', 'heading'], ['propertyUnitPrice', '物业费单价（元/㎡·月）', record.propertyUnitPrice ?? 0], ['waterUnitPrice', '水费单价（元/方）', record.waterUnitPrice ?? 0], ['electricityUnitPrice', '电费单价（元/度）', record.electricityUnitPrice ?? 0], ['gasUnitPrice', '燃气费单价（元/方）', record.gasUnitPrice ?? 0], ['reminderDays', '到期提醒天数', record.reminderDays ?? 10]]; }
  const room = state.rooms.find((item) => item.id === record.roomId) || state.rooms.find((item) => item.roomNo === record.roomNo);
  const roomLease = type === 'rooms' ? leaseForRoom(record.roomNo) : null;
  const community = state.communities.find((item) => item.id === record.communityId) || state.communities.find((item) => item.name === record.propertyName);
  const roomStatusInput = roomLease ? 'readonly' : 'select';
  const roomStatusValue = roomLease ? '已租出' : (record.status === 'maintenance' ? 'maintenance' : 'vacant');
  const area = Number(record.area ?? room?.area ?? 0);
  const propertyUnitPrice = Number(community?.propertyUnitPrice ?? record.propertyUnitPrice ?? room?.propertyUnitPrice ?? 0);
  const roomMonthlyPropertyFee = record.monthlyPropertyFee ?? (area * propertyUnitPrice);
  const propertyFee = record._propertyFeeMode === 'tenant_self' ? 0 : (record.monthlyPropertyFee ?? record._roomMonthlyPropertyFee ?? room?.monthlyPropertyFee ?? 0);
  if (type === 'rooms') { const communityId = community?.id || record.communityId || ''; const publicEnabled = record.publicEnabled === true || record.publicEnabled === 1 || record.publicEnabled === '1' ? '1' : '0'; return [['basicHeading', '基本信息', '', 'heading'], ['communityId', '所属小区', communityId, 'select', communityOptions(communityId, record.propertyName)], ['roomNo', '房间号', record.roomNo || ''], ['status', '状态', roomStatusValue, roomStatusInput, roomStatusInput === 'select' ? 'vacant:空置|maintenance:装修维护中' : undefined], ['area', '面积（㎡）', record.area || ''], ['propertyUnitPrice', '物业费单价', propertyUnitPrice, 'readonly'], ['monthlyPropertyFee', '每月物业费', roomMonthlyPropertyFee], ['publicHeading', '对外展示资料', '', 'heading'], ['publicEnabled', '对外展示状态', publicEnabled, 'select', '0:暂不展示|1:公开展示'], ['publicTitle', '对外展示标题', record.publicTitle || ''], ['publicRent', '对外月租金', record.publicRent ?? ''], ['publicLayout', '户型', record.publicLayout || ''], ['publicOrientation', '朝向', record.publicOrientation || ''], ['publicFloor', '楼层', record.publicFloor || ''], ['publicFurnishing', '装修情况', record.publicFurnishing || ''], ['publicAvailableDate', '可入住日期', record.publicAvailableDate || '', 'date'], ['publicRenovationEndDate', '预计装修完成', record.publicRenovationEndDate || '', 'date'], ['publicHighlights', '房源亮点', record.publicHighlights || '', 'textarea'], ['publicDescription', '房源介绍', record.publicDescription || '', 'textarea'], ['publicCoverImage', '对外封面图地址（可选）', record.publicCoverImage || '', 'url'], ['publicSort', '展示顺序', record.publicSort ?? 0], ['managementHeading', '托管信息', '', 'heading'], ['landlordLeaseStart', '托管开始时间', record.landlordLeaseStart || '', 'date'], ['landlordLeaseEnd', '托管结束时间', record.landlordLeaseEnd || '', 'date'], ['landlordAnnualRent', '托管年租金', record.landlordAnnualRent ?? Number(record.landlordMonthlyRent || 0) * 12], ['landlordContractType', '托管合同', record.landlordContractType || '', 'select', ':未设置|paper:纸质版合同|electronic:电子版合同'], ['landlordContractFile', '纸质版合同 PDF', record.landlordContractFile || '', 'pdf'], ['landlordContractUrl', '电子版合同地址', record.landlordContractUrl || '', 'url'], ['note', '备注', record.note || '', 'textarea']]; }
  if (type === 'leases') return [['roomId', '小区/房间', room?.id || '', 'select', roomOptions(room?.id || record.roomId || record.roomNo, false)], ['tenantName', '租户姓名', record.tenantName || ''], ['tenantPhone', '租户电话', record.tenantPhone || ''], ['purpose', '住房目的', record.purpose || 'self', 'select', 'self:自住|studio:工作室|homestay:民宿|other:其他'], ['idCardFront', '身份证正面', '', 'file'], ['idCardBack', '身份证反面', '', 'file'], ['paymentMethod', '租金支付方式', record.paymentMethod || record.billingCycle || 'monthly', 'select', 'monthly:月付|quarterly:季付|yearly:年付'], ['propertyFeeMode', '物业费收取方式', record.propertyFeeMode || record._propertyFeeMode || room?.propertyFeeMode || 'included', 'select', 'included:与房租一起交|tenant_self:租户自理'], ['monthlyRent', '月租金（计费基准）', record.monthlyRent || ''], ['monthlyPropertyFee', '每月物业费', record.propertyFeeMode === 'tenant_self' ? 0 : propertyFee, 'readonly'], ['deposit', '押金', record.deposit || ''], ['startDate', '入住时间', record.startDate || today(), 'date'], ['endDate', '合同结束时间', record.endDate || '', 'date'], ['paidThrough', '已付至（提醒依据）', record.paidThrough || '', 'date'], ['reminderEnabled', '开启续费提醒', record.reminderEnabled === false ? '0' : '1', 'select', '1:开启|0:关闭'], ['moveInWater', '入住水表度数', record.moveInWater || ''], ['moveInElectricity', '入住电表度数', record.moveInElectricity || ''], ['note', '备注', record.note || '', 'textarea']];
  if (type === 'renewal') return [['roomNo', '小区/房间', roomLabel(record.roomNo), 'readonly'], ['tenantName', '租户姓名', record.tenantName || '', 'readonly'], ['tenantPhone', '租户电话', record.tenantPhone || '', 'readonly'], ['durationPreset', '续费时长（请选择）', record.durationPreset || '1month', 'select', 'days:按天|1month:+1个月|3months:+3个月|6months:+6个月|1year:+1年'], ['durationValue', '天数（按天时填写）', record.durationValue || 30], ['startDate', '租户入住日期', record.startDate || record.paidThrough || today(), 'readonly'], ['endDate', '续费后到期日', record.endDate || '', 'readonly'], ['monthlyRent', '月租金（可调整）', record.monthlyRent || ''], ['monthlyPropertyFee', '物业费（可调整）', propertyFee], ['amount', '应付金额', record.amount || '', 'readonly'], ['renewalDate', '续费日期', record.renewalDate || today(), 'date'], ['note', '备注', record.note || '', 'textarea']];
  if (type === 'maintenance') { const itemField = record.maintenanceType === 'remove' ? ['item', '选择要删除的物品', record.item || '', 'select', itemOptions(record.roomId || record.roomNo)] : ['item', '维护事项/物品名称', record.item || '']; return [['roomId', '小区/房间', room?.id || '', 'select', roomOptions(room?.id || record.roomId || record.roomNo, true)], ['maintenanceDate', '维护日期', record.maintenanceDate || today(), 'date'], ['maintenanceType', '维护类型', record.maintenanceType || 'repair', 'select', 'repair:房间日常维护|new:新增物品|remove:删除物品'], itemField, ['amount', '金额', record.amount || ''], ['note', '备注', record.note || '', 'textarea'], ['beforeImage', '维护前图片', '', 'file'], ['afterImage', '维护后图片', '', 'file'], ['paymentProof', '付款截图', '', 'file']]; }
  if (type === 'costs') return [['roomId', '小区/房间', room?.id || '', 'select', roomOptions(room?.id || record.roomId || record.roomNo, true)], ['costDate', '费用日期', record.costDate || today(), 'date'], ['costType', '费用类型', record.costType || 'water', 'select', 'water:水费|electricity:电费|property:物业费|gas:燃气费|other:其他'], ['amount', '金额', record.amount || ''], ['period', '所属周期', record.period || ''], ['note', '备注', record.note || '', 'textarea']];
  if (type === 'items') return [['roomId', '小区/房间', room?.id || '', 'select', roomOptions(room?.id || record.roomId || record.roomNo, true)], ['name', '物品名称', record.name || ''], ['quantity', '数量', record.quantity || 1], ['note', '物品备注', record.note || '', 'textarea'], ['image', '物品照片', '', 'file']];
  if (type === 'ledger') return [['direction', '收支方向', record.direction || 'income', 'select', 'income:收入|expense:支出'], ['category', '收支分类', record.category || 'rent', 'select', 'rent:租金|otherIncome:其他收入|landlordRent:托管房租|maintenance:维护维修|otherExpense:其他支出'], ['roomId', '小区/房间', room?.id || '', 'select', roomOptions(room?.id || record.roomId || record.roomNo, true)], ['amount', '金额', record.amount || ''], ['recordDate', '发生日期', record.recordDate || today(), 'date'], ['note', '备注', record.note || '', 'textarea']];
  if (type === 'checkouts') return [['roomNo', '小区/房间', record.roomNo || '', record.leaseId ? 'readonly' : 'select', record.leaseId ? '' : roomOptions(record.roomNo, false)], ['tenantName', '租户姓名', record.tenantName || '', 'readonly'], ['tenantPhone', '租户电话', record.tenantPhone || '', 'readonly'], ['leaseStart', '租期开始', record.leaseStart || '', 'readonly'], ['leaseEnd', '租期结束', record.leaseEnd || '', 'readonly'], ['checkoutDate', '退房日期', record.checkoutDate || today(), 'date'], ['deposit', '入住押金', record.deposit || '', 'readonly'], ['waterStart', '入住水表', record.waterStart || '', 'readonly'], ['waterEnd', '退房水表', record.waterEnd || ''], ['waterUnitPrice', '水费单价', record.waterUnitPrice ?? state.settings.waterUnitPrice, 'readonly'], ['waterAmount', '水费扣除', record.waterAmount || '', 'readonly'], ['electricityStart', '入住电表', record.electricityStart || '', 'readonly'], ['electricityEnd', '退房电表', record.electricityEnd || ''], ['electricityUnitPrice', '电费单价', record.electricityUnitPrice ?? state.settings.electricityUnitPrice, 'readonly'], ['electricityAmount', '电费扣除', record.electricityAmount || '', 'readonly'], ['propertyAmount', '物业费扣除', record.propertyAmount || ''], ['otherAmount', '其他扣除', record.otherAmount || ''], ['otherNote', '其他说明', record.otherNote || '', 'textarea'], ['bankName', '收款银行', record.bankName || ''], ['accountName', '收款人', record.accountName || ''], ['accountNo', '收款账号', record.accountNo || '']];
  return [];
}
function renderFields(type, record) { const fields = $('#dialog-fields'); fields.className = `dialog-fields dialog-${type}`; fields.innerHTML = fieldsFor(type, record).map(([key, label, value, inputType, options]) => { const full = inputType === 'textarea' || inputType === 'file'; const summary = type === 'renewal' && ['roomNo', 'tenantName', 'tenantPhone', 'startDate', 'endDate', 'amount'].includes(key); const className = `${full ? 'full ' : ''}field-${key}${inputType === 'readonly' || key.endsWith('Amount') || key === 'amount' ? ' calculated-field' : ''}${summary ? ' summary-field' : ''}`; if (inputType === 'select') return `<label class="${className}">${label}<select name="${key}">${options.split('|').map((option) => { const [optionValue, text] = option.split(':'); return `<option value="${optionValue}" ${String(optionValue) === String(value) ? 'selected' : ''}>${text}</option>`; }).join('')}</select></label>`; if (inputType === 'textarea') return `<label class="${className}">${label}<textarea name="${key}">${esc(value)}</textarea></label>`; if (inputType === 'file') { const existingValue = Array.isArray(record[key]) ? record[key] : (record[key] || ''); const existingImages = Array.isArray(record[key]) ? record[key] : (record[key] ? [record[key]] : []); const preview = existingImages.length ? existingImages.map((image) => `<img class="upload-preview item-preview-trigger" src="${esc(image)}" alt="已上传图片，点击可预览" data-preview-image="${esc(image)}" />`).join('') : '<span class="meta">未上传</span>'; return `<label class="${className}">${label}<input name="${key}" type="file" accept="image/jpeg,image/png,image/webp"${key === 'images' ? ' multiple' : ''} data-existing="${esc(JSON.stringify(existingValue))}" />${preview}</label>`; } const readonly = inputType === 'readonly' ? ' readonly' : ''; return `<label class="${className}">${label}<input name="${key}" type="${inputType === 'date' ? 'date' : 'text'}" value="${esc(value)}"${readonly} /></label>`; }).join(''); }
function openDialog(type, id = '', roomNo = '', seed = {}) { if ((type === 'leases' || type === 'items' || type === 'ledger') && !visible(state.rooms).length) { alert('请先在房间管理中创建房间'); return; } state.recordType = type; state.recordId = id; const existing = (state[type] || []).find((item) => item.id === id); const room = state.rooms.find((item) => item.id === seed.roomId) || state.rooms.find((item) => item.roomNo === roomNo); const record = existing || { roomNo, ...seed }; const lease = room ? leaseForRoom(room) : null; if (type === 'leases' && !id) { record._new = true; record._propertyFeeMode = room?.propertyFeeMode || 'included'; record._roomMonthlyPropertyFee = room?.monthlyPropertyFee || 0; } if (type === 'renewal' && lease) { record.monthlyRent = lease.monthlyRent; record.monthlyPropertyFee = lease.monthlyPropertyFee || (room?.propertyFeeMode === 'tenant_self' ? 0 : room?.monthlyPropertyFee || 0); record.startDate = lease.paidThrough ? addDays(lease.paidThrough, 1) : today(); record.paymentMethod = lease.paymentMethod; } if (type === 'checkouts' && lease && !id) Object.assign(record, { leaseId: lease.id, roomId: lease.roomId, tenantName: lease.tenantName, tenantPhone: lease.tenantPhone, leaseStart: lease.startDate, leaseEnd: lease.endDate, deposit: lease.deposit, waterStart: lease.moveInWater, electricityStart: lease.moveInElectricity, waterUnitPrice: state.settings.waterUnitPrice, electricityUnitPrice: state.settings.electricityUnitPrice }); $('#dialog-title').textContent = `${id ? '编辑' : '新增'}${type === 'rooms' ? '房间' : type === 'leases' ? '入住记录' : type === 'renewal' ? '租户续费' : type === 'maintenance' ? '维护记录' : type === 'costs' ? '成本记录' : type === 'items' ? '房间物品' : type === 'ledger' ? '收支流水' : '退房清单'}`; renderFields(type, record); $('#dialog-error').textContent = ''; $('#record-dialog').showModal(); if (type === 'renewal') updateRenewalAmount(); if (type === 'checkouts') updateCheckoutAmounts(); }
function updateRenewalAmount() { if (state.recordType !== 'renewal') return; const preset = $('#dialog-fields [name="durationPreset"]')?.value || '1month'; const days = Number($('#dialog-fields [name="durationValue"]')?.value || 30); const rent = Number($('#dialog-fields [name="monthlyRent"]')?.value || 0); const fee = Number($('#dialog-fields [name="monthlyPropertyFee"]')?.value || 0); const months = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 }; const amount = preset === 'days' ? (rent + fee) / 30 * days : (rent + fee) * (months[preset] || 1); const start = $('#dialog-fields [name="startDate"]')?.value || today(); const end = preset === 'days' ? addDays(start, days - 1) : addDays(addMonthsClamped(start, months[preset] || 1), -1); const amountField = $('#dialog-fields [name="amount"]'); const endField = $('#dialog-fields [name="endDate"]'); if (amountField) amountField.value = amount.toFixed(2).replace(/\.00$/, ''); if (endField) endField.value = end; const dayField = $('#dialog-fields [name="durationValue"]')?.closest('label'); if (dayField) dayField.style.display = preset === 'days' ? '' : 'none'; }
function addDays(value, days) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function addMonthsClamped(value, months) { const date = new Date(`${value}T00:00:00Z`); const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months); const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(day, last)); return date.toISOString().slice(0, 10); }
 function updateCheckoutAmounts() { if (state.recordType !== 'checkouts') return; const startWater = Number($('#dialog-fields [name="waterStart"]')?.value || 0); const endWater = Number($('#dialog-fields [name="waterEnd"]')?.value || 0); const waterPrice = Number($('#dialog-fields [name="waterUnitPrice"]')?.value || state.settings.waterUnitPrice || 0); const startElectricity = Number($('#dialog-fields [name="electricityStart"]')?.value || 0); const endElectricity = Number($('#dialog-fields [name="electricityEnd"]')?.value || 0); const electricityPrice = Number($('#dialog-fields [name="electricityUnitPrice"]')?.value || state.settings.electricityUnitPrice || 0); const water = $('#dialog-fields [name="waterAmount"]'); const electricity = $('#dialog-fields [name="electricityAmount"]'); if (water) water.value = Math.max(0, (endWater - startWater) * waterPrice).toFixed(1); if (electricity) electricity.value = ((startElectricity - endElectricity) * electricityPrice).toFixed(1); }
function updateLeasePropertyFee() { if (state.recordType !== 'leases') return; const mode = $('#dialog-fields [name="propertyFeeMode"]')?.value; const roomId = $('#dialog-fields [name="roomId"]')?.value; const room = state.rooms.find((item) => item.id === roomId); const field = $('#dialog-fields [name="monthlyPropertyFee"]'); if (field) field.value = mode === 'tenant_self' ? '0' : String(room?.monthlyPropertyFee || 0); }
function updateRoomCommunityDefaults() { if (state.recordType !== 'rooms') return; const communityId = $('#dialog-fields [name="communityId"]')?.value; const community = state.communities.find((item) => item.id === communityId); const area = Number($('#dialog-fields [name="area"]')?.value || 0); const unit = Number(community?.propertyUnitPrice || 0); const unitField = $('#dialog-fields [name="propertyUnitPrice"]'); const feeField = $('#dialog-fields [name="monthlyPropertyFee"]'); if (unitField) unitField.value = String(unit); if (feeField) feeField.value = (area * unit).toFixed(2).replace(/\.00$/, ''); }
document.addEventListener('change', (event) => { if (event.target.matches('#dialog-fields [name="communityId"]')) updateRoomCommunityDefaults(); });
function refreshMaintenanceItemField() { if (state.recordType !== 'maintenance') return; const values = {}; $('#dialog-fields').querySelectorAll('[name]').forEach((input) => { if (input.type !== 'file') values[input.name] = input.value; }); renderFields('maintenance', values); }
function renderSettings() { if (typeof renderSettingsWithContractTemplate === 'function') renderSettingsWithContractTemplate(); }
function renderUsers() { const form = $('#rental-user-form'); const list = $('#user-list'); if (!form || !list) return; const allowed = Boolean(state.session?.actor?.platformAdmin); const panel = form.closest('.account-panel'); if (panel) { panel.hidden = !allowed; if (allowed) panel.style.removeProperty('display'); else panel.style.setProperty('display', 'none', 'important'); } form.hidden = !allowed; list.hidden = !allowed; if (!allowed) return; list.innerHTML = table(['账号', '名称', '权限', '状态', '操作'], state.users.map((user) => { const isMain = user.username === 'admin'; const role = user.platformAdmin || user.role === 'admin' ? '平台超级管理员' : '普通管理员'; const actions = isMain ? '<span class="meta">平台主账号不可编辑</span>' : `<button class="small" data-edit-user="${esc(user.username)}">编辑</button><button class="small" data-toggle-user="${esc(user.username)}" data-enabled="${user.enabled ? '0' : '1'}">${user.enabled ? '停用' : '启用'}</button>`; return [esc(user.username), esc(user.displayName), role, user.enabled ? '启用' : '已停用', actions]; })); }
function auditDetailText(item) {
  const sources = { rooms: state.rooms, communities: state.communities, leases: state.leases, maintenance: state.maintenance, checkouts: state.checkouts, costs: state.costs, items: state.items, ledger: state.ledger, bills: state.bills, renewals: state.renewals };
  const record = sources[item.resource]?.find((row) => row.id === item.recordId) || {};
  const room = state.rooms.find((row) => row.id === record.roomId) || state.rooms.find((row) => row.roomNo === record.roomNo) || (item.resource === 'rooms' ? record : {});
  const roomName = [room.propertyName, room.roomNo].filter(Boolean).join('');
  const details = item.details || {};
  const entries = Object.entries(details.changes || details.fields || {});
  const format = (label, value) => {
    if (label.includes('照片')) return Array.isArray(value) ? `${value.length}张` : '已更新';
    const valueLabels = { vacant: '空置', occupied: '已租出', maintenance: '装修维护中', active: '在租', ended: '已退租', self: '自住', studio: '工作室', homestay: '民宿', other: '其他', monthly: '月付', quarterly: '季付', yearly: '年付', included: '与房租一起交', tenant_self: '租户自理', pending: '待处理', done: '已完成维护', reimbursed: '已报销', income: '收入', expense: '支出' };
    if (valueLabels[value] !== undefined) return valueLabels[value];
    if (Array.isArray(value)) return `${value.length}项`;
    if (value === true) return '是';
    if (value === false) return '否';
    return value === '' || value === null || value === undefined ? '空' : String(value);
  };
  const changes = entries.map(([label, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && ('before' in value || 'after' in value)) return `${label}：${format(label, value.before)} → ${format(label, value.after)}`;
    return `${label}：${format(label, value)}`;
  }).join('；');
  const actions = { create: '新增', update: '修改', archive: '归档', purge: '彻底删除' };
  const resources = { rooms: '房间信息', communities: '小区信息', leases: '租户入住记录', renewals: '租户续费记录', maintenance: '维护记录', checkouts: '退房记录', costs: '成本记录', items: '房间物品', ledger: '收支记录', bills: '账单', settings: '租房设置', users: '后台账号' };
  const action = actions[item.action] || item.action || '操作';
  if (item.resource === 'rooms' && item.action === 'update' && entries.some(([label]) => label.includes('照片'))) return `${action}房间照片${roomName ? `，房间号${roomName}` : ''}${changes ? `；${changes}` : ''}`;
  const subject = roomName ? `，房间号${roomName}` : record.tenantName ? `，租户${record.tenantName}` : '';
  return `${action}${resources[item.resource] || '记录'}${subject}${changes ? `；${changes}` : ''}`;
}
function renderAudit() { const labels = { rooms: '房间', communities: '小区', leases: '租户入住', maintenance: '维护', checkouts: '退房', costs: '成本', items: '物品', ledger: '收支', bills: '账单', renewals: '续费', settings: '设置', users: '账号' }; const actions = { create: '新增', update: '修改', archive: '归档', purge: '彻底删除' }; $('#audit-list').innerHTML = table(['时间', '操作者', '模块', '操作', '详细内容'], state.audit.map((item) => [item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '', esc(item.actor || '管理员'), labels[item.resource] || item.resource, actions[item.action] || item.action, `<div class="audit-detail">${esc(auditDetailText(item))}</div>`])); }
async function saveSettings(event) { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries([...form.elements].filter((item) => item.name).map((item) => [item.name, item.value])); try { state.settings = await api('settings', { method: 'PATCH', body: JSON.stringify(data) }); $('#settings-status').textContent = '设置已保存'; render(); } catch (error) { $('#settings-status').textContent = error.message; } }
async function createRentalUser(event) { event.preventDefault(); const form = event.currentTarget; const status = $('#user-status'); if (!state.session?.actor?.platformAdmin) { if (status) status.textContent = '只有平台超级管理员可以创建后台账号'; return; } const data = Object.fromEntries([...form.elements].filter((item) => item.name).map((item) => [item.name, item.value])); if (status) status.textContent = '正在创建账号…'; try { await api('workspaces', { method: 'POST', body: JSON.stringify(data) }); form.reset(); if (status) status.textContent = `账号 ${data.username} 创建成功`; await load(); } catch (error) { if (status) status.textContent = `创建失败：${error.message}`; } }
function openUserEditDialog(username) { if (!state.session?.actor?.platformAdmin) return; const user = state.users.find((item) => item.username === username && item.username !== 'admin'); const dialog = $('#user-edit-dialog'); const form = $('#user-edit-form'); if (!user || !dialog || !form) return; form.elements.username.value = user.username; form.elements.usernameDisplay.value = user.username; form.elements.displayName.value = user.displayName || user.username; form.elements.role.value = user.platformAdmin || user.role === 'admin' ? 'platformAdmin' : 'user'; form.elements.password.value = ''; $('#user-edit-error').textContent = ''; dialog.showModal(); }
document.addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-user]'); if (edit) openUserEditDialog(edit.dataset.editUser); });
document.addEventListener('submit', async (event) => { if (event.target.id !== 'user-edit-form') return; event.preventDefault(); const form = event.target; if (!state.session?.actor?.platformAdmin) return; const username = form.elements.username.value; const data = { displayName: form.elements.displayName.value.trim(), role: form.elements.role.value }; if (form.elements.password.value) data.password = form.elements.password.value; try { await api(`users/${encodeURIComponent(username)}`, { method: 'PATCH', body: JSON.stringify(data) }); $('#user-edit-dialog').close(); await load(); } catch (error) { $('#user-edit-error').textContent = error.message; } }, true);
async function createTemplate() { const data = Object.fromEntries([...$('#template-form').elements].map((element) => [element.name, element.value])); data.type = state.template; const result = await api('summary', { method: 'POST', body: JSON.stringify(data) }); $('#template-output').value = result.summary; try { await navigator.clipboard.writeText(result.summary); $('#template-status').textContent = '已生成并复制文字'; } catch { $('#template-status').textContent = '已生成文字，请手动复制'; } }
document.addEventListener('click', async (event) => { const preview = event.target.closest('[data-preview-image]'); if (preview) { $('#image-preview').src = preview.dataset.previewImage; $('#image-preview-dialog').showModal(); return; } const tab = event.target.closest('[data-tab]'); if (tab) { document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === tab)); document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === tab.dataset.tab)); return; } const purge = event.target.closest('[data-purge]'); if (purge) { if (!confirm('彻底删除后无法恢复，是否继续？')) return; try { await api(`${purge.dataset.purgeType}/${purge.dataset.purgeId}?purge=1`, { method: 'DELETE' }); await load(); } catch (error) { alert(error.message); } return; } const show = event.target.closest('[data-show-renewals]'); if (show) { showRenewals(show.dataset.showRenewals); return; } const action = event.target.closest('[data-action]'); if (action) { const map = { 'add-room': 'rooms', 'add-lease': 'leases', 'add-maintenance': 'maintenance', 'add-checkout': 'checkouts', 'add-cost': 'costs', 'add-item': 'items', 'add-ledger': 'ledger' }; const roomNo = action.dataset.roomNo || ''; const roomId = action.dataset.roomId || ''; const selectedRoom = state.rooms.find((item) => item.id === roomId) || state.rooms.find((item) => item.roomNo === roomNo); const lease = selectedRoom ? leaseForRoom(selectedRoom) : (roomNo ? leaseForRoom(roomNo) : null); if (action.dataset.action === 'add-lease' && lease) { openDialog('renewal', lease.id, roomNo, lease); return; } const seed = lease && action.dataset.action === 'add-checkout' ? { tenantName: lease.tenantName, tenantPhone: lease.tenantPhone, leaseStart: lease.startDate, leaseEnd: lease.endDate, deposit: lease.deposit } : {}; openDialog(map[action.dataset.action], '', roomNo, { roomId: selectedRoom?.id || '', ...seed }); return; } const edit = event.target.closest('[data-edit]'); if (edit) { openDialog(edit.dataset.edit, edit.dataset.id); return; } const del = event.target.closest('[data-delete]'); if (del && confirm('该记录将被归档并保留历史，是否继续？')) { const deleteType = del.dataset.delete; try { await api(`${deleteType}/${del.dataset.id}`, { method: 'DELETE' }); await load(); if (deleteType === 'items' && $('#room-items-dialog')?.open && state.itemRoomNo) openRoomItems(state.itemRoomId || state.itemRoomNo); if (deleteType === 'maintenance' && $('#room-maintenance-dialog')?.open && state.maintenanceRoomNo) openRoomMaintenance(state.maintenanceRoomNo); } catch (error) { alert(error.message); } return; } const copy = event.target.closest('[data-copy-checkout]'); if (copy) { const record = state.checkouts.find((item) => item.id === copy.dataset.copyCheckout); const result = await api('summary', { method: 'POST', body: JSON.stringify({ type: 'checkout', ...record }) }); try { await navigator.clipboard.writeText(result.summary); alert('退房文字已复制'); } catch { alert(result.summary); } } });
document.addEventListener('click', async (event) => {
  const tempSave = event.target.closest('#checkout-temp-save');
  if (tempSave) {
    if (state.recordType === 'checkouts') {
      checkoutSubmitMode = 'draft';
      $('#record-form').requestSubmit();
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  const cancel = event.target.closest('#record-cancel');
  if (cancel) {
    if (state.recordType === 'checkouts') {
      const record = state.recordId ? state.checkouts.find((item) => item.id === state.recordId) : null;
      if (record?.status === 'draft' && record.id) {
        try { await api(`checkouts/${record.id}`, { method: 'DELETE' }); await load(); } catch (error) { alert(error.message); }
      }
    }
    checkoutSubmitMode = 'completed';
    state.recordId = '';
    $('#record-dialog').close();
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  const checkoutAction = event.target.closest('[data-action="add-checkout"]');
  if (checkoutAction) {
    const roomNo = checkoutAction.dataset.roomNo || '';
    const roomId = checkoutAction.dataset.roomId || '';
    const selectedRoom = state.rooms.find((item) => item.id === roomId) || state.rooms.find((item) => item.roomNo === roomNo);
    const draft = state.checkouts.find((item) => !item.archivedAt && item.status === 'draft' && ((selectedRoom?.id && item.roomId === selectedRoom.id) || (!selectedRoom?.id && item.roomNo === roomNo)));
    if (draft) {
      openDialog('checkouts', draft.id, roomNo, draft);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
}, true);
document.addEventListener('input', (event) => { if (!event.target.closest('#dialog-fields')) return; if (['durationPreset', 'durationValue', 'monthlyRent', 'monthlyPropertyFee'].includes(event.target.name)) updateRenewalAmount(); if (['waterEnd', 'electricityEnd'].includes(event.target.name)) updateCheckoutAmounts(); });
document.addEventListener('change', (event) => { if (event.target.closest('#dialog-fields') && event.target.name === 'maintenanceType') refreshMaintenanceItemField(); if (event.target.closest('#dialog-fields') && ['durationPreset', 'durationValue'].includes(event.target.name)) updateRenewalAmount(); if (event.target.closest('#dialog-fields') && ['waterEnd', 'electricityEnd'].includes(event.target.name)) updateCheckoutAmounts(); if (event.target.closest('#dialog-fields') && ['propertyFeeMode', 'roomNo'].includes(event.target.name)) updateLeasePropertyFee(); });
document.querySelectorAll('[data-template]').forEach((item) => item.addEventListener('click', () => { state.template = item.dataset.template; document.querySelectorAll('[data-template]').forEach((other) => other.classList.toggle('active', other === item)); renderTemplate(); }));
document.addEventListener('click', (event) => { const roomAdmin = event.target.closest('[data-open-room-admin]'); if (!roomAdmin) return; const roomTab = document.querySelector('[data-tab="rooms"]'); roomTab?.click(); document.querySelector('#rooms .panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
document.addEventListener('click', (event) => { const showItems = event.target.closest('[data-show-room-items]'); if (showItems) { openRoomItems(showItems.dataset.roomId || showItems.dataset.showRoomItems); } });
document.addEventListener('click', (event) => { const showMaintenance = event.target.closest('[data-show-room-maintenance]'); if (showMaintenance) { openRoomMaintenance(showMaintenance.dataset.showRoomMaintenance); } const showPhotos = event.target.closest('[data-show-room-photos]'); if (showPhotos) { openRoomPhotos(showPhotos.dataset.showRoomPhotos); } });
document.addEventListener('click', async (event) => { const complete = event.target.closest('[data-maint-complete]'); const reimburse = event.target.closest('[data-maint-reimburse]'); if (complete || reimburse) { try { await updateMaintenanceStatus((complete || reimburse).dataset[complete ? 'maintComplete' : 'maintReimburse'], complete ? 'done' : 'reimbursed'); } catch (error) { alert(error.message); } return; } const batch = event.target.closest('[data-batch-maintenance]'); if (batch) { const ids = selectedMaintenanceIds(); const available = state.maintenance.filter((item) => ids.includes(item.id)); if (batch.dataset.batchMaintenance === 'export') { exportMaintenanceRows(state.maintenance.filter((item) => !item.archivedAt && item.status === 'done')); return; } if (batch.dataset.batchMaintenance === 'public-link') { await openPublicReimbursementLink(); return; } if (!ids.length) { alert('请先选择维护记录'); return; } const status = batch.dataset.batchMaintenance === 'reimburse' ? 'reimbursed' : 'done'; try { await Promise.all(available.filter((item) => status === 'done' ? item.status === 'pending' : item.status === 'done').map((item) => api(`maintenance/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }))); await load(); } catch (error) { alert(error.message); } return; } const deletePhoto = event.target.closest('[data-delete-room-photo]'); if (deletePhoto) { const room = state.rooms.find((item) => item.id === state.photoRoomId); if (!room || !confirm('确定删除这张房间照片吗？')) return; const images = (room.images || []).filter((_, index) => index !== Number(deletePhoto.dataset.deleteRoomPhoto)); try { await api(`rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify({ ...room, images }) }); await load(); openRoomPhotos(room.roomNo); } catch (error) { alert(error.message); } } });
document.addEventListener('click', async (event) => { const toggle = event.target.closest('[data-toggle-user]'); if (!toggle) return; try { await api(`users/${encodeURIComponent(toggle.dataset.toggleUser)}`, { method: 'PATCH', body: JSON.stringify({ enabled: toggle.dataset.enabled === '1' }) }); await load(); } catch (error) { alert(error.message); } });
// Derived room status and maintenance totals are calculated from active records.
function renderStats() { const rooms = visible(state.rooms); $('#stat-rooms').textContent = rooms.length; $('#stat-occupied').textContent = state.leases.filter((lease) => lease.status === 'active' && !lease.archivedAt).length; $('#stat-vacant').textContent = rooms.filter((room) => room.status === 'vacant' && !leaseForRoom(room)).length; const month = today().slice(0, 7); $('#stat-maintenance').textContent = money(state.maintenance.filter((item) => !item.archivedAt && item.status !== 'pending' && item.maintenanceDate.startsWith(month)).reduce((sum, item) => sum + Number(item.amount || 0), 0)); $('#stat-costs').textContent = money(state.costs.filter((item) => !item.archivedAt && item.costDate.startsWith(month)).reduce((sum, item) => sum + Number(item.amount || 0), 0)); }
function itemOptions(roomNo = '') { const items = state.items.filter((item) => item.roomNo === roomNo && !item.archivedAt); return items.map((item) => `${item.name}:${item.name}`).join('|') || '__none__:该房间暂无物品'; }
['maintenance-month', 'maintenance-date', 'maintenance-room'].forEach((id) => $(`#${id}`).addEventListener('change', () => { state.maintenanceFilters = { month: $('#maintenance-month').value, date: $('#maintenance-date').value, room: $('#maintenance-room').value }; renderMaintenance(); }));
$('#clear-maintenance-filters').addEventListener('click', () => { ['maintenance-month', 'maintenance-date', 'maintenance-room'].forEach((id) => { $(`#${id}`).value = ''; }); state.maintenanceFilters = { month: '', date: '', room: '' }; renderMaintenance(); });
['ledger-start', 'ledger-end', 'ledger-room'].forEach((id) => $(`#${id}`).addEventListener('change', renderLedger));
$('#clear-ledger-filters').addEventListener('click', () => { ['ledger-start', 'ledger-end', 'ledger-room'].forEach((id) => { $(`#${id}`).value = ''; }); renderLedger(); });
$('#rental-login-form')?.addEventListener('submit', submitRentalLogin);
$('#rental-logout')?.addEventListener('click', () => { if (!confirm('确定退出当前账号吗？')) return; ['loanAdminPassword', 'loanAdminUser', 'loanAdminRemember'].forEach((key) => localStorage.removeItem(key)); ['loanAdminPassword', 'loanAdminUser'].forEach((key) => sessionStorage.removeItem(key)); window.location.reload(); });
$('#record-form').addEventListener('submit', saveDialog); $('#generate-dialog-text').addEventListener('click', generateDialogText); $('#rental-settings-form').addEventListener('submit', saveSettings); $('#rental-user-form').addEventListener('submit', createRentalUser); document.querySelectorAll('[data-close]').forEach((item) => item.addEventListener('click', () => item.closest('dialog').close())); $('#renewal-dialog-close').addEventListener('click', () => $('#renewal-dialog').close()); $('#image-preview-close').addEventListener('click', () => $('#image-preview-dialog').close()); $('#room-items-dialog-close').addEventListener('click', () => $('#room-items-dialog').close()); $('#room-items-add').addEventListener('click', () => { $('#room-items-dialog').close(); openDialog('items', '', state.itemRoomNo || '', { roomId: state.itemRoomId || '' }); }); $('#refresh')?.addEventListener('click', load); $('#copy-template').addEventListener('click', createTemplate); const initialRentalLoad = rentalPassword ? load() : requestRentalCredentials().then(persistRentalCredentials).then(load); initialRentalLoad.catch((error) => { setRentalLoginVisible(true, error.message); if (!rentalPasswordPrompt) requestRentalCredentials(error.message).then(persistRentalCredentials).then(load).catch((nextError) => setRentalLoginVisible(true, nextError.message)); });
$('#room-maintenance-dialog-close').addEventListener('click', () => $('#room-maintenance-dialog').close()); $('#room-maintenance-add').addEventListener('click', () => { $('#room-maintenance-dialog').close(); openDialog('maintenance', '', state.maintenanceRoomNo || ''); }); $('#room-photos-dialog-close').addEventListener('click', () => $('#room-photos-dialog').close()); $('#room-photos-add').addEventListener('click', () => $('#room-photos-upload').click()); $('#room-photos-upload').addEventListener('change', async (event) => { const room = state.rooms.find((item) => item.id === state.photoRoomId); const input = event.currentTarget; if (!room || !input.files?.length) return; const current = room.images || []; const allowed = Math.min(10, 20 - current.length); if (allowed <= 0) { $('#room-photos-status').textContent = '每个房间最多保存 20 张照片'; input.value = ''; return; } if (input.files.length > allowed) { $('#room-photos-status').textContent = `本次最多还能上传 ${allowed} 张照片`; input.value = ''; return; } const button = $('#room-photos-add'); button.disabled = true; button.textContent = '上传中...'; $('#room-photos-status').textContent = `正在上传 ${input.files.length} 张照片`; try { const uploads = await readFileInputs(input); await api(`rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify({ ...room, images: [...current, ...uploads] }) }); input.value = ''; await load(); openRoomPhotos(room.roomNo); } catch (error) { $('#room-photos-status').textContent = error.message; } finally { button.disabled = false; button.textContent = '+ 上传照片'; input.value = ''; } });
// Move-in workflow state is loaded alongside the existing rental collections.
/* Three-step move-in workflow: draft -> signed contract -> first payment. */
let moveInDraft = null;
let moveInStep = 1;
function fileToDataUrlRaw(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
function isValidIdCard(value) { return /^(?:\d{15}|\d{17}[\dXx])$/.test(String(value || '').trim()); }
function moveInRoomOptions(selected = '') { return visible(state.rooms).filter((room) => room.status !== 'inactive').map((room) => `<option value="${esc(room.id)}" ${room.id === selected ? 'selected' : ''}>${esc(roomCommunityName(room))} · ${esc(room.roomNo)}</option>`).join(''); }
function moveInInventory(roomId) {
  const room = state.rooms.find((item) => item.id === roomId);
  return state.items.filter((item) => !item.archivedAt && (!room?.workspaceId || item.workspaceId === room.workspaceId)
    && (item.roomId === roomId || (!item.roomId && room?.communityId && item.communityId === room.communityId && item.roomNo === room.roomNo)));
}
function usesLiveMoveInInventory(record) {
  return !['completed', 'cancelled'].includes(record.status) && record.contractStatus !== 'uploaded_signed';
}
function syncMoveInInventory() {
  if (!moveInDraft || !usesLiveMoveInInventory(moveInDraft)) return;
  moveInDraft.inventorySnapshot = moveInInventory(moveInDraft.roomId).map(({ name, quantity, note, image }) => ({ name, quantity, note, image }));
  const inventory = $('#move-in-content .move-in-inventory');
  if (inventory) inventory.outerHTML = moveInInventoryMarkup(moveInDraft, '该房间暂未登记物品');
}
let moveInInventoryRefreshing = false;
async function refreshMoveInInventory() {
  if (!$('#move-in-dialog')?.open || moveInStep !== 2 || !moveInDraft || !usesLiveMoveInInventory(moveInDraft) || moveInInventoryRefreshing) return;
  moveInInventoryRefreshing = true;
  const draft = moveInDraft;
  const workspaceId = state.workspaceId;
  try {
    const items = await api('items');
    if (workspaceId !== state.workspaceId || draft !== moveInDraft) return;
    state.items = normalizeRentalFileReferences(items);
    syncMoveInInventory();
  } catch (error) { $('#move-in-status').textContent = '物品刷新失败：' + error.message; }
  finally { moveInInventoryRefreshing = false; }
}
window.addEventListener('focus', refreshMoveInInventory);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMoveInInventory(); });
function moveInPreviewEnd(startDate, preset, dayCount = 1) {
  if (!startDate) return '';
  if (preset === 'days') return addDays(startDate, Math.max(1, Number(dayCount) || 1) - 1);
  const months = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 }[preset] || 1;
  const date = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function moveInInventoryMarkup(record = {}, emptyText = '暂无物品') {
  const items = usesLiveMoveInInventory(record) ? moveInInventory(record.roomId) : (record.inventorySnapshot || []);
  const inventoryText = (rows) => rows.map((item) => `${item.name} × ${Math.max(1, Math.trunc(Number(item.quantity || 1) || 1))}`).sort().join('、');
  const generatedInventory = record.contractSnapshot?.inventory;
  const changed = record.contractStatus === 'generated' && (!Array.isArray(generatedInventory) || inventoryText(items) !== inventoryText(generatedInventory));
  const notice = changed ? '<p class="meta">房间物品已更新，请重新生成合同后签署。</p>' : '';
  const content = items.length ? items.map((item) => `<span>${esc(item.name)} × ${esc(Math.max(1, Math.trunc(Number(item.quantity || 1) || 1)))}</span>`).join('') : `<span class="meta">${emptyText}</span>`;
  return `<div class="move-in-inventory"><div class="section-title"><strong>房间物品明细</strong><button type="button" class="link-button" data-show-room-items="${esc(record.roomNo || '')}" data-room-id="${esc(record.roomId || '')}">管理物品</button></div><div class="inventory-inline">${content}</div>${notice}</div>`;
}
function moveInStepMarkup() {
  const d = moveInDraft || {};
  if (moveInStep === 1) return `<section class="move-in-section move-in-step-one"><h3>01 资料填写</h3><p class="meta">先保存租户资料，未完成缴费前不会进入正式租户和收入统计。</p><div class="move-in-two-column-layout"><div class="move-in-main-column"><section class="move-in-form-block move-in-property-block"><div class="move-in-form-block-head"><strong>房源信息</strong><span>确认入住的房间与住房用途</span></div><div class="move-in-grid move-in-grid-property"><label class="full">小区 / 房间<select name="roomId">${moveInRoomOptions(d.roomId)}</select></label><label>住房目的<select name="purpose"><option value="self" ${d.purpose === 'self' ? 'selected' : ''}>自住</option><option value="studio" ${d.purpose === 'studio' ? 'selected' : ''}>工作室</option><option value="homestay" ${d.purpose === 'homestay' ? 'selected' : ''}>民宿</option><option value="other" ${d.purpose === 'other' ? 'selected' : ''}>其他</option></select></label></div></section><section class="move-in-form-block move-in-tenant-block"><div class="move-in-form-block-head"><strong>租户信息</strong><span>填写合同签署与日常管理所需信息</span></div><div class="move-in-grid move-in-grid-two"><label>租户姓名<input name="tenantName" value="${esc(d.tenantName)}" /></label><label>租户电话<input name="tenantPhone" value="${esc(d.tenantPhone)}" /></label></div></section><section class="move-in-form-block move-in-term-block"><div class="move-in-form-block-head"><strong>租期信息</strong><span>入住日期和合同结束日期</span></div><div class="move-in-grid move-in-grid-two"><label>入住时间<input name="startDate" type="date" value="${esc(d.startDate || today())}" /></label><label>合同结束时间<input name="endDate" type="date" value="${esc(d.endDate)}" /></label></div></section><section class="move-in-form-block move-in-meter-block"><div class="move-in-form-block-head"><strong>入住读数</strong><span>交接时记录水电表读数</span></div><div class="move-in-grid move-in-grid-two"><label>入住电表读数<input name="moveInElectricity" inputmode="decimal" value="${esc(d.moveInElectricity)}" /></label><label>入住水表读数<input name="moveInWater" inputmode="decimal" value="${esc(d.moveInWater)}" /></label></div></section></div><aside class="move-in-finance-column"><section class="move-in-form-block move-in-finance-block"><div class="move-in-form-block-head"><strong>租期与费用</strong><span>设置租金、物业费与押金</span></div><div class="move-in-finance-stack"><div class="move-in-finance-group move-in-rent-group"><span class="move-in-group-title">租金设置</span><label>租金支付方式<select name="paymentMethod"><option value="monthly" ${d.paymentMethod === 'monthly' ? 'selected' : ''}>月付</option><option value="quarterly" ${d.paymentMethod === 'quarterly' ? 'selected' : ''}>季付</option><option value="yearly" ${d.paymentMethod === 'yearly' ? 'selected' : ''}>年付</option></select></label><label>月租金<input name="monthlyRent" inputmode="decimal" value="${esc(d.monthlyRent)}" /></label></div><div class="move-in-finance-group move-in-fee-group"><span class="move-in-group-title">物业费设置</span><label>物业费收取方式<select name="propertyFeeMode"><option value="included" ${d.propertyFeeMode !== 'tenant_self' ? 'selected' : ''}>与房租一起交</option><option value="tenant_self" ${d.propertyFeeMode === 'tenant_self' ? 'selected' : ''}>租户自理</option></select></label><label>每月物业费<input name="monthlyPropertyFee" inputmode="decimal" value="${esc(d.monthlyPropertyFee)}" /></label></div><label class="move-in-deposit-field">押金<input name="deposit" inputmode="decimal" value="${esc(d.deposit)}" /></label></div></section></aside><section class="move-in-form-block move-in-identity-block"><div class="move-in-form-block-head"><strong>身份信息与备注</strong><span>证件资料用于租赁档案，备注可补充交接说明</span></div><div class="move-in-grid move-in-grid-identity"><label>身份证正面<input id="move-in-id-front" type="file" accept="image/jpeg,image/png,image/webp" /></label><label>身份证反面<input id="move-in-id-back" type="file" accept="image/jpeg,image/png,image/webp" /></label><label>租户身份证号<input name="tenantIdCard" value="${esc(d.tenantIdCard)}" maxlength="18" inputmode="text" autocomplete="off" placeholder="15位或18位，末位可为X" pattern="^(?:\\d{15}|\\d{17}[\\dXx])$" title="请输入15位或18位身份证号，18位末位可为X" /></label><label class="full">备注<textarea name="note">${esc(d.note)}</textarea></label></div></section></div></section>`;
  if (moveInStep === 2) return `<section class="move-in-section"><h3>02 合同签署</h3><p class="meta">合同模板从“租房设置”读取。下载生成的Word合同，完成三方签署后再上传已签署文件；如果暂时不想等待，可先完成首次缴费，之后再补齐合同。</p>${moveInInventoryMarkup(d, '该房间暂未登记物品')}<div class="contract-status-card"><span>当前状态</span><strong>${d.contractStatus === 'uploaded_signed' ? '已上传签署合同' : d.contractStatus === 'generated' ? '合同已生成，等待签署' : d.status === 'completed' ? '已入住，待补齐合同' : '尚未生成合同'}</strong>${d.generatedContractFile ? `<a class="button button-outline" href="${esc(d.generatedContractFile)}" download="${esc(d.generatedContractName || '租赁合同.docx')}" rel="noopener">下载生成合同</a>` : ''}${d.signedContractFile ? `<a class="button button-outline" href="${esc(d.signedContractFile)}" target="_blank" rel="noopener">查看已签署合同</a>` : ''}</div><div class="move-in-contract-actions"><button type="button" class="button button-dark" id="move-in-generate">生成合同</button><label class="button button-outline upload-button">上传已签署合同<input id="move-in-signed" type="file" accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden /></label><a class="button button-outline button-sign-external" href="https://sign.58.com/?view=workbench#/contractManage?tabName=second" target="_blank" rel="noopener noreferrer">打开电子签约</a>${d.status !== 'completed' && d.contractStatus !== 'uploaded_signed' ? '<button type="button" class="button button-warning-outline" id="move-in-skip-contract">暂不签合同，先办理入住</button>' : ''}</div></section>`;
  const presetMonths = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 };
  const preset = d.durationPreset || '1month';
  const previewDays = Math.max(1, Number(d.durationValue) || 1);
  const previewMonths = presetMonths[preset] || 0;
  const unitCount = preset === 'days' ? previewDays : previewMonths || 1;
  const previewFee = d.propertyFeeMode === 'tenant_self' ? 0 : (Number(d.monthlyPropertyFee) || 0);
  const previewAmount = ((Number(d.monthlyRent) || 0) + previewFee) * (preset === 'days' ? previewDays / 30 : unitCount) + (Number(d.deposit) || 0);
  const previewPaidThrough = moveInPreviewEnd(d.startDate, preset, previewDays);
  return `<section class="move-in-section move-in-step-three"><h3>03 首次缴费</h3><p class="meta">只有首次缴费完成后，才会创建正式租户、更新房间状态并写入收入账单。</p><div class="move-in-grid"><label class="move-in-payment-date">缴费日期<input name="paymentDate" type="date" value="${esc(d.paymentDate || today())}" /></label><label class="move-in-duration-preset">首次缴费周期<select name="durationPreset"><option value="1month" ${preset === '1month' ? 'selected' : ''}>+1个月</option><option value="3months" ${preset === '3months' ? 'selected' : ''}>+3个月</option><option value="6months" ${preset === '6months' ? 'selected' : ''}>+6个月</option><option value="1year" ${preset === '1year' ? 'selected' : ''}>+1年</option><option value="days" ${preset === 'days' ? 'selected' : ''}>按天</option></select></label><label class="move-in-start-date">入住时间<input readonly value="${esc(d.startDate || '')}" /></label><label class="move-in-paid-through">本次缴费后到期<input name="paidThrough" readonly value="${esc(previewPaidThrough || d.paidThrough || '选择周期后计算')}" /></label><label class="move-in-day-count" ${preset === 'days' ? '' : 'hidden'}>缴费天数<input name="durationValue" type="number" min="1" value="${esc(previewDays)}" /></label><label class="move-in-monthly-rent">月租金<input name="monthlyRent" inputmode="decimal" value="${esc(d.monthlyRent)}" /></label><label class="move-in-monthly-property-fee">物业费<input name="monthlyPropertyFee" inputmode="decimal" value="${esc(d.monthlyPropertyFee)}" /></label><div class="move-in-amount full"><span>应收费用</span><strong>${money(Number(d.monthlyRent || 0) + previewFee)} × ${preset === 'days' ? `${previewDays}天 ÷ 30` : `${unitCount}个月`} + 押金 ${money(d.deposit || 0)}</strong><b>${money(previewAmount)}</b></div></div></section>`;
}
function renderMoveInDialog() {
  const dialog = $('#move-in-dialog'); if (!dialog) return;
  const labels = ['资料填写', '合同签署', '首次缴费'];
  $('#move-in-steps').innerHTML = labels.map((label, index) => `<span class="${index + 1 === moveInStep ? 'active' : index + 1 < moveInStep ? 'complete' : ''}"><b>0${index + 1}</b>${label}</span>`).join('');
  $('#move-in-content').innerHTML = moveInStepMarkup();
  if (moveInStep === 2) refreshMoveInInventory();
  $('#move-in-back').hidden = moveInStep === 1; $('#move-in-save').hidden = true; $('#move-in-generate-text').hidden = moveInStep !== 3; $('#move-in-next').textContent = moveInStep === 1 ? '签署合同' : moveInStep === 2 ? '进入首次缴费' : '完成首次缴费';
  $('#move-in-status').textContent = moveInDraft?.status === 'contract_pending' ? '合同签署中' : moveInDraft?.status === 'payment_pending' ? '等待首次缴费' : '';
  if (moveInStep === 1) {
  const roomInput = $('#move-in-content [name="roomId"]'); roomInput?.addEventListener('change', () => { const room = state.rooms.find((item) => item.id === roomInput.value); if (room) { moveInDraft.roomId = room.id; moveInDraft.roomNo = room.roomNo; moveInDraft.propertyName = roomCommunityName(room); moveInDraft.monthlyPropertyFee = moveInDraft.propertyFeeMode === 'tenant_self' ? 0 : room.monthlyPropertyFee || 0; moveInDraft.inventorySnapshot = moveInInventory(room.id).map((item) => ({ name: item.name, quantity: item.quantity, note: item.note, image: item.image })); renderMoveInDialog(); } });
  }
  if (moveInStep === 3) updateMoveInPaymentPreview();
}
function collectMoveInStep() {
  const content = $('#move-in-content'); if (!content) return;
  content.querySelectorAll('[name]').forEach((input) => {
    if (input.type !== 'file') moveInDraft[input.name] = input.name === 'tenantIdCard' ? input.value.trim().replace(/\s+/g, '').toUpperCase() : input.value.trim();
  });
  const room = state.rooms.find((item) => item.id === moveInDraft.roomId); if (room) { moveInDraft.roomNo = room.roomNo; moveInDraft.propertyName = roomCommunityName(room); if (moveInDraft.propertyFeeMode === 'tenant_self') moveInDraft.monthlyPropertyFee = 0; }
}
async function saveMoveInDraft(nextStatus = '') { collectMoveInStep(); const data = { ...moveInDraft }; data.tenantIdCard = String(data.tenantIdCard || '').trim().replace(/\s+/g, '').toUpperCase(); if (data.tenantIdCard && !isValidIdCard(data.tenantIdCard)) throw new Error('身份证号格式不正确，请输入15位或18位，18位末位可为X'); if (nextStatus) data.status = nextStatus; const front = $('#move-in-id-front')?.files?.[0]; const back = $('#move-in-id-back')?.files?.[0]; if (front) data.idCardFront = await compressRentalImage(front); if (back) data.idCardBack = await compressRentalImage(back); const result = await api(moveInDraft.id ? `move-ins/${moveInDraft.id}` : 'move-ins', { method: moveInDraft.id ? 'PATCH' : 'POST', body: JSON.stringify(data) }); moveInDraft = result; await load(); return result; }
function openMoveInDialog(roomId = '', roomNo = '') { const room = state.rooms.find((item) => item.id === roomId || item.roomNo === roomNo); const existing = (state.moveIns || []).find((item) => !item.archivedAt && !['cancelled', 'completed'].includes(item.status) && ((room?.id && item.roomId === room.id) || (!room?.id && item.roomNo === roomNo))); if (existing) { moveInDraft = { ...existing }; moveInStep = existing.status === 'payment_pending' ? 3 : existing.status === 'contract_pending' || existing.contractStatus === 'generated' || existing.contractStatus === 'uploaded_signed' ? 2 : 1; } else { moveInDraft = { roomId: room?.id || '', roomNo: room?.roomNo || '', propertyName: room?.propertyName || '', startDate: today(), paymentMethod: 'monthly', propertyFeeMode: room?.propertyFeeMode || 'included', monthlyPropertyFee: room?.monthlyPropertyFee || 0, inventorySnapshot: room ? moveInInventory(room.id).map((item) => ({ name: item.name, quantity: item.quantity, note: item.note, image: item.image })) : [] }; moveInStep = 1; } renderMoveInDialog(); $('#move-in-dialog')?.showModal(); refreshMoveInInventory(); }
async function moveInNext() { try { collectMoveInStep(); if (moveInStep === 1) { moveInDraft = await saveMoveInDraft('contract_pending'); moveInStep = 2; } else if (moveInStep === 2) { if (moveInDraft.contractStatus !== 'uploaded_signed') { $('#move-in-status').textContent = '请先上传已签署合同'; return; } moveInStep = 3; } else { const preset = $('#move-in-content [name="durationPreset"]')?.value || '1month'; const map = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 }; const start = moveInDraft.startDate || today(); const days = Math.max(1, Number($('#move-in-content [name="durationValue"]')?.value || moveInDraft.durationValue) || 1); const durationValue = preset === 'days' ? days : (map[preset] || 1); moveInDraft.durationPreset = preset; moveInDraft.durationUnit = preset === 'days' ? 'days' : 'months'; moveInDraft.durationValue = durationValue; moveInDraft.paidThrough = moveInPreviewEnd(start, preset, durationValue); moveInDraft.paymentDate = $('#move-in-content [name="paymentDate"]')?.value || today(); moveInDraft.monthlyRent = Number($('#move-in-content [name="monthlyRent"]')?.value || moveInDraft.monthlyRent || 0); moveInDraft.monthlyPropertyFee = Number($('#move-in-content [name="monthlyPropertyFee"]')?.value || moveInDraft.monthlyPropertyFee || 0); await api(`move-ins/${moveInDraft.id}/complete-payment`, { method: 'POST', body: JSON.stringify(moveInDraft) }); await load(); $('#move-in-dialog').close(); moveInDraft = null; return; } renderMoveInDialog(); } catch (error) { $('#move-in-status').textContent = error.message; } }
document.addEventListener('click', (event) => { const action = event.target.closest('[data-action="start-move-in"], [data-action="add-lease"]'); if (!action) return; const roomId = action.dataset.roomId || ''; const roomNo = action.dataset.roomNo || ''; const lease = roomId || roomNo ? leaseForRoom(roomId || roomNo) : null; if (!lease) { event.preventDefault(); event.stopImmediatePropagation(); openMoveInDialog(roomId, roomNo); } }, true);
document.addEventListener('click', async (event) => { const button = event.target.closest('[data-complete-contract]'); if (!button) return; event.preventDefault(); event.stopImmediatePropagation(); try { const lease = state.leases.find((item) => item.id === button.dataset.completeContract); if (!lease) throw new Error('租户记录不存在，请刷新后重试'); let record = (state.moveIns || []).find((item) => item.completedLeaseId === lease.id); if (!record) { const room = state.rooms.find((item) => item.id === lease.roomId) || state.rooms.find((item) => item.roomNo === lease.roomNo); if (!room) throw new Error('关联房间不存在，无法补齐合同'); record = await api('move-ins', { method: 'POST', body: JSON.stringify({ ...lease, roomId: room.id, roomNo: room.roomNo, propertyName: roomCommunityName(room), status: 'completed', contractStatus: 'not_generated', completedLeaseId: lease.id, contractOnly: true }) }); await load(); record = state.moveIns.find((item) => item.completedLeaseId === lease.id) || record; } moveInDraft = { ...record }; moveInStep = 2; renderMoveInDialog(); $('#move-in-dialog')?.showModal(); refreshMoveInInventory(); } catch (error) { alert(error.message); } });
document.addEventListener('click', async (event) => { if (event.target.closest('#move-in-close')) $('#move-in-dialog')?.close(); if (event.target.closest('#move-in-cancel')) { if (moveInDraft?.id) await api(`move-ins/${moveInDraft.id}`, { method: 'DELETE' }); $('#move-in-dialog')?.close(); moveInDraft = null; await load(); } if (event.target.closest('#move-in-back')) { collectMoveInStep(); moveInStep = Math.max(1, moveInStep - 1); renderMoveInDialog(); } if (event.target.closest('#move-in-save')) { try { await saveMoveInDraft(); $('#move-in-status').textContent = '草稿已保存'; } catch (error) { $('#move-in-status').textContent = error.message; } } if (event.target.closest('#move-in-skip-contract')) { try { moveInDraft = await saveMoveInDraft('payment_pending'); moveInStep = 3; renderMoveInDialog(); } catch (error) { $('#move-in-status').textContent = error.message; } } if (event.target.closest('#move-in-next')) moveInNext(); if (event.target.closest('#move-in-generate')) { try { collectMoveInStep(); moveInDraft = await saveMoveInDraft(); moveInDraft = await api(`move-ins/${moveInDraft.id}/generate-contract`, { method: 'POST' }); renderMoveInDialog(); } catch (error) { $('#move-in-status').textContent = error.message; } } }, false);
document.addEventListener('click', async (event) => { if (!event.target.closest('#move-in-generate-text')) return; try { collectMoveInStep(); const result = await api('summary', { method: 'POST', body: JSON.stringify({ type: 'move-in', ...moveInDraft, durationPreset: $('#move-in-content [name="durationPreset"]')?.value || '1month' }) }); await navigator.clipboard.writeText(result.summary); $('#move-in-status').textContent = '首次缴费文字已复制'; } catch (error) { $('#move-in-status').textContent = error.message; } });
document.addEventListener('change', async (event) => { if (event.target.id === 'move-in-signed') { try { if (!moveInDraft?.id) moveInDraft = await saveMoveInDraft(); const data = await fileToDataUrlRaw(event.target.files[0]); moveInDraft = await api(`move-ins/${moveInDraft.id}/upload-signed`, { method: 'POST', body: JSON.stringify({ signedContractData: data }) }); if (moveInDraft.status === 'completed') { $('#move-in-dialog')?.close(); await load(); moveInDraft = null; } else renderMoveInDialog(); } catch (error) { $('#move-in-status').textContent = error.message; } } });
function updateMoveInPaymentPreview() { if (!moveInDraft || moveInStep !== 3) return; const rent = Number($('#move-in-content [name="monthlyRent"]')?.value || 0); const fee = moveInDraft.propertyFeeMode === 'tenant_self' ? 0 : Number($('#move-in-content [name="monthlyPropertyFee"]')?.value || 0); const deposit = Number(moveInDraft.deposit || 0); const preset = $('#move-in-content [name="durationPreset"]')?.value || '1month'; const months = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 }; const days = Math.max(1, Number($('#move-in-content [name="durationValue"]')?.value || moveInDraft.durationValue) || 1); const monthCount = months[preset] || 0; const unitCount = preset === 'days' ? days : (monthCount || 1); const periodAmount = (rent + fee) * (preset === 'days' ? days / 30 : unitCount); const amount = periodAmount + deposit; const paidThrough = moveInPreviewEnd(moveInDraft.startDate || today(), preset, unitCount); moveInDraft.durationPreset = preset; moveInDraft.durationUnit = preset === 'days' ? 'days' : 'months'; moveInDraft.durationValue = unitCount; moveInDraft.paidThrough = paidThrough; const dayLabel = $('#move-in-content .move-in-day-count'); if (dayLabel) { const showDays = preset === 'days'; dayLabel.hidden = !showDays; dayLabel.style.display = showDays ? '' : 'none'; } const dueField = $('#move-in-content [name="paidThrough"]'); if (dueField) dueField.value = paidThrough || '选择周期后计算'; const detail = $('#move-in-content .move-in-amount strong'); if (detail) detail.textContent = `${money(rent + fee)} × ${preset === 'days' ? `${days}天 ÷ 30` : `${unitCount}个月`} + 押金 ${money(deposit)}`; const node = $('#move-in-content .move-in-amount b'); if (node) node.textContent = money(amount); }
document.addEventListener('input', updateMoveInPaymentPreview);
document.addEventListener('change', (event) => { if (event.target.closest('#move-in-content [name="durationPreset"]')) { updateMoveInPaymentPreview(); } });
function renderCommunities() {
  const list = $('#community-list');
  if (!list) return;
  list.innerHTML = state.communities.length ? state.communities.map((item) => `<article class="community-card"><div><strong>${esc(item.name || '未命名小区')}</strong><small>${esc(item.address || '未填写房屋地址')}</small><small>签约地址：${esc(item.signingAddress || '未填写')}</small></div><div class="community-rates"><span>物业 ${esc(item.propertyUnitPrice ?? 0)} 元/㎡·月</span><span>水费 ${esc(item.waterUnitPrice ?? 0)} 元/方</span><span>电费 ${esc(item.electricityUnitPrice ?? 0)} 元/度</span><span>燃气 ${esc(item.gasUnitPrice ?? 0)} 元/方</span></div><div class="row-actions"><button class="small" type="button" data-edit-community="${esc(item.id)}">编辑</button><button class="small danger" type="button" data-delete-community="${esc(item.id)}">归档</button></div></article>`).join('') : '<p class="meta">暂无小区，创建房间时也会自动创建小区档案。</p>';
}
function renderCommunities() {
  const list = $('#community-list');
  if (!list) return;
  const rows = visible(state.communities);
  const communityRooms = (community) => visible(state.rooms).filter((room) => room.communityId ? room.communityId === community.id : room.propertyName === community.name);
  const rate = (value, unit) => `<span><b>${esc(value ?? 0)}</b><small>${unit}</small></span>`;
  list.innerHTML = rows.length ? `<div class="community-list-header"><span>小区名称 / 签约地址</span><span>房间概览</span><span>费用单价</span><span>操作</span></div>${rows.map((item) => { const rooms = communityRooms(item); const occupied = rooms.filter((room) => leaseForRoom(room)).length; return `<article class="community-card"><div class="community-identity"><strong>${esc(item.name || '未命名小区')}</strong><small>签约地址：${esc(item.signingAddress || '未填写')}</small></div><div class="community-stats"><span><b>${rooms.length}</b> 间房</span><span><b>${occupied}</b> 间在租</span></div><div class="community-rates">${rate(item.propertyUnitPrice, '物业/㎡·月')} ${rate(item.waterUnitPrice, '水/方')} ${rate(item.electricityUnitPrice, '电/度')} ${rate(item.gasUnitPrice, '燃气/方')}</div><div class="row-actions"><button class="small" type="button" data-edit-community="${esc(item.id)}">编辑</button><button class="small danger" type="button" data-delete-community="${esc(item.id)}">归档</button></div></article>`; }).join('')}` : '<p class="meta">暂无小区，点击右上角“新增小区”创建档案。</p>';
}
const contractFieldReference = [
  ['propertyName', '小区名称', '小区档案'],
  ['communityName', '小区名称（兼容字段）', '小区档案'],
  ['propertyAddress', '小区地址', '小区档案'],
  ['communityAddress', '小区地址（兼容字段）', '小区档案'],
  ['signingAddress', '合同签约地址', '小区档案'],
  ['roomNo', '房间号', '房间档案'],
  ['roomLabel', '小区 · 房间号', '系统组合'],
  ['contractNo', '合同编号', '入住办理'],
  ['landlordName', '甲方姓名', '合同甲方资料'],
  ['landlordPhone', '甲方电话', '合同甲方资料'],
  ['landlordIdCard', '甲方身份证号', '合同甲方资料'],
  ['landlordAddress', '甲方地址', '合同甲方资料'],
  ['signerName', '签署人姓名（兼容字段）', '合同甲方资料'],
  ['signerPhone', '签署人电话（兼容字段）', '合同甲方资料'],
  ['signerIdCard', '签署人身份证号（兼容字段）', '合同甲方资料'],
  ['signerAddress', '签署人地址（兼容字段）', '合同甲方资料'],
  ['tenantName', '租户姓名', '租户租约'],
  ['tenantPhone', '租户电话', '租户租约'],
  ['tenantIdCard', '租户身份证号', '租户租约'],
  ['purpose', '居住用途', '租户租约'],
  ['startDate', '入住日期', '租户租约'],
  ['endDate', '合同结束日期', '租户租约'],
  ['area', '房间面积', '房间档案'],
  ['paymentMethod', '支付方式', '租户租约'],
  ['monthlyRent', '月租金', '租户租约'],
  ['monthlyPropertyFee', '月物业费', '租户租约'],
  ['monthlyTotal', '每月合计', '系统计算'],
  ['deposit', '押金', '租户租约'],
  ['moveInWater', '入住水表', '入住办理'],
  ['moveInElectricity', '入住电表', '入住办理'],
  ['waterUnitPrice', '水费单价', '小区档案'],
  ['electricityUnitPrice', '电费单价', '小区档案'],
  ['inventory', '房间物品清单', '房间物品']
];

function contractPreviewRoom(roomId = '') {
  const rooms = typeof visible === 'function' ? visible(state.rooms || []) : (state.rooms || []);
  return rooms.find((room) => String(room.id) === String(roomId)) || rooms.find((room) => typeof leaseForRoom === 'function' && leaseForRoom(room)) || rooms[0] || null;
}
function contractPreviewLease(room) {
  if (!room) return null;
  return (state.leases || []).find((lease) => !lease.archivedAt && lease.status === 'active' && ((room.id && lease.roomId === room.id) || (!lease.roomId && lease.roomNo === room.roomNo))) || null;
}
function contractPreviewRows(roomId = '') {
  const room = contractPreviewRoom(roomId);
  const lease = contractPreviewLease(room);
  const community = (state.communities || []).find((item) => (room?.communityId && item.id === room.communityId) || item.name === room?.propertyName) || null;
  const party = state.settings?.contractParty || {};
  const purposeLabels = { self: '自住', studio: '工作室', homestay: '民宿', other: '其他' };
  const paymentLabels = { monthly: '月付', quarterly: '季付', yearly: '年付' };
  const propertyName = community?.name || room?.propertyName || '未选择房间';
  const signingAddress = community?.signingAddress || community?.address || room?.propertyAddress || '未设置';
  const monthlyRent = lease?.monthlyRent ?? '';
  const monthlyPropertyFee = lease?.monthlyPropertyFee ?? room?.monthlyPropertyFee ?? '';
  const items = room ? (state.items || []).filter((item) => !item.archivedAt && ((item.roomId && item.roomId === room.id) || (!item.roomId && item.roomNo === room.roomNo))) : [];
  const values = {
    propertyName, communityName: propertyName, propertyAddress: signingAddress, communityAddress: signingAddress, signingAddress,
    roomNo: room?.roomNo || '未设置', roomLabel: room ? `${propertyName} · ${room.roomNo || '未设置'}` : '未选择房间', contractNo: lease?.contractNo || '待生成',
    landlordName: party.name || '未设置', landlordPhone: party.phone || '未设置', landlordIdCard: party.idCard || '未设置', landlordAddress: party.address || '未设置',
    signerName: party.name || '未设置', signerPhone: party.phone || '未设置', signerIdCard: party.idCard || '未设置', signerAddress: party.address || '未设置',
    tenantName: lease?.tenantName || '暂无在租租户', tenantPhone: lease?.tenantPhone || '未设置', tenantIdCard: lease?.tenantIdCard || '未设置', purpose: purposeLabels[lease?.purpose] || lease?.purpose || '未设置',
    startDate: lease?.startDate || '未设置', endDate: lease?.endDate || '未设置', area: room?.area ? `${room.area}㎡` : '未设置', paymentMethod: paymentLabels[lease?.paymentMethod || lease?.billingCycle] || '未设置',
    monthlyRent: monthlyRent === '' ? '未设置' : `${monthlyRent}元`, monthlyPropertyFee: monthlyPropertyFee === '' ? '未设置' : `${monthlyPropertyFee}元`, monthlyTotal: lease ? `${Number(monthlyRent || 0) + Number(monthlyPropertyFee || 0)}元` : '未设置',
    deposit: lease?.deposit === undefined || lease?.deposit === '' ? '未设置' : `${lease.deposit}元`, moveInWater: lease?.moveInWater ?? '未设置', moveInElectricity: lease?.moveInElectricity ?? '未设置',
    waterUnitPrice: community?.waterUnitPrice ?? state.settings?.waterUnitPrice ?? '未设置', electricityUnitPrice: community?.electricityUnitPrice ?? state.settings?.electricityUnitPrice ?? '未设置',
    inventory: items.length ? items.map((item) => `${item.name} × ${Math.max(1, Math.trunc(Number(item.quantity || 1) || 1))}`).join('、') : '暂无物品'
  };
  return contractFieldReference.map(([key, label, source]) => ({ key, label, source, value: values[key] ?? '未设置' }));
}
function contractPreviewMarkup() {
  const rooms = typeof visible === 'function' ? visible(state.rooms || []) : (state.rooms || []);
  const selected = contractPreviewRoom()?.id || '';
  const options = rooms.length ? rooms.map((room) => `<option value="${esc(room.id)}" ${String(room.id) === String(selected) ? 'selected' : ''}>${esc(`${roomCommunityName(room)} · ${room.roomNo || '未设置房号'}`)}</option>`).join('') : '<option value="">暂无房间</option>';
  const rows = contractPreviewRows(selected);
  return `<div class="contract-preview-toolbar"><div><strong>当前字段示例值</strong><p>选择房间后，下面会显示该房间和租约当前会填入合同的实际内容。</p></div><label>预览房间<select id="contract-preview-room">${options}</select></label></div><div class="contract-field-table-wrap contract-preview-table-wrap"><table class="contract-field-table contract-field-preview-table"><thead><tr><th>Word 填充字段</th><th>中文含义</th><th>当前示例值</th><th>数据来源</th></tr></thead><tbody>${rows.map(({ key, label, source, value }) => `<tr><td><code>{{${key}}}</code></td><td>${label}</td><td class="contract-preview-value" data-contract-preview-key="${esc(key)}">${esc(value)}</td><td>${source}</td></tr>`).join('')}</tbody></table></div>`;
}
function refreshContractPreview(roomId = '') {
  const target = $('#contract-management-panel') || $('#rental-settings-form');
  if (!target) return;
  const rows = contractPreviewRows(roomId);
  rows.forEach(({ key, value }) => { const cell = target.querySelector(`[data-contract-preview-key="${key}"]`); if (cell) cell.textContent = value; });
}

function renderSettingsWithContractTemplate() {
  const form = $('#rental-settings-form');
  if (!form) return;
  const isPlatform = Boolean(state.session?.actor?.platformAdmin);
  const party = state.settings.contractParty || {};
  const target = $('#contract-management-panel');
  const current = state.settings.contractTemplateFile ? `<a href="${esc(state.settings.contractTemplateFile)}" download="${esc(state.settings.contractTemplateName || '入住合同模板.docx')}" rel="noopener">查看当前模板</a>` : '';
  const partyFields = [
    ['contractPartyName', '甲方姓名', party.name || ''],
    ['contractPartyPhone', '甲方电话', party.phone || ''],
    ['contractPartyIdCard', '甲方身份证号', party.idCard || ''],
    ['contractPartyAddress', '甲方合同地址', party.address || '']
  ];
  const partyMarkup = partyFields.map(([key, label, value]) => `<label class="contract-party-field">${label}<input form="rental-settings-form" name="${key}" value="${esc(value)}" /></label>`).join('');
  const templateMarkup = isPlatform
    ? `<label class="contract-template-upload">入住合同模板（Word .docx）<input id="contract-template-upload" form="rental-settings-form" type="file" accept="application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" /><small>${state.settings.contractTemplateName ? `当前：${esc(state.settings.contractTemplateName)} ${current}` : '尚未上传；模板中请使用下方字段对应的 {{字段名}} 占位符'}</small></label>`
    : `<div class="settings-template-note"><p class="meta">合同模板由平台超级管理员统一维护，当前账号仅可使用和下载。</p>${state.settings.contractTemplateName ? `<p class="meta">当前模板：${esc(state.settings.contractTemplateName)} ${current}</p>` : '<p class="meta">当前尚未配置合同模板</p>'}</div>`;
  const mappingMarkup = isPlatform ? contractPreviewMarkup() : '';

  form.className = 'settings-form';
  form.innerHTML = `<section class="settings-basic-section"><div class="settings-section-head"><div><h2>基础设置</h2><p>只保留当前工作空间的通用提醒配置。</p></div></div><label>默认到期强提醒时长（天）<input name="reminderDays" value="${esc(state.settings.reminderDays ?? 10)}" inputmode="numeric" /></label></section>`;
  if (target) {
    target.innerHTML = isPlatform
      ? `<div class="section-head"><div><h2>合同管理</h2><p>集中维护甲方资料、统一合同模板，并查看可用于 Word 的填充字段。</p></div><span class="settings-badge">平台统一模板</span></div><section class="contract-management-section"><div class="settings-section-head"><div><h3>合同甲方资料</h3><p>生成合同的甲方信息来自当前工作空间。</p></div></div><div class="contract-party-fields">${partyMarkup}</div></section><section class="contract-management-section"><div class="settings-section-head"><div><h3>合同模板</h3><p>模板由平台超级管理员维护，所有工作空间使用同一套字段规则。</p></div></div>${templateMarkup}</section><section class="contract-management-section"><div class="settings-section-head"><div><h3>填充字段对照</h3><p>在 Word 模板中输入对应的双大括号字段，生成合同时会自动替换。</p></div></div>${mappingMarkup}</section>`
      : `<div class="section-head"><div><h2>合同使用</h2><p>填写当前工作空间的甲方资料，使用平台统一模板生成并下载合同。</p></div><span class="settings-badge">仅使用与下载</span></div><section class="contract-management-section"><div class="settings-section-head"><div><h3>合同甲方资料</h3><p>这些资料会用于生成合同，合同模板和填充字段由平台超级管理员统一维护。</p></div></div><div class="contract-party-fields">${partyMarkup}</div></section><section class="contract-management-section"><div class="settings-section-head"><div><h3>合同模板</h3><p>当前账号不可修改模板，仅可查看和下载平台统一模板。</p></div></div>${templateMarkup}</section>`;
  } else {
    form.insertAdjacentHTML('beforeend', `<section class="contract-management-section"><div class="settings-section-head"><div><h2>${isPlatform ? '合同管理' : '合同使用'}</h2><p>${isPlatform ? '集中维护甲方资料、统一合同模板，并查看可用于 Word 的填充字段。' : '填写甲方资料，使用平台统一模板生成并下载合同。'}</p></div></div><div class="contract-party-fields">${partyMarkup}</div><div class="settings-section-head"><div><h3>合同模板</h3></div></div>${templateMarkup}${isPlatform ? `<div class="settings-section-head"><div><h3>填充字段对照</h3></div></div>${mappingMarkup}` : ''}</section>`);
  }
  const previewRoot = target || form;
  previewRoot.querySelector('#contract-preview-room')?.addEventListener('change', (event) => refreshContractPreview(event.target.value));
}
window.renderSettings = renderSettingsWithContractTemplate;
document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action="add-community"]');
  const roomAction = event.target.closest('[data-action="add-room"]');
  if (roomAction && !visible(state.communities).length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    alert('请先在小区管理中创建小区');
    return;
  }
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openDialog('communities');
}, true);
function renderMoveIns() { const target = $('#move-in-list'); if (!target) return; const rows = (state.moveIns || []).filter((item) => !item.archivedAt && !['cancelled', 'completed'].includes(item.status)); const labels = { draft: '办理入住-资料待完善', contract_pending: '办理入住-合同签署中', contract_signed: '办理入住-合同已上传', payment_pending: '办理入住-等待首次缴费' }; const tones = { draft: 'neutral', contract_pending: 'warning', contract_signed: 'success', payment_pending: 'warning' }; target.innerHTML = rows.length ? rows.map((item) => `<article class="move-in-row move-in-${esc(item.status || 'draft')}"><div><strong>${esc(roomLabel(item))}</strong><small>${esc(item.tenantName || '未填写')} · ${esc(item.tenantPhone || '')}</small></div><span class="status-chip ${tones[item.status] || 'neutral'}">${labels[item.status] || item.status}</span><button class="button button-outline" data-resume-move-in="${esc(item.id)}">继续办理</button><button class="button button-danger-outline" data-cancel-move-in="${esc(item.id)}" title="取消办理" aria-label="取消办理"><iconify-icon icon="hugeicons:delete-02"></iconify-icon></button></article>`).join('') : '<p class="meta">暂无办理中的入住</p>'; }
document.addEventListener('rental:data-loaded', renderMoveIns);
document.addEventListener('click', async (event) => { const resume = event.target.closest('[data-resume-move-in]'); if (resume) { moveInDraft = (state.moveIns || []).find((item) => item.id === resume.dataset.resumeMoveIn); if (moveInDraft) { moveInStep = moveInDraft.status === 'payment_pending' ? 3 : moveInDraft.status === 'contract_pending' || moveInDraft.contractStatus === 'generated' || moveInDraft.contractStatus === 'uploaded_signed' ? 2 : 1; renderMoveInDialog(); $('#move-in-dialog').showModal(); refreshMoveInInventory(); } } const cancel = event.target.closest('[data-cancel-move-in]'); if (cancel && confirm('确定取消这张入住办理单吗？')) { try { await api(`move-ins/${cancel.dataset.cancelMoveIn}`, { method: 'DELETE' }); await load(); } catch (error) { alert(error.message); } } });
document.addEventListener('submit', async (event) => { if (event.target.id !== 'rental-settings-form') return; event.preventDefault(); event.stopImmediatePropagation(); const form = event.target; const data = Object.fromEntries([...form.elements].filter((item) => item.name).map((item) => [item.name, item.value])); data.contractParty = { name: data.contractPartyName, phone: data.contractPartyPhone, idCard: data.contractPartyIdCard, address: data.contractPartyAddress }; ['contractPartyName', 'contractPartyPhone', 'contractPartyIdCard', 'contractPartyAddress'].forEach((key) => delete data[key]); const file = $('#contract-template-upload')?.files?.[0]; try { if (file) { if (!/\.docx$/i.test(file.name)) throw new Error('入住合同模板必须是DOCX文件'); data.contractTemplateData = await fileToDataUrlRaw(file); data.contractTemplateName = file.name; } state.settings = await api('settings', { method: 'PATCH', body: JSON.stringify(data) }); $('#settings-status').textContent = '设置已保存'; renderSettings(); } catch (error) { $('#settings-status').textContent = error.message; } }, true);
function resetCommunityForm() { const form = $('#community-form'); if (!form) return; form.reset(); form.elements.id.value = ''; }
document.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-edit-community]');
  if (edit) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openDialog('communities', edit.dataset.editCommunity);
  }
  const remove = event.target.closest('[data-delete-community]');
  if (remove && confirm('归档后该小区不再出现在新增房间选择中，确定继续吗？')) {
    try { await api(`communities/${encodeURIComponent(remove.dataset.deleteCommunity)}`, { method: 'DELETE' }); resetCommunityForm(); await load(); } catch (error) { alert(error.message); }
  }
});
document.addEventListener('click', (event) => { if (event.target.closest('#community-reset')) resetCommunityForm(); });
document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'community-form') return;
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries([...form.elements].filter((item) => item.name && item.name !== 'id').map((item) => [item.name, item.value]));
  const id = form.elements.id.value;
  try { await api(id ? `communities/${encodeURIComponent(id)}` : 'communities', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) }); resetCommunityForm(); await load(); } catch (error) { alert(error.message); }
});

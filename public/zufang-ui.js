/* Runtime structure adapter for the rental workspace reference UI.
 * It keeps the existing API targets and data-action attributes intact while
 * presenting the same page hierarchy as the local design system. */
(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const pageConfig = {
    overview: ['OVERVIEW', '工作台', '今日租务概览，快速处理到期、维护与账单'],
    rental: ['RENTAL MANAGEMENT', '租房管理', '房源卡片、租户状态与续费提醒统一查看'],
    rooms: ['ROOM ARCHIVE', '房间管理', '维护房间档案、房东托管、物品和照片'],
    tenants: ['TENANT DIRECTORY', '租户管理', '在租与已退租分开查看，保留完整历史记录'],
    ledger: ['CASH FLOW', '收支账单', '应收账单与实际流水分开记录，可按时间和房间筛选'],
    maintenance: ['ROOM CARE', '日常维护', '维护记录按房间与日期管理，待处理项目会显示在工作台'],
    checkout: ['MOVE IN / OUT', '入住 / 退房', '通过房间与租户关系生成入住、续费和退房记录'],
    templates: ['BUSINESS TEXT', '业务文字', '生成入住、续租和退房说明，一键复制发送'],
    settings: ['RENTAL SETTINGS', '租房设置', '统一设置到期提醒、水电单价与默认物业费'],
    audit: ['AUDIT LOG', '操作日志', '记录关键业务变更，便于追溯与协作']
  };

  const actionIcons = {
    'add-room': 'hugeicons:add-01',
    'add-lease': 'hugeicons:login-03',
    'add-maintenance': 'hugeicons:note-edit',
    'add-checkout': 'hugeicons:logout-03',
    'add-cost': 'hugeicons:invoice-03',
    'add-item': 'hugeicons:invoice-03',
    'add-ledger': 'hugeicons:invoice-03'
  };

  function icon(name) {
    const node = document.createElement('iconify-icon');
    node.setAttribute('icon', name);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  const statIcons = [
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linejoin="round" d="m16 10 2.15.645c1.373.412 2.06.618 2.455 1.15.395.53.395 1.248.395 2.681V22"/><path stroke-linecap="round" stroke-linejoin="round" d="M8 9h3m-3 4h3"/><path stroke-linejoin="round" d="M12 22v-3c0-.943 0-1.414-.293-1.707S10.943 17 10 17H9c-.943 0-1.414 0-1.707.293S7 18.057 7 19v3"/><path stroke-linecap="round" d="M2 22h20"/><path stroke-linecap="round" stroke-linejoin="round" d="M3 22V6.717c0-2.51 0-3.766.791-4.389s1.956-.284 4.287.392l5 1.451c1.406.408 2.109.612 2.515 1.169C16 5.896 16 6.653 16 8.169V22"/></g></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="m22 10.5-9.117-7.678a1.37 1.37 0 0 0-1.765 0L2 10.5"/><path d="M20.5 9.5V16c0 2.346 0 3.518-.62 4.326a3 3 0 0 1-.554.554c-.808.62-1.98.62-4.326.62V17c0-1.414 0-2.121-.44-2.56C14.122 14 13.415 14 12 14s-2.121 0-2.56.44C9 14.878 9 15.585 9 17v4.5c-2.346 0-3.518 0-4.326-.62a3 3 0 0 1-.554-.554c-.62-.808-.62-1.98-.62-4.326V9.5"/></g></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path stroke-linejoin="round" d="M18 20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2M4 6.848v10.304c0 1.593 0 2.39.465 2.946.464.555 1.25.698 2.82.983l3 .544c2.185.397 3.278.595 3.996-.003.719-.599.719-1.708.719-3.925V6.303c0-2.217 0-3.326-.719-3.925-.718-.598-1.81-.4-3.997-.003l-3 .544c-1.57.285-2.355.428-2.82.983C4 4.458 4 5.255 4 6.848"/><path d="M11.625 12H11.5m.25 0a.25.25 0 1 1-.5 0 .25.25 0 0 1 .5 0Z"/></g></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M20.5 12.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0M5.88 18.703l-2.38 2.3m14.64-2.335 2.36 2.33M5 3 2 6m20 0-3-3"/><path d="M12 8v4.5l2 2"/></g></svg>'
  ];

  function addButtonIcon(button, name) {
    if (!button || !name || button.querySelector('iconify-icon')) return;
    button.prepend(icon(name));
  }

  function decorateButtons(root = document) {
    $$('iconify-icon[icon="hugeicons:tool-box"]', root).forEach((node) => node.setAttribute('icon', 'hugeicons:note-edit'));
    $$('iconify-icon[icon="hugeicons:arrow-up-right-01"]', root).forEach((node) => node.setAttribute('icon', 'hugeicons:arrow-right-01'));
    $$('button[data-action]', root).forEach((button) => addButtonIcon(button, actionIcons[button.dataset.action]));
    $$('.ui-filter-button', root).forEach((button) => addButtonIcon(button, 'hugeicons:filter'));
    $$('.ui-export-button', root).forEach((button) => addButtonIcon(button, 'hugeicons:download-04'));
  }

  function normalizeArchiveButtons(root = document) {
    $$('button[data-delete]', root).forEach((button) => {
      if (button.dataset.archiveIconReady === '1') return;
      button.dataset.archiveIconReady = '1';
      button.classList.add('archive-icon-button');
      button.title = button.title || '删除/归档';
      button.setAttribute('aria-label', button.getAttribute('aria-label') || '删除/归档');
      button.textContent = '';
      const node = document.createElement('iconify-icon');
      node.setAttribute('icon', 'hugeicons:delete-02');
      node.setAttribute('aria-hidden', 'true');
      button.appendChild(node);
    });
  }

  function refreshLocalIcons(root = document) {
    $$('iconify-icon', root).forEach((node) => {
      const name = node.getAttribute('icon');
      if (!name || node.shadowRoot?.querySelector('svg')) return;
      node.removeAttribute('icon');
      requestAnimationFrame(() => node.setAttribute('icon', name));
    });
  }

  function makeHead(view, eyebrow, title, subtitle, action) {
    const head = document.createElement('div');
    head.className = 'page-head';
    head.innerHTML = `<div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>`;
    if (action) {
      action.classList.add('button', 'button-primary');
      head.append(action);
    }
    view.prepend(head);
    return head;
  }

  function oldPanel(view) {
    return view.querySelector(':scope > .panel:not(.ui-content-panel)') || view.querySelector(':scope > .panel');
  }

  function panelWith(node) {
    const panel = document.createElement('section');
    panel.className = 'panel table-panel';
    if (node) panel.append(node);
    return panel;
  }

  function rebuildReferenceStructure() {
    const main = document.querySelector('main');
    const audit = document.getElementById('audit');
    if (main && audit && audit.parentElement !== main) main.append(audit);

    const meta = {
      overview: ['OVERVIEW', '工作台', '今日租务概览，快速处理到期、维护与账单'],
      rental: ['RENTAL MANAGEMENT', '租房管理', '绿色为已出租，红色为空置，琥珀色为装修维护中'],
      rooms: ['ROOM ARCHIVE', '房间管理', '维护房间档案、房东托管、物品和照片'],
      tenants: ['TENANT DIRECTORY', '租户管理', '在租与已退租分开查看，保留完整历史记录'],
      ledger: ['CASH FLOW', '收支账单', '应收账单与实际流水分开记录，可按时间和房间筛选'],
      maintenance: ['ROOM CARE', '日常维护', '维护记录按房间与日期管理，待处理项目会显示在工作台'],
      checkout: ['MOVE IN / OUT', '入住 / 退房', '通过房间与租户关系生成入住、续费和退房记录'],
      templates: ['BUSINESS TEXT', '业务文字', '生成入住、续租和退房说明，一键复制发送'],
      settings: ['RENTAL SETTINGS', '租房设置', '统一设置到期提醒、水电单价与默认物业费'],
      audit: ['AUDIT LOG', '操作日志', '记录关键业务变更，便于追溯与协作']
    };
    Object.keys(meta).forEach((id) => document.getElementById(id)?.classList.add('view'));

    const overview = document.getElementById('overview');
    if (overview && !overview.querySelector(':scope > .page-head')) {
      overview.querySelector('#expiry-alert')?.remove();
      const stats = overview.querySelector(':scope > .stats');
      const finance = overview.querySelector(':scope > .overview-finance-panel');
      const columns = overview.querySelector(':scope > .overview-columns');
      const refresh = document.getElementById('refresh');
      makeHead(overview, ...meta.overview, refresh);
      stats?.classList.add('stats-grid');
      stats?.querySelectorAll(':scope > div').forEach((card, index) => {
        card.classList.add('stat-card');
        const icon = document.createElement('div'); icon.className = `stat-icon ${['blue','green','slate','amber'][index] || 'blue'}`;
        icon.innerHTML = statIcons[index] || statIcons[0]; card.prepend(icon);
      });
      finance?.classList.add('panel', 'finance-panel');
      finance?.querySelector('.panel-title')?.classList.add('section-head');
      finance?.querySelector('#overview-finance')?.classList.add('finance-grid');
      columns?.classList.add('dashboard-columns');
      columns?.querySelector('.overview-todo-panel')?.classList.add('todo-panel');
      columns?.querySelector('.quick-panel')?.classList.add('quick-panel');
      columns?.querySelectorAll('.panel-title').forEach((node) => node.classList.add('section-head'));
    }

    const rental = document.getElementById('rental');
    if (rental && !rental.querySelector(':scope > .page-head')) {
      const panel = oldPanel(rental); const title = panel?.querySelector('.panel-title'); const action = title?.querySelector('button[data-action]');
      const list = document.getElementById('room-list');
      makeHead(rental, ...meta.rental, action); panel?.remove();
      if (list) { list.classList.add('room-grid'); rental.append(list); }
    }

    const rooms = document.getElementById('rooms');
    if (rooms && !rooms.querySelector(':scope > .page-head')) {
      const panel = oldPanel(rooms); const title = panel?.querySelector('.panel-title'); const action = title?.querySelector('button[data-action]');
      const list = document.getElementById('room-admin-list'); const items = document.getElementById('items-list');
      makeHead(rooms, ...meta.rooms, action); panel?.remove();
      if (list) rooms.append(panelWith(list));
      if (items) { items.hidden = true; const sub = items.previousElementSibling; if (sub?.classList.contains('subheading')) sub.hidden = true; }
    }

    const tenants = document.getElementById('tenants');
    if (tenants && !tenants.querySelector(':scope > .page-head')) {
      const panel = oldPanel(tenants); const title = panel?.querySelector('.panel-title'); const action = title?.querySelector('button[data-action]');
      const list = document.getElementById('tenant-list');
      makeHead(tenants, ...meta.tenants, action); panel?.remove();
      const segment = document.createElement('div'); segment.className = 'segmented'; segment.innerHTML = '<button class="active" type="button" data-tenant-filter="all">全部租户 <b>0</b></button><button type="button" data-tenant-filter="refund">待退押金 <b>0</b></button><button type="button" data-tenant-filter="active">租房中 <b>0</b></button><button type="button" data-tenant-filter="ended">已退租 <b>0</b></button>'; tenants.append(segment);
      if (list) { list.classList.remove('data-list'); list.classList.add('tenant-list'); tenants.append(list); }
    }

    const ledger = document.getElementById('ledger');
    if (ledger && !ledger.querySelector(':scope > .page-head')) {
      const panel = oldPanel(ledger); const title = panel?.querySelector('.panel-title'); const action = title?.querySelector('button[data-action]');
      const filters = document.getElementById('ledger')?.querySelector('.ledger-filters'); const summary = document.getElementById('ledger-summary'); const list = document.getElementById('ledger-list');
      makeHead(ledger, ...meta.ledger, action); panel?.remove();
      if (filters) { filters.classList.add('filter-bar', 'ledger-filter'); ledger.append(filters); }
      if (summary) { summary.classList.add('ledger-summary'); ledger.append(summary); }
      if (list) ledger.append(panelWith(list));
    }

    const maintenance = document.getElementById('maintenance');
    if (maintenance && !maintenance.querySelector(':scope > .page-head')) {
      const panel = oldPanel(maintenance); const title = panel?.querySelector('.panel-title'); const action = title?.querySelector('button[data-action="add-maintenance"]');
      const switcher = maintenance.querySelector('.maintenance-view-switch'); const filters = maintenance.querySelector('.maintenance-filters'); const batch = maintenance.querySelector('.maintenance-batch-actions'); const list = document.getElementById('maintenance-list'); const costs = document.getElementById('cost-list');
      makeHead(maintenance, ...meta.maintenance, action); panel?.remove();
      if (switcher) maintenance.append(switcher);
      if (filters) { filters.classList.add('filter-bar'); maintenance.append(filters); }
      if (batch) { batch.classList.add('maintenance-batch'); maintenance.append(batch); }
      if (list) maintenance.append(panelWith(list));
      if (costs) costs.hidden = true;
    }

    const checkout = document.getElementById('checkout');
    if (checkout && !checkout.querySelector(':scope > .page-head')) {
      const panel = oldPanel(checkout); const title = panel?.querySelector('.panel-title'); const action = title?.querySelector('button[data-action]'); const list = document.getElementById('checkout-list');
      makeHead(checkout, ...meta.checkout, null); action?.remove(); panel?.remove();
      if (list) checkout.append(panelWith(list));
    }

    const templates = document.getElementById('templates');
    if (templates && !templates.querySelector(':scope > .page-head')) {
      const panel = oldPanel(templates); const tabs = panel?.querySelector('.template-tabs'); const form = document.getElementById('template-form'); const output = document.getElementById('template-output'); const copy = document.getElementById('copy-template'); const status = document.getElementById('template-status');
      makeHead(templates, ...meta.templates, null); panel?.remove();
      const layout = document.createElement('div'); layout.className = 'template-layout'; const side = document.createElement('section'); side.className = 'panel template-side'; const editor = document.createElement('section'); editor.className = 'panel template-editor';
      if (tabs) { tabs.classList.add('segmented', 'vertical'); side.append(tabs); } [form, output, copy, status].forEach((node) => node && editor.append(node)); layout.append(side, editor); templates.append(layout);
    }

    const settings = document.getElementById('settings');
    if (settings && !settings.querySelector(':scope > .page-head')) {
      const panel = oldPanel(settings); const settingsForm = document.getElementById('rental-settings-form'); const save = document.getElementById('save-rental-settings'); const status = document.getElementById('settings-status'); const userForm = document.getElementById('rental-user-form'); const userList = document.getElementById('user-list');
      makeHead(settings, ...meta.settings, save); panel?.remove();
      const settingsPanel = document.createElement('section'); settingsPanel.className = 'panel settings-grid'; if (settingsForm) settingsPanel.append(settingsForm); settings.append(settingsPanel); if (status) settingsPanel.append(status);
      const account = document.createElement('section'); account.className = 'panel account-panel'; account.innerHTML = '<div class="section-head"><div><h2>后台账号管理</h2><p>为同事创建账号，所有变更都会记录操作人</p></div></div>'; if (userForm) account.append(userForm); if (userList) account.append(userList); settings.append(account);
    }

    const auditView = document.getElementById('audit');
    if (auditView && !auditView.querySelector(':scope > .page-head')) {
      const panel = oldPanel(auditView); const list = document.getElementById('audit-list'); const filter = auditView.querySelector('.ui-audit-filter');
      makeHead(auditView, ...meta.audit, null); panel?.remove(); if (filter) auditView.querySelector('.page-head').append(filter); if (list) auditView.append(panelWith(list));
    }
    const rentalFilter = rental?.querySelector(':scope > .ui-rental-filter');
    const rentalList = rental?.querySelector(':scope > #room-list');
    if (rentalFilter && rentalList) rental.insertBefore(rentalFilter, rentalList);
    const auditFilter = auditView?.querySelector(':scope > .ui-audit-filter');
    if (auditFilter) auditView.querySelector(':scope > .page-head')?.append(auditFilter);
    document.querySelector('main > .rental-header')?.remove();
    document.querySelector('main > .tabs')?.remove();
  }

  function createPageHead(view, config) {
    if (!view || view.querySelector(':scope > .page-head')) return;
    const panel = view.querySelector(':scope > .panel');
    if (!panel) return;
    const [eyebrow, title, subtitle] = config;
    const head = document.createElement('div');
    head.className = 'page-head ui-page-head';
    head.innerHTML = `<div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>`;
    const panelTitle = panel.querySelector(':scope > .panel-title');
    const action = panelTitle?.querySelector('button[data-action], button.primary');
    if (action) {
      action.classList.add('button', 'button-primary', 'ui-page-action');
      head.append(action);
    }
    view.insertBefore(head, panel);
    if (panelTitle) panelTitle.hidden = true;
    panel.classList.add('ui-content-panel');
  }

  function insertFilter(view, className, content) {
    if (!view || view.querySelector(`:scope > .${className}`)) return null;
    const bar = document.createElement('div');
    bar.className = `filter-bar ${className}`;
    bar.innerHTML = content;
    const panel = view.querySelector(':scope > .panel');
    if (panel) view.insertBefore(bar, panel); else view.append(bar);
    return bar;
  }

  function ensureArchiveView() {
    const tabs = document.querySelector('.tabs');
    if (tabs && !tabs.querySelector('[data-tab="archive"]')) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.tab = 'archive'; button.textContent = '已归档'; tabs.append(button);
    }
    const sidebar = document.querySelector('.sidebar nav');
    if (sidebar && !sidebar.querySelector('[data-tab="archive"]')) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'nav-item'; button.dataset.tab = 'archive';
      button.innerHTML = '<iconify-icon icon="hugeicons:archive-02"></iconify-icon><span>已归档</span>'; sidebar.append(button);
    }
    const main = document.querySelector('main');
    if (main && !document.getElementById('archive')) {
      const section = document.createElement('section');
      section.id = 'archive'; section.className = 'tab-panel';
      section.innerHTML = '<div class="page-head"><div><p class="eyebrow">ARCHIVE</p><h1>已归档</h1><p class="subtitle">查看已归档的房源和租户；彻底删除会同步记录到操作日志</p></div></div><section class="panel table-panel"><div id="archive-list"></div></section>';
      main.append(section);
    }
  }

  function buildPageStructure() {
    ensureArchiveView();
    Object.entries(pageConfig).forEach(([id, config]) => createPageHead(document.getElementById(id), config));

    const rental = document.getElementById('rental');
    insertFilter(rental, 'ui-rental-filter', '<div class="search-field"><iconify-icon icon="hugeicons:search-01"></iconify-icon><input id="rental-filter-search" placeholder="搜索小区、房间号或租户" /></div><select id="rental-filter-status"><option value="">全部状态</option><option value="已租出">已出租</option><option value="空置">空置</option><option value="装修维护中">装修维护中</option><option value="即将到期">即将到期</option></select><select id="rental-filter-occupancy" aria-label="已出租房间显示方式"><option value="">显示全部房间</option><option value="hide-rented">隐藏已出租房间</option></select><button class="button button-outline ui-filter-button" type="button" id="rental-filter-reset">清除筛选</button>');

    const rooms = document.getElementById('rooms');
    insertFilter(rooms, 'ui-room-filter', '<div class="search-field"><iconify-icon icon="hugeicons:search-01"></iconify-icon><input id="room-filter-search" placeholder="搜索小区或房间号" /></div><select id="room-filter-status"><option value="">全部状态</option><option value="空置">空置</option><option value="已租出">已租出</option><option value="装修维护中">装修维护中</option></select><button class="button button-outline ui-export-button" type="button" id="room-filter-reset">清除筛选</button>');

    const tenants = document.getElementById('tenants');
    if (tenants && !tenants.querySelector(':scope > .segmented')) {
      const segment = document.createElement('div');
      segment.className = 'segmented ui-tenant-segment';
      segment.innerHTML = '<button class="active" type="button" data-tenant-filter="all">全部租户</button><button type="button" data-tenant-filter="refund">待退押金</button><button type="button" data-tenant-filter="active">租房中</button><button type="button" data-tenant-filter="ended">已退租</button>';
      const panel = tenants.querySelector(':scope > .panel');
      if (panel) tenants.insertBefore(segment, panel);
    }
    if (tenants && !document.getElementById('move-in-list')) {
      const panel = tenants.querySelector(':scope > .panel');
      const section = document.createElement('section');
      section.className = 'panel move-in-panel';
      section.innerHTML = '<div class="panel-title"><div><h2>入住办理中</h2><p>资料、合同和首次缴费分开办理，完成缴费后才进入正式租户</p></div></div><div id="move-in-list" class="data-list"></div>';
      if (panel) tenants.insertBefore(section, panel); else tenants.append(section);
    }

    const ledger = document.getElementById('ledger');
    const ledgerPanel = ledger?.querySelector(':scope > .panel');
    const ledgerFilter = ledgerPanel?.querySelector(':scope > .ledger-filters');
    if (ledger && ledgerFilter) {
      ledgerFilter.classList.add('filter-bar');
      ledger.insertBefore(ledgerFilter, ledgerPanel);
    }

    const maintenance = document.getElementById('maintenance');
    const maintenancePanel = maintenance?.querySelector(':scope > .panel');
    const maintenanceFilter = maintenancePanel?.querySelector(':scope > .maintenance-filters');
    if (maintenance && maintenanceFilter) {
      maintenanceFilter.classList.add('filter-bar');
      maintenance.insertBefore(maintenanceFilter, maintenancePanel);
    }

    const checkout = document.getElementById('checkout');
    if (checkout && !checkout.querySelector(':scope > .process-track')) {
      const track = document.createElement('div');
      track.className = 'process-track';
      track.innerHTML = '<div class="process-step complete"><b>01</b><span>入住</span></div><div class="process-line complete"></div><div class="process-step active"><b>02</b><span>续费</span></div><div class="process-line"></div><div class="process-step"><b>03</b><span>退房</span></div>';
      const panel = checkout.querySelector(':scope > .panel');
      if (panel) checkout.insertBefore(track, panel);
    }

    const templates = document.getElementById('templates');
    const templatePanel = templates?.querySelector(':scope > .panel');
    if (templatePanel && !templatePanel.querySelector(':scope > .template-layout')) {
      const tabs = templatePanel.querySelector('.template-tabs');
      const form = templatePanel.querySelector('#template-form');
      const output = templatePanel.querySelector('#template-output');
      const copy = templatePanel.querySelector('#copy-template');
      const status = templatePanel.querySelector('#template-status');
      const layout = document.createElement('div');
      layout.className = 'template-layout';
      const side = document.createElement('section');
      side.className = 'panel template-side';
      const editor = document.createElement('section');
      editor.className = 'panel template-editor';
      if (tabs) side.append(tabs);
      [form, output, copy, status].forEach((node) => { if (node) editor.append(node); });
      layout.append(side, editor);
      templatePanel.append(layout);
    }

    const audit = document.getElementById('audit');
    insertFilter(audit, 'ui-audit-filter', '<div class="search-field"><iconify-icon icon="hugeicons:search-01"></iconify-icon><input id="audit-filter-search" placeholder="搜索操作人、房间或模块" /></div><button class="button button-outline ui-export-button" type="button" id="audit-filter-reset">清除筛选</button>');
    // Keep the existing IDs and event attributes, while letting the reference
    // design own the visual treatment of each live data container.
    ['room-admin-list', 'items-list', 'ledger-list', 'maintenance-list', 'cost-list', 'checkout-list', 'audit-list']
      .forEach((id) => document.getElementById(id)?.classList.add('table-panel'));
    ['lease-list', 'tenant-list'].forEach((id) => document.getElementById(id)?.classList.add('tenant-list'));
    document.getElementById('overview-finance')?.classList.add('finance-grid');
    const overviewStats = document.querySelector('#overview > .stats');
    overviewStats?.classList.add('stats-grid');
    overviewStats?.querySelectorAll(':scope > div').forEach((card) => card.classList.add('stat-card'));
    document.querySelector('#overview > .overview-finance-panel')?.classList.add('finance-panel');
    document.querySelector('#overview > .overview-columns')?.classList.add('dashboard-columns');
    document.querySelector('#overview .overview-todo-panel')?.classList.add('todo-panel');
    document.querySelector('#overview .quick-panel')?.classList.add('quick-panel');
    document.querySelector('.maintenance-batch-actions')?.classList.add('maintenance-batch');
    document.getElementById('rental-settings-form')?.classList.add('settings-grid');
    document.getElementById('rental-user-form')?.classList.add('settings-grid');
    decorateButtons(document);
    refreshLocalIcons(document);
  }

  function filterCards() {
    const search = ($('#rental-filter-search')?.value || '').trim().toLowerCase();
    const status = $('#rental-filter-status')?.value || '';
    const hideRented = $('#rental-filter-occupancy')?.value === 'hide-rented';
    $$('#room-list .room-card').forEach((card) => {
      const text = card.textContent.toLowerCase();
      const rented = card.dataset.rentalStatus === 'rented' || card.classList.contains('rented') || card.classList.contains('room-occupied');
      card.hidden = Boolean((search && !text.includes(search)) || (status && !text.includes(status)) || (hideRented && rented));
    });
  }

  function filterRoomTable() {
    const search = ($('#room-filter-search')?.value || '').trim().toLowerCase();
    const status = $('#room-filter-status')?.value || '';
    $$('#room-admin-list tbody tr').forEach((row) => {
      const text = row.textContent.toLowerCase();
      row.hidden = Boolean((search && !text.includes(search)) || (status && !text.includes(status)));
    });
  }

  function filterTenants(mode) {
    $$('#tenants [data-tenant-filter]').forEach((button) => button.classList.toggle('active', button.dataset.tenantFilter === mode));
    if ($$('#tenant-list .tenant-row').length) {
      $$('#tenant-list .tenant-row').forEach((row) => { row.hidden = mode !== 'all' && row.dataset.tenantState !== mode; });
      return;
    }
    $$('#tenant-list .tenant-group').forEach((group) => {
      const ended = /已退租/.test(group.textContent);
      if (mode === 'active') group.hidden = ended;
      else if (mode === 'ended') group.hidden = !ended;
      else group.hidden = !ended || !/待退押金/.test(group.textContent);
    });
  }

  function filterAudit() {
    const value = ($('#audit-filter-search')?.value || '').trim().toLowerCase();
    $$('#audit-list tbody tr').forEach((row) => { row.hidden = Boolean(value && !row.textContent.toLowerCase().includes(value)); });
  }

  function prettyRemaining(days) {
    if (days === null || days === undefined) return '未设置';
    return days < 0 ? `已逾期 ${Math.abs(days)} 天` : `剩余 ${days} 天`;
  }

  function refTable(headers, rows) {
    return `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function roomArchiveButton(room) {
    return `<button class="button button-danger-outline room-archive-button" data-delete="rooms" data-id="${esc(room.id)}" title="删除/归档房间" aria-label="删除/归档房间"><iconify-icon icon="hugeicons:delete-02" aria-hidden="true"></iconify-icon></button>`;
  }

  function roomTenantHistoryButton(room) {
    return `<button class="button button-outline" data-show-room-tenants="${esc(room.roomNo)}">历史租客</button>`;
  }

  function landlordContractStatus(room) {
    if (room.landlordContractType === 'paper' && room.landlordContractFile) return `<a class="contract-badge uploaded" href="${esc(room.landlordContractFile)}" target="_blank" rel="noopener">纸质合同已上传</a>`;
    if (room.landlordContractType === 'electronic' && room.landlordContractUrl) return `<a class="contract-badge uploaded" href="${esc(room.landlordContractUrl)}" target="_blank" rel="noopener">电子合同已配置</a>`;
    return '<span class="contract-badge missing">合同未上传</span>';
  }

  function contractLink(lease) {
    const url = lease.contractFileUrl || lease.signedContractFile || lease.generatedContractFile;
    return url ? `<a class="button button-outline contract-link" href="${esc(url)}" target="_blank" rel="noopener">查看合同</a>` : '';
  }

  function openRoomTenantHistory(roomNo) {
    const room = state.rooms.find((item) => item.roomNo === roomNo);
    const leases = state.leases.filter((lease) => lease.roomNo === roomNo).sort((a, b) => {
      if ((a.status === 'active') !== (b.status === 'active')) return a.status === 'active' ? -1 : 1;
      return String(b.startDate || '').localeCompare(String(a.startDate || ''));
    });
    const checkoutForLease = (lease) => state.checkouts.filter((item) => item.leaseId === lease.id || (!item.leaseId && item.roomNo === roomNo && (!item.tenantPhone || item.tenantPhone === lease.tenantPhone))).sort((a, b) => String(b.checkoutDate || '').localeCompare(String(a.checkoutDate || '')))[0];
    const purposeLabels = { self: '自住', studio: '工作室', homestay: '民宿', other: '其他' };
    const rows = leases.map((lease) => {
      const checkout = checkoutForLease(lease);
      const active = lease.status === 'active';
      const status = active ? '<span class="status-chip success">正在入住</span>' : lease.depositStatus === 'refunded' ? '<span class="status-chip neutral">已退租</span>' : '<span class="status-chip warning">待退押金</span>';
      const endLabel = active ? `续租截至：${esc(dueDate(lease) || '未设置')}` : `退房时间：${esc(checkout?.checkoutDate || lease.endDate || '未设置')}`;
      return [`<strong>${esc(lease.tenantName || '未填写租户')}</strong><small>${esc(lease.tenantPhone || '未填写电话')}</small>`, status, esc(purposeLabels[lease.purpose] || lease.purpose || '未设置'), esc(lease.startDate || '未设置'), endLabel, money(lease.deposit || 0)];
    });
    $('#room-tenants-dialog-title').textContent = `${room ? `${room.propertyName || '房间'} · ${room.roomNo}` : roomLabel(roomNo)} · 历史租客`;
    $('#room-tenants-list').innerHTML = leases.length ? refTable(['租户', '状态', '租房用途', '入住时间', '续租/退房', '押金'], rows) : '<p class="room-tenants-empty">该房间暂无租客记录</p>';
    $('#room-tenants-dialog').showModal();
  }

  function installReferenceRenderers() {
    if (typeof state === 'undefined' || typeof esc !== 'function') return;
    const purposeLabels = { self: '自住', studio: '工作室', homestay: '民宿', other: '其他' };
    const statusChip = (label, tone) => `<span class="status-chip ${tone}">${label}</span>`;
    const oldRooms = window.renderRooms;
    window.renderRooms = function referenceRenderRooms() {
      const target = document.getElementById('room-list'); if (!target) return;
      const reminderDays = Number(state.settings?.reminderDays ?? 10);
      const sourceRooms = typeof visible === 'function' ? visible(state.rooms) : state.rooms;
      const rooms = typeof sortRentalRooms === 'function' ? sortRentalRooms(sourceRooms, reminderDays) : sourceRooms;
      target.innerHTML = rooms.length ? rooms.map((room) => {
        const lease = typeof leaseForRoom === 'function' ? leaseForRoom(room) : null;
        const moveIn = (state.moveIns || []).find((item) => {
          if (item.archivedAt || ['cancelled', 'completed'].includes(item.status)) return false;
          const sameRoomId = room.id && item.roomId && String(item.roomId) === String(room.id);
          const sameRoomNo = String(item.roomNo || '') === String(room.roomNo || '');
          return sameRoomId || sameRoomNo;
        });
        const contractPending = !lease && moveIn?.status === 'contract_pending';
        const paymentPending = !lease && moveIn?.status === 'payment_pending';
        const maintenance = room.status === 'maintenance' && !lease && !moveIn;
        const days = lease && typeof dueDate === 'function' ? daysUntil(dueDate(lease)) : null;
        const expiring = lease && days !== null && days >= 0 && days <= reminderDays;
        const cardClass = maintenance ? 'room-maintenance' : expiring ? 'room-expiring' : lease ? 'room-occupied' : contractPending || paymentPending ? 'room-move-in-pending' : 'room-vacant';
        const status = maintenance ? statusChip('装修维护中', 'warning') : expiring ? statusChip('即将到期', 'warning') : lease ? statusChip('已出租', 'success') : contractPending ? statusChip('合同签署中', 'warning') : paymentPending ? statusChip('等待首次缴费', 'warning') : statusChip('空置', 'danger');
        const purpose = lease ? (purposeLabels[lease.purpose] || lease.purpose || '未设置') : '';
        const total = lease ? Number(lease.monthlyRent || 0) + Number(lease.monthlyPropertyFee || 0) : 0;
        const deposit = lease && lease.deposit !== '' && lease.deposit !== undefined ? ` · 押金：${money(lease.deposit)}` : '';
        const dayLabel = lease && days !== null ? `<strong class="room-card-days">${days < 0 ? `已逾期${Math.abs(days)}天` : `剩余${days}天`}</strong>` : '';
        const action = lease
          ? `<button class="button button-dark" data-show-room-maintenance="${esc(room.roomNo)}">房间维护</button><button class="button button-outline" data-edit="leases" data-id="${esc(lease.id)}">租户信息</button><button class="button button-outline" data-action="add-lease" data-room-no="${esc(room.roomNo)}" data-room-id="${esc(room.id)}">续费</button><button class="button button-outline" data-action="add-checkout" data-room-no="${esc(room.roomNo)}" data-room-id="${esc(room.id)}">退房</button>`
          : moveIn
            ? `<button class="button button-dark" data-show-room-maintenance="${esc(room.roomNo)}">房间维护</button><button class="button button-outline" data-resume-move-in="${esc(moveIn.id)}">继续办理</button>`
            : `<button class="button button-dark" data-show-room-maintenance="${esc(room.roomNo)}">房间维护</button><button class="button button-outline" data-action="start-move-in" data-room-no="${esc(room.roomNo)}" data-room-id="${esc(room.id)}">办理入住</button>`;
        const body = lease
          ? `<div class="room-tenant">租户：${esc(lease.tenantName || '未填写')} · ${esc(lease.tenantPhone || '未填写')} · ${esc(purpose)}${deposit}</div><div class="room-payment-row"><div><span>缴费方式 / 月付金额</span><strong>${esc(paymentLabel(lease.paymentMethod || lease.billingCycle))} · ${money(total)}</strong></div><div><span>入住时间</span><strong>${esc(lease.startDate || '未设置')}</strong></div><div><span>交费至</span><strong>${esc(dueDate(lease) || '未设置')}</strong></div></div>`
          : moveIn
            ? `<div class="room-vacant-note">${esc(moveIn.tenantName || '未填写租户')} · ${contractPending ? '合同签署中' : '等待首次缴费'}</div><div class="room-payment-row"><div><span>入住办理</span><strong>待完成</strong></div><div><span>房间面积</span><strong>${esc(room.area || 0)}㎡</strong></div><div><span>托管到期</span><strong>${esc(room.landlordLeaseEnd || '未设置')}</strong></div></div>`
            : `<div class="room-vacant-note">当前无在租租户</div><div class="room-payment-row"><div><span>面积</span><strong>${esc(room.area || 0)}㎡</strong></div><div><span>物业费</span><strong>${money(room.monthlyPropertyFee || 0)} / 月</strong></div><div><span>托管到期</span><strong>${esc(room.landlordLeaseEnd || '未设置')}</strong></div></div>`;
        return `<article class="room-card ${cardClass}" data-rental-status="${lease ? 'rented' : maintenance ? 'maintenance' : moveIn ? 'move-in-pending' : 'vacant'}"><div class="room-card-head"><div><h3>${esc(`${room.propertyName || '房间'} · ${room.roomNo}`)}</h3></div><div class="room-card-head-meta">${status}${dayLabel}</div></div>${body}<div class="room-actions">${action}</div></article>`;
      }).join('') : '<p class="meta">请先添加房间</p>';
      if (oldRooms && !rooms.length) oldRooms.call(this);
    };

    window.renderRoomAdmin = function referenceRenderRoomAdmin() {
      const target = document.getElementById('room-admin-list'); if (!target) return;
      const rooms = typeof visible === 'function' ? visible(state.rooms) : state.rooms;
      const rows = rooms.map((room) => {
        const lease = typeof leaseForRoom === 'function' ? leaseForRoom(room) : null;
        const status = room.status === 'maintenance' && !lease ? statusChip('装修维护中', 'warning') : lease ? statusChip('已出租', 'success') : statusChip('空置', 'danger');
        const items = state.items.filter((item) => item.roomNo === room.roomNo && !item.archivedAt);
        const photos = Array.isArray(room.images) ? room.images : [];
        return [`<strong>${esc(room.propertyName || '房间')} · ${esc(room.roomNo)}</strong><small>${esc(room.area || 0)}㎡</small>`, status, `¥ ${Number(room.monthlyPropertyFee || 0).toLocaleString('zh-CN')} / 月`, `¥ ${Number(room.landlordAnnualRent || 0).toLocaleString('zh-CN')} / 年${landlordContractStatus(room)}`, esc(room.landlordLeaseEnd || '未设置'), lease ? `${esc(lease.tenantName || '未填写')}<small>${esc(lease.tenantPhone || '')}</small>` : '暂无', `<button class="link-button" data-show-room-items="${esc(room.roomNo)}">${items.length} 件物品</button>`, `<button class="link-button" data-show-room-photos="${esc(room.roomNo)}">${photos.length} 张照片</button>`, `<div class="table-actions"><button class="button button-outline" data-edit="rooms" data-id="${esc(room.id)}">编辑</button><button class="button button-outline" data-show-room-maintenance="${esc(room.roomNo)}">维护记录</button>${roomTenantHistoryButton(room)}${roomArchiveButton(room)}</div>`];
      });
      const mobileCards = rooms.map((room) => {
        const lease = typeof leaseForRoom === 'function' ? leaseForRoom(room) : null;
        const status = room.status === 'maintenance' && !lease ? statusChip('装修维护中', 'warning') : lease ? statusChip('已出租', 'success') : statusChip('空置', 'danger');
        const items = state.items.filter((item) => item.roomNo === room.roomNo && !item.archivedAt);
        const photos = Array.isArray(room.images) ? room.images : [];
        return `<article class="room-admin-mobile-card"><div class="room-card-head"><div><h3>${esc(room.propertyName || '房间')} · ${esc(room.roomNo)}</h3><p>${esc(room.area || 0)}㎡ · 物业费 ¥ ${Number(room.monthlyPropertyFee || 0).toLocaleString('zh-CN')} / 月</p></div>${status}</div><div class="room-mobile-meta"><div><span>房东年租</span><b>¥ ${Number(room.landlordAnnualRent || 0).toLocaleString('zh-CN')}</b>${landlordContractStatus(room)}</div><div><span>托管到期</span><b>${esc(room.landlordLeaseEnd || '未设置')}</b></div><div><span>当前租户</span><b>${lease ? esc(lease.tenantName || '未填写') : '暂无'}</b></div><div><span>物品清单</span><button class="link-button" data-show-room-items="${esc(room.roomNo)}">${items.length} 件</button></div><div><span>房间照片</span><button class="link-button" data-show-room-photos="${esc(room.roomNo)}">${photos.length} 张</button></div></div><div class="card-actions"><button class="button button-outline" data-edit="rooms" data-id="${esc(room.id)}">编辑</button><button class="button button-outline" data-show-room-maintenance="${esc(room.roomNo)}">维护记录</button>${roomTenantHistoryButton(room)}${roomArchiveButton(room)}</div></article>`;
      }).join('');
      target.innerHTML = `<div class="room-admin-table">${refTable(['小区 / 房间', '状态', '物业费', '房东年租', '托管到期', '当前租户', '物品清单', '房间照片', '操作'], rows)}</div><div class="room-admin-mobile-list">${mobileCards || '<p class="meta">暂无房间</p>'}</div>`;
    };

    window.renderArchive = function referenceRenderArchive() {
      const target = document.getElementById('archive-list'); if (!target) return;
      const rooms = state.rooms.filter((item) => item.archivedAt);
      const leases = state.leases.filter((item) => item.archivedAt);
      const roomRows = rooms.map((room) => [
        `<strong>${esc(room.propertyName || '房间')} · ${esc(room.roomNo || '')}</strong>`,
        '房源', room.archivedAt.slice(0, 16).replace('T', ' '),
        `<button class="button button-danger-outline" data-purge data-purge-type="rooms" data-purge-id="${esc(room.id)}">彻底删除</button>`
      ]);
      const leaseRows = leases.map((lease) => [
        `<strong>${esc(lease.tenantName || '未填写租户')}</strong><small>${esc(roomLabel(lease.roomNo))} · ${esc(lease.tenantPhone || '')}</small>`,
        '租户', lease.archivedAt.slice(0, 16).replace('T', ' '),
        `<button class="button button-danger-outline" data-purge data-purge-type="leases" data-purge-id="${esc(lease.id)}">彻底删除</button>`
      ]);
      target.innerHTML = `<h2>已归档房源（${rooms.length}）</h2>${refTable(['记录', '类型', '归档时间', '操作'], roomRows)}<h2 class="section-rule-title">已归档租户（${leases.length}）</h2>${refTable(['记录', '类型', '归档时间', '操作'], leaseRows)}`;
    };

    window.renderTenants = function referenceRenderTenants() {
      const target = document.getElementById('tenant-list'); if (!target) return;
      const list = state.leases.filter((lease) => !lease.archivedAt);
      const stateRank = (lease) => lease.status === 'active' ? 1 : lease.depositStatus === 'refunded' ? 2 : 0;
      const ordered = [...list].sort((a, b) => stateRank(a) - stateRank(b) || String(a.tenantName || '').localeCompare(String(b.tenantName || ''), 'zh-CN'));
      const rows = ordered.map((lease) => {
        const ended = lease.status !== 'active'; const due = typeof dueDate === 'function' ? dueDate(lease) : '';
        const checkout = ended ? state.checkouts.find((item) => item.leaseId === lease.id) : null;
        const date = ended ? (checkout?.checkoutDate || lease.endDate || '未设置') : due;
        const stateKey = ended ? (lease.depositStatus === 'refunded' ? 'ended' : 'refund') : 'active';
        const stateLabel = stateKey === 'refund' ? '待退押金' : stateKey === 'ended' ? '已退租' : '租房中';
        const tone = stateKey === 'active' ? 'success' : stateKey === 'refund' ? 'warning' : 'muted';
        const refund = stateKey === 'refund' ? `<button class="button button-refund" data-refund-deposit="${esc(lease.id)}">押金已退</button>` : '';
        const durationText = (() => {
          if (!lease.startDate) return '未设置';
          const start = new Date(`${lease.startDate}T00:00:00Z`); const end = new Date(`${ended ? date : today()}T00:00:00Z`);
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return '0个月0天';
          let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
          const anchor = new Date(start); anchor.setUTCMonth(anchor.getUTCMonth() + months);
          const inclusiveMonthEnd = new Date(anchor); inclusiveMonthEnd.setUTCDate(inclusiveMonthEnd.getUTCDate() - 1);
          if (months > 0 && end.getTime() === inclusiveMonthEnd.getTime()) return `${months}个月0天`;
          if (anchor > end) { months -= 1; anchor.setUTCMonth(anchor.getUTCMonth() - 1); }
          const days = Math.max(0, Math.round((end - anchor) / 86400000));
          return `${months}个月${days}天`;
        })();
        const purpose = purposeLabels[lease.purpose] || lease.purpose || '未设置';
        const total = Number(lease.monthlyRent || 0) + Number(lease.monthlyPropertyFee || 0);
        return `<article class="tenant-row" data-tenant-state="${stateKey}"><div class="tenant-main"><div><h3>${esc(lease.tenantName || '未填写租户')} <span class="tenant-phone-inline">${esc(lease.tenantPhone || '未填写电话')}</span></h3><p>${esc(roomLabel(lease.roomNo))}</p></div></div><div><span>租房用途</span><strong>${esc(purpose)}</strong></div><div class="tenant-payment"><span>支付方式 / 月付金额</span><strong>${esc(paymentLabel(lease.paymentMethod || lease.billingCycle))} · ${money(total)}${lease.deposit !== '' && lease.deposit !== undefined ? ` · 押金 ${money(lease.deposit)}` : ''}</strong></div><div><span>入住时间</span><strong>${esc(lease.startDate || '未设置')}</strong></div><div><span>${ended ? '退房时间' : '续租截至'}</span><strong>${esc(ended ? date : (due || '未设置'))}</strong>${!ended ? `<em>${prettyRemaining(daysUntil(due))}</em>` : ''}</div><div><span>入住时长</span><strong>${durationText}</strong></div><div><span>租户状态</span><strong class="tenant-status-${tone}">${stateLabel}</strong></div><div class="table-actions">${refund}<button class="button button-outline" data-show-renewals="${esc(lease.id)}">续费记录</button><button class="button button-outline" data-edit="leases" data-id="${esc(lease.id)}">租户信息</button>${contractLink(lease)}<button class="button button-danger-outline tenant-archive-button" data-delete="leases" data-id="${esc(lease.id)}" title="租户归档" aria-label="租户归档"><iconify-icon icon="hugeicons:archive-02"></iconify-icon></button></div></article>`;
      });
      target.innerHTML = rows.length ? rows.join('') : '<p class="meta">暂无记录</p>';
      const counts = { all: list.length, active: list.filter((item) => item.status === 'active').length, ended: list.filter((item) => item.status !== 'active' && item.depositStatus === 'refunded').length, refund: list.filter((item) => item.status !== 'active' && item.depositStatus !== 'refunded').length };
      document.querySelectorAll('[data-tenant-filter]').forEach((button) => { const b = button.querySelector('b'); if (b) b.textContent = counts[button.dataset.tenantFilter] ?? 0; });
    };

    window.renderTodo = function referenceRenderTodo() {
      const target = document.getElementById('todo-list'); if (!target) return;
      const maintenance = state.maintenance.filter((item) => !item.archivedAt && item.status === 'pending');
      const refunds = state.leases.filter((lease) => !lease.archivedAt && lease.status !== 'active' && lease.depositStatus !== 'refunded');
      const rows = [
        ...maintenance.map((item) => `<div class="todo-row"><span class="todo-dot amber"></span><div><strong>${esc(roomLabel(item.roomNo))} · ${esc(item.item || '房间维护')}</strong><small>维护待处理${item.note ? ` · ${esc(item.note)}` : ''}</small></div><b class="expense-text">¥ ${Number(item.amount || 0).toLocaleString('zh-CN')}</b></div>`),
        ...refunds.map((lease) => `<div class="todo-row"><span class="todo-dot blue"></span><div><strong>${esc(roomLabel(lease.roomNo))} · ${esc(lease.tenantName || '租户')}</strong><small>退租待退押金 · 需要确认</small></div><button class="mini-button" data-todo-tab="tenants">处理</button></div>`)
      ];
      target.innerHTML = rows.length ? rows.join('') : '<p class="meta">暂无待处理事项</p>';
      const badge = document.querySelector('#overview .todo-panel .count-badge'); if (badge) badge.textContent = rows.length;
    };

    const wrapAfter = (name, after) => { const original = window[name]; if (typeof original !== 'function') return; window[name] = function wrappedRenderer(...args) { const result = original.apply(this, args); after(); return result; }; };
    wrapAfter('renderStats', () => { document.querySelectorAll('#overview-finance > div').forEach((item, index) => { item.classList.add('finance-item'); item.classList.remove('income', 'expense', 'balance', 'pending'); item.classList.add(['income', 'expense', 'balance', 'pending', 'pending'][index] || 'balance'); }); });
    wrapAfter('renderLedger', () => { document.querySelectorAll('#ledger-summary > div').forEach((item, index) => item.classList.add('summary-card', index === 0 ? 'income' : index === 1 ? 'expense' : index === 2 ? 'balance' : 'pending')); document.querySelectorAll('#ledger-list table').forEach((table) => table.classList.add('data-table')); });
    wrapAfter('renderMaintenance', () => document.querySelectorAll('#maintenance-list table').forEach((table) => table.classList.add('data-table')));
    wrapAfter('renderCheckouts', () => document.querySelectorAll('#checkout-list table').forEach((table) => table.classList.add('data-table')));
    wrapAfter('renderAudit', () => document.querySelectorAll('#audit-list table').forEach((table) => table.classList.add('data-table')));
  }

  function bindInteractions() {
    document.addEventListener('input', (event) => {
      if (event.target.id === 'rental-filter-search') filterCards();
      if (event.target.id === 'room-filter-search') filterRoomTable();
      if (event.target.id === 'audit-filter-search') filterAudit();
    });
    document.addEventListener('change', (event) => {
      if (event.target.id === 'rental-filter-status' || event.target.id === 'rental-filter-occupancy') filterCards();
      if (event.target.id === 'room-filter-status') filterRoomTable();
    });
    document.addEventListener('click', (event) => {
      const tenantFilter = event.target.closest('[data-tenant-filter]');
      if (tenantFilter) filterTenants(tenantFilter.dataset.tenantFilter);
      const archiveTab = event.target.closest('[data-tab="archive"]');
      if (archiveTab) { const title = document.getElementById('view-title'); if (title) title.textContent = '已归档'; }
      const roomTenants = event.target.closest('[data-show-room-tenants]');
      if (roomTenants) openRoomTenantHistory(roomTenants.dataset.showRoomTenants);
      if (event.target.closest('#room-tenants-dialog-close')) $('#room-tenants-dialog')?.close();
      if (event.target.closest('#rental-filter-reset')) { $('#rental-filter-search').value = ''; $('#rental-filter-status').value = ''; $('#rental-filter-occupancy').value = ''; filterCards(); }
      if (event.target.closest('#room-filter-reset')) { $('#room-filter-search').value = ''; $('#room-filter-status').value = ''; filterRoomTable(); }
      if (event.target.closest('#audit-filter-reset')) { $('#audit-filter-search').value = ''; filterAudit(); }
    });
  }

  function observeDynamicLists() {
    ['room-list', 'room-admin-list', 'tenant-list', 'audit-list', 'ledger-list', 'maintenance-list', 'cost-list', 'checkout-list', 'room-items-list', 'room-maintenance-list'].forEach((id) => {
      const target = document.getElementById(id);
      if (!target) return;
      new MutationObserver(() => {
        filterCards();
        filterRoomTable();
        filterAudit();
        decorateButtons(target);
        normalizeArchiveButtons(target);
        refreshLocalIcons(target);
      }).observe(target, { childList: true, subtree: true });
    });
    normalizeArchiveButtons(document);
  }

  function renderReferenceViews() {
    ['renderStats', 'renderRooms', 'renderRoomAdmin', 'renderTenants', 'renderArchive', 'renderLedger', 'renderMaintenance', 'renderCheckouts', 'renderAudit', 'renderTodo', 'renderSettings', 'renderUsers'].forEach((name) => {
      if (typeof window[name] === 'function') window[name]();
    });
    normalizeArchiveButtons(document);
  }

  document.addEventListener('rental:data-loaded', renderReferenceViews);
  document.documentElement.dataset.rentalUiReady = '1';

  rebuildReferenceStructure();
  installReferenceRenderers();
  rebuildReferenceStructure();
  buildPageStructure();
  const rentalFilterAfterBuild = document.querySelector('#rental > .ui-rental-filter');
  const rentalListAfterBuild = document.querySelector('#rental > #room-list');
  if (rentalFilterAfterBuild && rentalListAfterBuild) document.getElementById('rental').insertBefore(rentalFilterAfterBuild, rentalListAfterBuild);
  const auditFilterAfterBuild = document.querySelector('#audit > .ui-audit-filter');
  if (auditFilterAfterBuild) document.querySelector('#audit > .page-head')?.append(auditFilterAfterBuild);
  renderReferenceViews();
  bindInteractions();
  observeDynamicLists();
  normalizeArchiveButtons(document);
  setTimeout(() => refreshLocalIcons(document), 120);

  const dismissibleDialogs = '#record-dialog, #renewal-dialog, #room-items-dialog, #room-maintenance-dialog, #room-photos-dialog, #image-preview-dialog, #maintenance-batch-dialog';
  document.addEventListener('click', (event) => {
    const dialog = event.target.closest(dismissibleDialogs);
    if (dialog && event.target === dialog && dialog.open) dialog.close();
  });
})();

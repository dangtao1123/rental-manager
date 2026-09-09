(() => {
  const legacyFieldsFor = fieldsFor;
  const legacyCollectDialog = collectDialog;
  const legacyHandleMaintenanceItemLink = handleMaintenanceItemLink;
  let batchItemMode = false;
  const overviewFinanceFilter = { mode: 'year', start: '', end: '' };

  const roomFor = (record = {}) => state.rooms.find((item) => item.id === record.roomId) || state.rooms.find((item) => item.roomNo === record.roomNo);

  function renderDialogInventory(type, record = {}) {
    if (!['leases', 'renewal', 'checkouts'].includes(type)) return;
    const lease = type === 'renewal' ? state.leases.find((item) => item.id === record.leaseId || item.roomNo === record.roomNo) : null;
    const room = roomFor(record) || roomFor(lease || {});
    if (!room) return;
    const items = state.items.filter((item) => !item.archivedAt && ((item.roomId && item.roomId === room.id) || (!item.roomId && item.roomNo === room.roomNo)));
    const section = document.createElement('section');
    section.className = 'dialog-inventory-section';
    section.innerHTML = `<div class="dialog-inventory-heading"><div><h3>房间物品明细</h3><p>核对该房间当前登记的物品</p></div><button type="button" class="button button-outline" data-show-room-items="${esc(room.roomNo)}">管理物品</button></div><div class="dialog-inventory-list">${items.length ? items.map((item) => `<span class="dialog-inventory-item"><strong>${esc(item.name)} × ${esc(Math.max(1, Math.trunc(Number(item.quantity || 1) || 1)))}</strong>${item.note ? `<small>${esc(item.note)}</small>` : ''}</span>`).join('') : '<span class="meta">该房间暂未登记物品</span>'}</div>`;
    const anchor = type === 'checkouts'
      ? document.querySelector('#dialog-fields .field-otherHeading')
      : document.querySelector('#dialog-fields .field-section-note');
    const fields = $('#dialog-fields');
    if (anchor) fields.insertBefore(section, anchor);
    else fields.appendChild(section);
  }

  function leaseFields(record) {
    const room = roomFor(record);
    const propertyFee = record.propertyFeeMode === 'tenant_self' ? 0 : (record.monthlyPropertyFee ?? record._roomMonthlyPropertyFee ?? room?.monthlyPropertyFee ?? 0);
    return [['roomId', '小区/房间', room?.id || '', 'select', roomOptions(room?.id || record.roomNo, false)], ['tenantName', '租户姓名', record.tenantName || ''], ['tenantPhone', '租户电话', record.tenantPhone || ''], ['purpose', '住房目的', record.purpose || 'self', 'select', 'self:自住|studio:工作室|homestay:民宿|other:其他'], ['startDate', '入住时间', record.startDate || today(), 'date'], ['endDate', '合同结束时间', record.endDate || '', 'date'], ['paymentMethod', '租金支付方式', record.paymentMethod || record.billingCycle || 'monthly', 'select', 'monthly:月付|quarterly:季付|yearly:年付'], ['monthlyRent', '月租金（计费基准）', record.monthlyRent || ''], ['deposit', '押金', record.deposit || ''], ['propertyFeeMode', '物业费收取方式', record.propertyFeeMode || record._propertyFeeMode || room?.propertyFeeMode || 'included', 'select', 'included:与房租一起交|tenant_self:租户自理'], ['monthlyPropertyFee', '每月物业费', propertyFee, 'readonly'], ['totalMonthly', '合计每月应收', Number(record.monthlyRent || 0) + Number(propertyFee), 'readonly'], ['moveInElectricity', '入住电表读数', record.moveInElectricity || ''], ['moveInWater', '入住水表读数', record.moveInWater || ''], ['idCardFront', '身份证正面', record.idCardFront || '', 'file'], ['idCardBack', '身份证反面', record.idCardBack || '', 'file'], ['note', '备注', record.note || '', 'textarea']];
  }

  function renewalFields(record) {
    const lease = state.leases.find((item) => item.id === record.leaseId || item.roomNo === record.roomNo) || {};
    const previousEnd = lease.paidThrough || renewalsForLease(lease.id)
      .filter((item) => item.endDate)
      .sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)))[0]?.endDate || '';
    const start = previousEnd ? addDays(previousEnd, 1) : (record.startDate || lease.startDate || '');
    const initialPayment = Boolean(record._initialPayment);
    return [['roomNo', '小区/房间', roomLabel(record.roomNo), 'readonly'], ['tenantName', '租户姓名', record.tenantName || lease.tenantName || '', 'readonly'], ['tenantPhone', '租户电话', record.tenantPhone || lease.tenantPhone || '', 'readonly'], ['renewalDate', '续费日期', record.renewalDate || today(), 'date'], ['durationPreset', '续租周期', record.durationPreset || '1month', 'select', 'days:按天|1month:+1个月|3months:+3个月|6months:+6个月|1year:+1年'], ['durationValue', '天数', record.durationValue || 30], ['leaseStart', '入住时间', record.leaseStart || lease.startDate || '', 'readonly'], ['startDate', '本次续租开始', start, 'readonly'], ['endDate', '续租后到期时间', record.endDate || '', 'readonly'], ['monthlyRent', '月租金', record.monthlyRent ?? lease.monthlyRent ?? ''], ['monthlyPropertyFee', '物业费', record.monthlyPropertyFee ?? lease.monthlyPropertyFee ?? ''], ...(initialPayment ? [['deposit', '租房押金', record.deposit ?? lease.deposit ?? 0, 'readonly']] : []), ['amount', '应收费用', record.amount || '', 'readonly'], ['note', '备注', record.note || '', 'textarea']];
  }

  function checkoutFields(record) {
    const room = roomFor(record);
    const roomField = record.leaseId
      ? [['roomId', '', room?.id || record.roomId || '', 'readonly', 'hidden'], ['roomNo', '', record.roomNo || '', 'readonly', 'hidden'], ['roomDisplay', '小区/房间', roomLabel(record), 'readonly']]
      : [['roomId', '小区/房间', room?.id || '', 'select', roomOptions(room?.id || record.roomNo, false)]];
    return [...roomField, ['tenantName', '租户姓名', record.tenantName || '', 'readonly'], ['tenantPhone', '租户电话', record.tenantPhone || '', 'readonly'], ['leaseStart', '租期开始', record.leaseStart || '', 'readonly'], ['leaseEnd', '租期结束', record.checkoutDate || record.leaseEnd || '', 'readonly'], ['paidThrough', '已缴费至', record.paidThrough || '', 'readonly'], ['checkoutDate', '退房时间', record.checkoutDate || today(), 'date'], ['deposit', '入住押金', record.deposit || '', 'readonly', 'hidden'], ['waterHeading', '水费核算', '', 'heading'], ['waterStart', '入住水表', record.waterStart || '', 'readonly'], ['waterEnd', '退房水表', record.waterEnd || ''], ['waterUnitPrice', '水费单价', record.waterUnitPrice ?? state.settings.waterUnitPrice, 'readonly'], ['waterAmount', '水费扣除', record.waterAmount || '', 'readonly'], ['electricityHeading', '电费核算', '', 'heading'], ['electricityStart', '入住电表', record.electricityStart || '', 'readonly'], ['electricityEnd', '退房电表', record.electricityEnd || ''], ['electricityUnitPrice', '电费单价', record.electricityUnitPrice ?? state.settings.electricityUnitPrice, 'readonly'], ['electricityAmount', '电费返还/扣除', record.electricityAmount || '', 'readonly'], ['otherHeading', '退房扣除或返还项目', '', 'heading'], ['otherItems', '新增扣除或返还项目', record.otherItems || [], 'json'], ['bankHeading', '收款信息', '', 'heading'], ['bankName', '收款银行', record.bankName || ''], ['accountName', '收款人', record.accountName || ''], ['accountNo', '收款账号', record.accountNo || ''], ['refundAmount', '应退费用', record.refundAmount || '', 'readonly', 'hidden'], ['note', '备注', record.note || '', 'textarea']];
  }

  function withSections(fields, sections = {}) {
    const result = [];
    fields.forEach((field) => {
      const heading = sections[field[0]];
      if (heading && field[3] !== 'heading') result.push([`section-${field[0]}`, heading, '', 'heading']);
      result.push(field);
    });
    return result;
  }

  function sectionedFields(type, record, fields) {
    if (type === 'leases') return withSections(fields, { roomId: '租户信息', startDate: '租房日期', paymentMethod: '租金与费用', moveInElectricity: '入住读数与证件', note: '备注' });
    if (type === 'renewal') return withSections(fields, { roomNo: '租户信息', renewalDate: '本次续租', leaseStart: '租期信息', monthlyRent: '费用明细', note: '备注' });
    if (type === 'checkouts') return withSections(fields, { roomDisplay: '租户与租期', checkoutDate: '退房信息', waterHeading: '水费核算', electricityHeading: '电费核算', otherHeading: '退房扣除或返还项目', bankHeading: '收款信息', note: '备注' });
    if (type === 'rooms') return withSections(fields, { basicHeading: '基本信息', managementHeading: '托管信息', landlordContractType: '托管合同', note: '备注' });
    if (type === 'maintenance') return withSections(fields, { roomId: '维护信息', note: '说明与凭证' });
    if (type === 'items') return withSections(fields, { roomId: '物品信息' });
    if (type === 'costs' || type === 'ledger') return withSections(fields, { roomId: '收支信息', direction: '收支信息' });
    return fields;
  }

  function batchItemRow(index) {
    return `<div class="batch-item-row" data-batch-item-row><label>物品名称<input data-batch-item-name placeholder="例如：衣柜" /></label><label>数量<input data-batch-item-quantity type="number" min="1" step="1" value="1" /></label><label>物品备注<input data-batch-item-note placeholder="品牌、状态等" /></label><label>物品照片<input data-batch-item-image type="file" accept="image/jpeg,image/png,image/webp" /></label><button class="small danger" type="button" data-remove-batch-item aria-label="删除第${index + 1}行">删除</button></div>`;
  }

  function renderBatchItems(record) {
    const room = roomFor(record);
    const roomValue = room?.id || record.roomId || record.roomNo || '';
    const options = roomOptions(roomValue, true).split('|').map((option) => { const [value, text] = option.split(':'); return `<option value="${esc(value)}" ${String(value) === String(roomValue) ? 'selected' : ''}>${text}</option>`; }).join('');
    $('#dialog-fields').className = 'dialog-fields dialog-items batch-items-form';
    $('#dialog-fields').innerHTML = `<label class="full">小区/房间<select name="batchRoomId">${options}</select></label><div class="batch-item-head"><span>物品名称</span><span>数量</span><span>物品备注</span><span>物品照片</span><span>操作</span></div><div id="batch-item-rows">${batchItemRow(0)}${batchItemRow(1)}</div><button class="small batch-item-add" type="button" data-add-batch-item>+ 继续添加物品</button>`;
  }

  fieldsFor = function (type, record = {}) {
    if (type === 'leases') return leaseFields(record);
    if (type === 'renewal') return renewalFields(record);
    if (type === 'checkouts') return checkoutFields(record);
    const fields = legacyFieldsFor(type, record);
    if (!['maintenance', 'costs', 'items', 'ledger', 'rooms'].includes(type)) return fields;
    const room = roomFor(record);
    return fields.map((field) => {
      if (field[0] === 'roomNo' && type !== 'rooms') return ['roomId', field[1], room?.id || '', 'select', roomOptions(room?.id || record.roomNo, true)];
      if (type === 'maintenance' && record.maintenanceType === 'remove' && field[0] === 'item') return [field[0], field[1], field[2], field[3], itemOptions(room?.roomNo || '')];
      return field;
    });
  };

  renderFields = function (type, record) {
    const fields = $('#dialog-fields');
    fields.className = `dialog-fields dialog-${type}`;
    fields.innerHTML = sectionedFields(type, record, fieldsFor(type, record)).map(([key, label, value, inputType, options]) => {
      const full = inputType === 'textarea' || inputType === 'file' || inputType === 'pdf' || inputType === 'url' || inputType === 'heading' || inputType === 'json';
      const summary = (type === 'renewal' && ['roomNo', 'tenantName', 'tenantPhone', 'leaseStart', 'startDate', 'endDate', 'amount'].includes(key)) || (type === 'checkouts' && ['roomNo', 'tenantName', 'tenantPhone', 'leaseStart', 'leaseEnd', 'paidThrough'].includes(key));
      const className = `${full ? 'full ' : ''}field-${key}${inputType === 'readonly' || key.endsWith('Amount') || key === 'amount' ? ' calculated-field' : ''}${summary ? ' summary-field' : ''}`;
      const fieldLabel = `<span class="field-label">${esc(label)}</span>`;
      if (inputType === 'heading') return `<div class="${className} form-section-heading"><span>${esc(label)}</span></div>`;
      if (options === 'hidden' || (type === 'renewal' && key === 'amount')) return `<input type="hidden" name="${key}" value="${esc(value)}" />`;
      if (inputType === 'json') return `<label class="${className}">${fieldLabel}<div id="checkout-other-items"></div><button type="button" class="small" data-add-other-item>+ 新增扣除或返还项目</button><input type="hidden" name="${key}" value="${esc(JSON.stringify(value || []))}" /></label>`;
      if (inputType === 'select') return `<label class="${className}">${fieldLabel}<select name="${key}">${(options || '').split('|').map((option) => { const [optionValue, text] = option.split(':'); return `<option value="${esc(optionValue)}" ${String(optionValue) === String(value) ? 'selected' : ''}>${esc(text || optionValue)}</option>`; }).join('')}</select></label>`;
      if (inputType === 'textarea') return `<label class="${className}">${fieldLabel}<textarea name="${key}">${esc(value)}</textarea></label>`;
      if (inputType === 'file') { const existingImages = Array.isArray(record[key]) ? record[key] : (record[key] ? [record[key]] : []); const preview = existingImages.length ? existingImages.map((image) => `<img class="upload-preview item-preview-trigger" src="${esc(image)}" data-preview-image="${esc(image)}" alt="已上传图片，点击可预览" />`).join('') : '<span class="meta">未上传</span>'; return `<label class="${className}">${fieldLabel}<input name="${key}" type="file" accept="image/jpeg,image/png,image/webp" data-existing="${esc(JSON.stringify(record[key] || ''))}" />${preview}</label>`; }
      if (inputType === 'pdf') { const link = value ? `<a class="contract-file-link" href="${esc(value)}" target="_blank" rel="noopener">查看当前 PDF 合同</a>` : '<span class="meta">未上传</span>'; return `<label class="${className}" data-contract-field="paper">${fieldLabel}<input name="${key}" type="file" accept="application/pdf" data-existing="${esc(JSON.stringify(value || ''))}" />${link}<small>仅支持 PDF，最大 10MB；重新上传会替换当前合同</small></label>`; }
      if (inputType === 'url') return `<label class="${className}" data-contract-field="electronic">${fieldLabel}<input name="${key}" type="url" value="${esc(value)}" placeholder="https://..." />${value ? `<a class="contract-file-link" href="${esc(value)}" target="_blank" rel="noopener">打开电子合同</a>` : ''}</label>`;
      if (inputType === 'readonly') { const display = value === 0 ? '0' : (value || '未设置'); return `<div class="${className} readonly-field"><span class="field-label">${esc(label)}</span><strong data-readonly-value="${esc(key)}">${esc(display)}</strong><input type="hidden" name="${key}" value="${esc(value)}" /></div>`; }
      return `<label class="${className}">${fieldLabel}<input name="${key}" type="${inputType === 'date' ? 'date' : 'text'}" value="${esc(value)}" /></label>`;
    }).join('');
    if (type === 'checkouts') renderCheckoutOtherItems(record.otherItems || []);
    if (type === 'rooms') updateRoomContractFields();
    renderDialogInventory(type, record);
  };

  function updateRoomContractFields() {
    const type = $('#dialog-fields [name="landlordContractType"]')?.value || '';
    document.querySelectorAll('[data-contract-field]').forEach((field) => { field.hidden = field.dataset.contractField !== type; });
  }

  function syncOtherItems() { const rows = [...document.querySelectorAll('[data-other-item-row]')].map((row) => ({ item: row.querySelector('[data-other-item]')?.value.trim() || '', amount: row.querySelector('[data-other-amount]')?.value || 0, mode: row.querySelector('[data-other-mode]')?.value === 'refund' ? 'refund' : 'deduct' })).filter((row) => row.item || Number(row.amount)); const field = $('#dialog-fields [name="otherItems"]'); if (field) field.value = JSON.stringify(rows); return rows; }
  function renderCheckoutOtherItems(items = []) { const container = $('#checkout-other-items'); if (!container) return; const rows = items.length ? items : [{ item: '', amount: '', mode: 'deduct' }]; container.innerHTML = rows.map((row, index) => `<div class="other-item-row" data-other-item-row><input data-other-item value="${esc(row.item || '')}" placeholder="项目说明" /><select data-other-mode aria-label="项目类型"><option value="deduct" ${row.mode === 'refund' ? '' : 'selected'}>扣除</option><option value="refund" ${row.mode === 'refund' ? 'selected' : ''}>返还</option></select><input data-other-amount inputmode="decimal" value="${esc(row.amount ?? '')}" placeholder="金额" /><button type="button" class="small danger" data-remove-other-item="${index}">删除</button></div>`).join(''); syncOtherItems(); }

  collectDialog = async function () {
    if (batchItemMode && state.recordType === 'items') {
      const batchItems = [];
      for (const row of document.querySelectorAll('[data-batch-item-row]')) {
        const name = row.querySelector('[data-batch-item-name]')?.value.trim() || '';
        const quantity = Math.max(1, Math.trunc(Number(row.querySelector('[data-batch-item-quantity]')?.value || 1) || 1));
        const note = row.querySelector('[data-batch-item-note]')?.value.trim() || '';
        const file = row.querySelector('[data-batch-item-image]');
        if (!name && !note && !file?.files?.length) continue;
        if (!name) throw new Error('请填写每一项物品的名称');
        batchItems.push({ name, quantity, note, image: file?.files?.length ? await readFileInput(file) : '' });
      }
      if (!batchItems.length) throw new Error('请至少添加一项物品');
      return { roomId: $('#dialog-fields [name="batchRoomId"]')?.value || '', batchItems };
    }
    syncOtherItems();
    return legacyCollectDialog();
  };
  handleMaintenanceItemLink = async function (data) {
    const room = state.rooms.find((item) => item.id === data.roomId) || state.rooms.find((item) => item.roomNo === data.roomNo);
    return legacyHandleMaintenanceItemLink({ ...data, roomId: room?.id || data.roomId || '', roomNo: room?.roomNo || data.roomNo || '' });
  };
  openDialog = function (type, id = '', roomNo = '', seed = {}) {
    if ((type === 'leases' || type === 'items' || type === 'ledger') && !visible(state.rooms).length) { alert('请先在房间管理中创建房间'); return; }
    state.recordType = type; state.recordId = id; batchItemMode = type === 'items' && !id;
    const existing = (state[type] || []).find((item) => item.id === id);
    const room = state.rooms.find((item) => item.id === seed.roomId || (!seed.roomId && item.roomNo === roomNo));
    const record = existing || { roomId: room?.id || seed.roomId || '', roomNo: room?.roomNo || roomNo, ...seed };
    const lease = room ? leaseForRoom(room) : (roomNo ? leaseForRoom(roomNo) : null);
    if (type === 'leases' && !id) { record._new = true; record._propertyFeeMode = room?.propertyFeeMode || 'included'; record._roomMonthlyPropertyFee = room?.monthlyPropertyFee || 0; }
    if (type === 'renewal' && lease) { const previousEnd = lease.paidThrough || renewalsForLease(lease.id).filter((item) => item.endDate).sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)))[0]?.endDate || ''; record.leaseId = lease.id; record.roomNo = room?.roomNo || lease.roomNo; record.tenantName = lease.tenantName; record.tenantPhone = lease.tenantPhone; record.leaseStart = lease.startDate; record.monthlyRent = lease.monthlyRent; record.monthlyPropertyFee = lease.monthlyPropertyFee || 0; record.startDate = previousEnd ? addDays(previousEnd, 1) : (lease.startDate || ''); record.paymentMethod = lease.paymentMethod; }
    if (type === 'checkouts' && lease && !id) Object.assign(record, { leaseId: lease.id, roomId: lease.roomId || room?.id || '', tenantName: lease.tenantName, tenantPhone: lease.tenantPhone, leaseStart: lease.startDate, leaseEnd: lease.endDate, paidThrough: lease.paidThrough, deposit: lease.deposit, waterStart: lease.moveInWater, electricityStart: lease.moveInElectricity, waterUnitPrice: state.settings.waterUnitPrice, electricityUnitPrice: state.settings.electricityUnitPrice });
    const initialPayment = type === 'renewal' && lease && !lease.paidThrough && !renewalsForLease(lease.id).length;
    state.initialPayment = initialPayment;
    if (type === 'renewal') record._initialPayment = initialPayment;
    $('#dialog-title').textContent = type === 'renewal' ? (initialPayment ? '首次缴费' : '租户续费') : `${id ? '编辑' : '新增'}${type === 'leases' ? '入住记录' : type === 'checkouts' ? '退房清单' : type === 'maintenance' ? '维护记录' : type === 'rooms' ? '房间' : type === 'items' ? '房间物品' : type === 'costs' ? '成本记录' : '收支流水'}`;
    const submitLabels = { renewal: initialPayment ? '首次缴费' : '续费', checkouts: '退房', maintenance: '保存维护', rooms: '保存房间', items: batchItemMode ? '添加物品' : '保存物品', costs: '保存成本', ledger: '保存流水' }; $('#record-form button[type="submit"]').textContent = type === 'leases' ? (id ? '保存信息' : '入住') : (submitLabels[type] || '保存');
    if (batchItemMode) renderBatchItems(record); else renderFields(type, record); const checkoutTempSave = $('#checkout-temp-save'); if (checkoutTempSave) checkoutTempSave.hidden = type !== 'checkouts'; const checkoutCancel = $('#record-cancel'); if (checkoutCancel) checkoutCancel.textContent = type === 'checkouts' ? '取消退房' : '取消'; checkoutSubmitMode = 'completed'; $('#dialog-error').textContent = ''; const dialog = $('#record-dialog'); dialog.classList.toggle('checkout-dialog', type === 'checkouts'); dialog.classList.toggle('lease-dialog', type === 'leases'); dialog.classList.toggle('renewal-dialog', type === 'renewal'); dialog.classList.toggle('batch-items-dialog', batchItemMode); ['rooms', 'maintenance', 'items', 'costs', 'ledger'].forEach((name) => dialog.classList.toggle(`${name}-dialog`, type === name)); const checkoutSummary = $('#checkout-refund-summary'); if (checkoutSummary) { checkoutSummary.hidden = !['checkouts', 'renewal'].includes(type); checkoutSummary.classList.toggle('renewal-payment-summary', type === 'renewal'); } $('#generate-dialog-text').hidden = batchItemMode; dialog.showModal();
    if (type === 'renewal') updateRenewalAmount(); if (type === 'checkouts') updateCheckoutAmounts();
  };

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-add-batch-item]')) {
      const rows = $('#batch-item-rows');
      rows?.insertAdjacentHTML('beforeend', batchItemRow(rows.children.length));
      rows?.lastElementChild?.querySelector('[data-batch-item-name]')?.focus();
      return;
    }
    const remove = event.target.closest('[data-remove-batch-item]');
    if (!remove) return;
    const rows = $('#batch-item-rows');
    if (rows?.children.length === 1) {
      remove.closest('[data-batch-item-row]')?.querySelectorAll('input').forEach((input) => { input.value = ''; });
      return;
    }
    remove.closest('[data-batch-item-row]')?.remove();
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('[name="landlordContractType"]')) updateRoomContractFields();
  });

  function setDialogValue(key, value) {
    const text = String(value ?? '');
    const input = document.querySelector(`#dialog-fields [name="${key}"]`);
    if (input) input.value = text;
    document.querySelectorAll(`[data-readonly-value="${key}"]`).forEach((node) => { node.textContent = text || '未设置'; });
  }

  updateRenewalAmount = function () { if (state.recordType !== 'renewal') return; const preset = $('#dialog-fields [name="durationPreset"]')?.value || '1month'; const days = Number($('#dialog-fields [name="durationValue"]')?.value || 30); const rent = Number($('#dialog-fields [name="monthlyRent"]')?.value || 0); const fee = Number($('#dialog-fields [name="monthlyPropertyFee"]')?.value || 0); const deposit = state.initialPayment ? Number($('#dialog-fields [name="deposit"]')?.value || 0) : 0; const months = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 }; const periodAmount = preset === 'days' ? (rent + fee) / 30 * days : (rent + fee) * (months[preset] || 1); const amount = periodAmount + deposit; const start = $('#dialog-fields [name="startDate"]')?.value || today(); const end = preset === 'days' ? addDays(start, days - 1) : addDays(addMonthsClamped(start, months[preset] || 1), -1); if ($('#dialog-fields [name="amount"]')) $('#dialog-fields [name="amount"]').value = amount.toFixed(2).replace(/\.00$/, ''); if ($('#dialog-fields [name="endDate"]')) $('#dialog-fields [name="endDate"]').value = end; const dayField = $('#dialog-fields [name="durationValue"]')?.closest('label'); const presetField = $('#dialog-fields [name="durationPreset"]')?.closest('label'); if (dayField) { dayField.style.display = preset === 'days' ? '' : 'none'; dayField.style.gridColumn = '3'; } if (presetField) presetField.style.gridColumn = preset === 'days' ? '2' : '2 / -1'; const summary = $('#checkout-refund-summary'); if (summary) { summary.hidden = false; summary.innerHTML = `<div class="refund-summary-title"><span>应收费用</span><strong>${amount.toFixed(1).replace(/\.0$/, '')}元</strong></div><div class="refund-summary-grid"><span>房租：${rent.toFixed(1).replace(/\.0$/, '')}元 × ${preset === 'days' ? `${days}天` : `${months[preset] || 1}个月`}</span><span>物业费：${fee.toFixed(1).replace(/\.0$/, '')}元 × ${preset === 'days' ? `${days}天` : `${months[preset] || 1}个月`}</span>${state.initialPayment ? `<span>押金：${deposit.toFixed(1).replace(/\.0$/, '')}元</span>` : ''}<span>本次合计：${amount.toFixed(1).replace(/\.0$/, '')}元</span></div>`; } };

  // Rebind the amount updater after the legacy assignment so readonly summary fields stay in sync.
  updateRenewalAmount = function () {
    if (state.recordType !== 'renewal') return;
    const preset = $('#dialog-fields [name="durationPreset"]')?.value || '1month';
    const days = Number($('#dialog-fields [name="durationValue"]')?.value || 30);
    const rent = Number($('#dialog-fields [name="monthlyRent"]')?.value || 0);
    const fee = Number($('#dialog-fields [name="monthlyPropertyFee"]')?.value || 0);
    const deposit = state.initialPayment ? Number($('#dialog-fields [name="deposit"]')?.value || 0) : 0;
    const months = { '1month': 1, '3months': 3, '6months': 6, '1year': 12 };
    const periodAmount = preset === 'days' ? (rent + fee) / 30 * days : (rent + fee) * (months[preset] || 1);
    const amount = periodAmount + deposit;
    const start = $('#dialog-fields [name="startDate"]')?.value || today();
    const end = preset === 'days' ? addDays(start, days - 1) : addDays(addMonthsClamped(start, months[preset] || 1), -1);
    setDialogValue('amount', amount.toFixed(2).replace(/\.00$/, ''));
    setDialogValue('endDate', end);
    const dayField = $('#dialog-fields [name="durationValue"]')?.closest('label');
    const presetField = $('#dialog-fields [name="durationPreset"]')?.closest('label');
    if (dayField) { dayField.style.display = preset === 'days' ? '' : 'none'; dayField.style.gridColumn = '3'; }
    if (presetField) presetField.style.gridColumn = preset === 'days' ? '2' : '2 / -1';
    const summary = $('#checkout-refund-summary');
    if (summary) {
      summary.hidden = false;
      const unit = preset === 'days' ? `${days}天` : `${months[preset] || 1}个月`;
      const format = (value) => Number(value).toFixed(1).replace(/\.0$/, '');
      summary.innerHTML = `<div class="refund-summary-title"><span>应收费用</span><strong>${format(amount)}元</strong></div><div class="refund-summary-grid"><span>房租：${format(rent)}元 × ${unit}</span><span>物业费：${format(fee)}元 × ${unit}</span>${state.initialPayment ? `<span>押金：${format(deposit)}元</span>` : ''}<span>本次合计：${format(amount)}元</span></div>`;
    }
  };

  function updateLeaseTotals() {
    if (state.recordType !== 'leases') return;
    const mode = $('#dialog-fields [name="propertyFeeMode"]')?.value;
    const roomId = $('#dialog-fields [name="roomId"]')?.value;
    const room = state.rooms.find((item) => item.id === roomId);
    const fee = mode === 'tenant_self' ? 0 : Number(room?.monthlyPropertyFee || 0);
    setDialogValue('monthlyPropertyFee', fee);
    setDialogValue('totalMonthly', Number($('#dialog-fields [name="monthlyRent"]')?.value || 0) + fee);
  }

  updateCheckoutAmounts = function () {
    if (state.recordType !== 'checkouts') return;
    const startWater = Number($('#dialog-fields [name="waterStart"]')?.value || 0); const endWater = Number($('#dialog-fields [name="waterEnd"]')?.value || 0); const waterPrice = Number($('#dialog-fields [name="waterUnitPrice"]')?.value || state.settings.waterUnitPrice || 0);
    const startElectricity = Number($('#dialog-fields [name="electricityStart"]')?.value || 0); const endElectricity = Number($('#dialog-fields [name="electricityEnd"]')?.value || 0); const electricityPrice = Number($('#dialog-fields [name="electricityUnitPrice"]')?.value || state.settings.electricityUnitPrice || 0);
    const water = Math.max(0, Math.round((endWater - startWater) * waterPrice * 10) / 10); const electricity = Math.round((startElectricity - endElectricity) * electricityPrice * 10) / 10; const otherRows = syncOtherItems(); const other = otherRows.reduce((sum, row) => sum + (row.mode === 'refund' ? -Number(row.amount || 0) : Number(row.amount || 0)), 0); const deposit = Number($('#dialog-fields [name="deposit"]')?.value || 0); const refund = Math.round((deposit - water - electricity - other) * 10) / 10;
    const checkoutDate = $('#dialog-fields [name="checkoutDate"]')?.value || ''; if (checkoutDate) setDialogValue('leaseEnd', checkoutDate);
    setDialogValue('waterAmount', water.toFixed(1)); setDialogValue('electricityAmount', electricity.toFixed(1)); setDialogValue('refundAmount', refund.toFixed(1));
    const electricityDetail = electricity < 0 ? `<span class="income-text">电费返还：${Math.abs(electricity).toFixed(1)}元</span>` : `<span class="expense-text">电费扣除：${electricity.toFixed(1)}元</span>`;
    const otherDetail = otherRows.filter((row) => row.item || Number(row.amount)).map((row) => `<span class="${row.mode === 'refund' ? 'income-text' : 'expense-text'}">${row.mode === 'refund' ? '返还' : '扣除'}：${esc(row.item || '其他项目')} ${Number(row.amount || 0).toFixed(1)}元</span>`).join('');
    const summary = $('#checkout-refund-summary'); if (summary) { summary.hidden = false; summary.innerHTML = `<div class="refund-summary-title">应退费用 <strong>${refund.toFixed(1)}元</strong></div><div class="refund-summary-grid"><span>押金：${deposit.toFixed(1)}元</span><span class="expense-text">水费扣除：${water.toFixed(1)}元</span><span>${electricityDetail}</span>${otherDetail}</div>`; }
  };

  function remainingText(days) { if (days === null) return '剩余时间未设置'; return days < 0 ? `已逾期${Math.abs(days)}天` : `剩余${days}天`; }
  renderRooms = function () {
    const reminderDays = Number(state.settings.reminderDays ?? 10);
    const purposeLabels = { self: '自住', studio: '工作室', homestay: '民宿', other: '其他' };
    const rooms = sortRentalRooms(visible(state.rooms), reminderDays);
    $('#room-list').innerHTML = rooms.length ? rooms.map((room) => {
      const lease = leaseForRoom(room);
      const maintenance = room.status === 'maintenance' && !lease;
      const occupied = Boolean(lease);
      const days = lease ? daysUntil(dueDate(lease)) : null;
      const expiring = occupied && days !== null && days >= 0 && days <= reminderDays;
      const cardClass = maintenance ? 'room-maintenance' : expiring ? 'room-expiring' : occupied ? 'room-occupied' : 'room-vacant';
      const status = maintenance ? '装修维护中' : expiring ? '即将到期' : occupied ? '已租出' : '空置';
      const roomTitle = `${esc(room.propertyName || '房间')} · ${esc(room.roomNo)}`;
      const dayLabel = days === null ? '' : `<strong class="room-card-days">${days < 0 ? `已逾期${Math.abs(days)}天` : `剩余${days}天`}</strong>`;
      const payment = lease ? paymentLabel(lease.paymentMethod || lease.billingCycle) : '';
      const rentAndFee = lease ? Number(lease.monthlyRent || 0) + Number(lease.monthlyPropertyFee || 0) : 0;
      const purpose = lease ? (purposeLabels[lease.purpose] || lease.purpose || '未设置') : '';
      const deposit = lease && lease.deposit !== '' && lease.deposit !== undefined ? ` · 押金：${money(lease.deposit)}` : '';
      return `<article class="room-card ${cardClass}">
        <div class="room-card-head"><strong>${roomTitle}</strong><div class="room-card-head-meta"><span class="room-status">${status}</span>${dayLabel}</div></div>
        ${lease ? `<div class="room-tenant">租户：${esc(lease.tenantName || '未填写')} · ${esc(lease.tenantPhone || '未填写')} · ${esc(purpose)}${deposit}</div><div class="room-payment-row"><div><span>缴费方式</span><strong>${esc(payment)} · ${money(rentAndFee)}</strong></div><div><span>入住时间</span><strong>${esc(lease.startDate || '未设置')}</strong></div><div><span>交费至</span><strong>${esc(dueDate(lease) || '未设置')}</strong></div></div>` : `<div class="room-vacant-note">当前无在租租户</div>`}
        <div class="room-actions"><button class="small room-admin-link" data-show-room-maintenance="${esc(room.roomNo)}">房间维护</button>${lease ? `<button class="small" data-edit="leases" data-id="${lease.id}">租户信息</button><button class="small" data-action="add-lease" data-room-no="${esc(room.roomNo)}" data-room-id="${esc(room.id)}">续费</button><button class="small" data-action="add-checkout" data-room-no="${esc(room.roomNo)}" data-room-id="${esc(room.id)}">退房</button>` : `<button class="small" data-action="add-lease" data-room-no="${esc(room.roomNo)}" data-room-id="${esc(room.id)}">新增入住</button>`}</div>
      </article>`;
    }).join('') : '<p class="meta">请先添加房间</p>';
  };
  renderLeases = function () { const container = $('#lease-list'); if (!container) return; const list = state.leases.filter((lease) => lease.status === 'active' && !lease.archivedAt); container.innerHTML = list.length ? list.map((lease) => `<div class="lease-card"><div><strong>${esc(roomLabel(lease.roomNo))}</strong><div class="meta">${esc(lease.tenantName || '未填写租户')} · ${esc(lease.tenantPhone || '')}</div><div class="meta">入住时间：${esc(lease.startDate || '未设置')}</div></div><div><span class="meta">月租+物业</span><div class="money">${money(Number(lease.monthlyRent) + Number(lease.monthlyPropertyFee))}</div></div><div class="lease-due"><span class="meta">交费至</span><strong>${esc(dueDate(lease) || '未设置')}</strong><div class="meta">${remainingText(daysUntil(dueDate(lease)))}</div></div><div class="row-actions"><button class="small" data-show-renewals="${lease.id}">续费记录</button><button class="small" data-edit="leases" data-id="${lease.id}">租户信息</button></div></div>`).join('') : '<p class="meta">暂无在租记录</p>'; };
  renderTenants = function () { const list = state.leases.filter((lease) => !lease.archivedAt); const card = (lease) => `<div class="lease-card tenant-card"><div><strong class="renewal-link" data-show-renewals="${lease.id}">${esc(lease.tenantName || '未填写租户')}</strong><div class="meta">${esc(roomLabel(lease.roomNo))} · ${esc(lease.tenantPhone || '')}</div></div><div class="tenant-dates"><span class="meta">交费至</span><strong>${esc(dueDate(lease) || '未设置')}</strong><div>${remainingText(daysUntil(dueDate(lease)))}</div><span class="meta">入住：${esc(lease.startDate || '未设置')} · 已入住${occupiedMonths(lease.startDate, lease.status === 'active' ? today() : (lease.endDate || today()))}个月</span></div><div><span class="meta">住房目的 / 支付方式</span><div>${({ self: '自住', studio: '工作室', homestay: '民宿', other: '其他' }[lease.purpose] || lease.purpose || '未设置')} · ${paymentLabel(lease.paymentMethod || lease.billingCycle)}</div></div><div><span class="meta">状态</span><div>${lease.status === 'active' ? '在租' : '已退租'}</div></div><div class="row-actions"><button class="small" data-show-renewals="${lease.id}">续费记录</button><button class="small" data-edit="leases" data-id="${lease.id}">租户信息</button>${lease.status === 'active' ? '' : '<button class="small danger" data-delete="leases" data-id="' + lease.id + '">归档</button>'}</div></div>`; const group = (title, rows) => `<section class="tenant-group"><h3>${title}（${rows.length}）</h3>${rows.length ? rows.map(card).join('') : '<p class="meta">暂无记录</p>'}</section>`; $('#tenant-list').innerHTML = group('在租租户', list.filter((lease) => lease.status === 'active')) + group('已退租租户', list.filter((lease) => lease.status !== 'active')); };

  renderTenants = function () {
    const list = state.leases.filter((lease) => !lease.archivedAt);
    const checkoutForLease = (lease) => state.checkouts.filter((item) => !item.archivedAt && item.status !== 'draft' && (item.leaseId === lease.id || (!item.leaseId && item.roomNo === lease.roomNo && (!item.tenantPhone || item.tenantPhone === lease.tenantPhone)))).sort((a, b) => String(b.checkoutDate || '').localeCompare(String(a.checkoutDate || '')))[0];
    const card = (lease) => {
      const ended = lease.status !== 'active';
      const depositStatus = ended ? (lease.depositStatus === 'refunded' ? '已退租退押金' : '未退押金') : '在租';
      const refundButton = ended && lease.depositStatus !== 'refunded' ? `<button class="small danger" data-refund-deposit="${lease.id}">押金已退</button>` : '';
      const checkout = ended ? checkoutForLease(lease) : null;
      const primaryDateLabel = ended ? '退租时间' : '交费至';
      const primaryDate = ended ? (checkout?.checkoutDate || '未设置') : (dueDate(lease) || '未设置');
      const primaryDateMeta = ended ? '' : `<div>${remainingText(daysUntil(dueDate(lease)))}</div>`;
      const occupiedEnd = ended ? (checkout?.checkoutDate || lease.endDate || today()) : today();
      return `<div class="lease-card tenant-card"><div><strong class="renewal-link" data-show-renewals="${lease.id}">${esc(lease.tenantName || '未填写租户')}</strong><div class="meta">${esc(roomLabel(lease.roomNo))} · ${esc(lease.tenantPhone || '')}</div></div><div class="tenant-dates"><span class="meta">${primaryDateLabel}</span><strong>${esc(primaryDate)}</strong>${primaryDateMeta}<span class="meta">入住：${esc(lease.startDate || '未设置')} · 已入住${occupiedMonths(lease.startDate, occupiedEnd)}个月</span></div><div><span class="meta">住房目的 / 支付方式</span><div>${({ self: '自住', studio: '工作室', homestay: '民宿', other: '其他' }[lease.purpose] || lease.purpose || '未设置')} · ${paymentLabel(lease.paymentMethod || lease.billingCycle)}</div></div><div><span class="meta">状态</span><div class="${ended && lease.depositStatus !== 'refunded' ? 'expense-text' : ended ? 'income-text' : ''}">${depositStatus}</div></div><div class="row-actions"><button class="small" data-show-renewals="${lease.id}">续费记录</button><button class="small" data-edit="leases" data-id="${lease.id}">租户信息</button>${refundButton}${ended ? '<button class="small danger" data-delete="leases" data-id="' + lease.id + '">归档</button>' : ''}</div></div>`;
    };
    const group = (title, rows) => `<section class="tenant-group"><h3>${title}（${rows.length}）</h3>${rows.length ? rows.map(card).join('') : '<p class="meta">暂无记录</p>'}</section>`;
    $('#tenant-list').innerHTML = group('在租租户', list.filter((lease) => lease.status === 'active')) + group('已退租租户', list.filter((lease) => lease.status !== 'active'));
  };

  renderRoomItems = function () {
    const groups = new Map();
    state.items.filter((item) => !item.archivedAt).forEach((item) => { if (!groups.has(item.roomNo)) groups.set(item.roomNo, []); groups.get(item.roomNo).push(item); });
const rows = [...groups.entries()].map(([roomNo, items]) => [roomLabel(roomNo), `<div class="item-chip-list">${items.map((item) => `<span class="item-chip"><strong>${esc(item.name)} × ${esc(Number(item.quantity || 1))}</strong>${item.note ? `：${esc(item.note)}` : ''}${item.image ? ` <img class="item-thumb item-preview-trigger" src="${esc(item.image)}" data-preview-image="${esc(item.image)}" alt="${esc(item.name)}" />` : ''}</span>`).join('')}</div>`, items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1) || 1), 0), `<button class="small" data-show-room-items="${esc(roomNo)}">查看清单</button>`]);
    $('#items-list').innerHTML = table(['小区/房间', '当前物品', '数量', '操作'], rows);
  };

  renderLedger = function () {
    const roomSelect = $('#ledger-room'); if (!roomSelect) return;
    const selected = roomSelect.value; roomSelect.innerHTML = '<option value="">全部房间</option>' + visible(state.rooms).filter((room) => room.roomNo).map((room) => `<option value="${esc(room.roomNo)}">${esc(roomLabel(room.roomNo))}</option>`).join(''); roomSelect.value = selected;
    const start = $('#ledger-start').value; const end = $('#ledger-end').value; const room = roomSelect.value;
    const list = state.ledger.filter((item) => !item.archivedAt && (!start || item.recordDate >= start) && (!end || item.recordDate <= end) && (!room || item.roomNo === room));
    const labels = { rent: '租金', otherIncome: '其他收入', landlordRent: '托管房租', maintenance: '维护维修', depositRefund: '押金退还', otherExpense: '其他支出' };
    const income = list.filter((item) => item.direction === 'income').reduce((sum, item) => sum + Number(item.amount || 0), 0); const expense = list.filter((item) => item.direction === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const pending = state.maintenance.filter((item) => !item.archivedAt && item.status === 'pending' && (!room || item.roomNo === room) && (!start || item.maintenanceDate >= start) && (!end || item.maintenanceDate <= end));
    const reimbursing = state.maintenance.filter((item) => !item.archivedAt && item.status === 'done' && (!room || item.roomNo === room) && (!start || item.maintenanceDate >= start) && (!end || item.maintenanceDate <= end));
    $('#ledger-summary').innerHTML = `<div class="income-summary summary-card"><span>收入</span><strong>${money(income)}</strong></div><div class="expense-summary summary-card"><span>支出</span><strong>${money(expense)}</strong></div><div class="balance-summary summary-card"><span>结余</span><strong>${money(income - expense)}</strong></div><div class="pending-summary summary-card"><span>待支出费用</span><strong>${money(pending.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong><small>${pending.length} 条待处理维护</small></div><div class="pending-summary summary-card"><span>待报销费用</span><strong>${money(reimbursing.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong><small>${reimbursing.length} 条待完成报销维护</small></div>`;
    const ledgerRows = list.map((item) => { const incomeRow = item.direction === 'income'; const sourceMaintenance = item.sourceType === 'maintenance' ? state.maintenance.find((maintenance) => maintenance.id === item.sourceId) : null; const note = sourceMaintenance ? [sourceMaintenance.item, sourceMaintenance.note].filter((part, index, parts) => part && (index === 0 || part !== parts[0])).join('·') : (item.note || ''); return [`<span class="${incomeRow ? 'income-text' : 'expense-text'}">${item.recordDate}</span>`, roomLabel(item.roomNo), `<span class="${incomeRow ? 'income-text' : 'expense-text'}">${incomeRow ? '收入' : '支出'}</span>`, labels[item.category] || item.category, `<span class="${incomeRow ? 'income-text' : 'expense-text'}">${money(item.amount)}</span>`, esc(note), `<button class="small" data-edit="ledger" data-id="${item.id}">编辑</button><button class="small danger" data-delete="ledger" data-id="${item.id}">归档</button>`]; });
    $('#ledger-list').innerHTML = table(['日期', '房间', '方向', '分类', '金额', '备注', '操作'], ledgerRows);
  };

  renderStats = function () {
    const rooms = visible(state.rooms); $('#stat-rooms').textContent = rooms.length; $('#stat-occupied').textContent = state.leases.filter((lease) => lease.status === 'active' && !lease.archivedAt).length; $('#stat-vacant').textContent = rooms.filter((room) => room.status === 'vacant' && !leaseForRoom(room)).length;
    const reminderDays = Number(state.settings.reminderDays ?? 10); const expiring = state.leases.filter((lease) => { const days = daysUntil(dueDate(lease)); return lease.status === 'active' && !lease.archivedAt && days !== null && days >= 0 && days <= reminderDays; }); const expiringElement = $('#stat-expiring'); if (expiringElement) expiringElement.textContent = expiring.length;
    const current = today(); const month = current.slice(0, 7); const year = current.slice(0, 4);
    const start = overviewFinanceFilter.mode === 'year' ? `${year}-01-01` : overviewFinanceFilter.mode === 'custom' ? overviewFinanceFilter.start : `${month}-01`;
    const end = overviewFinanceFilter.mode === 'year' ? `${year}-12-31` : overviewFinanceFilter.mode === 'custom' ? overviewFinanceFilter.end : current;
    const rows = state.ledger.filter((item) => !item.archivedAt && (!start || item.recordDate >= start) && (!end || item.recordDate <= end));
    const sum = (direction) => rows.filter((item) => item.direction === direction).reduce((total, item) => total + Number(item.amount || 0), 0); const income = sum('income'); const expense = sum('expense');
    const pendingRows = state.maintenance.filter((item) => !item.archivedAt && item.status === 'pending' && (!start || item.maintenanceDate >= start) && (!end || item.maintenanceDate <= end));
    const reimbursingRows = state.maintenance.filter((item) => !item.archivedAt && item.status === 'done' && (!start || item.maintenanceDate >= start) && (!end || item.maintenanceDate <= end));
    const pending = pendingRows.reduce((total, item) => total + Number(item.amount || 0), 0);
    const reimbursing = reimbursingRows.reduce((total, item) => total + Number(item.amount || 0), 0);
    const finance = $('#overview-finance'); if (finance) finance.innerHTML = `<div class="finance-item income"><span>收入</span><strong class="income-text">${money(income)}</strong></div><div class="finance-item expense"><span>支出</span><strong class="expense-text">${money(expense)}</strong></div><div class="finance-item balance"><span>结余</span><strong>${money(income - expense)}</strong></div><div class="finance-item pending"><span>待支出费用</span><strong class="pending-text">${money(pending)}</strong><small>${pendingRows.length} 条待处理维护</small></div><div class="finance-item pending"><span>待报销费用</span><strong class="pending-text">${money(reimbursing)}</strong><small>${reimbursingRows.length} 条待完成报销维护</small></div>`;
    document.querySelectorAll('[data-overview-finance-range]').forEach((button) => button.classList.toggle('active', button.dataset.overviewFinanceRange === overviewFinanceFilter.mode));
    const custom = document.getElementById('overview-finance-custom'); if (custom) custom.hidden = overviewFinanceFilter.mode !== 'custom';
    const startInput = document.getElementById('overview-finance-start'); const endInput = document.getElementById('overview-finance-end'); if (startInput && startInput.value !== overviewFinanceFilter.start) startInput.value = overviewFinanceFilter.start; if (endInput && endInput.value !== overviewFinanceFilter.end) endInput.value = overviewFinanceFilter.end;
  };

  renderTodo = function () {
    const maintenanceItems = state.maintenance.filter((item) => !item.archivedAt && item.status === 'pending').map((item) => `<button type="button" class="todo-card todo-link" data-todo-tab="maintenance"><div><strong>${esc(roomLabel(item.roomNo))} · ${esc(item.item || '维护')}</strong><span>维护待处理${item.note ? ` · ${esc(item.note)}` : ''}</span></div><b class="expense-text">${money(item.amount)}</b></button>`);
    const depositItems = state.leases.filter((lease) => !lease.archivedAt && lease.status !== 'active' && lease.depositStatus !== 'refunded').map((lease) => `<button type="button" class="todo-card todo-link" data-todo-tab="tenants"><div><strong>${esc(roomLabel(lease.roomNo))} · ${esc(lease.tenantName || '租户')}</strong><span>已退租，押金待退</span></div><b class="expense-text">${money(lease.depositRefundAmount || lease.deposit)}</b></button>`);
    const items = [...maintenanceItems, ...depositItems]; $('#todo-list').innerHTML = items.length ? items.join('') : '<p class="meta">暂无待处理事项</p>';
  };

  // Maintenance records use a compact batch editor for new entries and a detail editor for existing entries.
  let batchMaintenanceMode = false;
  let maintenanceBatchSelection = [];
  const maintenanceTypeLabels = { repair: '房间日常维护', new: '新增物品', remove: '删除物品' };
  const maintenanceStatusLabels = { pending: '待处理', done: '已完成待报销', reimbursed: '已报销' };
  const maintenanceStatusClass = (status) => status === 'reimbursed' ? 'status-reimbursed' : status === 'done' ? 'status-done' : 'status-pending';
  const normalizeMaintenanceText = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const maintenanceSimilarity = (left, right) => {
    const a = normalizeMaintenanceText(left); const b = normalizeMaintenanceText(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) rows[i][j] = a[i - 1] === b[j - 1] ? rows[i - 1][j - 1] : Math.min(rows[i - 1][j], rows[i][j - 1], rows[i - 1][j - 1]) + 1;
    const lev = 1 - rows[a.length][b.length] / Math.max(a.length, b.length);
    const shorter = a.length <= b.length ? a : b; const longer = a.length <= b.length ? b : a;
    let shared = 0; for (const char of new Set(shorter)) if (longer.includes(char)) shared += 1;
    return Math.max(lev, shared / new Set(shorter).size);
  };
  const maintenanceDateDistance = (left, right) => {
    const a = Date.parse(`${left || ''}T00:00:00`); const b = Date.parse(`${right || ''}T00:00:00`);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 86400000 : Infinity;
  };
  const sameMaintenanceRoom = (left, right) => (left.roomId && right.roomId ? String(left.roomId) === String(right.roomId) : String(left.roomNo || '') === String(right.roomNo || ''));
  function findMaintenanceDuplicates(candidates, ignoreIds = new Set()) {
    const history = state.maintenance.filter((item) => !item.archivedAt && !ignoreIds.has(item.id));
    const all = [...candidates.map((item) => ({ ...item, _candidate: true })), ...history];
    const matches = [];
    for (let i = 0; i < all.length; i += 1) {
      const left = all[i]; if (!left._candidate) continue;
      const leftText = `${left.item || ''}${left.note || ''}`; if (!normalizeMaintenanceText(leftText)) continue;
      for (let j = 0; j < all.length; j += 1) {
        const right = all[j]; if (right._candidate && i >= j) continue;
        if (!sameMaintenanceRoom(left, right) || maintenanceDateDistance(left.maintenanceDate, right.maintenanceDate) > 31) continue;
        const itemScore = maintenanceSimilarity(left.item, right.item);
        const noteScore = left.note && right.note ? maintenanceSimilarity(left.note, right.note) : 0;
        const combinedScore = maintenanceSimilarity(leftText, `${right.item || ''}${right.note || ''}`);
        if (combinedScore >= 0.55 || itemScore >= 0.72 || (noteScore >= 0.72 && itemScore >= 0.45)) matches.push({ candidate: left, existing: right });
      }
    }
    return matches;
  }
  const maintenanceDuplicateMessage = (matches) => {
    const lines = matches.slice(0, 4).map(({ candidate, existing }) => `· ${candidate.maintenanceDate || today()} ${candidate.item || '未填写事项'} ↔ ${existing.maintenanceDate || '历史记录'} ${existing.item || '未填写事项'}`);
    return `检测到同房间一个月内存在相似维护记录：\n${lines.join('\n')}${matches.length > 4 ? `\n· 另有 ${matches.length - 4} 条相似记录` : ''}\n\n仍要继续录入吗？`;
  };
  function collectMaintenanceCandidates() {
    if (batchMaintenanceMode) return [...document.querySelectorAll('[data-maint-row]')].map((row) => {
      const room = maintenanceRoom(row);
      return { roomId: room?.id || '', roomNo: room?.roomNo || '', maintenanceDate: row.querySelector('[data-maint-date]')?.value || today(), item: row.querySelector('[data-maint-item]')?.value.trim() || '', note: row.querySelector('[data-maint-note]')?.value.trim() || '' };
    }).filter((item) => item.roomId && (item.item || item.note));
    if (state.recordType !== 'maintenance') return [];
    const roomId = $('#dialog-fields [name="roomId"]')?.value || ''; const room = state.rooms.find((item) => String(item.id) === String(roomId));
    return [{ roomId, roomNo: room?.roomNo || '', maintenanceDate: $('#dialog-fields [name="maintenanceDate"]')?.value || today(), item: $('#dialog-fields [name="item"]')?.value.trim() || '', note: $('#dialog-fields [name="note"]')?.value.trim() || '' }];
  }
  const maintenanceRoomOptions = (selected = '') => state.rooms.filter((room) => !room.archivedAt).map((room) => `<option value="${esc(room.id)}" ${String(room.id) === String(selected) ? 'selected' : ''}>${esc(room.propertyName || '房间')} · ${esc(room.roomNo)}</option>`).join('');
  const maintenanceRoom = (row) => state.rooms.find((room) => String(room.id) === String(row.querySelector('[data-maint-room]')?.value || ''));
  const maintenanceItemOptions = (roomNo, selected = '') => state.items.filter((item) => item.roomNo === roomNo && !item.archivedAt).map((item) => `<option value="${esc(item.name)}" ${String(item.name) === String(selected) ? 'selected' : ''}>${esc(item.name)}</option>`).join('') || '<option value="">该房间暂无物品</option>';
  function maintenanceItemControl(roomNo, type, value = '') {
    return type === 'remove'
      ? `<select data-maint-item>${maintenanceItemOptions(roomNo, value)}</select>`
      : `<input data-maint-item value="${esc(value)}" placeholder="维护事项或物品名称" />`;
  }
  const maintenanceBatchUrl = (batchId) => {
    const prefix = location.pathname.startsWith('/loan/') ? '/loan' : '';
    return `${location.origin}${prefix}/zufang-reimbursements.html?batch=${encodeURIComponent(batchId)}`;
  };
  const maintenanceBatchName = (batchId) => (state.maintenanceBatches || []).find((batch) => batch.id === batchId && !batch.archivedAt)?.name || (batchId ? '已归档批次' : '');
  function maintenanceBatchOptions(selected = '') {
    const batches = (state.maintenanceBatches || []).filter((batch) => !batch.archivedAt);
    return ['<option value="">未选择</option>', ...batches.map((batch) => `<option value="${esc(batch.id)}" ${String(batch.id) === String(selected) ? 'selected' : ''}>${esc(batch.name || '未命名批次')}</option>`)].join('');
  }
  function maintenanceBatchRow(index, seed = {}) {
    const room = state.rooms.find((item) => String(item.id) === String(seed.roomId)) || state.rooms.find((item) => item.roomNo === seed.roomNo);
    const roomId = room?.id || '';
    const type = seed.maintenanceType || 'repair';
    return `<div class="maintenance-batch-row" data-maint-row>
      <div class="maintenance-row-index">${index + 1}</div>
      <label>小区/房间<select data-maint-room>${maintenanceRoomOptions(roomId)}</select></label>
      <label>维护日期<input data-maint-date type="date" value="${esc(seed.maintenanceDate || today())}" /></label>
      <label>维护类型<select data-maint-type><option value="repair" ${type === 'repair' ? 'selected' : ''}>房间日常维护</option><option value="new" ${type === 'new' ? 'selected' : ''}>新增物品</option><option value="remove" ${type === 'remove' ? 'selected' : ''}>删除物品</option></select></label>
      <label>维护事项/物品名称<span data-maint-item-wrap>${maintenanceItemControl(room?.roomNo || seed.roomNo || '', type, seed.item || '')}</span></label>
      <label>备注<input data-maint-note value="${esc(seed.note || '')}" placeholder="补充说明" /></label>
      <label>金额<input data-maint-amount inputmode="decimal" value="${esc(seed.amount ?? '')}" placeholder="0" /></label>
      <label class="maintenance-upload-field">维护前图片<input data-maint-before type="file" accept="image/jpeg,image/png,image/webp" /></label>
      <label class="maintenance-upload-field">维护后图片<input data-maint-after type="file" accept="image/jpeg,image/png,image/webp" /></label>
      <label class="maintenance-upload-field">付款截图<input data-maint-payment type="file" accept="image/jpeg,image/png,image/webp" /></label>
      <button type="button" class="small danger icon-button maintenance-row-remove" data-remove-maint-row title="删除本行" aria-label="删除本行"><iconify-icon icon="hugeicons:delete-02" aria-hidden="true"></iconify-icon></button>
    </div>`;
  }
  function renderMaintenanceBatch(record = {}) {
    const fields = $('#dialog-fields');
    fields.className = 'dialog-fields maintenance-batch-form';
    fields.innerHTML = `<div class="maintenance-batch-intro"><strong>批量新增维护</strong><span>每行一条记录，创建后状态统一为“待处理”；新增物品会同步到房间物品清单。</span></div><div id="maintenance-batch-rows">${maintenanceBatchRow(0, record)}</div><button type="button" class="small maintenance-batch-add" data-add-maint-row>+ 继续添加维护</button>`;
  }
  function maintenanceExistingImage(field, value, label) {
    if (!value) return '<span class="meta">未上传图片</span>';
    return `<div class="maintenance-existing-image"><img class="upload-preview item-preview-trigger" src="${esc(value)}" data-preview-image="${esc(value)}" alt="${esc(label)}" /><button type="button" class="small danger" data-delete-maintenance-image="${esc(field)}" data-maintenance-id="${esc(state.recordId)}">删除图片</button></div>`;
  }
  function renderMaintenanceDetail(record = {}) {
    const fields = $('#dialog-fields');
    fields.className = 'dialog-fields dialog-maintenance';
    const room = roomFor(record);
    fields.innerHTML = `
      <section class="maintenance-section maintenance-section-core">
        <div class="maintenance-section-head"><span>维护信息</span><small>选择项</small></div>
        <div class="maintenance-section-grid">
          <label class="field-roomId maintenance-field full"><span class="field-label">小区/房间</span><select name="roomId">${maintenanceRoomOptions(room?.id || record.roomId)}</select></label>
          <label class="maintenance-field"><span class="field-label">维护日期</span><input name="maintenanceDate" type="date" value="${esc(record.maintenanceDate || today())}" /></label>
          <label class="maintenance-field"><span class="field-label">维护类型</span><select name="maintenanceType"><option value="repair" ${record.maintenanceType === 'repair' ? 'selected' : ''}>房间日常维护</option><option value="new" ${record.maintenanceType === 'new' ? 'selected' : ''}>新增物品</option><option value="remove" ${record.maintenanceType === 'remove' ? 'selected' : ''}>删除物品</option></select></label>
        </div>
      </section>
      <section class="maintenance-section maintenance-section-text">
        <div class="maintenance-section-head"><span>事项与备注</span><small>重点输入内容</small></div>
        <div class="maintenance-section-grid">
          <label class="maintenance-field full field-item"><span class="field-label">维护事项 / 物品名称</span><input name="item" value="${esc(record.item || '')}" /></label>
          <label class="maintenance-field full field-note"><span class="field-label">备注</span><textarea name="note">${esc(record.note || '')}</textarea></label>
        </div>
      </section>
      <section class="maintenance-section maintenance-section-result">
        <div class="maintenance-section-head"><span>金额与状态</span><small>结果区</small></div>
        <div class="maintenance-section-grid">
          <label class="maintenance-field field-amount"><span class="field-label">金额</span><input name="amount" inputmode="decimal" value="${esc(record.amount ?? '')}" /></label>
          <label class="maintenance-field field-status"><span class="field-label">状态</span><select name="status"><option value="pending" ${record.status === 'pending' ? 'selected' : ''}>待处理</option><option value="done" ${record.status === 'done' ? 'selected' : ''}>已完成待报销</option><option value="reimbursed" ${record.status === 'reimbursed' ? 'selected' : ''}>已报销</option></select></label>
          <label class="maintenance-field full field-reimbursementBatchId"><span class="field-label">报销批次</span><select name="reimbursementBatchId">${maintenanceBatchOptions(record.reimbursementBatchId)}</select></label>
        </div>
      </section>
      <section class="maintenance-section maintenance-section-media">
        <div class="maintenance-section-head"><span>图片凭证</span><small>维护前 / 维护后 / 付款截图</small></div>
        <div class="maintenance-section-grid maintenance-media-grid">
          <label class="maintenance-field maintenance-media-field"><span class="field-label">维护前图片</span><input name="beforeImage" type="file" accept="image/jpeg,image/png,image/webp" data-existing="${esc(JSON.stringify(record.beforeImage || ''))}" />${maintenanceExistingImage('beforeImage', record.beforeImage, '维护前图片')}</label>
          <label class="maintenance-field maintenance-media-field"><span class="field-label">维护后图片</span><input name="afterImage" type="file" accept="image/jpeg,image/png,image/webp" data-existing="${esc(JSON.stringify(record.afterImage || ''))}" />${maintenanceExistingImage('afterImage', record.afterImage, '维护后图片')}</label>
          <label class="maintenance-field maintenance-media-field"><span class="field-label">付款截图</span><input name="paymentProof" type="file" accept="image/jpeg,image/png,image/webp" data-existing="${esc(JSON.stringify(record.paymentProof || ''))}" />${maintenanceExistingImage('paymentProof', record.paymentProof, '付款截图')}</label>
        </div>
      </section>`;
  }
  function maintenanceSelectedRecords() {
    const ids = [...document.querySelectorAll('.maintenance-check:checked')].map((input) => input.value);
    return ids.map((id) => state.maintenance.find((item) => item.id === id)).filter(Boolean);
  }
  function maintenanceBatchDialog() { return $('#maintenance-batch-dialog'); }
  function openMaintenanceBatchDialog(records) {
    maintenanceBatchSelection = [...records];
    const dialog = maintenanceBatchDialog();
    const targets = $('#maintenance-batch-targets');
    const summary = $('#maintenance-batch-summary');
    const select = $('#maintenance-batch-select');
    const nameWrap = $('#maintenance-batch-name-wrap');
    const nameInput = $('#maintenance-batch-name');
    const noteInput = $('#maintenance-batch-note');
    const error = $('#maintenance-batch-error');
    const activeBatches = (state.maintenanceBatches || []).filter((item) => !item.archivedAt);
    const currentBatchIds = [...new Set(records.map((item) => item.reimbursementBatchId).filter(Boolean))];
    const currentBatch = currentBatchIds.length === 1 ? activeBatches.find((item) => item.id === currentBatchIds[0]) : null;
    if (summary) summary.textContent = `已选中 ${records.length} 条维护记录，可批量归入一个报销批次。`;
    if (targets) targets.innerHTML = records.map((item) => `· ${esc(roomLabel(item.roomNo))} ${esc(item.maintenanceDate || '')} ${esc(item.item || '未填写事项')} ${item.reimbursementBatchId ? `（当前：${esc(maintenanceBatchName(item.reimbursementBatchId) || '已归档批次')}）` : ''}`).join('<br />');
    if (select) {
      select.innerHTML = `<option value="__new__">新建批次</option>${activeBatches.map((batch) => `<option value="${esc(batch.id)}">${esc(batch.name || '未命名批次')}</option>`).join('')}`;
      select.value = currentBatch ? currentBatch.id : '__new__';
    }
    if (nameWrap) nameWrap.hidden = select?.value !== '__new__';
    if (nameInput) nameInput.value = '';
    if (noteInput) noteInput.value = '';
    if (error) error.textContent = '';
    if (dialog && !dialog.open) dialog.showModal();
    setTimeout(() => (select?.value === '__new__' ? nameInput : select)?.focus(), 30);
  }
  async function saveMaintenanceBatchDialog(event) {
    event.preventDefault();
    const error = $('#maintenance-batch-error');
    const select = $('#maintenance-batch-select');
    const nameInput = $('#maintenance-batch-name');
    const noteInput = $('#maintenance-batch-note');
    const choice = select?.value || '__new__';
    let batchId = choice;
    let batch = (state.maintenanceBatches || []).find((item) => item.id === batchId && !item.archivedAt);
    if (choice === '__new__') {
      const name = nameInput?.value.trim() || '';
      if (!name) { if (error) error.textContent = '请填写批次名称'; return; }
      batch = await api('maintenance-batches', { method: 'POST', body: JSON.stringify({ name, note: noteInput?.value.trim() || '' }) });
      batchId = batch.id;
    }
    const conflicts = maintenanceBatchSelection.filter((item) => item.reimbursementBatchId && item.reimbursementBatchId !== batchId);
    if (conflicts.length) {
      const conflictText = conflicts.slice(0, 3).map((item) => `${roomLabel(item.roomNo)} ${item.maintenanceDate || ''} ${item.item || '未填写事项'}（当前：${maintenanceBatchName(item.reimbursementBatchId) || '已归档批次'}）`).join('\n');
      if (!confirm(`以下维护记录已在其他批次中：\n${conflictText}${conflicts.length > 3 ? `\n另有 ${conflicts.length - 3} 条记录` : ''}\n\n继续归入当前批次吗？`)) return;
    }
    for (const item of maintenanceBatchSelection) {
      await api(`maintenance/${item.id}`, { method: 'PATCH', body: JSON.stringify({ reimbursementBatchId: batchId }) });
    }
    maintenanceBatchDialog()?.close();
    maintenanceBatchSelection = [];
    await load();
  }
  function renderMaintenanceTable() {
    const target = $('#maintenance-list'); if (!target) return;
    const filter = state.maintenanceFilters || { month: '', date: '', room: '' };
    const roomSelect = $('#maintenance-room');
    const recordsMode = (state.maintenanceView || 'records') !== 'batches';
    document.querySelectorAll('[data-maintenance-view]').forEach((button) => button.classList.toggle('active', button.dataset.maintenanceView === (recordsMode ? 'records' : 'batches')));
    document.querySelector('.maintenance-filters')?.toggleAttribute('hidden', !recordsMode);
    document.querySelector('.maintenance-batch-actions')?.toggleAttribute('hidden', !recordsMode);
    document.querySelector('#maintenance-cost-heading')?.toggleAttribute('hidden', !recordsMode);
    document.querySelector('#cost-list')?.toggleAttribute('hidden', !recordsMode);
    if (roomSelect && recordsMode) {
      roomSelect.innerHTML = '<option value="">全部房间</option>' + state.rooms.filter((room) => !room.archivedAt).map((room) => `<option value="${esc(room.roomNo)}">${esc(room.propertyName || '房间')} · ${esc(room.roomNo)}</option>`).join('');
      roomSelect.value = filter.room || '';
    }
    const list = state.maintenance.filter((item) => !item.archivedAt && (!filter.month || String(item.maintenanceDate || '').startsWith(filter.month)) && (!filter.date || item.maintenanceDate === filter.date) && (!filter.room || item.roomNo === filter.room));
    const pendingReimburse = state.maintenance.filter((item) => !item.archivedAt && item.status === 'done');
    const batchSummary = state.maintenanceBatches.filter((item) => !item.archivedAt);
    const summaryText = recordsMode
      ? `已完成待报销 ${pendingReimburse.length} 条，共 ${money(pendingReimburse.reduce((sum, item) => sum + Number(item.amount || 0), 0))}`
      : `共 ${batchSummary.length} 个批次，${batchSummary.reduce((sum, item) => sum + Number(item.count || 0), 0)} 条维护，合计 ${money(batchSummary.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0))}`;
    const summary = $('#maintenance-batch-count'); if (summary) summary.textContent = summaryText;
    if (!recordsMode) {
      const rows = batchSummary.map((batch) => `<tr data-batch-id="${esc(batch.id)}"><td><strong>${esc(batch.name || '未命名批次')}</strong>${batch.note ? `<div class="meta">${esc(batch.note)}</div>` : ''}</td><td>${esc(batch.count || 0)}</td><td class="expense-text">${money(batch.totalAmount)}</td><td>${esc(chinaDateTime(batch.createdAt || batch.updatedAt || ''))}</td><td><div class="row-actions"><button class="small" data-open-batch="${esc(batch.id)}">查看</button><button class="small" data-copy-batch="${esc(batch.id)}">复制链接</button></div></td><td><div class="row-actions"><button class="small" data-edit-batch="${esc(batch.id)}">重命名</button><button class="small danger" data-delete-batch="${esc(batch.id)}">归档</button></div></td></tr>`).join('');
      target.innerHTML = `<div class="row-actions" style="justify-content:flex-end;margin-bottom:10px"><button class="small" data-batch-create>+ 新建批次</button></div>${rows ? `<table class="table maintenance-data-table"><thead><tr><th>批次名称</th><th>条数</th><th>金额</th><th>创建时间</th><th>链接</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="meta">暂无报销批次</p>'}`;
      return;
    }
    const imageCell = (value, label) => value ? `<button type="button" class="maintenance-image-link" data-preview-image="${esc(value)}"><img src="${esc(value)}" alt="${esc(label)}" /></button>` : '<span class="meta">未上传</span>';
    const evidenceCell = (item) => `<div class="maintenance-evidence-grid"><div><span>维护前</span>${imageCell(item.beforeImage, '维护前图片')}</div><div><span>维护后</span>${imageCell(item.afterImage, '维护后图片')}</div><div><span>付款</span>${imageCell(item.paymentProof, '付款截图')}</div></div>`;
    const itemCell = (item) => `<div class="maintenance-item-cell"><strong>${esc(item.item || '未填写事项')}</strong>${item.note ? `<span>${esc(item.note)}</span>` : ''}${item.reimbursementBatchId ? `<span class="maintenance-batch-tag">批次：${esc(maintenanceBatchName(item.reimbursementBatchId) || '未命名批次')}</span>` : ''}</div>`;
    const metaCell = (item) => `<div class="maintenance-meta-card"><strong>${esc(roomLabel(item.roomNo))}</strong><div class="maintenance-meta-row"><span>${esc(item.maintenanceDate || '')}</span><span class="maintenance-type-chip maintenance-type-${esc(item.maintenanceType || 'repair')}">${esc(maintenanceTypeLabels[item.maintenanceType] || '房间日常维护')}</span></div></div>`;
    const rows = list.map((item) => `<tr class="maintenance-row maintenance-row-${esc(item.status || 'pending')}" data-maintenance-detail="${esc(item.id)}"><td>${item.status === 'reimbursed' ? '' : `<input type="checkbox" class="maintenance-check" value="${esc(item.id)}" />`}</td><td>${metaCell(item)}</td><td>${itemCell(item)}</td><td><span class="maintenance-amount">${money(item.amount)}</span></td><td><span class="maintenance-status ${maintenanceStatusClass(item.status)}">${maintenanceStatusLabels[item.status] || '待处理'}</span></td><td>${evidenceCell(item)}</td><td><div class="row-actions">${item.status === 'pending' ? `<button class="small" data-maint-complete="${esc(item.id)}">完成维护</button>` : ''}${item.status === 'done' ? `<button class="small" data-maint-reimburse="${esc(item.id)}">已报销</button>` : ''}<button class="small icon-button" data-edit="maintenance" data-id="${esc(item.id)}" title="详情/编辑" aria-label="详情/编辑"><iconify-icon icon="hugeicons:edit-02" aria-hidden="true"></iconify-icon></button><button class="small danger icon-button" data-delete="maintenance" data-id="${esc(item.id)}" title="删除" aria-label="删除"><iconify-icon icon="hugeicons:delete-02" aria-hidden="true"></iconify-icon></button></div></td></tr>`).join('');
    target.innerHTML = rows ? `<table class="table maintenance-data-table maintenance-record-table"><thead><tr>${['选择', '房间 / 日期 / 类型', '事项 / 备注', '金额', '状态', '图片凭证', '操作'].map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>` : '<p class="meta">暂无维护记录</p>';
  }
  function renderMaintenanceBatchManagement() {
    renderMaintenanceTable();
  }
  renderMaintenance = function () {
    renderMaintenanceTable();
  };

  const originalOpenDialog = openDialog;
  openDialog = function (type, id = '', roomNo = '', seed = {}) {
    batchMaintenanceMode = type === 'maintenance' && !id;
    originalOpenDialog(type, id, roomNo, seed);
    const subtitle = $('#dialog-subtitle');
    if (subtitle) {
      subtitle.textContent = type === 'maintenance' && !batchMaintenanceMode ? '记录房屋维护情况，用于费用管理与后续跟踪。' : '';
      subtitle.hidden = !(type === 'maintenance' && !batchMaintenanceMode);
    }
    if (type === 'maintenance') {
      const existing = (state.maintenance || []).find((item) => item.id === id);
      if (batchMaintenanceMode) renderMaintenanceBatch(existing || { roomNo }); else renderMaintenanceDetail(existing || seed);
      const dialog = $('#record-dialog'); dialog.classList.toggle('maintenance-batch-dialog', batchMaintenanceMode);
    }
  };

  collectDialog = async function () {
    if (batchItemMode && state.recordType === 'items') {
      const batchItems = [];
      for (const row of document.querySelectorAll('[data-batch-item-row]')) {
        const name = row.querySelector('[data-batch-item-name]')?.value.trim() || '';
        const quantity = Math.max(1, Math.trunc(Number(row.querySelector('[data-batch-item-quantity]')?.value || 1) || 1));
        const note = row.querySelector('[data-batch-item-note]')?.value.trim() || '';
        const file = row.querySelector('[data-batch-item-image]');
        if (!name && !note && !file?.files?.length) continue;
        if (!name) throw new Error('请填写每一项物品的名称');
        batchItems.push({ name, quantity, note, image: file?.files?.length ? await readFileInput(file) : '' });
      }
      if (!batchItems.length) throw new Error('请至少添加一项物品');
      const roomId = $('#dialog-fields [name="batchRoomId"]')?.value || '';
      const room = state.rooms.find((item) => item.id === roomId) || state.rooms.find((item) => item.roomNo === roomId);
      return { roomId: room?.id || roomId, roomNo: room?.roomNo || '', batchItems };
    }
    if (!batchMaintenanceMode || state.recordType !== 'maintenance') return legacyCollectDialog();
    const records = [];
    for (const row of document.querySelectorAll('[data-maint-row]')) {
      const room = maintenanceRoom(row); const item = row.querySelector('[data-maint-item]')?.value.trim() || '';
      const note = row.querySelector('[data-maint-note]')?.value.trim() || ''; const amount = row.querySelector('[data-maint-amount]')?.value.trim() || '';
      const files = { beforeImage: row.querySelector('[data-maint-before]'), afterImage: row.querySelector('[data-maint-after]'), paymentProof: row.querySelector('[data-maint-payment]') };
      if (!room && !item && !note && !amount && !Object.values(files).some((input) => input?.files?.length)) continue;
      if (!room) throw new Error('请选择维护房间');
      if (!item) throw new Error('请填写维护事项或物品名称');
      records.push({ roomId: room.id, roomNo: room.roomNo, maintenanceDate: row.querySelector('[data-maint-date]')?.value || today(), maintenanceType: row.querySelector('[data-maint-type]')?.value || 'repair', item, note, amount: amount || 0, status: 'pending', beforeImage: files.beforeImage?.files?.length ? await readFileInput(files.beforeImage) : '', afterImage: files.afterImage?.files?.length ? await readFileInput(files.afterImage) : '', paymentProof: files.paymentProof?.files?.length ? await readFileInput(files.paymentProof) : '' });
    }
    if (!records.length) throw new Error('请至少填写一条维护记录');
    return { batchMaintenance: records };
  };

  document.getElementById('record-form')?.addEventListener('submit', async (event) => {
    if (state.recordType !== 'maintenance') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const candidates = collectMaintenanceCandidates();
    const ignoreIds = state.recordId ? new Set([state.recordId]) : new Set();
    const duplicates = findMaintenanceDuplicates(candidates, ignoreIds);
    if (duplicates.length && !confirm(maintenanceDuplicateMessage(duplicates))) return;
    if (!batchMaintenanceMode) { saveDialog(event); return; }
    try { const data = await collectDialog(); for (const record of data.batchMaintenance) { await api('maintenance', { method: 'POST', body: JSON.stringify(record) }); await handleMaintenanceItemLink(record); } $('#record-dialog').close(); await load(); }
    catch (error) { $('#dialog-error').textContent = error.message; }
  }, true);
  document.getElementById('maintenance-batch-form')?.addEventListener('submit', saveMaintenanceBatchDialog);

  document.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-maintenance-view]');
    if (viewButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.maintenanceView = viewButton.dataset.maintenanceView === 'batches' ? 'batches' : 'records';
      renderMaintenance();
      return;
    }
    const assignBatch = event.target.closest('[data-batch-maintenance="assign-batch"]');
    if (assignBatch) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const selected = maintenanceSelectedRecords();
      if (!selected.length) { alert('请先勾选要修改批次的维护记录'); return; }
      openMaintenanceBatchDialog(selected);
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-maintenance-view]');
    if (viewButton) { state.maintenanceView = viewButton.dataset.maintenanceView === 'batches' ? 'batches' : 'records'; render(); return; }
    const createBatch = event.target.closest('[data-batch-create]');
    if (createBatch) {
      const name = prompt('请输入批次名称', `批次-${today().replace(/-/g, '')}`);
      if (!name || !name.trim()) return;
      try {
        state.maintenanceView = 'batches';
        const batch = await api('maintenance-batches', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
        state.maintenanceBatches = [batch, ...(state.maintenanceBatches || []).filter((item) => item.id !== batch.id)];
        renderMaintenance();
      }
      catch (error) { alert(error.message); }
      return;
    }
    const assignBatch = event.target.closest('[data-batch-maintenance="assign-batch"]');
    if (assignBatch) {
      const selected = maintenanceSelectedRecords();
      if (!selected.length) { alert('请先勾选要修改批次的维护记录'); return; }
      openMaintenanceBatchDialog(selected);
      return;
    }
    const completeBatch = event.target.closest('[data-batch-maintenance="complete"]');
    if (completeBatch) {
      const selected = maintenanceSelectedRecords();
      if (!selected.length) { alert('请先勾选要修改状态的维护记录'); return; }
      if (!confirm(`确认将选中的 ${selected.length} 条维护记录标记为“已完成待报销”吗？`)) return;
      try { for (const item of selected) await api(`maintenance/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }); await load(); }
      catch (error) { alert(error.message); }
      return;
    }
    const reimburseBatch = event.target.closest('[data-batch-maintenance="reimburse"]');
    if (reimburseBatch) {
      const selected = maintenanceSelectedRecords();
      if (!selected.length) { alert('请先勾选要修改状态的维护记录'); return; }
      if (!confirm(`确认将选中的 ${selected.length} 条维护记录标记为“已报销”吗？`)) return;
      try { for (const item of selected) await api(`maintenance/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'reimbursed' }) }); await load(); }
      catch (error) { alert(error.message); }
      return;
    }
    const exportBatch = event.target.closest('[data-batch-maintenance="export"]');
    if (exportBatch) { openPublicReimbursementLink(); return; }
    const publicLink = event.target.closest('[data-batch-maintenance="public-link"]');
    if (publicLink) { openPublicReimbursementLink(); return; }
    const openBatch = event.target.closest('[data-open-batch]');
    if (openBatch) { window.open(maintenanceBatchUrl(openBatch.dataset.openBatch), '_blank', 'noopener'); return; }
    const copyBatch = event.target.closest('[data-copy-batch]');
    if (copyBatch) {
      const url = maintenanceBatchUrl(copyBatch.dataset.copyBatch);
      try { await navigator.clipboard.writeText(url); alert('批次链接已复制'); } catch { window.prompt('复制批次链接', url); }
      return;
    }
    const editBatch = event.target.closest('[data-edit-batch]');
    if (editBatch) {
      const current = (state.maintenanceBatches || []).find((item) => item.id === editBatch.dataset.editBatch && !item.archivedAt);
      if (!current) { alert('报销批次不存在'); return; }
      const name = prompt('修改批次名称', current.name || '');
      if (!name || !name.trim()) return;
      try { await api(`maintenance-batches/${current.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) }); await load(); }
      catch (error) { alert(error.message); }
      return;
    }
    const deleteBatch = event.target.closest('[data-delete-batch]');
    if (deleteBatch) {
      if (!confirm('确认归档这个批次吗？')) return;
      try { await api(`maintenance-batches/${deleteBatch.dataset.deleteBatch}`, { method: 'DELETE' }); await load(); }
      catch (error) { alert(error.message); }
      return;
    }
    const batchDialogClose = event.target.closest('[data-maintenance-batch-close]');
    if (batchDialogClose) { maintenanceBatchDialog()?.close(); maintenanceBatchSelection = []; return; }
    const add = event.target.closest('[data-add-maint-row]');
    if (add) { const rows = $('#maintenance-batch-rows'); const previous = rows?.lastElementChild?.querySelector('[data-maint-room]')?.value || ''; rows?.insertAdjacentHTML('beforeend', maintenanceBatchRow(rows.children.length, { roomId: previous })); return; }
    const remove = event.target.closest('[data-remove-maint-row]');
    if (remove) { const rows = $('#maintenance-batch-rows'); if (rows?.children.length > 1) remove.closest('[data-maint-row]')?.remove(); else remove.closest('[data-maint-row]')?.querySelectorAll('input').forEach((input) => { input.value = ''; }); return; }
    const row = event.target.closest('[data-maint-row]');
    if (row && event.target.matches('[data-maint-room], [data-maint-type]')) { const room = maintenanceRoom(row); const type = row.querySelector('[data-maint-type]')?.value || 'repair'; const control = row.querySelector('[data-maint-item-wrap]'); const value = row.querySelector('[data-maint-item]')?.value || ''; if (control) control.innerHTML = maintenanceItemControl(room?.roomNo || '', type, value); }
    const detail = event.target.closest('[data-maintenance-detail]');
    if (detail && !event.target.closest('button, input, a')) openDialog('maintenance', detail.dataset.maintenanceDetail);
    const deleteImage = event.target.closest('[data-delete-maintenance-image]');
    if (deleteImage) { if (!confirm('确定删除这张维护图片吗？')) return; try { await api(`maintenance/${deleteImage.dataset.maintenanceId}`, { method: 'PATCH', body: JSON.stringify({ [deleteImage.dataset.deleteMaintenanceImage]: '' }) }); await load(); openDialog('maintenance', deleteImage.dataset.maintenanceId); } catch (error) { alert(error.message); } }
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('#maintenance-batch-select')) {
      const wrap = $('#maintenance-batch-name-wrap');
      if (wrap) wrap.hidden = event.target.value !== '__new__';
      return;
    }
    const row = event.target.closest('[data-maint-row]');
    if (!row || !event.target.matches('[data-maint-room], [data-maint-type]')) return;
    const room = maintenanceRoom(row); const type = row.querySelector('[data-maint-type]')?.value || 'repair'; const control = row.querySelector('[data-maint-item-wrap]'); const value = row.querySelector('[data-maint-item]')?.value || '';
    if (control) control.innerHTML = maintenanceItemControl(room?.roomNo || '', type, value);
  });

  document.addEventListener('click', (event) => { if (event.target.closest('[data-add-other-item]')) { const items = syncOtherItems(); items.push({ item: '', amount: '', mode: 'deduct' }); renderCheckoutOtherItems(items); } const remove = event.target.closest('[data-remove-other-item]'); if (remove) { const items = syncOtherItems(); items.splice(Number(remove.dataset.removeOtherItem), 1); renderCheckoutOtherItems(items); } });
  document.addEventListener('click', async (event) => {
    const rangeButton = event.target.closest('[data-overview-finance-range]');
    if (rangeButton) { overviewFinanceFilter.mode = rangeButton.dataset.overviewFinanceRange || 'month'; renderStats(); return; }
    const refund = event.target.closest('[data-refund-deposit]');
    if (refund) {
      const lease = state.leases.find((item) => item.id === refund.dataset.refundDeposit);
      if (!lease || !confirm(`确认已退还${lease.tenantName || '该租户'}的押金吗？`)) return;
      try { await api(`leases/${lease.id}`, { method: 'PATCH', body: JSON.stringify({ depositStatus: 'refunded', depositRefundAmount: lease.depositRefundAmount || lease.deposit }) }); await load(); } catch (error) { alert(error.message); }
      return;
    }
    const todo = event.target.closest('[data-todo-tab]'); if (todo) { document.querySelector(`[data-tab="${todo.dataset.todoTab}"]`)?.click(); document.querySelector(`#${todo.dataset.todoTab}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const stat = event.target.closest('#overview .stats > div:nth-child(-n+4)');
    if (stat) { document.querySelector('[data-tab="rental"]')?.click(); document.querySelector('#rental')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  document.addEventListener('input', (event) => { if (event.target.closest('#checkout-other-items')) { syncOtherItems(); updateCheckoutAmounts(); } if (event.target.name === 'monthlyRent' || event.target.name === 'monthlyPropertyFee' || event.target.name === 'propertyAmount') { updateRenewalAmount(); updateCheckoutAmounts(); updateLeaseTotals(); } if (event.target.id === 'overview-finance-start' || event.target.id === 'overview-finance-end') { overviewFinanceFilter.mode = 'custom'; overviewFinanceFilter.start = document.getElementById('overview-finance-start')?.value || ''; overviewFinanceFilter.end = document.getElementById('overview-finance-end')?.value || ''; renderStats(); } });
  document.addEventListener('change', (event) => { if (event.target.name === 'propertyFeeMode' || event.target.name === 'roomId') updateLeaseTotals(); if (event.target.matches('#dialog-fields [name="checkoutDate"], #dialog-fields [data-other-mode], #dialog-fields [name="waterEnd"], #dialog-fields [name="electricityEnd"]')) updateCheckoutAmounts(); });
})();

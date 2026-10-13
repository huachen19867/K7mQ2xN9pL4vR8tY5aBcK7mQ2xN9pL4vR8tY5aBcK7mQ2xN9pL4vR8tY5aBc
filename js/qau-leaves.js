/* 只读演示数据：HTTP 读取同步快照，file:// 读取同步生成的 JS 副本。
   字段值只写入 textContent / value；不连接学校提交或审批接口。 */
(function () {
  'use strict';
  var page = document.documentElement.getAttribute('data-qau-page');
  if (page !== 'p3' && page !== 'p4') return;
  var statuses = ['进行中', '已完成', '已批准', '已驳回', '已撤销', '草稿'];
  var fields = {
    studentName: 'User_32', studentId: 'User_33', college: 'Input_188',
    major: 'User_35', className: 'User_190', reason: 'MultiInput_42',
    startAt: 'Calendar_44', endAt: 'Calendar_45',
    contactPhone: "User_36", parentName: "Input_37", parentPhone: "Input_38", dorm: "Input_40", reasonType: "SelectV2_150", reasonDetail: "Input_161", days: "Count_46", leaveType: "Radio_219", stayOnCampus: "Radio_254", courses: "SelectV2_168", emergencyContact: "Input_47", emergencyPhone: "Input_48", returnAt: "Calendar_164", identityType: "User_198", location: "ClockIn_165", cardMode: "SelectV2_247", gateEntryAt: "Input_204", gateName: "Input_239"
  };

  var approvalFields = {"classLeader":["MultiInput_115","User_196","Calendar_119"],"homeroomTeacher":["MultiInput_175","HandSignature_177","Calendar_174"],"counselor":["MultiInput_49","HandSignature_178","Calendar_68"],"academicSecretary":["MultiInput_213","HandSignature_215","Calendar_217"],"deputyPartySecretary":["MultiInput_50","HandSignature_179","Calendar_69"],"viceDean":["MultiInput_256","HandSignature_258","Calendar_260"],"dean":["MultiInput_185","HandSignature_186","Calendar_187"]};
  function media(value) {
    if (!value || typeof value.url !== 'string' || !/^assets\/uploads\/[a-f0-9]{64}\.(png|jpg|webp|pdf)$/.test(value.url)) return null;
    return {url:value.url, name:string(value.name || '附件'), type:string(value.type)};
  }
  function string(value) { return value == null ? '' : String(value); }

  function validate(data) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.records)) throw new Error('invalid-data');
    var ids = Object.create(null);
    return data.records.map(function (record, index) {
      if (!record || typeof record.id !== 'string' || !record.id.trim() ||
          ids[record.id] || statuses.indexOf(record.status) === -1) throw new Error('invalid-record');
      ids[record.id] = true;
      var detail = record.details || {};
      if (typeof detail !== 'object' || Array.isArray(detail)) throw new Error('invalid-details');
      var clean = {
        id: record.id, title: string(record.title), status: record.status,
        appliedAt: string(record.appliedAt), elapsed: string(record.elapsed),
        order: typeof record.order === 'number' && isFinite(record.order) ? record.order : index,
        details: {}
      };
      Object.keys(fields).forEach(function (name) { clean.details[name] = string(detail[name]); });
      clean.details.proofs = Array.isArray(detail.proofs) ? detail.proofs.map(media).filter(Boolean) : [];
      clean.approvals = {};
      Object.keys(approvalFields).forEach(function(role) {
        var a = record.approvals && record.approvals[role] || {};
        clean.approvals[role] = {name:string(a.name),opinion:string(a.opinion),date:string(a.date),signature:media(a.signature)};
      });
      return clean;
    }).sort(function (a, b) { return a.order - b.order; });
  }

  function load() {
    if (location.protocol === 'file:') {
      if (!window.QAU_LEAVES) return Promise.resolve(null);
      return Promise.resolve().then(function () { return validate(window.QAU_LEAVES); });
    }
    return fetch('leaves.json', { cache: 'no-store' }).then(function (response) {
      // 没有单独快照时继续提供原页面模板；其他错误不能冒充成功读取。
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('load-failed');
      return response.json().then(validate);
    });
  }

  function message(container, text) {
    var node = document.createElement('p');
    node.className = 'qau-leaves-message';
    node.setAttribute('role', 'status');
    node.textContent = text;
    container.appendChild(node);
    return node;
  }

  function listPage() {
    var list = document.querySelector('.m_matter_list .mml_list');
    if (!list) return;
    var originals = Array.prototype.slice.call(list.querySelectorAll('.mmll_item'));
    var template = originals[0];
    var selected = '全部';
    var search = document.querySelector('.ml_search input');
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.ml_nav > span'));
    var records = null;
    var error = false;
    var hint = message(list.parentNode, '');
    hint.hidden = true;
    list.hidden = true;

    function searchable(record) {
      return [record.title, record.status, record.appliedAt, record.elapsed].concat(
        Object.keys(record.details || {}).map(function (key) { return record.details[key]; })
      ).join(' ').toLocaleLowerCase();
    }

    function makeCard(record) {
      var card = template ? template.cloneNode(true) : document.createElement('li');
      if (!template) return card;
      card.setAttribute('data-qau-leave-id', record.id);
      var button = card.querySelector('button.prview');
      if (button) button.classList.add('qau-hotspot');
      Array.prototype.forEach.call(card.querySelectorAll('[data-qau]'), function (node) { node.removeAttribute('data-qau'); });
      card.querySelector('.title').textContent = record.title;
      var values = card.querySelectorAll('.mmll_item_content aside > p');
      if (values[0]) values[0].textContent = record.appliedAt;
      if (values[1]) values[1].textContent = record.elapsed;
      var image = card.querySelector('img.status');
      if (image && (record.status === '已完成' || record.status === '已撤销' || record.status === '已批准')) {
        image.src = record.status === '已撤销' ? 'assets/img/undo_chapter.f53b2725.png' : 'assets/img/complete.f02c33ab.png';
        image.alt = record.status === '已批准' ? '已完成' : record.status;
      } else if (image) {
        var label = document.createElement('span');
        label.className = 'status qau-leave-status';
        label.textContent = record.status;
        image.parentNode.replaceChild(label, image);
      }
      return card;
    }

    function render() {
      list.textContent = '';
      hint.hidden = true;
      list.hidden = false;
      if (error) { hint.textContent = '演示记录加载失败，请稍后刷新。'; hint.hidden = false; return; }
      var query = search ? search.value.trim().toLocaleLowerCase() : '';
      var shown = 0;
      if (records !== null) {
        records.forEach(function (record) {
          if (selected !== '全部' && record.status !== selected && !(selected === '已完成' && record.status === '已批准')) return;
          if (query && searchable(record).indexOf(query) === -1) return;
          list.appendChild(makeCard(record));
          shown++;
        });
      } else {
        originals.forEach(function (card) {
          var image = card.querySelector('img.status');
          var status = image && image.getAttribute('src').indexOf('complete.') !== -1 ? '已完成' : '已撤销';
          if (selected !== '全部' && status !== selected) return;
          if (query && card.textContent.toLocaleLowerCase().indexOf(query) === -1) return;
          list.appendChild(card);
          shown++;
        });
      }
      if (!shown) { hint.textContent = query || selected !== '全部' ? '暂无符合条件的申请' : '暂无申请记录'; hint.hidden = false; }
    }

    tabs.forEach(function (tab) {
      tab.classList.add('qau-hotspot');
      tab.setAttribute('role', 'button');
      tab.tabIndex = 0;
      function choose() {
        selected = tab.textContent.trim();
        tabs.forEach(function (item) { item.classList.toggle('active', item === tab); });
        render();
      }
      tab.addEventListener('click', choose);
      tab.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
      });
    });
    if (search) search.addEventListener('input', render);
    load().then(function (result) { records = result; render(); }).catch(function () { error = true; render(); });
  }

  function field(key, value) {
    var box = document.querySelector('[data-key="' + key + '"]');
    if (!box) return;
    value=string(value);
    var row=box.closest('.mobile_up_down_style') || box.closest('.plugin-allbox')?.parentElement;
    if (value && row) row.style.display='';
    var radios=box.querySelectorAll('input[type="radio"]');
    if(radios.length) {
      Array.prototype.forEach.call(radios,function(input){var label=input.closest('label')||input.parentElement.parentElement;var selected=input.value===value;input.checked=selected;input.disabled=true;label.classList.toggle('is-checked',selected);var icon=label.querySelector('i.icon');if(icon){icon.classList.toggle('icondanxuanxuanzhongcopy-',selected);icon.classList.toggle('icondanxuanxuanzhong-copy',!selected);}});
      return;
    }
    var target = box.querySelector('input.el-input__inner') || box.querySelector('textarea, input:not([type="radio"]):not([type="checkbox"])') || box.querySelector('.dplugin-content-wrap, .doneplugin-value, .plugin-data, .dplugin-mobile > span, .dplugin-mobile');
    if (!target) {target=document.createElement('div');target.className='qau-field-value';box.appendChild(target);}
    target.removeAttribute('data-qau');
    if (target.matches('input, textarea')) {target.value=value;target.readOnly=true;}
    else target.textContent=value;
  }
  function renderMedia(key,items,name) {
    var box=document.querySelector('[data-key="'+key+'"]');if(!box)return;
    var holder=box.querySelector('.dhandsign > div, .dhandsign') || box.querySelector('.dplugin-mobile') || box;
    holder.textContent='';
    if(name){var text=document.createElement('span');text.className='qau-signature-name';text.textContent=name;holder.appendChild(text);}
    items.forEach(function(item){
      var link=document.createElement('a');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.className='qau-attachment';
      if(item.type.indexOf('image/')===0){var image=document.createElement('img');image.src=item.url;image.alt=item.name;image.className='qau-attachment-image';link.appendChild(image);}else link.textContent=item.name;
      holder.appendChild(link);
    });
    var row=box.closest('.mobile_up_down_style') || box.closest('.plugin-allbox')?.parentElement;
    if((items.length||name)&&row)row.style.display='';
  }
  function fillApprovals(record) {
    Object.keys(approvalFields).forEach(function(role){var a=record.approvals[role],keys=approvalFields[role];field(keys[0],a.opinion);field(keys[2],a.date);renderMedia(keys[1],a.signature?[a.signature]:[],a.name);});
    renderMedia('Ximage_146',record.details.proofs || [],'');
  }

  function formPage() {
    // 本页保持只读静态演示；提交/撤销按钮没有业务处理器。
    Array.prototype.forEach.call(document.querySelectorAll('input, textarea'), function (node) { node.readOnly = true; });
    var params = new URLSearchParams(location.search);
    if (!params.has('id')) return; // 未指定记录时沿用原静态模板。
    var id = params.get('id');
    var form = document.getElementById('pubilcForms');
    if (form) form.hidden = true;
    Object.keys(fields).forEach(function (name) { field(fields[name], ''); });
    // 实际申请时间是 Calendar_234；Text_20 是隐藏的“请假结束时间”提示。
    field('Calendar_234', '');
    var container = document.querySelector('.forms') || document.body;
    var hint = message(container, '正在加载演示记录…');
    load().then(function (records) {
      var record = records && records.filter(function (item) { return item.id === id; })[0];
      if (!record) { hint.textContent = '未找到这条演示申请，请返回列表重新选择。'; return; }
      Object.keys(fields).forEach(function (name) { field(fields[name], record.details[name]); });
      field('Calendar_234', record.appliedAt);
      fillApprovals(record);
      document.documentElement.setAttribute('data-qau-leave-id', record.id);
      if (form) form.hidden = false;
      hint.remove();
    }).catch(function () { hint.textContent = '演示记录加载失败，请返回列表或稍后刷新。'; });
  }

  function boot() { if (page === 'p3') listPage(); else formPage(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

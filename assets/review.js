/* 每日复盘：写、改、删、导出。数据只存在浏览器的 localStorage 里，不上传到任何地方。 */
(function () {
  'use strict';
  var KEY = 'jocehi-review-v1';
  var listEl = document.getElementById('rvList');
  var emptyEl = document.getElementById('rvEmpty');
  var dateEl = document.getElementById('rvDate');
  var didEl = document.getElementById('rvDid');
  var goodEl = document.getElementById('rvGood');
  var badEl = document.getElementById('rvBad');
  var nextEl = document.getElementById('rvNext');
  var saveBtn = document.getElementById('rvSave');
  var cancelBtn = document.getElementById('rvCancel');
  var exportBtn = document.getElementById('rvExport');
  var tipEl = document.getElementById('rvTip');
  var formTitle = document.getElementById('formTitle');
  var editingId = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function store(items) { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {} }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(s) { return esc(s).replace(/\n/g, '<br>'); }
  function tip(msg) { tipEl.textContent = msg; setTimeout(function () { tipEl.textContent = ''; }, 3000); }
  function section(label, text) {
    if (!text || !text.trim()) return '';
    return '<div class="entry-sec"><h3>' + label + '</h3><p>' + fmt(text) + '</p></div>';
  }

  function render() {
    var items = load().sort(function (a, b) {
      return a.date === b.date ? (a.id < b.id ? 1 : -1) : (a.date < b.date ? 1 : -1);
    });
    emptyEl.hidden = items.length > 0;
    listEl.innerHTML = items.map(function (it) {
      return '<article class="card entry"><div class="entry-head"><b>' + esc(it.date) + '</b>'
        + '<span><button data-edit="' + it.id + '">编辑</button><button data-del="' + it.id + '">删除</button></span></div>'
        + section('今天做了什么', it.did)
        + section('做得好的', it.good)
        + section('待改进的', it.bad)
        + section('明日计划', it.next)
        + '</article>';
    }).join('');
  }

  listEl.addEventListener('click', function (e) {
    var t = e.target;
    var id = t.getAttribute('data-edit') || t.getAttribute('data-del');
    if (!id) return;
    var items = load();
    var it = null;
    items.forEach(function (x) { if (x.id === id) it = x; });
    if (!it) return;
    if (t.hasAttribute('data-del')) {
      if (!confirm('确定删除 ' + it.date + ' 的复盘吗？')) return;
      store(items.filter(function (x) { return x.id !== id; }));
      if (editingId === id) resetForm();
      render();
      return;
    }
    editingId = id;
    dateEl.value = it.date;
    didEl.value = it.did || '';
    goodEl.value = it.good || '';
    badEl.value = it.bad || '';
    nextEl.value = it.next || '';
    formTitle.textContent = '编辑 ' + it.date + ' 的复盘';
    cancelBtn.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function resetForm() {
    editingId = null;
    dateEl.value = today();
    didEl.value = goodEl.value = badEl.value = nextEl.value = '';
    formTitle.textContent = '写今日复盘';
    cancelBtn.hidden = true;
  }

  saveBtn.addEventListener('click', function () {
    var date = dateEl.value || today();
    var data = { date: date, did: didEl.value.trim(), good: goodEl.value.trim(), bad: badEl.value.trim(), next: nextEl.value.trim() };
    if (!data.did && !data.good && !data.bad && !data.next) { tip('先写点内容再保存'); return; }
    var items = load();
    if (editingId) {
      items.forEach(function (x) { if (x.id === editingId) { x.date = data.date; x.did = data.did; x.good = data.good; x.bad = data.bad; x.next = data.next; } });
    } else {
      var same = null;
      items.forEach(function (x) { if (x.date === date) same = x; });
      if (same) { same.did = data.did; same.good = data.good; same.bad = data.bad; same.next = data.next; }
      else items.push({ id: 'rv' + Date.now(), date: data.date, did: data.did, good: data.good, bad: data.bad, next: data.next });
    }
    store(items);
    resetForm();
    render();
    tip('已保存 ✓');
  });

  cancelBtn.addEventListener('click', resetForm);

  exportBtn.addEventListener('click', function () {
    var items = load().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!items.length) { tip('还没有内容可导出'); return; }
    var md = '# 每日复盘\n\n' + items.map(function (it) {
      var s = '## ' + it.date + '\n';
      if (it.did) s += '\n### 今天做了什么\n' + it.did + '\n';
      if (it.good) s += '\n### 做得好的\n' + it.good + '\n';
      if (it.bad) s += '\n### 待改进的\n' + it.bad + '\n';
      if (it.next) s += '\n### 明日计划\n' + it.next + '\n';
      return s;
    }).join('\n');
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jocehi-review-' + today() + '.md';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  dateEl.value = today();
  render();
})();

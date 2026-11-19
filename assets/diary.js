/* 日记：密码门 + 写、改、删、导出。密码只以 SHA-256 摘要形式存在代码里，不存明文；
   内容只存在浏览器的 localStorage 里，不上传到任何地方。
   注意：这是静态网站上的轻量锁，能挡随手点开的人，但看得懂源码的人可以绕过，别放特别敏感的内容。 */
(function () {
  'use strict';
  var PW_HASH = 'cb69775effd93fc34ef38dfbfcdc4c593b1a3d8e7ab70c0f05d627dbc5cbd298';
  var KEY = 'jocehi-diary-v1';
  var SESSION_KEY = 'jocehi-diary-unlocked';

  /* 纯 JS 的 SHA-256（网站是 http，浏览器原生的 crypto.subtle 在非 https 下不可用） */
  function sha256(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var i, j;
    var result = '';
    var words = [];
    var asciiBitLength = ascii.length * 8;
    var hash = sha256.h = sha256.h || [];
    var k = sha256.k = sha256.k || [];
    var primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) {
          isComposite[i] = candidate;
        }
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return null;
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  var lockEl = document.getElementById('diaryLock');
  var appEl = document.getElementById('diaryApp');
  var pwEl = document.getElementById('diaryPw');
  var unlockBtn = document.getElementById('diaryUnlock');
  var errEl = document.getElementById('diaryErr');
  var listEl = document.getElementById('dyList');
  var emptyEl = document.getElementById('dyEmpty');
  var dateEl = document.getElementById('dyDate');
  var titleEl = document.getElementById('dyTitle');
  var bodyEl = document.getElementById('dyBody');
  var saveBtn = document.getElementById('dySave');
  var cancelBtn = document.getElementById('dyCancel');
  var exportBtn = document.getElementById('dyExport');
  var lockBtn = document.getElementById('dyLock');
  var tipEl = document.getElementById('dyTip');
  var formTitle = document.getElementById('dyFormTitle');
  var editingId = null;

  function unlocked() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return false; }
  }
  function showApp() {
    lockEl.hidden = true;
    appEl.hidden = false;
    render();
  }
  function showLock() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    appEl.hidden = true;
    lockEl.hidden = false;
    pwEl.value = '';
    errEl.textContent = '';
    pwEl.focus();
  }

  unlockBtn.addEventListener('click', function () {
    var h = sha256(pwEl.value);
    if (h && h === PW_HASH) {
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
      errEl.textContent = '';
      showApp();
    } else {
      errEl.textContent = '密码不对，再试一次';
      pwEl.value = '';
      pwEl.focus();
    }
  });
  pwEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlockBtn.click(); });
  lockBtn.addEventListener('click', showLock);

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
  function preview(s) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }

  function render() {
    var items = load().sort(function (a, b) {
      return a.date === b.date ? (a.id < b.id ? 1 : -1) : (a.date < b.date ? 1 : -1);
    });
    emptyEl.hidden = items.length > 0;
    listEl.innerHTML = items.map(function (it) {
      return '<article class="card entry"><div class="entry-head"><b>' + esc(it.date) + (it.title ? ' · ' + esc(it.title) : '') + '</b>'
        + '<span><button data-edit="' + it.id + '">编辑</button><button data-del="' + it.id + '">删除</button></span></div>'
        + '<p class="entry-body">' + fmt(it.body) + '</p></article>';
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
      /* 不可逆操作的确认交给滑动条（assets/sub-effects.js）；没有接管时才回落到 confirm */
      if (!window.__sxSlideConfirm && !confirm('确定删除 ' + it.date + ' 的日记吗？')) return;
      store(items.filter(function (x) { return x.id !== id; }));
      if (editingId === id) resetForm();
      render();
      return;
    }
    editingId = id;
    dateEl.value = it.date;
    titleEl.value = it.title || '';
    bodyEl.value = it.body || '';
    formTitle.textContent = '编辑 ' + it.date + ' 的日记';
    cancelBtn.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function resetForm() {
    editingId = null;
    dateEl.value = today();
    titleEl.value = '';
    bodyEl.value = '';
    formTitle.textContent = '写日记';
    cancelBtn.hidden = true;
  }

  saveBtn.addEventListener('click', function () {
    var date = dateEl.value || today();
    var data = { date: date, title: titleEl.value.trim(), body: bodyEl.value.trim() };
    if (!data.body) { tip('先写点内容再保存'); return; }
    var items = load();
    if (editingId) {
      items.forEach(function (x) { if (x.id === editingId) { x.date = data.date; x.title = data.title; x.body = data.body; } });
    } else {
      items.push({ id: 'dy' + Date.now(), date: data.date, title: data.title, body: data.body });
    }
    store(items);
    resetForm();
    render();
    tip('已保存 ✓');
  });

  cancelBtn.addEventListener('click', resetForm);

  /* 清空全部：确认由 assets/sub-effects.js 的滑动条接管 */
  var clearAllBtn = document.getElementById('dyClearAll');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', function () {
      if (!window.__sxSlideConfirm && !confirm('确定清空全部日记吗？此操作不可撤销。')) return;
      store([]);
      if (editingId) resetForm();
      render();
      tip('已清空全部日记');
    });
  }

  exportBtn.addEventListener('click', function () {
    var items = load().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!items.length) { tip('还没有内容可导出'); return; }
    var md = '# 日记\n\n' + items.map(function (it) {
      return '## ' + it.date + (it.title ? ' ' + it.title : '') + '\n\n' + it.body + '\n';
    }).join('\n');
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jocehi-diary-' + today() + '.md';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  dateEl.value = today();
  if (unlocked()) showApp();
  else showLock();
})();

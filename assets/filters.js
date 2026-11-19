/* 列表页筛选 — Peek Launch videos 的做法：白色圆角容器里一排 pill，
   组内单选、激活只变底色；加一个关键词输入框，纯前端过滤，不改 URL。 */
(function () {
  'use strict';
  var bar = document.querySelector('.filter-bar');
  if (!bar) return;
  var cards = Array.prototype.slice.call(document.querySelectorAll('.paper-card, .lesson-card'));
  if (!cards.length) return;
  var pills = Array.prototype.slice.call(bar.querySelectorAll('[data-filter]'));
  var input = bar.querySelector('.filter-search');
  var count = document.createElement('p');
  count.className = 'filter-count';
  bar.after(count);
  var empty = document.createElement('p');
  empty.className = 'filter-empty';
  empty.textContent = '没有符合的条目，换个关键词或分类试试。';
  empty.hidden = true;
  count.after(empty);
  var cat = 'all', q = '';
  function apply() {
    var shown = 0;
    cards.forEach(function (c) {
      var okCat = cat === 'all' || c.getAttribute('data-cat') === cat;
      var okQ = !q || c.textContent.toLowerCase().indexOf(q) !== -1;
      var show = okCat && okQ;
      c.style.display = show ? '' : 'none';
      if (show) shown++;
    });
    count.textContent = '显示 ' + shown + ' / ' + cards.length;
    empty.hidden = shown !== 0;
  }
  pills.forEach(function (p) {
    p.addEventListener('click', function () {
      pills.forEach(function (x) { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
      p.classList.add('active'); p.setAttribute('aria-pressed', 'true');
      cat = p.getAttribute('data-filter');
      apply();
    });
  });
  if (input) input.addEventListener('input', function () { q = input.value.trim().toLowerCase(); apply(); });
  apply();
})();

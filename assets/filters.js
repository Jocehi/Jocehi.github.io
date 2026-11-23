/* 列表页筛选 — Peek Launch videos 的做法：白色圆角容器里一排 pill，
   组内单选、激活只变底色；加一个关键词输入框，纯前端过滤，不改 URL。
   2026-11-23 dissolve 改造：筛选 pill 换成 SegmentedControl 式滑动白 pill
   （指示块随激活项滑动，文字交叉变色）；筛选切换时卡片错开淡入下滑。 */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  /* ---- SegmentedControl 滑动白 pill ---- */
  var indicator = document.createElement('span');
  indicator.className = 'filter-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  bar.insertBefore(indicator, bar.firstChild);
  function activePill() { return bar.querySelector('.filter-pill.active'); }
  function placePill(animate) {
    var p = activePill();
    if (!p) { indicator.style.opacity = '0'; return; }
    indicator.style.opacity = '1';
    if (!animate || reduceMotion) indicator.style.transition = 'none';
    else indicator.style.transition = '';
    indicator.style.width = p.offsetWidth + 'px';
    indicator.style.transform = 'translateX(' + p.offsetLeft + 'px)';
    if (!animate || reduceMotion) { void indicator.offsetWidth; indicator.style.transition = ''; }
  }
  window.addEventListener('resize', function () { placePill(false); });

  function apply(animateIn) {
    var shown = 0, order = 0;
    cards.forEach(function (c) {
      var okCat = cat === 'all' || c.getAttribute('data-cat') === cat;
      var okQ = !q || c.textContent.toLowerCase().indexOf(q) !== -1;
      var show = okCat && okQ;
      c.style.display = show ? '' : 'none';
      if (show) {
        shown++;
        if (animateIn && !reduceMotion) {
          c.classList.remove('sx-filter-in');
          void c.offsetWidth;
          c.style.animationDelay = Math.min(order, 7) * 40 + 'ms';
          c.classList.add('sx-filter-in');
          order++;
        }
      }
    });
    count.textContent = '显示 ' + shown + ' / ' + cards.length;
    empty.hidden = shown !== 0;
  }
  pills.forEach(function (p) {
    p.addEventListener('click', function () {
      pills.forEach(function (x) { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
      p.classList.add('active'); p.setAttribute('aria-pressed', 'true');
      cat = p.getAttribute('data-filter');
      placePill(true);
      apply(true);
    });
  });
  if (input) input.addEventListener('input', function () { q = input.value.trim().toLowerCase(); apply(true); });
  apply(false);
  placePill(false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { placePill(false); });
})();

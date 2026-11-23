/* 樱花飘落 + 打字机效果 — 轻量、无依赖 */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- 樱花 ---- */
  function sakura() {
    if (reduceMotion) return;
    var canvas = document.getElementById('sakura');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W, H, petals = [], COUNT = 26;
    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);
    function makePetal(init) {
      return {
        x: Math.random() * W,
        y: init ? Math.random() * H : -20,
        size: 6 + Math.random() * 8,
        speedY: 0.5 + Math.random() * 1.1,
        sway: Math.random() * 1.2 + 0.4,
        phase: Math.random() * Math.PI * 2,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.02,
        hue: 335 + Math.random() * 15,
        alpha: 0.45 + Math.random() * 0.4
      };
    }
    for (var i = 0; i < COUNT; i++) petals.push(makePetal(true));
    // 单一循环 + 按真实帧间隔换算位移：切回页面不会叠加出多条循环、
    // 高刷屏也不会加速；单帧间隔上限 3 帧，避免切回瞬间花瓣跳落
    var running = true, rafId = 0, lastTs = 0;
    function schedule() { if (!rafId) rafId = requestAnimationFrame(tick); }
    document.addEventListener('visibilitychange', function () {
      running = !document.hidden;
      if (running) { lastTs = 0; schedule(); }
      else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    });
    function drawPetal(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = 'hsla(' + p.hue + ', 85%, 78%, ' + p.alpha + ')';
      ctx.beginPath();
      // 花瓣：两瓣弧线拼成的近似形状
      ctx.moveTo(0, -p.size / 2);
      ctx.bezierCurveTo(p.size / 2, -p.size / 2, p.size / 2, p.size / 2, 0, p.size / 2);
      ctx.bezierCurveTo(-p.size / 2, p.size / 2, -p.size / 2, -p.size / 2, 0, -p.size / 2);
      ctx.fill();
      ctx.restore();
    }
    function tick(ts) {
      rafId = 0;
      if (!running) return;
      var dt = lastTs ? Math.min((ts - lastTs) / 16.667, 3) : 1;
      lastTs = ts;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < petals.length; i++) {
        var p = petals[i];
        p.phase += 0.012 * dt;
        p.y += p.speedY * dt;
        p.x += Math.sin(p.phase) * p.sway * 0.4 * dt;
        p.rot += p.rotSpeed * dt;
        if (p.y > H + 24) petals[i] = makePetal(false);
        drawPetal(p);
      }
      schedule();
    }
    schedule();
  }

  /* ---- 打字机 ---- */
  function typewriter() {
    var el = document.querySelector('[data-typewriter]');
    if (!el) return;
    var lines = [];
    try { lines = JSON.parse(el.getAttribute('data-typewriter')); } catch (e) { lines = [el.textContent]; }
    if (!lines.length) return;
    if (reduceMotion) { el.textContent = lines[0]; return; }
    var caret = document.createElement('span');
    caret.className = 'caret';
    var text = document.createElement('span');
    el.textContent = '';
    el.appendChild(text);
    el.appendChild(caret);
    var li = 0, ci = 0, deleting = false;
    function step() {
      var line = lines[li];
      if (!deleting) {
        ci++;
        text.textContent = line.slice(0, ci);
        if (ci >= line.length) { deleting = true; setTimeout(step, 2200); return; }
        setTimeout(step, 55 + Math.random() * 60);
      } else {
        ci -= 5;
        if (ci <= 0) {
          ci = 0; text.textContent = '';
          deleting = false; li = (li + 1) % lines.length;
          setTimeout(step, 450); return;
        }
        text.textContent = line.slice(0, ci);
        setTimeout(step, 22);
      }
    }
    setTimeout(step, 500);
  }

  /* ---- 代码复制按钮 ---- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.copybtn');
    if (!btn) return;
    var pre = btn.parentElement;
    var code = pre.querySelector('code');
    var txt = code ? code.textContent : pre.textContent;
    function done(ok) {
      btn.textContent = ok ? '已复制 ✓' : '复制失败';
      setTimeout(function () { btn.textContent = '复制代码'; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      try { done(document.execCommand('copy')); } catch (err) { done(false); }
      document.body.removeChild(ta);
    }
  });

  sakura();
  typewriter();
})();

  /* ---- 滚动淡入上浮 + 第一屏轻微视差 ---- */
  (function () {
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var reveals = document.querySelectorAll('.reveal');
    if (!reveals.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(function (el) { io.observe(el); });

    // 第一屏轻微视差：下滑时 hero 内容缓慢上移并淡出
    var heroInner = document.querySelector('.hero-inner');
    var hero = document.querySelector('.hero-full');
    if (heroInner && hero) {
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          var y = window.scrollY || 0;
          if (y < window.innerHeight) {
            heroInner.style.transform = 'translateY(' + (y * 0.22) + 'px)';
            heroInner.style.opacity = String(Math.max(0, 1 - y / (window.innerHeight * 0.85)));
          }
          ticking = false;
        });
      }, { passive: true });
    }
  })();

  /* ---- 主页存档：只展示最新 3 条，其余折叠，点“展开”看全部（2026-11-23） ---- */
  (function () {
    var VISIBLE = 3;
    var cards = document.querySelectorAll('#contents .card.split');
    if (!cards.length) return;
    Array.prototype.forEach.call(cards, function (card) {
      var list = card.querySelector('.archive');
      if (!list) return;
      var items = list.querySelectorAll('li');
      if (items.length <= VISIBLE) return;
      card.classList.add('collapsible');
      var hidden = items.length - VISIBLE;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'archive-toggle';
      btn.setAttribute('aria-expanded', 'false');
      function label(expanded) {
        return expanded ? '收起 ↑' : '展开全部（还有 ' + hidden + ' 条） ▾';
      }
      btn.textContent = label(false);
      btn.addEventListener('click', function () {
        var expanded = card.classList.toggle('expanded');
        btn.setAttribute('aria-expanded', String(expanded));
        btn.textContent = label(expanded);
      });
      list.parentNode.insertBefore(btn, list.nextSibling);
    });
  })();

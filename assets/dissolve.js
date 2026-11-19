/* 溶解特效：聚拢 (Gather) / 花瓣雨 (Rain) / 轻尘 (Dust)
 * 参考 dissolve（React Native 库）的 Canvas 2D 移植思路：
 * 把目标（头像、名字、卡片图）先画到离屏画布采样成颗粒，
 * 再用一帧一画布的方式驱动颗粒运动。无依赖，纯 Canvas 2D。
 * 只在首页生效；prefers-reduced-motion 时全部跳过，原样显示。
 * 安全兜底：任何一步出错或超时，都会把真实内容恢复显示，
 * 绝不会让头像、名字或卡片图一直藏着。 */
(function () {
  'use strict';

  if (!window.requestAnimationFrame || !document.createElement('canvas').getContext) return;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var hiddenEls = [];   /* 被暂时藏起来的真实元素，出错时一律恢复 */
  var canvases = [];    /* 已创建的颗粒画布，出错时一律移除 */

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* 藏起真实元素（opacity，不动布局）；恢复时淡入 */
  function hideEl(el) {
    if (!el || el.style.opacity === '0') return;
    el.style.transition = 'opacity .3s ease';
    el.style.opacity = '0';
    hiddenEls.push(el);
  }
  function showEl(el) {
    if (!el) return;
    el.style.opacity = '1';
    var i = hiddenEls.indexOf(el);
    if (i >= 0) hiddenEls.splice(i, 1);
  }
  function forceShowAll() {
    hiddenEls.slice().forEach(showEl);
    canvases.slice().forEach(function (cv) {
      if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
    });
    canvases.length = 0;
    document.querySelectorAll('.card-img.dissolving').forEach(function (c) {
      c.classList.remove('dissolving');
    });
  }
  /* 全局兜底：5 秒后无论如何恢复全部内容 */
  setTimeout(forceShowAll, 5000);

  function makeCanvas(host, w, h) {
    var cv = document.createElement('canvas');
    cv.className = 'dissolve-canvas';
    cv.width = Math.max(1, Math.round(w * DPR));
    cv.height = Math.max(1, Math.round(h * DPR));
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    host.appendChild(cv);
    canvases.push(cv);
    var ctx = cv.getContext('2d');
    ctx.scale(DPR, DPR);
    return { cv: cv, ctx: ctx, w: w, h: h };
  }
  function removeCanvas(layer) {
    if (!layer) return;
    if (layer.cv && layer.cv.parentNode) layer.cv.parentNode.removeChild(layer.cv);
    var i = canvases.indexOf(layer.cv);
    if (i >= 0) canvases.splice(i, 1);
  }

  /* ---------- 采样 ---------- */
  /* 按 grain 网格采样一块画布，返回 [{x, y, r, g, b}]（坐标为画布内 CSS 像素） */
  function sampleCanvas(ctx, w, h, grain, keepRatio) {
    var out = [];
    var data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return out; }
    for (var y = 0; y < h; y += grain) {
      for (var x = 0; x < w; x += grain) {
        var i = (y * w + x) * 4;
        if (data[i + 3] < 140) continue;
        if (keepRatio < 1 && Math.random() > keepRatio) continue;
        out.push({ x: x + grain / 2, y: y + grain / 2, r: data[i], g: data[i + 1], b: data[i + 2] });
      }
    }
    return out;
  }
  /* 把图片按 object-fit:cover 的裁切方式画到 w×h 再采样 */
  function sampleCover(img, w, h, grain, keepRatio) {
    var iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih || w <= 0 || h <= 0) return [];
    var scale = Math.max(w / iw, h / ih);
    var sw = w / scale, sh = h / scale;
    var sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    var ctx = c.getContext('2d');
    try { ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height); } catch (e) { return []; }
    return sampleCanvas(ctx, c.width, c.height, grain, keepRatio);
  }
  /* 把文字画到离屏画布再采样（只留深色笔画像素） */
  function sampleText(text, px, family, color, grain) {
    var pad = 10;
    var meas = document.createElement('canvas').getContext('2d');
    meas.font = px + 'px ' + family;
    var tw = Math.ceil(meas.measureText(text).width) + pad * 2;
    var th = Math.ceil(px * 1.5) + pad * 2;
    var c = document.createElement('canvas');
    c.width = Math.max(1, tw);
    c.height = Math.max(1, th);
    var ctx = c.getContext('2d');
    ctx.font = px + 'px ' + family;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c.width / 2, c.height / 2);
    var parts = sampleCanvas(ctx, c.width, c.height, grain, 1);
    return parts.filter(function (p) { return p.r < 130 && p.g < 130 && p.b < 130; });
  }

  /* ---------- 颗粒动画 ---------- */
  /* items: [{x0,y0,x1,y1,delay,dur,r,g,b,size,a0,a1,sway,ease}]
   * 返回 Promise；动画结束时 resolve。 */
  function animate(layer, items, totalMs) {
    return new Promise(function (resolve) {
      var ctx = layer.ctx, w = layer.w, h = layer.h;
      var start = 0, raf = 0, done = false;
      function finish() {
        if (done) return;
        done = true;
        if (raf) cancelAnimationFrame(raf);
        resolve();
      }
      /* 超时兜底：不让动画卡住 */
      var guard = setTimeout(finish, totalMs + 1500);
      function tick(ts) {
        if (done) return;
        if (!start) start = ts;
        var now = ts - start;
        ctx.clearRect(0, 0, w, h);
        var alive = false;
        for (var i = 0; i < items.length; i++) {
          var p = items[i];
          var t = clamp((now - p.delay) / p.dur, 0, 1);
          if (t < 1) alive = true;
          var e = p.ease ? p.ease(t) : easeOutCubic(t);
          var x = p.x0 + (p.x1 - p.x0) * e;
          var y = p.y0 + (p.y1 - p.y0) * e;
          if (p.sway) x += Math.sin(e * Math.PI) * p.sway;
          var a = p.a0 + (p.a1 - p.a0) * t;
          if (a <= 0.01) continue;
          ctx.fillStyle = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + a.toFixed(3) + ')';
          ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
        }
        if (now < totalMs && alive) {
          raf = requestAnimationFrame(tick);
        } else {
          clearTimeout(guard);
          finish();
        }
      }
      raf = requestAnimationFrame(tick);
    });
  }
  function fadeOutCanvas(layer, ms) {
    return new Promise(function (resolve) {
      var cv = layer.cv;
      cv.style.transition = 'opacity ' + ms + 'ms ease';
      cv.style.opacity = '0';
      setTimeout(function () { removeCanvas(layer); resolve(); }, ms + 60);
    });
  }
  function waitForImg(img, ms) {
    return new Promise(function (resolve) {
      if (img.complete && img.naturalWidth > 0) { resolve(true); return; }
      var ok = false;
      var to = setTimeout(function () { if (!ok) { ok = true; resolve(false); } }, ms);
      img.addEventListener('load', function () {
        if (!ok) { ok = true; clearTimeout(to); resolve(img.naturalWidth > 0); }
      });
      img.addEventListener('error', function () {
        if (!ok) { ok = true; clearTimeout(to); resolve(false); }
      });
    });
  }

  /* ---------- 1. 首屏聚拢 Gather：头像 + 名字由颗粒聚拢拼成 ---------- */
  function heroGather() {
    var hero = document.querySelector('.hero-full');
    var avatar = hero && hero.querySelector('img.avatar');
    var name = hero && hero.querySelector('h1');
    if (!hero || !avatar || !name) return;
    var aborted = false;
    function abort() { aborted = true; showEl(avatar); showEl(name); }

    /* 同步藏起头像与名字（脚本在 body 末尾、首绘前执行，不会闪一下） */
    hideEl(avatar);
    hideEl(name);
    /* 首屏下滑超过一点就取消聚拢，直接显示，避免视差错位 */
    window.addEventListener('scroll', function onScroll() {
      if ((window.scrollY || 0) > 60 && !aborted) {
        window.removeEventListener('scroll', onScroll);
        abort();
      }
    }, { passive: true });

    var heroRect = hero.getBoundingClientRect();
    var W = hero.clientWidth, H = hero.clientHeight;
    var cs = window.getComputedStyle(name);
    var fontPx = parseFloat(cs.fontSize) || 67;
    var fontFamily = cs.fontFamily || 'cursive';
    var fontColor = cs.color || '#141414';

    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    var imgReady = waitForImg(avatar, 1500);
    var timeout = new Promise(function (res) { setTimeout(res, 1200); });
    Promise.race([Promise.all([fontsReady, imgReady]), timeout]).then(function () {
      if (aborted) return;
      try { startGather(); } catch (e) { abort(); }
    });

    function startGather() {
      if (aborted) return;
      heroRect = hero.getBoundingClientRect();
      W = hero.clientWidth; H = hero.clientHeight;
      var aRect = avatar.getBoundingClientRect();
      var nRect = name.getBoundingClientRect();
      var parts = [];

      /* 头像：圆形区域内采样，颗粒带照片原色 */
      if (avatar.naturalWidth > 0) {
        var aw = aRect.width, ah = aRect.height;
        var sampled = sampleCover(avatar, aw, ah, 3, 1);
        var cx = aw / 2, cy = ah / 2, rr = Math.min(aw, ah) / 2 - 1;
        sampled.forEach(function (p) {
          var dx = p.x - cx, dy = p.y - cy;
          if (dx * dx + dy * dy > rr * rr) return;
          parts.push({
            x: aRect.left - heroRect.left + p.x,
            y: aRect.top - heroRect.top + p.y,
            r: p.r, g: p.g, b: p.b
          });
        });
      }
      /* 名字：按实际字号与字体采样笔画 */
      var nameParts = sampleText('Jocehi', fontPx, fontFamily, fontColor, 2);
      var nCx = nRect.left - heroRect.left + nRect.width / 2;
      var nCy = nRect.top - heroRect.top + nRect.height / 2;
      nameParts.forEach(function (p) {
        parts.push({
          x: 0, y: 0, r: p.r, g: p.g, b: p.b, _sx: p.x, _sy: p.y
        });
      });
      /* 名字颗粒换算：采样画布以文字中心为原点 */
      var textW = 0, textH = 0;
      (function () {
        var meas = document.createElement('canvas').getContext('2d');
        meas.font = fontPx + 'px ' + fontFamily;
        textW = meas.measureText('Jocehi').width;
        textH = fontPx * 1.5;
      })();
      parts.forEach(function (p) {
        if (p._sx !== undefined) {
          p.x = nCx + (p._sx - (textW / 2 + 10));
          p.y = nCy + (p._sy - (textH / 2 + 10));
          delete p._sx; delete p._sy;
        }
      });

      if (parts.length < 80) { abort(); return; }
      /* 颗粒太多时均匀抽稀，上限 6000（与 dissolve 库一致） */
      if (parts.length > 6000) {
        var step = parts.length / 6000;
        var slim = [];
        for (var i = 0; i < parts.length; i += step) slim.push(parts[Math.floor(i)]);
        parts = slim;
      }

      var layer = makeCanvas(hero, W, H);
      var items = parts.map(function (p) {
        var ang = rand(0, Math.PI * 2);
        var dist = rand(60, Math.max(140, Math.min(W, H) * 0.45));
        return {
          x0: clamp(p.x + Math.cos(ang) * dist, -20, W + 20),
          y0: clamp(p.y + Math.sin(ang) * dist, -20, H + 20),
          x1: p.x, y1: p.y,
          delay: rand(0, 350), dur: rand(850, 1250),
          r: p.r, g: p.g, b: p.b, size: rand(2.2, 3.6),
          a0: 0, a1: 1, sway: 0, ease: easeOutCubic
        };
      });
      animate(layer, items, 1700).then(function () {
        if (aborted) { removeCanvas(layer); return; }
        showEl(avatar);
        showEl(name);
        fadeOutCanvas(layer, 300);
      });
    }
  }

  /* ---------- 2. 卡片花瓣雨 Rain：滚入视野时颗粒落下拼成卡片图 ---------- */
  function rainCard(card) {
    var img = card.querySelector('img');
    if (!img) return Promise.resolve();
    card.dataset.busy = '1';
    return waitForImg(img, 2000).then(function (ok) {
      if (!ok || !img.naturalWidth) { delete card.dataset.busy; return; }
      var w = card.clientWidth, h = card.clientHeight;
      if (w < 10 || h < 10) { delete card.dataset.busy; return; }
      var parts = sampleCover(img, w, h, 5, 0.65);
      if (parts.length < 60) { delete card.dataset.busy; return; }
      if (parts.length > 6000) {
        var step = parts.length / 6000;
        var slim = [];
        for (var i = 0; i < parts.length; i += step) slim.push(parts[Math.floor(i)]);
        parts = slim;
      }
      card.classList.add('dissolving');
      var layer = makeCanvas(card, w, h);
      var items = parts.map(function (p) {
        /* 底部先落定：延迟按目标行从下往上递增 */
        var rowDelay = (1 - p.y / h) * 500;
        return {
          x0: p.x + rand(-8, 8),
          y0: p.y - rand(140, 320),
          x1: p.x, y1: p.y,
          delay: rowDelay + rand(0, 120), dur: rand(900, 1150),
          r: p.r, g: p.g, b: p.b, size: rand(3, 5),
          a0: 0, a1: 1, sway: rand(2, 7), ease: easeInOut
        };
      });
      return animate(layer, items, 1850).then(function () {
        removeCanvas(layer);
        card.classList.remove('dissolving');
        card.dataset.rained = '1';
        delete card.dataset.busy;
      });
    }).catch(function () {
      card.classList.remove('dissolving');
      delete card.dataset.busy;
    });
  }

  /* ---------- 3. 点图轻尘 Dust：化作细尘飘散，再聚回来 ---------- */
  function dustCard(card) {
    var img = card.querySelector('img');
    if (!img || !img.naturalWidth) return Promise.resolve();
    card.dataset.busy = '1';
    var w = card.clientWidth, h = card.clientHeight;
    if (w < 10 || h < 10) { delete card.dataset.busy; return Promise.resolve(); }
    var parts = sampleCover(img, w, h, 5, 0.65);
    if (parts.length < 60) { delete card.dataset.busy; return Promise.resolve(); }
    if (parts.length > 6000) {
      var step = parts.length / 6000;
      var slim = [];
      for (var i = 0; i < parts.length; i += step) slim.push(parts[Math.floor(i)]);
      parts = slim;
    }
    card.classList.add('dissolving');
    var layer = makeCanvas(card, w, h);
    /* 离场：向上、向右轻飘散去并淡出 */
    var outItems = parts.map(function (p) {
      return {
        x0: p.x, y0: p.y,
        x1: p.x + rand(20, 110), y1: p.y - rand(60, 190),
        delay: rand(0, 220), dur: rand(900, 1250),
        r: p.r, g: p.g, b: p.b, size: rand(2.5, 4.5),
        a0: 1, a1: 0, sway: rand(2, 8), ease: easeInOut
      };
    });
    return animate(layer, outItems, 1500).then(function () {
      /* 回场：从四周聚拢拼回原图 */
      var inItems = parts.map(function (p) {
        var ang = rand(0, Math.PI * 2);
        var dist = rand(50, 160);
        return {
          x0: clamp(p.x + Math.cos(ang) * dist, -20, w + 20),
          y0: clamp(p.y + Math.sin(ang) * dist, -20, h + 20),
          x1: p.x, y1: p.y,
          delay: rand(0, 280), dur: rand(800, 1100),
          r: p.r, g: p.g, b: p.b, size: rand(2.5, 4.5),
          a0: 0, a1: 1, sway: 0, ease: easeOutCubic
        };
      });
      return animate(layer, inItems, 1400);
    }).then(function () {
      removeCanvas(layer);
      card.classList.remove('dissolving');
      delete card.dataset.busy;
    }).catch(function () {
      removeCanvas(layer);
      card.classList.remove('dissolving');
      delete card.dataset.busy;
    });
  }

  /* ---------- 接线 ---------- */
  heroGather();

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card.split .card-img'));
  if (cards.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var card = entry.target;
        io.unobserve(card);
        if (!card.dataset.rained && !card.dataset.busy) rainCard(card);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
    cards.forEach(function (card) { io.observe(card); });
  } else {
    cards.forEach(function (card) { card.dataset.rained = '1'; });
  }

  cards.forEach(function (card) {
    card.addEventListener('click', function () {
      if (card.dataset.busy || !card.dataset.rained) return;
      dustCard(card);
    });
  });
})();

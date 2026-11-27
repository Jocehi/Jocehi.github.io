/* 子页特效引擎（Canvas 2D 颗粒 · 无依赖）
 *
 * 与首页 assets/dissolve.js 同一套思路：先把目标采样成颗粒，再用一帧一画布的方式
 * 驱动颗粒运动。本文件只负责子页；首页逻辑与 assets/dissolve.js 一律不动。
 *
 * 提供的效果：
 *   第一批 · 长文页（papers/*.html、rl/lesson-*.html）
 *     ImageReveal  论文/课程插图滚入视野时以颗粒汇聚方式出现一次，之后就是静态图
 *     Print        折叠的“参考答案”块展开后逐行显现一次（用 clip-path 遮罩，
 *                  不拆 HTML、不动 KaTeX 渲染后的 DOM）
 *   第二批 · 列表页（papers.html、rl.html、briefing.html）
 *     Gather       每页最新的一条卡片在加载时以颗粒汇聚出现一次
 *   第三批 · 简报页（briefing.html、briefing/YYYY-MM-DD.html）
 *     Snap         点卡片，颗粒从点击点爆裂，卡片收起消失；顶部 Toast 可撤销
 *     Stream       点“归档”，卡片化作颗粒流飞向顶部归档图标；Toast 可撤销
 *   第四批 · 表单页（review.html、diary.html）
 *     MorphButton     保存按钮收成圆形加载态 → 展开为“已保存 ✓”→ 约 1.8 秒后复位
 *     SlideToConfirm  删除/清空这类不可逆操作改成横向滑动到底才执行
 *
 * 全局约束：
 *   - 只动容器、按钮与反馈层；正文、公式（KaTeX）、代码块本身一律不改。
 *   - 暖白底 + 粉色 #e0528a 为唯一强调色，不用渐变。
 *   - prefers-reduced-motion 时全部跳过，原样显示。
 *   - 任何一步出错或超时都会把真实内容恢复显示，绝不让内容一直藏着。
 *   - 一次只做一个 burst。
 */
(function () {
  'use strict';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var canCanvas = !!(window.requestAnimationFrame && document.createElement('canvas').getContext);

  /* ============================================================
     0 · 基础工具
     ============================================================ */
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  /* 归档图标（内联 SVG，不依赖 emoji 字体） */
  var ARCHIVE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="4" rx="1.2"></rect>' +
    '<path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"></path>' +
    '<path d="M10 12.5h4"></path></svg>';

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function on(el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); }

  function parseRGB(str) {
    var m = /rgba?\(([^)]+)\)/.exec(str || '');
    if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    if (p.length < 3) return null;
    return [p[0] | 0, p[1] | 0, p[2] | 0];
  }
  function sameColor(r, g, b, ref) {
    if (!ref) return false;
    return Math.abs(r - ref[0]) < 14 && Math.abs(g - ref[1]) < 14 && Math.abs(b - ref[2]) < 14;
  }

  /* ============================================================
     1 · 画布与动画
     ============================================================ */
  var liveCanvases = [];

  /* 在 el 所在容器里铺一层与 el 同尺寸的画布（容器内绝对定位，随容器一起滚动） */
  function overlayFor(el, w, h) {
    var parent = el.parentElement;
    if (!parent) parent = document.body;
    var ppcs = window.getComputedStyle(parent);
    if (ppcs.position === 'static' && parent !== document.body && parent !== document.documentElement) {
      parent.style.position = 'relative';
    }
    var cv = document.createElement('canvas');
    cv.className = 'sx-canvas';
    cv.width = Math.max(1, Math.round(w * DPR));
    cv.height = Math.max(1, Math.round(h * DPR));
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    var elRect = el.getBoundingClientRect();
    var pRect = parent.getBoundingClientRect();
    var ox = pRect.left + (parseFloat(ppcs.borderLeftWidth) || 0);
    var oy = pRect.top + (parseFloat(ppcs.borderTopWidth) || 0);
    cv.style.left = (elRect.left - ox) + 'px';
    cv.style.top = (elRect.top - oy) + 'px';
    parent.appendChild(cv);
    var ctx = cv.getContext('2d');
    ctx.scale(DPR, DPR);
    var layer = { cv: cv, ctx: ctx, w: w, h: h };
    liveCanvases.push(layer);
    return layer;
  }

  /* 全屏固定画布（用于飞向顶部图标的粒子流） */
  function screenLayer() {
    var cv = document.createElement('canvas');
    cv.className = 'sx-canvas sx-fx-canvas';
    var W = window.innerWidth, H = window.innerHeight;
    cv.width = Math.max(1, Math.round(W * DPR));
    cv.height = Math.max(1, Math.round(H * DPR));
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    ctx.scale(DPR, DPR);
    var layer = { cv: cv, ctx: ctx, w: W, h: H };
    liveCanvases.push(layer);
    return layer;
  }

  function removeLayer(layer) {
    if (!layer) return;
    if (layer.cv && layer.cv.parentNode) layer.cv.parentNode.removeChild(layer.cv);
    var i = liveCanvases.indexOf(layer);
    if (i >= 0) liveCanvases.splice(i, 1);
  }

  /* items: [{x0,y0,x1,y1,delay,dur,r,g,b,size,a0,a1,sway,ease}] */
  function animate(layer, items, totalMs, onFrame) {
    return new Promise(function (resolve) {
      var ctx = layer.ctx, w = layer.w, h = layer.h;
      var start = 0, raf = 0, done = false, guard = 0;
      function finish() {
        if (done) return;
        done = true;
        if (raf) cancelAnimationFrame(raf);
        clearTimeout(guard);
        resolve();
      }
      guard = setTimeout(finish, totalMs + 1500);
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
          ctx.fillStyle = 'rgba(' + (p.r | 0) + ',' + (p.g | 0) + ',' + (p.b | 0) + ',' + a.toFixed(3) + ')';
          ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
        }
        if (onFrame) { try { onFrame(ctx, now, items); } catch (e) {} }
        if (now < totalMs && alive) raf = requestAnimationFrame(tick);
        else finish();
      }
      raf = requestAnimationFrame(tick);
    });
  }

  function fadeOutLayer(layer, ms) {
    return new Promise(function (resolve) {
      if (!layer) { resolve(); return; }
      layer.cv.style.transition = 'opacity ' + ms + 'ms ease';
      layer.cv.style.opacity = '0';
      setTimeout(function () { removeLayer(layer); resolve(); }, ms + 60);
    });
  }

  function thin(arr, max) {
    if (arr.length <= max) return arr;
    var step = arr.length / max, out = [];
    for (var i = 0; i < arr.length; i += step) out.push(arr[Math.floor(i)]);
    return out;
  }

  /* ============================================================
     2 · 采样
     ============================================================ */
  /* 从画布像素采样成颗粒；坐标是画布内 CSS 像素 */
  function sampleCanvas(ctx, w, h, grain, keepRatio, dropBg) {
    var out = [];
    var W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    var data;
    try { data = ctx.getImageData(0, 0, W, H).data; }
    catch (e) { return out; }
    for (var y = 0; y < H; y += grain) {
      for (var x = 0; x < W; x += grain) {
        var i = (y * W + x) * 4;
        if (data[i + 3] < 140) continue;
        if (keepRatio < 1 && Math.random() > keepRatio) continue;
        if (dropBg && sameColor(data[i], data[i + 1], data[i + 2], dropBg)) continue;
        out.push({ x: x + grain / 2, y: y + grain / 2, r: data[i], g: data[i + 1], b: data[i + 2] });
      }
    }
    return out;
  }

  /* 把图片按显示尺寸画到离屏画布再采样 */
  function sampleImage(img, w, h, grain, keepRatio) {
    if (!img || !img.naturalWidth || w <= 0 || h <= 0) return [];
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    var ctx = c.getContext('2d');
    try { ctx.drawImage(img, 0, 0, c.width, c.height); } catch (e) { return []; }
    return sampleCanvas(ctx, c.width, c.height, grain, keepRatio);
  }

  /* 把 DOM 块“画”成离屏画布再采样：底色 + 内嵌图片 + 逐行文字 */
  function sampleDom(el, grain, dropBgColor) {
    var rect = el.getBoundingClientRect();
    var w = Math.round(rect.width), h = Math.round(rect.height);
    if (w < 12 || h < 12) return [];
    /* 太大就整体缩放，保证离屏画布不超过 1200px */
    var scale = Math.min(1, 1200 / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    var cs = window.getComputedStyle(el);
    var ox = rect.left, oy = rect.top;

    /* 底色 */
    var bg = cs.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    /* 内嵌图片 */
    var imgs = el.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (!im.naturalWidth) continue;
      var ir = im.getBoundingClientRect();
      if (ir.width < 4 || ir.height < 4) continue;
      if (ir.bottom < rect.top || ir.top > rect.bottom) continue;
      try { ctx.drawImage(im, ir.left - ox, ir.top - oy, ir.width, ir.height); }
      catch (e) {}
    }
    /* 文字 */
    var lines = collectTextLines(el, ox, oy);
    ctx.textBaseline = 'alphabetic';
    for (var j = 0; j < lines.length; j++) {
      var ln = lines[j];
      if (!ln.text) continue;
      ctx.font = ln.font;
      ctx.fillStyle = ln.color;
      /* 用行高撑开一点笔画，采样出的颗粒更接近字块 */
      ctx.fillText(ln.text, ln.left, ln.baseline);
      ctx.globalAlpha = 0.45;
      ctx.fillText(ln.text, ln.left, ln.baseline + 0.6);
      ctx.globalAlpha = 1;
    }
    return sampleCanvas(ctx, cw, ch, grain, 1, dropBgColor);
  }

  /* 逐个文本节点取“每行一个矩形”，并按行宽把文本切出来 */
  function collectTextLines(el, ox, oy) {
    var out = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var meas = document.createElement('canvas').getContext('2d');
    var node;
    while ((node = walker.nextNode())) {
      if (out.length > 400) break;
      var parent = node.parentElement;
      if (!parent || !el.contains(parent)) continue;
      var tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
      /* KaTeX 的 MathML 副本是视觉隐藏的，不要采样 */
      if (parent.closest && parent.closest('.katex-mathml')) continue;
      var text = node.nodeValue || '';
      if (!text.trim()) continue;
      var f = window.getComputedStyle(parent);
      if (f.display === 'none' || f.visibility === 'hidden') continue;
      if (parseFloat(f.opacity) === 0) continue;
      var fontPx = parseFloat(f.fontSize) || 14;
      var font = (f.fontWeight || '400') + ' ' + fontPx + 'px ' + (f.fontFamily || 'sans-serif');
      meas.font = font;
      var range;
      try { range = document.createRange(); range.selectNodeContents(node); }
      catch (e) { continue; }
      var rects = range.getClientRects();
      if (!rects || !rects.length) continue;

      var startChar = 0, cum = 0;
      for (var r = 0; r < rects.length; r++) {
        var rc = rects[r];
        if (rc.width < 0.5 || rc.height < 0.5) continue;
        var target = cum + rc.width;
        /* 二分找出这一行结束处的字符下标 */
        var lo = startChar, hi = text.length, endChar = startChar;
        while (lo <= hi) {
          var mid = (lo + hi) >> 1;
          var mw = meas.measureText(text.slice(0, mid)).width;
          if (mw <= target) { endChar = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        if (endChar <= startChar) endChar = Math.min(text.length, startChar + 1);
        var sub = text.slice(startChar, endChar).replace(/\s+$/, '');
        if (sub) {
          out.push({
            text: sub,
            left: rc.left - ox,
            top: rc.top - oy,
            bottom: rc.bottom - oy,
            baseline: rc.bottom - oy - Math.max(0, (rc.height - fontPx) * 0.5),
            font: font,
            color: f.color || '#1d2333'
          });
        }
        startChar = endChar;
        cum = meas.measureText(text.slice(0, endChar)).width;
        if (startChar >= text.length) break;
      }
    }
    return out;
  }

  /* ============================================================
     3 · 第一批 · ImageReveal（插图颗粒汇聚出现）
     ============================================================ */
  function waitForImg(img, ms) {
    return new Promise(function (resolve) {
      if (!img) { resolve(false); return; }
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

  function revealOneImage(img) {
    if (!img || img.dataset.sxRevealed === '1') return Promise.resolve(false);
    img.dataset.sxRevealed = '1';

    var layer = null, aborted = false, animGuard = 0, readyGuard = 0, revealed = false;
    function restore() {
      if (aborted) return;
      aborted = true;
      clearTimeout(animGuard);
      clearTimeout(readyGuard);
      img.style.opacity = '';
      img.style.transition = '';
      if (layer) removeLayer(layer);
    }
    /* 兜底：等图最多 2.5 秒，动画最多 1.8 秒；无论如何都会把真图放出来 */
    readyGuard = setTimeout(restore, 4200);

    return waitForImg(img, 2500).then(function (ok) {
      if (aborted) return;
      if (!ok) { restore(); return; }
      /* 图加载完才有真实尺寸，这时再量 */
      var rect = img.getBoundingClientRect();
      var w = Math.round(rect.width), h = Math.round(rect.height);
      if (w < 24 || h < 24) { restore(); return; }
      var parts = sampleImage(img, w, h, 5, 1);
      if (parts.length < 40) { restore(); return; }
      parts = thin(parts, 4200);

      img.style.transition = 'opacity .2s ease';
      img.style.opacity = '0';
      layer = overlayFor(img, w, h);
      animGuard = setTimeout(restore, 1800);

      var maxD = Math.max(w, h);
      var items = parts.map(function (p) {
        var ang = rand(0, Math.PI * 2);
        var dist = rand(50, Math.max(120, maxD * 0.42));
        return {
          x0: clamp(p.x + Math.cos(ang) * dist, -24, w + 24),
          y0: clamp(p.y + Math.sin(ang) * dist, -24, h + 24),
          x1: p.x, y1: p.y,
          delay: rand(0, 300), dur: rand(780, 1150),
          r: p.r, g: p.g, b: p.b, size: rand(2.2, 3.6),
          a0: 0, a1: 1, sway: 0, ease: easeOutCubic
        };
      });
      return animate(layer, items, 1500).then(function () {
        if (aborted) return;
        clearTimeout(readyGuard);
        clearTimeout(animGuard);
        img.style.opacity = '';
        img.style.transition = '';
        revealed = true;
        return fadeOutLayer(layer, 260);
      });
    }).catch(function () {
      restore();
    }).then(function () {
      return revealed;
    });
  }

  function setupImageReveal() {
    var figs = document.querySelectorAll('figure');
    if (!figs.length) return;
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(figs, function (f) {
        var im = f.querySelector('img');
        if (im) revealOneImage(im);
      });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var im = e.target.querySelector('img');
        if (!im) return;
        revealOneImage(im).then(function (done) {
          /* 图当时还没加载出来 → 过一会儿再试一次，最多 3 次 */
          if (done === false) {
            var tries = 0;
            var retry = setInterval(function () {
              tries++;
              if (im.complete && im.naturalWidth > 0) {
                clearInterval(retry);
                revealOneImage(im);
              } else if (tries > 12) {
                clearInterval(retry);
              }
            }, 400);
          }
        });
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    Array.prototype.forEach.call(figs, function (f) { io.observe(f); });
  }

  /* ============================================================
     4 · 第一批 · Print（折叠答案逐行显现）
     用 clip-path 遮罩自上而下揭开，完全不拆 HTML、不动 KaTeX 的 DOM。
     ============================================================ */
  var activePrint = null;

  function printReveal(box) {
    if (!box || box.dataset.sxPrinted === '1') return;
    box.dataset.sxPrinted = '1';
    /* 一次只做一个 */
    if (activePrint && activePrint !== box) activePrint.finish();

    var cs = window.getComputedStyle(box);
    var lh = parseFloat(cs.lineHeight);
    if (!isFinite(lh) || lh <= 0) lh = (parseFloat(cs.fontSize) || 16) * 1.6;
    var h = box.scrollHeight || box.offsetHeight;
    var lines = Math.max(1, Math.round(h / lh));
    var total = clamp(lines * 110, 900, 1800);
    var per = total / lines;

    box.style.clipPath = 'inset(0 0 100% 0)';
    var t0 = null, finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      box.style.clipPath = '';
      if (activePrint === box) activePrint = null;
    }
    var guard = setTimeout(finish, total + 1600);
    activePrint = { finish: finish };
    function step(ts) {
      if (finished) return;
      if (t0 === null) t0 = ts;
      var el = ts - t0;
      var n = Math.min(lines, Math.floor(el / per));
      var pct = 100 - (n / lines) * 100;
      box.style.clipPath = 'inset(0 0 ' + pct.toFixed(2) + '% 0)';
      if (n < lines) requestAnimationFrame(step);
      else finish();
    }
    requestAnimationFrame(step);
  }

  function setupPrint() {
    var details = document.querySelectorAll('details');
    Array.prototype.forEach.call(details, function (d) {
      var sum = d.querySelector('summary');
      if (!sum) return;
      if (!/参考答案|答案/.test(sum.textContent || '')) return;
      on(d, 'toggle', function () {
        if (!d.open) return;
        var box = d.querySelector('.ans');
        if (!box) {
          var kids = d.children;
          for (var i = 0; i < kids.length; i++) {
            if (kids[i].tagName !== 'SUMMARY') { box = kids[i]; break; }
          }
        }
        if (box) {
          /* 等一帧，确保 details 展开后高度已稳定 */
          requestAnimationFrame(function () { printReveal(box); });
        }
      });
    });
  }

  /* ============================================================
     5 · 第二批 · Gather（列表页最新一条卡片汇聚出现）
     ============================================================ */
  function gatherCard(card) {
    if (!card || card.dataset.sxGathered === '1') return;
    card.dataset.sxGathered = '1';
    var rect = card.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 20) { delete card.dataset.sxGathered; return; }

    var bg = parseRGB(window.getComputedStyle(card).backgroundColor);
    var parts = sampleDom(card, 5, bg);
    if (parts.length < 12) { delete card.dataset.sxGathered; return; }
    parts = thin(parts, 3600);

    var layer = null, finished = false;
    function restore() {
      if (finished) return;
      finished = true;
      card.style.opacity = '';
      card.style.transition = '';
      card.dataset.sxGathering = '';
      if (layer) removeLayer(layer);
    }
    var guard = setTimeout(restore, 2600);
    /* 用户在汇聚过程中就点了卡片 → 先收掉汇聚，让点击立刻有反馈 */
    card._sxCancelGather = function () { clearTimeout(guard); restore(); };

    layer = overlayFor(card, rect.width, rect.height);
    card.dataset.sxGathering = '1';
    card.style.transition = 'opacity .22s ease';
    card.style.opacity = '0';

    var maxD = Math.max(rect.width, rect.height);
    var items = parts.map(function (p) {
      var ang = rand(0, Math.PI * 2);
      var dist = rand(60, Math.max(140, maxD * 0.45));
      return {
        x0: clamp(p.x + Math.cos(ang) * dist, -24, rect.width + 24),
        y0: clamp(p.y + Math.sin(ang) * dist, -24, rect.height + 24),
        x1: p.x, y1: p.y,
        delay: rand(0, 320), dur: rand(800, 1180),
        r: p.r, g: p.g, b: p.b, size: rand(2.2, 3.6),
        a0: 0, a1: 1, sway: 0, ease: easeOutCubic
      };
    });
    animate(layer, items, 1600).then(function () {
      clearTimeout(guard);
      restore();
      delete card._sxCancelGather;
    }).catch(function () {
      clearTimeout(guard);
      restore();
      delete card._sxCancelGather;
    });
  }

  function setupListGather() {
    var card = document.querySelector('.paper-card, .lesson-card, .card.latest');
    if (!card) return;
    var ran = false;
    var run = function () { if (ran) return; ran = true; gatherCard(card); };
    if (document.fonts && document.fonts.ready) {
      var to = setTimeout(run, 900);
      document.fonts.ready.then(function () { clearTimeout(to); run(); }, function () { clearTimeout(to); run(); });
    } else {
      setTimeout(run, 60);
    }
  }

  /* ============================================================
     6 · 通用：Toast 轻提示（带撤销）
     ============================================================ */
  var toastEl = null;
  function toast(msg, onUndo) {
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    var t = document.createElement('div');
    t.className = 'sx-toast';
    var s = document.createElement('span');
    s.className = 'sx-toast-msg';
    s.textContent = msg;
    t.appendChild(s);
    if (onUndo) {
      var b = document.createElement('button');
      b.className = 'sx-toast-undo';
      b.type = 'button';
      b.textContent = '撤销';
      b.addEventListener('click', function () {
        try { onUndo(); } catch (e) {}
        dismiss();
      });
      t.appendChild(b);
    }
    document.body.appendChild(t);
    toastEl = t;
    var timer = setTimeout(dismiss, 3000);
    function dismiss() {
      clearTimeout(timer);
      if (!t.parentNode) return;
      t.classList.add('sx-toast-out');
      setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
        if (toastEl === t) toastEl = null;
      }, 280);
    }
    return t;
  }

  /* 复制按钮共用：detail-rail.js 与 effects.js 里点复制后调这个弹提示 */
  window.sxToast = toast;

  /* ============================================================
     7 · 卡片收起 / 恢复
     ============================================================ */
  function collapseCard(el) {
    var h = el.offsetHeight;
    el.dataset.sxCollapsed = '1';
    el.style.overflow = 'hidden';
    el.style.height = h + 'px';
    el.style.transition = 'height .38s ease, opacity .3s ease';
    requestAnimationFrame(function () {
      el.style.height = '0px';
      el.style.opacity = '0';
      el.style.marginTop = '0';
      el.style.marginBottom = '0';
      el.style.paddingTop = '0';
      el.style.paddingBottom = '0';
      el.style.borderTopWidth = '0';
      el.style.borderBottomWidth = '0';
    });
    setTimeout(function () { el.style.display = 'none'; }, 420);
  }
  function restoreCard(el) {
    if (!el) return;
    el.style.display = '';
    el.style.height = 'auto';
    el.style.opacity = '1';
    el.style.overflow = '';
    el.style.marginTop = '';
    el.style.marginBottom = '';
    el.style.paddingTop = '';
    el.style.paddingBottom = '';
    el.style.borderTopWidth = '';
    el.style.borderBottomWidth = '';
    el.style.transition = 'opacity .25s ease';
    setTimeout(function () { el.style.transition = ''; }, 300);
  }

  /* ============================================================
     8 · 第三批 · Snap（点卡片爆裂消除）+ Stream（归档飞向图标）
     ============================================================ */
  var burstBusy = false;   /* 一次只做一个 burst */

  function snapCard(card, ox, oy) {
    if (burstBusy) return;
    if (!card || card.dataset.sxSnapped === '1') return;
    /* 正在汇聚 → 先收掉汇聚，让这一次点击立刻有反馈 */
    if (card._sxCancelGather) { try { card._sxCancelGather(); } catch (e) {} }
    var rect = card.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 30) return;
    var bg = parseRGB(window.getComputedStyle(card).backgroundColor);
    var parts = sampleDom(card, 5, bg);
    if (parts.length < 30) return;
    parts = thin(parts, 3600);

    burstBusy = true;
    card.dataset.sxSnapped = '1';
    var layer = overlayFor(card, rect.width, rect.height);
    card.style.transition = 'opacity .2s ease';
    card.style.opacity = '0';

    var maxD = Math.max(rect.width, rect.height);
    var items = parts.map(function (p) {
      var dx = p.x - ox, dy = p.y - oy;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var push = rand(60, 200);
      return {
        x0: p.x, y0: p.y,
        x1: p.x + (dx / d) * push, y1: p.y + (dy / d) * push,
        delay: (d / maxD) * 340 + rand(0, 60), dur: rand(780, 1150),
        r: p.r, g: p.g, b: p.b, size: rand(2, 4),
        a0: 1, a1: 0, sway: 0, ease: easeInOut
      };
    });
    animate(layer, items, 1500).then(function () {
      removeLayer(layer);
      collapseCard(card);
      burstBusy = false;
      toast('已消除这条简报', function () {
        restoreCard(card);
        delete card.dataset.sxSnapped;
      });
    }).catch(function () {
      removeLayer(layer);
      card.style.opacity = '';
      burstBusy = false;
    });
  }

  /* 顶部归档图标 */
  var archiveIcon = null;
  function ensureArchiveIcon() {
    if (archiveIcon && archiveIcon.parentNode) return archiveIcon;
    var b = document.createElement('button');
    b.className = 'sx-archive-icon';
    b.type = 'button';
    b.title = '归档箱';
    b.setAttribute('aria-label', '归档箱');
    b.innerHTML = ARCHIVE_SVG + '<span class="sx-archive-count">0</span>';
    document.body.appendChild(b);
    archiveIcon = b;
    return b;
  }
  function archiveCount(n) {
    var el = ensureArchiveIcon().querySelector('.sx-archive-count');
    if (el) el.textContent = String(n);
  }
  function popArchiveIcon() {
    var icon = ensureArchiveIcon();
    icon.classList.remove('sx-pop');
    void icon.offsetWidth;
    icon.classList.add('sx-pop');
    setTimeout(function () { icon.classList.remove('sx-pop'); }, 500);
  }

  /* 归档：卡片化作颗粒流飞向顶部图标 */
  function streamCard(card) {
    if (burstBusy) return;
    if (!card || card.dataset.sxStreamed === '1') return;
    if (card._sxCancelGather) { try { card._sxCancelGather(); } catch (e) {} }
    var rect = card.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 30) return;
    var bg = parseRGB(window.getComputedStyle(card).backgroundColor);
    var parts = sampleDom(card, 5, bg);
    if (parts.length < 30) return;
    parts = thin(parts, 3000);

    burstBusy = true;
    card.dataset.sxStreamed = '1';
    var icon = ensureArchiveIcon();
    var ir = icon.getBoundingClientRect();
    var tx = ir.left + ir.width / 2;
    var ty = ir.top + ir.height / 2;

    var layer = screenLayer();
    card.style.transition = 'opacity .2s ease';
    card.style.opacity = '0';

    var items = parts.map(function (p) {
      var sx = rect.left + p.x;
      var sy = rect.top + p.y;
      return {
        x0: sx, y0: sy,
        x1: tx + rand(-10, 10), y1: ty + rand(-8, 8),
        delay: rand(0, 260), dur: rand(820, 1250),
        r: p.r, g: p.g, b: p.b, size: rand(2, 3.6),
        a0: 1, a1: 0, sway: rand(6, 18), ease: easeInOut
      };
    });
    animate(layer, items, 1400).then(function () {
      removeLayer(layer);
      popArchiveIcon();
      collapseCard(card);
      burstBusy = false;
      var countEl = archiveIcon.querySelector('.sx-archive-count');
      var count = parseInt(countEl.textContent, 10) || 0;
      archiveCount(count + 1);
      toast('已归档这条简报', function () {
        restoreCard(card);
        delete card.dataset.sxStreamed;
        var c = parseInt(countEl.textContent, 10) || 0;
        archiveCount(Math.max(0, c - 1));
      });
    }).catch(function () {
      removeLayer(layer);
      card.style.opacity = '';
      burstBusy = false;
    });
  }

  /* 给一张卡加上“归档”按钮并接上 Snap / Stream */
  function wireBriefCard(card) {
    if (!card || card.dataset.sxWired === '1') return;
    card.dataset.sxWired = '1';
    if (window.getComputedStyle(card).position === 'static') card.style.position = 'relative';
    /* 给右上角留出按钮的位置，别压住卡片内容 */
    var cs = window.getComputedStyle(card);
    if (parseFloat(cs.paddingRight) < 46) card.style.paddingRight = '46px';

    var btn = document.createElement('button');
    btn.className = 'sx-archive-btn';
    btn.type = 'button';
    btn.title = '归档';
    btn.setAttribute('aria-label', '归档');
    btn.innerHTML = ARCHIVE_SVG;
    card.appendChild(btn);
    on(btn, 'click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      streamCard(card);
    });

    on(card, 'click', function (e) {
      if (e.target && e.target.closest && e.target.closest('a,button,input,textarea,select')) return;
      var r = card.getBoundingClientRect();
      snapCard(card, (e.clientX || r.left) - r.left, (e.clientY || r.top) - r.top);
    });
  }

  function setupBriefing() {
    var cards = [];
    /* 简报期号页：每条新闻是一个 <article> */
    var arts = document.body.querySelectorAll('article');
    Array.prototype.forEach.call(arts, function (a) {
      if (a.querySelector('h3')) cards.push(a);
    });
    /* 简报存档页：最新一期卡片 + 往期列表项 */
    var latest = document.body.querySelector('.card.latest');
    if (latest) cards.push(latest);
    var items = document.body.querySelectorAll('.archive li');
    Array.prototype.forEach.call(items, function (li) { cards.push(li); });

    if (!cards.length) return;
    ensureArchiveIcon();
    cards.forEach(wireBriefCard);
  }

  /* ============================================================
     9 · 第四批 · MorphButton（保存按钮 morph）
     ============================================================ */
  function readSaveResult() {
    var tip = document.getElementById('rvTip') || document.getElementById('dyTip');
    if (!tip) return true;
    var t = (tip.textContent || '').trim();
    if (!t) return true;
    return /已保存/.test(t);
  }

  function morphSave(btn) {
    if (!btn || btn.dataset.sxMorph === '1') return;
    btn.dataset.sxMorph = '1';
    var ok = readSaveResult();
    var label = btn.textContent;
    var h = btn.offsetHeight || 40;
    btn.disabled = true;
    btn.style.transition = 'width .42s cubic-bezier(.4,0,.2,1), height .42s cubic-bezier(.4,0,.2,1), ' +
      'border-radius .42s ease, padding .42s ease';
    btn.style.width = h + 'px';
    btn.style.height = h + 'px';
    btn.style.padding = '0';
    btn.style.borderRadius = '50%';
    btn.innerHTML = '<span class="sx-spinner" aria-hidden="true"></span>';

    function reset() {
      btn.innerHTML = label;
      btn.style.width = '';
      btn.style.height = '';
      btn.style.padding = '';
      btn.style.borderRadius = '';
      btn.style.transition = '';
      btn.disabled = false;
      delete btn.dataset.sxMorph;
    }
    setTimeout(function () {
      if (!ok) { reset(); return; }
      btn.innerHTML = '已保存 ✓';
      btn.style.width = 'auto';
      btn.style.height = '';
      btn.style.padding = '';
      btn.style.borderRadius = '999px';
      setTimeout(reset, 1300);   /* 0.5s 圆形加载 + 1.3s 成功态 ≈ 1.8s */
    }, 500);
  }

  function setupMorphButton() {
    var btns = document.querySelectorAll('#rvSave, #dySave');
    Array.prototype.forEach.call(btns, function (btn) {
      on(btn, 'click', function () { morphSave(btn); });
    });
  }

  /* ============================================================
     10 · 第四批 · SlideToConfirm（滑动到底才执行不可逆操作）
     ============================================================ */
  var allowDelete = false;

  function stubConfirm() {
    var orig = window.confirm;
    window.confirm = function () { return true; };
    return function () { window.confirm = orig; };
  }

  function makeSlide(host, label, onConfirm) {
    var bar = document.createElement('div');
    bar.className = 'sx-slide';
    var track = document.createElement('div');
    track.className = 'sx-slide-track';
    var fill = document.createElement('span');
    fill.className = 'sx-slide-fill';
    var txt = document.createElement('span');
    txt.className = 'sx-slide-text';
    txt.textContent = label;
    var knob = document.createElement('button');
    knob.className = 'sx-slide-knob';
    knob.type = 'button';
    knob.textContent = '›';
    knob.setAttribute('aria-label', label + '（向右滑动确认）');
    track.appendChild(fill);
    track.appendChild(txt);
    track.appendChild(knob);
    bar.appendChild(track);
    host.appendChild(bar);

    var x = 0, dragging = false, startX = 0, maxX = 0;
    /* 滑块左边缘 3px，右边也留 3px */
    function measure() { maxX = Math.max(0, track.clientWidth - knob.offsetWidth - 6); }
    measure();
    function paint() {
      knob.style.transform = 'translateX(' + x + 'px)';
      fill.style.width = (x + knob.offsetWidth + 3) + 'px';
    }
    function reset() { x = 0; knob.style.transform = ''; paint(); }
    function done() {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
      try { onConfirm(); } catch (e) {}
    }
    on(knob, 'pointerdown', function (e) {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      measure();
      try { knob.setPointerCapture(e.pointerId); } catch (err) {}
      bar.classList.add('sx-slide-active');
    });
    on(knob, 'pointermove', function (e) {
      if (!dragging) return;
      x = clamp(x + (e.clientX - startX), 0, maxX);
      startX = e.clientX;
      paint();
    });
    function up() {
      if (!dragging) return;
      dragging = false;
      bar.classList.remove('sx-slide-active');
      if (maxX > 0 && x >= maxX * 0.88) done();
      else reset();
    }
    on(knob, 'pointerup', up);
    on(knob, 'pointercancel', up);
    on(knob, 'keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(); }
    });
    window.addEventListener('resize', function () { measure(); reset(); });
    return bar;
  }

  function setupSlideConfirm() {
    /* 告诉页面脚本：删除确认已经由滑动条接管，页面里不要再弹 confirm */
    window.__sxSlideConfirm = true;
    on(document, 'click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-del],[data-clear-all]') : null;
      if (!btn) return;
      if (allowDelete) { allowDelete = false; return; }   /* 放行我们自己触发的删除 */
      e.preventDefault();
      e.stopPropagation();

      var host = btn.closest('.entry, .form-card, .card') || btn.parentElement;
      var isClear = btn.hasAttribute('data-clear-all');
      var label = isClear ? '滑到底以清空全部内容' : '滑到底以删除（不可撤销）';

      var old = host.querySelector('.sx-slide');
      if (old && old.parentNode) old.parentNode.removeChild(old);

      makeSlide(host, label, function () {
        allowDelete = true;
        var restore = stubConfirm();
        try { btn.click(); } catch (err) {}
        restore();
        toast(isClear ? '已清空全部内容' : '已删除这条内容');
      });
    }, true);
  }

  /* ============================================================
     11 · 样式（由 JS 注入，保证所有页面一致）
     ============================================================ */
  /* ============================================================
     11 · 新增 · ProgressSteps：滚动点亮编号小节与五步流程
     ============================================================ */
  function setupProgressSteps() {
    if (!('IntersectionObserver' in window)) return;
    var secs = Array.prototype.slice.call(document.querySelectorAll('details.sec'));
    if (secs.length) {
      var current = null;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            if (current && current !== en.target) current.classList.remove('lit');
            current = en.target;
            current.classList.add('lit');
          }
        });
      }, { rootMargin: '-15% 0px -70% 0px' });
      secs.forEach(function (s) { io.observe(s); });
    }
    var flow = document.querySelector('.flow5');
    if (flow) {
      var steps = Array.prototype.slice.call(flow.querySelectorAll('.fstep'));
      var io2 = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          steps.forEach(function (st, i) {
            setTimeout(function () { st.classList.add('lit'); }, i * 130);
          });
          io2.disconnect();
        });
      }, { threshold: 0.25 });
      io2.observe(flow);
    }
  }

  /* ============================================================
     12 · 新增 · Accordion：编号小节平滑开合（details.sec）
     ============================================================ */
  function setupSmoothSections() {
    var secs = document.querySelectorAll('details.sec');
    if (!secs.length) return;
    Array.prototype.forEach.call(secs, function (d) {
      var sum = d.querySelector('summary');
      var body = d.querySelector('.sec-body');
      if (!sum || !body) return;
      var busy = false;
      sum.addEventListener('click', function (e) {
        e.preventDefault();
        if (busy) return;
        busy = true;
        if (d.open) {
          var h = body.offsetHeight;
          body.style.maxHeight = h + 'px';
          body.style.overflow = 'hidden';
          requestAnimationFrame(function () {
            body.style.transition = 'max-height .3s ease, opacity .25s ease';
            body.style.maxHeight = '0px';
            body.style.opacity = '0';
          });
          setTimeout(function () {
            d.open = false;
            body.style.maxHeight = ''; body.style.overflow = '';
            body.style.transition = ''; body.style.opacity = '';
            busy = false;
          }, 300);
        } else {
          d.open = true;
          var h2 = body.offsetHeight;
          body.style.maxHeight = '0px';
          body.style.overflow = 'hidden';
          body.style.opacity = '0';
          requestAnimationFrame(function () {
            body.style.transition = 'max-height .3s ease, opacity .25s ease';
            body.style.maxHeight = h2 + 'px';
            body.style.opacity = '1';
          });
          setTimeout(function () {
            body.style.maxHeight = ''; body.style.overflow = '';
            body.style.transition = ''; body.style.opacity = '';
            busy = false;
          }, 320);
        }
      });
    });
  }

  /* ============================================================
     13 · 新增 · Tooltip：术语表悬停解释（论文页）
     ============================================================ */
  function cleanTip(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/\$([^$]+)\$/g, function (m, inner) {
      return inner.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '');
    });
    if (s.length > 120) s = s.slice(0, 120).replace(/\s+\S*$/, '') + '…';
    return s;
  }
  function setupTermTooltips() {
    var kv = document.querySelector('dl.kv');
    var article = document.querySelector('.article');
    if (!kv || !article) return;
    var terms = [];
    Array.prototype.forEach.call(kv.querySelectorAll('dt'), function (dt) {
      var dd = dt.nextElementSibling;
      if (!dd || dd.tagName !== 'DD') return;
      var term = (dt.textContent || '').trim();
      var tip = cleanTip(dd.textContent || '');
      if (term && tip && term.length >= 2) terms.push({ term: term, tip: tip });
    });
    if (!terms.length) return;
    terms.sort(function (a, b) { return b.term.length - a.term.length; });
    var done = {};
    var SKIP = { PRE: 1, CODE: 1, A: 1, DL: 1, FIGURE: 1, ASIDE: 1, SCRIPT: 1, STYLE: 1, BUTTON: 1, SUMMARY: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };
    function inSkip(node) {
      var p = node.parentElement;
      while (p && p !== article) {
        if (SKIP[p.tagName]) return true;
        if (p.classList && (p.classList.contains('katex') || p.classList.contains('sx-term'))) return true;
        p = p.parentElement;
      }
      return false;
    }
    var walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      if (inSkip(node)) return;
      var cur = node, guard = 0;
      while (cur && cur.nodeValue && guard++ < 8) {
        var text = cur.nodeValue, best = null;
        terms.forEach(function (t) {
          if (done[t.term]) return;
          var idx = text.indexOf(t.term);
          if (idx >= 0 && (!best || idx < best.idx)) best = { term: t, idx: idx };
        });
        if (!best) break;
        done[best.term.term] = true;
        var span = document.createElement('span');
        span.className = 'sx-term';
        span.setAttribute('tabindex', '0');
        span.setAttribute('data-tip', best.term.tip);
        var before = cur.splitText(best.idx);
        var after = before.splitText(best.term.term.length);
        span.textContent = before.nodeValue;
        before.parentNode.replaceChild(span, before);
        cur = after;
      }
    });
  }

  /* ============================================================
     14 · 新增 · Print：核心论点逐行打印出现（论文页）
     ============================================================ */
  function setupThesisPrint() {
    var th = document.querySelector('.thesis');
    if (!th || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        printReveal(th);
        io.disconnect();
      });
    }, { threshold: 0.2 });
    io.observe(th);
  }

  /* ============================================================
     15 · 新增 · BarChart：实验条形图滚入时生长（论文页）
     ============================================================ */
  function setupBarGrow() {
    var bars = Array.prototype.slice.call(document.querySelectorAll('.bar-row .bar'));
    if (!bars.length || !('IntersectionObserver' in window)) return;
    bars.forEach(function (bar) {
      var w = bar.style.width || '';
      if (!w) return;
      bar.dataset.sxW = w;
      bar.style.width = '0%';
    });
    var rows = Array.prototype.slice.call(document.querySelectorAll('.bar-row'));
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var row = en.target;
        var bar = row.querySelector('.bar');
        if (bar && bar.dataset.sxW) {
          setTimeout(function () { bar.style.width = bar.dataset.sxW; }, Math.max(0, rows.indexOf(row)) * 70);
        }
        io.unobserve(row);
      });
    }, { threshold: 0.3 });
    rows.forEach(function (row) { io.observe(row); });
    /* 兜底：2.5 秒后无论如何恢复宽度，绝不让图表一直空着 */
    setTimeout(function () {
      bars.forEach(function (bar) { if (bar.dataset.sxW) bar.style.width = bar.dataset.sxW; });
    }, 2500);
  }

  /* ============================================================
     16 · 新增 · SegmentedControl：导航栏滑动 pill（全站）
     ============================================================ */
  function setupNavPill() {
    var inner = document.querySelector('.site-nav .nav-inner');
    var links = document.querySelector('.site-nav .nav-links');
    if (!inner || !links) return;
    var active = links.querySelector('a.active');
    var brand = inner.querySelector('.brand');
    var target = active || brand;
    if (!target) return;
    var pill = document.createElement('span');
    pill.className = 'sx-nav-pill';
    pill.setAttribute('aria-hidden', 'true');
    inner.insertBefore(pill, inner.firstChild);
    function tint() {
      /* 首页/博客没有 active 项，pill 停在品牌上，用首页粉色 */
      if (!active) return 'rgba(224,82,138,.12)';
      var c = window.getComputedStyle(target).color || '';
      var m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 'rgba(224,82,138,.12)';
      return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',.12)';
    }
    function place(el, animate) {
      var r = el.getBoundingClientRect();
      var ir = inner.getBoundingClientRect();
      if (!animate) pill.style.transition = 'none';
      pill.style.left = (r.left - ir.left) + 'px';
      pill.style.top = (r.top - ir.top) + 'px';
      pill.style.width = r.width + 'px';
      pill.style.height = r.height + 'px';
      pill.style.background = tint();
      if (!animate) {
        void pill.offsetWidth;
        pill.style.transition = '';
      }
    }
    /* 初始停在品牌处，随后滑到当前栏目（首页则直接在品牌上淡入） */
    place(brand || target, false);
    pill.style.opacity = '0';
    function slideIn() {
      place(target, true);
      pill.style.opacity = '1';
    }
    requestAnimationFrame(function () { requestAnimationFrame(slideIn); });
    window.addEventListener('load', function () { place(target, false); });
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { place(target, false); }, 120);
    });
  }

  /* ============================================================
     17 · 新增 · 阅读进度条（文章页）与回到顶部（全站）
     ============================================================ */
  function setupReadingProgress() {
    var fill = document.createElement('div');
    fill.className = 'sx-progress-fill';
    var bar = document.createElement('div');
    bar.className = 'sx-progress';
    bar.appendChild(fill);
    document.body.appendChild(bar);
    var active = document.querySelector('.nav-links a.active');
    var c = active ? window.getComputedStyle(active).color : '';
    var m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    fill.style.background = m ? 'rgb(' + m[1] + ',' + m[2] + ',' + m[3] + ')' : '#e0528a';
    var ticking = false;
    function update() {
      ticking = false;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var p = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
      fill.style.width = (p * 100).toFixed(2) + '%';
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }
  function setupBackToTop() {
    var btn = document.createElement('button');
    btn.className = 'sx-top' + (document.getElementById('playerFab') ? ' sx-top-player' : '');
    btn.setAttribute('aria-label', '回到顶部');
    btn.textContent = '↑';
    document.body.appendChild(btn);
    var shown = false;
    function update() {
      var show = window.scrollY > 600;
      if (show === shown) return;
      shown = show;
      btn.classList.toggle('show', show);
    }
    window.addEventListener('scroll', function () { requestAnimationFrame(update); }, { passive: true });
    btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    update();
  }

  function injectStyle() {
    if (document.getElementById('sx-style')) return;
    var css = [
      '.sx-canvas{position:absolute;pointer-events:none;z-index:5;}',
      '.sx-fx-canvas{position:fixed;left:0;top:0;z-index:58;}',
      /* Toast */
      '.sx-toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:80;',
      'display:flex;align-items:center;gap:.7rem;background:#fffdf8;border:1px solid #e0528a;',
      'box-shadow:0 8px 24px rgba(224,82,138,.16);border-radius:999px;padding:.5rem .55rem .5rem 1rem;',
      'font-size:.9rem;color:#1d2333;opacity:0;transition:opacity .25s ease,transform .25s ease;',
      'max-width:min(90vw,420px);}',
      '.sx-toast{opacity:1;}',
      /* 阅读进度条 */
      '.sx-progress{position:fixed;left:0;top:0;right:0;height:3px;z-index:70;pointer-events:none;background:transparent;}',
      '.sx-progress-fill{display:block;height:100%;width:0%;background:#e0528a;}',
      /* 回到顶部 */
      '.sx-top{position:fixed;right:1rem;bottom:1rem;z-index:65;width:44px;height:44px;border-radius:50%;',
      'border:1px solid #f1e3e6;background:#fffdf8;color:#1d2333;font-size:1.15rem;cursor:pointer;',
      'box-shadow:0 8px 20px rgba(29,35,51,.14);opacity:0;visibility:hidden;transform:translateY(8px);',
      'transition:opacity .25s ease,transform .25s ease,visibility .25s;}',
      '.sx-top.show{opacity:1;visibility:visible;transform:none;}',
      '.sx-top:hover{background:#fdf0f5;}',
      '.sx-top-player{bottom:5.25rem;}',
      '.sx-toast-out{opacity:0;transform:translateX(-50%) translateY(-6px);}',
      '.sx-toast-msg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.sx-toast-undo{border:0;background:#e0528a;color:#fff;border-radius:999px;padding:.25rem .8rem;',
      'font-size:.82rem;cursor:pointer;white-space:nowrap;}',
      '.sx-toast-undo:hover{background:#c2437c;}',
      /* 顶部归档图标 */
      '.sx-archive-icon{position:fixed;right:16px;top:14px;z-index:56;display:flex;align-items:center;gap:.3rem;',
      'background:#fffdf8;border:1px solid #e9d6bd;border-radius:999px;padding:.3rem .7rem;cursor:default;',
      'box-shadow:0 6px 18px rgba(29,35,51,.10);font-size:1rem;}',
      '.sx-archive-count{font-size:.78rem;color:#e0528a;font-weight:700;min-width:.9rem;text-align:center;}',
      '.sx-archive-icon.sx-pop{animation:sx-pop .45s ease;}',
      '@keyframes sx-pop{0%{transform:scale(1)}35%{transform:scale(1.22)}100%{transform:scale(1)}}',
      /* 卡片上的归档小按钮 */
      '.sx-archive-btn{position:absolute;right:.55rem;top:.55rem;z-index:6;border:1px solid #e9d6bd;',
      'background:#fffdf8;border-radius:999px;width:30px;height:30px;line-height:1;font-size:.95rem;',
      'cursor:pointer;opacity:.5;transition:opacity .2s ease,transform .2s ease;}',
      '.sx-archive-btn:hover{opacity:1;transform:translateY(-1px);}',
      /* 滑动确认 */
      '.sx-slide{margin-top:.7rem;width:100%;}',
      '.sx-slide-track{position:relative;height:40px;border-radius:999px;width:100%;',
      'background:#fdf3f7;border:1px solid #e9d6bd;overflow:hidden;}',
      '.sx-slide-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:#fbe0ea;}',
      '.sx-slide-text{position:absolute;left:0;right:0;top:0;bottom:0;z-index:1;display:flex;',
      'align-items:center;justify-content:center;font-size:.85rem;color:#c2437c;',
      'user-select:none;transition:opacity .2s ease;pointer-events:none;}',
      '.sx-slide-knob{position:absolute;left:3px;top:3px;z-index:2;border:0;border-radius:999px;',
      'width:34px;height:34px;background:#e0528a;color:#fff;font-size:1.1rem;line-height:1;',
      'cursor:grab;touch-action:none;}',
      '.sx-slide-knob:active{cursor:grabbing;}',
      '.sx-slide-active .sx-slide-text{opacity:.35;}',
      /* 按钮 morph */
      '.sx-spinner{display:inline-block;width:16px;height:16px;border-radius:50%;',
      'border:2px solid rgba(255,255,255,.45);border-top-color:#fff;animation:sx-spin .7s linear infinite;}',
      '@keyframes sx-spin{to{transform:rotate(360deg)}}',
      /* ---- bencho 借鉴 · 搜索按钮与 ⌘K 浮层 ---- */
      '.sx-search-btn{margin-left:auto;flex:0 0 auto;display:flex;align-items:center;gap:.4rem;',
      'background:#f3efe6;border:1px solid #e3ded2;border-radius:999px;padding:.42rem .8rem;',
      'font-size:.88rem;font-weight:600;color:#5b6478;cursor:pointer;font-family:inherit;}',
      '.sx-search-btn:hover{background:#fdf0f5;color:#c2437c;border-color:#f1e3e6;}',
      '.sx-search-btn kbd{font-family:inherit;font-size:.72rem;background:#fff;border:1px solid #e3ded2;',
      'border-radius:5px;padding:.05rem .35rem;color:#8a8fa0;}',
      '@media (max-width:640px){.sx-search-btn kbd{display:none}.sx-search-btn{padding:.42rem .6rem}}',
      '.sx-palette{position:fixed;inset:0;z-index:90;}',
      '.sx-palette[hidden]{display:none;}',
      '.sx-palette-backdrop{position:absolute;inset:0;background:rgba(29,35,51,.38);backdrop-filter:blur(4px);}',
      '.sx-palette-panel{position:relative;margin:12vh auto 0;width:min(600px,calc(100vw - 32px));',
      'background:#fffdf8;border:1px solid #e3ded2;border-radius:16px;box-shadow:0 24px 64px rgba(29,35,51,.22);',
      'overflow:hidden;animation:sx-pal-in .18s ease;}',
      '@keyframes sx-pal-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}',
      '.sx-palette-input{width:100%;border:0;border-bottom:1px solid #efe9dc;background:transparent;',
      'padding:1rem 1.2rem;font-size:1.05rem;font-family:inherit;color:#1d2333;outline:none;}',
      '.sx-palette-input::placeholder{color:#9aa0ae;}',
      '.sx-palette-body{max-height:min(52vh,420px);overflow-y:auto;padding:.4rem .5rem .7rem;}',
      '.sx-palette-group{font-size:.72rem;font-weight:700;letter-spacing:.08em;color:#8a8fa0;',
      'padding:.7rem .7rem .3rem;text-transform:uppercase;}',
      '.sx-palette-row{display:flex;align-items:baseline;gap:.6rem;width:100%;text-align:left;',
      'border:0;background:transparent;padding:.55rem .7rem;border-radius:10px;cursor:pointer;font-family:inherit;}',
      '.sx-palette-row:hover,.sx-palette-row.active{background:#fdf0f5;}',
      '.sx-palette-row .t{font-size:.95rem;color:#1d2333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.sx-palette-row .d{margin-left:auto;flex:0 0 auto;font-size:.78rem;color:#9aa0ae;white-space:nowrap;}',
      '.sx-palette-empty{padding:1.2rem;text-align:center;color:#9aa0ae;font-size:.92rem;}',
      '.sx-palette-hint{padding:.55rem 1.2rem;border-top:1px solid #efe9dc;font-size:.75rem;color:#9aa0ae;}',
      '.sx-palette-hint b{color:#5b6478;font-weight:600;}',
      /* ---- bencho 借鉴 · 章节胶囊导航 ---- */
      '.sx-secnav{display:flex;align-items:center;gap:.35rem;',
      'overflow-x:auto;scrollbar-width:none;background:rgba(255,253,248,.92);',
      'border:1px solid #e3ded2;border-radius:999px;padding:.3rem .5rem;margin:0 0 1.4rem;',
      'mask-image:linear-gradient(90deg,#000 88%,transparent);',
      '-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);}',
      '.sx-secnav::-webkit-scrollbar{display:none;}',
      '.sx-secnav-label{flex:0 0 auto;font-size:.72rem;font-weight:700;color:#9aa0ae;padding:0 .35rem 0 .5rem;}',
      '.sx-secnav a{flex:0 0 auto;padding:.32rem .7rem;border-radius:999px;font-size:.85rem;color:#5b6478;',
      'white-space:nowrap;text-decoration:none;}',
      '.sx-secnav a:hover{background:#fdf0f5;color:#c2437c;text-decoration:none;}',
      '.sx-secnav a.active{background:#e0528a;color:#fff;font-weight:700;}',
      'details.sec,h2.sec-num{scroll-margin-top:96px;}',
      /* ---- bencho 借鉴 · 首页数据条 ---- */
      '.sx-stats{display:flex;justify-content:center;gap:2.6rem;flex-wrap:wrap;padding:1.6rem 1rem .4rem;text-align:center;}',
      '.sx-stats .num{font-size:1.7rem;font-weight:700;line-height:1.1;}',
      '.sx-stats .lab{font-size:.82rem;color:#8a8fa0;margin-top:.15rem;}',
      '@media (max-width:640px){.sx-stats{gap:1.6rem;padding-top:1.2rem}}',
      /* ---- bencho 借鉴 · 半调圆点带（SVG 圆点，不用渐变） ---- */
      '.sx-dots{height:42px;background-size:28px 42px;background-repeat:repeat-x;',
      'background-position:center top;opacity:.55;}',
      /* ---- bencho 借鉴 · 页脚 ---- */
      '.sx-footer{border-top:1px solid #e3ded2;background:#fffdf8;}',
      '.sx-footer-inner{max-width:1120px;margin:0 auto;padding:2.4rem 1.25rem 1.6rem;display:flex;gap:2.5rem;flex-wrap:wrap;}',
      '.sx-footer-brand{flex:0 0 200px;min-width:200px;}',
      '.sx-footer-name{font-family:"Water Brush","Yuji Boku",cursive;font-size:2rem;color:#141414;line-height:1;}',
      '.sx-footer-brand p{margin:.7rem 0 0;font-size:.9rem;color:#5b6478;line-height:1.7;}',
      '.sx-footer-cols{flex:1 1 560px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1.5rem;}',
      '.sx-footer-col{min-width:0;}',
      '@media (max-width:720px){.sx-footer-cols{grid-template-columns:repeat(2,minmax(0,1fr));}}',
      '.sx-footer-col h4{margin:0 0 .6rem;font-size:.78rem;letter-spacing:.08em;color:#8a8fa0;text-transform:uppercase;}',
      '.sx-footer-col a{display:block;padding:.22rem 0;font-size:.9rem;color:#5b6478;text-decoration:none;}',
      '.sx-footer-col a:hover{color:#c2437c;text-decoration:none;}',
      '.sx-footer-bottom{border-top:1px solid #efe9dc;padding:.9rem 1.25rem;text-align:center;font-size:.8rem;color:#9aa0ae;}',
      /* ---- bencho 借鉴 · 倾斜过渡 ---- */
      '.sx-tilt{transition:transform .18s ease-out;will-change:transform;}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'sx-style';
    st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  /* ============================================================
     13 · bencho 借鉴（2026-11-27）
     学 bencho.dev 的做法，按本站暖白 + 粉的身份改编，不照搬它的黑白灰：
       SearchPalette   ⌘K 唤起的全站搜索浮层（分组 + 数量 + 键盘导航）
       SectionCapsules 文章页章节胶囊导航（bencho Docs 的 "On this page"）
       StatsStrip      首页数据条（bencho 的社会证明条，数字从存档现算）
       Tilt / Magnetic 卡片 3D 倾斜 + 按钮磁吸（bencho 的 tilt / magnetic）
       Halftone        半调圆点带（bencho 的 halftone 质感，SVG 圆点，不用渐变）
       SiteFooter      全站页脚（大字标 + 分栏链接 + 各栏最新 3 条）
       CodeCopy        给没有复制按钮的代码块补上（沿用 effects.js 的委托处理）
     ============================================================ */

  /* 半调圆点 SVG（data URI，圆点由大到小排三行，模拟 bencho 的渐隐质感） */
  var DOTS_URI = 'data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2728%27%20height=%2742%27%3E%3Cg%20fill=%27%23d9cfc2%27%3E%3Ccircle%20cx=%277%27%20cy=%277%27%20r=%272.6%27/%3E%3Ccircle%20cx=%2721%27%20cy=%277%27%20r=%272.6%27/%3E%3Ccircle%20cx=%277%27%20cy=%2721%27%20r=%271.9%27/%3E%3Ccircle%20cx=%2721%27%20cy=%2721%27%20r=%271.9%27/%3E%3Ccircle%20cx=%277%27%20cy=%2735%27%20r=%271.2%27/%3E%3Ccircle%20cx=%2721%27%20cy=%2735%27%20r=%271.2%27/%3E%3C/g%3E%3C/svg%3E';

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function makeDots() {
    var d = document.createElement('div');
    d.className = 'sx-dots';
    d.setAttribute('aria-hidden', 'true');
    d.style.backgroundImage = 'url("' + DOTS_URI + '")';
    return d;
  }

  /* ---- ⌘K 全站搜索 ---- */
  function setupSearchPalette() {
    var navInner = document.querySelector('.site-nav .nav-inner');
    var navLinks = navInner && navInner.querySelector('.nav-links');
    if (!navInner || !navLinks) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sx-search-btn';
    btn.setAttribute('aria-label', '搜索全站');
    btn.innerHTML = '搜索 <kbd>⌘K</kbd>';
    navInner.insertBefore(btn, navLinks.nextSibling);

    var overlay = document.createElement('div');
    overlay.className = 'sx-palette';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="sx-palette-backdrop"></div>' +
      '<div class="sx-palette-panel" role="dialog" aria-label="站内搜索">' +
      '<input class="sx-palette-input" type="text" placeholder="搜索论文、课程、简报…" autocomplete="off">' +
      '<div class="sx-palette-body"></div>' +
      '<div class="sx-palette-hint"><b>↑↓</b> 选择 · <b>Enter</b> 打开 · <b>Esc</b> 关闭</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var input = overlay.querySelector('.sx-palette-input');
    var body = overlay.querySelector('.sx-palette-body');
    var index = window.SX_SEARCH_INDEX || [];
    var GROUPS = ['论文精读', 'RL 精讲', '每日简报', '博客', '首页'];
    var rows = [];
    var active = -1;
    var lastFocus = null;

    function setActive(i) {
      active = i;
      rows.forEach(function (r, j) { r.classList.toggle('active', j === i); });
      if (rows[i] && rows[i].scrollIntoView) rows[i].scrollIntoView({ block: 'nearest' });
    }
    function render(q) {
      q = (q || '').trim().toLowerCase();
      var html = '';
      var list = [];
      GROUPS.forEach(function (g) {
        var items = index.filter(function (it) { return it.g === g; });
        if (q) {
          items = items.filter(function (it) {
            return (it.t + ' ' + it.d + ' ' + (it.k || '')).toLowerCase().indexOf(q) !== -1;
          });
        } else {
          items = items.slice(0, 3);
        }
        if (!items.length) return;
        html += '<div class="sx-palette-group">' + g + ' · ' + items.length + '</div>';
        items.forEach(function (it) {
          list.push(it);
          html += '<button type="button" class="sx-palette-row" data-u="' + escHtml(it.u) + '">' +
            '<span class="t">' + escHtml(it.t) + '</span>' +
            '<span class="d">' + escHtml(it.d) + '</span></button>';
        });
      });
      if (!list.length) {
        html = index.length
          ? '<div class="sx-palette-empty">没找到相关内容，换个词试试</div>'
          : '<div class="sx-palette-empty">搜索索引未加载</div>';
      }
      body.innerHTML = html;
      rows = Array.prototype.slice.call(body.querySelectorAll('.sx-palette-row'));
      setActive(rows.length ? 0 : -1);
    }
    function open() {
      lastFocus = document.activeElement;
      overlay.hidden = false;
      input.value = '';
      render('');
      input.focus();
    }
    function close() {
      overlay.hidden = true;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    btn.addEventListener('click', open);
    overlay.querySelector('.sx-palette-backdrop').addEventListener('click', close);
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (rows.length) setActive((active + 1) % rows.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (rows.length) setActive((active - 1 + rows.length) % rows.length); }
      else if (e.key === 'Enter') { if (rows[active]) location.href = rows[active].getAttribute('data-u'); }
      else if (e.key === 'Escape') { close(); }
    });
    body.addEventListener('click', function (e) {
      var r = e.target.closest && e.target.closest('.sx-palette-row');
      if (r) location.href = r.getAttribute('data-u');
    });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
      else if (e.key === 'Escape' && !overlay.hidden) { close(); }
    });
  }

  /* ---- 文章页章节胶囊导航 ---- */
  function setupSectionCapsules() {
    var path = location.pathname || '';
    var isPaper = /\/papers\/[^/]+\.html$/.test(path);
    var isLesson = /\/rl\/lesson-[^/]*\.html$/.test(path);
    var secs = [];
    if (isPaper) {
      secs = Array.prototype.slice.call(document.querySelectorAll('h2.sec-num')).map(function (h) {
        return { el: h, label: h.textContent.trim() };
      });
    } else if (isLesson) {
      secs = Array.prototype.slice.call(document.querySelectorAll('details.sec')).map(function (d) {
        var t = d.querySelector('.sec-title');
        return { el: d, label: t ? t.textContent.trim() : '' };
      }).filter(function (s) { return s.label; });
    }
    if (secs.length < 3) return;
    var nav = document.createElement('nav');
    nav.className = 'sx-secnav';
    nav.setAttribute('aria-label', '本节导航');
    var html = '<span class="sx-secnav-label">本节</span>';
    secs.forEach(function (s, i) {
      if (!s.el.id) s.el.id = 'sx-sec-' + i;
      html += '<a href="#' + s.el.id + '" data-i="' + i + '">' + escHtml(s.label) + '</a>';
    });
    nav.innerHTML = html;
    var first = secs[0].el;
    first.parentNode.insertBefore(nav, first);
    var links = Array.prototype.slice.call(nav.querySelectorAll('a'));
    function spy() {
      var y = window.scrollY + 150;
      var cur = 0;
      secs.forEach(function (s, i) {
        if (s.el.getBoundingClientRect().top + window.scrollY <= y) cur = i;
      });
      links.forEach(function (a, i) { a.classList.toggle('active', i === cur); });
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { spy(); ticking = false; });
    }, { passive: true });
    nav.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      var s = secs[+a.getAttribute('data-i')];
      if (isLesson && s.el.tagName === 'DETAILS') s.el.open = true;
      s.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    spy();
  }

  /* ---- 首页数据条 ---- */
  function setupStatsStrip() {
    var hero = document.getElementById('hero');
    var contents = document.getElementById('contents');
    if (!hero || !contents) return;
    function count(sel) { return document.querySelectorAll(sel).length; }
    var data = [
      { n: count('#papers .archive li'), c: '#c2410c', l: '论文精读' },
      { n: count('#rl .archive li'), c: '#d97706', l: 'RL 精讲' },
      { n: count('#briefing .archive li'), c: '#0f766e', l: '每日简报' }
    ];
    if (!data[0].n && !data[1].n && !data[2].n) return;
    var div = document.createElement('div');
    div.className = 'sx-stats';
    div.setAttribute('aria-label', '内容统计');
    div.innerHTML = data.map(function (d) {
      return '<div><div class="num" style="color:' + d.c + '">' + d.n + '</div><div class="lab">' + d.l + '</div></div>';
    }).join('');
    contents.parentNode.insertBefore(makeDots(), contents);
    contents.parentNode.insertBefore(div, contents);
  }

  /* ---- 卡片 3D 倾斜 ---- */
  var tiltReady = false;
  function setupTilt() {
    if (!window.matchMedia || !window.matchMedia('(pointer:fine)').matches) return;
    setTimeout(function () { tiltReady = true; }, 1200);
    var cards = document.querySelectorAll('.card.split, .paper-card, .lesson-card');
    Array.prototype.forEach.call(cards, function (card) {
      card.classList.add('sx-tilt');
      card.addEventListener('pointermove', function (e) {
        if (!tiltReady) return;
        var r = card.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = 'perspective(900px) rotateY(' + (x * 4).toFixed(2) +
          'deg) rotateX(' + (-y * 4).toFixed(2) + 'deg)';
      });
      card.addEventListener('pointerleave', function () { card.style.transform = ''; });
    });
  }

  /* ---- 按钮磁吸 ---- */
  function setupMagnetic() {
    if (!window.matchMedia || !window.matchMedia('(pointer:fine)').matches) return;
    var els = document.querySelectorAll('.sx-search-btn, .copybtn, .spec-copy');
    Array.prototype.forEach.call(els, function (el) {
      el.style.transition = 'transform .15s ease-out';
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = 'translate(' + (dx * 0.2).toFixed(1) + 'px,' + (dy * 0.2).toFixed(1) + 'px)';
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }

  /* ---- 全站页脚 ---- */
  function setupSiteFooter() {
    if (document.querySelector('.sx-footer')) return;
    var index = window.SX_SEARCH_INDEX || [];
    function latest(g, n) {
      return index.filter(function (it) { return it.g === g; }).slice(0, n);
    }
    function col(title, listUrl, listLabel, links) {
      var h = '<div class="sx-footer-col"><h4>' + title + '</h4>';
      links.forEach(function (l) { h += '<a href="' + l.u + '">' + escHtml(l.label) + '</a>'; });
      h += '<a href="' + listUrl + '">' + listLabel + ' →</a></div>';
      return h;
    }
    var cols = '';
    var p = latest('论文精读', 3);
    var r = latest('RL 精讲', 3);
    var b = latest('每日简报', 3);
    if (p.length) cols += col('论文精读', '/papers.html', '全部精读', p.map(function (it) { return { u: it.u, label: it.d }; }));
    if (r.length) cols += col('RL 精讲', '/rl.html', '全部课程', r.map(function (it) { return { u: it.u, label: it.t }; }));
    if (b.length) cols += col('每日简报', '/briefing.html', '全部简报', b.map(function (it) { return { u: it.u, label: it.t }; }));
    cols += '<div class="sx-footer-col"><h4>更多</h4>' +
      '<a href="/review.html">每日复盘</a><a href="/diary.html">日记</a>' +
      '<a href="/blog.html">博客</a><a href="https://github.com/Jocehi" target="_blank" rel="noopener">GitHub</a></div>';
    var foot = document.createElement('footer');
    foot.className = 'sx-footer';
    foot.innerHTML =
      '<div class="sx-footer-inner">' +
      '<div class="sx-footer-brand"><span class="sx-footer-name">Jocehi</span>' +
      '<p>世界模型 · 强化学习<br>每天一篇精读、每天一课 RL、每天一份简报。</p></div>' +
      '<nav class="sx-footer-cols" aria-label="页脚导航">' + cols + '</nav></div>' +
      '<div class="sx-footer-bottom">© 2026 Jocehi · jocehi.loc.cc</div>';
    document.body.appendChild(makeDots());
    document.body.appendChild(foot);
  }

  /* ---- 给没有复制按钮的代码块补上 ---- */
  function setupCodeCopy() {
    var pres = document.querySelectorAll('pre.code');
    Array.prototype.forEach.call(pres, function (pre) {
      if (pre.querySelector('.copybtn')) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'copybtn';
      b.textContent = '复制代码';
      pre.insertBefore(b, pre.firstChild);
    });
  }

  /* ============================================================
     12 · 路由
     ============================================================ */
  function start() {
    var path = location.pathname || '';
    setupNavPill();
    setupBackToTop();
    setupSearchPalette();
    setupCodeCopy();
    setupMagnetic();
    setupTilt();
    setupSiteFooter();
    var isBriefIndex = /\/briefing\.html$/.test(path);
    var isBriefIssue = /\/briefing\/[^/]+\.html$/.test(path);
    var isPaper = /\/papers\/[^/]+\.html$/.test(path);
    var isLesson = /\/rl\/lesson-[^/]*\.html$/.test(path);
    var isPapersList = /\/papers\.html$/.test(path);
    var isRlList = /\/rl\.html$/.test(path);
    var isForm = /\/review\.html$/.test(path) || /\/diary\.html$/.test(path);
    var isIndex = /(\/index\.html|\/)$/.test(path);

    if (isPaper || isLesson) {
      if (canCanvas) setupImageReveal();
      setupPrint();
      setupProgressSteps();
      setupReadingProgress();
      setupSectionCapsules();
    }
    if (isIndex) setupStatsStrip();
    if (isPaper) {
      setupTermTooltips();
      setupThesisPrint();
      setupBarGrow();
    }
    if (isLesson) {
      setupSmoothSections();
    }
    if (isPapersList || isRlList || isBriefIndex) {
      if (canCanvas) setupListGather();
    }
    if (isBriefIndex || isBriefIssue) {
      if (canCanvas) setupBriefing();
    }
    if (isBriefIssue) setupReadingProgress();
    if (isForm) {
      setupMorphButton();
      setupSlideConfirm();
    }
  }

  if (reduceMotion) {
    /* 全部跳过：原样显示，不做任何隐藏与动画 */
    return;
  }
  injectStyle();
  if (document.readyState === 'loading') on(document, 'DOMContentLoaded', start);
  else start();
})();

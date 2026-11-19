/* headless 验收脚本：node test/run.js */
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8099;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rep) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rep.writeHead(404); rep.end('404'); return;
      }
      rep.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rep);
    });
    srv.listen(PORT, () => res(srv));
  });
}

const errors = [];
function attach(page, label) {
  page.on('pageerror', e => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('favicon')) {
      errors.push(`[${label}] console.error: ${m.text()}`);
    }
  });
  page.on('response', r => { if (r.status() >= 400) errors.push(`[${label}] HTTP ${r.status()}: ${r.url()}`); });
  page.on('requestfailed', r => {
    const u = r.url();
    if (u.includes('fonts.g') || u.includes('favicon')) return;
    errors.push(`[${label}] requestfailed: ${u} ${r.failure() && r.failure().errorText}`);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const results = {};

  async function open(url, label) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    attach(page, label);
    await page.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'networkidle2', timeout: 45000 });
    return page;
  }

  /* ---------- 第一批 A · Print（rl/lesson-5.html） ---------- */
  {
    const page = await open('/rl/lesson-5.html', 'rl/lesson-5.html');
    const opened = await page.evaluate(() => {
      const d = document.querySelector('details.qa');
      if (!d) return { err: 'no-details' };
      d.open = true;
      d.dispatchEvent(new Event('toggle'));
      const box = d.querySelector('.ans');
      return {
        clip: box ? getComputedStyle(box).clipPath : null,
        textLen: box ? box.textContent.length : 0,
        pCount: box ? box.querySelectorAll('p').length : 0,
        katex: document.querySelectorAll('.katex').length,
        katexMathml: document.querySelectorAll('.katex-mathml').length,
        htmlBefore: box ? box.innerHTML.length : 0
      };
    });
    await sleep(400);
    const mid = await page.evaluate(() => {
      const box = document.querySelector('details.qa .ans');
      return box ? getComputedStyle(box).clipPath : null;
    });
    await sleep(2400);
    const after = await page.evaluate(() => {
      const box = document.querySelector('details.qa .ans');
      return {
        clip: box ? getComputedStyle(box).clipPath : null,
        textLen: box ? box.textContent.length : 0,
        pCount: box ? box.querySelectorAll('p').length : 0,
        htmlAfter: box ? box.innerHTML.length : 0,
        katex: document.querySelectorAll('.katex').length
      };
    });
    results.batch1_print = { opened, mid, after };
    await page.close();
  }

  /* ---------- 第一批 B · ImageReveal（papers/dreamerv2.html） ---------- */
  {
    const page = await open('/papers/dreamerv2.html', 'papers/dreamerv2.html');
    const before = await page.evaluate(() => {
      const im = document.querySelector('figure img');
      return { op: im ? im.style.opacity : null, revealed: im ? im.dataset.sxRevealed : null };
    });
    await page.evaluate(() => document.querySelector('figure').scrollIntoView({ block: 'center' }));
    await sleep(1200);
    const during = await page.evaluate(() => {
      const im = document.querySelector('figure img');
      return {
        op: im ? im.style.opacity : null,
        canvases: document.querySelectorAll('.sx-canvas').length,
        revealed: im ? im.dataset.sxRevealed : null
      };
    });
    await sleep(3200);
    const after = await page.evaluate(() => {
      const im = document.querySelector('figure img');
      const f = document.querySelector('figure');
      return {
        op: im ? im.style.opacity : null,
        revealed: im ? im.dataset.sxRevealed : null,
        canvases: document.querySelectorAll('.sx-canvas').length,
        katex: document.querySelectorAll('.katex').length,
        figText: f ? f.textContent.trim().length : 0,
        imgVisible: im ? getComputedStyle(im).opacity : null
      };
    });
    // 再滚到第二张图，确认每张只动一次
    await page.evaluate(() => {
      const fs = document.querySelectorAll('figure');
      if (fs[1]) fs[1].scrollIntoView({ block: 'center' });
    });
    await sleep(3000);
    const second = await page.evaluate(() => {
      const ims = document.querySelectorAll('figure img');
      return {
        flags: Array.from(ims).map(i => i.dataset.sxRevealed),
        ops: Array.from(ims).map(i => i.style.opacity),
        canvases: document.querySelectorAll('.sx-canvas').length
      };
    });
    results.batch1_image = { before, during, after, second };
    await page.close();
  }

  /* ---------- 第二批 · 列表页 ---------- */
  for (const url of ['/papers.html', '/rl.html']) {
    const page = await open(url, url);
    await sleep(300);
    const during = await page.evaluate(() => {
      const c = document.querySelector('.paper-card, .lesson-card');
      return { op: c ? c.style.opacity : null, canvases: document.querySelectorAll('.sx-canvas').length };
    });
    await sleep(2800);
    const after = await page.evaluate(() => {
      const c = document.querySelector('.paper-card, .lesson-card');
      const all = Array.from(document.querySelectorAll('.paper-card, .lesson-card'));
      return {
        op: c ? c.style.opacity : null,
        canvases: document.querySelectorAll('.sx-canvas').length,
        count: all.length,
        visible: all.filter(x => getComputedStyle(x).display !== 'none').length,
        gathered: all.filter(x => x.dataset.sxGathered === '1').length,
        text: c ? c.textContent.trim().slice(0, 24) : ''
      };
    });
    results['batch2_' + url] = { during, after };
    await page.close();
  }

  /* ---------- 第三批 A · briefing.html ---------- */
  {
    const page = await open('/briefing.html', 'briefing.html');
    const wiring = await page.evaluate(() => ({
      archiveBtns: document.querySelectorAll('.sx-archive-btn').length,
      archiveIcon: !!document.querySelector('.sx-archive-icon'),
      latest: !!document.querySelector('.card.latest'),
      archiveItems: document.querySelectorAll('.archive li').length
    }));
    await page.evaluate(() => {
      const c = document.querySelector('.card.latest');
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 40, clientY: r.top + 30 }));
    });
    await sleep(250);
    const duringSnap = await page.evaluate(() => ({
      canvases: document.querySelectorAll('.sx-canvas').length,
      op: document.querySelector('.card.latest').style.opacity
    }));
    await sleep(2200);
    const afterSnap = await page.evaluate(() => ({
      toast: !!document.querySelector('.sx-toast'),
      toastMsg: document.querySelector('.sx-toast-msg') ? document.querySelector('.sx-toast-msg').textContent : null,
      hasUndo: !!document.querySelector('.sx-toast-undo'),
      latestHidden: getComputedStyle(document.querySelector('.card.latest')).display === 'none'
    }));
    await page.evaluate(() => { const u = document.querySelector('.sx-toast-undo'); if (u) u.click(); });
    await sleep(700);
    const afterUndo = await page.evaluate(() => {
      const c = document.querySelector('.card.latest');
      return { display: getComputedStyle(c).display, op: c.style.opacity, toastGone: !document.querySelector('.sx-toast') };
    });
    await page.evaluate(() => {
      const li = document.querySelector('.archive li');
      li.querySelector('.sx-archive-btn').click();
    });
    await sleep(2400);
    const afterStream = await page.evaluate(() => ({
      count: document.querySelector('.sx-archive-count') ? document.querySelector('.sx-archive-count').textContent : null,
      toastMsg: document.querySelector('.sx-toast-msg') ? document.querySelector('.sx-toast-msg').textContent : null,
      firstLiHidden: getComputedStyle(document.querySelector('.archive li')).display === 'none'
    }));
    // 归档后撤销
    await page.evaluate(() => { const u = document.querySelector('.sx-toast-undo'); if (u) u.click(); });
    await sleep(700);
    const afterStreamUndo = await page.evaluate(() => ({
      firstLiDisplay: getComputedStyle(document.querySelector('.archive li')).display,
      count: document.querySelector('.sx-archive-count').textContent
    }));
    results.batch3_briefing = { wiring, duringSnap, afterSnap, afterUndo, afterStream, afterStreamUndo };
    await page.close();
  }

  /* ---------- 第三批 B · briefing/2026-11-19.html ---------- */
  {
    const page = await open('/briefing/2026-11-19.html', 'briefing/2026-11-19.html');
    const wiring = await page.evaluate(() => ({
      archiveBtns: document.querySelectorAll('.sx-archive-btn').length,
      articles: document.querySelectorAll('article').length
    }));
    await page.evaluate(() => {
      const a = document.querySelector('article');
      const r = a.getBoundingClientRect();
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 50, clientY: r.top + 20 }));
    });
    await sleep(2200);
    const afterSnap = await page.evaluate(() => ({
      toast: !!document.querySelector('.sx-toast'),
      hidden: getComputedStyle(document.querySelector('article')).display === 'none',
      articleCount: document.querySelectorAll('article').length
    }));
    // 归档第一条
    await page.evaluate(() => {
      const a = document.querySelectorAll('article')[1];
      a.querySelector('.sx-archive-btn').click();
    });
    await sleep(2400);
    const afterStream = await page.evaluate(() => ({
      count: document.querySelector('.sx-archive-count') ? document.querySelector('.sx-archive-count').textContent : null,
      toastMsg: document.querySelector('.sx-toast-msg') ? document.querySelector('.sx-toast-msg').textContent : null
    }));
    results.batch3_issue = { wiring, afterSnap, afterStream };
    await page.close();
  }

  /* ---------- 第四批 A · review.html ---------- */
  {
    const page = await open('/review.html', 'review.html');
    await page.evaluate(() => {
      document.getElementById('rvDid').value = '测试内容';
      document.getElementById('rvSave').click();
    });
    await sleep(250);
    const during = await page.evaluate(() => {
      const b = document.getElementById('rvSave');
      return { html: b.innerHTML.slice(0, 40), w: b.style.width, r: b.style.borderRadius, disabled: b.disabled };
    });
    await sleep(800);
    const after = await page.evaluate(() => {
      const b = document.getElementById('rvSave');
      return { text: b.textContent, disabled: b.disabled, w: b.style.width };
    });
    await sleep(1600);
    const restored = await page.evaluate(() => {
      const b = document.getElementById('rvSave');
      return { text: b.textContent, disabled: b.disabled, w: b.style.width, r: b.style.borderRadius };
    });
    // 删除 → 滑动确认（未滑到底不应删除）
    const beforeDel = await page.evaluate(() => document.querySelectorAll('.entry').length);
    await page.evaluate(() => document.querySelector('[data-del]').click());
    await sleep(300);
    const slideShown = await page.evaluate(() => ({
      slide: !!document.querySelector('.sx-slide'),
      text: document.querySelector('.sx-slide-text') ? document.querySelector('.sx-slide-text').textContent : null,
      entries: document.querySelectorAll('.entry').length
    }));
    // 模拟一次未到底的滑动 → 应该复位，不删除
    await page.evaluate(async () => {
      const knob = document.querySelector('.sx-slide-knob');
      const r = knob.getBoundingClientRect();
      const opts = (x) => ({ bubbles: true, pointerId: 1, clientX: x, clientY: r.top + r.height / 2 });
      knob.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + 15)));
      knob.dispatchEvent(new PointerEvent('pointermove', opts(r.left + 80)));
      knob.dispatchEvent(new PointerEvent('pointerup', opts(r.left + 80)));
    });
    await sleep(400);
    const afterPartial = await page.evaluate(() => ({
      slide: !!document.querySelector('.sx-slide'),
      entries: document.querySelectorAll('.entry').length
    }));
    // 滑到底 → 应该删除
    await page.evaluate(async () => {
      const knob = document.querySelector('.sx-slide-knob');
      const r = knob.getBoundingClientRect();
      const track = knob.parentElement.getBoundingClientRect();
      const opts = (x) => ({ bubbles: true, pointerId: 1, clientX: x, clientY: r.top + r.height / 2 });
      knob.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + 15)));
      knob.dispatchEvent(new PointerEvent('pointermove', opts(track.right - 20)));
      knob.dispatchEvent(new PointerEvent('pointerup', opts(track.right - 20)));
    });
    await sleep(600);
    const afterFull = await page.evaluate(() => ({
      slide: !!document.querySelector('.sx-slide'),
      entries: document.querySelectorAll('.entry').length,
      toastMsg: document.querySelector('.sx-toast-msg') ? document.querySelector('.sx-toast-msg').textContent : null,
      listEmpty: document.getElementById('rvEmpty') ? !document.getElementById('rvEmpty').hidden : null
    }));
    // 清空全部
    const clearRes = await page.evaluate(async () => {
      document.getElementById('rvClearAll').click();
      await new Promise(r => setTimeout(r, 200));
      const knob = document.querySelector('.sx-slide-knob');
      if (!knob) return { slide: false };
      const r = knob.getBoundingClientRect();
      const track = knob.parentElement.getBoundingClientRect();
      const opts = (x) => ({ bubbles: true, pointerId: 1, clientX: x, clientY: r.top + r.height / 2 });
      knob.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + 15)));
      knob.dispatchEvent(new PointerEvent('pointermove', opts(track.right - 20)));
      knob.dispatchEvent(new PointerEvent('pointerup', opts(track.right - 20)));
      await new Promise(r => setTimeout(r, 400));
      return {
        slide: !!document.querySelector('.sx-slide'),
        entries: document.querySelectorAll('.entry').length,
        emptyShown: !document.getElementById('rvEmpty').hidden
      };
    });
    results.batch4_review = { during, after, restored, beforeDel, slideShown, afterPartial, afterFull, clearRes };
    await page.close();
  }

  /* ---------- 第四批 B · diary.html ---------- */
  {
    const page = await open('/diary.html', 'diary.html');
    await page.evaluate(() => { sessionStorage.setItem('jocehi-diary-unlocked', '1'); });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(600);
    const state = await page.evaluate(() => ({
      lockVisible: !document.getElementById('diaryLock').hidden,
      appHidden: document.getElementById('diaryApp').hidden,
      hasSave: !!document.getElementById('dySave'),
      hasClearAll: !!document.getElementById('dyClearAll')
    }));
    await page.evaluate(() => {
      document.getElementById('dyBody').value = '日记测试';
      document.getElementById('dySave').click();
    });
    await sleep(300);
    const during = await page.evaluate(() => {
      const b = document.getElementById('dySave');
      return { w: b.style.width, r: b.style.borderRadius, spinner: !!b.querySelector('.sx-spinner') };
    });
    await sleep(2200);
    const restored = await page.evaluate(() => {
      const b = document.getElementById('dySave');
      return { text: b.textContent, disabled: b.disabled, w: b.style.width };
    });
    const delRes = await page.evaluate(async () => {
      document.querySelector('[data-del]').click();
      await new Promise(r => setTimeout(r, 200));
      const knob = document.querySelector('.sx-slide-knob');
      if (!knob) return { slide: false };
      const r = knob.getBoundingClientRect();
      const track = knob.parentElement.getBoundingClientRect();
      const opts = (x) => ({ bubbles: true, pointerId: 1, clientX: x, clientY: r.top + r.height / 2 });
      knob.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + 15)));
      knob.dispatchEvent(new PointerEvent('pointermove', opts(track.right - 20)));
      knob.dispatchEvent(new PointerEvent('pointerup', opts(track.right - 20)));
      await new Promise(r => setTimeout(r, 400));
      return { entries: document.querySelectorAll('.entry').length, toast: document.querySelector('.sx-toast-msg') ? document.querySelector('.sx-toast-msg').textContent : null };
    });
    results.batch4_diary = { state, during, restored, delRes };
    await page.close();
  }

  /* ---------- prefers-reduced-motion ---------- */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    attach(page, 'reduced-motion');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`http://127.0.0.1:${PORT}/briefing.html`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    const rm = await page.evaluate(() => ({
      style: !!document.getElementById('sx-style'),
      archiveBtns: document.querySelectorAll('.sx-archive-btn').length,
      latestOp: document.querySelector('.card.latest').style.opacity,
      latestDisplay: getComputedStyle(document.querySelector('.card.latest')).display,
      latestTextLen: document.querySelector('.card.latest').textContent.trim().length
    }));
    results.reduced_motion = rm;
    await page.close();
  }

  console.log(JSON.stringify(results, null, 2));
  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.forEach(e => console.log(e));

  await browser.close();
  srv.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

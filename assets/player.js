/* 首页音乐播放器 — 轻量、无依赖
   加歌方法：在下面的 PLAYLIST 里加一行 {src:'assets/music/文件名', title:'歌名'}，
   并把音频文件传到 assets/music/ 文件夹。播放器会自动出现上一首/下一首。
   注意：脚本在播放器标记之前加载，所以必须等 DOM 解析完再初始化，否则
   getElementById 拿不到 <audio>，播放按钮会是死的。 */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';
  var PLAYLIST = [
    { src: 'assets/music/track-01.m4a', title: 'OST Playlist · 01' }
  ];
  var audio = document.getElementById('playerAudio');
  var playBtn = document.getElementById('playerPlay');
  var prevBtn = document.getElementById('playerPrev');
  var nextBtn = document.getElementById('playerNext');
  var titleEl = document.getElementById('playerTitle');
  var bar = document.getElementById('playerBar');
  var progress = document.getElementById('playerProgress');
  var curEl = document.getElementById('playerCur');
  var durEl = document.getElementById('playerDur');
  var vol = document.getElementById('playerVol');
  var player = document.getElementById('player');
  var fab = document.getElementById('playerFab');
  var closeBtn = document.getElementById('playerClose');
  if (!audio || !PLAYLIST.length) return;

  var idx = 0;
  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    s = Math.floor(s);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function load(i, autoplay) {
    idx = (i + PLAYLIST.length) % PLAYLIST.length;
    audio.src = PLAYLIST[idx].src;
    titleEl.textContent = PLAYLIST[idx].title;
    bar.style.width = '0%';
    curEl.textContent = '0:00';
    renderList();
    if (autoplay) audio.play().catch(function () {});
  }
  function setPlayingUI() {
    playBtn.textContent = audio.paused ? '▶' : '❚❚';
    playBtn.setAttribute('aria-label', audio.paused ? '播放' : '暂停');
    fab.classList.toggle('playing', !audio.paused);
    player.classList.toggle('playing', !audio.paused);
    if (overlay) overlay.classList.toggle('playing', !audio.paused);
    playBtn.classList.remove('sx-pop'); void playBtn.offsetWidth; playBtn.classList.add('sx-pop');
    if (exPlay) { exPlay.textContent = audio.paused ? '▶' : '❚❚'; renderList(); }
  }
  playBtn.addEventListener('click', function () {
    if (audio.paused) audio.play().catch(function () {});
    else audio.pause();
  });
  prevBtn.addEventListener('click', function () { load(idx - 1, true); });
  nextBtn.addEventListener('click', function () { load(idx + 1, true); });
  audio.addEventListener('play', setPlayingUI);
  audio.addEventListener('pause', setPlayingUI);
  audio.addEventListener('loadedmetadata', function () { durEl.textContent = fmt(audio.duration); syncExpanded(); });
  audio.addEventListener('timeupdate', function () {
    if (audio.duration) bar.style.width = (audio.currentTime / audio.duration * 100) + '%';
    curEl.textContent = fmt(audio.currentTime);
    syncExpanded();
  });
  audio.addEventListener('ended', function () { load(idx + 1, true); });
  progress.addEventListener('click', function (e) {
    var r = progress.getBoundingClientRect();
    if (audio.duration) audio.currentTime = (e.clientX - r.left) / r.width * audio.duration;
  });
  vol.addEventListener('input', function () { audio.volume = parseFloat(vol.value); if (exVol) exVol.value = vol.value; });
  audio.volume = parseFloat(vol.value);
  closeBtn.addEventListener('click', function () {
    /* 最小化：只收起播放条，音乐继续放，右下角留一个音符按钮点回来 */
    player.hidden = true;
    fab.hidden = false;
  });
  fab.addEventListener('click', function () {
    player.hidden = false;
    fab.hidden = true;
  });
  /* ---- MiniPlayer：展开大播放器 ---- */
  var expandBtn = document.getElementById('playerExpand');
  var overlay = null, exPlay = null, exTitle = null, exBar = null, exProgress = null,
      exCur = null, exDur = null, exVol = null, exList = null;
  function buildExpanded() {
    overlay = document.createElement('div');
    overlay.className = 'player-expanded';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="px-backdrop"></div>' +
      '<div class="px-card" role="dialog" aria-label="播放器">' +
        '<div class="px-head"><span class="px-live"><span class="px-eq"><i></i><i></i><i></i><i></i></span>正在播放 · NOW PLAYING</span>' +
        '<button class="px-close" aria-label="收起">✕</button></div>' +
        '<div class="px-vinyl"><svg viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="59" fill="none" stroke="rgba(255,255,255,.09)"/><circle cx="64" cy="64" r="51" fill="none" stroke="rgba(255,255,255,.07)"/><circle cx="64" cy="64" r="43" fill="none" stroke="rgba(255,255,255,.07)"/><circle cx="64" cy="64" r="35" fill="none" stroke="rgba(255,255,255,.06)"/></svg><span class="px-vinyl-label"></span><span class="px-vinyl-dot"></span></div>' +
        '<div class="px-title"></div>' +
        '<div class="px-list"></div>' +
        '<div class="px-progress"><div class="px-bar"></div></div>' +
        '<div class="px-times"><span class="px-cur">0:00</span><span class="px-dur">0:00</span></div>' +
        '<div class="px-controls">' +
          '<button class="px-prev" aria-label="上一首">⏮</button>' +
          '<button class="px-play" aria-label="播放">▶</button>' +
          '<button class="px-next" aria-label="下一首">⏭</button>' +
        '</div>' +
        '<label class="px-vol">音量 <input type="range" min="0" max="1" step="0.05" value="0.8" aria-label="音量"></label>' +
      '</div>';
    document.body.appendChild(overlay);
    exPlay = overlay.querySelector('.px-play');
    exTitle = overlay.querySelector('.px-title');
    exBar = overlay.querySelector('.px-bar');
    exProgress = overlay.querySelector('.px-progress');
    exCur = overlay.querySelector('.px-cur');
    exDur = overlay.querySelector('.px-dur');
    exVol = overlay.querySelector('.px-vol input');
    exList = overlay.querySelector('.px-list');
    exPlay.addEventListener('click', function () {
      if (audio.paused) audio.play().catch(function () {});
      else audio.pause();
    });
    overlay.querySelector('.px-prev').addEventListener('click', function () { load(idx - 1, true); });
    overlay.querySelector('.px-next').addEventListener('click', function () { load(idx + 1, true); });
    overlay.querySelector('.px-close').addEventListener('click', hideExpanded);
    overlay.querySelector('.px-backdrop').addEventListener('click', hideExpanded);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) hideExpanded();
    });
    exProgress.addEventListener('click', function (e) {
      var r = exProgress.getBoundingClientRect();
      if (audio.duration) audio.currentTime = (e.clientX - r.left) / r.width * audio.duration;
    });
    exVol.addEventListener('input', function () { audio.volume = parseFloat(exVol.value); vol.value = exVol.value; });
    exList.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.px-track') : null;
      if (!t) return;
      load(parseInt(t.getAttribute('data-i'), 10), true);
    });
    renderList();
  }
  function renderList() {
    if (!exList) return;
    exList.innerHTML = PLAYLIST.map(function (t, i) {
      return '<button class="px-track' + (i === idx ? ' on' : '') + '" data-i="' + i + '">' +
        '<span class="px-track-note">' + (i === idx && !audio.paused ? '♪' : '○') + '</span>' +
        '<span class="px-track-title">' + t.title + '</span></button>';
    }).join('');
  }
  function syncExpanded() {
    if (!overlay || overlay.hidden) return;
    overlay.classList.toggle('playing', !audio.paused);
    exTitle.textContent = PLAYLIST[idx].title;
    exPlay.textContent = audio.paused ? '▶' : '❚❚';
    exCur.textContent = fmt(audio.currentTime);
    exDur.textContent = fmt(audio.duration);
    exBar.style.width = audio.duration ? (audio.currentTime / audio.duration * 100) + '%' : '0%';
    exVol.value = audio.volume;
  }
  function showExpanded() {
    if (!overlay) buildExpanded();
    overlay.hidden = false;
    syncExpanded();
  }
  function hideExpanded() {
    if (overlay) overlay.hidden = true;
  }
  if (expandBtn) expandBtn.addEventListener('click', showExpanded);
  titleEl.style.cursor = 'pointer';
  titleEl.title = '点击展开大播放器';
  titleEl.addEventListener('click', showExpanded);
  load(0, false);
});

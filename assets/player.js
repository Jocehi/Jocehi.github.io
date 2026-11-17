/* 首页音乐播放器 — 轻量、无依赖
   加歌方法：在下面的 PLAYLIST 里加一行 {src:'assets/music/文件名', title:'歌名'}，
   并把音频文件传到 assets/music/ 文件夹。播放器会自动出现上一首/下一首。 */
(function () {
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
    if (autoplay) audio.play().catch(function () {});
  }
  function setPlayingUI() {
    playBtn.textContent = audio.paused ? '▶' : '❚❚';
    playBtn.setAttribute('aria-label', audio.paused ? '播放' : '暂停');
  }
  playBtn.addEventListener('click', function () {
    if (audio.paused) audio.play().catch(function () {});
    else audio.pause();
  });
  prevBtn.addEventListener('click', function () { load(idx - 1, true); });
  nextBtn.addEventListener('click', function () { load(idx + 1, true); });
  audio.addEventListener('play', setPlayingUI);
  audio.addEventListener('pause', setPlayingUI);
  audio.addEventListener('loadedmetadata', function () { durEl.textContent = fmt(audio.duration); });
  audio.addEventListener('timeupdate', function () {
    if (audio.duration) bar.style.width = (audio.currentTime / audio.duration * 100) + '%';
    curEl.textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('ended', function () { load(idx + 1, true); });
  progress.addEventListener('click', function (e) {
    var r = progress.getBoundingClientRect();
    if (audio.duration) audio.currentTime = (e.clientX - r.left) / r.width * audio.duration;
  });
  vol.addEventListener('input', function () { audio.volume = parseFloat(vol.value); });
  audio.volume = parseFloat(vol.value);
  closeBtn.addEventListener('click', function () {
    audio.pause();
    player.hidden = true;
    fab.hidden = false;
  });
  fab.addEventListener('click', function () {
    player.hidden = false;
    fab.hidden = true;
  });
  load(0, false);
})();

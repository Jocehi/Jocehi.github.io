/* 详情页规格卡 + 图序 pill — Peek 详情页右栏的做法，翻成本站调子
   从页面已有的 .meta / .thesis 里读真实数据，不编造；解析失败就什么都不加，
   正文、公式、代码一律不动。 */
(function () {
  'use strict';
  function copyText(btn, text, doneLabel) {
    function done(ok) {
      btn.textContent = ok ? doneLabel : '复制失败';
      setTimeout(function () { btn.textContent = btn.getAttribute('data-label'); }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { done(document.execCommand('copy')); } catch (e) { done(false); }
      document.body.removeChild(ta);
    }
  }
  function row(label, valueNode) {
    var r = document.createElement('div');
    r.className = 'spec-row';
    var dt = document.createElement('dt'); dt.textContent = label;
    var dd = document.createElement('dd'); dd.appendChild(valueNode);
    r.appendChild(dt); r.appendChild(dd);
    return r;
  }
  function txt(s) { return document.createTextNode(s); }
  function buildCard(kind, rows, copyLabel, copyTextValue) {
    var card = document.createElement('aside');
    card.className = 'spec-card spec-' + kind;
    var head = document.createElement('p');
    head.className = 'spec-head';
    head.textContent = kind === 'paper' ? 'SPEC · 论文规格' : 'SPEC · 课程规格';
    card.appendChild(head);
    var dl = document.createElement('dl');
    rows.forEach(function (r) { dl.appendChild(row(r[0], r[1])); });
    card.appendChild(dl);
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'spec-copy';
    btn.textContent = copyLabel; btn.setAttribute('data-label', copyLabel);
    btn.addEventListener('click', function () { copyText(btn, copyTextValue, '已复制 ✓'); });
    card.appendChild(btn);
    return card;
  }

  /* ---- 论文页：右栏规格卡 + 图序 pill ---- */
  var sidebar = document.querySelector('.sidebar');
  var article = document.querySelector('.article');
  if (sidebar && article) {
    var meta = article.querySelector('.meta');
    if (meta) {
      var t = meta.textContent;
      var day = (t.match(/第\s*(\d+)\s*篇/) || [])[1];
      var dm = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      var arxiv = (t.match(/arXiv[:：]\s*(\d{4}\.\d{4,5})/) || [])[1];
      var year = (t.match(/(\d{4})\s*年\s*·\s*arXiv/) || [])[1];
      var read = (t.match(/阅读约\s*(\d+)\s*分钟/) || [])[1];
      if (day && arxiv) {
        var rows = [];
        rows.push(['精读', txt('第 ' + day + ' 篇' + (dm ? ' · ' + dm[1] + '-' + String(dm[2]).padStart(2, '0') + '-' + String(dm[3]).padStart(2, '0') : ''))]);
        if (year) rows.push(['原论文', txt(year + ' 年')]);
        var a = document.createElement('a');
        a.href = 'https://arxiv.org/abs/' + arxiv; a.textContent = arxiv; a.target = '_blank'; a.rel = 'noopener';
        rows.push(['arXiv', a]);
        if (read) rows.push(['阅读', txt('约 ' + read + ' 分钟')]);
        var card = buildCard('paper', rows, '复制 arXiv 链接', 'https://arxiv.org/abs/' + arxiv);
        sidebar.insertBefore(card, sidebar.firstChild);
      }
    }
    var figs = article.querySelectorAll('figure');
    figs.forEach(function (fig, i) {
      var pill = document.createElement('span');
      pill.className = 'fig-count';
      pill.textContent = (i + 1) + ' / ' + figs.length;
      fig.appendChild(pill);
    });
    return;
  }

  /* ---- RL 课页：正文上方规格卡 ---- */
  var thesis = document.querySelector('.thesis');
  var metas = document.querySelectorAll('.meta');
  if (thesis && metas.length) {
    var parts = metas[0].textContent.split('·').map(function (s) { return s.trim(); });
    // [标题, 系列, 日期, 分类, 难度, 时长]
    if (parts.length >= 6 && /^\d{4}-\d{2}-\d{2}$/.test(parts[2])) {
      var rows2 = [];
      rows2.push(['课程', txt(parts[0])]);
      rows2.push(['日期', txt(parts[2])]);
      rows2.push(['分类', txt(parts[3])]);
      rows2.push(['难度', txt(parts[4])]);
      rows2.push(['时长', txt(parts[5])]);
      var vid = document.querySelector('.lesson-video p');
      if (vid) {
        var vm = vid.textContent.match(/(\d+)\s*分\s*(\d+)\s*秒/);
        if (vm) rows2.push(['讲解视频', txt('▶ ' + String(vm[1]).padStart(2, '0') + ':' + String(vm[2]).padStart(2, '0'))]);
      }
      if (metas.length > 1 && metas[1].textContent.indexOf('前置知识') === 0) {
        rows2.push(['前置知识', txt(metas[1].textContent.replace(/^前置知识[:：]\s*/, ''))]);
      }
      var card2 = buildCard('rl', rows2, '复制本课要点', thesis.textContent.trim());
      thesis.after(card2);
    }
  }
})();

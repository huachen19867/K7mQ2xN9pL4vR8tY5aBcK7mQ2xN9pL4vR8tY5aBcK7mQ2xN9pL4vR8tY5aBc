/* 文案配置层：读 content.json，把 [data-qau] / [data-qau-ph] 的文本换成配置值。
   改 content.json 保存后刷新即生效；将来接后台时，只要接口返回同样结构即可。 */
(function () {
  var page = document.documentElement.getAttribute('data-qau-page') || '';

  function applyStrings(map) {
    if (!map) return;
    Object.keys(map).forEach(function (key) {
      var val = map[key];
      var nodes = document.querySelectorAll('[data-qau="' + cssEscape(key) + '"]');
      Array.prototype.forEach.call(nodes, function (el) {
        if (el.textContent !== val) el.textContent = val;
      });
      var phs = document.querySelectorAll('[data-qau-ph="' + cssEscape(key) + '"]');
      Array.prototype.forEach.call(phs, function (el) {
        el.setAttribute('placeholder', val);
      });
    });
  }

  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  /* 老板截图顶部那条「标题 + 域名」是手机 App/浏览器自己画的，不属于网页。
     需要连它一起复刻时把 content.json 里的 appBar.show 置为 true。 */
  function applyAppBar(cfg) {
    var bar = cfg.appBar || {};
    if (!bar.show) return;
    var title = bar.title || document.title;
    var domain = bar.domain || location.hostname;
    var el = document.createElement('div');
    el.className = 'qau-appbar';
    el.innerHTML =
      '<div class="qau-appbar-status"></div>' +
      '<div class="qau-appbar-title"></div>' +
      '<div class="qau-appbar-domain"></div>';
    el.querySelector('.qau-appbar-title').textContent = title;
    el.querySelector('.qau-appbar-domain').textContent = domain;
    document.body.insertBefore(el, document.body.firstChild);
    document.body.classList.add('qau-has-appbar');
  }

  function boot() {
    // 直接双击打开的 file:// 场景读不到 fetch，所以优先用同目录的 content.js
    if (window.QAU_CONTENT) {
      apply(window.QAU_CONTENT);
      return;
    }
    if (typeof fetch !== 'function') return;
    fetch('content.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) { if (cfg) apply(cfg); })
      .catch(function () { /* 直接用页面内已写死的文案 */ });
  }

  function apply(cfg) {
    var pages = cfg.pages || {};
    applyStrings(pages[page] || pages[Object.keys(pages)[0]]);
    applyApprovals(cfg);
    applyAppBar(cfg);
  }

  /* 审批段填值：对应 p12。填进去之后这些方块会自然膨胀——
     文字块按行数长高、签字图按图片比例撑开，位置由正常文档流往后推。
     默认留空以保持与导出截图一致；content.json 里 approvals.enableSample 打开即演示填好后的样子。 */
  function applyApprovals(cfg) {
    var a = cfg.approvals || {};
    if (!a.enableSample) return;
    var values = a.values || {};
    Object.keys(values).forEach(function (key) {
      var box = document.querySelector('[data-key="' + cssEscape(key) + '"]');
      if (!box) return;
      var target =
        box.querySelector('.dplugin-content-wrap') ||
        box.querySelector('.doneplugin-value') ||
        box.querySelector('span');
      if (target) target.textContent = values[key];
    });
    var signs = a.signatures || {};
    Object.keys(signs).forEach(function (key) {
      var box = document.querySelector('[data-key="' + cssEscape(key) + '"]');
      if (!box) return;
      var holder = box.querySelector('.dhandsign > div') || box.querySelector('.dhandsign');
      if (holder) holder.innerHTML = '<img src="' + signs[key] + '" alt="签字">';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

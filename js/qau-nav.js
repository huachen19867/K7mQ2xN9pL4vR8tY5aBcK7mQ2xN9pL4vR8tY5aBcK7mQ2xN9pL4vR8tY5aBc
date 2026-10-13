/* 交互层：只放老板明确要求可点的两处，其余保持静态。
   p1 首页 ：「我的申请」→ p3 我的申请
   p3 列表 ：每张假条右下角「查看表单」→ p4 学生请销假

   关于审批段的“膨胀”（对应 p12）：
   源站里每个审批字段是 .mobile_up_down_style > .pluginnames + .plugin-allbox，
   意见框是 .dplugin-content-wrap（内联 min-height: 46px，约两行），签字是 .dhandsign 里的图片。
   它们是普通块级元素，文本/图片进来就会按内容自然长高——
   文字多一行就多一行，签字图按自身比例撑开，后面的元素整体下移。
   所以这里【不要】用 JS 去设 min-height，否则会把源站的基础高度盖掉（曾踩过这个坑）。
   需要演示“填好之后”的样子时，把 content.json 里的 approvals.enableSample 设为 true。 */
(function () {
  var page = document.documentElement.getAttribute('data-qau-page') || '';

  function go(url) {
    location.href = url;
  }

  var ROUTES = {
    p1: { list: 'my-applications.html' },
    p3: { form: 'leave-form.html' },
    p4: {}
  };

  /* ---------- p1：首页唯一热区（我的申请） ---------- */
  function wireHome() {
    var first = document.querySelector('.check-top .div-item');
    if (!first) return;
    first.classList.add('qau-hotspot');
    first.addEventListener('click', function () { go(ROUTES.p1.list); });
  }

  /* ---------- p3：假条右下角蓝色按钮 ---------- */
  function wireList() {
    var btns = document.querySelectorAll('.m_matter_list .mmll_item .btn_item button.prview');
    Array.prototype.forEach.call(btns, function (b) {
      b.classList.add('qau-hotspot');
      b.addEventListener('click', function () { go(ROUTES.p3.form); });
    });
  }

  function boot() {
    if (page === 'p1') wireHome();
    else if (page === 'p3') wireList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

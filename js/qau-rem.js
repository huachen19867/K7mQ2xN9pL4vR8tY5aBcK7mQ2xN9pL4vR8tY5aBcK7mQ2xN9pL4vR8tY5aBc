/* 根字号：与源站一致，1rem = 视口宽/375*100 px。
   源站在 393 宽视口下 html 为 104.8px，这里用同一公式复现。 */
(function () {
  var MAX = 750; // 平板/桌面下不至于把布局撑爆

  function setRem() {
    var w = document.documentElement.clientWidth || 375;
    if (w > MAX) w = MAX;
    document.documentElement.style.fontSize = (w / 375) * 100 + 'px';
  }

  setRem();
  window.addEventListener('resize', setRem);
  window.addEventListener('orientationchange', setRem);
  document.addEventListener('DOMContentLoaded', setRem);
})();

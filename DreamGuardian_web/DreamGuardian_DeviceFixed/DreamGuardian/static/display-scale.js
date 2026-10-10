/* Keep the dashboard's reading size proportional on large displays.
   innerWidth/innerHeight are CSS pixels, so OS scaling is not applied twice. */
(() => {
  function resize() {
    const scale = Math.max(1, Math.min(innerWidth / 1280, innerHeight / 800));
    document.documentElement.style.setProperty('--display-scale', scale);
    document.documentElement.dataset.scaled = scale > 1.01 ? 'true' : 'false';
  }
  resize();
  window.addEventListener('resize', resize);
})();

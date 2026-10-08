(() => {
  let appReady;
  window.OBM_APP_READY = new Promise((r) => { appReady = r; });
  window.__obmAppReady = () => appReady(window.OBMApp);
  const lang = (document.documentElement.lang || 'fr').slice(0, 2);
  const timeout = new Promise((r) => setTimeout(r, 2500, null));
  const live = fetch('/api/catalog', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  window.OBM_READY = Promise.race([live, timeout]).then((cat) => {
    if (!cat || !Array.isArray(cat.products) || !cat.products.length || !window.OBM) return;
    window.OBM.products = cat.products.map((p) => {
      const t = (lang !== 'fr' && p.i18n && p.i18n[lang]) || {};
      const q = { ...p, name: t.name || p.name, sub: t.sub || p.sub };
      if (t.desc || p.desc) q.desc = t.desc || p.desc;
      if (t.specs || p.specs) q.specs = t.specs || p.specs;
      delete q.i18n;
      return q;
    });
    window.OBM.live = { version: cat.version, updatedAt: cat.updatedAt };
  });
})();

import { loadCatalog, json, fail } from '../../lib/store.mjs';

const PRIVATE = ['stock', 'alert', 'visible', 'note'];

export default async () => {
  try {
    const cat = await loadCatalog();
    const products = cat.products.filter((p) => p.visible !== false).map((p) => {
      const q = { ...p, inStock: (p.stock || 0) > 0 };
      PRIVATE.forEach((k) => delete q[k]);
      return q;
    });
    return json({ version: cat.version, updatedAt: cat.updatedAt, products }, 200, { 'cache-control': 'public, max-age=30' });
  } catch (err) {
    console.error('catalog', err);
    return fail(503, 'Catalogue indisponible');
  }
};

export const config = { path: '/api/catalog' };

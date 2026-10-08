(async () => {
  await (window.OBM_APP_READY || null);
  const App = window.OBMApp;
  if (!App) return;
  const { products, byRef, famById } = App;
  const $ = s => document.querySelector(s);
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const bot = $('#bot'), log = $('#botLog'), input = $('#botText');
  const KEY = 'obm-bot';
  const phone = matchMedia('(max-width: 640px)');
  let history = [];
  let mode = 'ai';
  let busy = false;
  let lastRefs = [];
  try { const s = JSON.parse(sessionStorage.getItem(KEY)); if (s) { history = s.h || []; mode = s.m || 'ai'; lastRefs = s.r || []; } } catch (e) {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ h: history.slice(-40), m: mode, r: lastRefs })); } catch (e) {} };

  const TAG = /\[\[(produit|selection|action|prefill):([\s\S]*?)\]\]/g;
  function md(text) {
    return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .split(/\n{2,}/).map(par => {
        const lines = par.split('\n');
        if (lines.every(l => /^\s*[-•]\s+/.test(l))) return '<ul>' + lines.map(l => '<li>' + l.replace(/^\s*[-•]\s+/, '') + '</li>').join('') + '</ul>';
        return '<p>' + lines.join('<br>') + '</p>';
      }).join('');
  }
  function parse(raw, final) {
    let text = raw;
    if (!final) text = text.replace(/\[\[[^\]]*$/, '');
    const tags = [];
    text = text.replace(TAG, (_, kind, val) => { tags.push([kind, val.trim()]); return ''; }).replace(/\n{3,}/g, '\n\n').trim();
    return { text, tags };
  }
  function productCard(p) {
    return `<div class="bcard"><img src="${App.sm(p.x)}" alt="" loading="lazy">
      <div><b>${esc(p.name)}</b><small>${esc(p.ref)}${p.tag ? ' · ' + esc(p.tag) : ''}${p.origin === 'tanger' ? ' · <i class="made made--xs">' + U().made + '</i>' : ''}</small>
      <span class="bcard__act"><button data-open="${p.ref}">${U().see}</button><button data-add="${p.ref}">${U().add}</button></span></div></div>`;
  }
  const ACTIONS = { devis: 1, rappel: 1, whatsapp: 1, selection: 1 };
  function renderTags(tags, final) {
    let html = '', acts = [];
    const refs = [];
    tags.forEach(([kind, val]) => {
      if (kind === 'produit' && byRef[val] && !refs.includes(val)) refs.push(val);
      if (kind === 'action' && ACTIONS[val]) acts.push(val);
      if (!final) return;
      if (kind === 'selection') { const [ref, q] = val.split(':'); if (byRef[ref]) App.addToSelection(ref, Math.max(1, Math.min(9999, parseInt(q, 10) || 1))); acts.push('selection'); }
      if (kind === 'prefill') { try { App.prefill(JSON.parse(val)); } catch (e) {} }
    });
    if (refs.length) { lastRefs = refs; html += '<div class="bcards">' + refs.slice(0, 4).map(r => productCard(byRef[r])).join('') + '</div>'; }
    acts = [...new Set(acts)];
    if (acts.length) html += '<div class="bacts">' + acts.map(a => `<button data-act="${a}">${U()[a]}</button>`).join('') + '</div>';
    return html;
  }
  function bubble(role, raw, final = true) {
    const el = document.createElement('div');
    el.className = 'bmsg bmsg--' + role;
    fill(el, role, raw, final);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function fill(el, role, raw, final) {
    if (role === 'user') { el.innerHTML = '<p>' + esc(raw) + '</p>'; return; }
    const { text, tags } = parse(raw, final);
    el.innerHTML = (text ? md(text) : (final ? '' : '<p class="typing"><i></i><i></i><i></i></p>')) + renderTags(tags, final);
  }
  log.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) { App.openProduct(o.dataset.open); return; }
    const a = e.target.closest('[data-add]'); if (a) { App.addToSelection(a.dataset.add); a.textContent = U().addedBtn; return; }
    const act = e.target.closest('[data-act]'); if (!act) return;
    const k = act.dataset.act;
    App.track('assistant_' + k);
    if (k === 'devis') { close(); App.goQuote(); }
    if (k === 'rappel') { close(); App.goCallback(); }
    if (k === 'selection') App.openSelection();
    if (k === 'whatsapp') { const last = history.filter(m => m.role === 'user').slice(-2).map(m => m.content).join(' / '); window.open(App.waLink(last ? U().question + ' ' + last : ''), '_blank', 'noopener'); }
  });

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true; $('#botForm button').disabled = true;
    history.push({ role: 'user', content: text });
    bubble('user', text);
    chips([]);
    const el = bubble('assistant', '', false);
    let reply = '';
    if (mode === 'ai') {
      try { reply = await askAI(el); }
      catch (e) { mode = 'local'; setMode(); reply = ''; }
    }
    if (mode === 'local' || !reply) {
      reply = localReply(text);
      await typeOut(el, reply);
    }
    fill(el, 'assistant', reply, true);
    history.push({ role: 'assistant', content: reply });
    save();
    busy = false; $('#botForm button').disabled = false;
    log.scrollTop = log.scrollHeight;
    App.track('assistant_message', { mode });
  }
  async function askAI(el) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ messages: history.slice(-30), page: document.title, lang: PAGE_LANG, selection: App.selection() }),
    });
    if (!res.ok || !res.body) { clearTimeout(timer); throw new Error('unavailable ' + res.status); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', out = '', failed = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).replace(/^data: /, ''); buf = buf.slice(i + 2);
        try {
          const ev = JSON.parse(line);
          if (ev.t) { out += ev.t; fill(el, 'assistant', out, false); log.scrollTop = log.scrollHeight; }
          if (ev.error) failed = true;
        } catch (e) {}
      }
    }
    clearTimeout(timer);
    if (failed && !out) throw new Error('api');
    if (failed) out += '\n\n(' + U().interrupted + ')\n[[action:rappel]]';
    return out;
  }
  async function typeOut(el, reply) {
    const { text } = parse(reply, true);
    for (let i = 0; i < text.length; i += 6) {
      el.innerHTML = md(text.slice(0, i)) || '<p class="typing"><i></i><i></i><i></i></p>';
      log.scrollTop = log.scrollHeight;
      await new Promise(r => setTimeout(r, 12));
    }
  }

  const T = {
    fr: {
      hello: 'Bonjour ! Je vous aide à trouver le bon mobilier et à préparer votre demande de devis. Quel est votre secteur et votre ville ?',
      price: 'OBM ne publie pas de prix : chaque devis est établi après étude, en fonction des quantités et de la configuration. Il vous est envoyé sous 48 h ouvrées sur dossier complet (quantités, plan ou photos).',
      delay: 'Le devis est envoyé sous 48 h ouvrées sur dossier complet. Les délais de fabrication et de livraison sont confirmés dans le devis : pour une échéance précise (rentrée scolaire, ouverture de site), indiquez-la dans votre demande.',
      where: 'Le bureau commercial est à Casablanca (Oasis Offices Latitudes, Bureau 304, Maarif). Le mobilier métallique est fabriqué dans notre atelier de Tanger. La zone et le délai d’intervention de l’étude sur site sont confirmés à la prise de contact.',
      made: 'Sont **fabriqués dans notre atelier de Tanger** : les vestiaires, les armoires et les caissons métalliques. Les sièges, bureaux et produits de manutention sont sélectionnés auprès de fournisseurs. Chaque fiche indique l’origine du produit.',
      norm: 'La seule norme indiquée au catalogue est la **NF EN 1729-2**, pour le bureau maître (SCO-06). Pour les autres produits, demandez les documents disponibles avec votre devis.',
      warranty: 'La garantie est précisée dans le devis, par famille de produits. Un commercial peut vous la confirmer dès maintenant.',
      study: 'L’étude sur site est gratuite : un commercial relève les dimensions, les accès et vos usages, puis OBM propose un plan 2D-3D et un devis sous 48 h ouvrées sur dossier complet. Où se situe votre site ?',
      contact: 'Vous pouvez joindre OBM au **+212 6 74 95 39 00** ou au **+212 6 75 00 98 54**, par e-mail à commercial@obmagencement.com, ou sur WhatsApp.',
      quote: 'Pour un devis précis, indiquez : votre société, votre ville, les produits et quantités, et si possible un plan ou des photos du lieu. Je peux pré-remplir le formulaire avec ce que vous m’avez dit.',
      callback: 'Laissez votre nom et votre téléphone : un commercial vous rappelle sur le créneau choisi.',
      resid: 'L’offre résidentielle (meubles TV, tables basses, cuisines) n’est plus proposée. OBM se concentre sur le mobilier professionnel : vestiaires, armoires, rayonnage, bureaux, sièges et mobilier scolaire.',
      sheet: 'Les caractéristiques documentées sont sur chaque fiche. Pour une fiche partielle, la fiche technique complète est communiquée avec le devis.',
      found1: 'Voici la référence correspondante :', foundN: 'Voici les références qui correspondent :', model: 'modèle',
      none: 'Je ne trouve pas ce produit dans le catalogue 2026. Décrivez votre besoin : OBM étudie aussi les configurations non présentées, sur site et gratuitement.',
            noSpecs: 'Ses dimensions et caractéristiques détaillées sont communiquées avec le devis (fiche technique sur demande).',
      made1: 'Fabriqué dans notre atelier de Tanger.',
      added: 'C’est noté : {q} × {name} ajouté(s) à votre sélection.',
      whichRef: 'Quelle référence voulez-vous ajouter ?',
      madeYes: 'Oui : **{name}** est fabriqué dans notre atelier de Tanger.',
      madeNo: 'Non : **{name}** est sélectionné auprès d’un fournisseur. Ce qui est fabriqué à Tanger, ce sont les vestiaires, armoires et caissons métalliques.',
      madeUnknown: 'L’origine de **{name}** n’est pas précisée au catalogue : un commercial vous la confirmera.',
      qtyNoted: 'C’est noté. Avez-vous un plan ou des photos du lieu, et une date cible ? Avec ces éléments, le devis peut partir sous 48 h ouvrées.',
      contactGot: 'Merci, j’ai reporté vos coordonnées dans le formulaire de devis. Il ne reste qu’à vérifier et envoyer.',
      ui: {
        welcome: 'Bonjour, je suis l’assistant OBM. Je réponds sur les produits du catalogue 2026, la fabrication à Tanger et la préparation de votre devis.\n\nQuel est votre projet ?',
        chips: ['Vestiaires pour une usine', 'Rayonnage d’entrepôt', 'Mobilier scolaire', 'Fabriqué à Tanger ?'],
        modeAI: 'Conseil produits et devis', modeLocal: 'Conseil produits et devis',
        see: 'Voir la fiche', add: '+ Sélection', addedBtn: '✓ Ajouté', made: 'Fabriqué à Tanger',
        devis: 'Remplir la demande de devis', rappel: 'Être rappelé', whatsapp: 'Continuer sur WhatsApp', selection: 'Voir ma sélection',
        interrupted: 'Réponse interrompue. Vous pouvez reformuler ou contacter un commercial.', question: 'Ma question :',
        placeholder: 'Votre question…', open: 'Ouvrir l’assistant OBM', reset: 'Nouvelle conversation', close: 'Fermer l’assistant',
      },
      ask: 'Pour vous orienter : quel est votre secteur (usine, entrepôt, école, bureaux, commerce) et quels produits recherchez-vous ?',
      sec: {
        industrie: 'Pour une usine, les besoins types sont les **vestiaires ouvriers** (tôle 8/10e, 1 à 4 portes par colonne, fabriqués à Tanger), les **armoires d’atelier** et le **rayonnage de magasin pièces**. Combien de personnes à équiper, et dans quelle zone (Gueznaya, zone franche…) ?',
        logistique: 'Pour un entrepôt : rayonnage lourd, mi-lourd ou léger, et manutention. Les charges par niveau et les hauteurs sont dimensionnées après étude sur site et précisées au devis. Avez-vous un plan de l’entrepôt et le type de charges (palettes, cartons, pièces) ?',
        ecoles: 'Pour une école : tables et pupitres, chaises et bancs à structure tubulaire acier, et bureau maître. Combien de classes et d’élèves par classe, et pour quelle date ?',
        bureaux: 'Pour des bureaux : postes de direction, postes individuels, bench, 39 modèles de sièges, et rangement métallique fabriqué à Tanger. Combien de postes à équiper ?',
        commerces: 'Pour un commerce : rayonnage de magasin pour la surface de vente, et rayonnage léger ou mi-lourd pour la réserve. Quelle surface ou longueur de linéaire ?',
      },
    },
    es: {
      hello: '¡Hola! Le ayudo a elegir el mobiliario y a preparar su solicitud de presupuesto. ¿Cuál es su sector y su ciudad?',
      price: 'OBM no publica precios: cada presupuesto se elabora tras el estudio, según cantidades y configuración. Se envía en 48 h hábiles con el expediente completo (cantidades, plano o fotos).',
      delay: 'El presupuesto se envía en 48 h hábiles con el expediente completo. Los plazos de fabricación y entrega se confirman en el presupuesto: indique su fecha límite en la solicitud.',
      where: 'La oficina comercial está en Casablanca (Oasis Offices Latitudes, Bureau 304, Maarif). El mobiliario metálico se fabrica en nuestro taller de Tánger. La zona y el plazo de la visita se confirman al contactar.',
      made: 'Se **fabrican en nuestro taller de Tánger**: taquillas, armarios y cajoneras metálicas. Sillas, mesas de oficina y manutención proceden de proveedores. Cada ficha indica el origen.',
      norm: 'La única norma indicada en el catálogo es la **NF EN 1729-2**, para la mesa del profesor (SCO-06). Para los demás productos, solicite los documentos con el presupuesto.',
      warranty: 'La garantía se indica en el presupuesto, por familia de productos. Un comercial puede confirmarla.',
      study: 'El estudio in situ es gratuito: un comercial toma medidas, accesos y usos; después OBM propone un plano 2D-3D y un presupuesto en 48 h hábiles con el expediente completo. ¿Dónde está su planta?',
      contact: 'Puede contactar con OBM en el **+212 6 74 95 39 00** o el **+212 6 75 00 98 54**, por e-mail en commercial@obmagencement.com, o por WhatsApp.',
      quote: 'Para un presupuesto preciso indique: empresa, ciudad, productos y cantidades y, si es posible, un plano o fotos. Puedo rellenar el formulario con lo que me ha dicho.',
      callback: 'Deje su nombre y teléfono: un comercial le llamará en la franja elegida.',
      resid: 'La oferta residencial (muebles TV, mesas bajas, cocinas) ya no se ofrece. OBM se centra en mobiliario profesional.',
      sheet: 'Las características documentadas están en cada ficha. La ficha técnica completa se envía con el presupuesto.',
      found1: 'Esta referencia corresponde:', foundN: 'Estas referencias corresponden:', model: 'modelo',
      none: 'No encuentro este producto en el catálogo 2026. Describa su necesidad: OBM estudia también configuraciones no presentadas, in situ y gratis.',
            noSpecs: 'Sus dimensiones y características detalladas se envían con el presupuesto.',
      made1: 'Fabricado en nuestro taller de Tánger.',
      added: 'Anotado: {q} × {name} añadido(s) a su selección.',
      whichRef: '¿Qué referencia quiere añadir?',
      madeYes: 'Sí: **{name}** se fabrica en nuestro taller de Tánger.',
      madeNo: 'No: **{name}** procede de un proveedor. Lo que se fabrica en Tánger son las taquillas, armarios y cajoneras metálicas.',
      madeUnknown: 'El origen de **{name}** no está confirmado en el catálogo: un comercial se lo precisará.',
      qtyNoted: 'Anotado. ¿Tiene un plano o fotos del espacio y una fecha objetivo? Con eso el presupuesto puede enviarse en 48 h hábiles.',
      contactGot: 'Gracias, he pasado sus datos al formulario de presupuesto. Solo falta revisarlo y enviarlo.',
      ui: {
        welcome: 'Hola, soy el asistente de OBM. Respondo sobre los productos del catálogo 2026, la fabricación en Tánger y la preparación de su presupuesto.\n\n¿Cuál es su proyecto?',
        chips: ['Taquillas para una fábrica', 'Estanterías para almacén', 'Mobiliario escolar', '¿Fabricado en Tánger?'],
        modeAI: 'Asesoramiento y presupuestos', modeLocal: 'Asesoramiento y presupuestos',
        see: 'Ver la ficha', add: '+ Selección', addedBtn: '✓ Añadido', made: 'Fabricado en Tánger',
        devis: 'Rellenar la solicitud de presupuesto', rappel: 'Que me llamen', whatsapp: 'Seguir por WhatsApp', selection: 'Ver mi selección',
        interrupted: 'Respuesta interrumpida. Puede reformular o contactar con un comercial.', question: 'Mi pregunta:',
        placeholder: 'Su pregunta…', open: 'Abrir el asistente OBM', reset: 'Nueva conversación', close: 'Cerrar el asistente',
      },
      ask: 'Para orientarle: ¿cuál es su sector (fábrica, almacén, escuela, oficinas, comercio) y qué productos busca?',
      sec: {
        industrie: 'Para una fábrica, lo habitual son **taquillas** para operarios (chapa 0,8 mm, de 1 a 4 puertas por columna, fabricadas en Tánger), **armarios de taller** y **estanterías** para el almacén de piezas. ¿Cuántas personas y en qué zona (Gueznaya, zona franca…)?',
        logistique: 'Para un almacén: estanterías de carga pesada, media o ligera, y manutención. Las cargas por nivel se dimensionan tras el estudio in situ y se indican en el presupuesto. ¿Tiene un plano y el tipo de carga?',
        ecoles: 'Para una escuela: mesas, pupitres, sillas y bancos de estructura tubular de acero, y mesa del profesor. ¿Cuántas aulas y alumnos, y para qué fecha?',
        bureaux: 'Para oficinas: despachos de dirección, puestos individuales, bench, 39 modelos de sillas y armarios metálicos fabricados en Tánger. ¿Cuántos puestos?',
        commerces: 'Para un comercio: estanterías de tienda y estanterías para la trastienda. ¿Qué superficie o longitud?',
      },
    },
  };
  Object.assign(T, window.BOT_T || {});

  const has = (t, re) => re.test(t);
  const PAGE_LANG = (document.documentElement.lang || 'fr').slice(0, 2);
  const fmt = (s, v) => { for (const k in v) s = s.split('{' + k + '}').join(v[k]); return s; };
  const U = () => (T[PAGE_LANG] || T.fr).ui;
  function detectLang(raw) {
    const t = norm(raw);
    if (/[\u0600-\u06FF]/.test(raw)) return 'ar';
    if (has(t, /\b(hola|quiero|necesito|precio|taquill|estanter|fabrica|buenos|gracias|cuanto|donde|tienen|empresa|armario|silla|presupuesto|almacen|nave|escuela|plazo|usted)\b/)) return 'es';
    if (has(t, /\b(hello|hi|need|price|locker|shelving|factory|quote|how|warehouse|chairs?|desk|delivery|thanks)\b/)) return 'en';
    if (has(t, /\b(bonjour|salut|je|vous|cherche|besoin|merci|devis|combien|est-ce|pour)\b/)) return 'fr';
    return PAGE_LANG;
  }
  const IGNORE = new Set(('je veux voudrais cherche besoin pour une des les avec dans mon ma mes nos notre bonjour salut merci est il elle quel quelle quels quelles combien comment avez vous ' +
    'sont sur vos votre faites faire peut pouvez avoir ont cest ce cet cette ces aussi plus moins tres bien quoi qui que dont car donc mais ou leur leurs tout tous toutes ' +
    'hola quiero necesito busco para una los las con mi mis tienen hay que cual gracias hello need want looking for the and with our usine entreprise societe ' +
    'equiper equipement mobilier produit produits modele svp sil plait ' +
    'من في على إلى عن أريد نريد نحتاج احتاج أبحث ابحث لدي عندي هل ما ماذا كم مع أو و ل لـ هذا هذه التي الذي شكرا مرحبا السلام السعر سعر الثمن ثمن الأسعار أسعار تكلفة أين متى عرض طلب مدة ضمان').split(' '));
  const SECTORS = [
    ['industrie', /\b(usine|industri|fabrica|planta|gueznaya|zone franche|zona franca|free zone|automotive|atelier de production|ouvriers?|operarios|factory)|(?:مصنع|مصانع|عامل|عمال|منطقة حرة|المنطقة الحرة|كزناية|صناعي|خط إنتاج)/],
    ['logistique', /\b(entrepot|stockage|almacen|logisti|magasin pieces|palette|warehouse|tanger med)|(?:مستودع|مخزن|تخزين|لوجست|منصات)/],
    ['ecoles', /\b(ecole|classe|eleve|scolaire|colegio|escuela|aula|alumno|school|rentree|lycee|college)|(?:مدرس|قسم|أقسام|تلاميذ|تلميذ|الدخول المدرسي|ثانوية|إعدادية)/],
    ['bureaux', /\b(open space|oficina|siege social|direction|office|coworking|bureaux? pour)|(?:مكاتب|مكتب مفتوح|مقر|إدارة)/],
    ['commerces', /\b(boutique|commerce|tienda|supermarche|point de vente|magasin de vente|retail|shop)|(?:متجر|محل|متاجر|محلات|سوبرماركت)/],
  ];
  const EXTRA_TERMS = { taquilla: 'vestiaire', taquillas: 'vestiaire', locker: 'vestiaire', lockers: 'vestiaire', estanteria: 'rayonnage', estanterias: 'rayonnage', shelving: 'rayonnage',
    armario: 'armoire', armarios: 'armoire', silla: 'chaise', sillas: 'chaise', chair: 'chaise', chairs: 'chaise', escritorio: 'bureau', desk: 'bureau', mesa: 'table', mesas: 'table',
    cajonera: 'caisson', pupitres: 'pupitre', bancs: 'banc', banco: 'banc', bancos: 'banc', etagere: 'rayonnage', etageres: 'rayonnage', casier: 'vestiaire', casiers: 'vestiaire', palettier: 'rayonnage lourd' };

  const SPECWORDS = /^(dimensions?|tailles?|mesures?|medidas?|tamano|epaisseur|charges?|poids|materiaux?|materiau|tole|size|caracteristiques?|fabrique|fabriques|fabrication|tanger|origine|prix|precio|normes?|ouvriers?|personnes|operarios|postes|eleves|alumnos|usine|fabrica|ajoute|ajouter|anade|add)$/;
  function findProducts(raw) {
    const t = norm(raw);
    const direct = products.filter(p => (p.tag && new RegExp('\\b' + norm(p.tag).replace(/[-\s]/g, '[-\\s]?') + '\\b').test(t)) || new RegExp('\\b' + p.ref.toLowerCase() + '\\b').test(t));
    if (direct.length) return direct;
    const toks = t.replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(w => w.length > 2 && !IGNORE.has(w) && !/^\d+$/.test(w) && !SPECWORDS.test(w)).map(w => EXTRA_TERMS[w] || w);
    if (!toks.length) return [];
    const scored = products.map(p => {
      let s = 0;
      toks.forEach(w => { if (App.matches(p, w)) s += norm(p.name).includes(w.slice(0, 5)) ? 2 : 1; });
      return [p, s];
    }).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
    if (!scored.length) return [];
    const best = scored[0][1];
    const res = scored.filter(([, s]) => s >= Math.max(1, best - 1)).map(([p]) => p).slice(0, 4);
    res.unique = scored.length === 1 || scored[0][1] > scored[1][1];
    return res;
  }
  function specsText(p, L) {
    let s = `**${p.name}** (${p.ref}${p.tag ? ', ' + L.model + ' ' + p.tag : ''})` + (p.desc ? ' — ' + p.desc : '');
    if (p.specs && p.specs.length) s += '\n' + p.specs.map(([k, v]) => `- ${k} : ${v}`).join('\n');
    else s += '\n' + L.noSpecs;
    if (p.origin === 'tanger') s += '\n' + L.made1;
    return s;
  }
  function extractContact(raw) {
    const out = {};
    const email = raw.match(/[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/i); if (email) out.email = email[0];
    const tel = raw.match(/(\+?\d[\d\s.-]{8,}\d)/); if (tel) out.tel = tel[0].trim();
    const soc = raw.match(/(?:soci[ée]t[ée]|sté|ste|empresa|company|entreprise)\s*:?\s*([^,;\n]{2,40})/i); if (soc) out.societe = soc[1].trim();
    const nom = raw.match(/^\s*(?:je suis |me llamo |soy |i am |nom\s*:\s*)?([A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+){1,2})\s*[,;]/u); if (nom) out.nom = nom[1];
    const ville = norm(raw).match(/\b(tanger|tetouan|larache|casablanca|rabat|kenitra|fes|marrakech|agadir|meknes|oujda|gueznaya|mghogha)\b/); if (ville) out.ville = ville[1][0].toUpperCase() + ville[1].slice(1);
    return out;
  }

  function localReply(raw) {
    const lang = detectLang(raw), L = T[lang] || T[PAGE_LANG] || T.fr;
    const t = norm(raw);
    const parts = [], tags = [];
    const prior = history.filter(m => m.role === 'user').map(m => m.content).join('\n');

    const contact = extractContact(raw);
    if (contact.email || contact.tel) {
      const all = { ...extractContact(prior), ...contact };
      const sec = SECTORS.find(([, re]) => re.test(norm(prior + ' ' + raw)));
      if (sec) all.secteur = { industrie: 'Industrie', logistique: 'Entrepôt', ecoles: 'École', bureaux: 'Bureaux', commerces: 'Commerce' }[sec[0]];
      all.message = history.filter(m => m.role === 'user' && m.content !== raw && !extractContact(m.content).tel).map(m => m.content).join('\n').slice(0, 1200);
      tags.push('[[prefill:' + JSON.stringify(all) + ']]', '[[action:devis]]');
      return L.contactGot + '\n\n' + tags.join('\n');
    }
    const addM = t.match(/\b(ajout\w*|ajoute|mets|met|anade|añade|add)\b/);
    if (addM) {
      const ps = findProducts(raw); const p = ps.length && ps.unique ? ps[0] : (!ps.length && lastRefs.length ? byRef[lastRefs[0]] : null);
      if (!p && ps.length) return L.whichRef + '\n\n' + ps.map(x => `[[produit:${x.ref}]]`).join('\n');
      const q = parseInt((t.match(/\b(\d{1,4})\b/) || [])[1], 10) || 1;
      if (p) return fmt(L.added, { q, name: p.name }) + `\n\n[[selection:${p.ref}:${q}]]\n[[produit:${p.ref}]]`;
    }
    if (has(t, /^(bonjour|salut|bonsoir|hola|buenos|buenas|hello|hi|salam)\b|(?:^(مرحبا|السلام|اهلا|أهلا))/) && t.split(' ').length <= 4) return L.hello;
    if (has(t, /(cuisine|meuble tv|table basse|salon|cocina|mueble tv|mesa baja|bardage)|(?:مطبخ|تلفاز|طاولة منخفضة|صالون)/)) parts.push(L.resid);
    if (has(t, /(prix|tarif|cout|combien ca|combien coute|budget|precio|cuanto|cuesta|price|cost)|(?:سعر|ثمن|أسعار|تكلفة|كم يكلف|بكم)/)) { parts.push(L.price); tags.push('[[action:devis]]'); }
    if (has(t, /(delai|quand|livr|rentree|plazo|entrega|cuando|delivery|lead time)|(?:مدة|متى|تسليم|أجل|آجال|الدخول المدرسي)/)) parts.push(L.delay);
    if (has(t, /(casablanca|ou etes|ou se trouve|adresse|direccion|donde|where|intervenez|deplacez|zone d.intervention|qui intervient)|(?:الدار البيضاء|أين|عنوان|موقع|من يتدخل)/)) parts.push(L.where);
    if (has(t, /(fabrique|fabrication|atelier|origine|fabricad|fabrican|made in|produc|local)|(?:صنع|مصنوع|تصنيع|ورشة|منشأ)/)) parts.push(L.made);
    if (has(t, /(norme|certif|\biso\b|\bnf\b|norma|standard|homolog)|(?:معيار|معايير|شهادة|مطابقة)/)) parts.push(L.norm);
    if (has(t, /(garantie|garantia|warranty|sav)|(?:ضمان)/)) parts.push(L.warranty);
    if (has(t, /(etude|visite|visita|estudio|site visit|mesures|releve)|(?:دراسة|زيارة|معاينة|قياس)/)) parts.push(L.study);
    if (has(t, /(telephone|appeler|numero|whatsapp|e-?mail|contact|llamar|telefono|phone)|(?:هاتف|اتصال|رقم|واتساب|بريد)/)) { parts.push(L.contact); tags.push('[[action:whatsapp]]', '[[action:rappel]]'); }
    if (has(t, /(rappel|rappelez|llamada|call me|me llamen)|(?:اتصلوا بي|معاودة الاتصال|اتصلوا)/)) { parts.push(L.callback); tags.push('[[action:rappel]]'); }
    if (has(t, /(fiche technique|fiche|pdf|catalogue|catalogo|datasheet)|(?:بطاقة تقنية|كتالوج|دليل)/) && !parts.length) parts.push(L.sheet);

    const ps = findProducts(raw);
    const specQ = has(t, /(dimension|taille|mesure|medida|tamano|epaisseur|charge|poids|materia|tole|size|caracteristique|carac)|(?:أبعاد|مقاس|قياسات|حجم|سمك|حمولة|وزن|مواصفات)/);
    const madeQ = has(t, /(fabrique|fabrica|made|origine|produit a tanger|importe)|(?:صنع|مصنوع|منشأ|مستورد)/);
    if ((ps.length && ps.unique) || ps.length === 1 || (specQ && !ps.length && lastRefs.length)) {
      const p = ps[0] || byRef[lastRefs[0]];
      if (madeQ) {
        const i = parts.indexOf(L.made); if (i >= 0) parts.splice(i, 1);
        parts.push(fmt(p.origin === 'tanger' ? L.madeYes : p.origin === 'distribue' ? L.madeNo : L.madeUnknown, { name: p.name }));
      } else parts.push(specsText(p, L));
      tags.push(`[[produit:${p.ref}]]`);
    } else if (ps.length) {
      parts.push(ps.length > 1 ? L.foundN : L.found1); ps.forEach(p => tags.push(`[[produit:${p.ref}]]`));
    }
    const sec = SECTORS.find(([, re]) => re.test(t));
    if (sec && (!ps.length || !parts.length || ps.length > 1)) {
      if (ps.length > 1) { const i = parts.indexOf(L.foundN); if (i >= 0) parts.splice(i, 1); }
      const qtyKnown = /\b\d{1,4}\s*(vestiaires?|personnes|ouvriers|eleves|postes|classes|taquillas|operarios|alumnos|puestos|aulas|عامل|عمال|تلميذ|تلاميذ|خزانة|خزائن|مكتب|قسم|أقسام)/.test(t);
      parts.push(qtyKnown ? L.sec[sec[0]].replace(/\s[^.!]*\?$/, '') : L.sec[sec[0]]);
      const pick = { industrie: ['VES-01', 'VES-02', 'ARM-01', 'STO-04'], logistique: ['STO-01', 'STO-03', 'STO-05', 'STO-06'], ecoles: ['SCO-01', 'SCO-09', 'SCO-06', 'SCO-10'],
        bureaux: ['BUR-07', 'SIE-19', 'ARM-04', 'BUR-05'], commerces: ['STO-04', 'STO-02'] }[sec[0]];
      if (!ps.length) pick.forEach(r => byRef[r] && tags.push(`[[produit:${r}]]`));
    }
    if (has(t, /(devis|cotation|commander|presupuesto|quote|offre)|(?:عرض سعر|تسعير|طلب|أطلب|اطلب)/)) { parts.push(L.quote); tags.push('[[action:devis]]'); }
    const qty = t.match(/\b(\d{1,4})\s*(vestiaires?|personnes|ouvriers|eleves|postes|classes|taquillas|operarios|alumnos|puestos|عامل|عمال|تلميذ|تلاميذ|خزانة|خزائن|مكتب|قسم|أقسام)/);
    if (qty && !parts.some(p => p === L.quote)) { parts.push(L.qtyNoted); tags.push('[[action:devis]]'); }

    if (!parts.length) parts.push(ps.length ? (ps.length > 1 ? L.foundN : L.found1) : (t.split(' ').length > 3 ? L.none + '\n\n' + L.ask : L.ask));
    return parts.join('\n\n') + (tags.length ? '\n\n' + [...new Set(tags)].join('\n') : '');
  }
  window.OBMAssistant = { localReply };

  function chips(list) {
    $('#botChips').innerHTML = list.map(c => `<button type="button">${esc(c)}</button>`).join('');
  }
  const START = () => U().chips;
  function setMode() { $('#botMode').textContent = mode === 'ai' ? U().modeAI : U().modeLocal; }
  function welcome() {
    log.innerHTML = '';
    bubble('assistant', U().welcome);
    chips(START());
  }
  function restore() {
    log.innerHTML = '';
    if (!history.length) return welcome();
    history.forEach(m => bubble(m.role, m.content));
  }
  function open(prefillText) {
    bot.hidden = false; $('#botLaunch').setAttribute('aria-expanded', 'true'); $('#botLaunch').classList.add('on');
    if (phone.matches) document.body.classList.add('bot-open');
    fitViewport();
    if (!log.children.length) restore();
    if (prefillText) send(prefillText); else if (!phone.matches) input.focus();
    App.track('assistant_open');
  }
  function close() {
    bot.hidden = true; $('#botLaunch').setAttribute('aria-expanded', 'false'); $('#botLaunch').classList.remove('on');
    document.body.classList.remove('bot-open'); ['height', 'top', 'left', 'width', 'right'].forEach(k => { bot.style[k] = ''; });
  }
  function fitViewport() {
    if (bot.hidden || !phone.matches || !window.visualViewport) return;
    const v = visualViewport;
    Object.assign(bot.style, { top: v.offsetTop + 'px', left: v.offsetLeft + 'px', width: v.width + 'px', height: v.height + 'px', right: 'auto' });
    log.scrollTop = log.scrollHeight;
  }
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport);
  window.OBMAssistant.open = open;
  $('#botLaunch').onclick = () => (bot.hidden ? open() : close());
  $('#botClose').onclick = close;
  $('#botReset').onclick = () => { history = []; lastRefs = []; save(); welcome(); };
  $('#botChips').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    send(b.textContent);
  });
  $('#botForm').addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; input.style.height = ''; send(v); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#botForm').requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !bot.hidden && $('#modal').hidden) close(); });
  setMode();
})();

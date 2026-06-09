/*
  app.js — Consensus BarStock v2.1
  CSS séparé | Historique fournisseur avec livraisons
  Séparation CA ventes / pertes / retours
*/

// ==================== SUPABASE ====================
const SUPABASE_URL = "https://jwskhozdukcurjnpsgtm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2tob3pkdWtjdXJqbnBzZ3RtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODA0NzcsImV4cCI6MjA5NjE1NjQ3N30.fLkpT9AK7mXdz6HxxVUKyK7fRNDHnjYNk4l_K-qBO30";
const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==================== STATE ====================
let boissons = [];
let panier = {};
let historique = [];
let filtreCatalogue = '';
let filtreVentes = '';
let modeStockage = 'appro';
let graphiqueInstance = null;
// Suivi détaillé de la commande en cours (Stockage / Récup)
let commandeEnCours = []; // [{ designation, type, qte, cout }]

// ==================== UTILITAIRES ====================
function formatPrix(val) {
  return new Intl.NumberFormat('fr-TG', { style:'currency', currency:'XOF', minimumFractionDigits:0 })
    .format(val).replace('XOF','FCFA');
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerText = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3300);
}

function dateStr() {
  const n = new Date();
  return n.toLocaleDateString('fr-FR') + " à " + n.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}

// ==================== MODE SOMBRE ====================
function toggleDarkMode() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  const btn = document.getElementById('btn-dark');
  if (btn) btn.innerText = isDark ? '☀️ Mode clair' : '🌙 Mode sombre';
  localStorage.setItem('darkMode', isDark ? '1' : '0');
}

function appliquerDarkMode() {
  if (localStorage.getItem('darkMode') === '1') {
    document.body.classList.add('dark');
    const btn = document.getElementById('btn-dark');
    if (btn) btn.innerText = '☀️ Mode clair';
  }
}

// ==================== OFFLINE ====================
function gererConnexion() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  window.addEventListener('offline', () => banner.classList.add('visible'));
  window.addEventListener('online', () => { banner.classList.remove('visible'); initialiserApplication(); });
  if (!navigator.onLine) banner.classList.add('visible');
}

// ==================== INIT ====================
async function initialiserApplication() {
  try {
    const { data: db, error: eB } = await client.from('boissons').select('*').order('designation', { ascending: true });
    if (eB) throw eB;
    boissons = db || [];

    const { data: dv, error: eV } = await client.from('ventes')
      .select('id, total, benefice, benef, date, created_at, vente_articles(boisson_designation, quantite, prix_unitaire)')
      .order('created_at', { ascending: false });
    if (eV) throw eV;

    historique = (dv || []).map(v => {
      let dateAff = v.date;
      if (!dateAff && v.created_at) dateAff = new Date(v.created_at).toLocaleString('fr-FR');
      const gain = v.benefice != null ? v.benefice : (v.benef || 0);
      let arts = (v.vente_articles || []).map(a => ({ nom: a.boisson_designation, qte: a.quantite }));
      if (arts.length === 0 && v.articles) {
        try {
          const a = typeof v.articles === 'string' ? JSON.parse(v.articles) : v.articles;
          if (Array.isArray(a)) arts = a.map(x => ({ nom: x.designation || x.nom, qte: x.qte || x.quantite }));
        } catch { arts = [{ nom: "📦 PAIEMENT FOURNISSEUR", qte: 1 }]; }
      }
      return { id: v.id, date: dateAff || 'Date inconnue', total: v.total, benef: gain, articles: arts };
    });

    mettreAJourStatsDuJour();
    rafrachirVueActive();
  } catch (err) {
    console.error(err);
    toast('❌ Erreur chargement : ' + err.message, 'error');
  }
}

// ==================== STATS DU JOUR ====================
function mettreAJourStatsDuJour() {
  const auj = new Date().toLocaleDateString('fr-FR');
  const ventesJ = historique.filter(v => v.date && v.date.startsWith(auj));
  const nb = ventesJ.filter(v => !estSpecial(v)).length;
  const totalJ = ventesJ.filter(v => !estSpecial(v)).reduce((s, v) => s + (parseInt(v.total) || 0), 0);
  const benefJ = ventesJ.reduce((s, v) => s + (parseInt(v.benef) || 0), 0);
  const rupt = boissons.filter(b => b.stock === 0).length;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  set('sj-nb', nb + ' vente(s)');
  set('sj-total', formatPrix(Math.max(0, totalJ)));
  set('sj-benef', formatPrix(benefJ));
  set('sj-rupture', rupt + ' article(s)');
}

function estSpecial(v) {
  const det = (v.articles || []).map(a => (a.nom || '')).join(' ').toUpperCase();
  return det.includes('RETOUR') || det.includes('PERTE') || det.includes('CASSE') || det.includes('FOURNISSEUR');
}

// ==================== NAVIGATION ====================
function rafrachirVueActive() {
  const sec = document.querySelector('.section.active');
  if (!sec) return;
  const id = sec.id;
  if (id === 'catalogue') { afficherCatalogue(); statsCatalogue(); }
  else if (id === 'etat-stock') afficherEtatProduits();
  else if (id === 'stockage-recup') afficherStockage();
  else if (id === 'ventes') { afficherVentes(); mettreAJourTicket(); afficherDerniereVente(); }
  else if (id === 'historique') { afficherHistorique(); chargerEspaceFournisseur(); dessinerGraphique(); }
}

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const sec = document.getElementById(id); if (sec) sec.classList.add('active');
  const btn = document.querySelector(`[data-section="${id}"]`); if (btn) btn.classList.add('active');
  rafrachirVueActive();
}

// ==================== CATALOGUE ====================
function statsCatalogue() {
  const ok = boissons.filter(b => b.stock > b.seuil).length;
  const alerte = boissons.filter(b => b.stock > 0 && b.stock <= b.seuil).length;
  const rupt = boissons.filter(b => b.stock === 0).length;
  const div = document.getElementById('stats-catalogue'); if (!div) return;
  div.innerHTML = `
    <div class="stat-box"><div class="stat-label">Total Boissons</div><div class="stat-value">${boissons.length}</div></div>
    <div class="stat-box"><div class="stat-label">Stock OK</div><div class="stat-value vert">${ok}</div></div>
    <div class="stat-box"><div class="stat-label">Sous le Seuil</div><div class="stat-value orange">${alerte}</div></div>
    <div class="stat-box"><div class="stat-label">En Rupture</div><div class="stat-value rouge">${rupt}</div></div>`;
}

function afficherCatalogue() {
  filtreCatalogue = (document.getElementById('search-catalogue') || { value:'' }).value || filtreCatalogue;
  const terme = filtreCatalogue.toLowerCase();
  const fil = boissons.filter(b => b.designation.toLowerCase().includes(terme));
  const tbody = document.querySelector('#table-catalogue tbody'); if (!tbody) return;
  if (fil.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="vide">Aucune boisson</td></tr>'; return; }
  tbody.innerHTML = fil.map(b => {
    const st = b.stock === 0 ? '<span class="tag tag-rouge">Épuisé</span>'
      : (b.stock <= b.seuil ? '<span class="tag tag-orange">Seuil Alerte</span>' : '<span class="tag tag-vert">Stock OK</span>');
    const prix = `<div style="font-size:13px;">📦 1 Cas. : <strong>${formatPrix(b.pu_initial)}</strong><br>🥛 ½ Cas. : ${formatPrix(b.demi_cassier || Math.round(b.pu_initial/2))}${b.type_bouteille==="petit bouteille"&&b.quart_cassier?`<br>🧪 ¼ Cas. : ${formatPrix(b.quart_cassier)}`:''}</div>`;
    return `<tr><td><strong>${b.designation}</strong></td><td><span class="tag-type">${b.type_bouteille==="petit bouteille"?"Petit":"Grand"}</span></td><td>${b.categorie||'-'}</td><td>${prix}</td><td>${b.prix_unitaire>0?formatPrix(b.prix_unitaire):'<em style="color:#ef6c00;">À configurer</em>'}</td><td><strong>${b.stock}</strong></td><td>${st}</td><td><button class="btn btn-sm" onclick="modifierStock(${b.id})">📏 Stock</button> <button class="btn btn-sm" onclick="modifierPrixUnitaire(${b.id})">✏️ Prix</button> <button class="btn btn-danger btn-sm" onclick="supprimerBoisson(${b.id})">🗑️</button></td></tr>`;
  }).join('');
}

async function modifierStock(id) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  const s = prompt(`Stock de ${b.designation}\nActuel : ${b.stock}`, b.stock); if (s===null) return;
  const n = parseInt(s); if (isNaN(n)||n<0) { alert("❌ Nombre valide requis"); return; }
  try { const { error } = await client.from('boissons').update({ stock: n }).eq('id', id); if (error) throw error; toast(`✅ Stock ${b.designation} → ${n}`); await initialiserApplication(); }
  catch (err) { toast('❌ '+err.message,'error'); }
}

async function modifierSeuil(id) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  const s = prompt(`Seuil d'alerte pour ${b.designation}\nActuel : ${b.seuil||6}`, b.seuil||6); if (s===null) return;
  const n = parseInt(s); if (isNaN(n)||n<1) { alert("❌ Seuil invalide"); return; }
  try { const { error } = await client.from('boissons').update({ seuil: n }).eq('id', id); if (error) throw error; toast(`✅ Seuil ${b.designation} → ${n}`); await initialiserApplication(); }
  catch (err) { toast('❌ '+err.message,'error'); }
}

async function ajouterBoisson(e) {
  if (e) e.preventDefault();
  const nom = document.getElementById('cat-nom').value.trim().toUpperCase();
  const type = document.getElementById('cat-type').value;
  const categorie = document.getElementById('cat-categorie').value;
  const puInit = parseInt(document.getElementById('cat-pu-initial').value)||0;
  const pUnit = parseInt(document.getElementById('cat-prix-unitaire').value)||0;
  const stock = parseInt(document.getElementById('cat-stock').value)||0;
  const seuil = parseInt(document.getElementById('cat-seuil').value)||6;
  if (!nom||puInit<=0) { alert("❌ Nom et prix du cassier obligatoires."); return; }
  if (boissons.some(b => b.designation===nom)) { alert("❌ Boisson déjà enregistrée !"); return; }
  const demi = Math.round(puInit/2), quart = type==="petit bouteille"?Math.round(puInit/4):null;
  const qteCassier = type==="petit bouteille"?24:12;
  try {
    const { error } = await client.from('boissons').insert([{ designation:nom, categorie, type_bouteille:type, pu_initial:puInit, prix_unitaire:pUnit, demi_cassier:demi, quart_cassier:quart, quantite_par_cassier:qteCassier, stock, seuil }]);
    if (error) throw error;
    document.getElementById('form-ajouter-boisson').reset();
    toast('✅ '+nom+' ajouté !'); await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function modifierPrixUnitaire(id) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  const rep = prompt(`Prix vente unitaire de ${b.designation} (Actuel : ${b.prix_unitaire} FCFA) :`, b.prix_unitaire); if (rep===null) return;
  try { const { error } = await client.from('boissons').update({ prix_unitaire: parseInt(rep)||0 }).eq('id', id); if (error) throw error; toast('✅ Prix mis à jour'); await initialiserApplication(); }
  catch (err) { toast('❌ '+err.message,'error'); }
}

async function supprimerBoisson(id) {
  if (!confirm("Supprimer cette boisson définitivement ?")) return;
  try { const { error } = await client.from('boissons').delete().eq('id', id); if (error) throw error; toast('🗑️ Boisson supprimée'); await initialiserApplication(); }
  catch (err) { toast('❌ '+err.message,'error'); }
}

// ==================== ÉTAT STOCK ====================
function afficherEtatProduits() {
  const terme = (document.getElementById('search-stock')||{}).value?.toLowerCase()||'';
  const fil = boissons.filter(b => b.designation.toLowerCase().includes(terme));
  const tbody = document.querySelector('#table-etat-produits tbody'); if (!tbody) return;
  if (fil.length===0) { tbody.innerHTML='<tr><td colspan="7" class="vide">Aucun produit</td></tr>'; return; }
  tbody.innerHTML = fil.map(b => {
    const seuil = b.seuil||6;
    let rs='', st='';
    if (b.stock===0) { rs='style="background:#ffebee;"'; st='<span class="tag tag-rouge">🔴 RUPTURE</span>'; }
    else if (b.stock<=seuil) { rs='style="background:#fff3e0;"'; st='<span class="tag tag-orange">🟠 STOCK BAS</span>'; }
    else { rs='style="background:#e8f5e9;"'; st='<span class="tag tag-vert">🟢 OK</span>'; }
    return `<tr ${rs}><td><strong>${b.designation}</strong></td><td><span class="tag-type">${b.type_bouteille}</span></td><td>${b.categorie||'-'}</td><td><strong>${b.stock}</strong></td><td>${seuil} btl</td><td>${st}</td><td><button class="btn btn-sm" onclick="modifierStock(${b.id})">📦 Stock</button> <button class="btn btn-sm btn-warning" onclick="modifierSeuil(${b.id})">⚙️ Seuil</button></td></tr>`;
  }).join('');
}
function filtrerEtatStock() { afficherEtatProduits(); }

// ==================== STOCKAGE ====================
function changerModeStockage(mode) {
  modeStockage = mode;
  const bA = document.getElementById('btn-mode-appro'), bR = document.getElementById('btn-mode-retour');
  const titre = document.getElementById('stockage-titre'), desc = document.getElementById('stockage-description');
  const thP = document.getElementById('th-dynamique-prix'), thA = document.getElementById('th-dynamique-action');
  if (mode==='appro') {
    if(bA){bA.style.background='#e8f5e9';bA.style.color='#2e7d32';bA.style.border='none';}
    if(bR){bR.style.background='#fff';bR.style.color='#555';bR.style.border='1px solid #ccc';}
    if(titre) titre.innerHTML="📦 Approvisionnement fournisseur";
    if(desc) desc.innerHTML="💡 Prix calculé sur le <strong>prix du cassier</strong>.";
    if(thP) thP.innerHTML="Prix Cassier"; if(thA) thA.innerHTML="Ajouter Stock";
  } else {
    if(bA){bA.style.background='#fff';bA.style.color='#555';bA.style.border='1px solid #ccc';}
    if(bR){bR.style.background='#e1f5fe';bR.style.color='#0288d1';bR.style.border='none';}
    if(titre) titre.innerHTML="🔄 Retour client / Pertes bouteilles";
    if(desc) desc.innerHTML="💡 Retours clients ou pertes/casses. Ajustements à l'unité.";
    if(thP) thP.innerHTML="Prix Vente Unit."; if(thA) thA.innerHTML="Ajustements";
  }
  afficherStockage();
}

function afficherStockage() {
  const tbody = document.getElementById('tbody-stockage'); if (!tbody) return;
  const zF = document.getElementById('zone-total-fournisseur');
  if (zF) zF.style.display = (modeStockage==='appro') ? 'flex' : 'none';
  if (modeStockage==='appro') {
    const tfEl = document.getElementById('total-fournisseur-stockage');
    client.from('config').select('valeur').eq('cle','total_fournisseur').single()
      .then(({ data }) => { if (data && tfEl) tfEl.innerText = formatPrix(parseInt(data.valeur)||0); });
  }
  const terme = (document.getElementById('search-stockage')||{value:''}).value.toLowerCase();
  const fil = boissons.filter(b => b.designation.toLowerCase().includes(terme));
  if (fil.length===0) { tbody.innerHTML='<tr><td colspan="5" class="vide">Aucune boisson</td></tr>'; return; }
  const grands = fil.filter(b => b.type_bouteille!=="petit bouteille");
  const petits = fil.filter(b => b.type_bouteille==="petit bouteille");
  const gen = (b) => {
    const lbl = b.type_bouteille==="petit bouteille"?"Petit":"Grand";
    let cp='', ca='';
    if (modeStockage==='appro') {
      cp=`1 Cas. : <strong>${formatPrix(b.pu_initial)}</strong><br><span style="color:#555;">½ Cas. : ${formatPrix(b.demi_cassier||Math.round(b.pu_initial/2))}</span>${b.type_bouteille==="petit bouteille"&&b.quart_cassier?`<br><span style="color:#0288d1;">¼ Cas. : ${formatPrix(b.quart_cassier)}</span>`:''}`;
      ca=`<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-sm" style="background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;border-radius:20px;" onclick="entreeStock(${b.id},'cassier')">📦 +1 cas.</button><button class="btn btn-sm" style="background:#fff3e0;color:#e65100;border:1px solid #ffcc80;border-radius:20px;" onclick="entreeStock(${b.id},'demi')">📦 +½ cas.</button>${b.type_bouteille==="petit bouteille"?`<button class="btn btn-sm" style="background:#e1f5fe;color:#0288d1;border:1px solid #b3e5fc;border-radius:20px;" onclick="entreeStock(${b.id},'quart')">🧪 +¼ cas.</button>`:''}</div>`;
    } else {
      cp=`<strong>${formatPrix(b.prix_unitaire||0)}</strong> / btl`;
      ca=`<div style="display:flex;gap:8px;"><button class="btn btn-sm" style="background:#e1f5fe;color:#0288d1;border:1px solid #b3e5fc;border-radius:20px;" onclick="ajusterRetour(${b.id},1)">🔄 +1 Retour</button><button class="btn btn-danger btn-sm" style="border-radius:20px;" onclick="ajusterRetour(${b.id},-1)">⚠️ -1 Perte</button></div>`;
    }
    return `<tr style="border-bottom:1px solid #f5f5f5;"><td style="padding:14px 10px;font-weight:bold;">${b.designation}</td><td style="padding:14px 10px;"><span class="tag-type">${lbl}</span></td><td style="padding:14px 10px;text-align:center;"><span style="display:inline-block;padding:6px 12px;border:1px solid #e0e0e0;border-radius:20px;font-weight:bold;">${b.stock}</span></td><td style="padding:14px 10px;font-size:13px;">${cp}</td><td style="padding:14px 10px;">${ca}</td></tr>`;
  };
  let html='';
  if (grands.length>0) html+=`<tr style="background:#f8fafc;font-weight:bold;"><td colspan="5" style="padding:12px;border-left:4px solid #475569;">👑 GRANDS MODÈLES</td></tr>`+grands.map(gen).join('');
  if (petits.length>0) html+=`<tr style="background:#f0f9ff;font-weight:bold;"><td colspan="5" style="padding:12px;border-left:4px solid #0288d1;">🧪 PETITS MODÈLES</td></tr>`+petits.map(gen).join('');
  tbody.innerHTML=html;
}

async function entreeStock(id, type) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  const qpc = b.quantite_par_cassier||(b.type_bouteille==="petit bouteille"?24:12);
  let qte=0, cout=0, txt='';
  if (type==='cassier') { qte=qpc; cout=b.pu_initial; txt="1 cassier entier"; }
  else if (type==='demi') { qte=Math.round(qpc/2); cout=b.demi_cassier||Math.round(b.pu_initial/2); txt="un demi-cassier"; }
  else if (type==='quart') { qte=Math.round(qpc/4); cout=b.quart_cassier||Math.round(b.pu_initial/4); txt="un quart-cassier"; }
  if (!confirm(`Ajouter ${txt} (${qte} btl) pour ${b.designation} ?`)) return;
  try {
    const { error: eS } = await client.from('boissons').update({ stock: b.stock+qte }).eq('id', id); if (eS) throw eS;
    const { data: cfg } = await client.from('config').select('valeur').eq('cle','total_fournisseur').single();
    const nv = (cfg?parseInt(cfg.valeur)||0:0)+cout;
    await client.from('config').upsert({ cle:'total_fournisseur', valeur:nv.toString() });
    // Mémoriser dans la commande en cours
    const existing = commandeEnCours.find(c => c.designation===b.designation && c.type===txt);
    if (existing) { existing.qte+=qte; existing.cout+=cout; }
    else commandeEnCours.push({ designation:b.designation, type:txt, qte, cout });
    toast(`✅ +${qte} btl ${b.designation}`); await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function ajusterRetour(id, delta) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  if (delta<0&&b.stock<=0) { alert(`❌ Stock de ${b.designation} déjà à 0.`); return; }
  const qpc = b.quantite_par_cassier||(b.type_bouteille==="petit bouteille"?24:12);
  const pAchat = b.pu_initial>0?Math.round(b.pu_initial/qpc):0;
  if (delta<0&&pAchat===0) { alert(`❌ Prix d'achat non configuré pour ${b.designation}.`); return; }
  const typeOp = delta>0?`🔄 RETOUR CLIENT : ${b.designation}`:`⚠️ PERTE/CASSE : ${b.designation}`;
  const tImpact = delta>0?-(b.prix_unitaire):0;
  const bImpact = delta>0?-(b.prix_unitaire-pAchat):-pAchat;
  const msg = delta>0?`Retour client : ${b.designation}. Stock +1, vente déduite (${formatPrix(b.prix_unitaire)}).`:`Perte/casse : ${b.designation}. Stock -1, perte ${formatPrix(pAchat)}.`;
  if (!confirm(msg)) return;
  try {
    const { error: eS } = await client.from('boissons').update({ stock: b.stock+delta }).eq('id', id); if (eS) throw eS;
    const { data: tr, error: eH } = await client.from('ventes').insert([{ total:tImpact, benefice:bImpact, benef:bImpact, date:dateStr() }]).select().single(); if (eH) throw eH;
    await client.from('vente_articles').insert([{ vente_id:tr.id, boisson_designation:typeOp, quantite:1, prix_unitaire:tImpact }]);
    toast(delta>0?'🔄 Retour enregistré':'📉 Perte enregistrée', delta>0?'info':'warning');
    await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

// ==================== CAISSE ====================
function afficherVentes() {
  filtreVentes = (document.getElementById('search-ventes')||{value:''}).value||filtreVentes;
  const terme = filtreVentes.toLowerCase();
  const dispo = boissons.filter(b => b.stock>0&&(terme===''||b.designation.toLowerCase().includes(terme)));
  const div = document.getElementById('liste-produits-vente'); if (!div) return;
  if (dispo.length===0) { div.innerHTML='<p class="vide">Aucun produit disponible.</p>'; mettreAJourTicket(); return; }
  div.innerHTML = dispo.map(b => {
    const qte = panier[b.id]||0;
    const affP = b.prix_unitaire>0?`<strong>${formatPrix(b.prix_unitaire)}</strong>`:`<span style="color:#ef6c00;">À définir <button class="btn btn-sm" onclick="modifierPrixUnitaire(${b.id})">✏️</button></span>`;
    return `<div class="produit-vente-card"><div class="produit-vente-infos"><div class="produit-vente-nom">${b.designation}</div><div class="produit-vente-stock">Reste : <span>${b.stock}</span> btl(s)</div><div class="produit-vente-prix">${affP}</div></div><div class="produit-vente-actions"><button class="btn btn-sm" onclick="modifierPanier(${b.id},-1)">−</button><input type="number" class="qte-input" id="qte-${b.id}" value="${qte}" min="0" max="${b.stock}" onchange="saisirQuantiteDirecte(${b.id},this.value,${b.stock})" onfocus="this.select()"><button class="btn btn-sm" onclick="modifierPanier(${b.id},1)">+</button></div></div>`;
  }).join('');
}

function modifierPanier(id, delta) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  if (b.prix_unitaire<=0&&delta>0) { alert(`❌ Fixe d'abord le prix de ${b.designation}.`); return; }
  const nv = Math.max(0, Math.min(b.stock, (panier[id]||0)+delta));
  if (nv===0) delete panier[id]; else panier[id]=nv;
  const el = document.getElementById(`qte-${id}`); if (el) el.value=nv;
  mettreAJourTicket();
}

function saisirQuantiteDirecte(id, valeur, stockDispo) {
  let qte = parseInt(valeur); if (isNaN(qte)||qte<0) qte=0;
  if (qte>stockDispo) { alert(`⚠️ Stock insuffisant ! Max : ${stockDispo}`); qte=stockDispo; }
  const b = boissons.find(i => i.id===id); if (!b) return;
  if (b.prix_unitaire<=0&&qte>0) { alert(`❌ Fixe d'abord le prix de ${b.designation}.`); afficherVentes(); return; }
  if (qte===0) delete panier[id]; else panier[id]=qte;
  const el = document.getElementById(`qte-${id}`); if (el) el.value=qte;
  mettreAJourTicket();
}

function mettreAJourTicket() {
  const detail = document.getElementById('ticket-detail'); if (!detail) return;
  if (Object.keys(panier).length===0) {
    detail.innerHTML='<p class="vide">Ticket de caisse vide</p>';
    ['total-montant','recap-bbc','recap-benef'].forEach(id => { const el=document.getElementById(id); if(el) el.innerText='0 FCFA'; });
    return;
  }
  let tv=0, ta=0, html='<ul style="list-style:none;padding:0;margin:0;">';
  for (const id in panier) {
    const b = boissons.find(i => i.id==id); if (!b) continue;
    const qte=panier[id], sous=b.prix_unitaire*qte; tv+=sous;
    const qpc=b.quantite_par_cassier||(b.type_bouteille==="petit bouteille"?24:12);
    ta+=(b.pu_initial>0?Math.round(b.pu_initial/qpc):0)*qte;
    html+=`<li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #ddd;font-size:14px;"><span><strong>${b.designation}</strong> × ${qte}</span><span>${formatPrix(sous)}</span></li>`;
  }
  html+='</ul>';
  detail.innerHTML=html;
  const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.innerText=val; };
  set('total-montant',formatPrix(tv)); set('recap-bbc',formatPrix(ta)); set('recap-benef',formatPrix(tv-ta));
}

function afficherDerniereVente() {
  const el = document.getElementById('derniere-vente-info'); if (!el) return;
  const vr = historique.filter(v => !estSpecial(v));
  el.innerText = vr.length>0?`${vr[0].date} — ${formatPrix(vr[0].total)}`:'Aucune vente enregistrée';
}

// ==================== MODAL VENTE ====================
function ouvrirModalVente() {
  if (Object.keys(panier).length===0) { toast('⚠️ Panier vide !','warning'); return; }
  let total=0, html='';
  for (const id in panier) {
    const b = boissons.find(i => i.id==id); if (!b) continue;
    const sous=b.prix_unitaire*panier[id]; total+=sous;
    html+=`<div class="modal-recap-ligne"><span>${b.designation} × ${panier[id]}</span><span>${formatPrix(sous)}</span></div>`;
  }
  html+=`<div class="modal-recap-ligne"><span>TOTAL</span><span style="color:var(--primary);">${formatPrix(total)}</span></div>`;
  const c = document.getElementById('modal-recap-contenu'); if (c) c.innerHTML=html;
  document.getElementById('modal-confirm-vente').classList.add('visible');
}

function fermerModalVente() { document.getElementById('modal-confirm-vente').classList.remove('visible'); }

async function confirmerVenteFinale() {
  for (const id in panier) {
    const b = boissons.find(i => i.id==id); if (!b) continue;
    if (panier[id]>b.stock) { fermerModalVente(); toast(`❌ Stock insuffisant pour ${b.designation} !`,'error'); await initialiserApplication(); return; }
  }
  fermerModalVente(); await validerVente();
}

async function validerVente() {
  if (Object.keys(panier).length===0) return;
  let tv=0, tb=0; const arts=[];
  for (const id in panier) {
    const qte=panier[id], b=boissons.find(i=>i.id==id); if (!b) continue;
    const qpc=b.quantite_par_cassier||(b.type_bouteille==="petit bouteille"?24:12);
    const aU=b.pu_initial>0?Math.round(b.pu_initial/qpc):0;
    tv+=b.prix_unitaire*qte; tb+=(b.prix_unitaire-aU)*qte;
    arts.push({ id:b.id, designation:b.designation, quantite:qte, prix_unitaire:b.prix_unitaire, stockActuel:b.stock });
  }
  try {
    const { data: tr, error } = await client.from('ventes').insert([{ total:tv, benefice:tb, benef:tb, date:dateStr() }]).select().single();
    if (error) throw error;
    for (const art of arts) {
      const { error:eA } = await client.from('vente_articles').insert([{ vente_id:tr.id, boisson_designation:art.designation, quantite:art.quantite, prix_unitaire:art.prix_unitaire }]);
      if (eA) throw eA;
      const { error:eS } = await client.from('boissons').update({ stock:art.stockActuel-art.quantite }).eq('id', art.id);
      if (eS) throw eS;
    }
    toast('✅ Vente enregistrée ! '+formatPrix(tv)); panier={};
    await initialiserApplication();
  } catch (err) { console.error(err); toast('❌ Erreur vente : '+err.message,'error'); }
}

function annulerVente() {
  if (Object.keys(panier).length===0) return;
  if (!confirm("Vider le panier ?")) return;
  panier={}; rafrachirVueActive();
}

async function annulerDerniereVente() {
  const vr = historique.filter(v => !estSpecial(v));
  if (vr.length===0) { toast('Aucune vente à annuler.','warning'); return; }
  const v = vr[0];
  const det = (v.articles||[]).map(a=>`${a.nom} ×${a.qte}`).join(', ');
  if (!confirm(`Annuler la vente du ${v.date} ?\n${det}\nTotal : ${formatPrix(v.total)}\n\nLe stock sera remis à jour.`)) return;
  try {
    for (const art of v.articles||[]) {
      const b = boissons.find(i=>i.designation===art.nom);
      if (b) await client.from('boissons').update({ stock:b.stock+art.qte }).eq('id',b.id);
    }
    await client.from('vente_articles').delete().eq('vente_id',v.id);
    await client.from('ventes').delete().eq('id',v.id);
    toast('↩️ Vente annulée, stock remis à jour.','info'); await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

// ==================== HISTORIQUE ====================
function reinitialiserFiltres() {
  ['filtre-histo-boisson','filtre-histo-date'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const sel=document.getElementById('filtre-histo-type'); if(sel) sel.value='';
  afficherHistorique();
}

function afficherHistorique() {
  // --- Séparation stricte : ventes seules vs pertes/retours ---
  const ventesSeules = historique.filter(v => !estSpecial(v));
  const pertesRetours = historique.filter(v => {
    const d=(v.articles||[]).map(a=>a.nom||'').join(' ').toUpperCase();
    return d.includes('RETOUR')||d.includes('PERTE')||d.includes('CASSE');
  });
  const totalCA = ventesSeules.reduce((s,v)=>s+(parseInt(v.total)||0),0);
  const totalBenef = historique.reduce((s,v)=>s+(parseInt(v.benef)||0),0);
  const totalPertes = pertesRetours.reduce((s,v)=>s+Math.abs(parseInt(v.benef)||0),0);

  const statsDiv = document.getElementById('stats-historique');
  if (statsDiv) {
    statsDiv.innerHTML = `
      <div class="stat-box" style="border-left-color:#1565c0;">
        <div class="stat-label">Chiffre d'affaires (ventes uniquement)</div>
        <div class="stat-value vert">${formatPrix(totalCA)}</div>
      </div>
      <div class="stat-box" style="border-left-color:#2e7d32;">
        <div class="stat-label">Bénéfice Net (après pertes/retours)</div>
        <div class="stat-value ${totalBenef<0?'rouge':'vert'}">${formatPrix(totalBenef)}</div>
      </div>
      <div class="stat-box" style="border-left-color:#ef6c00;">
        <div class="stat-label">Total Pertes & Retours</div>
        <div class="stat-value orange">${formatPrix(totalPertes)}</div>
      </div>`;
  }

  // Filtres
  const fB=(document.getElementById('filtre-histo-boisson')||{value:''}).value.toLowerCase();
  const fD=(document.getElementById('filtre-histo-date')||{value:''}).value.toLowerCase();
  const fT=(document.getElementById('filtre-histo-type')||{value:''}).value.toLowerCase();
  let filtre = historique;
  if (fB) filtre=filtre.filter(v=>(v.articles||[]).some(a=>(a.nom||'').toLowerCase().includes(fB)));
  if (fD) filtre=filtre.filter(v=>(v.date||'').toLowerCase().includes(fD));
  if (fT) filtre=filtre.filter(v=>{
    const d=(v.articles||[]).map(a=>a.nom||'').join(' ').toUpperCase();
    if(fT==='vente') return !d.includes('RETOUR')&&!d.includes('PERTE')&&!d.includes('FOURNISSEUR');
    if(fT==='retour') return d.includes('RETOUR');
    if(fT==='perte') return d.includes('PERTE')||d.includes('CASSE');
    if(fT==='fournisseur') return d.includes('FOURNISSEUR');
    return true;
  });

  const tbody = document.getElementById('historique-ventes-rows'); if (!tbody) return;
  if (filtre.length===0) { tbody.innerHTML='<tr><td colspan="4" class="vide">Aucune vente enregistrée.</td></tr>'; return; }

  tbody.innerHTML = filtre.map((v) => {
    const num = historique.length - historique.indexOf(v);
    let det = v.articles&&v.articles.length>0 ? v.articles.map(a=>`${a.nom||'?'} ×${a.qte}`).join(', ') : '—';
    const dU = det.toUpperCase();
    let badge='💰 VENTE', coul='';
    if (dU.includes('PAIEMENT FOURNISSEUR')) { badge='💳 ACHAT FOURN.'; coul='background:#fff5f5;'; }
    else if (dU.includes('RETOUR CLIENT')) { badge='🔄 RETOUR'; coul='background:#e1f5fe;'; }
    else if (dU.includes('PERTE')||dU.includes('CASSE')) { badge='⚠️ PERTE'; coul='background:#fff3e0;'; }
    const total=parseInt(v.total)||0, benef=parseInt(v.benef)||0;
    return `<tr style="${coul}border-bottom:1px solid #eee;">
      <td style="padding:10px;font-size:13px;"><div style="font-weight:bold;">#${num} <span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:10px;font-size:11px;">${badge}</span></div><div style="margin-top:3px;color:#777;">⏱️ ${v.date}</div></td>
      <td style="padding:10px;font-size:13px;">${det}</td>
      <td style="padding:10px;font-weight:bold;color:${total<0?'#c62828':'#2e7d32'};">${formatPrix(Math.abs(total))}</td>
      <td style="padding:10px;font-weight:bold;color:${benef<0?'#c62828':'#2e7d32'};">${benef<0?'- ':'+  '}${formatPrix(Math.abs(benef))}</td>
    </tr>`;
  }).join('');
}

// ==================== GRAPHIQUE ====================
function dessinerGraphique() {
  const canvas = document.getElementById('graphique-ventes');
  if (!canvas||typeof Chart==='undefined') return;
  const labels=[], dCA=[], dB=[];
  for (let i=6;i>=0;i--) {
    const d=new Date(); d.setDate(d.getDate()-i);
    const ds=d.toLocaleDateString('fr-FR');
    labels.push(ds.slice(0,5));
    const vj=historique.filter(v=>v.date&&v.date.startsWith(ds));
    dCA.push(vj.filter(v=>!estSpecial(v)).reduce((s,v)=>s+Math.max(0,parseInt(v.total)||0),0));
    dB.push(vj.reduce((s,v)=>s+(parseInt(v.benef)||0),0));
  }
  if (graphiqueInstance) graphiqueInstance.destroy();
  graphiqueInstance = new Chart(canvas, {
    type:'bar', data:{ labels, datasets:[
      { label:'CA (FCFA)', data:dCA, backgroundColor:'rgba(46,125,50,0.7)', borderRadius:6 },
      { label:'Bénéfice (FCFA)', data:dB, backgroundColor:'rgba(2,136,209,0.6)', borderRadius:6 }
    ]},
    options:{ responsive:true, plugins:{ legend:{ position:'top' }}, scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>formatPrix(v) }}}}
  });
}

// ==================== EXPORT ====================
function exporterExcel() {
  if (historique.length===0) { toast('Aucune donnée','warning'); return; }
  let csv='Date & Heure;Articles;Total (FCFA);Bénéfice (FCFA)\n';
  historique.forEach(v=>{
    const det=(v.articles||[]).map(a=>`${a.nom} x${a.qte}`).join(' | ');
    csv+=`"${v.date}";"${det}";${parseInt(v.total)||0};${parseInt(v.benef)||0}\n`;
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`ventes_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  toast('📊 Export Excel téléchargé !');
}

// ==================== RÉINITIALISATIONS ====================
async function reinitialiserVentes() {
  if (!confirm("⚠️ SUPPRIMER TOUT L'HISTORIQUE DES VENTES ?\nAction irréversible.")) return;
  if (!confirm("🔴 DERNIÈRE CONFIRMATION — Continuer ?")) return;
  try {
    const { error:e1 }=await client.from('vente_articles').delete().gte('id',0);
    const { error:e2 }=await client.from('ventes').delete().gte('id',0);
    if (e1||e2) throw new Error((e1||e2).message);
    toast('✅ Historique des ventes supprimé'); panier={}; await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function reinitialiserFournisseur() {
  if (!confirm("⚠️ Vider tout l'historique fournisseur (livraisons + paiements) ?")) return;
  try {
    const { error:e1 }=await client.from('fournisseur_historique').delete().gte('id',0);
    if (e1) throw e1;
    toast('✅ Historique fournisseur vidé'); await chargerEspaceFournisseur();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

// ==================== FOURNISSEUR (livraisons + paiements) ====================
async function enregistrerLivraisonFournisseur() {
  const montantStr = document.getElementById('fourn-montant-livraison')?.value;
  const detail = document.getElementById('fourn-detail-livraison')?.value?.trim();
  const montant = parseInt(montantStr);
  if (!montant||montant<=0) { toast('❌ Montant invalide !','error'); return; }
  if (!detail) { toast('⚠️ Ajoute un détail de livraison !','warning'); return; }
  try {
    const { error } = await client.from('fournisseur_historique').insert([{
      type_action: 'LIVRAISON', montant, commentaire: detail, date: dateStr()
    }]);
    if (error) throw error;
    document.getElementById('fourn-montant-livraison').value='';
    document.getElementById('fourn-detail-livraison').value='';
    toast('📦 Livraison enregistrée !'); await chargerEspaceFournisseur();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function chargerEspaceFournisseur() {
  const { data: hist, error } = await client.from('fournisseur_historique').select('*').order('created_at', { ascending:false });
  if (error) { console.error(error); return; }

  const livraisons = (hist||[]).filter(h => h.type_action==='LIVRAISON');
  const paiements = (hist||[]).filter(h => h.type_action!=='LIVRAISON');

  const totalLivre = livraisons.reduce((s,h)=>s+h.montant,0);
  const totalPaye = paiements.reduce((s,h)=>s+h.montant,0);
  const resteDu = Math.max(0, totalLivre - totalPaye);

  const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.innerText=val; };
  set('fourn-total-livre', formatPrix(totalLivre));
  set('fournisseur-bilan-paye', formatPrix(totalPaye));
  set('fourn-reste-du', formatPrix(resteDu));

  // Livraisons
  const tbL = document.getElementById('fourn-livraisons-rows');
  if (tbL) {
    if (livraisons.length===0) { tbL.innerHTML='<tr><td colspan="3" class="vide">Aucune livraison enregistrée.</td></tr>'; }
    else tbL.innerHTML = livraisons.map(h=>`
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:10px;">${h.date||'-'}</td>
        <td style="padding:10px;color:#555;">${h.commentaire||'-'}</td>
        <td style="padding:10px;font-weight:bold;color:#2e7d32;">${formatPrix(h.montant)}</td>
      </tr>`).join('');
  }

  // Paiements
  const tbP = document.getElementById('fournisseur-historique-rows');
  if (tbP) {
    if (paiements.length===0) { tbP.innerHTML='<tr><td colspan="3" class="vide">Aucun paiement enregistré.</td></tr>'; }
    else tbP.innerHTML = paiements.map(h=>`
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:10px;">${h.date||'-'}</td>
        <td style="padding:10px;font-weight:bold;color:#0288d1;">${formatPrix(h.montant)}</td>
        <td style="padding:10px;color:#666;">${h.commentaire||'-'}</td>
      </tr>`).join('');
  }
}

async function ajouterFluxFournisseur(type) {
  const titre = type==='VERSEMENT'?"Montant VERSÉ au fournisseur (FCFA) :":"Valeur marchandise à crédit (FCFA) :";
  const ms = prompt(titre); if (!ms) return;
  const montant = parseInt(ms); if (isNaN(montant)||montant<=0) { alert("❌ Montant invalide !"); return; }
  const commentaire = prompt("Commentaire (Ex: Facture N°...) :");
  const { error } = await client.from('fournisseur_historique').insert([{ type_action:type, montant, commentaire:commentaire||'', date:dateStr() }]);
  if (error) { toast('❌ '+error.message,'error'); } else { toast('✅ Enregistré !'); await chargerEspaceFournisseur(); }
}

async function envoyerTotalVersHistoriqueFournisseur() {
  try {
    const { data:cfg } = await client.from('config').select('valeur').eq('cle','total_fournisseur').single();
    const montant = cfg?parseInt(cfg.valeur)||0:0;
    if (montant<=0) { toast('⚠️ Montant à 0 FCFA, rien à transférer.','warning'); return; }

    // Construire le récap détaillé
    let recapLignes = '';
    let recapTexte = '';
    if (commandeEnCours.length > 0) {
      recapLignes = commandeEnCours.map(c =>
        `<tr><td style="padding:7px 10px;">${c.designation}</td><td style="padding:7px 10px;">${c.type}</td><td style="padding:7px 10px;text-align:right;">${c.qte} btl</td><td style="padding:7px 10px;text-align:right;font-weight:bold;color:#2e7d32;">${formatPrix(c.cout)}</td></tr>`
      ).join('');
      recapTexte = commandeEnCours.map(c => `${c.designation} (${c.type}, ${c.qte} btl) : ${formatPrix(c.cout)}`).join(' | ');
    } else {
      recapLignes = `<tr><td colspan="4" style="padding:10px;color:#888;font-style:italic;">Commande sans détail enregistré</td></tr>`;
      recapTexte = 'Approvisionnement stock';
    }

    // Afficher la modal de confirmation
    const modal = document.getElementById('modal-confirm-vente');
    const contenu = document.getElementById('modal-recap-contenu');
    const titre = modal?.querySelector('.modal-title');
    const btnConfirmer = modal?.querySelector('.modal-btns .btn:last-child');

    if (titre) titre.innerHTML = '📦 Confirmer la livraison fournisseur';
    if (contenu) contenu.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">
        <thead><tr style="background:#e8f5e9;">
          <th style="padding:7px 10px;text-align:left;">Boisson</th>
          <th style="padding:7px 10px;text-align:left;">Format</th>
          <th style="padding:7px 10px;text-align:right;">Qté</th>
          <th style="padding:7px 10px;text-align:right;">Coût</th>
        </tr></thead>
        <tbody>${recapLignes}</tbody>
      </table>
      <div class="modal-recap-ligne" style="margin-top:4px;"><span>TOTAL LIVRAISON</span><span style="color:#2e7d32;">${formatPrix(montant)}</span></div>
    `;
    if (btnConfirmer) {
      btnConfirmer.innerText = '✅ Valider la livraison';
      btnConfirmer.onclick = async () => {
        fermerModalVente();
        const commentaire = prompt("Commentaire facultatif (Ex: Facture N°12, Fournisseur SIKAVI...) :") || recapTexte;
        try {
          const { error:eI } = await client.from('fournisseur_historique').insert([{
            type_action: 'LIVRAISON',
            montant,
            commentaire: commentaire || recapTexte,
            date: dateStr()
          }]);
          if (eI) throw eI;
          await client.from('config').upsert({ cle:'total_fournisseur', valeur:'0' });
          commandeEnCours = []; // Reset la commande en cours
          toast('✅ Livraison enregistrée dans l\'historique fournisseur !');
          await initialiserApplication();
          showSection('historique');
        } catch (err) { toast('❌ '+err.message,'error'); }
      };
    }
    // Rétablir le bouton Annuler
    const btnAnnuler = modal?.querySelector('.modal-btns .btn-danger');
    if (btnAnnuler) btnAnnuler.onclick = () => {
      fermerModalVente();
      // Rétablir le comportement normal du bouton confirmer pour la caisse
      if (btnConfirmer) { btnConfirmer.innerText = '✅ Encaisser'; btnConfirmer.onclick = confirmerVenteFinale; }
    };

    modal?.classList.add('visible');
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function modifierPrixTotalFournisseurStockage() {
  try {
    const { data:cfg } = await client.from('config').select('valeur').eq('cle','total_fournisseur').single();
    const actuel = cfg?parseInt(cfg.valeur)||0:0;
    const s = prompt("Modifier le montant total fournisseur (FCFA) :", actuel); if (s===null) return;
    const nv = parseInt(s); if (isNaN(nv)||nv<0) { alert("❌ Montant invalide."); return; }
    await client.from('config').upsert({ cle:'total_fournisseur', valeur:nv.toString() });
    const el=document.getElementById('total-fournisseur-stockage'); if(el) el.innerText=formatPrix(nv);
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function payerEtReinitialiserFournisseur() {
  try {
    const { data:cfg } = await client.from('config').select('valeur').eq('cle','total_fournisseur').single();
    const montant = cfg?parseInt(cfg.valeur)||0:0;
    if (montant===0) { alert("ℹ️ Montant fournisseur déjà à 0."); return; }
    if (!confirm(`Confirmer le paiement de ${formatPrix(montant)} ?`)) return;
    const { data:tr, error:eH } = await client.from('ventes').insert([{ total:montant, benefice:-montant, benef:-montant, articles:JSON.stringify([{designation:"📦 PAIEMENT FOURNISSEUR (Réinitialisation)",qte:1,prix:montant}]), date:dateStr() }]).select().single();
    if (eH) throw eH;
    await client.from('vente_articles').insert([{ vente_id:tr.id, boisson_designation:"📦 PAIEMENT FOURNISSEUR (Réinitialisation)", quantite:1, prix_unitaire:montant }]);
    await client.from('config').upsert({ cle:'total_fournisseur', valeur:"0" });
    toast(`✅ Paiement ${formatPrix(montant)} enregistré`); await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

// ==================== PDF & WHATSAPP ====================
function telechargerPDFVentes() {
  const table = document.getElementById('historique-ventes-rows')?.closest('table'); if (!table) return;

  // Calculer les stats
  const ventesSeules = historique.filter(v => !estSpecial(v));
  const pertesRetours = historique.filter(v => {
    const d=(v.articles||[]).map(a=>a.nom||'').join(' ').toUpperCase();
    return d.includes('RETOUR')||d.includes('PERTE')||d.includes('CASSE');
  });
  const totalCA = ventesSeules.reduce((s,v)=>s+(parseInt(v.total)||0),0);
  const totalBenef = historique.reduce((s,v)=>s+(parseInt(v.benef)||0),0);
  const totalPertes = pertesRetours.reduce((s,v)=>s+Math.abs(parseInt(v.benef)||0),0);

  const recapHTML = `
    <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">
      <div style="flex:1;min-width:130px;background:#e8f5e9;padding:14px;border-radius:8px;text-align:center;border-left:5px solid #2e7d32;">
        <div style="font-size:12px;color:#555;text-transform:uppercase;">Chiffre d'Affaires</div>
        <div style="font-size:20px;font-weight:bold;color:#2e7d32;">${formatPrix(totalCA)}</div>
      </div>
      <div style="flex:1;min-width:130px;background:#e3f2fd;padding:14px;border-radius:8px;text-align:center;border-left:5px solid #0288d1;">
        <div style="font-size:12px;color:#555;text-transform:uppercase;">Bénéfice Net</div>
        <div style="font-size:20px;font-weight:bold;color:${totalBenef<0?'#c62828':'#0288d1'};">${formatPrix(totalBenef)}</div>
      </div>
      <div style="flex:1;min-width:130px;background:#fff3e0;padding:14px;border-radius:8px;text-align:center;border-left:5px solid #ef6c00;">
        <div style="font-size:12px;color:#555;text-transform:uppercase;">Total Pertes & Retours</div>
        <div style="font-size:20px;font-weight:bold;color:#ef6c00;">${formatPrix(totalPertes)}</div>
      </div>
    </div>`;

  const html=`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;padding:20px;}table{width:100%;border-collapse:collapse;}th,td{padding:9px;border:1px solid #ccc;}th{background:#f0f0f0;}h2{color:#2e7d32;}</style></head><body>
    <h2>📊 Historique des Ventes — Consensus BarStock</h2>
    <p style="color:#888;">Généré le : ${new Date().toLocaleString('fr-FR')}</p>
    ${recapHTML}
    ${table.outerHTML}
  </body></html>`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download=`ventes_${new Date().toISOString().slice(0,10)}.html`; a.click();
  toast('⬇️ PDF ventes téléchargé');
}

function telechargerPDFFournisseur() {
  const tL=document.getElementById('fourn-livraisons-rows')?.closest('table');
  const tP=document.getElementById('fournisseur-historique-rows')?.closest('table');
  const totalL=document.getElementById('fourn-total-livre')?.innerText||'';
  const totalP=document.getElementById('fournisseur-bilan-paye')?.innerText||'';
  const resteDu=document.getElementById('fourn-reste-du')?.innerText||'';
  const html=`<html><head><meta charset="UTF-8"><style>body{font-family:Arial}table{width:100%;border-collapse:collapse;margin-bottom:20px}th,td{padding:8px;border:1px solid #ccc}th{background:#f0f0f0}h2{color:#2e7d32}h3{color:#0288d1}.bilan{display:flex;gap:20px;margin-bottom:20px}.bilan-item{padding:12px 20px;border-radius:8px;text-align:center}.b1{background:#e8f5e9;color:#1b5e20}.b2{background:#e3f2fd;color:#01579b}.b3{background:#fff3e0;color:#bf360c}</style></head><body><h2>🏪 Suivi Fournisseur</h2><p>Date : ${new Date().toLocaleString('fr-FR')}</p><div class="bilan"><div class="bilan-item b1"><div>Total Livré</div><strong>${totalL}</strong></div><div class="bilan-item b2"><div>Total Payé</div><strong>${totalP}</strong></div><div class="bilan-item b3"><div>Reste Dû</div><strong>${resteDu}</strong></div></div><h3>📦 Livraisons</h3>${tL?tL.outerHTML:''}<h3>💳 Paiements</h3>${tP?tP.outerHTML:''}</body></html>`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download=`fournisseur_${new Date().toISOString().slice(0,10)}.html`; a.click();
  toast('⬇️ PDF fournisseur téléchargé');
}

function envoyerWhatsAppVentes() {
  const rows=document.querySelectorAll('#historique-ventes-rows tr');
  let lignes='';
  rows.forEach(r=>{ const c=r.querySelectorAll('td'); if(c.length>=3) lignes+=`• ${c[0].innerText.replace(/\n/g,' ')} — ${c[2].innerText}\n`; });

  // Stats calculées directement
  const ventesSeules = historique.filter(v => !estSpecial(v));
  const pertesRetours = historique.filter(v => {
    const d=(v.articles||[]).map(a=>a.nom||'').join(' ').toUpperCase();
    return d.includes('RETOUR')||d.includes('PERTE')||d.includes('CASSE');
  });
  const totalCA = ventesSeules.reduce((s,v)=>s+(parseInt(v.total)||0),0);
  const totalBenef = historique.reduce((s,v)=>s+(parseInt(v.benef)||0),0);
  const totalPertes = pertesRetours.reduce((s,v)=>s+Math.abs(parseInt(v.benef)||0),0);

  const stats = `\n💰 CA Ventes : ${formatPrix(totalCA)}\n📈 Bénéfice Net : ${formatPrix(totalBenef)}\n⚠️ Pertes & Retours : ${formatPrix(totalPertes)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent('*RÉCAPITULATIF VENTES CAISSE*\n\n'+lignes+stats+'\n\nDate : '+new Date().toLocaleDateString('fr-FR'))}`, '_blank');
}

function envoyerWhatsAppFournisseur() {
  const tL=document.getElementById('fourn-total-livre')?.innerText||'';
  const tP=document.getElementById('fournisseur-bilan-paye')?.innerText||'';
  const rD=document.getElementById('fourn-reste-du')?.innerText||'';
  const rowsL=document.querySelectorAll('#fourn-livraisons-rows tr');
  const rowsP=document.querySelectorAll('#fournisseur-historique-rows tr');
  let livs='', paies='';
  rowsL.forEach(r=>{ const c=r.querySelectorAll('td'); if(c.length>=2) livs+=`• ${c[0].innerText} — ${c[2].innerText}\n`; });
  rowsP.forEach(r=>{ const c=r.querySelectorAll('td'); if(c.length>=2) paies+=`• ${c[0].innerText} — ${c[1].innerText}\n`; });
  const msg=`*SUIVI FOURNISSEUR*\n\n📦 Livraisons :\n${livs}\n💳 Paiements :\n${paies}\n\n✅ Total Livré : ${tL}\n💳 Total Payé : ${tP}\n⚠️ Reste Dû : ${rD}\n\nDate : ${new Date().toLocaleDateString('fr-FR')}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

// ==================== DÉMARRAGE ====================
document.addEventListener("DOMContentLoaded", () => {
  appliquerDarkMode();
  gererConnexion();
  const sCat=document.getElementById('search-catalogue'); if(sCat) sCat.addEventListener('input',afficherCatalogue);
  const sVen=document.getElementById('search-ventes'); if(sVen) sVen.addEventListener('input',afficherVentes);
  initialiserApplication();
});

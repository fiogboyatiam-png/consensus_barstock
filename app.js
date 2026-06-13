

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
let commandeEnCours = []; // [{ designation, type, qte, cout }]
let barActuel = null; // { id, nom, code_pin }
let commandeActive = null; // commande en cours d'edition
let commandesOuvertes = []; // liste des commandes chargees
let realtimeActif = false;
let utilisateurActuel = null;

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
function rafraichirIcones() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
function dateStr() {
  const n = new Date();
  return n.toLocaleDateString('fr-FR') + " à " + n.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}
function escape(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str || ''));
  return div.innerHTML;
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

// ==================== AUTHENTIFICATION MULTI-BAR ====================

function afficherEcranAuth() {
  document.getElementById('ecran-auth').style.display = 'flex';
  document.getElementById('app-principale').style.display = 'none';
  afficherOngletAuth('connexion');
}

function afficherOngletAuth(onglet) {
  const tabs = ['connexion', 'inscription'];
  tabs.forEach(t => {
    const btn = document.getElementById('tab-' + t);
    const panel = document.getElementById('panel-' + t);
    if (btn) btn.classList.toggle('tab-active', t === onglet);
    if (panel) panel.style.display = t === onglet ? 'block' : 'none';
  });
  const erreur = document.getElementById('auth-erreur');
  if (erreur) erreur.style.display = 'none';
}

function afficherErreurAuth(msg) {
  const el = document.getElementById('auth-erreur');
  if (el) { el.innerText = msg; el.style.display = 'block'; }
}

function toggleVoirPin(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

async function chargerBarUtilisateur(userId) {
  const { data: bars, error } = await client
    .from('bars')
    .select('id, nom, owner_id')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw error;
  return bars && bars.length ? bars[0] : null;
}

// CONNEXION
async function seConnecter() {
  const email = (document.getElementById('conn-email')?.value || '').trim();
  const password = (document.getElementById('conn-password')?.value || '').trim();

  if (!email) { afficherErreurAuth("L'email est obligatoire."); return; }
  if (!password) { afficherErreurAuth('Le mot de passe est obligatoire.'); return; }

  const btnConn = document.getElementById('btn-connexion');
  if (btnConn) { btnConn.disabled = true; btnConn.innerText = 'Connexion...'; }

  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const bar = await chargerBarUtilisateur(data.user.id);
    if (!bar) {
      await client.auth.signOut();
      afficherErreurAuth("Aucun bar n'est lie a ce compte.");
      return;
    }

    barActuel = bar;
    localStorage.setItem('barstock_bar_id', barActuel.id);
    localStorage.setItem('barstock_bar_nom', barActuel.nom);
    lancerApplication();
  } catch (err) {
    afficherErreurAuth('Erreur : ' + err.message);
  } finally {
    if (btnConn) { btnConn.disabled = false; btnConn.innerText = 'Se connecter'; }
  }
}

// INSCRIPTION
async function inscrireBar() {
  const nom = (document.getElementById('ins-nom')?.value || '').trim();
  const email = (document.getElementById('ins-email')?.value || '').trim();
  const password = (document.getElementById('ins-password')?.value || '').trim();
  const confirm = (document.getElementById('ins-password-confirm')?.value || '').trim();

  if (!nom) { afficherErreurAuth('Le nom du bar est obligatoire.'); return; }
  if (!email) { afficherErreurAuth("L'email est obligatoire."); return; }
  if (!password || password.length < 6) { afficherErreurAuth('Le mot de passe doit avoir au moins 6 caracteres.'); return; }
  if (password !== confirm) { afficherErreurAuth('Les mots de passe ne correspondent pas.'); return; }

  const btnIns = document.getElementById('btn-inscription');
  if (btnIns) { btnIns.disabled = true; btnIns.innerText = 'Creation...'; }

  try {
    const { data: authData, error: authError } = await client.auth.signUp({ email, password });
    if (authError) throw authError;
    if (!authData.user) throw new Error("Erreur lors de la creation du compte.");

    const { data: existants, error: existError } = await client
      .from('bars')
      .select('id')
      .eq('nom', nom);
    if (existError) throw existError;
    if (existants && existants.length > 0) {
      afficherErreurAuth('Un bar avec ce nom existe deja.');
      return;
    }

    const { data: nouveauBar, error: barError } = await client
      .from('bars')
      .insert([{ nom, owner_id: authData.user.id }])
      .select()
      .single();
    if (barError) throw barError;

    barActuel = nouveauBar;
    localStorage.setItem('barstock_bar_id', barActuel.id);
    localStorage.setItem('barstock_bar_nom', barActuel.nom);

    const { data: modeles, error: modelesError } = await client.from('boissons_modele').select('*');
    if (modelesError) throw modelesError;

    if (modeles && modeles.length > 0) {
      const copie = modeles.map(b => ({
        designation: b.designation,
        categorie: b.categorie,
        type_bouteille: b.type_bouteille,
        pu_initial: b.pu_initial,
        prix_unitaire: b.prix_unitaire,
        demi_cassier: b.demi_cassier || 0,
        quart_cassier: b.quart_cassier || 0,
        quantite_par_cassier: b.quantite_par_cassier,
        seuil: b.seuil || 6,
        stock: 0,
        bar_id: nouveauBar.id
      }));
      const { error: copieError } = await client.from('boissons').insert(copie);
      if (copieError) throw copieError;
    }

    const { error: configError } = await client
      .from('config')
      .insert([{ bar_id: nouveauBar.id, cle: 'total_fournisseur', valeur: '0' }]);
    if (configError) throw configError;

    toast('Bienvenue ' + nom + ' ! Votre compte est cree.');
    lancerApplication();
  } catch (err) {
    afficherErreurAuth('Erreur : ' + err.message);
  } finally {
    if (btnIns) { btnIns.disabled = false; btnIns.innerText = 'Creer mon compte'; }
  }
}

async function restaurerSession() {
  
  
  try {
     const exp = parseInt(localStorage.getItem('barstock_expiration') || '0');
    if (exp && Date.now() > exp) {
      await client.auth.signOut();
      localStorage.removeItem('barstock_expiration');
      afficherEcranAuth(); return;
    }
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;

    const session = sessionData.session;
    if (!session) { afficherEcranAuth(); return; }

    const bar = await chargerBarUtilisateur(session.user.id);
    if (!bar) { afficherEcranAuth(); return; }

    barActuel = bar;
    localStorage.setItem('barstock_bar_id', barActuel.id);
    localStorage.setItem('barstock_bar_nom', barActuel.nom);
    lancerApplication();
  } catch {
    afficherEcranAuth();
  }
}

function lancerApplication() {
  const expiration = Date.now() + (8 * 60 * 60 * 1000);
  localStorage.setItem('barstock_expiration', expiration.toString());
  afficherEcranRole(); // ← passe par le choix de rôle
}
async function seDeconnecter() {
  if (!confirm(`Deconnecter ${barActuel?.nom} ?`)) return;
  await client.auth.signOut();
  barActuel = null;
  localStorage.removeItem('barstock_bar_id');
  localStorage.removeItem('barstock_bar_nom');
  localStorage.removeItem('barstock_expiration');
  boissons = []; panier = {}; historique = [];
  client.removeAllChannels();
realtimeActif = false;
  afficherEcranAuth();
}



// ==================== INIT ====================
async function initialiserApplication() {
  if (!barActuel) return;
  try {
    const { data: db, error: eB } = await client
  .from('boissons').select('*')
  .eq('bar_id', barActuel.id)
  .eq('supprime', false)   // ← exclure les supprimées
  .order('designation', { ascending: true });
    if (eB) throw eB;
    boissons = db || [];

    const { data: dv, error: eV } = await client
      .from('ventes')
      // APRÈS
.select('id, total, benefice, benef, note, date, created_at, vente_articles(boisson_designation, quantite, prix_unitaire)')
.eq('bar_id', barActuel.id)
.order('created_at', { ascending: false })
.limit(200)
    if (eV) throw eV;

    historique = (dv || []).map(v => {
      // Toujours utiliser created_at (timestamp serveur fiable)
      let dateAff = v.created_at
        ? new Date(v.created_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : (v.date || 'Date inconnue');
      const gain = v.benefice != null ? v.benefice : (v.benef || 0);
      let arts = (v.vente_articles || []).map(a => ({ nom: a.boisson_designation, qte: a.quantite }));
      if (arts.length === 0 && v.articles) {
        try {
          const a = typeof v.articles === 'string' ? JSON.parse(v.articles) : v.articles;
          if (Array.isArray(a)) arts = a.map(x => ({ nom: x.designation || x.nom, qte: x.qte || x.quantite }));
        } catch { arts = [{ nom: "📦 PAIEMENT FOURNISSEUR", qte: 1 }]; }
      }
      return { id: v.id, date: dateAff || 'Date inconnue', total: v.total, benef: gain, note: v.note || '',articles: arts };
    });

    mettreAJourStatsDuJour();
    rafrachirVueActive();
    await chargerCommandes();    
    
  } catch(err) {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    console.error(err); // seulement en dev
  }
  toast('❌ Une erreur est survenue.', 'error');
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
  if (id === 'catalogue') {
    afficherCatalogue(); statsCatalogue();
    if (utilisateurActuel?.role === 'gerant') chargerListeServeuses();
  }
  else if (id === 'etat-stock') {
    afficherEtatProduits();
    if (utilisateurActuel?.role === 'gerant') chargerListeServeuses();
  }
  else if (id === 'stockage-recup') afficherStockage();
 else if (id === 'ventes') { 
  setTimeout(() => { afficherVentes(); mettreAJourTicket(); afficherDerniereVente(); }, 50);
}
  else if (id === 'commandes') chargerCommandes();
  else if (id === 'rapport-serveuses') chargerRapportServeuses();
  else if (id === 'historique') { afficherHistorique(); chargerEspaceFournisseur(); dessinerGraphique(); }
}
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const sec = document.getElementById(id); if (sec) sec.classList.add('active');
  const btn = document.querySelector(`[data-section="${id}"]`); if (btn) btn.classList.add('active');
  if (id === 'corbeille') chargerCorbeille();
  else if (id === 'commandes') chargerCommandes();
  else if (id === 'rapport-serveuses') chargerRapportServeuses();
  else if (id === 'historique') { afficherHistorique(); chargerEspaceFournisseur(); dessinerGraphique(); }
  else rafrachirVueActive();
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
  rafraichirIcones();
}

async function modifierStock(id) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  const s = prompt(`Stock de ${b.designation}\nActuel : ${b.stock}`, b.stock); if (s===null) return;
  const n = parseInt(s); if (isNaN(n)||n<0) { alert("❌ Nombre valide requis"); return; }
  try { const { error } = await client.from('boissons').update({ stock: n }).eq('id', id).eq('bar_id', barActuel.id);if (error) throw error; toast(`✅ Stock ${b.designation} → ${n}`); await initialiserApplication(); }
  catch (err) { toast('❌ '+err.message,'error'); }
}

async function modifierSeuil(id) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  const s = prompt(`Seuil d'alerte pour ${b.designation}\nActuel : ${b.seuil||6}`, b.seuil||6); if (s===null) return;
  const n = parseInt(s); if (isNaN(n)||n<1) { alert("❌ Seuil invalide"); return; }
  try { const { error } = await client.from('boissons').update({ seuil: n }).eq('id', id).eq('bar_id', barActuel.id); if (error) throw error; toast(`✅ Seuil ${b.designation} → ${n}`); await initialiserApplication(); }
  catch (err) { toast('❌ '+err.message,'error'); }
}

async function ajouterBoisson(e) {
  if (e) e.preventDefault();
  if (!barActuel) return;
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
    const { error } = await client.from('boissons').insert([{
      designation:nom, categorie, type_bouteille:type,
      pu_initial:puInit, prix_unitaire:pUnit, demi_cassier:demi,
      quart_cassier:quart, quantite_par_cassier:qteCassier,
      stock, seuil, bar_id: barActuel.id
    }]);
    if (error) throw error;
    document.getElementById('form-ajouter-boisson').reset();
    toast('✅ '+nom+' ajouté !'); await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function modifierPrixUnitaire(id) {
  const b = boissons.find(i => i.id === id);
  if (!b) return;
  const rep = prompt(`Prix vente unitaire de ${b.designation} (Actuel : ${b.prix_unitaire} FCFA) :`, b.prix_unitaire);
  if (rep === null) return;
  const nouveau = parseInt(rep);
  if (isNaN(nouveau) || nouveau < 0) { toast('❌ Prix invalide', 'error'); return; }
  try {
    const { error } = await client.from('boissons').update({ prix_unitaire: nouveau }).eq('id', id).eq('bar_id', barActuel.id);
    if (error) throw error;
    toast('✅ Prix mis à jour');
    await initialiserApplication();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

async function supprimerBoisson(id) {
  if (!confirm("Mettre cette boisson à la corbeille ?")) return;
  try {
    const { error } = await client.from('boissons')
      .update({ supprime: true, supprime_le: dateStr() })
      .eq('id', id).eq('bar_id', barActuel.id);
    if (error) throw error;
    toast('🗑️ Boisson mise à la corbeille');
    await initialiserApplication();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

async function chargerCorbeille() {
  const { data, error } = await client.from('boissons')
    .select('*')
    .eq('bar_id', barActuel.id)
    .eq('supprime', true)
    .order('supprime_le', { ascending: false });
  if (error) { toast('❌ ' + error.message, 'error'); return; }

  const tbody = document.getElementById('corbeille-rows');
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="vide">🗑️ Corbeille vide</td></tr>';
    
    return;
    
  }

  tbody.innerHTML = data.map(b => `
    <tr>
      <td><strong>${escape(b.designation)}</strong></td>
      <td><span class="tag-type">${b.type_bouteille === 'petit bouteille' ? 'Petit' : 'Grand'}</span></td>
      <td>${escape(b.categorie || '-')}</td>
      <td style="color:#888;font-size:13px;">🕐 ${escape(b.supprime_le || '-')}</td>
      <td>
        <button class="btn btn-sm" onclick="restaurerBoisson(${b.id})" title="Restaurer">♻️ Restaurer</button>
        <button class="btn btn-danger btn-sm" onclick="supprimerDefinitivement(${b.id})" title="Supprimer définitivement">🗑️ Supprimer</button>
      </td>
    </tr>`).join('');
    
}

async function restaurerBoisson(id) {
  if (!confirm("Restaurer cette boisson dans le catalogue ?")) return;
  try {
    const { error } = await client.from('boissons')
      .update({ supprime: false, supprime_le: null })
      .eq('id', id).eq('bar_id', barActuel.id);
    if (error) throw error;
    toast('♻️ Boisson restaurée !', 'info');
    await initialiserApplication();
    chargerCorbeille();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

async function supprimerDefinitivement(id) {
  if (!confirm("⚠️ Supprimer définitivement ? Cette action est IRRÉVERSIBLE.")) return;
  if (!confirm("🔴 Dernière confirmation — continuer ?")) return;
  try {
    const { error } = await client.from('boissons')
      .delete().eq('id', id).eq('bar_id', barActuel.id);
    if (error) throw error;
    toast('🗑️ Boisson supprimée définitivement', 'warning');
    chargerCorbeille();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

async function viderCorbeille() {
  if (!confirm("⚠️ Vider toute la corbeille définitivement ?")) return;
  try {
    const { error } = await client.from('boissons')
      .delete().eq('bar_id', barActuel.id).eq('supprime', true);
    if (error) throw error;
    toast('🗑️ Corbeille vidée', 'warning');
    chargerCorbeille();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}
function activerRealtime() {
  if (realtimeActif) return; 
  realtimeActif = true;
  // Écoute les changements de stock
  client.channel('stock-live')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'boissons',
      filter: `bar_id=eq.${barActuel.id}`
    }, payload => {
      // Met à jour la boisson localement sans recharger toute la page
      const index = boissons.findIndex(b => b.id === payload.new.id);
      if (payload.eventType === 'UPDATE' && index !== -1) {
        boissons[index] = { ...boissons[index], ...payload.new };
        rafrachirVueActive();
      }
    })
    .subscribe();

  // Écoute les nouvelles commandes et modifications
  client.channel('commandes-live')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'commandes',
      filter: `bar_id=eq.${barActuel.id}`
    }, payload => {
      chargerCommandes(); // recharge la liste des tables
    })
    .subscribe();

  // Écoute les nouvelles ventes (pour l'historique et les stats)
  client.channel('ventes-live')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'ventes',
      filter: `bar_id=eq.${barActuel.id}`
    }, payload => {
      // Recharge l'historique si la section est active
      if (document.getElementById('historique')?.classList.contains('active')) {
        afficherHistorique();
      }
      // Met à jour les stats du jour dans le header
      mettreAJourStatsDuJour();
    })
    .subscribe();
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
    if (b.stock===0) { rs='class="row-rupture;"'; st='<span class="tag tag-rouge">🔴 RUPTURE</span>'; }
    else if (b.stock<=seuil) { rs='class="row-alerte;"'; st='<span class="tag tag-orange">🟠 STOCK BAS</span>'; }
    else { rs='class="row-ok;"'; st='<span class="tag tag-vert">🟢 OK</span>'; }
    return `<tr ${rs}><td><strong>${b.designation}</strong></td><td><span class="tag-type">${b.type_bouteille}</span></td><td>${b.categorie||'-'}</td><td><strong>${b.stock}</strong></td><td>${seuil} btl</td><td>${st}</td><td><button class="btn btn-sm" onclick="modifierStock(${b.id})">📦 Stock</button> <button class="btn btn-sm btn-warning" onclick="modifierSeuil(${b.id})">⚙️ Seuil</button></td></tr>`;
  }).join('');
  rafraichirIcones();
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
    // ✅ APRÈS — avec bar_id
client.from('config').select('valeur')
  .eq('cle','total_fournisseur')
  .eq('bar_id', barActuel.id)
  .single()
  .then(({data})=>{if(data&&tfEl)tfEl.innerText=formatPrix(parseInt(data.valeur)||0);});
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
    return `<tr style="border-bottom:1px solid #f5f5f5;"><td style="padding:14px 10px;font-weight:bold;">${escape(b.designation)}</td><td style="padding:14px 10px;"><span class="tag-type">${lbl}</span></td><td style="padding:14px 10px;text-align:center;"><span style="display:inline-block;padding:6px 12px;border:1px solid #e0e0e0;border-radius:20px;font-weight:bold;">${b.stock}</span></td><td style="padding:14px 10px;font-size:13px;">${cp}</td><td style="padding:14px 10px;">${ca}</td></tr>`;
    rafraichirIcones();
  };

  let html='';
  if (grands.length>0) html+=`<tr style="background:#f8fafc;font-weight:bold;"><td colspan="5" style="padding:12px;border-left:4px solid #475569;">👑 GRANDS MODÈLES</td></tr>`+grands.map(gen).join('');
  if (petits.length>0) html+=`<tr style="background:#f0f9ff;font-weight:bold;"><td colspan="5" style="padding:12px;border-left:4px solid #0288d1;">🧪 PETITS MODÈLES</td></tr>`+petits.map(gen).join('');
  tbody.innerHTML=html;
  rafraichirIcones();
}

async function entreeStock(id, type) {
  const b=boissons.find(i=>i.id===id); if (!b) return;
  const qpc=b.quantite_par_cassier||(b.type_bouteille==="petit bouteille"?24:12);
  let qte=0, cout=0, txt='';
  if (type==='cassier') { qte=qpc; cout=b.pu_initial; txt="1 cassier entier"; }
  else if (type==='demi') { qte=Math.round(qpc/2); cout=b.demi_cassier||Math.round(b.pu_initial/2); txt="un demi-cassier"; }
  else if (type==='quart') { qte=Math.round(qpc/4); cout=b.quart_cassier||Math.round(b.pu_initial/4); txt="un quart-cassier"; }
  if (!confirm(`Ajouter ${txt} (${qte} btl) pour ${b.designation} ?`)) return;
  try {
    const { error:eS } = await client.from('boissons')
      .update({ stock:b.stock+qte })
      .eq('id', id).eq('bar_id', barActuel.id); // ← bar_id ajouté
    if (eS) throw eS;

    // Lire le total actuel pour CE bar uniquement
    const { data:cfg } = await client.from('config')
      .select('valeur')
      .eq('cle','total_fournisseur')
      .eq('bar_id', barActuel.id) // ← bar_id ajouté
      .single();
    const nv=(cfg?parseInt(cfg.valeur)||0:0)+cout;

    // Mettre à jour pour CE bar uniquement
    await client.from('config')
      .update({ valeur:nv.toString() })
      .eq('cle','total_fournisseur')
      .eq('bar_id', barActuel.id); // ← update au lieu de upsert

    const existing=commandeEnCours.find(c=>c.designation===b.designation&&c.type===txt);
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
    const note = '';
   const { data: tr, error: eH } = await client.from('ventes').insert([{bar_id: barActuel.id, total:tImpact, benefice:bImpact, benef:bImpact, note}]).select().single(); if (eH) throw eH;
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
  const detail = document.getElementById('ticket-detail');
  const wrapper = document.getElementById('btn-envoyer-table-wrapper');
  if (!detail) return;
  if (Object.keys(panier).length === 0) {
    detail.innerHTML = '<li style="color:#aaa;padding:10px 0;text-align:center;">Panier vide</li>';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    set('total-montant', formatPrix(0)); set('recap-bbc', formatPrix(0)); set('recap-benef', formatPrix(0));
    if (wrapper) wrapper.style.display = 'none';
    return;
  }
  let tv = 0, ta = 0, html = '<ul style="list-style:none;padding:0;margin:0;">';
  for (const id in panier) {
    const b = boissons.find(i => i.id == id); if (!b) continue;
    const qte = panier[id], sous = b.prix_unitaire * qte; tv += sous;
    const qpc = b.quantite_par_cassier || (b.type_bouteille === "petit bouteille" ? 24 : 12);
    ta += (b.pu_initial > 0 ? Math.round(b.pu_initial / qpc) : 0) * qte;
    html += `<li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #ddd;font-size:14px;"><span><strong>${b.designation}</strong> × ${qte}</span><span>${formatPrix(sous)}</span></li>`;
  }
  html += '</ul>';
  detail.innerHTML = html;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  set('total-montant', formatPrix(tv)); set('recap-bbc', formatPrix(ta)); set('recap-benef', formatPrix(tv - ta));
  if (wrapper) wrapper.style.display = (Object.keys(panier).length > 0 && commandesOuvertes.length > 0) ? 'block' : 'none';
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
  const noteEl = document.getElementById('note-vente');
  if (noteEl) noteEl.value = '';
  document.getElementById('modal-confirm-vente').classList.add('visible');
  setTimeout(() => noteEl?.focus(), 150);
}

function fermerModalVente() { document.getElementById('modal-confirm-vente').classList.remove('visible'); }

async function confirmerVenteFinale() {
  for (const id in panier) {
    const b = boissons.find(i => i.id==id); if (!b) continue;
    if (panier[id]>b.stock) { fermerModalVente(); toast(`❌ Stock insuffisant pour ${b.designation} !`,'error'); await initialiserApplication(); return; }
  }
  const note = (document.getElementById('note-vente')?.value || '').trim();
  fermerModalVente();
  await validerVente(note);
}


async function validerVente(note = '') {
  if (Object.keys(panier).length===0) return;
  // Vérification stock en temps réel avant encaissement
  const ids = Object.keys(panier).map(Number);
  const { data: stockFrais } = await client.from('boissons')
    .select('id, stock, designation')
    .in('id', ids)
    .eq('bar_id', barActuel.id);

  for (const b of stockFrais || []) {
    const qte = panier[b.id];
    if (qte > b.stock) {
      toast(`❌ Stock insuffisant pour ${b.designation} (reste ${b.stock})`, 'error');
      await initialiserApplication(); // recharge les vrais stocks
      return;
    }
  }
  let tv=0, tb=0; const arts=[];
  for (const id in panier) {
    const qte=panier[id], b=boissons.find(i=>i.id==id); if (!b) continue;
    const qpc=b.quantite_par_cassier||(b.type_bouteille==="petit bouteille"?24:12);
    const aU=b.pu_initial>0?Math.round(b.pu_initial/qpc):0;
    tv+=b.prix_unitaire*qte; tb+=(b.prix_unitaire-aU)*qte;
    arts.push({ id:b.id, designation:b.designation, quantite:qte, prix_unitaire:b.prix_unitaire, stockActuel:b.stock });
  }
  try {
    const { data: tr, error } = await client.from('ventes')
  .insert([{
    total:tv, benefice:tb, benef:tb, bar_id:barActuel.id,
    note: note || null,
    serveuse: utilisateurActuel?.nom || null
  }])
      .select().single();
    if (error) throw error;
    for (const art of arts) {
      const { error:eA } = await client.from('vente_articles').insert([{
        vente_id:tr.id, boisson_designation:art.designation,
        quantite:art.quantite, prix_unitaire:art.prix_unitaire,
        bar_id:barActuel.id
      }]);
      if (eA) throw eA;
      const { error:eS } = await client.from('boissons')
        .update({ stock:art.stockActuel-art.quantite })
        .eq('id', art.id).eq('bar_id', barActuel.id);
      if (eS) throw eS;
    }
    const noteEl = document.getElementById('note-vente');
    if (noteEl) noteEl.value = '';
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
      if (b) await client.from('boissons').update({ stock:b.stock+art.qte }).eq('id',b.id).eq('bar_id', barActuel.id);
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
      <td style="padding:10px;font-size:13px;">${escape(det)}</td>
      <td style="padding:10px;font-weight:bold;">${formatPrix(Math.abs(total))}</td>
      <td style="padding:10px;font-weight:bold;color:${total<0?'#c62828':'#2e7d32'};">${formatPrix(Math.abs(total))}</td>
      <td style="padding:10px;font-weight:bold;color:${benef<0?'#c62828':'#2e7d32'};">${benef<0?'− ':'+&nbsp;'}${formatPrix(Math.abs(benef))}</td>
      <td style="padding:10px;font-size:13px;color:#0288d1;font-style:italic;">${v.note ? '📝 '+escape(v.note) : '<span style="color:#ccc;">—</span>'}</td>
    </tr>`;
  }).join('');
  rafraichirIcones();
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
    const { error:e1 }=await client.from('vente_articles').delete().eq('bar_id', barActuel.id);
    const { error:e2 }=await client.from('ventes').delete().eq('bar_id', barActuel.id);
    if (e1||e2) throw new Error((e1||e2).message);
    toast('✅ Historique des ventes supprimé'); panier={}; await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function reinitialiserFournisseur() {
  if (!confirm("⚠️ Vider tout l'historique fournisseur (livraisons + paiements) ?")) return;
  try {
    const { error:e1 }=await client.from('fournisseur_historique').delete().eq('bar_id', barActuel.id);
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
    // Livraison + paiement immédiat du même montant
    const { error } = await client.from('fournisseur_historique').insert([
      { bar_id: barActuel.id, type_action: 'LIVRAISON', montant, commentaire: detail },
{ bar_id: barActuel.id, type_action: 'PAIEMENT',  montant, commentaire: 'Payé à la livraison — '+detail }
    ]);
    if (error) throw error;
    document.getElementById('fourn-montant-livraison').value='';
    document.getElementById('fourn-detail-livraison').value='';
    toast('✅ Livraison enregistrée et payée !'); await chargerEspaceFournisseur();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function chargerEspaceFournisseur() {
  const { data: hist, error } = await client
    .from('fournisseur_historique')
    .select('*')
    .eq('bar_id', barActuel.id)
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }

  const livraisons = (hist||[]).filter(h => h.type_action === 'LIVRAISON');

  const totalLivre = livraisons.reduce((s,h) => s + h.montant, 0);
  const totalPaye  = totalLivre; // ← toujours égal au livré

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  set('fourn-total-livre',      formatPrix(totalLivre));
  set('fournisseur-bilan-paye', formatPrix(totalPaye));

  const tbL = document.getElementById('fourn-livraisons-rows');
  if (tbL) {
    if (livraisons.length === 0) {
      tbL.innerHTML = '<tr><td colspan="3" class="vide">Aucune livraison enregistrée.</td></tr>';
    } else {
      tbL.innerHTML = livraisons.map(h => `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:10px;">${h.created_at ? new Date(h.created_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '-'}</td>
          <td style="padding:10px;color:#555;">${h.commentaire||'-'}</td>
          <td style="padding:10px;font-weight:bold;color:#2e7d32;">${formatPrix(h.montant)}</td>
        </tr>`).join('');
    }
  }
}

async function ajouterFluxFournisseur(type) {
  const titre = type==='VERSEMENT'?"Montant VERSÉ au fournisseur (FCFA) :":"Valeur marchandise à crédit (FCFA) :";
  const ms = prompt(titre); if (!ms) return;
  const montant = parseInt(ms); if (isNaN(montant)||montant<=0) { alert("❌ Montant invalide !"); return; }
  const commentaire = prompt("Commentaire (Ex: Facture N°...) :");
  const { error } = await client.from('fournisseur_historique').insert([{ bar_id: barActuel.id, type_action:type, montant, commentaire:commentaire||'' }]);
  if (error) { toast('❌ '+error.message,'error'); } else { toast('✅ Enregistré !'); await chargerEspaceFournisseur(); }
}

async function envoyerTotalVersHistoriqueFournisseur() {
  try {
    const { data:cfg } = await client.from('config')
  .select('valeur')
  .eq('cle','total_fournisseur')
  .eq('bar_id', barActuel.id)
  .single();
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
  // ← Supprimer le prompt(), utiliser recapTexte directement
  const commentaire = recapTexte || 'Approvisionnement stock';
  try {
    const { error:eI } = await client.from('fournisseur_historique').insert([{
     type_action: 'LIVRAISON',
      montant,
      commentaire,
      bar_id: barActuel.id
    }]);
    if (eI) throw eI;
    await client.from('config')
      .update({ valeur:'0' })
      .eq('cle','total_fournisseur')
      .eq('bar_id', barActuel.id);
    commandeEnCours = [];
    toast('✅ Livraison enregistrée !');
    await initialiserApplication();
    showSection('historique');
  } catch(err) {
    console.error('Erreur:', err);
    toast('❌ '+err.message,'error');
  }
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
    const { data:cfg } = await client.from('config')
      .select('valeur')
      .eq('cle','total_fournisseur')
      .eq('bar_id', barActuel.id)
      .single();
    const actuel = cfg ? parseInt(cfg.valeur)||0 : 0;

    // Utiliser le modal au lieu de prompt()
    const modal = document.getElementById('modal-confirm-vente');
    const contenu = document.getElementById('modal-recap-contenu');
    const titre = modal?.querySelector('.modal-title');
    const btnConf = modal?.querySelector('.modal-btns .btn:last-child');
    const btnAnn = modal?.querySelector('.modal-btns .btn-danger');

    if (titre) titre.innerHTML = '✏️ Modifier le montant fournisseur';
    if (contenu) contenu.innerHTML = `
      <div style="margin-bottom:12px;font-size:14px;color:#555;">
        Montant actuel : <strong>${formatPrix(actuel)}</strong>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <label style="font-size:13px;font-weight:600;">Nouveau montant (FCFA)</label>
        <input type="number" id="input-nouveau-montant" value="${actuel}" min="0"
          style="padding:10px;border:2px solid #ddd;border-radius:8px;font-size:16px;width:100%;">
      </div>`;

    if (btnAnn) { btnAnn.style.display=''; btnAnn.innerText='✖ Annuler'; btnAnn.onclick = () => { fermerModalVente(); if(btnConf){btnConf.innerText='✅ Encaisser';btnConf.onclick=confirmerVenteFinale;} }; }
    if (btnConf) {
      btnConf.innerText = '💾 Enregistrer';
      btnConf.onclick = async () => {
        const nv = parseInt(document.getElementById('input-nouveau-montant').value);
        if (isNaN(nv) || nv < 0) { toast('❌ Montant invalide.','error'); return; }
        fermerModalVente();
        await client.from('config')
          .update({ valeur: nv.toString() })
          .eq('cle','total_fournisseur')
          .eq('bar_id', barActuel.id);
        const el = document.getElementById('total-fournisseur-stockage');
        if (el) el.innerText = formatPrix(nv);
        toast('✅ Montant mis à jour');
        if(btnConf){btnConf.innerText='✅ Encaisser';btnConf.onclick=confirmerVenteFinale;}
      };
    }
    modal?.classList.add('visible');
    // Focus sur l'input
    setTimeout(() => document.getElementById('input-nouveau-montant')?.focus(), 100);
  } catch(err) { toast('❌ '+err.message,'error'); }
}

async function payerEtReinitialiserFournisseur() {
  try {
    const { data:cfg } = await client.from('config')
      .select('valeur').eq('cle','total_fournisseur').eq('bar_id', barActuel.id).single();
    const montant = cfg ? parseInt(cfg.valeur)||0 : 0;
    if (montant===0) { alert("ℹ️ Montant fournisseur déjà à 0."); return; }
    if (!confirm(`Confirmer le paiement de ${formatPrix(montant)} ?`)) return;
    const { data:tr, error:eH } = await client.from('ventes').insert([{
      bar_id: barActuel.id, total:montant, benefice:-montant, benef:-montant,
      
    }]).select().single();
    if (eH) throw eH;
    await client.from('vente_articles').insert([{
      vente_id:tr.id, bar_id: barActuel.id,
      boisson_designation:"📦 PAIEMENT FOURNISSEUR (Réinitialisation)",
      quantite:1, prix_unitaire:montant
    }]);
    await client.from('config').update({ valeur:"0" })
      .eq('cle','total_fournisseur').eq('bar_id', barActuel.id);
    toast(`✅ Paiement ${formatPrix(montant)} enregistré`);
    await initialiserApplication();
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

  const html=`<html><head><meta charset="UTF-8"><style>body{font-family:Arial}table{width:100%;border-collapse:collapse;margin-bottom:20px}th,td{padding:8px;border:1px solid #ccc}th{background:#f0f0f0}h2{color:#2e7d32}h3{color:#0288d1}.bilan{display:flex;gap:20px;margin-bottom:20px}.bilan-item{padding:12px 20px;border-radius:8px;text-align:center}.b1{background:#e8f5e9;color:#1b5e20}.b2{background:#e3f2fd;color:#01579b}.b3{background:#fff3e0;color:#bf360c}</style></head><body><h2>🏪 Suivi Fournisseur</h2><p>Date : ${new Date().toLocaleString('fr-FR')}</p><div class="bilan"><div class="bilan-item b1"><div>Total Livré</div><strong>${totalL}</strong></div><div class="bilan-item b2"><div>Total Payé</div><strong>${totalP}</strong></div><div class="bilan-item b3"></div><h3>📦 Livraisons</h3>${tL?tL.outerHTML:''}<h3>💳 Paiements</h3>${tP?tP.outerHTML:''}</body></html>`;
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
  const msg=`*SUIVI FOURNISSEUR*\n\n📦 Livraisons :\n${livs}\n💳 Paiements :\n${paies}\n\n✅ Total Livré : ${tL}\n💳 Total Payé : ${tP}\nDate : ${new Date().toLocaleDateString('fr-FR')}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}
// ── COMMANDES ──────────────────────────────────────────────────

async function ouvrirNouvelleCommande() {
  const table = document.getElementById('cmd-table')?.value.trim();
  const clientNom = document.getElementById('cmd-client')?.value.trim();
  if (!table) { toast('⚠️ Indique un numéro de table', 'warning'); return; }

  const { data, error } = await client.from('commandes').insert([{
    bar_id: barActuel.id,
    table_num: table,
    client_nom: clientNom || null,
    statut: 'ouverte',
    articles: [],
    total: 0
  }]).select().single();

  if (error) { toast('❌ ' + error.message, 'error'); return; }

  document.getElementById('cmd-table').value = '';
  document.getElementById('cmd-client').value = '';
  toast('✅ Commande ouverte — ' + table);
  await chargerCommandes();
  ouvrirModalCommande(data);
}

async function chargerCommandes() {
  const { data, error } = await client.from('commandes')
    .select('*')
    .eq('bar_id', barActuel.id)
    .eq('statut', 'ouverte')
    .order('created_at', { ascending: true });

  if (error) { console.error(error); return; }
  commandesOuvertes = data || [];
  afficherCommandes();
}

function afficherCommandes() {
  const div = document.getElementById('commandes-liste');
  if (!div) return;

  if (commandesOuvertes.length === 0) {
    div.innerHTML = '<div style="text-align:center;color:#aaa;padding:30px;">Aucune commande ouverte</div>';
    return;
  }

  div.innerHTML = commandesOuvertes.map(cmd => {
    const articles = cmd.articles || [];
    const duree = dureeDepuis(cmd.created_at);
    const detail = articles.length > 0
      ? articles.map(a => `${a.designation} x${a.qte}`).join(', ')
      : 'Aucun article';
    const label = cmd.client_nom ? `${cmd.table_num} — ${cmd.client_nom}` : cmd.table_num;

    return `<div style="border:1px solid #ddd;border-radius:8px;padding:14px;margin-bottom:12px;background:#fff;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div>
          <span style="font-weight:700;font-size:15px;">${label}</span>
          <span style="margin-left:10px;font-size:12px;color:#888;">⏱️ ${duree}</span>
        </div>
        <span style="font-weight:700;color:#1a6b3a;font-size:15px;">${formatPrix(cmd.total)}</span>
      </div>
      <div style="font-size:13px;color:#555;margin-bottom:10px;">${detail}</div>
      ${cmd.note ? `<div style="font-size:12px;color:#0288d1;font-style:italic;margin-bottom:8px;">📝 ${cmd.note}</div>` : ''}
      <div style="display:flex;gap:8px;">
        <button class="btn" style="flex:1;" onclick="ouvrirModalCommande(commandesOuvertes.find(c=>c.id==${cmd.id}))">✏️ Modifier</button>
        <button class="btn" style="flex:1;background:#2e7d32;" onclick="encaisserCommandeId(${cmd.id})">✅ Encaisser</button>
        <button class="btn btn-danger" style="flex:0;" onclick="annulerCommande(${cmd.id})">🗑️</button>
      </div>
    </div>`;
  }).join('');
  mettreAJourBadgeCommandes();
}

function dureeDepuis(created_at) {
  const diff = Math.floor((Date.now() - new Date(created_at)) / 1000);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + ' min';
  return Math.floor(diff / 3600) + 'h ' + Math.floor((diff % 3600) / 60) + 'min';
}

function ouvrirModalCommande(cmd) {
  commandeActive = cmd;
  const label = cmd.client_nom ? `${cmd.table_num} — ${cmd.client_nom}` : cmd.table_num;
  document.getElementById('modal-cmd-titre').textContent = '🧾 ' + label;
  document.getElementById('modal-cmd-note').value = cmd.note || '';
  afficherArticlesCommande();
  afficherBoissonsCommande('');
  document.getElementById('modal-commande').classList.add('visible');
}

function fermerModalCommande() {
  document.getElementById('modal-commande').classList.remove('visible');
  commandeActive = null;
}

function afficherArticlesCommande() {
  const div = document.getElementById('modal-cmd-articles');
  if (!div || !commandeActive) return;
  const articles = commandeActive.articles || [];
  if (articles.length === 0) {
    div.innerHTML = '<div style="color:#aaa;font-size:13px;margin-bottom:8px;">Aucun article ajouté</div>';
    return;
  }
  const total = articles.reduce((s, a) => s + a.prix * a.qte, 0);
  div.innerHTML = `
    <div style="background:#f9f9f9;border-radius:6px;padding:10px;margin-bottom:10px;">
      ${articles.map((a, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <span style="font-size:13px;">${a.designation} × ${a.qte}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:13px;font-weight:600;">${formatPrix(a.prix * a.qte)}</span>
            <button onclick="retirerArticleCommande(${i})"
              style="background:#c62828;color:white;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:12px;">✖</button>
          </div>
        </div>`).join('')}
      <div style="border-top:1px solid #ddd;margin-top:6px;padding-top:6px;font-weight:700;display:flex;justify-content:space-between;">
        <span>Total</span><span style="color:#1a6b3a;">${formatPrix(total)}</span>
      </div>
    </div>`;
}

function filtrerBoissonsCommande() {
  const q = document.getElementById('modal-cmd-search')?.value || '';
  afficherBoissonsCommande(q);
}

function afficherBoissonsCommande(recherche) {
  const div = document.getElementById('modal-cmd-boissons');
  if (!div) return;
  const terme = recherche.toLowerCase();
  const fil = boissons.filter(b => b.stock > 0 && b.designation.toLowerCase().includes(terme));
  if (fil.length === 0) { div.innerHTML = '<div style="color:#aaa;font-size:13px;">Aucune boisson disponible</div>'; return; }
  div.innerHTML = fil.map(b => `
    <button onclick="ajouterArticleCommande(${b.id})"
      style="background:#f0faf4;border:1px solid #c8e6c9;border-radius:6px;padding:8px;text-align:left;cursor:pointer;font-size:12px;">
      <div style="font-weight:600;">${b.designation}</div>
      <div style="color:#1a6b3a;">${formatPrix(b.prix_unitaire)}</div>
      <div style="color:#888;">Stock: ${b.stock}</div>
    </button>`).join('');
}

function ajouterArticleCommande(id) {
  if (!commandeActive) return;
  const b = boissons.find(i => i.id === id);
  if (!b) return;
  const articles = commandeActive.articles || [];
  const existe = articles.find(a => a.id === id);
  if (existe) {
    existe.qte += 1;
  } else {
    articles.push({ id: b.id, designation: b.designation, prix: b.prix_unitaire, qte: 1 });
  }
  commandeActive.articles = articles;
  commandeActive.total = articles.reduce((s, a) => s + a.prix * a.qte, 0);
  afficherArticlesCommande();
}

function retirerArticleCommande(index) {
  if (!commandeActive) return;
  const articles = commandeActive.articles || [];
  if (articles[index].qte > 1) {
    articles[index].qte -= 1;
  } else {
    articles.splice(index, 1);
  }
  commandeActive.total = articles.reduce((s, a) => s + a.prix * a.qte, 0);
  afficherArticlesCommande();
}

async function sauvegarderCommande() {
  if (!commandeActive) return;
  const note = document.getElementById('modal-cmd-note')?.value.trim() || null;
  const { error } = await client.from('commandes').update({
    articles: commandeActive.articles,
    total: commandeActive.total,
    note
  }).eq('id', commandeActive.id);
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  toast('💾 Commande sauvegardée !');
  await chargerCommandes();
}

async function encaisserCommandeId(id) {
  const cmd = commandesOuvertes.find(c => c.id === id);
  if (cmd) { commandeActive = cmd; await encaisserCommande(); }
}

async function encaisserCommande() {
  if (!commandeActive) return;
  await sauvegarderCommande();
  const cmd = commandeActive;
  if (!cmd.articles || cmd.articles.length === 0) {
    toast('⚠️ Aucun article dans la commande', 'warning'); return;
  }

   // Vérification stock frais
  const ids = cmd.articles.map(a => a.id);
  const { data: stockFrais } = await client.from('boissons')
    .select('id, stock, designation')
    .in('id', ids)
    .eq('bar_id', barActuel.id);

  for (const a of cmd.articles) {
    const bFrais = stockFrais?.find(b => b.id === a.id);
    if (bFrais && a.qte > bFrais.stock) {
      toast(`❌ Stock insuffisant pour ${bFrais.designation} (reste ${bFrais.stock})`, 'error');
      await initialiserApplication();
      return;
    }
  }
  // Calcul bénéfice
  let total = 0, benef = 0;
  for (const a of cmd.articles) {
    const b = boissons.find(i => i.id === a.id);
    if (!b) continue;
    const qpc = b.quantite_par_cassier || (b.type_bouteille === 'petit bouteille' ? 24 : 12);
    const achat = b.pu_initial > 0 ? Math.round(b.pu_initial / qpc) : 0;
    total += a.prix * a.qte;
    benef += (a.prix - achat) * a.qte;
  }

  const label = cmd.client_nom ? `${cmd.table_num} — ${cmd.client_nom}` : cmd.table_num;
  const note = (document.getElementById('modal-cmd-note')?.value.trim()) || label;

  try {
    // Insérer dans ventes
    const { data: vente, error: eV } = await client.from('ventes').insert([{
  bar_id: barActuel.id, total, benefice: benef, benef, note,
  serveuse: utilisateurActuel?.nom || null
}]).select().single();
    if (eV) throw eV;

    // Insérer les articles + décrémenter stock
    for (const a of cmd.articles) {
      await client.from('vente_articles').insert([{
        vente_id: vente.id, bar_id: barActuel.id,
        boisson_designation: a.designation,
        quantite: a.qte, prix_unitaire: a.prix
      }]);
      const b = boissons.find(i => i.id === a.id);
      if (b) await client.from('boissons')
        .update({ stock: b.stock - a.qte })
        .eq('id', a.id).eq('bar_id', barActuel.id);
    }

    // Fermer la commande
    await client.from('commandes').update({ statut: 'payee' }).eq('id', cmd.id);

    fermerModalCommande();
    toast('✅ Commande encaissée — ' + formatPrix(total));
    await initialiserApplication();
    await chargerCommandes();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

async function annulerCommande(id) {
  if (!confirm('Annuler cette commande ?')) return;
  const { error } = await client.from('commandes')
    .update({ statut: 'annulee' }).eq('id', id);
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  toast('🗑️ Commande annulée');
  await chargerCommandes();
}

function mettreAJourBadgeCommandes() {
  const badge = document.getElementById('badge-commandes');
  if (!badge) return;
  const nb = commandesOuvertes.length;
  if (nb === 0) {
    badge.style.display = 'none';
  } else {
    badge.style.display = 'inline';
    badge.textContent = nb;
  }
}
function ouvrirModalEnvoyerTable() {
  if (Object.keys(panier).length === 0) { toast('⚠️ Panier vide !', 'warning'); return; }
  if (commandesOuvertes.length === 0) { toast('⚠️ Aucune table ouverte', 'warning'); return; }

  const div = document.getElementById('modal-tables-liste');
  if (div) {
    div.innerHTML = commandesOuvertes.map(cmd => {
      const label = cmd.client_nom ? `${cmd.table_num} — ${cmd.client_nom}` : cmd.table_num;
      const nb = (cmd.articles || []).reduce((s, a) => s + a.qte, 0);
      return `<button onclick="envoyerPanierVersTable(${cmd.id})"
        style="background:#f0faf4;border:1px solid #c8e6c9;border-radius:8px;padding:12px;text-align:left;cursor:pointer;font-size:14px;">
        <strong>${label}</strong>
        <span style="float:right;color:#888;font-size:12px;">${nb} article(s) — ${formatPrix(cmd.total)}</span>
      </button>`;
    }).join('');
  }
  document.getElementById('modal-choisir-table').classList.add('visible');
}

function fermerModalTable() {
  document.getElementById('modal-choisir-table').classList.remove('visible');
}

async function envoyerPanierVersTable(cmdId) {
  const cmd = commandesOuvertes.find(c => c.id === cmdId);
  if (!cmd) return;

  const articles = [...(cmd.articles || [])];

  for (const id in panier) {
    const b = boissons.find(i => i.id == id);
    if (!b) continue;
    const existe = articles.find(a => a.id == id);
    if (existe) {
      existe.qte += panier[id];
    } else {
      articles.push({ id: b.id, designation: b.designation, prix: b.prix_unitaire, qte: panier[id] });
    }
  }

  const total = articles.reduce((s, a) => s + a.prix * a.qte, 0);

  const { error } = await client.from('commandes').update({ articles, total }).eq('id', cmdId);
  if (error) { toast('❌ ' + error.message, 'error'); return; }

  fermerModalTable();
  panier = {};
  mettreAJourTicket();
  toast('✅ Articles ajoutés à la table !');
  await chargerCommandes();
}
// ==================== DÉMARRAGE ====================
document.addEventListener("DOMContentLoaded", () => {
  appliquerDarkMode();
  gererConnexion();
  const sCat=document.getElementById('search-catalogue'); if(sCat)sCat.addEventListener('input',afficherCatalogue);
  const sVen=document.getElementById('search-ventes'); if(sVen)sVen.addEventListener('input',afficherVentes);
    const connEmail = document.getElementById('conn-email');
  const connPassword = document.getElementById('conn-password');
  const insConfirm = document.getElementById('ins-password-confirm');
  [connEmail, connPassword].forEach(el => {
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') seConnecter(); });
  });
  if (insConfirm) insConfirm.addEventListener('keydown', e => { if (e.key === 'Enter') inscrireBar(); });
  setInterval(() => {
  if (document.getElementById('commandes')?.classList.contains('active')) {
    afficherCommandes();
  }
}, 30000); // rafraichit toutes les 30 secondes
  restaurerSession();
});


// ── RÔLES & SERVEUSES ─────────────────────────────────────────

function afficherEcranRole() {
  document.getElementById('ecran-auth').style.display = 'none';
  document.getElementById('app-principale').style.display = 'none';
  document.getElementById('ecran-role').style.display = 'flex';
  const el = document.getElementById('role-bar-nom');
  if (el) el.textContent = barActuel.nom;
}

function connexionGerant() {
  document.getElementById('panel-gerant').style.display = 'block';
  document.getElementById('panel-serveuse').style.display = 'none';
  setTimeout(() => document.getElementById('input-pin-gerant')?.focus(), 100);
}

async function validerPinGerant() {
  const pin = document.getElementById('input-pin-gerant')?.value;
  const errEl = document.getElementById('erreur-pin-gerant');

  // Lire le PIN gérant depuis config
  const { data } = await client.from('config')
    .select('valeur').eq('cle', 'pin_gerant').eq('bar_id', barActuel.id).single();

  const pinStocke = data?.valeur;

  if (!pinStocke) {
    // Pas encore de PIN — première fois, on le définit
    if (!pin || pin.length < 4) { if(errEl){errEl.textContent='PIN trop court (4 min)';errEl.style.display='block';} return; }
    await client.from('config').insert([{ bar_id: barActuel.id, cle: 'pin_gerant', valeur: pin }]);
    toast('✅ PIN gérant défini !');
  } else if (pin !== pinStocke) {
    if (errEl) { errEl.textContent = 'PIN incorrect'; errEl.style.display = 'block'; }
    document.getElementById('input-pin-gerant').value = '';
    return;
  }

  utilisateurActuel = { nom: 'Gérant', role: 'gerant' };
  document.getElementById('input-pin-gerant').value = '';
  if (errEl) errEl.style.display = 'none';
  lancerApplicationAvecRole();
}

async function afficherChoixServeuse() {
  document.getElementById('panel-serveuse').style.display = 'block';
  document.getElementById('panel-gerant').style.display = 'none';
  document.getElementById('panel-pin-serveuse').style.display = 'none';

  const { data: serveuses } = await client.from('serveuses')
    .select('id, nom').eq('bar_id', barActuel.id).order('nom');

  const div = document.getElementById('liste-serveuses');
  if (!div) return;
  if (!serveuses || serveuses.length === 0) {
    div.innerHTML = '<div style="color:#888;font-size:13px;">Aucune serveuse enregistrée.<br>Le gérant doit en ajouter depuis l\'app.</div>';
    return;
  }
  div.innerHTML = serveuses.map(s => `
    <button onclick="selectionnerServeuse(${s.id}, '${s.nom}')"
      style="background:#f0faf4;border:1px solid #c8e6c9;border-radius:8px;padding:12px;
             text-align:left;cursor:pointer;font-size:15px;font-weight:600;">
      👤 ${s.nom}
    </button>`).join('');
}

let serveuseSelectionnee = null;
function selectionnerServeuse(id, nom) {
  serveuseSelectionnee = { id, nom };
  document.getElementById('panel-pin-serveuse').style.display = 'block';
  setTimeout(() => document.getElementById('input-pin-serveuse')?.focus(), 100);
}

async function validerPinServeuse() {
  if (!serveuseSelectionnee) return;
  const pin = document.getElementById('input-pin-serveuse')?.value;
  const errEl = document.getElementById('erreur-pin-serveuse');

  const { data } = await client.from('serveuses')
    .select('code_pin').eq('id', serveuseSelectionnee.id).single();

  if (!data || pin !== data.code_pin) {
    if (errEl) { errEl.textContent = 'PIN incorrect'; errEl.style.display = 'block'; }
    document.getElementById('input-pin-serveuse').value = '';
    return;
  }

  utilisateurActuel = { nom: serveuseSelectionnee.nom, role: 'serveuse' };
  document.getElementById('input-pin-serveuse').value = '';
  serveuseSelectionnee = null;
  if (errEl) errEl.style.display = 'none';
  lancerApplicationAvecRole();
}

function lancerApplicationAvecRole() {
  document.getElementById('ecran-role').style.display = 'none';
  document.getElementById('app-principale').style.display = 'block';
  const nomEl = document.getElementById('nom-bar-actuel');
  if (nomEl) nomEl.innerText = `Consensus BarStock - ${barActuel.nom} (${utilisateurActuel.nom})`;
  appliquerRestrictions();
  activerRealtime();
  initialiserApplication().then(() => {
    // Après chargement des données, afficher la bonne section
    const estGerant = utilisateurActuel?.role === 'gerant';
    if (estGerant) {
      showSection('catalogue');
    } else {
      showSection('ventes');
    }
  });
}
function appliquerRestrictions() {
  const estGerant = utilisateurActuel?.role === 'gerant';

  // Sections cachées pour les serveuses
  const sectionsGerant = ['etat-stock', 'stockage-recup', 'historique', 'corbeille', 'rapport-serveuses'];
  sectionsGerant.forEach(id => {
    const btn = document.querySelector(`[data-section="${id}"]`);
    if (btn) btn.style.display = estGerant ? '' : 'none';
  });

  // Éléments .gerant-only
  document.querySelectorAll('.gerant-only').forEach(el => {
    el.style.display = estGerant ? '' : 'none';
  });

  // Si serveuse → forcer caisse
  if (!estGerant) {
    setTimeout(() => showSection('ventes'), 300);
  }
}

// ── GESTION SERVEUSES (interface gérant) ──────────────────────

async function ajouterServeuse() {
  const nom = document.getElementById('srv-nom')?.value.trim();
  const pin = document.getElementById('srv-pin')?.value.trim();
  if (!nom) { toast('⚠️ Nom obligatoire', 'warning'); return; }
  if (!pin || pin.length < 4) { toast('⚠️ PIN trop court (4 min)', 'warning'); return; }

  const { error } = await client.from('serveuses')
    .insert([{ bar_id: barActuel.id, nom, code_pin: pin }]);
  if (error) { toast('❌ ' + error.message, 'error'); return; }

  document.getElementById('srv-nom').value = '';
  document.getElementById('srv-pin').value = '';
  toast('✅ Serveuse ajoutée !');
  chargerListeServeuses();
}

async function chargerListeServeuses() {
  const { data } = await client.from('serveuses')
    .select('*').eq('bar_id', barActuel.id).order('nom');
  const div = document.getElementById('liste-serveuses-gestion');
  if (!div) return;
  if (!data || data.length === 0) {
    div.innerHTML = '<div style="color:#aaa;font-size:13px;padding:10px;">Aucune serveuse enregistrée.</div>';
    return;
  }
  div.innerHTML = data.map(s => `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:10px;border:1px solid #eee;border-radius:8px;margin-bottom:6px;">
      <span style="font-weight:600;">👤 ${escape(s.nom)}</span>
      <button class="btn btn-danger btn-sm" onclick="supprimerServeuse(${s.id})">🗑️</button>
    </div>`).join('');
}
async function chargerRapportServeuses() {
  const periode = document.getElementById('rapport-periode')?.value || 'today';

  // Calcul de la date de début selon la période
  const maintenant = new Date();
  let dateDebut = null;
  if (periode === 'today') {
    dateDebut = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate()).toISOString();
  } else if (periode === 'week') {
    dateDebut = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (periode === 'month') {
    dateDebut = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1).toISOString();
  }

  // Charger les ventes
  let query = client.from('ventes')
    .select('id, total, benef, serveuse, created_at, vente_articles(boisson_designation, quantite)')
    .eq('bar_id', barActuel.id)
    .order('created_at', { ascending: false });

  if (dateDebut) query = query.gte('created_at', dateDebut);

  const { data: ventes, error } = await query;
  if (error) { toast('❌ ' + error.message, 'error'); return; }

  // Grouper par serveuse
  const groupes = {};
  for (const v of ventes || []) {
    const nom = v.serveuse || 'Inconnu';
    if (!groupes[nom]) groupes[nom] = { nom, ventes: [], total: 0, benef: 0 };
    groupes[nom].ventes.push(v);
    groupes[nom].total += parseInt(v.total) || 0;
    groupes[nom].benef += parseInt(v.benef) || 0;
  }

  const liste = Object.values(groupes).sort((a, b) => b.total - a.total);
  const totalGlobal = liste.reduce((s, g) => s + g.total, 0);
  const benefGlobal = liste.reduce((s, g) => s + g.benef, 0);

  // Stats globales
  const statsDiv = document.getElementById('rapport-stats-globales');
  if (statsDiv) {
    statsDiv.innerHTML = `
      <div class="stat-box" style="border-left-color:#1a6b3a;">
        <div class="stat-label">Total CA période</div>
        <div class="stat-value vert">${formatPrix(totalGlobal)}</div>
      </div>
      <div class="stat-box" style="border-left-color:#d4a017;">
        <div class="stat-label">Bénéfice période</div>
        <div class="stat-value" style="color:#d4a017;">${formatPrix(benefGlobal)}</div>
      </div>
      <div class="stat-box" style="border-left-color:#0288d1;">
        <div class="stat-label">Serveuses actives</div>
        <div class="stat-value" style="color:#0288d1;">${liste.length}</div>
      </div>`;
  }

  // Tableau par serveuse
  const contenu = document.getElementById('rapport-serveuses-contenu');
  if (!contenu) return;

  if (liste.length === 0) {
    contenu.innerHTML = '<div style="text-align:center;color:#aaa;padding:30px;">Aucune vente sur cette période.</div>';
    return;
  }

  contenu.innerHTML = liste.map(g => {
    const nbVentes = g.ventes.filter(v => {
      const d = (v.vente_articles||[]).map(a=>a.boisson_designation||'').join(' ').toUpperCase();
      return !d.includes('RETOUR') && !d.includes('PERTE') && !d.includes('FOURNISSEUR');
    }).length;

    return `
    <div style="border:1px solid #ddd;border-radius:10px;margin-bottom:16px;overflow:hidden;">
      <!-- En-tête serveuse -->
      <div style="background:#0f3d22;color:white;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:700;font-size:15px;">👤 ${escape(g.nom)}</span>
        <span style="font-size:13px;opacity:0.8;">${nbVentes} vente(s)</span>
      </div>
      <!-- Stats serveuse -->
      <div style="display:flex;gap:0;border-bottom:1px solid #eee;">
        <div style="flex:1;padding:12px;text-align:center;border-right:1px solid #eee;">
          <div style="font-size:11px;color:#888;text-transform:uppercase;">CA</div>
          <div style="font-weight:700;color:#1a6b3a;">${formatPrix(g.total)}</div>
        </div>
        <div style="flex:1;padding:12px;text-align:center;">
          <div style="font-size:11px;color:#888;text-transform:uppercase;">Bénéfice</div>
          <div style="font-weight:700;color:#d4a017;">${formatPrix(g.benef)}</div>
        </div>
      </div>
      <!-- Dernières ventes -->
      <div style="padding:12px;">
        <div style="font-size:12px;font-weight:600;color:#555;margin-bottom:8px;">DERNIÈRES VENTES</div>
        ${g.ventes.slice(0, 5).map(v => {
          const articles = (v.vente_articles||[]).map(a => `${a.boisson_designation} ×${a.quantite}`).join(', ');
          const date = new Date(v.created_at).toLocaleString('fr-FR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
          return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #f0f0f0;font-size:13px;">
            <span style="color:#555;">${date} — ${articles || '—'}</span>
            <span style="font-weight:600;color:#1a6b3a;">${formatPrix(parseInt(v.total)||0)}</span>
          </div>`;
        }).join('')}
        ${g.ventes.length > 5 ? `<div style="text-align:center;color:#888;font-size:12px;margin-top:6px;">+ ${g.ventes.length - 5} autre(s)</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function supprimerServeuse(id) {
  if (!confirm('Supprimer cette serveuse ?')) return;
  await client.from('serveuses').delete().eq('id', id);
  toast('🗑️ Serveuse supprimée');
  chargerListeServeuses();
}


// Bouton changer d'utilisateur
function changerUtilisateur() {
  utilisateurActuel = null;
  realtimeActif = false;
  client.removeAllChannels();
  afficherEcranRole();
}
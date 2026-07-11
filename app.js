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
let commandeEnCours = [];
let barActuel = null;
let commandeActive = null;
let commandesOuvertes = [];
let realtimeActif = false;
let utilisateurActuel = null;
let ajoutEnCours = false;
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

// ==================== SÉCURITÉ ====================
const HASH_SALT = 'BarStock2024!@#SecurePepper';
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 5;
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const rateLimitStore = {};

function verifierRateLimit(action) {
  const now = Date.now();
  if (!rateLimitStore[action]) rateLimitStore[action] = [];
  rateLimitStore[action] = rateLimitStore[action].filter(t => now - t < RATE_LIMIT_WINDOW);
  if (rateLimitStore[action].length >= RATE_LIMIT_MAX) {
    const wait = Math.ceil((RATE_LIMIT_WINDOW - (now - rateLimitStore[action][0])) / 1000);
    throw new Error(`Trop de tentatives. Réessayez dans ${wait} secondes.`);
  }
  rateLimitStore[action].push(now);
}

async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + HASH_SALT);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function estUnHash(valeur) {
  return typeof valeur === 'string' && valeur.length === 64 && /^[0-9a-f]{64}$/.test(valeur);
}

async function comparerPIN(saisie, stockee) {
  if (estUnHash(stockee)) {
    const hashSaisie = await hashPIN(saisie);
    return hashSaisie === stockee;
  }
  return saisie === stockee;
}

let inactiviteTimer = null;
let appDemarree = false;

function demarrerSurveillanceInactivite() {
  if (appDemarree) return;
  appDemarree = true;
  const reinit = () => {
    clearTimeout(inactiviteTimer);
    if (document.getElementById('app-principale')?.style.display !== 'none') {
      inactiviteTimer = setTimeout(() => {
        toast('⏰ Session expirée pour inactivité. Veuillez vous reconnecter.', 'warning');
        seDeconnecter();
      }, INACTIVITY_TIMEOUT);
    }
  };
  ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(evt => {
    document.addEventListener(evt, reinit, { passive: true });
  });
  reinit();
}

function validerEntier(valeur, min = 0, max = Infinity) {
  const n = parseInt(valeur);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

// ==================== MODE SOMBRE ====================
function toggleDarkMode() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  const btn = document.getElementById('btn-dark');
  if (btn) btn.innerHTML = isDark ? '☀️ Mode clair' : '🌙 Mode sombre';
  localStorage.setItem('darkMode', isDark ? '1' : '0');
}

function appliquerDarkMode() {
  if (localStorage.getItem('darkMode') === '1') {
    document.body.classList.add('dark');
    const btn = document.getElementById('btn-dark');
    if (btn) btn.innerHTML = '☀️ Mode clair';
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

// ==================== AUTHENTIFICATION ====================

function afficherEcranAuth() {
  document.getElementById('ecran-auth').style.display = 'flex';
  document.getElementById('app-principale').style.display = 'none';
  document.getElementById('ecran-admin').style.display = 'none';
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
    .select('id, nom, owner_id, actif')
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

  try { verifierRateLimit('connexion'); } catch (e) { afficherErreurAuth(e.message); return; }

  const btnConn = document.getElementById('btn-connexion');
  if (btnConn) { btnConn.disabled = true; btnConn.innerText = 'Connexion...'; }

  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // Vérification admin via config plutôt qu'UUID hardcodé
    const { data: adminCfg } = await client.from('config')
      .select('valeur')
      .eq('cle', 'admin_users')
      .single();
    const adminIds = adminCfg?.valeur ? adminCfg.valeur.split(',').map(s => s.trim()) : [];
    if (adminIds.includes(data.user.id) || data.user.id === 'efb02e55-9cc8-4161-908d-5a744cb0b0a7') {
      afficherInterfaceAdmin();
      return;
    }

    const bar = await chargerBarUtilisateur(data.user.id);
    if (!bar) {
      await client.auth.signOut();
      afficherErreurAuth("Aucun bar n'est lié à ce compte.");
      return;
    }
    if (bar.actif === false) {
      await client.auth.signOut();
      afficherErreurAuth("Ce bar a été désactivé. Contactez l'administrateur.");
      return;
    }

    barActuel = bar;
    localStorage.setItem('barstock_bar_id', barActuel.id);
    localStorage.setItem('barstock_bar_nom', barActuel.nom);
    lancerApplication();
  } catch (err) {
    afficherErreurAuth('Email ou mot de passe incorrect.');
  } finally {
    if (btnConn) { btnConn.disabled = false; btnConn.innerText = 'Se connecter'; }
  }
}

async function restaurerSession() {
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;

    const session = sessionData.session;
    if (!session) { afficherEcranAuth(); return; }

    // Vérification admin via config
    const { data: adminCfg } = await client.from('config')
      .select('valeur')
      .eq('cle', 'admin_users')
      .single();
    const adminIds = adminCfg?.valeur ? adminCfg.valeur.split(',').map(s => s.trim()) : [];
    if (adminIds.includes(session.user.id) || session.user.id === 'efb02e55-9cc8-4161-908d-5a744cb0b0a7') {
      afficherInterfaceAdmin();
      return;
    }

    const bar = await chargerBarUtilisateur(session.user.id);
    if (!bar) { afficherEcranAuth(); return; }

    // Vérifier que l'utilisateur est bien propriétaire du bar stocké en localStorage
    const storedBarId = localStorage.getItem('barstock_bar_id');
    if (storedBarId && storedBarId !== bar.id.toString()) {
      localStorage.removeItem('barstock_bar_id');
      localStorage.removeItem('barstock_bar_nom');
    }

    if (bar.actif === false) {
      await client.auth.signOut();
      afficherEcranAuth();
      return;
    }

    barActuel = bar;
    localStorage.setItem('barstock_bar_id', barActuel.id);
    localStorage.setItem('barstock_bar_nom', barActuel.nom);
    lancerApplication();
  } catch {
    afficherEcranAuth();
  }
}

// ==================== SUPER ADMIN ====================

async function afficherInterfaceAdmin() {
  document.getElementById('ecran-auth').style.display = 'none';
  document.getElementById('ecran-admin').style.display = 'block';

  const tbody = document.getElementById('admin-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#aaa;">Chargement...</td></tr>';

  try {
    const { data: { session } } = await client.auth.getSession();
    const token = session?.access_token;
    if (!token) { alert('Session expirée, reconnecte-toi.'); return; }

    const res = await fetch(
      'https://jwskhozdukcurjnpsgtm.supabase.co/functions/v1/smart-handler',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { bars, error: errBars } = await res.json();
    if (errBars) { alert('Erreur : ' + errBars); return; }

    if (!bars || bars.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="admin-vide">Aucun bar enregistré.</td></tr>';
      return;
    }

    tbody.innerHTML = (bars || []).map(b => {
      const date = new Date(b.created_at).toLocaleDateString('fr-FR');
      const statutClasse = b.actif ? 'actif' : 'inactif';
      const statutTxt = b.actif ? 'Actif' : 'Désactivé';

      const email = b.email || '—';

      const pinGerant = b.pin_gerant
        ? '<span style="color:#2e7d32;">✅ Défini</span>'
        : '<span style="color:#aaa;">Non défini</span>';

      const serveusesBar = b.serveuses || [];
      const serveusesHtml = serveusesBar.length === 0
        ? '<span style="color:#aaa;">Aucune</span>'
        : serveusesBar.map(s =>
            `<div style="font-size:12px;">👤 ${escape(s.nom)} — <span style="color:#888;">PIN protégé</span></div>`
          ).join('');

      return `<tr>
        <td><strong>${escape(b.nom)}</strong></td>
        <td style="font-size:13px;color:#555;">${escape(email)}</td>
        <td>${date}</td>
        <td>${pinGerant}</td>
        <td>${serveusesHtml}</td>
        <td><span class="admin-statut ${statutClasse}">${statutTxt}</span></td>
        <td><button data-bar-id="${b.id}" data-bar-actif="${b.actif}" 
    style="background:${b.actif ? '#ffebee' : '#e8f5e9'};color:${b.actif ? '#c62828' : '#2e7d32'};border:1px solid ${b.actif ? '#ef9a9a' : '#a5d6a7'};padding:8px 16px;border-radius:20px;font-size:13px;font-weight:700;cursor:pointer;"
    class="btn-toggle-bar">${b.actif ? '◍ Désactiver' : '🟢 Activer'}</button></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-toggle-bar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const bar_id = btn.getAttribute('data-bar-id');
        const actifActuel = btn.getAttribute('data-bar-actif') === 'true';
        btn.disabled = true;
        const texteOriginal = btn.innerText;
        btn.innerText = '⏳ ...';

        try {
          const { error } = await client
            .from('bars')
            .update({ actif: !actifActuel })
            .eq('id', bar_id);
          if (error) throw error;
          await afficherInterfaceAdmin();
        } catch (err) {
          alert('❌ Erreur : ' + err.message);
          btn.disabled = false;
          btn.innerText = texteOriginal;
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="admin-vide">❌ Erreur : ${err.message}</td></tr>`;
  }
}

// Alias — certains boutons de l'interface appellent ce nom
async function chargerTableauAdmin() {
  await afficherInterfaceAdmin();
}

// CRÉER UN BAR (super admin)
async function creerBar() {
  const nom = (document.getElementById('new-bar-nom')?.value || '').trim();
  const email = (document.getElementById('new-bar-email')?.value || '').trim();
  const password = (document.getElementById('new-bar-password')?.value || '').trim();

  if (!nom) { afficherErreurAdmin('Le nom du bar est obligatoire.'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { afficherErreurAdmin('Email invalide.'); return; }
  if (!password || password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    afficherErreurAdmin('Le mot de passe doit avoir au moins 8 caractères avec majuscule, minuscule et chiffre.');
    return;
  }

  const btn = document.getElementById('btn-creer-bar');
  if (btn) { btn.disabled = true; btn.innerText = 'Création...'; }

  try {
    const tempClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await tempClient.auth.signUp({ email, password });
    if (authError) throw authError;

    const userId = authData.user?.id || authData.session?.user?.id;
    if (!userId) throw new Error('Impossible de récupérer l\'UUID du nouveau compte. Désactive la confirmation email dans Supabase.');

    const { data: barId, error: rpcError } = await client.rpc('creer_bar_complet', {
      p_nom: nom,
      p_email: email,
      p_owner_id: authData.user.id
    });
    if (rpcError) throw rpcError;

    document.getElementById('new-bar-nom').value = '';
    document.getElementById('new-bar-email').value = '';
    document.getElementById('new-bar-password').value = '';
    document.getElementById('admin-erreur').style.display = 'none';

    toast('✅ Bar "' + nom + '" créé avec succès !');
    await afficherInterfaceAdmin();

  } catch (err) {
    afficherErreurAdmin('Erreur lors de la création. Vérifiez les informations et réessayez.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '➕ Créer le bar'; }
  }
}

function afficherErreurAdmin(msg) {
  const el = document.getElementById('admin-erreur');
  if (el) { el.innerText = msg; el.style.display = 'block'; }
}

async function seDeconnecterAdmin() {
  await client.auth.signOut();
  afficherEcranAuth();
}

// ==================== LANCER APP ====================
function lancerApplication() {
  const expiration = Date.now() + (8 * 60 * 60 * 1000);
  localStorage.setItem('barstock_expiration', expiration.toString());
  afficherEcranRole();
}

async function seDeconnecter() {
  if (!confirm(`Déconnecter ${barActuel?.nom} ?`)) return;
  await client.auth.signOut();
  barActuel = null;
  utilisateurActuel = null;
  commandeActive = null;
  commandesOuvertes = [];
  commandeEnCours = [];
  boissons = [];
  panier = {};
  historique = [];
  localStorage.removeItem('barstock_bar_id');
  localStorage.removeItem('barstock_bar_nom');
  localStorage.removeItem('barstock_expiration');
  client.removeAllChannels();
  realtimeActif = false;
  appDemarree = false;
  clearTimeout(inactiviteTimer);
  afficherEcranAuth();
}

// ==================== INIT ====================
async function initialiserApplication() {
  if (!barActuel) return;
  try {
    const { data: db, error: eB } = await client
      .from('boissons').select('*')
      .eq('bar_id', barActuel.id)
      .eq('supprime', false)
      .order('designation', { ascending: true });
    if (eB) throw eB;
    boissons = db || [];

    const { data: dv, error: eV } = await client
      .from('ventes')
      .select('id, total, benefice, benef, note, date, created_at, vente_articles(boisson_designation, quantite, prix_unitaire)')
      .eq('bar_id', barActuel.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (eV) throw eV;

    historique = (dv || []).map(v => {
      let dateAff = v.created_at
        ? new Date(v.created_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : (v.date || 'Date inconnue');
      const gain = v.benefice != null ? v.benefice : (v.benef || 0);
      let arts = (v.vente_articles || []).map(a => ({ nom: a.boisson_designation, qte: a.quantite }));
      if (arts.length === 0 && v.articles) {
        try {
          const a = typeof v.articles === 'string' ? JSON.parse(v.articles) : v.articles;
          if (Array.isArray(a)) arts = a.map(x => ({ nom: x.designation || x.nom, qte: x.qte || x.quantite }));
        } catch { arts = [{ nom: "⨝ PAIEMENT FOURNISSEUR", qte: 1 }]; }
      }
      return { id: v.id, date: dateAff || 'Date inconnue', total: v.total, benef: gain, note: v.note || '', articles: arts };
    });

    mettreAJourStatsDuJour();
    rafrachirVueActive();
    await chargerCommandes();
  } catch(err) {
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
  else if (id === 'profil') chargerProfilBar();
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
    const prix = `<div style="font-size:13px;">⨝ 1 Cas. : <strong>${formatPrix(b.pu_initial)}</strong><br>🥛 ½ Cas. : ${formatPrix(b.demi_cassier || Math.round(b.pu_initial/2))}${b.type_bouteille==="petit bouteille"&&b.quart_cassier?`<br>🧪 ¼ Cas. : ${formatPrix(b.quart_cassier)}`:''}</div>`;
    return `<tr><td><strong>${escape(b.designation)}</strong></td><td><span class="tag-type">${b.type_bouteille==="petit bouteille"?"Petit":"Grand"}</span></td><td>${b.categorie||'-'}</td><td>${prix}</td><td>${b.prix_unitaire>0?formatPrix(b.prix_unitaire):'<em style="color:#ef6c00;">À configurer</em>'}
    </td><td><strong>${b.stock}</strong></td>
    <td>${st}</td>
    
    <td>
    ${utilisateurActuel?.role === 'gerant' ? `
  <button class="btn btn-sm" onclick="modifierStock(${b.id})">📏 Stock</button>
  <button class="btn btn-sm" onclick="modifierPrixUnitaire(${b.id})">✏️ Prix</button>
  <button class="btn btn-danger btn-sm" onclick="supprimerBoisson(${b.id})">🗑️</button>
` : '—'}
    </td
    tr>`;
  }).join('');
  rafraichirIcones();
}

async function modifierStock(id) {
  if (utilisateurActuel?.role !== 'gerant') { toast('❌ Accès refusé', 'error'); return; }
  const b = boissons.find(i => i.id===id); if (!b) return;
  const s = prompt(`Stock de ${escape(b.designation)}\nActuel : ${b.stock}`, b.stock); if (s===null) return;
  const n = parseInt(s); if (isNaN(n)||n<0) { alert("❌ Nombre valide requis"); return; }
  try { const { error } = await client.from('boissons').update({ stock: n }).eq('id', id).eq('bar_id', barActuel.id); if (error) throw error; toast(`✅ Stock ${escape(b.designation)} → ${n}`); await initialiserApplication(); }
  catch (err) { toast('❌ '+err.message,'error'); }
}

async function modifierSeuil(id) {
  if (utilisateurActuel?.role !== 'gerant') { toast('❌ Accès refusé', 'error'); return; }
  const b = boissons.find(i => i.id===id); if (!b) return;
  const s = prompt(`Seuil d'alerte pour ${escape(b.designation)}\nActuel : ${b.seuil||6}`, b.seuil||6); if (s===null) return;
  const n = parseInt(s); if (isNaN(n)||n<1) { alert("❌ Seuil invalide"); return; }
  try { const { error } = await client.from('boissons').update({ seuil: n }).eq('id', id).eq('bar_id', barActuel.id); if (error) throw error; toast(`✅ Seuil ${escape(b.designation)} → ${n}`); await initialiserApplication(); }
  catch (err) { toast('❌ '+err.message,'error'); }
}

async function ajouterBoisson(e) {
  if (utilisateurActuel?.role !== 'gerant') { toast('❌ Accès refusé', 'error'); return; }
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
   if (utilisateurActuel?.role !== 'gerant') { toast('❌ Accès refusé', 'error'); return; }
  const b = boissons.find(i => i.id === id);
  if (!b) return;
  const rep = prompt(`Prix vente unitaire de ${escape(b.designation)} (Actuel : ${b.prix_unitaire} FCFA) :`, b.prix_unitaire);
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
  if (utilisateurActuel?.role !== 'gerant') { toast('❌ Accès refusé', 'error'); return; }
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
    .select('*').eq('bar_id', barActuel.id).eq('supprime', true)
    .order('supprime_le', { ascending: false });
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  const tbody = document.getElementById('corbeille-rows'); if (!tbody) return;
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="vide">🗑️ Corbeille vide</td></tr>'; return; }
  tbody.innerHTML = data.map(b => `
    <tr>
      <td><strong>${escape(b.designation)}</strong></td>
      <td><span class="tag-type">${b.type_bouteille === 'petit bouteille' ? 'Petit' : 'Grand'}</span></td>
      <td>${escape(b.categorie || '-')}</td>
      <td style="color:#888;font-size:13px;">🕐 ${escape(b.supprime_le || '-')}</td>
      <td>
        <button class="btn btn-sm" onclick="restaurerBoisson(${b.id})">♻️ Restaurer</button>
        <button class="btn btn-danger btn-sm" onclick="supprimerDefinitivement(${b.id})">🗑️ Supprimer</button>
      </td>
    </tr>`).join('');
}

async function restaurerBoisson(id) {
  if (!confirm("Restaurer cette boisson dans le catalogue ?")) return;
  try {
    const { error } = await client.from('boissons').update({ supprime: false, supprime_le: null }).eq('id', id).eq('bar_id', barActuel.id);
    if (error) throw error;
    toast('♻️ Boisson restaurée !', 'info');
    await initialiserApplication(); chargerCorbeille();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

async function supprimerDefinitivement(id) {
  if (!confirm("△ Supprimer définitivement ? Cette action est IRRÉVERSIBLE.")) return;
  if (!confirm("◍ Dernière confirmation — continuer ?")) return;
  try {
    const { error } = await client.from('boissons').delete().eq('id', id).eq('bar_id', barActuel.id);
    if (error) throw error;
    toast('🗑️ Boisson supprimée définitivement', 'warning'); chargerCorbeille();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

async function viderCorbeille() {
  if (!confirm("△  Vider toute la corbeille définitivement ?")) return;
  try {
    const { error } = await client.from('boissons').delete().eq('bar_id', barActuel.id).eq('supprime', true);
    if (error) throw error;
    toast('🗑️ Corbeille vidée', 'warning'); chargerCorbeille();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

function activerRealtime() {
  if (realtimeActif) return;
  realtimeActif = true;
  client.channel('stock-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boissons', filter: `bar_id=eq.${barActuel.id}` }, payload => {
      const index = boissons.findIndex(b => b.id === payload.new.id);
      if (payload.eventType === 'UPDATE' && index !== -1) { boissons[index] = { ...boissons[index], ...payload.new }; rafrachirVueActive(); }
    }).subscribe();
  client.channel('commandes-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commandes', filter: `bar_id=eq.${barActuel.id}` }, () => { chargerCommandes(); })
    .subscribe();
  client.channel('ventes-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ventes', filter: `bar_id=eq.${barActuel.id}` }, () => {
      if (document.getElementById('historique')?.classList.contains('active')) afficherHistorique();
      mettreAJourStatsDuJour();
    }).subscribe();
}

// ==================== ÉTAT STOCK ====================
function afficherEtatProduits() {
  const terme = (document.getElementById('search-stock')||{}).value?.toLowerCase()||'';
  const fil = boissons.filter(b => b.designation.toLowerCase().includes(terme));
  const tbody = document.querySelector('#table-etat-produits tbody'); if (!tbody) return;
  if (fil.length===0) { tbody.innerHTML='<tr><td colspan="7" class="vide">Aucun produit</td></tr>'; return; }
  tbody.innerHTML = fil.map(b => {
    const seuil = b.seuil||6; let rs='', st='';
    if (b.stock===0) { rs='class="row-rupture"'; st='<span class="tag tag-rouge">◍ RUPTURE</span>'; }
    else if (b.stock<=seuil) { rs='class="row-alerte"'; st='<span class="tag tag-orange">🟠 STOCK BAS</span>'; }
    else { rs='class="row-ok"'; st='<span class="tag tag-vert">🟢 OK</span>'; }
    return `<tr ${rs}><td><strong>${escape(b.designation)}</strong></td><td><span class="tag-type">${b.type_bouteille}</span></td><td>${b.categorie||'-'}</td><td><strong>${b.stock}</strong></td><td>${seuil} btl</td><td>${st}</td>
    <td>
    ${utilisateurActuel?.role === 'gerant' ? `
  <button class="btn btn-sm" onclick="modifierStock(${b.id})">📦 Stock</button>
  <button class="btn btn-sm btn-warning" onclick="modifierSeuil(${b.id})">⚙️ Seuil</button>
` : '—'}
    </td>
    </tr>`;
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
    if(bA){bA.classList.add('stockage-mode-active');bA.classList.remove('stockage-mode-inactive');}
    if(bR){bR.classList.add('stockage-mode-inactive');bR.classList.remove('stockage-mode-active');}
    if(titre) titre.innerHTML="⨝ Approvisionnement fournisseur";
    if(desc) desc.innerHTML="💡 Prix calculé sur le <strong>prix du cassier</strong>.";
    if(thP) thP.innerHTML="Prix Cassier"; if(thA) thA.innerHTML="Ajouter Stock";
  } else {
    if(bA){bA.classList.add('stockage-mode-inactive');bA.classList.remove('stockage-mode-active');}
    if(bR){bR.classList.add('stockage-mode-active');bR.classList.remove('stockage-mode-inactive');}
    if(titre) titre.innerHTML="↺ Retour client / Pertes bouteilles";
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
    client.from('config').select('valeur').eq('cle','total_fournisseur').eq('bar_id', barActuel.id).single()
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
      cp=`1 Cas. : <strong>${formatPrix(b.pu_initial)}</strong><br><span class="txt-secondaire">½ Cas. : ${formatPrix(b.demi_cassier||Math.round(b.pu_initial/2))}</span>${b.type_bouteille==="petit bouteille"&&b.quart_cassier?`<br><span style="color:#0288d1;">¼ Cas. : ${formatPrix(b.quart_cassier)}</span>`:''}`;
      ca=`<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-sm pill-vert" onclick="entreeStock(${b.id},'cassier')">⨝ +1 cas.</button><button class="btn btn-sm pill-orange" onclick="entreeStock(${b.id},'demi')">⨝ +½ cas.</button>${b.type_bouteille==="petit bouteille"?`<button class="btn btn-sm pill-bleu" onclick="entreeStock(${b.id},'quart')">🧪 +¼ cas.</button>`:''}</div>`;
    } else {
      cp=`<strong>${formatPrix(b.prix_unitaire||0)}</strong> / btl`;
      ca=`<div style="display:flex;gap:8px;"><button class="btn btn-sm pill-bleu" onclick="ajusterRetour(${b.id},1)">↺ +1 Retour</button><button class="btn btn-danger btn-sm" style="border-radius:20px;" onclick="ajusterRetour(${b.id},-1)">△  -1 Perte</button></div>`;
    }
    return `<tr class="ligne-stockage"><td class="cell-stockage-nom">${escape(b.designation)}</td><td class="cell-stockage"><span class="tag-type">${lbl}</span></td><td class="cell-stockage" style="text-align:center;"><span class="badge-stock">${b.stock}</span></td><td class="cell-stockage" style="font-size:13px;">${cp}</td><td class="cell-stockage">${ca}</td></tr>`;
  };
  let html='';
  if (grands.length>0) html+=`<tr class="stockage-groupe stockage-groupe-grand"><td colspan="5">👑 GRANDS MODÈLES</td></tr>`+grands.map(gen).join('');
  if (petits.length>0) html+=`<tr class="stockage-groupe stockage-groupe-petit"><td colspan="5">🧪 PETITS MODÈLES</td></tr>`+petits.map(gen).join('');
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
  if (!confirm(`Ajouter ${txt} (${qte} btl) pour ${escape(b.designation)} ?`)) return;
  try {
    const { error:eS } = await client.from('boissons').update({ stock:b.stock+qte }).eq('id', id).eq('bar_id', barActuel.id);
    if (eS) throw eS;
    const { data:cfg } = await client.from('config').select('valeur').eq('cle','total_fournisseur').eq('bar_id', barActuel.id).single();
    const nv=(cfg?parseInt(cfg.valeur)||0:0)+cout;
    await client.from('config').update({ valeur:nv.toString() }).eq('cle','total_fournisseur').eq('bar_id', barActuel.id);
    const existing=commandeEnCours.find(c=>c.designation===b.designation&&c.type===txt);
    if (existing) { existing.qte+=qte; existing.cout+=cout; }
    else commandeEnCours.push({ designation:b.designation, type:txt, qte, cout });
    toast(`✅ +${qte} btl ${escape(b.designation)}`); await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function ajusterRetour(id, delta) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  if (delta<0&&b.stock<=0) { alert(`❌ Stock de ${escape(b.designation)} déjà à 0.`); return; }
  const qpc = b.quantite_par_cassier||(b.type_bouteille==="petit bouteille"?24:12);
  const pAchat = b.pu_initial>0?Math.round(b.pu_initial/qpc):0;
  if (delta<0&&pAchat===0) { alert(`❌ Prix d'achat non configuré pour ${escape(b.designation)}.`); return; }
  const typeOp = delta>0?`↺ RETOUR CLIENT : ${escape(b.designation)}`:`△  PERTE/CASSE : ${escape(b.designation)}`;
  const tImpact = delta>0?-(b.prix_unitaire):0;
  const bImpact = delta>0?-(b.prix_unitaire-pAchat):-pAchat;
  const msg = delta>0?`Retour client : ${escape(b.designation)}. Stock +1, vente déduite (${formatPrix(b.prix_unitaire)}).`:`Perte/casse : ${escape(b.designation)}. Stock -1, perte ${formatPrix(pAchat)}.`;
  if (!confirm(msg)) return;
  try {
    const { error: eS } = await client.from('boissons').update({ stock: b.stock+delta }).eq('id', id); if (eS) throw eS;
    const { data: tr, error: eH } = await client.from('ventes').insert([{bar_id: barActuel.id, total:tImpact, benefice:bImpact, benef:bImpact, note:''}]).select().single(); if (eH) throw eH;
    await client.from('vente_articles').insert([{ vente_id:tr.id, boisson_designation:typeOp, quantite:1, prix_unitaire:tImpact }]);
    toast(delta>0?'↺ Retour enregistré':'📉 Perte enregistrée', delta>0?'info':'warning');
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
    const affP = b.prix_unitaire>0?`<strong>${formatPrix(b.prix_unitaire)}</strong>`:`<span style="color:#ef6c00;">À définir <button class="btn btn-sm" onclick="modifierPrixUnitaire(${b.id})">⋯</button></span>`;
    return `<div class="produit-vente-card"><div class="produit-vente-infos"><div class="produit-vente-nom">${escape(b.designation)}</div><div class="produit-vente-stock">Reste : <span>${b.stock}</span> btl(s)</div><div class="produit-vente-prix">${affP}</div></div><div class="produit-vente-actions"><button class="btn btn-sm" onclick="modifierPanier(${b.id},-1)">−</button><input type="number" class="qte-input" id="qte-${b.id}" value="${qte}" min="0" max="${b.stock}" onchange="saisirQuantiteDirecte(${b.id},this.value,${b.stock})" onfocus="this.select()"><button class="btn btn-sm" onclick="modifierPanier(${b.id},1)">+</button></div></div>`;
  }).join('');
}

function modifierPanier(id, delta) {
  const b = boissons.find(i => i.id===id); if (!b) return;
  if (b.prix_unitaire<=0&&delta>0) { alert(`❌ Fixe d'abord le prix de ${escape(b.designation)}.`); return; }
  const nv = Math.max(0, Math.min(b.stock, (panier[id]||0)+delta));
  if (nv===0) delete panier[id]; else panier[id]=nv;
  const el = document.getElementById(`qte-${id}`); if (el) el.value=nv;
  mettreAJourTicket();
}

function saisirQuantiteDirecte(id, valeur, stockDispo) {
  let qte = parseInt(valeur); if (isNaN(qte)||qte<0) qte=0;
  if (qte>stockDispo) { alert(`△  Stock insuffisant ! Max : ${stockDispo}`); qte=stockDispo; }
  const b = boissons.find(i => i.id===id); if (!b) return;
  if (b.prix_unitaire<=0&&qte>0) { alert(`❌ Fixe d'abord le prix de ${escape(b.designation)}.`); afficherVentes(); return; }
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
    html += `<li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #ddd;font-size:14px;"><span><strong>${escape(b.designation)}</strong> × ${qte}</span><span>${formatPrix(sous)}</span></li>`;
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
  if (Object.keys(panier).length===0) { toast('△  Panier vide !','warning'); return; }
  let total=0, html='';
  for (const id in panier) {
    const b = boissons.find(i => i.id==id); if (!b) continue;
    const sous=b.prix_unitaire*panier[id]; total+=sous;
    html+=`<div class="modal-recap-ligne"><span>${escape(b.designation)} × ${panier[id]}</span><span>${formatPrix(sous)}</span></div>`;
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
  const note = (document.getElementById('note-vente')?.value || '').trim();
  fermerModalVente();
  await validerVente(note);
}

async function validerVente(note = '') {
  if (Object.keys(panier).length===0) return;
  const ids = Object.keys(panier).map(Number);
  const { data: stockFrais } = await client.from('boissons').select('id, stock, designation').in('id', ids).eq('bar_id', barActuel.id);
  const stockMap = {};
  (stockFrais || []).forEach(s => { stockMap[s.id] = s.stock; });

  // On ne bloque pas tout, mais on n'encaisse pas non plus automatiquement :
  // le ticket est corrigé et on laisse la serveuse revoir/valider (le client peut vouloir changer de boisson).
  const ajustements = [];
  for (const id in panier) {
    const dispo = stockMap[id];
    if (dispo === undefined) continue;
    if (panier[id] > dispo) {
      const b = boissons.find(i => i.id == id);
      const nom = b ? b.designation : (stockFrais.find(s=>s.id==id)?.designation || 'article');
      if (dispo <= 0) { ajustements.push(`${nom} retiré (stock épuisé)`); delete panier[id]; }
      else { ajustements.push(`${nom} réduit à ${dispo}`); panier[id] = dispo; }
    }
  }
  if (ajustements.length > 0) {
    if (Object.keys(panier).length === 0) {
      toast('❌ Plus aucun article disponible dans ce ticket', 'error');
      await initialiserApplication();
      return;
    }
    toast('△  Ticket ajusté, vérifie avant de valider : ' + ajustements.join(' • '), 'warning');
    rafrachirVueActive();
    ouvrirModalVente(); // rouvre le récap avec le ticket corrigé, pour validation manuelle
    const noteEl = document.getElementById('note-vente');
    if (noteEl && note) noteEl.value = note; // on ne perd pas ce qui était déjà tapé
    return;
  }
  if (Object.keys(panier).length === 0) {
    toast('❌ Plus aucun article disponible dans ce ticket', 'error');
    await initialiserApplication();
    return;
  }

  let tv=0, tb=0; const arts=[];
  for (const id in panier) {
    const qte=panier[id], b=boissons.find(i=>i.id==id); if (!b) continue;
    const qpc=b.quantite_par_cassier||(b.type_bouteille==="petit bouteille"?24:12);
    const aU=b.pu_initial>0?Math.round(b.pu_initial/qpc):0;
    tv+=b.prix_unitaire*qte; tb+=(b.prix_unitaire-aU)*qte;
    arts.push({ id:b.id, designation:b.designation, quantite:qte, prix_unitaire:b.prix_unitaire, stockActuel: stockMap[id] ?? b.stock });
  }
  try {
    const { data: tr, error } = await client.from('ventes')
      .insert([{ total:tv, benefice:tb, benef:tb, bar_id:barActuel.id, note: note || null, serveuse: utilisateurActuel?.nom || null }])
      .select().single();
    if (error) throw error;
    for (const art of arts) {
      await client.from('vente_articles').insert([{ vente_id:tr.id, boisson_designation:art.designation, quantite:art.quantite, prix_unitaire:art.prix_unitaire, bar_id:barActuel.id }]);
      const { data: nouveauStock, error: eStock } = await client.rpc('decrementer_stock_boisson', {
        p_boisson_id: art.id, p_bar_id: barActuel.id, p_quantite: art.quantite
      });
      if (eStock) {
        // Cas extrême : le stock a encore bougé entre la vérification et l'écriture.
        toast(`❌ ${escape(art.designation)} non disponible au dernier moment, vente partielle enregistrée`, 'error');
      } else {
        const bb = boissons.find(i => i.id === art.id); if (bb) bb.stock = nouveauStock;
      }
    }
    const noteEl = document.getElementById('note-vente');
    if (noteEl) noteEl.value = '';
    toast('✅ Vente enregistrée ! '+formatPrix(tv)); panier={};
    await initialiserApplication();
  } catch (err) { toast('❌ Erreur vente : '+err.message,'error'); }
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
      <div class="stat-box" style="border-left-color:#1565c0;"><div class="stat-label">Chiffre d'affaires (ventes uniquement)</div><div class="stat-value vert">${formatPrix(totalCA)}</div></div>
      <div class="stat-box" style="border-left-color:#2e7d32;"><div class="stat-label">Bénéfice Net (après pertes/retours)</div><div class="stat-value ${totalBenef<0?'rouge':'vert'}">${formatPrix(totalBenef)}</div></div>
      <div class="stat-box" style="border-left-color:#ef6c00;"><div class="stat-label">Total Pertes & Retours</div><div class="stat-value orange">${formatPrix(totalPertes)}</div></div>`;
  }
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
  if (filtre.length===0) { tbody.innerHTML='<tr><td colspan="6" class="vide">Aucune vente enregistrée.</td></tr>'; return; }
  tbody.innerHTML = filtre.map((v) => {
    const num = historique.length - historique.indexOf(v);
    let det = v.articles&&v.articles.length>0 ? v.articles.map(a=>`${a.nom||'?'} ×${a.qte}`).join(', ') : '—';
    const dU = det.toUpperCase();
    let badge='$ VENTE', ligneClasse='';
    if (dU.includes('PAIEMENT FOURNISSEUR')) { badge=' ACHAT FOURN.'; ligneClasse='ligne-fournisseur'; }
    else if (dU.includes('RETOUR CLIENT')) { badge='↺ RETOUR'; ligneClasse='ligne-retour'; }
    else if (dU.includes('PERTE')||dU.includes('CASSE')) { badge='△  PERTE'; ligneClasse='ligne-perte'; }
    const total=parseInt(v.total)||0, benef=parseInt(v.benef)||0;
    return `<tr class="${ligneClasse}">
      <td style="padding:10px;font-size:13px;"><div style="font-weight:bold;">#${num} <span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:10px;font-size:11px;">${badge}</span></div><div style="margin-top:3px;" class="txt-secondaire">⏱️ ${v.date}</div></td>
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
  const estSombre = document.body.classList.contains('dark');
  graphiqueInstance = new Chart(canvas, {
    type:'bar', data:{ labels, datasets:[
      { label:'CA (FCFA)', data:dCA, backgroundColor:'rgba(46,125,50,0.7)', borderRadius:6 },
      { label:'Bénéfice (FCFA)', data:dB, backgroundColor:'rgba(2,136,209,0.6)', borderRadius:6 }
    ]},
    options:{
      responsive:true,
      plugins:{ legend:{ position:'top', labels:{ color: estSombre ? '#e0e0e0' : '#333' } } },
      scales:{
        y:{ beginAtZero:true, ticks:{ callback:v=>formatPrix(v), color: estSombre ? '#cfd8dc' : '#555' }, grid:{ color: estSombre ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' } },
        x:{ ticks:{ color: estSombre ? '#cfd8dc' : '#555' }, grid:{ color: estSombre ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' } }
      }
    }
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
  toast('⇥ Export Excel téléchargé !');
}

// ==================== RÉINITIALISATIONS ====================
async function reinitialiserVentes() {
  if (!confirm("△  SUPPRIMER TOUT L'HISTORIQUE DES VENTES ?\nAction irréversible.")) return;
  if (!confirm("◍ DERNIÈRE CONFIRMATION — Continuer ?")) return;
  try {
    await client.from('vente_articles').delete().eq('bar_id', barActuel.id);
    await client.from('ventes').delete().eq('bar_id', barActuel.id);
    toast('✅ Historique des ventes supprimé'); panier={}; await initialiserApplication();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function reinitialiserFournisseur() {
  if (!confirm("△  Vider tout l'historique fournisseur ?")) return;
  try {
    await client.from('fournisseur_historique').delete().eq('bar_id', barActuel.id);
    toast('✅ Historique fournisseur vidé'); await chargerEspaceFournisseur();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function reinitialiserVentesServeuse() {
  if (!confirm("△  Réinitialiser les ventes de toutes les serveuses ?")) return;
  toast('Fonctionnalité à configurer selon le besoin.', 'warning');
}

// ==================== FOURNISSEUR ====================
async function enregistrerLivraisonFournisseur() {
  const montantStr = document.getElementById('fourn-montant-livraison')?.value;
  const detail = document.getElementById('fourn-detail-livraison')?.value?.trim();
  const montant = parseInt(montantStr);
  if (!montant||montant<=0) { toast('❌ Montant invalide !','error'); return; }
  if (!detail) { toast('△  Ajoute un détail de livraison !','warning'); return; }
  try {
    const { error } = await client.from('fournisseur_historique').insert([
      { bar_id: barActuel.id, type_action: 'LIVRAISON', montant, commentaire: detail },
      { bar_id: barActuel.id, type_action: 'PAIEMENT', montant, commentaire: 'Payé à la livraison — '+detail }
    ]);
    if (error) throw error;
    document.getElementById('fourn-montant-livraison').value='';
    document.getElementById('fourn-detail-livraison').value='';
    toast('✅ Livraison enregistrée et payée !'); await chargerEspaceFournisseur();
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function chargerEspaceFournisseur() {
  const { data: hist, error } = await client.from('fournisseur_historique').select('*').eq('bar_id', barActuel.id).order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  const livraisons = (hist||[]).filter(h => h.type_action === 'LIVRAISON');
  const totalLivre = livraisons.reduce((s,h) => s + h.montant, 0);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  set('fourn-total-livre', formatPrix(totalLivre));
  set('fournisseur-bilan-paye', formatPrix(totalLivre));
  const tbL = document.getElementById('fourn-livraisons-rows');
  if (tbL) {
    if (livraisons.length === 0) {
      tbL.innerHTML = '<tr><td colspan="3" class="vide">Aucune livraison enregistrée.</td></tr>';
    } else {
      tbL.innerHTML = livraisons.map(h => `
        <tr>
          <td style="padding:10px;">${h.created_at ? new Date(h.created_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '-'}</td>
          <td style="padding:10px;" class="txt-secondaire">${escape(h.commentaire||'-')}</td>
          <td style="padding:10px;font-weight:bold;color:#2e7d32;">${formatPrix(h.montant)}</td>
        </tr>`).join('');
    }
  }
}

async function envoyerTotalVersHistoriqueFournisseur() {
  try {
    const { data:cfg } = await client.from('config').select('valeur').eq('cle','total_fournisseur').eq('bar_id', barActuel.id).single();
    const montant = cfg?parseInt(cfg.valeur)||0:0;
    if (montant<=0) { toast('△  Montant à 0 FCFA, rien à transférer.','warning'); return; }
    let recapLignes = '', recapTexte = '';
    if (commandeEnCours.length > 0) {
      recapLignes = commandeEnCours.map(c => `<tr><td style="padding:7px 10px;">${escape(c.designation)}</td><td style="padding:7px 10px;">${escape(c.type)}</td><td style="padding:7px 10px;text-align:right;">${c.qte} btl</td><td style="padding:7px 10px;text-align:right;font-weight:bold;color:#2e7d32;">${formatPrix(c.cout)}</td></tr>`).join('');
      recapTexte = commandeEnCours.map(c => `${c.designation} (${c.type}, ${c.qte} btl) : ${formatPrix(c.cout)}`).join(' | ');
    } else {
      recapLignes = `<tr><td colspan="4" style="padding:10px;color:#888;font-style:italic;">Commande sans détail enregistré</td></tr>`;
      recapTexte = 'Approvisionnement stock';
    }
    const modal = document.getElementById('modal-confirm-vente');
    const contenu = document.getElementById('modal-recap-contenu');
    const titre = modal?.querySelector('.modal-title');
    const btnConfirmer = modal?.querySelector('.modal-btns .btn:last-child');
    if (titre) titre.innerHTML = '⨝ Confirmer la livraison fournisseur';
    if (contenu) contenu.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">
        <thead><tr style="background:#e8f5e9;"><th style="padding:7px 10px;text-align:left;">Boisson</th><th style="padding:7px 10px;text-align:left;">Format</th><th style="padding:7px 10px;text-align:right;">Qté</th><th style="padding:7px 10px;text-align:right;">Coût</th></tr></thead>
        <tbody>${recapLignes}</tbody>
      </table>
      <div class="modal-recap-ligne" style="margin-top:4px;"><span>TOTAL LIVRAISON</span><span style="color:#2e7d32;">${formatPrix(montant)}</span></div>`;
    if (btnConfirmer) {
      btnConfirmer.innerText = '✅ Valider la livraison';
      btnConfirmer.onclick = async () => {
        fermerModalVente();
        const commentaire = recapTexte || 'Approvisionnement stock';
        try {
          await client.from('fournisseur_historique').insert([{ type_action: 'LIVRAISON', montant, commentaire, bar_id: barActuel.id }]);
          await client.from('config').update({ valeur:'0' }).eq('cle','total_fournisseur').eq('bar_id', barActuel.id);
          commandeEnCours = [];
          toast('✅ Livraison enregistrée !');
          await initialiserApplication();
          showSection('historique');
        } catch(err) { toast('❌ '+err.message,'error'); }
      };
    }
    const btnAnnuler = modal?.querySelector('.modal-btns .btn-danger');
    if (btnAnnuler) btnAnnuler.onclick = () => {
      fermerModalVente();
      if (btnConfirmer) { btnConfirmer.innerText = '✅ Encaisser'; btnConfirmer.onclick = confirmerVenteFinale; }
    };
    modal?.classList.add('visible');
  } catch (err) { toast('❌ '+err.message,'error'); }
}

async function modifierPrixTotalFournisseurStockage() {
  try {
    const { data:cfg } = await client.from('config').select('valeur').eq('cle','total_fournisseur').eq('bar_id', barActuel.id).single();
    const actuel = cfg ? parseInt(cfg.valeur)||0 : 0;
    const modal = document.getElementById('modal-confirm-vente');
    const contenu = document.getElementById('modal-recap-contenu');
    const titre = modal?.querySelector('.modal-title');
    const btnConf = modal?.querySelector('.modal-btns .btn:last-child');
    const btnAnn = modal?.querySelector('.modal-btns .btn-danger');
    if (titre) titre.innerHTML = '⋯ Modifier le montant fournisseur';
    if (contenu) contenu.innerHTML = `
      <div style="margin-bottom:12px;font-size:14px;" class="txt-secondaire">Montant actuel : <strong>${formatPrix(actuel)}</strong></div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <label style="font-size:13px;font-weight:600;">Nouveau montant (FCFA)</label>
        <input type="number" id="input-nouveau-montant" value="${actuel}" min="0" style="padding:10px;border:2px solid #ddd;border-radius:8px;font-size:16px;width:100%;">
      </div>`;
    if (btnAnn) { btnAnn.style.display=''; btnAnn.innerText='✖ Annuler'; btnAnn.onclick = () => { fermerModalVente(); if(btnConf){btnConf.innerText='✅ Encaisser';btnConf.onclick=confirmerVenteFinale;} }; }
    if (btnConf) {
      btnConf.innerText = '※ Enregistrer';
      btnConf.onclick = async () => {
        const nv = parseInt(document.getElementById('input-nouveau-montant').value);
        if (isNaN(nv) || nv < 0) { toast('❌ Montant invalide.','error'); return; }
        fermerModalVente();
        await client.from('config').update({ valeur: nv.toString() }).eq('cle','total_fournisseur').eq('bar_id', barActuel.id);
        const el = document.getElementById('total-fournisseur-stockage');
        if (el) el.innerText = formatPrix(nv);
        toast('✅ Montant mis à jour');
        if(btnConf){btnConf.innerText='✅ Encaisser';btnConf.onclick=confirmerVenteFinale;}
      };
    }
    modal?.classList.add('visible');
    setTimeout(() => document.getElementById('input-nouveau-montant')?.focus(), 100);
  } catch(err) { toast('❌ '+err.message,'error'); }
}

// ==================== PDF & WHATSAPP ====================
function telechargerPDFVentes() {
  const table = document.getElementById('historique-ventes-rows')?.closest('table'); if (!table) return;
  const ventesSeules = historique.filter(v => !estSpecial(v));
  const pertesRetours = historique.filter(v => { const d=(v.articles||[]).map(a=>a.nom||'').join(' ').toUpperCase(); return d.includes('RETOUR')||d.includes('PERTE')||d.includes('CASSE'); });
  const totalCA = ventesSeules.reduce((s,v)=>s+(parseInt(v.total)||0),0);
  const totalBenef = historique.reduce((s,v)=>s+(parseInt(v.benef)||0),0);
  const totalPertes = pertesRetours.reduce((s,v)=>s+Math.abs(parseInt(v.benef)||0),0);
  const recapHTML = `<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;"><div style="flex:1;min-width:130px;background:#e8f5e9;padding:14px;border-radius:8px;text-align:center;border-left:5px solid #2e7d32;"><div style="font-size:12px;color:#555;text-transform:uppercase;">Chiffre d'Affaires</div><div style="font-size:20px;font-weight:bold;color:#2e7d32;">${formatPrix(totalCA)}</div></div><div style="flex:1;min-width:130px;background:#e3f2fd;padding:14px;border-radius:8px;text-align:center;border-left:5px solid #0288d1;"><div style="font-size:12px;color:#555;text-transform:uppercase;">Bénéfice Net</div><div style="font-size:20px;font-weight:bold;color:${totalBenef<0?'#c62828':'#0288d1'};">${formatPrix(totalBenef)}</div></div><div style="flex:1;min-width:130px;background:#fff3e0;padding:14px;border-radius:8px;text-align:center;border-left:5px solid #ef6c00;"><div style="font-size:12px;color:#555;text-transform:uppercase;">Total Pertes & Retours</div><div style="font-size:20px;font-weight:bold;color:#ef6c00;">${formatPrix(totalPertes)}</div></div></div>`;
  const html=`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;padding:20px;}table{width:100%;border-collapse:collapse;}th,td{padding:9px;border:1px solid #ccc;}th{background:#f0f0f0;}h2{color:#2e7d32;}</style></head><body><h2>⇥ Historique des Ventes — Consensus BarStock</h2><p style="color:#888;">Généré le : ${new Date().toLocaleString('fr-FR')}</p>${recapHTML}${table.outerHTML}</body></html>`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download=`ventes_${new Date().toISOString().slice(0,10)}.html`; a.click();
  toast('↡PDF ventes téléchargé');
}

function telechargerPDFFournisseur() {
  const tL=document.getElementById('fourn-livraisons-rows')?.closest('table');
  const totalL=document.getElementById('fourn-total-livre')?.innerText||'';
  const totalP=document.getElementById('fournisseur-bilan-paye')?.innerText||'';
  const html=`<html><head><meta charset="UTF-8"><style>body{font-family:Arial}table{width:100%;border-collapse:collapse;margin-bottom:20px}th,td{padding:8px;border:1px solid #ccc}th{background:#f0f0f0}h2{color:#2e7d32}</style></head><body><h2>🏪 Suivi Fournisseur</h2><p>Date : ${new Date().toLocaleString('fr-FR')}</p><p>Total Livré : <strong>${totalL}</strong> | Total Payé : <strong>${totalP}</strong></p><h3>⨝ Livraisons</h3>${tL?tL.outerHTML:''}</body></html>`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download=`fournisseur_${new Date().toISOString().slice(0,10)}.html`; a.click();
  toast('↡ PDF fournisseur téléchargé');
}

function envoyerWhatsAppVentes() {
  const rows=document.querySelectorAll('#historique-ventes-rows tr');
  let lignes='';
  rows.forEach(r=>{ const c=r.querySelectorAll('td'); if(c.length>=3) lignes+=`• ${c[0].innerText.replace(/\n/g,' ')} — ${c[2].innerText}\n`; });
  const ventesSeules = historique.filter(v => !estSpecial(v));
  const totalCA = ventesSeules.reduce((s,v)=>s+(parseInt(v.total)||0),0);
  const totalBenef = historique.reduce((s,v)=>s+(parseInt(v.benef)||0),0);
  const stats = `\n ↠CA Ventes : ${formatPrix(totalCA)}\n ↠Bénéfice Net : ${formatPrix(totalBenef)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent('*RÉCAPITULATIF VENTES CAISSE*\n\n'+lignes+stats+'\n\nDate : '+new Date().toLocaleDateString('fr-FR'))}`, '_blank');
}

function envoyerWhatsAppFournisseur() {
  const tL=document.getElementById('fourn-total-livre')?.innerText||'';
  const tP=document.getElementById('fournisseur-bilan-paye')?.innerText||'';
  const rowsL=document.querySelectorAll('#fourn-livraisons-rows tr');
  let livs='';
  rowsL.forEach(r=>{ const c=r.querySelectorAll('td'); if(c.length>=2) livs+=`• ${c[0].innerText} — ${c[2].innerText}\n`; });
  const msg=`*SUIVI FOURNISSEUR*\n\nLivraisons :\n${livs}\n↠ Total Livré : ${tL}\n↠ Total Payé : ${tP}\nDate : ${new Date().toLocaleDateString('fr-FR')}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

// ==================== COMMANDES ====================
async function ouvrirNouvelleCommande() {
  const table = document.getElementById('cmd-table')?.value.trim();
  const clientNom = document.getElementById('cmd-client')?.value.trim();
  if (!table) { toast('△  Indique un numéro de table', 'warning'); return; }
  const { data, error } = await client.from('commandes').insert([{ bar_id: barActuel.id, table_num: table, client_nom: clientNom || null, statut: 'ouverte', articles: [], total: 0, serveuse: utilisateurActuel?.role === 'gerant' ? null : (utilisateurActuel?.nom || null) }]).select().single();
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  document.getElementById('cmd-table').value = '';
  document.getElementById('cmd-client').value = '';
  toast('✅ Commande ouverte — ' + table);
  await chargerCommandes();
  ouvrirModalCommande(data);
}

async function chargerCommandes() {
  let query = client.from('commandes').select('*').eq('bar_id', barActuel.id).eq('statut', 'ouverte').order('created_at', { ascending: true });
  if (utilisateurActuel?.role !== 'gerant') {
    query = query.eq('serveuse', utilisateurActuel?.nom || '');
  }
  const { data, error } = await query;
  if (error) { console.error(error); return; }
  commandesOuvertes = data || [];
  afficherCommandes();
}

function afficherCommandes() {
  const div = document.getElementById('commandes-liste'); if (!div) return;
  if (commandesOuvertes.length === 0) { div.innerHTML = '<div style="text-align:center;color:#aaa;padding:30px;">Aucune commande ouverte</div>'; return; }
  div.innerHTML = commandesOuvertes.map(cmd => {
    const articles = cmd.articles || [];
    const duree = dureeDepuis(cmd.created_at);
    const detail = articles.length > 0 ? articles.map(a => `${escape(a.designation)} x${a.qte}`).join(', ') : 'Aucun article';
    const label = cmd.client_nom ? `${escape(cmd.table_num)} — ${escape(cmd.client_nom)}` : escape(cmd.table_num);
    const badgeServeuse = (utilisateurActuel?.role === 'gerant' && cmd.serveuse) ? `<span style="margin-left:8px;font-size:11px;background:#eef2ff;color:#3730a3;padding:2px 7px;border-radius:10px;">👤 ${escape(cmd.serveuse)}</span>` : '';
    return `<div class="carte-commande">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div><span style="font-weight:700;font-size:15px;">${label}</span>${badgeServeuse}<span style="margin-left:10px;font-size:12px;" class="txt-secondaire">⏱️ ${duree}</span></div>
        <span style="font-weight:700;color:#1a6b3a;font-size:15px;">${formatPrix(cmd.total)}</span>
      </div>
      <div style="font-size:13px;margin-bottom:10px;" class="txt-secondaire">${detail}</div>
      ${cmd.note ? `<div style="font-size:12px;color:#0288d1;font-style:italic;margin-bottom:8px;">📝 ${escape(cmd.note)}</div>` : ''}
      <div style="display:flex;gap:8px;">
        <button class="btn" style="flex:1;" onclick="ouvrirModalCommande(commandesOuvertes.find(c=>c.id==${cmd.id}))">⋯ Modifier</button>
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

function fermerModalCommande() { document.getElementById('modal-commande').classList.remove('visible'); commandeActive = null; }

function afficherArticlesCommande() {
  const div = document.getElementById('modal-cmd-articles'); if (!div || !commandeActive) return;
  const articles = commandeActive.articles || [];
  if (articles.length === 0) { div.innerHTML = '<div style="color:#aaa;font-size:13px;margin-bottom:8px;">Aucun article ajouté</div>'; return; }
  const total = articles.reduce((s, a) => s + a.prix * a.qte, 0);
  div.innerHTML = `<div class="bloc-articles-commande">${articles.map((a, i) => `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;"><span style="font-size:13px;">${escape(a.designation)} × ${a.qte}</span><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:13px;font-weight:600;">${formatPrix(a.prix * a.qte)}</span><button onclick="retirerArticleCommande(${i})" style="background:#c62828;color:white;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:12px;">✖</button></div></div>`).join('')}<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-weight:700;display:flex;justify-content:space-between;"><span>Total</span><span style="color:#1a6b3a;">${formatPrix(total)}</span></div></div>`;
}

function filtrerBoissonsCommande() { const q = document.getElementById('modal-cmd-search')?.value || ''; afficherBoissonsCommande(q); }

function afficherBoissonsCommande(recherche) {
  const div = document.getElementById('modal-cmd-boissons'); if (!div) return;
  const terme = recherche.toLowerCase();
  const fil = boissons.filter(b => b.stock > 0 && b.designation.toLowerCase().includes(terme)) .sort((a,b) => a.designation.localeCompare(b.designation));   // ← tri alphabétique;
  
  if (fil.length === 0) { div.innerHTML = '<div style="color:#aaa;font-size:13px;">Aucune boisson disponible</div>'; return; }
  div.innerHTML = fil.map(b => `<button onclick="ajouterArticleCommande(${b.id})" class="btn-choix-boisson"><div style="font-weight:600;">${escape(b.designation)}</div><div style="${b.prix_unitaire>0?'color:#1a6b3a;':'color:#ef6c00;font-style:italic;'}">${b.prix_unitaire>0?formatPrix(b.prix_unitaire):'Prix à définir'}</div><div style="color:#888;">Stock: ${b.stock}</div></button>`).join('');
}

// ==================== COMMANDES (CORRIGÉ) ====================

async function ajouterArticleCommande(id) {
  if (!commandeActive) return;
  const b = boissons.find(i => i.id === id);
  if (!b) return;

  if (b.stock <= 0) {
    toast(`△  Stock insuffisant pour ${escape(b.designation)}`, 'warning');
    return;
  }

  if (!(b.prix_unitaire > 0)) {
    alert(`❌ Fixe d'abord le prix de ${escape(b.designation)}.`);
    return;
  }

  // Décrément atomique côté serveur : vérifie le VRAI stock au moment du clic,
  // même si une autre serveuse est en train de faire la même chose ailleurs.
  const { data: nouveauStock, error } = await client.rpc('decrementer_stock_boisson', {
    p_boisson_id: id, p_bar_id: barActuel.id, p_quantite: 1
  });
  if (error) {
    toast(`❌ Stock insuffisant pour ${escape(b.designation)} (pris entre-temps par une autre commande)`, 'error');
    const { data: frais } = await client.from('boissons').select('stock').eq('id', id).eq('bar_id', barActuel.id).single();
    if (frais) b.stock = frais.stock;
    afficherBoissonsCommande(document.getElementById('modal-cmd-search')?.value || '');
    return;
  }

  b.stock = nouveauStock;

  const articles = commandeActive.articles || [];
  const existe = articles.find(a => a.id === id);
  if (existe) { existe.qte += 1; }
  else { articles.push({ id: b.id, designation: b.designation, prix: b.prix_unitaire, qte: 1 }); }

  commandeActive.articles = articles;
  commandeActive.total = articles.reduce((s, a) => s + a.prix * a.qte, 0);

  afficherArticlesCommande();
  afficherBoissonsCommande(document.getElementById('modal-cmd-search')?.value || '');
}

async function retirerArticleCommande(index) {
  if (!commandeActive) return;
  const articles = commandeActive.articles || [];
  const article = articles[index];
  if (!article) return;

  const b = boissons.find(i => i.id === article.id);
  if (b) {
    const { data: nouveauStock, error } = await client.rpc('incrementer_stock_boisson', {
      p_boisson_id: article.id, p_bar_id: barActuel.id, p_quantite: 1
    });
    if (!error && nouveauStock != null) b.stock = nouveauStock; else b.stock += 1;
  }

  if (article.qte > 1) { article.qte -= 1; }
  else { articles.splice(index, 1); }

  commandeActive.total = articles.reduce((s, a) => s + a.prix * a.qte, 0);

  afficherArticlesCommande();
  afficherBoissonsCommande(document.getElementById('modal-cmd-search')?.value || '');
}
async function sauvegarderCommande() {
  if (!commandeActive) return;
  const note = document.getElementById('modal-cmd-note')?.value.trim() || null;

  const { error } = await client.from('commandes')
    .update({ articles: commandeActive.articles, total: commandeActive.total, note })
    .eq('id', commandeActive.id);
  if (error) { toast('❌ ' + error.message, 'error'); return; }

  toast('※ Commande sauvegardée !');
  document.getElementById('modal-commande').classList.remove('visible');
  await chargerCommandes();
}

function fermerModalCommande() {
  document.getElementById('modal-commande').classList.remove('visible');
  commandeActive = null;
}

async function encaisserCommandeId(id) { const cmd = commandesOuvertes.find(c => c.id === id); if (cmd) { commandeActive = cmd; await encaisserCommande(); } }

async function encaisserCommande() {
  if (!commandeActive) return;
  const cmdId = commandeActive.id;
  const cmdArticles = [...commandeActive.articles];
  const cmd = commandeActive;

  if (!cmdArticles || cmdArticles.length === 0) {
    toast('△  Aucun article dans la commande', 'warning');
    return;
  }

  // Sauvegarder d'abord
  const note = document.getElementById('modal-cmd-note')?.value.trim() || null;
  const label = cmd.client_nom ? `${cmd.table_num} — ${cmd.client_nom}` : cmd.table_num;
  await client.from('commandes')
    .update({ articles: cmdArticles, total: cmd.total, note: note || label })
    .eq('id', cmdId);

  // Calculer total et bénéfice
  let total = 0, benef = 0;
  for (const a of cmdArticles) {
    const b = boissons.find(i => i.id === a.id); if (!b) continue;
    const qpc = b.quantite_par_cassier || (b.type_bouteille === 'petit bouteille' ? 24 : 12);
    const achat = b.pu_initial > 0 ? Math.round(b.pu_initial / qpc) : 0;
    total += a.prix * a.qte;
    benef += (a.prix - achat) * a.qte;
  }

  try {
    // Enregistrer la vente
    const { data: vente, error: eV } = await client.from('ventes')
      .insert([{ bar_id: barActuel.id, total, benefice: benef, benef,
        note: note || label, serveuse: utilisateurActuel?.nom || null }])
      .select().single();
    if (eV) throw eV;

    // Enregistrer les articles — stock déjà décompté à l'ajout
    for (const a of cmdArticles) {
      await client.from('vente_articles').insert([{
        vente_id: vente.id, bar_id: barActuel.id,
        boisson_designation: a.designation,
        quantite: a.qte, prix_unitaire: a.prix
      }]);
    }

    // Fermer la commande
    await client.from('commandes').update({ statut: 'payee' }).eq('id', cmdId);

    fermerModalCommande();
    toast('✅ Commande encaissée — ' + formatPrix(total));
    await initialiserApplication();
    await chargerCommandes();

  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

async function annulerCommande(id) {
  if (!confirm('Annuler cette commande ?')) return;

  // Récupérer la commande pour remettre le stock (incrément atomique)
  const cmd = commandesOuvertes.find(c => c.id === id);
  if (cmd && cmd.articles && cmd.articles.length > 0) {
    for (const a of cmd.articles) {
      const { data: nouveauStock, error } = await client.rpc('incrementer_stock_boisson', {
        p_boisson_id: a.id, p_bar_id: barActuel.id, p_quantite: a.qte
      });
      if (!error && nouveauStock != null) {
        const b = boissons.find(i => i.id === a.id);
        if (b) b.stock = nouveauStock;
      }
    }
  }

  const { error } = await client.from('commandes')
    .update({ statut: 'annulee' }).eq('id', id);
  if (error) { toast('❌ ' + error.message, 'error'); return; }

  toast('🗑️ Commande annulée — stock remis à jour');
  await initialiserApplication();
  await chargerCommandes();
}

function mettreAJourBadgeCommandes() {
  const badge = document.getElementById('badge-commandes'); if (!badge) return;
  const nb = commandesOuvertes.length;
  badge.style.display = nb === 0 ? 'none' : 'inline';
  if (nb > 0) badge.textContent = nb;
}

function ouvrirModalEnvoyerTable() {
  if (Object.keys(panier).length === 0) { toast('△  Panier vide !', 'warning'); return; }
  if (commandesOuvertes.length === 0) { toast('△  Aucune table ouverte', 'warning'); return; }
  const div = document.getElementById('modal-tables-liste');
  if (div) {
    div.innerHTML = commandesOuvertes.map(cmd => {
     const label = cmd.client_nom ? `${escape(cmd.table_num)} — ${escape(cmd.client_nom)}` : escape(cmd.table_num);
      const nb = (cmd.articles || []).reduce((s, a) => s + a.qte, 0);
      return `<button onclick="envoyerPanierVersTable(${cmd.id})" class="btn-choix-table"><strong>${label}</strong><span style="float:right;color:#888;font-size:12px;">${nb} article(s) — ${formatPrix(cmd.total)}</span></button>`;
    }).join('');
  }
  document.getElementById('modal-choisir-table').classList.add('visible');
}

function fermerModalTable() { document.getElementById('modal-choisir-table').classList.remove('visible'); }

async function envoyerPanierVersTable(cmdId) {
  const cmd = commandesOuvertes.find(c => c.id === cmdId); if (!cmd) return;
  const articles = [...(cmd.articles || [])];
  for (const id in panier) {
    const b = boissons.find(i => i.id == id); if (!b) continue;
    const existe = articles.find(a => a.id == id);
    if (existe) { existe.qte += panier[id]; } else { articles.push({ id: b.id, designation: b.designation, prix: b.prix_unitaire, qte: panier[id] }); }
  }
  const total = articles.reduce((s, a) => s + a.prix * a.qte, 0);
  const { error } = await client.from('commandes').update({ articles, total }).eq('id', cmdId);
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  fermerModalTable(); panier = {}; mettreAJourTicket();
  toast('✅ Articles ajoutés à la table !');
  await chargerCommandes();
}

// ==================== DÉMARRAGE ====================
// ==================== DÉMARRAGE (VERSION CORRIGÉE) ====================
document.addEventListener("DOMContentLoaded", () => {

  appliquerDarkMode();
  gererConnexion();

  // Attacher les événements une fois le DOM prêt
  const sCat = document.getElementById('search-catalogue');
  if (sCat) sCat.addEventListener('input', afficherCatalogue);

  const sVen = document.getElementById('search-ventes');
  if (sVen) sVen.addEventListener('input', afficherVentes);

  // Connexion avec Enter
  const connEmail = document.getElementById('conn-email');
  const connPassword = document.getElementById('conn-password');
  if (connEmail) connEmail.addEventListener('keydown', e => { if (e.key === 'Enter') seConnecter(); });
  if (connPassword) connPassword.addEventListener('keydown', e => { if (e.key === 'Enter') seConnecter(); });

  // Bouton connexion (sécurité supplémentaire)
  const btnConn = document.getElementById('btn-connexion');
  if (btnConn) btnConn.addEventListener('click', seConnecter);

  setInterval(() => { 
    if (document.getElementById('commandes')?.classList.contains('active')) afficherCommandes(); 
  }, 30000);

  restaurerSession();
});

// ==================== RÔLES & SERVEUSES ====================
function afficherEcranRole() {
  document.getElementById('ecran-auth').style.display = 'none';
  document.getElementById('app-principale').style.display = 'none';
  document.getElementById('ecran-admin').style.display = 'none';
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
  if (!pin || pin.length < 4) { if(errEl){errEl.textContent='PIN trop court (4 min)';errEl.style.display='block';} return; }

  const { data: ok, error } = await client.rpc('verifier_pin_gerant', { p_bar_id: barActuel.id, p_pin: pin });

  if (error) { if (errEl) { errEl.textContent = 'Erreur : ' + error.message; errEl.style.display = 'block'; } return; }

  if (ok === null) {
    // Aucun PIN défini pour ce bar : on en crée un
    const { error: defErr } = await client.rpc('definir_pin_gerant', { p_bar_id: barActuel.id, p_pin: pin });
    if (defErr) { if (errEl) { errEl.textContent = 'Erreur : ' + defErr.message; errEl.style.display = 'block'; } return; }
    toast('✅ PIN gérant défini !');
  } else if (!ok) {
    if (errEl) { errEl.textContent = 'PIN incorrect'; errEl.style.display = 'block'; }
    document.getElementById('input-pin-gerant').value = ''; return;
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
  const { data: serveuses } = await client.from('serveuses').select('id, nom').eq('bar_id', barActuel.id).order('nom');
  const div = document.getElementById('liste-serveuses'); if (!div) return;
  if (!serveuses || serveuses.length === 0) {
    div.innerHTML = '<div style="color:#888;font-size:13px;">Aucune serveuse enregistrée.<br>Le gérant doit en ajouter depuis l\'app.</div>';
    return;
  }
  div.innerHTML = serveuses.map(s =>
    `<button data-id="${s.id}" data-nom="${escape(s.nom)}" class="btn-choix-serveuse">👤 ${escape(s.nom)}</button>`
  ).join('');
  div.querySelectorAll('.btn-choix-serveuse').forEach(btn => {
    btn.addEventListener('click', () => {
      selectionnerServeuse(parseInt(btn.dataset.id), btn.dataset.nom);
    });
  });
}

let serveuseSelectionnee = null;
function selectionnerServeuse(id, nom) {
  serveuseSelectionnee = { id, nom };
  document.querySelectorAll('.btn-choix-serveuse').forEach(b => {
    b.classList.toggle('selectionnee', parseInt(b.dataset.id) === id);
  });
  const titre = document.getElementById('titre-pin-serveuse');
  if (titre) titre.textContent = `🔒 Mot de passe de ${nom}`;
  document.getElementById('panel-pin-serveuse').style.display = 'block';
  setTimeout(() => document.getElementById('input-pin-serveuse')?.focus(), 100);
}

async function validerPinServeuse() {
  if (!serveuseSelectionnee) return;
  const pin = document.getElementById('input-pin-serveuse')?.value;
  const errEl = document.getElementById('erreur-pin-serveuse');

  const { data: ok, error } = await client.rpc('verifier_pin_serveuse', { p_serveuse_id: serveuseSelectionnee.id, p_pin: pin });

  if (error || !ok) {
    if (errEl) { errEl.textContent = 'PIN incorrect'; errEl.style.display = 'block'; }
    document.getElementById('input-pin-serveuse').value = ''; return;
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
  if (nomEl) nomEl.innerText = `BarStock - ${barActuel.nom} (${utilisateurActuel.nom})`;
  appliquerRestrictions();
  activerRealtime();
  demarrerSurveillanceInactivite();
  const estGerantMsg = utilisateurActuel?.role === 'gerant';
  const heure = new Date().getHours();
  const salut = heure < 12 ? 'Bonjour' : (heure < 18 ? 'Bon après-midi' : 'Bonsoir');
  toast(`👋 ${salut}, ${estGerantMsg ? 'Gérant' : utilisateurActuel.nom} ! Bienvenue sur BarStock.`);
  initialiserApplication().then(() => {
    const estGerant = utilisateurActuel?.role === 'gerant';
    if (estGerant) { showSection('catalogue'); } else { showSection('ventes'); }
  });
}

function appliquerRestrictions() {
  const estGerant = utilisateurActuel?.role === 'gerant';
  const sectionsGerant = ['etat-stock', 'stockage-recup', 'historique', 'corbeille', 'rapport-serveuses', 'profil'];
  sectionsGerant.forEach(id => { const btn = document.querySelector(`[data-section="${id}"]`); if (btn) btn.style.display = estGerant ? '' : 'none'; });
  document.querySelectorAll('.gerant-only').forEach(el => { el.style.display = estGerant ? '' : 'none'; });
  if (!estGerant) { setTimeout(() => showSection('ventes'), 300); }
}

// ── GESTION SERVEUSES (gérant) ──
async function ajouterServeuse() {
  const nom = document.getElementById('srv-nom')?.value.trim();
  const pin = document.getElementById('srv-pin')?.value.trim();
  if (!nom) { toast('△  Nom obligatoire', 'warning'); return; }
  if (!pin || pin.length < 4) { toast('△  PIN trop court (4 min)', 'warning'); return; }
  const { error } = await client.rpc('ajouter_serveuse', { p_bar_id: barActuel.id, p_nom: nom, p_pin: pin });
  if (error) { toast('❌ ' + error.message, 'error'); return; }
  document.getElementById('srv-nom').value = '';
  document.getElementById('srv-pin').value = '';
  toast('✅ Serveuse ajoutée !');
  chargerListeServeuses();
}

async function chargerListeServeuses() {
  const { data } = await client.from('serveuses').select('*').eq('bar_id', barActuel.id).order('nom');
  const div = document.getElementById('liste-serveuses-gestion'); if (!div) return;
  if (!data || data.length === 0) { div.innerHTML = '<div style="color:#aaa;font-size:13px;padding:10px;">Aucune serveuse enregistrée.</div>'; return; }
  div.innerHTML = data.map(s => `<div class="ligne-serveuse-gestion"><span style="font-weight:600;">👤 ${escape(s.nom)}</span><button class="btn btn-danger btn-sm" onclick="supprimerServeuse(${s.id})">🗑️</button></div>`).join('');
}

async function chargerRapportServeuses() {
  const periode = document.getElementById('rapport-periode')?.value || 'today';
  const maintenant = new Date();
  let dateDebut = null;
  if (periode === 'today') dateDebut = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate()).toISOString();
  else if (periode === 'week') dateDebut = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  else if (periode === 'month') dateDebut = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1).toISOString();
  let query = client.from('ventes').select('id, total, benef, serveuse, created_at, vente_articles(boisson_designation, quantite)').eq('bar_id', barActuel.id).order('created_at', { ascending: false });
  if (dateDebut) query = query.gte('created_at', dateDebut);
  const { data: ventes, error } = await query;
  if (error) { toast('❌ ' + error.message, 'error'); return; }
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
  const statsDiv = document.getElementById('rapport-stats-globales');
  if (statsDiv) {
    statsDiv.innerHTML = `
      <div class="stat-box" style="border-left-color:#1a6b3a;"><div class="stat-label">Total CA période</div><div class="stat-value vert">${formatPrix(totalGlobal)}</div></div>
      <div class="stat-box" style="border-left-color:#d4a017;"><div class="stat-label">Bénéfice période</div><div class="stat-value" style="color:#d4a017;">${formatPrix(benefGlobal)}</div></div>
      <div class="stat-box" style="border-left-color:#0288d1;"><div class="stat-label">Serveuses actives</div><div class="stat-value" style="color:#0288d1;">${liste.length}</div></div>`;
  }
  const contenu = document.getElementById('rapport-serveuses-contenu'); if (!contenu) return;
  if (liste.length === 0) { contenu.innerHTML = '<div style="text-align:center;color:#aaa;padding:30px;">Aucune vente sur cette période.</div>'; return; }
  contenu.innerHTML = liste.map(g => {
    const nbVentes = g.ventes.filter(v => { const d=(v.vente_articles||[]).map(a=>a.boisson_designation||'').join(' ').toUpperCase(); return !d.includes('RETOUR')&&!d.includes('PERTE')&&!d.includes('FOURNISSEUR'); }).length;
    return `<div class="carte-serveuse">
      <div class="carte-serveuse-entete">
        <span style="font-weight:700;font-size:15px;">👤 ${escape(g.nom)}</span>
        <span style="font-size:13px;opacity:0.8;">${nbVentes} vente(s)</span>
      </div>
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border);">
        <div style="flex:1;padding:12px;text-align:center;border-right:1px solid var(--border);"><div style="font-size:11px;text-transform:uppercase;" class="txt-secondaire">CA</div><div style="font-weight:700;color:#1a6b3a;">${formatPrix(g.total)}</div></div>
        <div style="flex:1;padding:12px;text-align:center;"><div style="font-size:11px;text-transform:uppercase;" class="txt-secondaire">Bénéfice</div><div style="font-weight:700;color:#d4a017;">${formatPrix(g.benef)}</div></div>
      </div>
      <div style="padding:12px;">
        <div style="font-size:12px;font-weight:600;margin-bottom:8px;" class="txt-secondaire">DERNIÈRES VENTES</div>
        ${g.ventes.slice(0, 5).map(v => {
          const articles = (v.vente_articles||[]).map(a => `${a.boisson_designation} ×${a.quantite}`).join(', ');
          const date = new Date(v.created_at).toLocaleString('fr-FR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
          return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px;"><span class="txt-secondaire">${date} — ${articles || '—'}</span><span style="font-weight:600;color:#1a6b3a;">${formatPrix(parseInt(v.total)||0)}</span></div>`;
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

function changerUtilisateur() {
  utilisateurActuel = null; realtimeActif = false;
  client.removeAllChannels();
  afficherEcranRole();
}

// ==================== PROFIL BAR ====================

async function chargerProfilBar() {
  const nomInput = document.getElementById('profil-nom');
  if (nomInput) nomInput.placeholder = barActuel.nom;

  const msg = document.getElementById('profil-message');
  if (msg) msg.style.display = 'none';
}
function afficherMessageProfil(texte, succes = true) {
  const msg = document.getElementById('profil-message');
  if (!msg) return;
  msg.innerText = texte;
  msg.style.display = 'block';
  msg.className = succes ? 'profil-msg-succes' : 'profil-msg-erreur';
  setTimeout(() => { msg.style.display = 'none'; }, 4000);
}

async function changerNomBar() {
  const nom = (document.getElementById('profil-nom')?.value || '').trim();
  if (!nom) { afficherMessageProfil('Entrez un nouveau nom.', false); return; }
  if (nom === barActuel.nom) { afficherMessageProfil('Ce nom est déjà le vôtre.', false); return; }

  try {
    const { error } = await client.from('bars').update({ nom }).eq('id', barActuel.id);
    if (error) throw error;
    barActuel.nom = nom;
    localStorage.setItem('barstock_bar_nom', nom);
    const nomEl = document.getElementById('nom-bar-actuel');
    if (nomEl) nomEl.innerText = `BarStock - ${escape(nom)} (${utilisateurActuel.nom})`;
    document.getElementById('profil-nom').value = '';
    document.getElementById('profil-nom').placeholder = nom;
    afficherMessageProfil('✅ Nom du bar mis à jour !');
  } catch (err) {
    afficherMessageProfil('❌ Erreur : ' + err.message, false);
  }
}

async function changerMotDePasse() {
  const currentPassword = prompt('Entrez votre mot de passe actuel pour confirmer le changement :');
  if (!currentPassword) return;

  const password = (document.getElementById('profil-password')?.value || '').trim();
  const confirmPassword = (document.getElementById('profil-password-confirm')?.value || '').trim();

  if (!password || password.length < 8) { afficherMessageProfil('Le mot de passe doit avoir au moins 8 caractères.', false); return; }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) { afficherMessageProfil('Le mot de passe doit contenir majuscule, minuscule et chiffre.', false); return; }
  if (password !== confirmPassword) { afficherMessageProfil('Les mots de passe ne correspondent pas.', false); return; }

  if (!confirm(`Changer le mot de passe ? Vous serez déconnecté et devrez vous reconnecter avec le nouveau mot de passe.`)) return;

  try {
    // Vérifier l'ancien mot de passe
    const { error: signInError } = await client.auth.signInWithPassword({
      email: (await client.auth.getSession()).data.session?.user?.email || '',
      password: currentPassword
    });
    if (signInError) { afficherMessageProfil('Mot de passe actuel incorrect.', false); return; }

    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;

    afficherMessageProfil('✅ Mot de passe modifié ! Reconnexion dans 3 secondes...');
    setTimeout(async () => {
      await client.auth.signOut();
      barActuel = null; utilisateurActuel = null;
      localStorage.removeItem('barstock_bar_id');
      localStorage.removeItem('barstock_bar_nom');
      localStorage.removeItem('barstock_expiration');
      afficherEcranAuth();
    }, 3000);
  } catch (err) {
    afficherMessageProfil('❌ Erreur : ' + err.message, false);
  }
}

async function changerPinGerant() {
  const pin = (document.getElementById('profil-pin')?.value || '').trim();
  if (!pin || pin.length < 4) { afficherMessageProfil('PIN trop court (minimum 4 chiffres).', false); return; }

  try {
    const { error } = await client.rpc('changer_pin_gerant', { p_bar_id: barActuel.id, p_nouveau_pin: pin });
    if (error) throw error;
    document.getElementById('profil-pin').value = '';
    afficherMessageProfil('✅ PIN Gérant mis à jour !');
  } catch (err) {
    afficherMessageProfil('❌ Erreur : ' + err.message, false);
  }
}
async function changerMotDePasseAdmin() {
  const actuel = prompt('Mot de passe actuel (obligatoire) :');
  if (!actuel) return;

  const nouveau = prompt('Nouveau mot de passe (min. 8 caractères, majuscule, minuscule, chiffre) :');
  if (!nouveau || nouveau.length < 8) { alert('Mot de passe trop court.'); return; }
  if (!/[A-Z]/.test(nouveau) || !/[a-z]/.test(nouveau) || !/[0-9]/.test(nouveau)) { alert('Le mot de passe doit contenir majuscule, minuscule et chiffre.'); return; }
  const confirmation = prompt('Confirmer le mot de passe :');
  if (nouveau !== confirmation) { alert('Les mots de passe ne correspondent pas.'); return; }

  try {
    const { error: signInError } = await client.auth.signInWithPassword({
      email: (await client.auth.getSession()).data.session?.user?.email || '',
      password: actuel
    });
    if (signInError) { alert('Mot de passe actuel incorrect.'); return; }

    const { error } = await client.auth.updateUser({ password: nouveau });
    if (error) { alert('Erreur : ' + error.message); return; }
    alert('✅ Mot de passe mis à jour !');
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}
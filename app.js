
/* global L, supabase, TRAP_SCOUT_CONFIG */
let sb = null;
let map, markersLayer;
let trapsCache = [];
let selectedTrap = null;
let deferredPrompt = null;
let sheetTraps, sheetLogs, trapListEl, logListEl, trapSearchEl;
let syncResetTimer = null;
let youMarker = null;
let youCircle = null;
let followWatchId = null;
let followCenter = true; // auto-center while following

function updateYouPosition(lat, lon, accuracyMeters) {
  const latlng = L.latLng(lat, lon);
  if (!youMarker) {
    youMarker = L.marker(latlng, { title: "You are here" }).addTo(map);
  } else {
    youMarker.setLatLng(latlng);
  }
  if (!youCircle) {
    youCircle = L.circle(latlng, { radius: accuracyMeters || 10, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 1 }).addTo(map);
  } else {
    youCircle.setLatLng(latlng);
    if (accuracyMeters) youCircle.setRadius(accuracyMeters);
  }
  if (followCenter) map.setView(latlng, Math.max(map.getZoom(), 18));
}

function startFollowing() {
  if (!('geolocation' in navigator)) {
    alert('Geolocation not supported on this device/browser.');
    return;
  }
  // If already watching, do nothing
  if (followWatchId != null) return;

  // High accuracy GPS; keep power in mind
  followWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords || {};
      updateYouPosition(latitude, longitude, accuracy);
    },
    (err) => {
      console.warn('Geo error', err);
      alert('Unable to get location: ' + err.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,   // accept a reading up to 5s old
      timeout: 15000      // give up a slow fix after 15s
    }
  );

  const btn = document.getElementById('btn-locate');
  if (btn) btn.textContent = 'Stop';
  followCenter = true;
}

function stopFollowing() {
  if (followWatchId != null) {
    navigator.geolocation.clearWatch(followWatchId);
    followWatchId = null;
  }
  const btn = document.getElementById('btn-locate');
  if (btn) btn.textContent = 'Follow me';
  // Keep marker on map, or remove if you prefer:
  // if (youMarker) { map.removeLayer(youMarker); youMarker = null; }
  // if (youCircle) { map.removeLayer(youCircle); youCircle = null; }
}
/**
 * Update the Sync banner and auto-reset to neutral after `ms` (default 2 minutes).
 * setSyncStatus(true)  -> "Sync: OK"    (green)
 * setSyncStatus(false) -> "Sync: Error" (red)
 * setSyncStatus(null)  -> "Sync: —"     (neutral)
 */
function setSyncStatus(ok, ms = 120000) {
  const el = document.getElementById('kpi-sync');
  if (!el) return;

  el.classList.remove('ok','err','neutral');
  if (ok === true) {
    el.textContent = 'Sync: OK';
    el.classList.add('ok');
  } else if (ok === false) {
    el.textContent = 'Sync: Error';
    el.classList.add('err');
  } else {
    el.textContent = 'Sync: —';
    el.classList.add('neutral');
  }

  // auto-reset
  if (syncResetTimer) clearTimeout(syncResetTimer);
  if (ok === true || ok === false) {
    syncResetTimer = setTimeout(() => {
      const el2 = document.getElementById('kpi-sync');
      if (!el2) return;
      el2.classList.remove('ok','err');
      el2.classList.add('neutral');
      el2.textContent = 'Sync: —';
      syncResetTimer = null;
    }, ms);
  }
}

const condOpts = ['OK','Missing','Damaged','Dry lure','Spilled','Moved','Replaced','Cleaned'];
const actOpts  = ['Logged only','Cleaned','Re-baited','Replaced trap','Replaced lure','Relocated','Escalated'];

function fmt(n){ return (n==null||Number.isNaN(n)) ? '' : Number(n).toFixed(6); }
function esc(s){ return s==null? '' : String(s); }
function isFCM(t){ return (t?.toUpperCase?.()||'').includes('FCM'); }
function isBucket(t){ return t==='Bucket' || (t?.toUpperCase?.()||'').includes('BUCKET'); }

function computeDue(lastVisitIso, intervalDays){
  if(!intervalDays) return '';
  const base = lastVisitIso ? new Date(lastVisitIso) : null;
  const last = base ? base : null;
  const next = new Date((last?.getTime()||Date.now()) + intervalDays*24*3600*1000);
  const days = Math.ceil((next - Date.now())/(24*3600*1000));
  const badge = days<0 ? `<span class="badge red">${-days}d overdue</span>` :
               days<=2 ? `<span class="badge yellow">due ${days}d</span>` :
               days<=7 ? `<span class="badge">due ${days}d</span>` :
               `<span class="badge green">ok</span>`;
  return badge;
}

async function init(){
  // Install prompt (PWA)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('btn-install');
    btn.style.display = 'inline-block';
    btn.onclick = async () => {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      btn.style.display = 'none';
      setSyncStatus(null); // start neutral
      document.getElementById('btn-locate').addEventListener('click', () => {
  if (followWatchId == null) startFollowing();
  else stopFollowing();
        map.on('movestart', () => { followCenter = false; });
map.on('moveend',   () => { /* keep followCenter=false until next toggle or you can set a timer */ });
});
    };
  });

  // Service worker
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js');
  }

  // Supabase
  const cfg = window.TRAP_SCOUT_CONFIG;
  sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Map
  map = L.map('map', { zoomControl: true }).setView(cfg.DEFAULT_CENTER, cfg.DEFAULT_ZOOM);
  L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Earthstar Geographics, Maxar'
  }
).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  document.getElementById('btn-refresh').addEventListener('click', loadTraps);
  document.getElementById('btn-sync').addEventListener('click', syncQueue);

  await loadTraps();
}

async function loadTraps(){
  try{
    const { data, error } = await sb.from('traps').select('*').order('code');
    if(error) throw error;
    trapsCache = data || [];
    localStorage.setItem('trapsCache', JSON.stringify(trapsCache));
    renderMarkers(trapsCache);
    await updateKPIs();
    setSyncStatus(true);
    
  }catch(err){
    console.warn('Online fetch failed, using cache', err);
    const cached = localStorage.getItem('trapsCache');
    if(cached){
      trapsCache = JSON.parse(cached);
      renderMarkers(trapsCache);
      updateKPIs();
      setSyncStatus(false);
    }
  }
}

function iconForTrap(t){
  const svg = isFCM(t.trap_type) ?
    `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><circle cx='14' cy='14' r='12' fill='#3b82f6'/><text x='14' y='19' font-size='14' text-anchor='middle' fill='white'>M</text></svg>`
    :
    `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><circle cx='14' cy='14' r='12' fill='#22c55e'/><text x='14' y='19' font-size='14' text-anchor='middle' fill='white'>F</text></svg>`;
  const url = 'data:image/svg+xml;base64,' + btoa(svg);
  return L.icon({ iconUrl: url, iconSize: [28,28], iconAnchor:[14,14], popupAnchor:[0,-12] });
}

function renderMarkers(list){
  markersLayer.clearLayers();
  list.forEach(t => {
    if(t.lat==null || t.lon==null) return;
    const m = L.marker([t.lat, t.lon], { icon: iconForTrap(t) });
    m.on('click', () => showTrap(t));
    markersLayer.addLayer(m);
  });
}

async function updateKPIs(){
  const intervalsByTrap = Object.fromEntries(trapsCache.map(t => [t.id, t.service_interval_days || (isBucket(t.trap_type)?28:21)]));
  const { data: visits } = await sb.from('visits').select('trap_id, visited_at').order('visited_at', { ascending: false }).limit(1000);
  const latest = {};
  (visits||[]).forEach(v => { if(!latest[v.trap_id]) latest[v.trap_id] = v.visited_at; });
  let overdue=0, week=0;
  const now = Date.now();
  trapsCache.forEach(t => {
    const last = latest[t.id] ? new Date(latest[t.id]).getTime() : null;
    const due = (last || now) + (intervalsByTrap[t.id] || 28)*24*3600*1000;
    const days = Math.ceil((due - now)/(24*3600*1000));
    if(days < 0) overdue++;
    else if(days <= 7) week++;
  });
  document.getElementById('kpi-total').textContent = `Traps: ${trapsCache.length}`;
  document.getElementById('kpi-overdue').textContent = `Overdue: ${overdue}`;
  document.getElementById('kpi-week').textContent = `Due ≤7d: ${week}`;
}

function showTrap(t){
  selectedTrap = t;
  document.getElementById('trap-title').textContent = `${t.code} — ${esc(t.trap_type)}`;
  document.getElementById('trap-type').textContent = esc(t.trap_type);
  document.getElementById('trap-target').textContent = esc(t.target);
  document.getElementById('trap-lure').textContent = esc(t.lure);
  const num = (t.code.match(/AA(\d{2})/)||[])[1];
  const blk = num ? `AA ${parseInt(num,10)}` : '';
  document.getElementById('trap-block').textContent = blk;

  const nextDue = computeDue(null, t.service_interval_days || (isBucket(t.trap_type)?28:21));
  document.getElementById('trap-due').innerHTML = nextDue;

  const gmaps = `https://maps.google.com/?q=${fmt(t.lat)},${fmt(t.lon)}`;
  const amaps = `maps://?q=${fmt(t.lat)},${fmt(t.lon)}`;
  const gEl = document.getElementById('gmaps'); gEl.href = gmaps;
  const aEl = document.getElementById('amaps'); aEl.href = amaps;

  document.getElementById('trap-card').classList.remove('hidden');
}

document.addEventListener('submit', async (e) => {
  if(e.target.id !== 'visit-form') return;
  e.preventDefault();
  if(!selectedTrap){ return; }
  const statusEl = document.getElementById('visit-status');
  const payload = {
    trap_id: selectedTrap.id,
    visited_at: new Date().toISOString(),
    count_males: parseInt(document.getElementById('v-count').value||'') || null,
    condition: document.getElementById('v-cond').value || null,
    action: document.getElementById('v-act').value || null,
    operator: document.getElementById('v-operator').value || null,
    notes: document.getElementById('v-notes').value || null
  };
  try{
    const { error } = await sb.from('visits').insert(payload);
    if(error) throw error;
    statusEl.textContent = 'Saved ✔';
    updateKPIs();
    setSyncStatus(true);
  }catch(err){
    const q = JSON.parse(localStorage.getItem('visitQueue')||'[]');
    q.push(payload);
    localStorage.setItem('visitQueue', JSON.stringify(q));
    statusEl.textContent = 'Saved offline (will sync)';
    document.getElementById('queue').classList.remove('hidden');
    renderQueue();
    setSyncStatus(false);
  }
});

function renderQueue(){
  const q = JSON.parse(localStorage.getItem('visitQueue')||'[]');
  const el = document.getElementById('queue-list');
  el.innerHTML = '';
  q.forEach((v,i) => {
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `<span>#${i+1}</span><span>${(v.trap_id||'').slice(0,6)}…</span><span>${v.count_males??0}</span><span>${(v.condition||'')}</span>`;
    el.appendChild(div);
  });
}

async function syncQueue(){
  const q = JSON.parse(localStorage.getItem('visitQueue')||'[]');
  if(!q.length) return;
  const { error } = await sb.from('visits').insert(q);
  setSyncStatus(true);
  if(!error){
    localStorage.removeItem('visitQueue');
    document.getElementById('queue-list').innerHTML = '';
    document.getElementById('queue').classList.add('hidden');
    updateKPIs();
    alert('Synced offline visits ✔');
  }else{
    alert('Still offline or error syncing.');
    setSyncStatus(false);
  }
}
function openTrapList(list){
  renderTrapList(list || trapsCache);
  sheetTraps.classList.add('show');
  trapSearchEl.value = '';
}

function renderTrapList(list){
  trapListEl.innerHTML = '';
  (list||[]).forEach(t => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div><b>${t.code}</b></div>
      <div class="meta-row">
        <span>${t.trap_type||''}</span>
        <span>${t.target||''}</span>
        <span>${t.lure||''}</span>
        <span>${(t.lat!=null && t.lon!=null) ? `${Number(t.lat).toFixed(5)}, ${Number(t.lon).toFixed(5)}` : ''}</span>
      </div>
      <div class="meta-row">
        <span class="badge small">${t.service_interval_days || (isBucket(t.trap_type)?28:21)} d</span>
      </div>
    `;
    el.onclick = async () => {
      sheetTraps.classList.remove('show');
      await openLogsForTrap(t);
    };
    trapListEl.appendChild(el);
  });
}

async function openLogsForTrap(t){
  document.getElementById('logs-title').textContent = `${t.code} — logs`;
  logListEl.innerHTML = '<div class="item">Loading…</div>';

  const { data, error } = await sb
    .from('visits')
    .select('visited_at, count_males, condition, action, operator, notes')
    .eq('trap_id', t.id)
    .order('visited_at', { ascending: false })
    .limit(500);

  if(error){
    logListEl.innerHTML = `<div class="item">Error loading logs: ${error.message}</div>`;
    sheetLogs.classList.add('show');
    return;
  }
  if(!data || data.length === 0){
    logListEl.innerHTML = `<div class="item">No visits yet for ${t.code}.</div>`;
    sheetLogs.classList.add('show');
    return;
  }

  logListEl.innerHTML = '';
  data.forEach(v => {
    const el = document.createElement('div');
    el.className = 'item';
    const date = new Date(v.visited_at).toLocaleString();
    el.innerHTML = `
      <div><b>${date}</b></div>
      <div class="meta-row">
        <span>♂ ${v.count_males ?? 0}</span>
        ${v.condition ? `<span>${v.condition}</span>` : ''}
        ${v.action ? `<span>${v.action}</span>` : ''}
        ${v.operator ? `<span>by ${v.operator}</span>` : ''}
      </div>
      ${v.notes ? `<div class="meta-row">${v.notes}</div>` : ''}
    `;
    logListEl.appendChild(el);
  });

  sheetLogs.classList.add('show');
}

// Grab elements
sheetTraps   = document.getElementById('sheet-traps');
sheetLogs    = document.getElementById('sheet-logs');
trapListEl   = document.getElementById('trap-list');
logListEl    = document.getElementById('log-list');
trapSearchEl = document.getElementById('trap-search');

// Button: open trap list
document.getElementById('btn-traplist').addEventListener('click', () => {
  openTrapList(trapsCache);
});

// Close buttons
document.getElementById('sheet-close').addEventListener('click', () => sheetTraps.classList.remove('show'));
document.getElementById('logs-close').addEventListener('click', () => sheetLogs.classList.remove('show'));

// Live filter
trapSearchEl.addEventListener('input', () => {
  const q = trapSearchEl.value.toLowerCase().trim();
  const filtered = trapsCache.filter(t => {
    const s = `${t.code||''} ${t.trap_type||''} ${t.target||''} ${t.lure||''}`.toLowerCase();
    return s.includes(q);
  });
  renderTrapList(filtered);
});
window.addEventListener('load', init);

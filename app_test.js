/* global L, supabase, TRAP_SCOUT_CONFIG */
const log = (msg, data) => {
  console.log(msg, data||'');
  const el = document.getElementById('log');
  if (el) el.textContent += msg + (data ? ' ' + JSON.stringify(data, null, 2) : '') + '\n';
};
const show = t => document.getElementById('panel').classList.add('show');
const hide = () => document.getElementById('panel').classList.remove('show');
document.getElementById('close').onclick = hide;

(async () => {
  try {
    if (!window.TRAP_SCOUT_CONFIG) {
      document.getElementById('kpi').textContent = 'config.js not loaded';
      alert('config.js did not load (check path/quotes)');
      return;
    }
    const cfg = window.TRAP_SCOUT_CONFIG;
    log('CONFIG', cfg);

    // Map (no service worker involved)
    const map = L.map('map').setView(cfg.DEFAULT_CENTER || [-33.95, 21.03], cfg.DEFAULT_ZOOM || 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap'}).addTo(map);

    // Supabase
    const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    // Try to fetch traps
    document.getElementById('kpi').textContent = 'loading traps…';
    const { data, error } = await sb.from('traps').select('*').order('code');
    if (error) {
      document.getElementById('kpi').textContent = 'ERROR loading traps';
      log('ERROR traps', error);
      alert('Supabase error: ' + error.message);
      return;
    }
    log('TRAPS rows', data?.length);
    document.getElementById('kpi').textContent = `Traps: ${data.length}`;

    // Render markers
    data.forEach(t => {
      if (t.lat == null || t.lon == null) return;
      const m = L.marker([t.lat, t.lon]).addTo(map);
      m.on('click', () => {
        document.getElementById('title').textContent = t.code + (t.trap_type ? ' — ' + t.trap_type : '');
        document.getElementById('meta').innerHTML =
          `<div><b>Target:</b> ${t.target||''}</div>
           <div><b>Lure:</b> ${t.lure||''}</div>
           <div><b>Service interval:</b> ${t.service_interval_days||''} days</div>
           <div><b>Coords:</b> ${t.lat?.toFixed(6)}, ${t.lon?.toFixed(6)}</div>`;
        document.getElementById('log').textContent = '';
        show();
      });
    });

    // If we got zero markers, log a hint
    if (data.filter(t => t.lat != null && t.lon != null).length === 0) {
      log('HINT', 'No traps have lat/lon. Check the traps table.');
      alert('No traps have coordinates. Check your `traps` table lat/lon.');
    }
  } catch (e) {
    log('EXCEPTION', String(e.stack || e));
    alert('JS exception: ' + e.message);
  }
})();

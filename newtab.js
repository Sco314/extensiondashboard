/* newtab.js — robust storage + calendar + weather (MV3-safe) */

/* tiny helper: always returns a Promise, even if Chrome lacks promiseified APIs */
function syncGet(keys) {
  return new Promise(resolve => chrome.storage.sync.get(keys, resolve));
}

const $ = s => document.querySelector(s);

// --- Weather helpers (already safe; rendered after calendar) ---
const WX_TTL = 15 * 60 * 1000;
function wxKey(lat,lon){ return `${lat.toFixed(3)},${lon.toFixed(3)}`; }
function wxIcon(code){
  if(code===0) return '☀️';
  if([1,2,3].includes(code)) return '⛅️';
  if([45,48].includes(code)) return '🌫️';
  if([51,53,55].includes(code)) return '🌦️';
  if([61,63,65,80,81,82].includes(code)) return '🌧️';
  if([71,73,75,85,86].includes(code)) return '🌨️';
  if([95,96,99].includes(code)) return '⛈️';
  return '❓';
}

// City+State label (never street names)
function abbrUS(state){
  const m = {
    "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO",
    "Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID",
    "Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA",
    "Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS",
    "Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
    "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
    "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",
    "Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA",
    "West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"
  };
  return m[state] || state;
}

// --- helpers for city,state formatting ---
function abbrUS(state){
  const m = {"Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO",
  "Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL",
  "Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
  "Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
  "Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY",
  "North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA",
  "Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT",
  "Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
  "District of Columbia":"DC"};
  return m[state] || state;
}
function hav(lat1, lon1, lat2, lon2){ // quick distance^2 for sorting
  const dlat = (lat1-lat2), dlon = (lon1-lon2)*Math.cos((lat1+lat2)*Math.PI/360);
  return dlat*dlat + dlon*dlon;
}

// Find the nearest populated place (city/town/village) to the coords
async function wxNearestCity(lat, lon){
  const url = `https://geocoding-api.open-meteo.com/v1/search?latitude=${lat}&longitude=${lon}&count=10&language=en`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('city search failed');
  const j = await r.json();
  const cand = (j.results || [])
    // keep populated places (PPL* codes usually mean settlements)
    .filter(g => (g.feature_code || '').startsWith('PPL'))
    // sort by actual proximity
    .sort((a,b)=> hav(lat,lon,a.latitude,a.longitude) - hav(lat,lon,b.latitude,b.longitude))[0];
  if (cand) {
    const state = cand.admin1 ? abbrUS(cand.admin1) : (cand.admin1 || '');
    return state ? `${cand.name}, ${state}` : cand.name;
  }
  // fallback: if nothing PPL found, try first result anyway
  const g = j.results?.[0];
  if (g?.name) {
    const state = g.admin1 ? abbrUS(g.admin1) : (g.admin1 || '');
    return state ? `${g.name}, ${state}` : g.name;
  }
  throw new Error('no city candidates');
}

// Prefer city,town,village; if not available, ask for nearest city
async function wxReverse(lat, lon){
  // 1) Open-Meteo reverse: often returns a locality near the point
  try {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1&language=en`
    );
    if (r.ok) {
      const j = await r.json();
      const g = j.results?.[0];
      if (g?.name) {
        // If the name looks like a road or a county, try a proper city nearby
        const name = g.name.toLowerCase();
        const looksRoad = /road|rd|street|st|highway|hwy|fm-|farm-to-market|loop|drive|dr|ave|avenue/.test(name);
        const looksCounty = /county/i.test(g.admin2 || '');
        if (!looksRoad && !looksCounty) {
          const state = g.admin1 ? abbrUS(g.admin1) : (g.admin1 || '');
          return state ? `${g.name}, ${state}` : g.name;
        }
      }
    }
  } catch (_) {}

  // 2) Fall back to a forward search for the nearest populated place
  try { return await wxNearestCity(lat, lon); } catch (_) {}

  // 3) Last resort: readable coords
  return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}
let CONF = null;         // the saved settings from storage
let WX_OVERRIDE = null;  // { lat, lon, label } — session-only


async function wxFetch(lat,lon){
  const now = Date.now();
  const key = wxKey(lat,lon);
  const cache = (await chrome.storage.local.get('wx_cache')).wx_cache || {};
  const hit = cache[key];
  if(hit && (now - hit.ts) < WX_TTL) return hit.data;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  Object.entries({
    latitude:lat, longitude:lon,
    current:'temperature_2m,apparent_temperature,weather_code',
    daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    temperature_unit:'fahrenheit', timezone:'auto'
  }).forEach(([k,v])=> url.searchParams.set(k,v));
  const data = await fetch(url).then(r=>r.json());
  cache[key] = { ts: now, data };
  await chrome.storage.local.set({ wx_cache: cache });
  return data;
}
async function renderWeather(conf){
  try{
// --- choose location: session override > saved coords > typed city/ZIP > bail
let lat, lon, label;

const usingOverride = !!WX_OVERRIDE;
if (usingOverride) {
  ({ lat, lon, label } = WX_OVERRIDE);
} else if (conf.wx_coords) {
  lat = conf.wx_coords.lat; lon = conf.wx_coords.lon;
  label = conf.wx_label || "";
  const looksLikeCoords = /^\s*-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/.test(label);
  if (!label || looksLikeCoords) {
    try {
      label = await wxReverse(lat, lon);
      await chrome.storage.sync.set({ wx_label: label }); // persist only when NOT override
    } catch (_) {
      label = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    }
  }
} else if (conf.wx) {
  const g = await wxGeocode(conf.wx);
  lat = g.lat; lon = g.lon; label = g.label;
  await chrome.storage.sync.set({ wx_coords: { lat, lon }, wx_label: label });
} else {
  document.getElementById('weather-current').textContent = 'Open Customize to choose location.';
  return;
}


    // --- fetch + unpack
    const data = await wxFetch(lat,lon);
    const cur = data.current || {}; const d = data.daily || {};

    // Find today's index robustly (local date string like "YYYY-MM-DD")
    const t = new Date();
    const todayStr = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    const times = d.time || [];
    let todayIdx = Math.max(0, times.indexOf(todayStr));

    // Today display (big)
    const todayTemp = Math.round(cur.temperature_2m ?? d.temperature_2m_max?.[todayIdx] ?? 0);
    const todayEmoji = wxIcon(cur.weather_code ?? d.weather_code?.[todayIdx] ?? -1);
    const feels = Math.round(cur.apparent_temperature ?? todayTemp);
    document.getElementById('weather-current').innerHTML = `
      <div>
        <div class="place">${label}</div>
        <div class="date">${t.toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'})}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="emoji" aria-hidden="true">${todayEmoji}</div>
        <div class="now">${todayTemp}°F</div>
      </div>
    `;

    // Rows: start at TOMORROW, show next 6 days
    const ul = document.getElementById('weather-7day'); ul.innerHTML = '';
    for (let i = 1; i <= 6 && (todayIdx + i) < times.length; i++){
      const idx = todayIdx + i;
      const dte = new Date(times[idx]);
      const hi = Math.round(d.temperature_2m_max?.[idx] ?? 0);
      const lo = Math.round(d.temperature_2m_min?.[idx] ?? 0);
      const pop = d.precipitation_probability_max?.[idx] ?? 0;
      const icon = wxIcon(d.weather_code?.[idx] ?? -1);
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="wk small">${dte.toLocaleDateString(undefined,{weekday:'short'})}</span>
        <span class="icon">${icon}</span>
        <span class="temps"><span class="hi">${hi}°</span><span class="lo">${lo}°</span></span>
        <span class="pop small">${pop}%</span>
      `;
      ul.appendChild(li);
    }
  }catch(e){
    console.error('Weather render error:', e);
    document.getElementById('weather-current').textContent = 'Weather unavailable';
  }
}


// --- Page boot (callback-safe storage) ---
(async function boot(){
  const defaults = { name:"", tz:"", wx:"", wx_coords:null, wx_label:"", calIds:[], firstRun:true };
  const conf = await syncGet(defaults);

  // If calIds were saved under an older key, adopt them
  if(!conf.calIds?.length && Array.isArray(conf.selCalIds)) conf.calIds = conf.selCalIds;

  if (conf.firstRun || !conf.calIds?.length) {
    // Don’t silently fail—show the box and nudge to Customize
    $('#fallback')?.classList.remove('hidden');
    $('#fallback').textContent = 'No calendars selected. Click Customize.';
    return;
  }

  // Greeting + timezone label
  $('#greet').textContent = conf.name ? `Good day, ${conf.name} 👋` : 'Good day';
  $('#tzLabel').textContent = conf.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Build Google Calendar agenda iframe URL
  const ids = conf.calIds;
  const base = 'https://calendar.google.com/calendar/embed';
  const q = new URLSearchParams({
    mode:'AGENDA',
    showTitle:0, showPrint:0, showTabs:0, showCalendars:0, showTz:0,
    ctz: conf.tz || Intl.DateTimeFormat().resolvedOptions().timeZone
  });
  ids.forEach(id => q.append('src', id));

  const url = `${base}?${q.toString()}`;
  const iframe = document.getElementById('gcal');
  if (iframe) {
    iframe.src = url;
    // helpful if we need to verify later
    console.log('Calendar embed URL:', url);
  } else {
    console.warn('#gcal iframe not found');
  }

  // Weather (now live; respects your saved city/ZIP or coords)
  await renderWeather(conf);

  // Google search box
  document.getElementById('gsearch')?.addEventListener('submit', (e)=>{
    e.preventDefault(); const v=document.getElementById('q').value.trim();
    if(v) location.href = 'https://www.google.com/search?q=' + encodeURIComponent(v);
  });
})();

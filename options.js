/* =============================
[...selected].forEach(id=>{ const c=calendars.find(x=>x.id===id); if(!c) return; const li=document.createElement('li'); li.textContent=c.summary; sel.appendChild(li); });
$o('#sel-count').textContent = selected.size;
}


async function geocodeName(name){
const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`;
const r = await fetch(url); if(!r.ok) throw new Error('geo');
const j = await r.json();
if(!j.results || !j.results.length) throw new Error('no match');
const g = j.results[0];
return { lat:g.latitude, lon:g.longitude, label:`${g.name}${g.admin1? ', '+g.admin1:''}` };
}
async function reverseGeocode(lat,lon){
const r = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1`);
const j = await r.json();
const g = j.results?.[0];
return { lat, lon, label: g ? `${g.name}${g.admin1? ', '+g.admin1:''}` : `${lat.toFixed(2)}, ${lon.toFixed(2)}` };
}


$o('#signin').addEventListener('click', async()=>{
const resp = await chrome.runtime.sendMessage({ type:'calendarList' });
if(!resp?.ok){ alert('Sign-in failed: '+resp?.error); return; }
calendars = (resp.data.items||[]).sort((a,b)=> (a.primary?-1:1) || a.summary.localeCompare(b.summary));
$o('#pickers').classList.remove('hidden');
renderLists();
$o('#who').textContent = 'Signed in';
});


$o('#useLoc').addEventListener('click', ()=>{
$o('#wxStatus').textContent = 'Locating…';
navigator.geolocation.getCurrentPosition(async(pos)=>{
const {latitude:lat, longitude:lon} = pos.coords;
const g = await reverseGeocode(lat,lon);
await chrome.storage.sync.set({ wx_coords:{lat:g.lat,lon:g.lon}, wx_label:g.label, wx:'' });
$o('#wx').value = g.label;
$o('#wxStatus').textContent = `Saved ${g.label}`;
}, (err)=>{
$o('#wxStatus').textContent = 'Location blocked';
}, { enableHighAccuracy:false, timeout:8000 });
});


$o('#save').addEventListener('click', async()=>{
const name = $o('#name').value.trim();
const tz = $o('#tz').value || Intl.DateTimeFormat().resolvedOptions().timeZone;
const wxText = $o('#wx').value.trim();


let wx_coords = null, wx_label = '';
if(wxText){ try{ const g=await geocodeName(wxText); wx_coords={lat:g.lat,lon:g.lon}; wx_label=g.label; } catch(e){ /* keep null */ } }


const calIds = [...selected];
await chrome.storage.sync.set({ name, tz, calIds, wx:wxText, wx_coords, wx_label, firstRun:false });
location.href = 'newtab.html';
});


window.addEventListener('load', async()=>{
const conf = await chrome.storage.sync.get(null);
if(conf.name) $o('#name').value = conf.name;
if(conf.tz) tzEl.value = conf.tz;
if(conf.wx) $o('#wx').value = conf.wx;
if(Array.isArray(conf.calIds)) selected = new Set(conf.calIds);
if(selected.size) $o('#pickers').classList.remove('hidden');
renderLists();
});

// OAuth via chrome.identity.launchWebAuthFlow
const CLIENT_ID = "REPLACE_WITH_YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"; // <-- paste yours
const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;
const SCOPE = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.settings.readonly"
].join(" ");
const API_BASE = "https://www.googleapis.com/calendar/v3";

let tokenCache = null;

async function getAccessToken(interactive) {
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "token",
    scope: SCOPE,
    include_granted_scopes: "true",
    state: String(Math.random())
  });
  if (interactive) params.set("prompt", "consent");
  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();

  const redirect = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, url => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!url) return reject(new Error("No redirect URL"));
      resolve(url);
    });
  });
  const frag = redirect.split("#")[1] || "";
  const qp = new URLSearchParams(frag);
  const access_token = qp.get("access_token");
  const expires_in = parseInt(qp.get("expires_in") || "3600", 10);
  if (!access_token) throw new Error("No access token");
  tokenCache = { token: access_token, exp: Date.now() + expires_in * 1000 };
  return access_token;
}

async function gfetch(path, params = {}) {
  let token;
  try { token = await getAccessToken(false); } catch { token = await getAccessToken(true); }
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k,v])=> url.searchParams.set(k,v));
  let r = await fetch(url.toString(), { headers: { Authorization: "Bearer " + token } });
  if (r.status === 401) {
    tokenCache = null; token = await getAccessToken(true);
    r = await fetch(url.toString(), { headers: { Authorization: "Bearer " + token } });
  }
  if (!r.ok) throw new Error("API error " + r.status);
  return r.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "calendarList") {
        const data = await gfetch("/users/me/calendarList", { minAccessRole: "reader", showHidden: "true" });
        sendResponse({ ok: true, data });
      } else if (msg.type === "events") {
        const { calId, params } = msg;
        const data = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`, params || {});
        sendResponse({ ok: true, data });
      } else {
        sendResponse({ ok: false, error: "unknown" });
      }
    } catch (e) { sendResponse({ ok: false, error: String(e) }); }
  })();
  return true;
});

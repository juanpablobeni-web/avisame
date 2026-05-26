#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { URL, URLSearchParams } = require("node:url");

const SESSION_ID = process.env.ONEBOX_SESSION_ID || process.argv[2] || "240895";
const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, ".env");
const LANDING_PATH = path.join(ROOT, "landing.html");

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers,
    };
    const req = https.request(opts, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (buf += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function pickLocalised(texts, langs = ["es-ES", "ca-ES", "en-US"]) {
  if (!texts || typeof texts !== "object") return "";
  for (const l of langs) if (texts[l]) return texts[l];
  for (const v of Object.values(texts)) if (v) return v;
  return "";
}

function fmtDateEs(iso) {
  if (!iso) return "Fecha por confirmar";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Fecha por confirmar";
  const fmt = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return fmt.format(d);
}

function fmtPrice(min, max) {
  const f = (v) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(v);
  if (min == null && max == null) return "—";
  if (!min && !max) return "Gratis";
  if (min === max) return f(min);
  if (!min) return `Hasta ${f(max)}`;
  return `${f(min)} – ${f(max)}`;
}

function severity(pct) {
  if (pct >= 50) return "green";
  if (pct >= 15) return "amber";
  return "red";
}

const ICON_CALENDAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
const ICON_PIN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
const ICON_TAG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>';

// Maps session state to the matchCard i18n key the runtime swaps in.
// Defaults stay in Spanish so the page still reads correctly if the i18n
// script never runs (e.g., JS disabled).
function statusFor(session) {
  if (session.sold_out) return { label: "Agotado", key: "matchCard.statusSoldOut", cls: "red" };
  if (session.on_sale) return { label: "A la venta", key: "matchCard.statusOnSale", cls: "green" };
  if (session.for_sale) return { label: "Próximamente", key: "matchCard.statusSoon", cls: "amber" };
  return { label: "No a la venta", key: "matchCard.statusUnavailable", cls: "neutral" };
}

function buildMatchInfoHtml(session, availability) {
  const event = session.event || {};
  const titleTexts = (event.texts && event.texts.title) || {};
  const subtitleTexts = (event.texts && event.texts.subtitle) || {};
  const title = pickLocalised(titleTexts) || event.name || session.name || "Sin título";
  const subtitle = pickLocalised(subtitleTexts);

  const venue = session.venue || {};
  const venueName = venue.name || "Estadio TBA";
  const city = (venue.location && venue.location.city) || "";
  const venueLine = [venueName, city].filter(Boolean).join(", ");

  const date = fmtDateEs((session.date || {}).start);
  const price = fmtPrice(
    (session.price || {}).min ? session.price.min.value : null,
    (session.price || {}).max ? session.price.max.value : null
  );

  const total = (availability.availability && availability.availability.total) || 0;
  const available = (availability.availability && availability.availability.available) || 0;
  const pct = total > 0 ? Math.round((available / total) * 100) : 0;
  const sev = session.sold_out ? "red" : severity(pct);
  const numFmt = new Intl.NumberFormat("es-ES");

  const status = statusFor(session);

  const indent = "        ";
  const subtitleHtml = subtitle
    ? `${indent}  <p class="match-card__subtitle">${escapeHtml(subtitle)}</p>\n`
    : "";

  return [
    `${indent}<header class="match-card__head">`,
    `${indent}  <div>`,
    `${indent}    <h2 class="match-card__title">${escapeHtml(title)}</h2>`,
    subtitle ? `${indent}    <p class="match-card__subtitle">${escapeHtml(subtitle)}</p>` : "",
    `${indent}  </div>`,
    `${indent}  <span class="status-pill status-pill--${status.cls}" data-i18n="${status.key}">${escapeHtml(status.label)}</span>`,
    `${indent}</header>`,
    `${indent}<ul class="match-card__meta">`,
    `${indent}  <li>${ICON_CALENDAR}<span data-match-date="${escapeHtml(((session.date || {}).start) || "")}">${escapeHtml(date)}</span></li>`,
    `${indent}  <li>${ICON_PIN}<span>${escapeHtml(venueLine)}</span></li>`,
    `${indent}  <li>${ICON_TAG}<span>${escapeHtml(price)}</span></li>`,
    `${indent}</ul>`,
    `${indent}<div class="match-card__avail">`,
    `${indent}  <div class="match-card__avail-row">`,
    `${indent}    <span class="match-card__avail-label" data-i18n="matchCard.availability">Disponibilidad</span>`,
    `${indent}    <span class="match-card__avail-value">${numFmt.format(available)} / ${numFmt.format(total)}<span class="pct pct--${sev}">(${pct}%)</span></span>`,
    `${indent}  </div>`,
    `${indent}  <div class="match-card__bar"><div class="match-card__bar-fill match-card__bar-fill--${sev}" style="width: ${pct}%"></div></div>`,
    `${indent}</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function replaceBetweenMarkers(html, marker, replacement) {
  const re = new RegExp(
    `(<!--\\s*${marker}:start\\s*-->)([\\s\\S]*?)(<!--\\s*${marker}:end\\s*-->)`
  );
  if (!re.test(html)) {
    throw new Error(`Could not find markers for "${marker}" in landing.html`);
  }
  return html.replace(re, (_, open, _inner, close) => `${open}\n${replacement}\n        ${close}`);
}

(async () => {
  const env = loadEnv(ENV_PATH);
  const required = [
    "ONEBOX_CLIENT_ID",
    "ONEBOX_CLIENT_SECRET",
    "ONEBOX_CHANNEL_ID",
    "ONEBOX_API_ENDPOINT",
  ];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    console.error(`Missing in .env: ${missing.join(", ")}`);
    process.exit(1);
  }

  const authBody = new URLSearchParams({
    grant_type: "client_credentials",
    channel_id: env.ONEBOX_CHANNEL_ID,
    client_id: env.ONEBOX_CLIENT_ID,
    client_secret: env.ONEBOX_CLIENT_SECRET,
  }).toString();

  const authRes = await request(env.ONEBOX_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "Content-Length": Buffer.byteLength(authBody),
    },
    body: authBody,
  });
  if (authRes.status !== 200) {
    console.error(`Auth failed (${authRes.status}): ${authRes.body}`);
    process.exit(1);
  }
  const { access_token: token } = JSON.parse(authRes.body);

  const u = new URL(env.ONEBOX_API_ENDPOINT);
  const baseUrl = `${u.protocol}//${u.host}`;

  const [sessionsRes, availRes] = await Promise.all([
    request(`${baseUrl}/catalog-api/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }),
    request(`${baseUrl}/catalog-api/v1/sessions/${SESSION_ID}/availability`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }),
  ]);

  if (sessionsRes.status !== 200) {
    console.error(`Sessions failed (${sessionsRes.status}): ${sessionsRes.body}`);
    process.exit(1);
  }
  if (availRes.status !== 200) {
    console.error(`Availability failed (${availRes.status}): ${availRes.body}`);
    process.exit(1);
  }

  let sessionsList = JSON.parse(sessionsRes.body);
  if (!Array.isArray(sessionsList)) {
    for (const k of ["sessions", "data", "items", "content", "results"]) {
      if (Array.isArray(sessionsList?.[k])) {
        sessionsList = sessionsList[k];
        break;
      }
    }
  }
  const session = sessionsList.find((s) => String(s.id) === String(SESSION_ID));
  if (!session) {
    console.error(`Session ${SESSION_ID} not found in /sessions response.`);
    process.exit(1);
  }

  const avail = JSON.parse(availRes.body);
  const sectors = Array.isArray(avail.sectors) ? avail.sectors : [];
  if (sectors.length === 0) {
    console.error(`No sectors in availability response for session ${SESSION_ID}.`);
    process.exit(1);
  }

  sectors.sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "es", {
      numeric: true,
    })
  );

  const matchInfoHtml = buildMatchInfoHtml(session, avail);

  const optIndent = "            ";
  const optionsHtml = [
    `${optIndent}<option value="" disabled selected>Selecciona una grada</option>`,
    ...sectors.map(
      (s) =>
        `${optIndent}<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`
    ),
  ].join("\n");

  // Runtime config: webhook URL + session metadata for the form submit handler.
  const venue = session.venue || {};
  const venueLine = [venue.name, (venue.location || {}).city]
    .filter(Boolean)
    .join(", ");
  const event = session.event || {};
  const sessionName =
    pickLocalised((event.texts || {}).title || {}) ||
    event.name ||
    session.name ||
    "";
  const startIso = (session.date || {}).start || "";
  const matchDate = startIso ? startIso.slice(0, 10) : "";

  // Derive the Mailchimp public form-post URL.
  // Per-account host comes from /lists/{id}.subscribe_url_long — e.g.
  // "https://gmail.us20.list-manage.com/subscribe?u=...&id=...".
  let mailchimp = null;
  if (env.MAILCHIMP_API_KEY && env.MAILCHIMP_AUDIENCE_ID) {
    const dash = env.MAILCHIMP_API_KEY.lastIndexOf("-");
    const dc = dash > 0 ? env.MAILCHIMP_API_KEY.slice(dash + 1) : null;
    if (dc) {
      const auth =
        "Basic " +
        Buffer.from(`anystring:${env.MAILCHIMP_API_KEY}`).toString("base64");
      const listRes = await request(
        `https://${dc}.api.mailchimp.com/3.0/lists/${env.MAILCHIMP_AUDIENCE_ID}`,
        { headers: { Authorization: auth, Accept: "application/json" } }
      );
      if (listRes.status === 200) {
        const listInfo = JSON.parse(listRes.body);
        const subscribeUrl = listInfo.subscribe_url_long;
        if (subscribeUrl) {
          const u = new URL(subscribeUrl);
          const accountId = u.searchParams.get("u");
          const listId = u.searchParams.get("id");
          mailchimp = {
            formUrl: `${u.origin}/subscribe/post?u=${accountId}&id=${listId}`,
            honeypot: `b_${accountId}_${listId}`,
          };
        }
      } else {
        console.error(
          `Could not fetch Mailchimp list info (status ${listRes.status}); leaving form URL empty.`
        );
      }
    }
  }

  const runtimeConfig = {
    mailchimp,
    session: {
      id: session.id,
      name: sessionName,
      venue: venueLine,
      date: matchDate,
    },
  };
  const runtimeConfigHtml = `        <script type="application/json" id="runtime-config">${JSON.stringify(
    runtimeConfig
  )}</script>`;

  // Hidden form inputs that always submit with the form (the things that
  // don't change per-user). GRADA + PRIVACY are added by the submit handler
  // since they depend on user input / wall-clock time.
  const hiddenIndent = "        ";
  const matchDataLines = [
    `${hiddenIndent}<input type="hidden" name="SESSION" value="${escapeHtml(sessionName)}" />`,
    `${hiddenIndent}<input type="hidden" name="SESSION_ID" value="${escapeHtml(session.id)}" />`,
    `${hiddenIndent}<input type="hidden" name="VENUE" value="${escapeHtml(venueLine)}" />`,
    `${hiddenIndent}<input type="hidden" name="MATCHDATE" value="${escapeHtml(matchDate)}" />`,
  ];
  if (mailchimp && mailchimp.honeypot) {
    matchDataLines.push(
      `${hiddenIndent}<input type="text" name="${escapeHtml(mailchimp.honeypot)}" tabindex="-1" value="" aria-hidden="true" style="position:absolute;left:-5000px" />`
    );
  }
  const matchDataHtml = matchDataLines.join("\n");

  let html = fs.readFileSync(LANDING_PATH, "utf8");

  html = replaceBetweenMarkers(html, "match-info", matchInfoHtml);
  html = replaceBetweenMarkers(html, "runtime-config", runtimeConfigHtml);
  html = replaceBetweenMarkers(html, "match-data", matchDataHtml);

  const selectRe = /(<select\s+id="grada"[^>]*>)[\s\S]*?(<\/select>)/;
  if (!selectRe.test(html)) {
    console.error('Could not locate <select id="grada"> in landing.html');
    process.exit(1);
  }
  html = html.replace(
    selectRe,
    (_, open, close) => `${open}\n${optionsHtml}\n          ${close}`
  );

  fs.writeFileSync(LANDING_PATH, html);

  console.log(
    `Baked match-info + runtime-config + ${sectors.length} sectors into landing.html (session ${SESSION_ID}).`
  );
  if (!mailchimp) {
    console.log(
      "  Note: Mailchimp form URL not configured — set MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID in .env."
    );
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

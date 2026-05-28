#!/usr/bin/env node
"use strict";

/**
 * One-time bootstrap: ensure the Mailchimp audience has every merge field the
 * RC Celta Avísame landing form will populate. Idempotent — re-running is safe.
 */

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, ".env");

const FIELDS = [
  { tag: "FNAME", name: "Nombre", type: "text", required: true, public: true },
  { tag: "LNAME", name: "Apellido", type: "text", required: true, public: true },
  { tag: "PHONE", name: "Teléfono", type: "phone", required: false, public: false, options: { phone_format: "none" } },
  { tag: "GRADA", name: "Grada (nombre)", type: "text", required: false, public: false },
  { tag: "GRADA_ID", name: "Grada (ID ONEBOX)", type: "text", required: false, public: false },
  { tag: "SESSION", name: "Partido (nombre)", type: "text", required: false, public: false },
  { tag: "SESSION_ID", name: "Partido (ID ONEBOX)", type: "text", required: false, public: false },
  { tag: "VENUE", name: "Estadio", type: "text", required: false, public: false },
  { tag: "MATCHDATE", name: "Fecha del partido", type: "date", required: false, public: false, options: { date_format: "YYYY-MM-DD" } },
  { tag: "PRIVACY", name: "Aceptación política privacidad", type: "text", required: false, public: false },
  { tag: "MARKETING", name: "Aceptación marketing (avisos)", type: "text", required: false, public: false },
  { tag: "LANG", name: "Idioma signup", type: "text", required: false, public: false },
];

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

function dataCenter(apiKey) {
  const dash = apiKey.lastIndexOf("-");
  if (dash < 0) {
    throw new Error(
      `MAILCHIMP_API_KEY is not in the expected "<hash>-<dc>" format`
    );
  }
  return apiKey.slice(dash + 1);
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
      res.on("end", () =>
        resolve({ status: res.statusCode, body: buf })
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  const env = loadEnv(ENV_PATH);
  const apiKey = env.MAILCHIMP_API_KEY;
  const audience = env.MAILCHIMP_AUDIENCE_ID;
  if (!apiKey || !audience) {
    console.error(
      "Missing MAILCHIMP_API_KEY or MAILCHIMP_AUDIENCE_ID in .env"
    );
    process.exit(1);
  }

  const dc = dataCenter(apiKey);
  const base = `https://${dc}.api.mailchimp.com/3.0`;
  const auth = `Basic ${Buffer.from(`anystring:${apiKey}`).toString("base64")}`;

  // Inventory existing fields
  const inventoryRes = await request(
    `${base}/lists/${audience}/merge-fields?count=100`,
    { headers: { Authorization: auth, Accept: "application/json" } }
  );
  if (inventoryRes.status !== 200) {
    console.error(
      `Could not list merge fields (status ${inventoryRes.status}): ${inventoryRes.body}`
    );
    process.exit(1);
  }
  const existing = JSON.parse(inventoryRes.body).merge_fields || [];
  const existingTags = new Set(existing.map((f) => f.tag));

  let created = 0;
  let existed = 0;
  const creations = [];

  for (const field of FIELDS) {
    if (existingTags.has(field.tag)) {
      existed += 1;
      continue;
    }
    const payload = JSON.stringify(field);
    const res = await request(`${base}/lists/${audience}/merge-fields`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      body: payload,
    });
    if (res.status >= 200 && res.status < 300) {
      created += 1;
      creations.push(field.tag);
    } else {
      console.error(
        `Failed to create merge field ${field.tag} (status ${res.status}): ${res.body}`
      );
      process.exit(1);
    }
  }

  console.log(
    `Synced ${FIELDS.length} merge fields on audience ${audience} (created: ${created}, existed: ${existed}).`
  );
  if (creations.length) {
    console.log(`  Created: ${creations.join(", ")}`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

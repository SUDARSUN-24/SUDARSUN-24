// Builds the animated profile cards (light + dark) from live GitHub data.
// Usage: GITHUB_TOKEN=... node build.mjs <outDir> [lighthouse.json]
// No dependencies: Node 20+ (global fetch).
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { SANS, MONO } from "./fonts.mjs";

const LOGIN = process.env.PROFILE_LOGIN || "SUDARSUN-24";
const SITE = "sudasun.vercel.app";
const OUT = process.argv[2] || "dist";
const LH = process.argv[3];
mkdirSync(OUT, { recursive: true });

const PALETTE = ["#8b5cf6", "#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#fb7185"];
const THEMES = {
  light: { bg: "#ffffff", border: "#d1d9e0", ink: "#1f2328", muted: "#59636e", track: "#eff2f5", grid: "#eaeef2" },
  dark: { bg: "#0d1117", border: "#3d444d", ink: "#f0f6fc", muted: "#9198a1", track: "#21262d", grid: "#21262d" },
};

// ---------- data ----------
async function gql(query) {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const { user } = await gql(`{ user(login: "${LOGIN}") {
  repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
    totalCount nodes { stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } } }
  contributionsCollection { totalCommitContributions totalPullRequestContributions
    contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`);

const cc = user.contributionsCollection;
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
const today = new Date().toISOString().slice(0, 10);

let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  const d = days[i];
  if (d.contributionCount > 0) current++;
  else if (d.date === today && current === 0) continue; // today not started yet
  else break;
}

const langs = {};
let stars = 0;
for (const r of user.repositories.nodes) {
  stars += r.stargazerCount;
  for (const e of r.languages.edges) {
    const l = (langs[e.node.name] ||= { size: 0, color: e.node.color || "#8b949e" });
    l.size += e.size;
  }
}

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = (n) => n.toLocaleString("en-US");

function frame(t, w, h, body, css, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t">
<title id="t">${esc(title)}</title>
<style>
@font-face{font-family:G;src:url(data:font/woff2;base64,${SANS}) format("woff2")}
@font-face{font-family:GM;src:url(data:font/woff2;base64,${MONO}) format("woff2")}
text{font-family:G,-apple-system,"Segoe UI",sans-serif;fill:${t.ink}}
.h{font-size:15px;font-weight:600}
.m{fill:${t.muted};font-size:13px}
.k{font-family:GM,ui-monospace,monospace;fill:${t.muted};font-size:11px;letter-spacing:1.2px}
.in{animation:in .7s ease-out both}
@keyframes in{from{opacity:0;transform:translateY(6px)}}
${css}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
${body}
</svg>`;
}

// Odometer: each digit is a 0-9 column (twice) clipped to one row, rolled into place.
const DIG_W = 0.6; // Geist Mono advance in em
function odometer(x, y, value, size, color, delay, id) {
  const s = fmt(value);
  const lh = size * 1.5; // row pitch; the clip shows exactly one row
  let out = `<clipPath id="${id}"><rect x="${x - 2}" y="${y - size * 0.82}" width="${s.length * size * DIG_W + 4}" height="${size * 1.02}"/></clipPath><g clip-path="url(#${id})">`;
  [...s].forEach((ch, i) => {
    const cx = x + i * size * DIG_W;
    if (!/\d/.test(ch)) { out += `<text x="${cx}" y="${y}" class="num" style="font-size:${size}px;fill:${color}">${ch}</text>`; return; }
    const d = +ch, col = [...Array(20).keys()].map((k) => k % 10);
    const tsp = col.map((n, k) => `<tspan x="${cx}" y="${y + k * lh}">${n}</tspan>`).join("");
    out += `<g class="roll" style="transform:translateY(${-(10 + d) * lh}px);animation-delay:${(delay + i * 0.08).toFixed(2)}s"><text class="num" style="font-size:${size}px;fill:${color}">${tsp}</text></g>`;
  });
  return out + "</g>";
}

// ---------- cards ----------
function statsCard(t) {
  const W = 600, H = 300;
  const tiles = [
    ["CONTRIBUTIONS", cc.contributionCalendar.totalContributions, "last 12 months"],
    ["COMMITS", cc.totalCommitContributions, "last 12 months"],
    ["PULL REQUESTS", cc.totalPullRequestContributions, "last 12 months"],
    ["PUBLIC REPOS", user.repositories.totalCount, `${stars} ${stars === 1 ? "star" : "stars"}`],
    ["CURRENT STREAK", current, current === 1 ? "day" : "days"],
    ["LONGEST STREAK", longest, longest === 1 ? "day" : "days"],
  ];
  let body = `<text x="28" y="44" class="h in">GitHub stats</text><text x="${W - 28}" y="44" class="m in" text-anchor="end">@${LOGIN}</text>`;
  tiles.forEach(([label, v, sub], i) => {
    const cx = 28 + (i % 3) * 186, cy = 92 + Math.floor(i / 3) * 104, c = PALETTE[i];
    body += `<rect x="${cx}" y="${cy - 14}" width="3" height="80" rx="1.5" fill="${c}" class="bar" style="animation-delay:${0.1 + i * 0.08}s"/>`;
    body += `<text x="${cx + 14}" y="${cy}" class="k">${label}</text>`;
    body += odometer(cx + 14, cy + 40, v, 34, t.ink, 0.25 + i * 0.1, `o${i}`);
    body += `<text x="${cx + 14}" y="${cy + 62}" class="m in" style="animation-delay:${0.6 + i * 0.1}s">${esc(sub)}</text>`;
  });
  const css = `.num{font-family:GM,ui-monospace,monospace;font-weight:400}
.roll{animation:roll 1.6s cubic-bezier(.2,.8,.2,1) both}@keyframes roll{from{transform:translateY(0)}}
.bar{transform-box:fill-box;transform-origin:bottom;animation:grow .8s cubic-bezier(.2,.8,.2,1) both}@keyframes grow{from{transform:scaleY(0)}}`;
  return frame(t, W, H, body, css, `GitHub stats: ${tiles.map(([l, v]) => `${l.toLowerCase()} ${v}`).join(", ")}`);
}

function langCard(t) {
  const W = 600, H = 300;
  const total = Object.values(langs).reduce((a, l) => a + l.size, 0) || 1;
  let list = Object.entries(langs).sort((a, b) => b[1].size - a[1].size);
  const top = list.slice(0, 7), rest = list.slice(7).reduce((a, [, l]) => a + l.size, 0);
  if (rest / total >= 0.001) top.push(["Other", { size: rest, color: "#8b949e" }]);
  let body = `<text x="28" y="44" class="h in">Top languages</text><text x="${W - 28}" y="44" class="m in" text-anchor="end">public repos, by code size</text>`;
  const bx = 28, bw = W - 56; let x = bx;
  body += `<clipPath id="bar"><rect x="${bx}" y="72" width="${bw}" height="14" rx="7"/></clipPath><rect x="${bx}" y="72" width="${bw}" height="14" rx="7" fill="${t.track}"/><g clip-path="url(#bar)">`;
  top.forEach(([, l], i) => {
    const w = (l.size / total) * bw;
    body += `<rect x="${x.toFixed(1)}" y="72" width="${(w + 0.5).toFixed(1)}" height="14" fill="${l.color}" class="seg" style="animation-delay:${0.2 + i * 0.12}s"/>`;
    x += w;
  });
  body += "</g>";
  top.forEach(([name, l], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 28 + col * 280, ly = 128 + row * 40, pct = (l.size / total) * 100;
    body += `<g class="in" style="animation-delay:${0.5 + i * 0.08}s"><circle cx="${lx + 6}" cy="${ly - 5}" r="6" fill="${l.color}"/>
<text x="${lx + 22}" y="${ly}" style="font-size:14px;font-weight:500">${esc(name)}</text>
<text x="${lx + 250}" y="${ly}" class="m" text-anchor="end" style="font-family:GM,monospace">${pct < 0.1 ? "&lt;0.1" : pct.toFixed(1)}%</text></g>`;
  });
  const css = `.seg{transform-box:fill-box;transform-origin:left;animation:grow 1s cubic-bezier(.2,.8,.2,1) both}@keyframes grow{from{transform:scaleX(0)}}`;
  return frame(t, W, H, body, css, `Top languages: ${top.map(([n, l]) => `${n} ${((l.size / total) * 100).toFixed(1)}%`).join(", ")}`);
}

function activityCard(t) {
  const W = 1220, H = 300, L = 56, R = 28, T = 76, B = 50;
  const weeks = cc.contributionCalendar.weeks.map((w) => ({
    start: w.contributionDays[0].date,
    n: w.contributionDays.reduce((a, d) => a + d.contributionCount, 0),
  }));
  const max = Math.max(4, ...weeks.map((w) => w.n));
  const nice = Math.ceil(max / 4) * 4;
  const px = (i) => L + (i / (weeks.length - 1)) * (W - L - R);
  const py = (n) => H - B - (n / nice) * (H - T - B);
  const pts = weeks.map((w, i) => [px(i), py(w.n)]);
  // Catmull-Rom → cubic Bézier, clamped so the curve never dips below zero.
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const base = H - B;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(base, p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(base, p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const area = `${d} L${px(weeks.length - 1).toFixed(1)},${H - B} L${L},${H - B} Z`;
  let grid = "";
  for (let k = 0; k <= 4; k++) {
    const v = (nice / 4) * k, y = py(v);
    grid += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${t.grid}"/><text x="${L - 12}" y="${y + 4}" class="m" text-anchor="end" style="font-size:11px;font-family:GM,monospace">${v}</text>`;
  }
  let lastM = "";
  weeks.forEach((w, i) => {
    const m = new Date(w.start + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    if (m !== lastM && i > 0 && i < weeks.length - 2) grid += `<text x="${px(i)}" y="${H - B + 24}" class="m" text-anchor="middle" style="font-size:11px">${m}</text>`;
    lastM = m;
  });
  const peak = weeks.reduce((a, w, i) => (w.n > weeks[a].n ? i : a), 0);
  const [lx, ly] = pts[pts.length - 1];
  const stops = PALETTE.slice(0, 5).map((c, i) => `<stop offset="${i / 4}" stop-color="${c}"/>`).join("");
  const body = `<defs><linearGradient id="lg">${stops}</linearGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="mk"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask></defs>
<text x="28" y="44" class="h in">Contribution activity</text>
<text x="${W - 28}" y="44" class="m in" text-anchor="end">${fmt(cc.contributionCalendar.totalContributions)} contributions in the last year · per week</text>
${grid}
<path d="${area}" fill="url(#lg)" mask="url(#mk)" class="area"/>
<path d="${d}" fill="none" stroke="url(#lg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="1" class="line"/>
<g class="in" style="animation-delay:1.6s"><circle cx="${pts[peak][0]}" cy="${pts[peak][1]}" r="4.5" fill="${t.bg}" stroke="${PALETTE[4]}" stroke-width="2.5"/>
<text x="${pts[peak][0] > W - 160 ? pts[peak][0] - 12 : pts[peak][0]}" y="${pts[peak][1] - (pts[peak][0] > W - 160 ? -4 : 12)}" text-anchor="${pts[peak][0] > W - 160 ? "end" : "middle"}" style="font-size:12px;font-weight:600">${weeks[peak].n} · best week</text></g>
<circle cx="${lx}" cy="${ly}" r="5" fill="${PALETTE[3]}" class="pulse"/><circle cx="${lx}" cy="${ly}" r="4" fill="${PALETTE[3]}"/>`;
  const css = `.line{stroke-dasharray:1;animation:draw 2.2s cubic-bezier(.5,0,.2,1) both}@keyframes draw{from{stroke-dashoffset:1}}
.area{animation:fade 1.2s 1s ease-out both}@keyframes fade{from{opacity:0}}
.pulse{transform-box:fill-box;transform-origin:center;animation:pulse 2s 2.2s ease-out infinite;opacity:0}@keyframes pulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(3.2);opacity:0}}`;
  return frame(t, W, H, body, css, `Contribution activity: ${cc.contributionCalendar.totalContributions} contributions in the last year, best week ${weeks[peak].n}`);
}

function lighthouseCard(t, lh) {
  const W = 1220, H = 250;
  const cats = [["performance", "Performance"], ["accessibility", "Accessibility"], ["best-practices", "Best Practices"], ["seo", "SEO"]];
  const when = new Date(lh.fetchTime).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  let body = `<text x="28" y="44" class="h in">Lighthouse · ${SITE}</text>
<text x="${W - 28}" y="44" class="m in" text-anchor="end">desktop audit, re-run daily by GitHub Actions · ${when}</text>`;
  const r = 44, cw = (W - 56) / 4;
  cats.forEach(([key, label], i) => {
    const s = Math.round((lh.categories[key]?.score ?? 0) * 100);
    const c = s >= 90 ? "#0cce6b" : s >= 50 ? "#ffa400" : "#ff4e42";
    const cx = 28 + cw * i + cw / 2, cy = 140, delay = 0.2 + i * 0.15;
    body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-opacity=".18" stroke-width="7"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" pathLength="100" stroke-dasharray="${s} 100" transform="rotate(-90 ${cx} ${cy})" class="ring" style="animation-delay:${delay}s"/>
<g class="in" style="animation-delay:${delay + 0.5}s"><text x="${cx}" y="${cy + 10}" text-anchor="middle" style="font-family:GM,monospace;font-size:28px;fill:${c}">${s}</text></g>
<text x="${cx}" y="${cy + r + 34}" text-anchor="middle" style="font-size:14px;font-weight:500" class="in">${label}</text>`;
  });
  const css = `.ring{animation:ring 1.4s cubic-bezier(.3,.7,.2,1) both}@keyframes ring{from{stroke-dasharray:0 100}}`;
  return frame(t, W, H, body, css, `Lighthouse scores for ${SITE}: ${cats.map(([k, l]) => `${l} ${Math.round((lh.categories[k]?.score ?? 0) * 100)}`).join(", ")}`);
}

// ---------- write ----------
for (const [name, t] of Object.entries(THEMES)) {
  writeFileSync(`${OUT}/stats-${name}.svg`, statsCard(t));
  writeFileSync(`${OUT}/languages-${name}.svg`, langCard(t));
  writeFileSync(`${OUT}/activity-${name}.svg`, activityCard(t));
}
if (LH && existsSync(LH)) {
  const lh = JSON.parse(readFileSync(LH, "utf8"));
  for (const [name, t] of Object.entries(THEMES)) writeFileSync(`${OUT}/lighthouse-${name}.svg`, lighthouseCard(t, lh));
  console.log("lighthouse", Object.fromEntries(Object.entries(lh.categories).map(([k, v]) => [k, v.score])));
} else {
  // Lighthouse failed this run: keep yesterday's card instead of a broken image.
  for (const name of Object.keys(THEMES)) {
    const r = await fetch(`https://raw.githubusercontent.com/${LOGIN}/${LOGIN}/output/lighthouse-${name}.svg`);
    if (r.ok) writeFileSync(`${OUT}/lighthouse-${name}.svg`, await r.text());
  }
  console.log("lighthouse: no report, kept previous card");
}
console.log({ total: cc.contributionCalendar.totalContributions, commits: cc.totalCommitContributions, current, longest, langs: Object.keys(langs).length });

#!/usr/bin/env node
// which-page — descobre que ficheiro de página corresponde ao ecrã que estás a ver.
//
// Uso:
//   node scripts/which-page.mjs            # lê a URL do browser activo (Arc/Chrome/Safari/Brave/Edge)
//   node scripts/which-page.mjs /faturacao # resolve uma rota explícita
//   node scripts/which-page.mjs --open     # além de imprimir, abre o ficheiro no VS Code (editor activo)
//   node scripts/which-page.mjs /obras/123 --open
//
// Parseia src/App.tsx em runtime, por isso acompanha sempre as rotas reais.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// Raiz do projeto-alvo (a app do site). Configurável — o package vive noutro sítio.
const root = process.env.AGENT_PROJECT_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ───────────────────────── Resolvers de rota por framework ─────────────────────────
// O which-page suporta vários routers. Escolhe o adapter pelo que existe no projeto,
// para que rota→ficheiro funcione tanto no iocmanager (react-router) como no
// grupo-jantar (TanStack) ou em apps Next. Cada adapter devolve {kind, routes:[{path,file,comp}]}.

const RX_TSX = /\.[jt]sx?$/;
const listFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir, { recursive: true }).map((p) => String(p).replace(/\\/g, "/")) : [];

// react-router: parseia src/App.tsx (<Route path="/x" element={<XPage/>} />).
function buildReactRouter(root) {
  const appPath = join(root, "src", "App.tsx");
  if (!existsSync(appPath)) return null;
  const appSrc = readFileSync(appPath, "utf8");
  if (!/<Route\b/.test(appSrc)) return null;

  const compToFile = {};
  for (const m of appSrc.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\(["']([^"']+)["']\)\)/g))
    compToFile[m[1]] = m[2].replace(/^\.\//, "src/").replace(/^src\/src\//, "src/") + ".tsx";
  for (const m of appSrc.matchAll(/import\s+\{?\s*(\w+)\s*\}?\s+from\s+["'](\.\/pages\/[^"']+)["']/g))
    compToFile[m[1]] = m[2].replace(/^\.\//, "src/") + ".tsx";

  const routes = [];
  for (const m of appSrc.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
    const comps = [...m[2].matchAll(/<(\w+)\s*\/?>/g)].map((x) => x[1]);
    const pageComp = comps.reverse().find((c) => compToFile[c]);
    if (pageComp) routes.push({ path: m[1], file: compToFile[pageComp], comp: pageComp });
  }
  return routes.length ? { kind: "react-router", routes } : null;
}

// TanStack Router: file-based em src/routes (flat por '.' e/ou por pastas).
// restaurant.salas.tsx → /restaurant/salas ; menus.$id.tsx → /menus/:id ; index → segmento do pai.
function buildTanstack(root) {
  const dir = join(root, "src", "routes");
  if (!existsSync(dir)) return null;

  const files = listFiles(dir).filter((f) => RX_TSX.test(f));
  // flatBase = caminho relativo sem extensão, com '/' e '.' unificados em '.' (chave de nesting).
  const flatBase = (rel) => rel.replace(RX_TSX, "").replace(/\//g, ".");
  const bases = new Set(files.map(flatBase));

  const routes = [];
  for (const rel of files) {
    const name = rel.split("/").pop().replace(RX_TSX, "");
    if (name.startsWith("__") || name === "route") continue; // __root, ficheiros de layout
    const fb = flatBase(rel);
    if (bases.has(fb + ".index")) continue; // é o layout; o irmão .index serve a página deste path

    const segs = [];
    for (let s of fb.split(".")) {
      if (s === "index") continue; // index → path do pai
      if (s.startsWith("_")) continue; // _layout pathless → sem segmento no URL
      s = s.replace(/_$/, ""); // trailing _ (opt-out de nesting) → mesmo URL
      if (s === "$") s = "*"; // splat
      else if (s.startsWith("$")) s = ":" + s.slice(1); // $id → :id
      segs.push(s);
    }
    routes.push({ path: "/" + segs.join("/"), file: "src/routes/" + rel, comp: name });
  }
  return routes.length ? { kind: "tanstack", routes } : null;
}

// Next.js (app/ ou pages/): [param] → :param, [...x] → *, grupos (x) ignorados.
function buildNext(root) {
  for (const baseRel of ["app", "src/app", "pages", "src/pages"]) {
    const dir = join(root, baseRel);
    if (!existsSync(dir)) continue;
    const isApp = baseRel.endsWith("app");
    const routes = [];
    for (const rel of listFiles(dir)) {
      const name = rel.split("/").pop();
      if (isApp ? !/^(page|route)\.[jt]sx?$/.test(name) : !RX_TSX.test(name)) continue;
      if (!isApp && /^_/.test(name)) continue; // _app, _document

      let parts = isApp ? rel.split("/").slice(0, -1) : rel.replace(RX_TSX, "").split("/");
      if (!isApp && parts[parts.length - 1] === "index") parts.pop();
      const url = parts
        .filter((s) => !/^\(.*\)$/.test(s)) // route groups
        .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, "*").replace(/^\[(.+)\]$/, ":$1"))
        .join("/");
      routes.push({ path: "/" + url, file: baseRel + "/" + rel, comp: name });
    }
    if (routes.length) return { kind: isApp ? "next-app" : "next-pages", routes };
  }
  return null;
}

const resolved = buildReactRouter(root) || buildTanstack(root) || buildNext(root);
if (!resolved) {
  console.error("✗ Router não reconhecido (sem src/App.tsx com <Route>, src/routes/, app/ ou pages/).");
  process.exit(1);
}
const { kind: routerKind, routes } = resolved;

function matchRoute(pathname) {
  // match exacto
  let r = routes.find((x) => x.path === pathname);
  if (r) return r;
  // match com params (:id) — compara segmento a segmento
  const segs = pathname.split("/").filter(Boolean);
  return routes.find((x) => {
    const ps = x.path.split("/").filter(Boolean);
    if (ps.length !== segs.length) return false;
    return ps.every((p, i) => p.startsWith(":") || p === segs[i]);
  });
}

// Só nos interessam URLs da própria app (preview local ou produção).
// Configurável por site via BRIDGE_APP_HOSTS (regex), ex: "localhost:8080|.*grupojantar.*".
const APP_HOST = new RegExp(
  `^(${process.env.BRIDGE_APP_HOSTS || "localhost:\\d+|.*\\.lovable\\.app|.*\\.lovableproject\\.com|.*\\.vercel\\.app"})$`,
  "i"
);
function isAppUrl(u) {
  try {
    const x = new URL(u);
    return APP_HOST.test(x.host);
  } catch {
    return false;
  }
}

// Marca: a aba que o owner quer que o Claude veja leva ?claude=1 (ou #claude).
// Configurável via BRIDGE_FLAG. Distingue do uso NORMAL da app.
const FLAG = process.env.BRIDGE_FLAG || "claude";
function isMarked(u) {
  try {
    const x = new URL(u);
    return x.searchParams.has(FLAG) || x.hash.replace(/^#/, "").split("&").includes(FLAG);
  } catch {
    return false;
  }
}

// Devolve { marked: [...], plain: [...] } — abas da app com e sem a marca ?claude.
function collectAppTabs() {
  const marked = [];
  const plain = [];
  const push = (url, browser) => {
    if (!isAppUrl(url)) return;
    (isMarked(url) ? marked : plain).push({ url, browser });
  };
  const chromium = [
    ["Arc", "Arc"],
    ["Google Chrome", "Chrome"],
    ["Brave Browser", "Brave"],
    ["Microsoft Edge", "Edge"],
  ];
  for (const [appName, label] of chromium) {
    try {
      const out = execSync(
        `osascript -e 'tell application "${appName}" to return URL of every tab of every window'`,
        { stdio: ["ignore", "pipe", "ignore"] }
      )
        .toString()
        .trim();
      if (out) for (const u of out.split(",").map((s) => s.trim())) push(u, label);
    } catch {}
  }
  try {
    const out = execSync(
      `osascript -e 'tell application "Safari" to return URL of front document'`,
      { stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();
    push(out, "Safari");
  } catch {}
  return { marked, plain };
}

const args = process.argv.slice(2);
const doOpen = args.includes("--open");
const explicit = args.find((a) => a.startsWith("/"));

// --table: regenera o bloco de rotas no CLAUDE.md entre os marcadores HTML.
if (args.includes("--table")) {
  const rows = [...routes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((r) => `| \`${r.path}\` | \`${r.file}\` |`)
    .join("\n");
  const claudeMd = join(root, "CLAUDE.md");
  const txt = readFileSync(claudeMd, "utf8");
  const marker = /<!-- ROUTES_TABLE_START -->[\s\S]*?<!-- ROUTES_TABLE_END -->/;
  if (!marker.test(txt)) {
    console.error("✗ Marcadores ROUTES_TABLE_START/END não encontrados no CLAUDE.md");
    process.exit(1);
  }
  const next = txt.replace(marker, `<!-- ROUTES_TABLE_START -->\n${rows}\n<!-- ROUTES_TABLE_END -->`);
  if (next === txt) {
    console.log(`✓ CLAUDE.md: já actualizado (${routes.length} rotas)`);
    process.exit(0);
  }
  writeFileSync(claudeMd, next);
  console.log(`✓ CLAUDE.md: tabela regenerada com ${routes.length} rotas`);
  process.exit(0);
}

const allowAny = args.includes("--any");

let pathname, sourceLabel;
if (explicit) {
  pathname = explicit;
  sourceLabel = `rota: ${pathname}`;
} else {
  const { marked, plain } = collectAppTabs();
  let b;
  if (marked.length) {
    b = { ...marked[0], mode: `🎯 modo Claude (?${FLAG})` };
  } else if (plain.length && allowAny) {
    b = { ...plain[0], mode: "aba normal (--any)" };
  } else if (plain.length) {
    // Há app aberta, mas nenhuma aba marcada → não confundir com uso normal.
    console.error(`✗ Nenhuma aba em modo Claude. Encontrei ${plain.length} aba(s) normal(is) da app.`);
    console.error(`  Marca a aba que queres que eu veja juntando ?${FLAG}=1 à URL, ex:`);
    console.error(`      ${plain[0].url.split("#")[0].split("?")[0]}?${FLAG}=1`);
    console.error(`  Ou força a aba normal:  node scripts/which-page.mjs --any`);
    process.exit(3);
  } else {
    console.error("✗ Não encontrei nenhuma aba da app (Arc/Chrome/Brave/Edge/Safari).");
    console.error("  Passa a rota à mão:  node scripts/which-page.mjs /faturacao");
    process.exit(2);
  }
  try {
    pathname = new URL(b.url).pathname;
  } catch {
    console.error("✗ URL inválida: " + b.url);
    process.exit(2);
  }
  sourceLabel = `${b.mode}  ·  ${b.browser} → ${b.url}`;
}

const hit = matchRoute(pathname);
if (!hit) {
  console.error(`✗ Sem rota correspondente a "${pathname}" (${routerKind}) (${sourceLabel})`);
  process.exit(1);
}

console.log(`📄 ${hit.file}`);
console.log(`   rota ${hit.path}  ·  <${hit.comp}>  ·  ${sourceLabel}`);

// --shot: printscreen REAL da janela do browser com a aba marcada.
// Traz a janela à frente e captura só essa janela (não o ecrã todo).
if (args.includes("--shot")) {
  const browserApp = {
    Arc: "Arc",
    Chrome: "Google Chrome",
    Brave: "Brave Browser",
    Edge: "Microsoft Edge",
    Safari: "Safari",
  }[(sourceLabel.match(/·\s+(\w+) →/) || [])[1] || "Chrome"] || "Google Chrome";

  const out = join("/tmp", `terminal-bridge-view-${Date.now()}.png`);
  // Encontra a JANELA que tem a aba marcada, traz essa janela ao topo e
  // devolve os bounds DELA (não da "front window" ambígua). bounds = {x1,y1,x2,y2}.
  const focusAndBounds = `
tell application "${browserApp}"
  activate
  set theBounds to missing value
  repeat with w in windows
    set tl to tabs of w
    repeat with i from 1 to count of tl
      if URL of item i of tl contains "${FLAG}" then
        set active tab index of w to i
        set index of w to 1
        set theBounds to bounds of w
        exit repeat
      end if
    end repeat
    if theBounds is not missing value then exit repeat
  end repeat
end tell
delay 0.6
return theBounds`;
  try {
    // execFileSync: passa o script multi-linha como UM argumento (newlines reais, sem shell).
    const raw = execFileSync("osascript", ["-e", focusAndBounds], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim(); // ex: "12, 25, 1412, 925"  (x1, y1, x2, y2)
    const [x1, y1, x2, y2] = raw.split(",").map((n) => parseInt(n.trim(), 10));
    if ([x1, y1, x2, y2].some(Number.isNaN)) throw new Error("bounds inválidos: " + raw);
    const [x, y, w, h] = [x1, y1, x2 - x1, y2 - y1];
    execFileSync("screencapture", ["-x", `-R${x},${y},${w},${h}`, out], { stdio: "ignore" });
    console.log(`📸 ${out}`);
    console.log(`   printscreen da janela ${browserApp} — o Claude pode lê-lo com a tool Read`);
  } catch (e) {
    console.error("   ✗ falha no printscreen: " + e.message);
    process.exit(4);
  }
}

if (doOpen) {
  try {
    execSync(`code -r -g ${JSON.stringify(join(root, hit.file) + ":1")}`, { stdio: "ignore" });
    console.log("   ✓ aberto no VS Code (agora é o ficheiro activo que o Claude vê)");
  } catch (e) {
    console.error("   ✗ não consegui abrir no VS Code: " + e.message);
  }
}

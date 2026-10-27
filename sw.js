// Tiene in cache i file dell'app, così si apre anche senza rete.
// I dati del foglio non passano di qui: arrivano sempre da Google.
const VERSION = "mc-v15";
const SHELL = [
  "./", "./index.html", "./app.js", "./config.js", "./manifest.webmanifest",
  "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/favicon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Prima la rete (così gli aggiornamenti arrivano subito), poi la cache se sei offline.
  // "no-cache": GitHub Pages fa tenere i file 10 minuti; così il telefono chiede sempre se sono cambiati.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then(res => {
        // Solo le risposte buone: una pagina di errore in cache verrebbe poi servita offline.
        if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./index.html")))
  );
});

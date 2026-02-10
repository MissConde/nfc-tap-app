self.addEventListener('install', (e) => {
    console.log('Service Worker: Installed');
  });
  
  self.addEventListener('fetch', (e) => {
    // This allows the app to load even with spotty festival Wi-Fi
    e.respondWith(fetch(e.request));
  });
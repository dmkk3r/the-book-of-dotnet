/** Registers the service worker (production builds only) and shows a notice while offline. */
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
    // Without a service worker the site simply works online only.
  });
}

const notice = document.querySelector<HTMLElement>('[data-offline-notice]');
const update = () => {
  if (notice) notice.hidden = navigator.onLine;
};
window.addEventListener('online', update);
window.addEventListener('offline', update);
update();

export {};

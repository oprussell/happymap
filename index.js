/* Full index.js — final merged version
 *
 * - Uses Open-Meteo for forecasts (including sunshine/sunset) always.
 * - Uses NWS for current observation inside the US (shows "Loading..." until NWS arrives).
 * - Truncates condition text with "..." in compact mode and recomputes on hover/resize so it expands when widget grows.
 * - Badge shows "NWS" when NWS is the current provider, otherwise "Open-Meteo".
 * - Icons update immediately after data changes (NWS or Open-Meteo).
 *
 * Paste this as a complete index.js in your project.
 */

let initialZoom = 15;
let mapLoaded = false;
let map;

const BOOKMARKS_STORAGE_KEY = 'openfreemap_user_bookmarks_v2';
let bookmarks = loadBookmarks();

function loadBookmarks() {
  try {
    const stored = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length === 5) {
        return parsed;
      }
    }
  } catch (e) {}
  return [null, null, null, null, null];
}

function saveBookmarks() {
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
  } catch (e) {}
}

const bookmarkMiniMaps = {};

function initMap(lng, lat) {
  if (mapLoaded) return;
  mapLoaded = true;

  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [lng, lat],
    zoom: initialZoom,
    pitch: 60,
    bearing: 0
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-left');

  map.on('style.load', () => {
    if (currentStyleUrl.includes('liberty')) {
      add3DBuildings(map);
    }
  });

  styleConfigs.forEach(cfg => {
    const miniMap = new maplibregl.Map({
      container: cfg.id,
      style: cfg.style,
      center: [lng, lat],
      zoom: initialZoom,
      pitch: cfg.has3d ? 45 : 0,
      bearing: 0,
      interactive: false,
      attributionControl: false
    });

    if (cfg.has3d) {
      miniMap.on('style.load', () => add3DBuildings(miniMap));
    }

    miniMaps[cfg.style] = miniMap;
  });

  initBookmarkMiniMaps();
  renderBookmarksUI();

  map.on('move', syncMiniMaps);
  map.on('rotate', updateWindArrow);

  map.on('moveend', () => {
    clearTimeout(fetchTimeout);
    fetchTimeout = setTimeout(() => {
      updateWeatherForCenter();
      updateLocalTimezoneForCenter();
    }, 400);
  });

  // attach hover recompute for ellipsis behavior
  attachWidgetHoverRecompute();

  updateWeatherForCenter();
  updateLocalTimezoneForCenter();
}

function initBookmarkMiniMaps() {
  bookmarks.forEach((bm, index) => {
    const thumbId = `bm-thumb-${index}`;
    const container = document.getElementById(thumbId);
    container.innerHTML = '';

    if (bm) {
      const innerDiv = document.createElement('div');
      innerDiv.id = `bm-minimap-${index}`;
      innerDiv.style.width = '100%';
      innerDiv.style.height = '100%';
      container.appendChild(innerDiv);

      const bmMap = new maplibregl.Map({
        container: innerDiv.id,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [bm.lng, bm.lat],
        zoom: bm.zoom || 15,
        pitch: 0,
        bearing: 0,
        interactive: false,
        attributionControl: false
      });
      bookmarkMiniMaps[index] = bmMap;
    } else {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'bookmark-empty-state';
      emptyDiv.innerText = '+';
      container.appendChild(emptyDiv);
    }
  });
}

function renderBookmarksUI() {
  bookmarks.forEach((bm, index) => {
    const itemEl = document.querySelector(`.bookmark-item[data-index="${index}"]`);
    const labelEl = document.getElementById(`bm-label-${index}`);
    const menuTitleEl = document.getElementById(`bm-menu-title-${index}`);

    if (bm) {
      itemEl.classList.add('filled');
      const name = bm.name || `Slot ${index + 1}`;
      labelEl.innerText = name;
      labelEl.setAttribute('title', name);
      menuTitleEl.innerText = name;
    } else {
      itemEl.classList.remove('filled');
      labelEl.innerText = `Slot ${index + 1}`;
      labelEl.setAttribute('title', `Slot ${index + 1}`);
      menuTitleEl.innerText = `Slot ${index + 1}`;
    }
  });
}

function requestUserLocation() {
  const fallbackLngLat = [-79.0558, 35.9132];

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        initMap(position.coords.longitude, position.coords.latitude);
      },
      (error) => {
        initMap(fallbackLngLat[0], fallbackLngLat[1]);
      }, {
        timeout: 10000,
        maximumAge: 60000,
        enableHighAccuracy: true
      }
    );
  } else {
    initMap(fallbackLngLat[0], fallbackLngLat[1]);
  }
}

requestUserLocation();

function add3DBuildings(targetMap = map) {
  if (targetMap.getLayer('3d-buildings')) return;

  const layers = targetMap.getStyle().layers;
  let labelLayerId;
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].type === 'symbol' && layers[i].layout['text-field']) {
      labelLayerId = layers[i].id;
      break;
    }
  }

  targetMap.addLayer({
      'id': '3d-buildings',
      'source': 'openmaptiles',
      'source-layer': 'building',
      'type': 'fill-extrusion',
      'minzoom': 14,
      'paint': {
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['get', 'render_height'],
          0, '#d1d1d1',
          50, '#bfe3f0',
          150, '#9ac8eb'
        ],
        'fill-extrusion-height': [
          'coalesce',
          ['get', 'render_height'],
          ['get', 'height'],
          10
        ],
        'fill-extrusion-base': [
          'coalesce',
          ['get', 'render_min_height'],
          ['get', 'min_height'],
          0
        ],
        'fill-extrusion-opacity': 0.85
      }
    },
    labelLayerId
  );
}

let currentStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';

const styleConfigs = [{
    id: 'thumb-liberty',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    has3d: true
  },
  {
    id: 'thumb-bright',
    style: 'https://tiles.openfreemap.org/styles/bright',
    has3d: false
  },
  {
    id: 'thumb-positron',
    style: 'https://tiles.openfreemap.org/styles/positron',
    has3d: false
  },
  {
    id: 'thumb-dark',
    style: 'https://tiles.openfreemap.org/styles/dark',
    has3d: false
  },
  {
    id: 'thumb-fiord',
    style: 'https://tiles.openfreemap.org/styles/fiord',
    has3d: false
  }
];

const miniMaps = {};

function syncMiniMaps() {
  if (!map) return;
  const center = map.getCenter();
  const zoom = map.getZoom();
  const bearing = map.getBearing();
  const pitch = map.getPitch();

  Object.values(miniMaps).forEach(m => {
    m.jumpTo({
      center: center,
      zoom: Math.max(0, zoom - 1),
      bearing: bearing,
      pitch: m.getStyle().sprite && m.getStyle().sprite.includes('liberty') ? Math.min(pitch, 45) : 0
    });
  });
}

const styleContainer = document.getElementById('style-selector-container');
styleContainer.addEventListener('mouseenter', () => {
  Object.values(miniMaps).forEach(m => m.resize());
});

const bookmarksContainer = document.getElementById('bookmarks-container');
bookmarksContainer.addEventListener('mouseenter', () => {
  Object.values(bookmarkMiniMaps).forEach(m => m.resize());
});

bookmarksContainer.addEventListener('mouseleave', () => {
  document.querySelectorAll('.bookmark-item').forEach(i => i.classList.remove('menu-open'));
});

document.querySelectorAll('.bookmark-item').forEach(item => {
  const index = parseInt(item.getAttribute('data-index'), 10);
  const thumbEl = item.querySelector('.bookmark-map-thumb');
  const triggerEl = item.querySelector('.bookmark-options-trigger');
  const replaceBtn = item.querySelector('.bookmark-menu-option.replace');
  const deleteBtn = item.querySelector('.bookmark-menu-option.delete');

  thumbEl.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.bookmark-item').forEach(i => i.classList.remove('menu-open'));

    const bm = bookmarks[index];
    if (bm) {
      map.easeTo({
        center: [bm.lng, bm.lat],
        zoom: bm.zoom || 15,
        duration: 1000
      });
    } else {
      saveCurrentToBookmark(index);
    }
  });

  triggerEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = item.classList.contains('menu-open');
    document.querySelectorAll('.bookmark-item').forEach(i => i.classList.remove('menu-open'));
    if (!isOpen) {
      item.classList.add('menu-open');
    }
  });

  replaceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    item.classList.remove('menu-open');
    saveCurrentToBookmark(index);
  });

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    item.classList.remove('menu-open');
    deleteBookmark(index);
  });
});

window.addEventListener('click', () => {
  document.querySelectorAll('.bookmark-item').forEach(i => i.classList.remove('menu-open'));
});

document.addEventListener('keydown', (e) => {
  if (!map) return;
  const target = e.target;
  const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'n' || e.key === 'N' || e.key === 'q' || e.key === 'Q') {
    map.resetNorth();
    return;
  }

  if (e.key === 'e' || e.key === 'E') {
    map.easeTo({ bearing: 90 });
    return;
  }

  if (e.key === 's' || e.key === 'S') {
    map.easeTo({ bearing: 180 });
    return;
  }

  if (e.key === 'w' || e.key === 'W') {
    map.easeTo({ bearing: 270 });
    return;
  }

  if (e.key === 'r' || e.key === 'R') {
    map.easeTo({ pitch: 0 });
    return;
  }

  if (e.key === 'x' || e.key === 'X') {
    map.easeTo({ bearing: map.getBearing() + 45 });
    return;
  }

  if (e.key === 'z' || e.key === 'Z') {
    map.easeTo({ bearing: map.getBearing() - 45 });
    return;
  }

  if (e.key === '.') {
    map.zoomIn();
    return;
  }

  if (e.key === ',') {
    map.zoomOut();
    return;
  }

  if (e.key >= '1' && e.key <= '5') {
    const index = parseInt(e.key, 10) - 1;
    const bm = bookmarks[index];
    if (bm) {
      map.easeTo({
        center: [bm.lng, bm.lat],
        zoom: bm.zoom || 15,
        duration: 1000
      });
    }
    return;
  }

  const saveKeyToIndex = { '6': 0, '7': 1, '8': 2, '9': 3, '0': 4 };
  if (e.key in saveKeyToIndex) {
    saveCurrentToBookmark(saveKeyToIndex[e.key]);
  }
});

async function saveCurrentToBookmark(index) {
  if (!map) return;
  const center = map.getCenter();
  const zoom = map.getZoom();

  let placeName = `Slot ${index + 1}`;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}`);
    const data = await response.json();
    if (data && data.address) {
      placeName = data.address.city || data.address.town || data.address.village || data.address.suburb || data.address.county || data.display_name.split(',')[0];
    }
  } catch (e) {}

  bookmarks[index] = {
    lng: center.lng,
    lat: center.lat,
    zoom: zoom,
    name: placeName
  };
  saveBookmarks();

  if (bookmarkMiniMaps[index]) {
    bookmarkMiniMaps[index].remove();
    delete bookmarkMiniMaps[index];
  }

  const thumbId = `bm-thumb-${index}`;
  const container = document.getElementById(thumbId);
  container.innerHTML = '';

  const innerDiv = document.createElement('div');
  innerDiv.id = `bm-minimap-${index}`;
  innerDiv.style.width = '100%';
  innerDiv.style.height = '100%';
  container.appendChild(innerDiv);

  const bmMap = new maplibregl.Map({
    container: innerDiv.id,
    style: currentStyleUrl,
    center: [center.lng, center.lat],
    zoom: zoom,
    pitch: 0,
    bearing: 0,
    interactive: false,
    attributionControl: false
  });
  bookmarkMiniMaps[index] = bmMap;

  renderBookmarksUI();
}

function deleteBookmark(index) {
  bookmarks[index] = null;
  saveBookmarks();

  if (bookmarkMiniMaps[index]) {
    bookmarkMiniMaps[index].remove();
    delete bookmarkMiniMaps[index];
  }

  const thumbId = `bm-thumb-${index}`;
  const container = document.getElementById(thumbId);
  container.innerHTML = '';

  const emptyDiv = document.createElement('div');
  emptyDiv.className = 'bookmark-empty-state';
  emptyDiv.innerText = '+';
  container.appendChild(emptyDiv);

  renderBookmarksUI();
}

// Lock the style-selector button to its initial "Map Style" width so it
// doesn't resize when the label switches to the active style name.
const styleSelectorContainer = document.getElementById('style-selector-container');
if (styleSelectorContainer) {
  styleSelectorContainer.style.width = styleSelectorContainer.getBoundingClientRect().width + 'px';
}

document.querySelectorAll('.style-preview-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const selectedUrl = item.getAttribute('data-style');
    const styleName = item.getAttribute('data-name');
    const isLiberty = selectedUrl.includes('liberty');

    currentStyleUrl = selectedUrl;

    document.querySelectorAll('.style-preview-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    document.getElementById('style-header-text').querySelector('span').innerText = styleName;

    map.setStyle(selectedUrl);

    map.once('style.load', () => {
      if (isLiberty) {
        add3DBuildings(map);
        map.easeTo({
          pitch: 60,
          bearing: 0,
          duration: 1000
        });
      } else {
        if (map.getLayer('3d-buildings')) {
          map.removeLayer('3d-buildings');
        }
        map.easeTo({
          pitch: 0,
          bearing: 0,
          duration: 500
        });
      }
    });
  });
});

const crosshairContainer = document.getElementById('crosshair-container');
const crosshairToggle = document.getElementById('crosshair-toggle');

crosshairToggle.addEventListener('click', () => {
  crosshairContainer.classList.toggle('hidden');
  crosshairToggle.classList.toggle('active');
  const isActive = !crosshairContainer.classList.contains('hidden');
  crosshairToggle.innerText = isActive ? "Crosshair: ON" : "Crosshair: OFF";
});

/* Full SVG icon set (from pasted2.txt) — used by getWeatherInfo */
const weatherSVGs = {
  cloud: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M3 13.6493C3 16.6044 5.41766 19 8.4 19L16.5 19C18.9853 19 21 16.9839 21 14.4969C21 12.6503 19.8893 10.9449 18.3 10.25C18.1317 7.32251 15.684 5 12.6893 5C10.3514 5 8.34694 6.48637 7.5 8.5C4.8 8.9375 3 11.2001 3 13.6493Z" stroke="#8f8f8f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>`,
  drizzle: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6.271 16C4.311 14.775 3 12.546 3 10c0-3.866 3.022-7 6.75-7 3.24 0 5.948 2.368 6.6 5.527.085.41.48.695.9.695v0c2.071 0 3.75 1.741 3.75 3.89A3.94 3.94 0 0 1 19.76 16" stroke="#8f8f8f" stroke-width="2"/><path d="M10 15v1m3 0v1m-3 2v1m3 0v1m3-2v1m0-5v1" stroke="#427bff" stroke-width="2"/></svg>`,
  thunder: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke-width="0"/><g stroke-linecap="round" stroke-linejoin="round"/><path d="M6.271 16C4.311 14.775 3 12.546 3 10c0-3.866 3.022-7 6.75-7 3.24 0 5.948 2.368 6.6 5.527.085.41.48.695.9.695v0c2.071 0 3.75 1.741 3.75 3.89A3.94 3.94 0 0 1 19.76 16" stroke="#8f8f8f" stroke-width="2" stroke-linecap="round"/><path d="m13 13-1.869 3.738v0a.18.18 0 0 0 .162.262h3.416c.134 0 .22.14.16.26v0L13 21" stroke="#ffc905" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  snow: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke-width="0"/><g stroke-linecap="round" stroke-linejoin="round"/><g stroke="#8f8f8f" stroke-width="2" stroke-linecap="round"><path d="M6.271 16C4.311 14.775 3 12.546 3 10c0-3.866 3.022-7 6.75-7 3.24 0 5.948 2.368 6.6 5.527.085.41.48.695.9.695v0c2.071 0 3.75 1.741 3.75 3.89A3.94 3.94 0 0 1 19.76 16"/><path d="M10 17.03V17m0-2.97V14m6 3.03V17m0-2.97V14m-3 4.03V18m0-2.97V15m-3 5.03V20m6 .03V20m-3 1.03V21" stroke-linejoin="round"/></g></svg>`,
  rain: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke-width="0"/><g stroke-linecap="round" stroke-linejoin="round"/><path d="M6.271 16C4.311 14.775 3 12.546 3 10c0-3.866 3.022-7 6.75-7 3.24 0 5.948 2.368 6.6 5.527.085.41.48.695.9.695v0c2.071 0 3.75 1.741 3.75 3.89A3.94 3.94 0 0 1 19.76 16" fill="none" stroke="#8f8f8f" stroke-width="2" stroke-linecap="round"/><path d="M10 15v5m3-5v6m3-6v5" fill="none" stroke="#427bff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  fog: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke-width="0"/><g stroke-linecap="round" stroke-linejoin="round"/><path d="M3 6h18M3 14h18M6 10h12M6 18h12" stroke="#8f8f8f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  sunCloud: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-labelledby="sunCloudIconTitle" fill="none" stroke-linecap="round" stroke-linejoin="round"><title>Sun with clouds</title><defs><mask id="a"><path fill="#fff" d="M0 0h24v24H0z"/><path d="M6.417 18a3.75 3.75 0 1 1 1.009-7.363 5.001 5.001 0 0 1 9.342 1.55A2.917 2.917 0 0 1 16.417 18z" fill="#000"/></mask></defs><path d="M18.034 12.832A4 4 0 0 0 20.882 9 4 4 0 0 0 13 8.032" stroke="#ffc905" stroke-width="2" mask="url(#a)"/><path d="M6.417 18a3.75 3.75 0 1 1 1.009-7.363 5.001 5.001 0 0 1 9.342 1.55A2.917 2.917 0 0 1 16.417 18z" stroke="#8f8f8f" stroke-width="2"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke-width="0"/><g stroke-linecap="round" stroke-linejoin="round"/><g fill="#ffc905"><path d="M11 1a1 1 0 1 1 2 0v2a1 1 0 1 1-2 0z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-9.938 0a3.938 3.938 0 1 0 7.876 0 3.938 3.938 0 0 0-7.876 0"/><path d="M20.485 3.515a1 1 0 0 0-1.414 0l-1.414 1.414a1 1 0 0 0 1.414 1.414l1.414-1.414a1 1 0 0 0 0-1.414M1 13a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2zm2.515-9.485a1 1 0 0 0 0 1.414l1.414 1.414A1 1 0 0 0 6.343 4.93L4.93 3.515a1 1 0 0 0-1.414 0M11 21a1 1 0 1 1 2 0v2a1 1 0 1 1-2 0zm-4.657-3.343a1 1 0 0 0-1.414 0L3.515 19.07a1 1 0 1 0 1.414 1.414l1.414-1.414a1 1 0 0 0 0-1.414M21 13a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2zm-3.343 4.657a1 1 0 0 0 0 1.414l1.414 1.414a1 1 0 0 0 1.414-1.414l-1.414-1.414a1 1 0 0 0-1.414 0"/></g></svg>`,
  cloudNight: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke-width="0"/><g stroke-linecap="round" stroke-linejoin="round"/><path d="M21 15.502A6.502 6.502 0 0 1 21 3.5a6.5 6.5 0 0 0-8.5 3.496M6.9 21C4.746 21 3 19.289 3 17.178c0-1.75 1.3-3.366 3.25-3.678.612-1.438 2.06-2.5 3.748-2.5 2.163 0 3.93 1.659 4.052 3.75 1.148.496 1.95 1.715 1.95 3.034C16 19.56 14.545 21 12.75 21z" stroke="#ad5cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke-width="0"/><g stroke-linecap="round" stroke-linejoin="round"/><path d="M3.32 11.684a9 9 0 0 0 17.357 3.348A9 9 0 0 1 8.32 6.683c0-1.18.23-2.32.644-3.353a9 9 0 0 0-5.645 8.354" stroke="#ad5cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  sunriseIcon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m6 12-1-1m13 1 1-1" stroke="#ffc905" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3v7m0 0 3-3m-3 3L9 7" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 18a5 5 0 0 1 10 0" stroke="#ffc905" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 18h18M5 21h14" stroke="#427bff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  sunsetIcon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m6 12-1-1m13 1 1-1" stroke="#ffc905" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3v7m0 0 3-3m-3 3L9 7" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 18a5 5 0 0 1 10 0" stroke="#ffc905" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 18h18M5 21h14" stroke="#427bff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};

function getWeatherInfo(code, isNight = false) {
  if (code === 0) return {
    text: "Clear sky",
    svg: isNight ? weatherSVGs.moon : weatherSVGs.sun
  };
  if (code === 1 || code === 2) return {
    text: "Partly cloudy",
    svg: isNight ? weatherSVGs.cloudNight : weatherSVGs.sunCloud
  };
  if (code === 3) return {
    text: "Overcast",
    svg: isNight ? weatherSVGs.cloudNight : weatherSVGs.cloud
  };
  if (code === 45 || code === 48) return {
    text: "Foggy",
    svg: weatherSVGs.fog
  };
  if (code >= 51 && code <= 65) return {
    text: "Rain",
    svg: weatherSVGs.rain
  };
  if (code >= 71 && code <= 75) return {
    text: "Snow",
    svg: weatherSVGs.snow
  };
  if (code >= 95) return {
    text: "Thunderstorm",
    svg: weatherSVGs.thunder
  };
  return {
    text: "Fair",
    svg: weatherSVGs.sun
  };
}

function iconFromNwsText(text, isNight = false) {
  if (!text || typeof text !== 'string') {
    return isNight ? weatherSVGs.cloudNight : weatherSVGs.cloud;
  }
  const t = text.toLowerCase();
  if (t.includes('thunder') || t.includes('tstms') || t.includes('thund')) return weatherSVGs.thunder;
  if (t.includes('drizzle')) return weatherSVGs.drizzle;
  if (t.includes('rain') || t.includes('showers') || t.includes('shower')) return weatherSVGs.rain;
  if (t.includes('snow') || t.includes('sleet') || t.includes('blizzard')) return weatherSVGs.snow;
  if (t.includes('fog') || t.includes('mist') || t.includes('haze')) return weatherSVGs.fog;
  if (t.includes('clear') || t.includes('sun') || t.includes('sunny')) return isNight ? weatherSVGs.moon : weatherSVGs.sun;
  if (t.includes('partly') || t.includes('cloud') || t.includes('overcast')) return isNight ? weatherSVGs.cloudNight : weatherSVGs.cloud;
  return isNight ? weatherSVGs.cloudNight : weatherSVGs.cloud;
}

function getWindDirection(degrees) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round((degrees % 360) / 22.5);
  return directions[index % 16];
}

let currentWeather = {
  tempC: null,
  apparentTempC: null,
  precipitation: 0,
  windSpeed: 0,
  windDirDeg: null,
  humidity: 0
};

let forecastWeather = null;
let isImperial = false;
let fetchTimeout = null;

// Rendering state
let lastWeatherSource = 'open-meteo'; // 'open-meteo' | 'nws' | 'nws_pending' | 'nws_failed'
let lastWeatherCode = null;
let lastIsNight = false;
let lastNwsText = null;

/* Helper used for NWS fetches (throws on non-OK) */
async function tryFetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

/* Attempt to fetch a latest NWS observation for lat, lon.
 * Accepts optional pre-fetched points object.
 */
async function fetchNwsObservation(lat, lon, pointsData = null) {
  let points = pointsData;
  if (!points) {
    const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
    points = await tryFetchJson(pointsUrl, {
      headers: { 'Accept': 'application/geo+json' }
    });
  }

  const relLoc = points.properties && points.properties.relativeLocation && points.properties.relativeLocation.properties;
  const stateName = relLoc && (relLoc.state || relLoc.stateCode || relLoc.state_name);
  if (!stateName) {
    const err = new Error('NWS: unable to determine state from points response (not in US?)');
    err.code = 'NWS_NO_STATE';
    throw err;
  }

  const stationsUrl = points.properties && points.properties.observationStations;
  if (!stationsUrl) {
    const err = new Error('NWS: no observationStations URL');
    err.code = 'NWS_NO_STATIONS_URL';
    throw err;
  }

  const stations = await tryFetchJson(stationsUrl, {
    headers: { 'Accept': 'application/geo+json' }
  });

  let stationResourceUrl = null;
  if (Array.isArray(stations.features) && stations.features.length) {
    stationResourceUrl = stations.features[0].id || (stations.features[0].properties && stations.features[0].properties.stationIdentifier && `https://api.weather.gov/stations/${stations.features[0].properties.stationIdentifier}`);
  } else if (Array.isArray(stations) && stations.length) {
    const s0 = stations[0];
    if (s0 && s0.stationIdentifier) stationResourceUrl = `https://api.weather.gov/stations/${s0.stationIdentifier}`;
  }

  if (!stationResourceUrl) {
    const err = new Error('NWS: no usable station found');
    err.code = 'NWS_NO_STATION';
    throw err;
  }

  const obsUrl = stationResourceUrl.replace(/\/+$/,'') + '/observations/latest';
  const observation = await tryFetchJson(obsUrl, {
    headers: { 'Accept': 'application/geo+json' }
  });

  const props = observation.properties || {};
  const tempC = (props.temperature && typeof props.temperature.value === 'number') ? Number(props.temperature.value) : null;
  const apparentC = (props.apparentTemperature && typeof props.apparentTemperature.value === 'number') ? Number(props.apparentTemperature.value) : null;
  const windSpeedMps = (props.windSpeed && typeof props.windSpeed.value === 'number') ? Number(props.windSpeed.value) : null;
  const windKmh = windSpeedMps == null ? null : Number((windSpeedMps * 3.6).toFixed(1));
  const windDirDeg = (props.windDirection && typeof props.windDirection.value === 'number') ? Number(props.windDirection.value) : (props.windDirection && props.windDirection.value ? Number(props.windDirection.value) : null);
  const textDesc = props.textDescription || (props.text && typeof props.text === 'string' ? props.text : null);
  const humidity = (props.relativeHumidity && typeof props.relativeHumidity.value === 'number') ? Number(props.relativeHumidity.value) : null;
  let precipitation = null;
  if (props.precipitationLastHour && typeof props.precipitationLastHour.value === 'number') precipitation = props.precipitationLastHour.value;
  const observedAt = props.timestamp || props.observation_time || null;

  return { tempC, apparentC, windKmh, windDirDeg, textDesc, humidity, precipitation, observedAt, points };
}

/* Truncate condition text based on current widget width */
function setConditionTextWithEllipsis(fullText) {
  const condEl = document.getElementById('w-cond');
  const tempEl = document.querySelector('.weather-temp');
  const widgetEl = document.getElementById('weather-widget');
  if (!condEl || !tempEl || !widgetEl) {
    if (condEl) condEl.innerText = fullText;
    return;
  }

  condEl.title = fullText;

  const widgetStyles = window.getComputedStyle(widgetEl);
  const widgetPaddingLeft = parseFloat(widgetStyles.paddingLeft || 0);
  const widgetPaddingRight = parseFloat(widgetStyles.paddingRight || 0);
  const widgetWidth = widgetEl.clientWidth - widgetPaddingLeft - widgetPaddingRight;

  const tempRect = tempEl.getBoundingClientRect();
  const iconWidth = 36;
  const spacingGap = 12;
  const extraBuffer = 30;
  const available = Math.max(20, widgetWidth - iconWidth - tempRect.width - spacingGap - extraBuffer);

  const avgCharPx = 7;
  const maxChars = Math.max(8, Math.floor(available / avgCharPx));

  if (fullText.length > maxChars) {
    const short = fullText.slice(0, Math.max(0, maxChars - 1)) + '…';
    condEl.innerText = short;
  } else {
    condEl.innerText = fullText;
  }
}

/* Update badge text to reflect data source */
function updateSourceBadge() {
  const titleEl = document.querySelector('.weather-title');
  if (!titleEl) return;

  let badge = titleEl.querySelector('.weather-source-badge');
  const badgeText = (lastWeatherSource === 'nws') ? 'NWS' : 'Open-Meteo';

  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'weather-source-badge';
    badge.style.marginLeft = '6px';
    badge.style.fontSize = '10px';
    badge.style.padding = '2px 6px';
    badge.style.borderRadius = '10px';
    badge.style.background = 'rgba(0,0,0,0.06)';
    badge.style.color = '#222';
    titleEl.appendChild(badge);
  }
  badge.innerText = badgeText;
}

/* Central rendering of icon & condition (uses NWS text if available when lastWeatherSource==='nws') */
function updateIconAndConditionDisplay() {
  const isNight = lastIsNight;
  const condEl = document.getElementById('w-cond');
  const iconEl = document.getElementById('w-icon');

  let displayText = '';
  let svgHtml = '';

  if (lastWeatherSource === 'nws' && lastNwsText) {
    displayText = lastNwsText;
    svgHtml = iconFromNwsText(lastNwsText, isNight);
  } else if (lastWeatherSource === 'nws_pending') {
    displayText = 'Loading...';
    svgHtml = '';
  } else if (lastWeatherCode != null) {
    const info = getWeatherInfo(lastWeatherCode, isNight);
    displayText = info.text;
    svgHtml = info.svg;
  } else {
    displayText = condEl ? condEl.innerText || '' : '';
    svgHtml = iconEl ? iconEl.innerHTML : '';
  }

  if (iconEl) iconEl.innerHTML = svgHtml || '';
  setConditionTextWithEllipsis(displayText);
  updateSourceBadge();
}

/* Recompute truncation when widget expands/collapses or window resizes */
function attachWidgetHoverRecompute() {
  const widget = document.getElementById('weather-widget');
  if (!widget) return;

  const recompute = () => {
    updateIconAndConditionDisplay();
    // run after CSS transition finishes (transition is ~300ms)
    setTimeout(updateIconAndConditionDisplay, 360);
  };

  widget.addEventListener('mouseenter', recompute);
  widget.addEventListener('mouseleave', recompute);
  window.addEventListener('resize', () => {
    updateIconAndConditionDisplay();
    setTimeout(updateIconAndConditionDisplay, 200);
  });
}

/* Main update flow:
 * - Always fetch Open-Meteo for forecasts/sun times.
 * - If inside US: show Loading... and attempt NWS observation; only show NWS when it arrives.
 * - If not in US: use Open-Meteo current values.
 */
async function updateWeatherForCenter() {
  if (!map) return;
  const center = map.getCenter();
  const latFull = center.lat;
  const lonFull = center.lng;
  const lat = latFull.toFixed(4);
  const lng = lonFull.toFixed(4);

  // Fetch Open-Meteo for forecasts + sunrise/sunset (always)
  let openData = null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset&timezone=auto`;
    const rsp = await fetch(url);
    openData = await rsp.json();
  } catch (e) {
    forecastWeather = null;
  }

  if (openData && openData.daily) {
    forecastWeather = {
      time: openData.daily.time,
      tempMax: openData.daily.temperature_2m_max,
      tempMin: openData.daily.temperature_2m_min,
      rainProb: openData.daily.precipitation_probability_max,
      windMax: openData.daily.wind_speed_10m_max,
      sunrise: openData.daily.sunrise,
      sunset: openData.daily.sunset
    };
  }

  // Detect if point is covered by NWS (US)
  let points = null;
  let inUS = false;
  try {
    const pointsUrl = `https://api.weather.gov/points/${latFull},${lonFull}`;
    points = await tryFetchJson(pointsUrl, { headers: { 'Accept': 'application/geo+json' } });
    const relLoc = points.properties && points.properties.relativeLocation && points.properties.relativeLocation.properties;
    const stateName = relLoc && (relLoc.state || relLoc.stateCode || relLoc.state_name);
    if (stateName) inUS = true;
  } catch (e) {
    inUS = false;
  }

  if (inUS) {
    // US: don't display Open-Meteo current; show Loading... while NWS is fetched
    lastWeatherSource = 'nws_pending';
    lastWeatherCode = null;
    lastNwsText = null;

    currentWeather.tempC = null;
    currentWeather.apparentTempC = null;
    currentWeather.precipitation = 0;
    currentWeather.windSpeed = 0;
    currentWeather.windDirDeg = null;
    currentWeather.humidity = 0;

    const tempEl = document.getElementById('w-temp');
    const feelsEl = document.getElementById('w-feels-like');
    const precipEl = document.getElementById('w-precip');
    const windEl = document.getElementById('w-wind');
    const humidityEl = document.getElementById('w-humidity');
    const iconEl = document.getElementById('w-icon');
    if (tempEl) tempEl.innerText = `--°C`;
    if (feelsEl) feelsEl.innerText = `--°C`;
    if (precipEl) precipEl.innerText = `-- mm`;
    if (windEl) windEl.innerText = `--`;
    if (humidityEl) humidityEl.innerText = `--%`;
    if (iconEl) iconEl.innerHTML = '';
    setConditionTextWithEllipsis('Loading...');
    updateSourceBadge();

    // Try NWS observation
    try {
      const nws = await fetchNwsObservation(latFull, lonFull, points);
      if (nws && typeof nws.tempC === 'number') {
        let isNight = false;
        if (nws.observedAt) {
          try {
            const dt = new Date(nws.observedAt);
            const hr = dt.getHours();
            if (hr < 6 || hr >= 19) isNight = true;
          } catch (e) {
            const nowH = new Date().getHours();
            isNight = nowH < 6 || nowH >= 19;
          }
        } else {
          const nowH = new Date().getHours();
          isNight = nowH < 6 || nowH >= 19;
        }

        currentWeather.tempC = Number(nws.tempC);
        currentWeather.apparentTempC = nws.apparentC != null ? Number(nws.apparentC) : currentWeather.tempC;
        if (nws.precipitation != null) currentWeather.precipitation = nws.precipitation;
        if (nws.windKmh != null) currentWeather.windSpeed = nws.windKmh;
        if (nws.windDirDeg != null) currentWeather.windDirDeg = nws.windDirDeg;
        if (nws.humidity != null) currentWeather.humidity = Math.round(nws.humidity);

        lastWeatherSource = 'nws';
        lastNwsText = nws.textDesc || 'Observation';
        lastWeatherCode = null;
        lastIsNight = isNight;

        renderWeatherDisplay();
        updateWindArrow();
        updateIconAndConditionDisplay();
        updateSourceBadge();
        return;
      } else {
        throw new Error('NWS returned no usable observation');
      }
    } catch (nwsErr) {
      // NWS failed — show Unavailable for current, but keep forecasts/sun times (from Open-Meteo)
      lastWeatherSource = 'nws_failed';
      lastNwsText = null;
      lastWeatherCode = null;
      lastIsNight = false;
      setConditionTextWithEllipsis('Unavailable');
      updateSourceBadge(); // will show "Open-Meteo"
      renderWeatherDisplay();
      return;
    }
  }

  // Not in US: use Open-Meteo for current + forecast
  try {
    if (openData && openData.current) {
      currentWeather.tempC = openData.current.temperature_2m;
      currentWeather.apparentTempC = openData.current.apparent_temperature ?? openData.current.temperature_2m;
      currentWeather.precipitation = openData.current.precipitation ?? 0;
      currentWeather.windSpeed = openData.current.wind_speed_10m ?? 0;
      currentWeather.windDirDeg = openData.current.wind_direction_10m ?? 0;
      currentWeather.humidity = Math.round(openData.current.relative_humidity_2m ?? 0);

      const code = openData.current.weather_code;
      const isNight = openData.current.is_day === 0;

      lastWeatherSource = 'open-meteo';
      lastWeatherCode = code;
      lastIsNight = isNight;
      lastNwsText = null;

      renderWeatherDisplay();
      updateWindArrow();
      updateIconAndConditionDisplay();
      updateSourceBadge();
    } else {
      lastWeatherSource = 'open-meteo';
      lastWeatherCode = null;
      setConditionTextWithEllipsis('Unavailable');
      updateSourceBadge();
      renderWeatherDisplay();
    }
  } catch (e) {
    setConditionTextWithEllipsis('Unavailable');
    updateSourceBadge();
    renderWeatherDisplay();
  }
}

function renderSparkline(elementId, dataObj, color, type, timeArray) {
  const el = document.getElementById(elementId);
  if (!el || !dataObj) return;
  el.innerHTML = '';

  const svgW = 280;
  const svgH = 65;
  const margin = {
    top: 8,
    right: 10,
    bottom: 18,
    left: 24
  };
  const w = svgW - margin.left - margin.right;
  const h = svgH - margin.top - margin.bottom;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.overflow = "visible";

  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("transform", `translate(${margin.left}, ${margin.top})`);
  svg.appendChild(g);

  let data, minData, maxData;
  let globalMin, globalMax;
  let dataLength;

  if (type === 'band') {
    minData = dataObj.min;
    maxData = dataObj.max;
    dataLength = maxData.length;
    if (!dataLength) return;
    let allValues = [...minData, ...maxData];
    globalMin = Math.floor(Math.min(...allValues) - 2);
    globalMax = Math.ceil(Math.max(...allValues) + 2);
  } else {
    data = dataObj;
    dataLength = data.length;
    if (!dataLength) return;
    if (type === 'bar') {
      globalMin = 0;
      globalMax = 100;
    } else {
      globalMin = 0;
      globalMax = Math.ceil(Math.max(...data) * 1.2 || 10);
    }
  }

  let range = globalMax - globalMin || 1;
  const dx = w / (dataLength - 1 || 1);

  let yTicks = [globalMin, Math.round((globalMin + globalMax) / 2), globalMax];
  yTicks = [...new Set(yTicks)];

  yTicks.forEach((tick) => {
    const yPos = h - ((tick - globalMin) / range) * h;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", 0);
    line.setAttribute("y1", yPos);
    line.setAttribute("x2", w);
    line.setAttribute("y2", yPos);
    line.setAttribute("stroke", "#e5e7eb");
    line.setAttribute("stroke-width", "0.5");
    line.setAttribute("stroke-dasharray", "2 2");
    g.appendChild(line);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", -6);
    text.setAttribute("y", yPos + 3);
    text.setAttribute("text-anchor", "end");
    text.setAttribute("font-size", "9");
    text.setAttribute("font-weight", "500");
    text.setAttribute("fill", "#6b7280");
    text.textContent = tick;
    g.appendChild(text);
  });

  if (timeArray) {
    const days = timeArray.map(t => {
      const [y, m, d] = t.split('-');
      const dateObj = new Date(y, m - 1, d);
      return dateObj.toLocaleDateString('en-US', {
        weekday: 'short'
      });
    });

    const step = dataLength > 7 ? 4 : 2;
    for (let i = 0; i < dataLength; i += step) {
      const xPos = type === 'bar' ? (i * (w / dataLength) + (w / dataLength) / 2) : i * dx;

      const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tick.setAttribute("x1", xPos);
      tick.setAttribute("y1", h);
      tick.setAttribute("x2", xPos);
      tick.setAttribute("y2", h + 4);
      tick.setAttribute("stroke", "#e5e7eb");
      tick.setAttribute("stroke-width", "1");
      g.appendChild(tick);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", xPos);
      text.setAttribute("y", h + 14);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "8");
      text.setAttribute("font-weight", "600");
      text.setAttribute("fill", "#9ca3af");
      text.textContent = days[i];
      g.appendChild(text);
    }
  }

  if (type === 'band') {
    let pathD = `M 0 ${h - ((maxData[0] - globalMin)/range * h)}`;
    for (let i = 1; i < dataLength; i++) {
      pathD += ` L ${i*dx} ${h - ((maxData[i] - globalMin)/range * h)}`;
    }
    for (let i = dataLength - 1; i >= 0; i--) {
      pathD += ` L ${i*dx} ${h - ((minData[i] - globalMin)/range * h)}`;
    }
    pathD += ' Z';

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    path.setAttribute("fill", color);
    path.setAttribute("opacity", "0.3");
    g.appendChild(path);

    let lineD = `M 0 ${h - ((maxData[0] - globalMin)/range * h)}`;
    for (let i = 1; i < dataLength; i++) {
      lineD += ` L ${i*dx} ${h - ((maxData[i] - globalMin)/range * h)}`;
    }
    const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    linePath.setAttribute("d", lineD);
    linePath.setAttribute("stroke", color);
    linePath.setAttribute("stroke-width", "1.5");
    linePath.setAttribute("fill", "none");
    linePath.setAttribute("stroke-linecap", "round");
    linePath.setAttribute("stroke-linejoin", "round");
    g.appendChild(linePath);

    let minLineD = `M 0 ${h - ((minData[0] - globalMin)/range * h)}`;
    for (let i = 1; i < dataLength; i++) {
      minLineD += ` L ${i*dx} ${h - ((minData[i] - globalMin)/range * h)}`;
    }
    const minLinePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    minLinePath.setAttribute("d", minLineD);
    minLinePath.setAttribute("stroke", color);
    minLinePath.setAttribute("stroke-width", "1");
    minLinePath.setAttribute("stroke-dasharray", "2 2");
    minLinePath.setAttribute("fill", "none");
    g.appendChild(minLinePath);

  } else if (type === 'bar') {
    const barW = (w / dataLength) * 0.7;
    const barSpacing = w / dataLength;

    for (let i = 0; i < dataLength; i++) {
      const val = data[i];
      const barH = Math.max((val / globalMax) * h, 1);
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", i * barSpacing + (barSpacing - barW) / 2);
      rect.setAttribute("y", h - barH);
      rect.setAttribute("width", barW);
      rect.setAttribute("height", barH);
      rect.setAttribute("fill", color);
      rect.setAttribute("rx", "1");
      g.appendChild(rect);
    }
  } else {
    let pathD = `M 0 ${h - ((data[0] - globalMin)/range * h)}`;
    for (let i = 1; i < dataLength; i++) {
      pathD += ` L ${i*dx} ${h - ((data[i] - globalMin)/range * h)}`;
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    g.appendChild(path);

    let areaD = pathD + ` L ${w} ${h} L 0 ${h} Z`;
    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("d", areaD);
    area.setAttribute("fill", color);
    area.setAttribute("opacity", "0.2");
    g.appendChild(area);
  }

  el.appendChild(svg);
}

function renderWeatherDisplay() {
  // If currentWeather.tempC is null, suppress Open-Meteo numeric display for current
  if (currentWeather.tempC === null) {
    // placeholders are set where appropriate
  } else {
    if (isImperial) {
      const tempF = Math.round((currentWeather.tempC * 9 / 5) + 32);
      const appTempF = Math.round((currentWeather.apparentTempC * 9 / 5) + 32);
      document.getElementById('w-temp').innerText = `${tempF}°F`;
      document.getElementById('w-feels-like').innerText = `${appTempF}°F`;
    } else {
      document.getElementById('w-temp').innerText = `${currentWeather.tempC}°C`;
      document.getElementById('w-feels-like').innerText = `${currentWeather.apparentTempC}°C`;
    }

    if (isImperial) {
      const precipIn = (currentWeather.precipitation / 25.4).toFixed(2);
      document.getElementById('w-precip').innerText = `${precipIn} in`;
    } else {
      document.getElementById('w-precip').innerText = `${currentWeather.precipitation} mm`;
    }

    const windDirStr = getWindDirection(currentWeather.windDirDeg);
    if (isImperial) {
      const windMph = Math.round(currentWeather.windSpeed * 0.621371);
      document.getElementById('w-wind').innerText = `${windMph} mph (${windDirStr})`;
    } else {
      document.getElementById('w-wind').innerText = `${currentWeather.windSpeed} km/h (${windDirStr})`;
    }

    document.getElementById('w-humidity').innerText = `${Math.round(currentWeather.humidity)}%`;
  }

  // Sunrise / Sunset
  if (forecastWeather && forecastWeather.sunrise && forecastWeather.sunrise.length) {
    const sunriseRaw = forecastWeather.sunrise[0] || '';
    const sunsetRaw = forecastWeather.sunset[0] || '';
    const sunriseTime = (typeof sunriseRaw === 'string' && sunriseRaw.includes('T')) ? sunriseRaw.split('T')[1].slice(0,5) : (sunriseRaw.slice(11,16) || '--:--');
    const sunsetTime = (typeof sunsetRaw === 'string' && sunsetRaw.includes('T')) ? sunsetRaw.split('T')[1].slice(0,5) : (sunsetRaw.slice(11,16) || '--:--');
    const sEl = document.getElementById('w-sunrise');
    const ssEl = document.getElementById('w-sunset');
    if (sEl) sEl.innerText = sunriseTime;
    if (ssEl) ssEl.innerText = sunsetTime;
  }

  if (forecastWeather) {
    const timeArray = forecastWeather.time;

    const tempsMin = isImperial ? forecastWeather.tempMin.map(c => (c * 9 / 5) + 32) : forecastWeather.tempMin;
    const tempsMax = isImperial ? forecastWeather.tempMax.map(c => (c * 9 / 5) + 32) : forecastWeather.tempMax;
    renderSparkline('graph-temp', {
      min: tempsMin,
      max: tempsMax
    }, '#ef4444', 'band', timeArray);

    renderSparkline('graph-rain', forecastWeather.rainProb, '#3b82f6', 'bar', timeArray);

    const windMaxList = isImperial ? forecastWeather.windMax.map(k => k * 0.621371) : forecastWeather.windMax;
    renderSparkline('graph-wind', windMaxList, '#10b981', 'line', timeArray);

    document.getElementById('lbl-temp').innerText = isImperial ? "Temp Range (°F)" : "Temp Range (°C)";
    document.getElementById('lbl-wind').innerText = isImperial ? "Max Wind (mph)" : "Max Wind (km/h)";
  }

  updateIconAndConditionDisplay();
}

function updateWindArrow() {
  if (!map || currentWeather.windDirDeg === null) return;
  const bearing = map.getBearing();
  const arrowRotation = currentWeather.windDirDeg + 180 - bearing;

  const arrow = document.getElementById('w-wind-arrow');
  if (arrow) {
    arrow.style.transform = `rotate(${arrowRotation}deg)`;
  }
}

document.getElementById('weather-widget').addEventListener('click', () => {
  isImperial = !isImperial;
  renderWeatherDisplay();
});

let currentTimezone = 'America/New_York';
let is12HourFormat = false;
let timeInterval = null;

async function updateLocalTimezoneForCenter() {
  if (!map) return;
  const center = map.getCenter();
  const lat = center.lat.toFixed(2);
  const lng = center.lng.toFixed(2);

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=auto&current=temperature_2m`);
    const data = await response.json();
    if (data && data.timezone) currentTimezone = data.timezone;
  } catch (e) {}
}

function runClockTick() {
  try {
    const now = new Date();
    let timeString;
    const tz = currentTimezone || 'America/New_York';

    try {
      timeString = new Intl.DateTimeFormat([], {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: is12HourFormat
      }).format(now);
    } catch (err) {
      timeString = now.toLocaleTimeString([], {
        hour12: is12HourFormat
      });
    }

    const displayEl = document.getElementById('local-time-display');
    if (displayEl) {
      displayEl.innerText = timeString;
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    }).formatToParts(now);

    let hours = 0,
      minutes = 0,
      seconds = 0;
    parts.forEach(p => {
      if (p.type === 'hour') hours = parseInt(p.value, 10);
      if (p.type === 'minute') minutes = parseInt(p.value, 10);
      if (p.type === 'second') seconds = parseInt(p.value, 10);
    });

    if (hours === 24) hours = 0;

    const secondDeg = seconds * 6;
    const minuteDeg = (minutes + seconds / 60) * 6;
    const hourDeg = ((hours % 12) + minutes / 60 + seconds / 3600) * 30;

    const hourHand = document.getElementById('clock-hour-hand');
    const minuteHand = document.getElementById('clock-minute-hand');
    const secondHand = document.getElementById('clock-second-hand');

    if (hourHand) hourHand.setAttribute('transform', `rotate(${hourDeg}, 12, 12)`);
    if (minuteHand) minuteHand.setAttribute('transform', `rotate(${minuteDeg}, 12, 12)`);
    if (secondHand) secondHand.setAttribute('transform', `rotate(${secondDeg}, 12, 12)`);
  } catch (e) {}
}

document.getElementById('time-widget').addEventListener('click', () => {
  is12HourFormat = !is12HourFormat;
  runClockTick();
});

if (timeInterval) clearInterval(timeInterval);
timeInterval = setInterval(runClockTick, 1000);
runClockTick();

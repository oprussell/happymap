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

const weatherSVGs = {
  sun: `<svg viewBox="0 0 24 24" fill="none"><path fill="#ffc905" d="M11 1a1 1 0 1 1 2 0v2a1 1 0 1 1-2 0z"></path><path fill="#ffc905" fill-rule="evenodd" clip-rule="evenodd" d="M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-9.938 0a3.938 3.938 0 1 0 7.876 0 3.938 3.938 0 0 0-7.876 0"></path><path fill="#ffc905" d="M20.485 3.515a1 1 0 0 0-1.414 0l-1.414 1.414a1 1 0 0 0 1.414 1.414l1.414-1.414a1 1 0 0 0 0-1.414M1 13a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2zm2.515-9.485a1 1 0 0 0 0 1.414l1.414 1.414A1 1 0 0 0 6.343 4.93L4.93 3.515a1 1 0 0 0-1.414 0M11 21a1 1 0 1 1 2 0v2a1 1 0 1 1-2 0zm-4.657-3.343a1 1 0 0 0-1.414 0L3.515 19.07a1 1 0 1 0 1.414 1.414l1.414-1.414a1 1 0 0 0 0-1.414M21 13a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2zm-3.343 4.657a1 1 0 0 0 0 1.414l1.414 1.414a1 1 0 0 0 1.414-1.414l-1.414-1.414a1 1 0 0 0-1.414 0"></path></svg>`,
  sunCloud: `<svg viewBox="0 0 24 24" fill="none" stroke="#ffc905" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.417 18a3.75 3.75 0 1 1 1.009-7.363 5.001 5.001 0 0 1 9.342 1.55A2.917 2.917 0 0 1 16.417 18z"></path><path stroke-linecap="butt" d="M18.034 12.832A4 4 0 0 0 20.882 9 4 4 0 0 0 13 8.032"></path></svg>`,
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="#8f8f8f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10c0 3.866 3.022 7 6.75 7h7.5c2.071 0 3.75-1.741 3.75-3.889s-1.679-3.889-3.75-3.889c-.42 0-.815-.284-.9-.695C15.698 5.368 12.99 3 9.75 3 6.022 3 3 6.134 3 10Z"></path></svg>`,
  cloudNight: `<svg viewBox="0 0 24 24" fill="none" stroke="#ad5cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.654 5.618A8.97 8.97 0 0 1 18 3c.983 0 1.93.156 2.815.448A10 10 0 0 0 16 12a10 10 0 0 0 4.813 8.552c-.885.29-1.83.448-2.813.448-1.85 0-3.57-.558-5-1.516M5.7 16C4.209 16 3 14.802 3 13.325c0-1.225.9-2.356 2.25-2.575C5.673 9.743 6.676 9 7.845 9a2.8 2.8 0 0 1 2.805 2.625c.795.347 1.35 1.2 1.35 2.123A2.25 2.25 0 0 1 9.75 16z"></path></svg>`,
  fog: `<svg viewBox="0 0 24 24" fill="none" stroke="#8f8f8f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 14h18M6 10h12M6 18h12"></path></svg>`,
  rain: `<svg viewBox="0 0 24 24" fill="none" stroke="#427bff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.271 16C4.311 14.775 3 12.546 3 10c0-3.866 3.022-7 6.75-7 3.24 0 5.948 2.368 6.6 5.527.085.41.48.695.9.695v0c2.071 0 3.75 1.741 3.75 3.89A3.94 3.94 0 0 1 19.76 16"></path><path d="M10 15v5m3-5v6m3-6v5"></path></svg>`,
  snow: `<svg viewBox="0 0 24 24" fill="none" stroke="#8f8f8f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.271 16C4.311 14.775 3 12.546 3 10c0-3.866 3.022-7 6.75-7 3.24 0 5.948 2.368 6.6 5.527.085.41.48.695.9.695v0c2.071 0 3.75 1.741 3.75 3.89A3.94 3.94 0 0 1 19.76 16"></path><path d="M10 17.03V17m0-2.97V14m6 3.03V17m0-2.97V14m-3 4.03V18m0-2.97V15m-3 5.03V20m6 .03V20m-3 1.03V21"></path></svg>`,
  thunder: `<svg viewBox="0 0 24 24" fill="none" stroke="#ffc905" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.271 16C4.311 14.775 3 12.546 3 10c0-3.866 3.022-7 6.75-7 3.24 0 5.948 2.368 6.6 5.527.085.41.48.695.9.695v0c2.071 0 3.75 1.741 3.75 3.89A3.94 3.94 0 0 1 19.76 16"></path><path d="m13 13-1.869 3.738v0a.18.18 0 0 0 .162.262h3.416c.134 0 .22.14.16.26v0L13 21"></path></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="#ad5cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6V3m5.5 9V7m-4-2.5h-3m9.5 5h-5m-.445 7.315a8.3 8.3 0 0 0 3.445-.74A8.37 8.37 0 1 1 7.925 5a8.37 8.37 0 0 0 7.63 11.815"></path></svg>`
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

async function updateWeatherForCenter() {
  if (!map) return;
  const center = map.getCenter();
  const lat = center.lat.toFixed(4);
  const lng = center.lng.toFixed(4);

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&forecast_days=16&timezone=auto`);
    const data = await response.json();

    if (data && data.current) {
      currentWeather.tempC = data.current.temperature_2m;
      currentWeather.apparentTempC = data.current.apparent_temperature ?? data.current.temperature_2m;
      currentWeather.precipitation = data.current.precipitation ?? 0;
      currentWeather.windSpeed = data.current.wind_speed_10m ?? 0;
      currentWeather.windDirDeg = data.current.wind_direction_10m ?? 0;
      currentWeather.humidity = data.current.relative_humidity_2m ?? 0;

      if (data.daily) {
        forecastWeather = {
          time: data.daily.time,
          tempMax: data.daily.temperature_2m_max,
          tempMin: data.daily.temperature_2m_min,
          rainProb: data.daily.precipitation_probability_max,
          windMax: data.daily.wind_speed_10m_max
        };
      }

      const code = data.current.weather_code;
      const isNight = data.current.is_day === 0;

      renderWeatherDisplay();
      updateWindArrow();

      const info = getWeatherInfo(code, isNight);
      document.getElementById('w-cond').innerText = info.text;
      document.getElementById('w-icon').innerHTML = info.svg;
    }
  } catch (error) {
    document.getElementById('w-cond').innerText = "Unavailable";
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
  if (currentWeather.tempC === null) return;

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

  document.getElementById('w-humidity').innerText = `${currentWeather.humidity}%`;

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
    if (data && data.timezone) {
      currentTimezone = data.timezone;
    }
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

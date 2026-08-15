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
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M6.34 17.66l-1.41 1.41"></path><path d="M19.07 4.93l-1.41 1.41"></path></svg>`,
  sunCloud: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="9" r="3" stroke="#f59e0b" fill="#f59e0b" fill-opacity="0.25"></circle><path d="M17 14h-1.12a5 5 0 1 0-8.76 2.5H17a3 3 0 0 0 0-6z" fill="#9ca3af" fill-opacity="0.3" stroke="#6b7280"></path></svg>`,
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#9ca3af" fill-opacity="0.3"></path></svg>`,
  fog: `<svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h16"></path><path d="M6 14h12"></path><path d="M8 18h8"></path><path d="M5 6h14"></path></svg>`,
  rain: `<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9h-1.26A8 8 0 1 0 9 19h9a5 5 0 0 0 0-10z" fill="#9ca3af" fill-opacity="0.3" stroke="#6b7280"></path><rect x="8" y="20" width="1.5" height="3" rx="0.75" fill="#3b82f6" stroke="none"></rect><rect x="12" y="20" width="1.5" height="3" rx="0.75" fill="#3b82f6" stroke="none"></rect><rect x="16" y="20" width="1.5" height="3" rx="0.75" fill="#3b82f6" stroke="none"></rect></svg>`,
  snow: `<svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#e0f2fe" fill-opacity="0.4"></path><path d="M10 22v-2"></path><path d="M14 22v-2"></path></svg>`,
  thunder: `<svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#fef08a" fill-opacity="0.3"></path><polyline points="13 11 9 17 15 17 11 23" fill="#eab308"></polyline></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#ede9fe" fill-opacity="0.5"></path></svg>`
};

function getWeatherInfo(code, isNight = false) {
  if (code === 0) return {
    text: "Clear sky",
    svg: isNight ? weatherSVGs.moon : weatherSVGs.sun
  };
  if (code === 1 || code === 2) return {
    text: "Partly cloudy",
    svg: weatherSVGs.sunCloud
  };
  if (code === 3) return {
    text: "Overcast",
    svg: weatherSVGs.cloud
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

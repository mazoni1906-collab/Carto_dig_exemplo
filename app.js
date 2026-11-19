(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const layerNames = { hydro: 'Hidrografia', roads: 'Rodovias', boundary: 'Limite estadual' };
  const layerStyles = {
    hydro: { color: '#36a3b8', weight: 1.45, opacity: .88, lineCap: 'round', lineJoin: 'round' },
    roads: { color: '#e89c43', weight: 2.15, opacity: .92, lineCap: 'round', lineJoin: 'round' },
    boundary: { color: '#668f5e', weight: 2, opacity: 1, fillColor: '#85a77b', fillOpacity: .08, lineJoin: 'round' }
  };
  const layerOpacity = { hydro: .88, roads: .92, boundary: 1 };
  const map = L.map('map', { zoomControl: false, preferCanvas: true, doubleClickZoom: true, minZoom: 4, maxZoom: 18 });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 120 }).addTo(map);
  map.setView([-19.25, -44.2], 6);

  const basemaps = {
    streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics'
    })
  };
  basemaps.streets.addTo(map);

  const panes = { boundary: 'boundaryPane', roads: 'roadsPane', hydro: 'hydroPane' };
  map.createPane(panes.boundary); map.getPane(panes.boundary).style.zIndex = 410;
  map.createPane(panes.roads); map.getPane(panes.roads).style.zIndex = 420;
  map.createPane(panes.hydro); map.getPane(panes.hydro).style.zIndex = 430;
  const renderers = {};
  const groups = {};
  const searchItems = [];
  const completed = new Set();
  const layerErrors = new Set();
  const counts = { hydro: 0, roads: 0, boundary: 0 };
  let toastTimer, measureActive = false, measurePoints = [], measureLine = null, measureMarkers = [], searchMarker = null;

  for (const id of Object.keys(layerNames)) {
    renderers[id] = L.canvas({ pane: panes[id], padding: .4 });
    groups[id] = L.featureGroup().addTo(map);
  }

  function notify(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function prettyKey(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function titleFor(properties, layerId) {
    const preferred = layerId === 'hydro'
      ? ['noriocomp', 'noespecif', 'cotrecho', 'id']
      : layerId === 'roads'
        ? ['codigo_snv', 'codigo_rod', 'local_inic', 'id']
        : ['nomuf', 'name', 'id'];
    for (const key of preferred) if (properties?.[key] != null && String(properties[key]).trim()) return String(properties[key]);
    const first = Object.entries(properties || {}).find(([, value]) => value != null && String(value).trim());
    return first ? String(first[1]) : layerNames[layerId];
  }

  function popupMarkup(feature, layerId) {
    const props = feature.properties || {};
    const rows = Object.entries(props).filter(([, v]) => v !== null && v !== '').slice(0, 30)
      .map(([key, value]) => `<dt>${escapeHtml(prettyKey(key))}</dt><dd>${escapeHtml(String(value))}</dd>`).join('');
    return `<div class="feature-popup"><div class="popup-layer">${layerNames[layerId]}</div><h3>${escapeHtml(titleFor(props, layerId))}</h3><dl>${rows || '<dd>Sem atributos disponíveis.</dd>'}</dl></div>`;
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function addFeatureBatch(id, features) {
    const geo = L.geoJSON({ type: 'FeatureCollection', features }, {
      pane: panes[id], renderer: renderers[id], style: () => featureStyle(id),
      pointToLayer: (_, latlng) => L.circleMarker(latlng, { ...featureStyle(id), radius: 5, fillOpacity: layerOpacity[id] }),
      onEachFeature: (feature, layer) => {
        layer.on('click', event => {
          if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
          if (measureActive) return;
          L.popup({ maxWidth: 340, maxHeight: 300, closeButton: true, autoPanPadding: [25, 25] })
            .setLatLng(event.latlng || layer.getBounds?.().getCenter() || map.getCenter())
            .setContent(popupMarkup(feature, id)).openOn(map);
        });
        layer.on('mouseover', () => { if (typeof layer.setStyle === 'function') layer.setStyle({ weight: (layerStyles[id].weight || 1) + 1.4, opacity: 1 }); });
        layer.on('mouseout', () => { if (typeof layer.setStyle === 'function') layer.setStyle(featureStyle(id)); });
        searchItems.push({ id, feature, layer, text: Object.entries(feature.properties || {}).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(' ').toLocaleLowerCase('pt-BR'), title: titleFor(feature.properties, id) });
      }
    });
    geo.addTo(groups[id]);
    counts[id] += features.length;
    $(`#count-${id}`).textContent = `${counts[id].toLocaleString('pt-BR')} feições`;
    updateLoadingText();
  }

  function featureStyle(id) {
    return { ...layerStyles[id], opacity: layerOpacity[id], fillOpacity: id === 'boundary' ? layerOpacity[id] * .08 : layerOpacity[id] };
  }

  function updateLoadingText() {
    const readyCount = completed.size;
    const status = $('#loadingText');
    const loading = Object.keys(layerNames).filter(id => !completed.has(id) && !layerErrors.has(id));
    if (!loading.length) {
      status.textContent = layerErrors.size ? 'Algumas camadas não puderam carregar.' : 'Todas as camadas estão prontas.';
      $('#loadingStatus').querySelector('strong').textContent = layerErrors.size ? 'Carregamento parcial' : 'Camadas prontas';
      $('#loadingStatus').classList.toggle('complete', !layerErrors.size);
      if (!layerErrors.size) setTimeout(() => $('#loadingStatus')?.classList.add('dismissed'), 3500);
    } else {
      const label = loading.map(id => layerNames[id]).join(', ');
      status.textContent = `${label} · ${readyCount}/3 concluídas`;
    }
  }

  const worker = new Worker('./data-worker.js');
  worker.onmessage = ({ data }) => {
    if (data.type === 'batch') addFeatureBatch(data.id, data.features);
    if (data.type === 'done') {
      completed.add(data.id);
      $(`#count-${data.id}`).textContent = `${data.total.toLocaleString('pt-BR')} feições`;
      if (data.id === 'boundary' && groups.boundary.getLayers().length) {
        try { map.fitBounds(groups.boundary.getBounds(), { padding: [40, 40], maxZoom: 7, animate: true }); } catch (_) {}
      }
      updateLoadingText();
      if (completed.size >= Object.keys(layerNames).length) worker.terminate();
    }
    if (data.type === 'error') {
      layerErrors.add(data.id);
      completed.add(data.id);
      $(`#count-${data.id}`).textContent = `Erro ao carregar: ${data.message}`;
      updateLoadingText();
      notify(`Falha ao carregar ${layerNames[data.id]}.`);
    }
  };
  worker.postMessage({ layers: Object.keys(layerNames) });

  document.querySelectorAll('.layer-card').forEach(card => {
    const id = card.dataset.layer;
    const checkbox = card.querySelector('.layer-toggle');
    checkbox.addEventListener('change', () => checkbox.checked ? map.addLayer(groups[id]) : map.removeLayer(groups[id]));
    card.querySelector('.opacity-slider').addEventListener('input', event => {
      const opacity = Number(event.target.value) / 100;
      layerOpacity[id] = opacity;
      event.target.nextElementSibling.textContent = `${event.target.value}%`;
      groups[id].eachLayer(batch => batch.eachLayer(featureLayer => {
        if (typeof featureLayer.setStyle === 'function') featureLayer.setStyle(featureStyle(id));
      }));
    });
    card.querySelector('.layer-info').addEventListener('click', () => notify(`${layerNames[id]} · ${counts[id].toLocaleString('pt-BR')} feições carregadas`));
  });

  let allVisible = true;
  $('#toggleAll').addEventListener('click', event => {
    allVisible = !allVisible;
    for (const id of Object.keys(layerNames)) {
      const checkbox = document.querySelector(`[data-layer="${id}"] .layer-toggle`);
      checkbox.checked = allVisible;
      allVisible ? map.addLayer(groups[id]) : map.removeLayer(groups[id]);
    }
    event.currentTarget.textContent = allVisible ? 'Ocultar todas' : 'Mostrar todas';
  });

  document.querySelectorAll('.basemap-option').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.basemap-option').forEach(item => item.classList.toggle('selected', item === button));
    Object.values(basemaps).forEach(layer => map.removeLayer(layer));
    basemaps[button.dataset.basemap].addTo(map);
  }));

  function removeSearchMarker() { if (searchMarker) map.removeLayer(searchMarker); searchMarker = null; }
  function openSearchItem(item) {
    const checkbox = document.querySelector(`[data-layer="${item.id}"] .layer-toggle`);
    checkbox.checked = true;
    map.addLayer(groups[item.id]);
    const bounds = item.layer.getBounds?.();
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [70, 70], maxZoom: 13, animate: true });
    else if (item.layer.getLatLng) map.setView(item.layer.getLatLng(), 14, { animate: true });
    setTimeout(() => {
      const point = item.layer.getBounds?.().getCenter() || item.layer.getLatLng?.();
      if (point) L.popup({ maxWidth: 340 }).setLatLng(point).setContent(popupMarkup(item.feature, item.id)).openOn(map);
    }, 250);
    $('#searchResults').hidden = true;
    $('#searchInput').blur();
  }

  const searchInput = $('#searchInput');
  const resultsBox = $('#searchResults');
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const query = searchInput.value.trim().toLocaleLowerCase('pt-BR');
      if (query.length < 2) { resultsBox.hidden = true; return; }
      const hits = [];
      for (const item of searchItems) {
        if (item.text.includes(query)) hits.push(item);
        if (hits.length >= 10) break;
      }
      resultsBox.innerHTML = hits.length ? hits.map((item, index) => `<button class="search-result" type="button" data-hit="${index}"><strong>${escapeHtml(item.title)}</strong><small>${layerNames[item.id]} · ${Object.entries(item.feature.properties || {}).slice(0, 2).map(([k, v]) => `${prettyKey(k)}: ${v ?? '—'}`).map(escapeHtml).join(' · ')}</small></button>`).join('') : `<div class="search-empty">${completed.size < 3 ? 'Carregando dados… tente novamente em instantes.' : 'Nenhuma feição encontrada.'}</div>`;
      resultsBox.hidden = false;
      resultsBox.querySelectorAll('.search-result').forEach((button, index) => button.addEventListener('click', () => openSearchItem(hits[index])));
    }, 180);
  });
  document.addEventListener('click', event => { if (!event.target.closest('.search-section')) resultsBox.hidden = true; });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); searchInput.focus(); }
    if (event.key === 'Escape' && measureActive) setMeasureActive(false);
  });

  $('#homeButton').addEventListener('click', () => {
    if (groups.boundary.getLayers().length) map.fitBounds(groups.boundary.getBounds(), { padding: [40, 40], maxZoom: 7 });
    else map.setView([-19.25, -44.2], 6);
  });
  $('#locateButton').addEventListener('click', () => map.locate({ setView: true, maxZoom: 14, enableHighAccuracy: true }));
  map.on('locationfound', event => {
    L.circleMarker(event.latlng, { radius: 7, color: '#fff', weight: 3, fillColor: '#3882c2', fillOpacity: 1 }).addTo(map).bindPopup('Você está aqui').openPopup();
  });
  map.on('locationerror', () => notify('Não foi possível obter sua localização. Verifique a permissão do navegador.'));
  map.on('mousemove', event => { $('#coordinates').textContent = `Lat ${event.latlng.lat.toFixed(5)} · Lon ${event.latlng.lng.toFixed(5)}`; });

  function distanceMeters(a, b) {
    const rad = value => value * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function formatDistance(meters) { return meters >= 1000 ? `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km` : `${Math.round(meters).toLocaleString('pt-BR')} m`; }
  function updateMeasurement() {
    if (measureLine) map.removeLayer(measureLine);
    measureMarkers.forEach(marker => map.removeLayer(marker));
    measureMarkers = [];
    if (measurePoints.length) {
      measureLine = L.polyline(measurePoints, { color: '#e07c43', weight: 3, dashArray: '6 5', pane: 'markerPane' }).addTo(map);
      let total = 0;
      for (let i = 1; i < measurePoints.length; i++) total += distanceMeters(measurePoints[i - 1], measurePoints[i]);
      measurePoints.forEach((point, index) => {
        const marker = L.circleMarker(point, { radius: 4, color: '#fff', weight: 2, fillColor: '#e07c43', fillOpacity: 1 }).addTo(map);
        if (index === measurePoints.length - 1) marker.bindTooltip(formatDistance(total), { permanent: true, direction: 'top', className: 'measure-label' });
        measureMarkers.push(marker);
      });
    }
    $('#clearMeasure').hidden = measurePoints.length === 0;
  }
  function setMeasureActive(active) {
    measureActive = active;
    $('#measureButton').classList.toggle('active', active);
    $('#measureHint').hidden = !active;
    map.getContainer().style.cursor = active ? 'crosshair' : '';
    map.doubleClickZoom[active ? 'disable' : 'enable']();
    if (!active && measurePoints.length < 2) { measurePoints = []; updateMeasurement(); }
  }
  $('#measureButton').addEventListener('click', () => setMeasureActive(!measureActive));
  $('#finishMeasure').addEventListener('click', () => setMeasureActive(false));
  $('#clearMeasure').addEventListener('click', () => { measurePoints = []; updateMeasurement(); setMeasureActive(false); });
  map.on('click', event => { if (measureActive) { measurePoints.push(event.latlng); updateMeasurement(); } });

  $('#fullscreenButton').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await $('.map-shell').requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) { notify('Tela cheia não está disponível neste navegador.'); }
  });
  document.addEventListener('fullscreenchange', () => setTimeout(() => map.invalidateSize(), 100));

  $('#downloadView').addEventListener('click', () => {
    const features = [];
    for (const id of Object.keys(layerNames)) {
      if (!map.hasLayer(groups[id])) continue;
      groups[id].eachLayer(batch => {
        const collection = batch.toGeoJSON();
        if (collection.features) features.push(...collection.features.map(feature => ({ ...feature, properties: { ...feature.properties, _camada: layerNames[id] } })));
      });
    }
    if (!features.length) { notify('Ative uma camada com dados para exportar.'); return; }
    const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features })], { type: 'application/geo+json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'atlas-mg-camadas-visiveis.geojson'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    notify(`${features.length.toLocaleString('pt-BR')} feições exportadas em GeoJSON.`);
  });

  const aboutDialog = $('#aboutDialog');
  $('#aboutButton').addEventListener('click', () => aboutDialog.showModal());
  $('.dialog-close').addEventListener('click', () => aboutDialog.close());
  aboutDialog.addEventListener('click', event => { if (event.target === aboutDialog) aboutDialog.close(); });
  $('#dismissLoading').addEventListener('click', () => $('#loadingStatus').classList.add('dismissed'));
  window.addEventListener('resize', () => map.invalidateSize());
})();

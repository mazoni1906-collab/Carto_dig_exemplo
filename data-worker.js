const definitions = {
  hydro: { file: 'Hidro_rep.geojson', label: 'Hidrografia' },
  roads: { file: 'Rodo_rep.geojson', label: 'Rodovias' },
  boundary: { file: 'Limite_rep.geojson', label: 'Limite estadual' }
};

async function loadLayer(id) {
  const config = definitions[id];
  try {
    postMessage({ type: 'start', id, label: config.label });
    const response = await fetch(`./data/${config.file}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const features = data.features || [];
    const total = features.length;
    const batchSize = id === 'hydro' ? 900 : 450;
    for (let i = 0; i < total; i += batchSize) {
      postMessage({ type: 'batch', id, features: features.slice(i, i + batchSize), total });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    postMessage({ type: 'done', id, total });
  } catch (error) {
    postMessage({ type: 'error', id, message: error.message || 'Falha ao carregar os dados.' });
  }
}

onmessage = event => {
  const ids = event.data?.layers || Object.keys(definitions);
  (async () => {
    for (const id of ids) await loadLayer(id);
  })();
};

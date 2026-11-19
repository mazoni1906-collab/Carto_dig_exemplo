# Atlas MG — Geoportal

## Publicação no GitHub Pages

1. Extraia esta pasta.
2. Crie um repositório no GitHub e envie **todo o conteúdo** desta pasta, mantendo a subpasta `data`.
3. Em **Settings → Pages**, selecione a branch principal e a pasta `/ (root)`.
4. Aguarde a publicação e abra o endereço informado pelo GitHub Pages.

O arquivo inicial é `index.html`. Os três GeoJSON devem permanecer em `data/`.

## Observações
- O mapa usa Leaflet via CDN, OpenStreetMap e imagens de satélite Esri; é necessária conexão com a internet.
- Os arquivos GeoJSON são carregados pelo `data-worker.js`.

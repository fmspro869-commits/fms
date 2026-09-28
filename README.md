# FMS Precision 3.0

Frontendowa aplikacja do zarządzania gospodarstwem rolnym (React + TypeScript + Vite).
Dane trzymane lokalnie w `localStorage` przeglądarki. Działa jako PWA.

## Szybki start

```bash
yarn install
yarn dev
```

## Budowa pod Netlify

```bash
yarn build
```

Wynik w katalogu `dist/`. Plik `netlify.toml` jest już skonfigurowany:
- **Build command:** `yarn build`
- **Publish directory:** `dist`
- **Node:** 22

Wgraj folder `dist` na https://app.netlify.com/drop albo połącz repozytorium GitHub z Netlify.

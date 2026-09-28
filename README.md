# FMS Precision

Web application for farm management, field operations, GNSS guidance, inventory, finance, and crop analysis.

## Development

```sh
yarn install --frozen-lockfile
yarn dev
```

Production build and tests:

```sh
yarn build
yarn test
```

## Terrain and field navigation

Open **Teren 3D** to inspect a selected field over satellite imagery with a 3D elevation surface. The view uses MapLibre GL JS, Esri World Imagery, and Copernicus DEM GLO-30 tiles hosted by Microsoft Planetary Computer; an internet connection is required.

Use **Otwórz nawigację Field Pilot** to open field guidance with the field selected.

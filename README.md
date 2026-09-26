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

Open **Teren 3D** to inspect a selected field over satellite imagery with a 3D elevation surface. The view uses MapLibre GL JS, Esri World Imagery, and Copernicus DEM GLO-30 tiles hosted by Microsoft Planetary Computer; an internet connection is required. The app resolves the Copernicus one-degree DEM item for each terrain tile and requests Terrarium-encoded elevation data. Provider attribution is displayed on the map; data use remains subject to the [Copernicus DEM license](https://spacedata.copernicus.eu/documents/20126/0/CSCDA_ESA_Mission-specific+Annex.pdf). The approximately 30 m DEM is a surface model that can include vegetation and buildings; it is for visual orientation and does not replace GNSS/RTK measurements.

Use **Otwórz nawigację Field Pilot** to open field guidance with the field selected. During a session, switch between 2D and 3D: both views show A/B guidance lines, the active line, vehicle position, and the recorded track. In the 3D view, click the map to place A and B, select guidance lines, and use the existing Field Pilot guidance and follow controls.

Field Pilot works with the device GPS when no RTK receiver is connected; expect lower position accuracy. For external NMEA GNSS/RTK, connect a receiver through USB/serial from the Field Pilot setup screen or its tools drawer (Chrome/Edge on desktop over HTTPS). The receiver must already be receiving correction data and output NMEA with fix quality. The app reads the reported fix but does not configure an NTRIP service or supply RTK corrections. The elevation surface is for visual orientation and does not replace GNSS/RTK measurements.

## Integrated analysis features

- **Finanse:** estimated machinery costs for completed Field Pilot sessions.
- **Magazyn:** stock forecasts and inventory insights.
- **Analizy i Raporty:** historical yield and field performance analysis.
- **Pogoda i Okna:** operation suitability calendar for spraying, sowing, fertilizing, and harvesting.

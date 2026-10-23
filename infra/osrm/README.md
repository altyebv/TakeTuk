# OSRM routing service

The backend's `osrm` routing provider (ADR-0017) calls a self-hosted [OSRM](https://project-osrm.org) server for the road distances behind every fare quote. This directory holds the tooling to prepare its dataset.

| File | Purpose |
|---|---|
| `prepare-dataset.sh` | Builds an OSRM dataset (car profile, MLD) from an OpenStreetMap extract, with native binaries or Docker |
| `synthetic-network.mjs` | Writes a synthetic street grid used by `backend/test/live/osrm.live-spec.ts`. It is not map data |

## Status

- **Verified:** preparing and serving the synthetic network with OSRM v26.4.0 prebuilt binaries (the `@project-osrm/osrm` npm package on Ubuntu 24.04 with `libtbb12`), and the backend adapter against that server.
- **Not verified:** the Docker path (registry pulls were blocked in the build environment; check that the image tag exists), and any real OpenStreetMap extract for Wad Madani.

## Production dataset

1. **Get an extract** covering the service area, for example Sudan from Geofabrik (`https://download.geofabrik.de/africa/sudan-latest.osm.pbf`). A smaller extract cut to the Wad Madani area (`osmium extract --bbox …`) preprocesses faster and uses less memory.
2. **Prepare it:**
   ```bash
   # Docker (default image ghcr.io/project-osrm/osrm-backend:v26.4.0, override with OSRM_IMAGE)
   infra/osrm/prepare-dataset.sh sudan-latest.osm.pbf /srv/osrm
   # or native binaries
   OSRM_BIN_DIR=/path/to/bin OSRM_PROFILE=/path/to/profiles/car.lua \
     infra/osrm/prepare-dataset.sh sudan-latest.osm.pbf /srv/osrm
   ```
3. **Serve it** on a private network, next to the API:
   ```bash
   osrm-routed --algorithm mld --port 5000 /srv/osrm/sudan-latest.osrm
   ```
4. **Configure the API:**
   ```bash
   ROUTING_PROVIDER=osrm
   OSRM_BASE_URL=https://osrm.internal.example   # http only with OSRM_ALLOW_HTTP=true on an encrypted private network
   OSRM_SNAP_RADIUS_METERS=500
   ```
5. **Refresh** the extract and rebuild periodically (weekly is plenty), then restart `osrm-routed`. Streets added to OpenStreetMap appear after the next rebuild.

Before launch, check coverage: compare quotes for a set of known Wad Madani trips with distances measured on the ground (OPEN_DECISIONS MAP-1).

**Attribution:** OpenStreetMap data is © OpenStreetMap contributors, under the ODbL. Show the attribution wherever map data is displayed (OPEN_DECISIONS MAP-2).

## Live check against a real server

```bash
node infra/osrm/synthetic-network.mjs /tmp/osrm/synthetic.osm
OSRM_BIN_DIR=… OSRM_PROFILE=…/car.lua infra/osrm/prepare-dataset.sh /tmp/osrm/synthetic.osm /tmp/osrm/data
osrm-routed --algorithm mld --port 5056 /tmp/osrm/data/synthetic.osrm &
cd backend && OSRM_LIVE_URL=http://127.0.0.1:5056 npm run test:live
```

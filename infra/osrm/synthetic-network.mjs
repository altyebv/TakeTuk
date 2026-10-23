#!/usr/bin/env node
// Writes a SYNTHETIC OpenStreetMap road network for exercising a real OSRM server in tests.
// It is not map data: an 11 x 11 grid of streets (about 220 m apart) laid over Wad Madani
// coordinates, plus one disconnected street about 10 km away. backend/test/live depends on
// this exact layout.
//
// Usage: node infra/osrm/synthetic-network.mjs <output.osm>
import { writeFileSync } from 'node:fs';

const output = process.argv[2];
if (!output) {
  console.error('usage: synthetic-network.mjs <output.osm>');
  process.exit(2);
}

const GRID = { lat: 14.39, lng: 33.51, step: 0.002, size: 11 };
const nodes = [];
const ways = [];
const id = (i, j) => i * GRID.size + j + 1;

for (let i = 0; i < GRID.size; i++) {
  for (let j = 0; j < GRID.size; j++) {
    nodes.push([id(i, j), GRID.lat + i * GRID.step, GRID.lng + j * GRID.step]);
  }
}
for (let i = 0; i < GRID.size; i++) {
  const row = Array.from({ length: GRID.size }, (_, j) => id(i, j));
  ways.push([row, i === 5 ? 'primary' : 'residential']);
}
for (let j = 0; j < GRID.size; j++) {
  ways.push([Array.from({ length: GRID.size }, (_, i) => id(i, j)), 'residential']);
}
// Disconnected island street, for NoRoute.
const island = nodes.length + 1;
nodes.push([island, 14.45, 33.6], [island + 1, 14.452, 33.6]);
ways.push([[island, island + 1], 'residential']);

const lines = [`<?xml version='1.0' encoding='UTF-8'?>`, `<osm version='0.6' generator='taketuk-synthetic'>`];
for (const [nodeId, lat, lng] of nodes) {
  lines.push(`  <node id='${nodeId}' version='1' lat='${lat.toFixed(6)}' lon='${lng.toFixed(6)}'/>`);
}
ways.forEach(([refs, highway], index) => {
  lines.push(`  <way id='${index + 1}' version='1'>`);
  for (const ref of refs) lines.push(`    <nd ref='${ref}'/>`);
  lines.push(`    <tag k='highway' v='${highway}'/>`, '  </way>');
});
lines.push('</osm>', '');
writeFileSync(output, lines.join('\n'));
console.log(`wrote ${nodes.length} nodes and ${ways.length} ways to ${output}`);

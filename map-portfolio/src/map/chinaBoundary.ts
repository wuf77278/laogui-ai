import type { FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import { feature } from "topojson-client";
import countries from "world-atlas/countries-110m.json";

type CountryFeature = {
  id?: string | number;
  geometry: Geometry;
};

function polygonOuterRings(geometry: Geometry): Position[][] {
  if (geometry.type === "Polygon") return [(geometry as Polygon).coordinates[0]];
  if (geometry.type === "MultiPolygon") return (geometry as MultiPolygon).coordinates.map((polygon) => polygon[0]);
  return [];
}

function ensureCounterClockwise(ring: Position[]): Position[] {
  let orientation = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    orientation += (ring[index + 1][0] - ring[index][0]) * (ring[index + 1][1] + ring[index][1]);
  }
  return orientation > 0 ? [...ring].reverse() : ring;
}

export function getChinaBoundaryRings(): Position[][] {
  const topology = countries as unknown as Parameters<typeof feature>[0];
  const countriesObject = countries.objects.countries as unknown as Parameters<typeof feature>[1];
  const collection = feature(topology, countriesObject) as unknown as FeatureCollection;
  return (collection.features as CountryFeature[])
    .filter((country) => ["156", "158"].includes(String(country.id)))
    .flatMap((country) => polygonOuterRings(country.geometry))
    .map(ensureCounterClockwise)
    .filter((ring) => ring.length >= 3);
}

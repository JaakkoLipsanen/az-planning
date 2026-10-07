import type { Geometry as GeoJsonGeometry, Polygon as GeoJsonPolygon } from 'geojson';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import TopologyPreservingSimplifier from 'jsts/org/locationtech/jts/simplify/TopologyPreservingSimplifier.js';

/** Opaque JTS geometry; only the functions in this module touch its API. */
export type Shape = { readonly __jts: unique symbol };

const reader = new GeoJSONReader(new GeometryFactory());
const writer = new GeoJSONWriter();

export function fromGeoJson(geometry: GeoJsonGeometry): Shape {
  return reader.read(geometry) as Shape;
}

function toGeoJson(shape: Shape): GeoJsonGeometry {
  return writer.write(shape) as GeoJsonGeometry;
}

export function buffer(shape: Shape, distance: number, quadrantSegments = 8): Shape {
  return BufferOp.bufferOp(shape, distance, quadrantSegments) as Shape;
}

/** Repairs self-intersections the usual JTS way (zero-width buffer). */
export function makeValid(shape: Shape): Shape {
  return new IsValidOp(shape).isValid() ? shape : buffer(shape, 0);
}

export function intersection(a: Shape, b: Shape): Shape {
  return OverlayOp.overlayOp(a, b, OverlayOp.INTERSECTION) as Shape;
}

export function simplifyShape(shape: Shape, tolerance: number): Shape {
  return TopologyPreservingSimplifier.simplify(shape, tolerance) as Shape;
}

function collectPolygons(geometry: GeoJsonGeometry): GeoJsonPolygon[] {
  if (geometry.type === 'Polygon') return [geometry];
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }));
  }
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(collectPolygons);
  return [];
}

export function polygonsOf(shape: Shape): GeoJsonPolygon[] {
  return collectPolygons(toGeoJson(shape));
}

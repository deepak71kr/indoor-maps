/**
 * Map file format — types and constants only (zero runtime cost for the visitor app).
 * Validation lives in `@innermap/schema/validate`.
 */
export * from './constants';
export type {
  Amenity,
  Connector,
  Edge,
  Level,
  MapFile,
  MapNode,
  QrAnchor,
  Room,
  Shape,
} from './format-v0';

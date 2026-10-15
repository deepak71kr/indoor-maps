/**
 * Map file format 0 (prototype). See docs/PROTOTYPE.md §4.
 *
 * Conventions:
 * - Coordinates `x`, `y` are meters on the floor; x grows east (right), y grows south (down),
 *   same as SVG. All floors of a site share the same origin.
 * - `facing` is in degrees clockwise from "up" on the plan (0 = up/north, 90 = right/east).
 *   For a QR sticker it is the direction a person looks while reading it.
 * - Edge distances are NOT stored; they are computed from node positions.
 */
import { z } from 'zod';
import {
  AMENITY_KINDS,
  CONNECTOR_KINDS,
  EDGE_KINDS,
  FORMAT_VERSION,
  LEVEL_COLORS,
  NODE_KINDS,
  ROOM_CATEGORIES,
  VISIBILITIES,
} from './constants';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, {
  message: 'must be 1–64 letters, digits, "-" or "_", starting with a letter or digit',
});
const text = z.string().trim().min(1).max(120);
const meters = z.number().finite().min(-10_000).max(10_000);

export const LevelSchema = z.strictObject({
  id,
  name: text,
  /** Sort order: -1 basement, 0 ground, 1.5 mezzanine… */
  ord: z.number().finite(),
  color: z.enum(LEVEL_COLORS),
  image: z.string().min(1).optional(),
  pxPerMeter: z.number().positive().optional(),
});

export const NodeSchema = z.strictObject({
  id,
  lvl: id,
  x: meters,
  y: meters,
  kind: z.enum(NODE_KINDS),
  /** Visible landmark, e.g. "Pharmacy counter (green board)". Makes the dot a visitor step. */
  landmark: text.optional(),
});

export const EdgeSchema = z.strictObject({
  a: id,
  b: id,
  kind: z.enum(EDGE_KINDS).optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  /** Only walkable from `a` to `b`. */
  oneWay: z.boolean().optional(),
});

export const ConnectorSchema = z.strictObject({
  id,
  kind: z.enum(CONNECTOR_KINDS),
  name: text,
  /**
   * level id → node id of the stop on that level. A lift may skip levels.
   * Key order is NOT meaningful (JS puts number-like ids such as "2" first) — sort by level `ord`.
   */
  stops: z.record(id, id),
});

export const RoomSchema = z.strictObject({
  id,
  name: text,
  number: z.string().trim().min(1).max(20).optional(),
  category: z.enum(ROOM_CATEGORIES),
  /** Door node ids; routing picks the closest one. */
  doors: z.array(id).min(1),
  visibility: z.enum(VISIBILITIES).optional(),
});

export const AmenitySchema = z.strictObject({
  id,
  kind: z.enum(AMENITY_KINDS),
  node: id,
  name: text.optional(),
});

export const QrAnchorSchema = z.strictObject({
  /** Short code printed under the QR, typed if the QR can't be scanned. */
  code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, {
    message: 'must be 2–16 uppercase letters, digits or "-"',
  }),
  node: id,
  facing: z.number().min(0).lt(360),
});

export const MapFileSchema = z.strictObject({
  fmt: z.literal(FORMAT_VERSION),
  site: z.strictObject({ id, name: text }),
  levels: z.array(LevelSchema).min(1),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  connectors: z.array(ConnectorSchema),
  rooms: z.array(RoomSchema),
  amenities: z.array(AmenitySchema),
  qr: z.array(QrAnchorSchema),
});

export type Level = z.infer<typeof LevelSchema>;
export type MapNode = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Connector = z.infer<typeof ConnectorSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Amenity = z.infer<typeof AmenitySchema>;
export type QrAnchor = z.infer<typeof QrAnchorSchema>;
export type MapFile = z.infer<typeof MapFileSchema>;

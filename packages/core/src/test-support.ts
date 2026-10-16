import type { MapFile } from '@innermap/schema';
import campus from '../../../samples/demo-campus/map.json';
import demo from '../../../samples/demo-hospital/map.json';

/** A fresh, mutable copy of the Demo Hospital sample (tests only). */
export function demoMap(): MapFile {
  return JSON.parse(JSON.stringify(demo)) as MapFile;
}

/** A fresh, mutable copy of the Demo College campus sample (tests only). */
export function campusMap(): MapFile {
  return JSON.parse(JSON.stringify(campus)) as MapFile;
}

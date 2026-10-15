import type { MapFile } from '@innermap/schema';
import demo from '../../../samples/demo-hospital/demo.json';

/** A fresh, mutable copy of the Demo Hospital sample (tests only). */
export function demoMap(): MapFile {
  return JSON.parse(JSON.stringify(demo)) as MapFile;
}

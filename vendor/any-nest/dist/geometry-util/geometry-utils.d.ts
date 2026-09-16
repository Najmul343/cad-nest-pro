import FloatRect from "./float-rect";
import { ArrayPolygon, ClipperPoint, Point } from "../interfaces";
export declare function polygonArea(polygon: Array<Point>): number;
export declare function getPolygonBounds(polygon: ArrayPolygon): FloatRect | null;
export declare function pointInPolygon(point: Point, polygon: ArrayPolygon): boolean;
export declare function toClipperCoordinates(polygon: Array<Point>, scale?: number): ClipperPoint[];
export declare function toNestCoordinates(polygon: ClipperPoint[], scale: number): Array<Point>;

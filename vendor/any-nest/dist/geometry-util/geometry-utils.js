import ClipperLib from "js-clipper";
// returns the area of the polygon, assuming no self-intersections
import FloatPoint from "./float-point.js";
import FloatRect from "./float-rect.js";
//TODO: depreacete when polygone will be moved to class
// private shared variables/methods
// a negative area indicates counter-clockwise winding direction
export function polygonArea(polygon) {
    var pointCount = polygon.length;
    var result = 0;
    var i = 0;
    var currentPoint;
    var prevPoint;
    for (i = 0; i < pointCount; ++i) {
        prevPoint = polygon.at((i - 1 + pointCount) % pointCount);
        currentPoint = polygon.at(i);
        result += (prevPoint.x + currentPoint.x) * (prevPoint.y - currentPoint.y);
    }
    return 0.5 * result;
}
// returns the rectangular bounding box of the given polygon
export function getPolygonBounds(polygon) {
    if (polygon.points.length < 3) {
        return null;
    }
    var pointCount = polygon.points.length;
    var min = FloatPoint.from(polygon.points.at(0));
    var max = FloatPoint.from(polygon.points.at(0));
    var i = 0;
    for (i = 1; i < pointCount; ++i) {
        max.max(polygon.points.at(i));
        min.min(polygon.points.at(i));
    }
    return FloatRect.fromPoints(min, max);
}
// return true if point is in the polygon, false if outside, and null if exactly on a point or edge
export function pointInPolygon(point, polygon) {
    if (polygon.points.length < 3) {
        return false;
    }
    var innerPoint = FloatPoint.from(point);
    var pointCount = polygon.points.length;
    var result = false;
    var offset = new FloatPoint(polygon.offsetx || 0, polygon.offsety || 0);
    var currentPoint = new FloatPoint();
    var prevPoint = new FloatPoint();
    var i = 0;
    for (i = 0; i < pointCount; ++i) {
        currentPoint.set(polygon.points.at(i)).add(offset);
        prevPoint.set(polygon.points.at((i - 1 + pointCount) % pointCount)).add(offset);
        if (innerPoint.almostEqual(currentPoint) ||
            innerPoint.onSegment(currentPoint, prevPoint)) {
            return false; // no result or exactly on the segment
        }
        if (FloatPoint.almostEqual(currentPoint, prevPoint)) {
            // ignore very small lines
            continue;
        }
        if (currentPoint.y - point.y > 0 !== prevPoint.y - point.y > 0 &&
            point.x - currentPoint.x <
                ((prevPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
                    (prevPoint.y - currentPoint.y)) {
            result = !result;
        }
    }
    return result;
}
// jsClipper uses X/Y instead of x/y...
export function toClipperCoordinates(polygon, scale) {
    if (scale === void 0) { scale = 1; }
    var size = polygon.length;
    var result = [];
    var i = 0;
    var point;
    for (i = 0; i < size; ++i) {
        point = polygon[i];
        result.push({ X: point.x, Y: point.y });
    }
    if (scale !== 1) {
        ClipperLib.JS.ScaleUpPath(result, scale);
    }
    return result;
}
export function toNestCoordinates(polygon, scale) {
    var size = polygon.length;
    var result = new Array();
    var i = 0;
    var point;
    for (i = 0; i < size; ++i) {
        point = polygon[i];
        result.push({
            x: point.X / scale,
            y: point.Y / scale
        });
    }
    return result;
}

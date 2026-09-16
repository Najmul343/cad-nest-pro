//@ts-ignore
import ClipperLib from "js-clipper";
import { polygonArea, getPolygonBounds, pointInPolygon, toClipperCoordinates, toNestCoordinates } from "../../geometry-util/index.js";
import FloatPoint from "../../geometry-util/float-point.js";
import { keyToNFPData } from "../../util.js";
import { almostEqual } from "../../util.js";
import { FloatPolygon } from "../../geometry-util/float-polygon.js";
/*!
 * General purpose geometry functions for polygon/Bezier calculations
 * Copyright 2015 Jack Qiao
 * Licensed under the MIT license
 */
// floating point comparison tolerance
var TOL = Math.pow(10, -9); // Floating point error is likely to be above 1 epsilon
function checkIntersection(a, b, c) {
    var offset = Math.abs(a - b);
    return offset >= Math.pow(10, -9) && Math.abs(2 * c - a - b) <= offset;
}
function isRectangle(polygon) {
    var pointCount = polygon.points.length;
    var boundRect = getPolygonBounds(polygon);
    var bottomLeft = boundRect.bottomLeft;
    var topRight = boundRect.topRight;
    var i = 0;
    var point;
    for (i = 0; i < pointCount; ++i) {
        point = polygon.points.at(i);
        if ((!almostEqual(point.x, bottomLeft.x) &&
            !almostEqual(point.x, topRight.x)) ||
            (!almostEqual(point.y, bottomLeft.y) && !almostEqual(point.y, topRight.y))) {
            return false;
        }
    }
    return true;
}
// returns the intersection of AB and EF
// or null if there are no intersections or other numerical error
// if the infinite flag is set, AE and EF describe infinite lines without endpoints, they are finite line segments otherwise
function lineIntersect(A, B, E, F, infinite) {
    if (infinite === void 0) { infinite = false; }
    var a1 = B.y - A.y;
    var b1 = A.x - B.x;
    var c1 = B.x * A.y - A.x * B.y;
    var a2 = F.y - E.y;
    var b2 = E.x - F.x;
    var c2 = F.x * E.y - E.x * F.y;
    var denom = a1 * b2 - a2 * b1;
    var result = new FloatPoint((b1 * c2 - b2 * c1) / denom, (a2 * c1 - a1 * c2) / denom);
    if (!isFinite(result.x) ||
        !isFinite(result.y) ||
        (!infinite &&
            (checkIntersection(A.x, B.x, result.x) ||
                checkIntersection(A.y, B.y, result.y) ||
                checkIntersection(E.x, F.x, result.x) ||
                checkIntersection(E.y, F.y, result.y)))) {
        return null;
    }
    return result;
}
function checkPolygon(polygon1, polygon2, point1, point2, index, indexOffset, pointOffset) {
    var size = polygon1.points.length;
    var pointIndex = (index + indexOffset + size) % size;
    if (pointIndex === index ||
        FloatPoint.almostEqual(polygon1.points.at(pointIndex), polygon1.points.at(index))) {
        pointIndex = (pointIndex + indexOffset + size) % size;
    }
    point1.set(polygon1.points.at(pointIndex)).add(pointOffset);
    return pointInPolygon(point1, polygon2) !== pointInPolygon(point2, polygon2);
}
// todo: swap this for a more efficient sweep-line implementation
// returnEdges: if set, return all edges on A that have intersections
function intersect(polygonA, polygonB) {
    var offsetA = new FloatPoint(polygonA.offsetx || 0, polygonA.offsety || 0);
    var offsetB = new FloatPoint(polygonB.offsetx || 0, polygonB.offsety || 0);
    var aSize = polygonA.points.length;
    var bSize = polygonB.points.length;
    var a1 = new FloatPoint();
    var a2 = new FloatPoint();
    var b1 = new FloatPoint();
    var b2 = new FloatPoint();
    var point = new FloatPoint();
    var i = 0;
    var j = 0;
    for (i = 0; i < aSize - 1; ++i) {
        a1.set(polygonA.points.at(i)).add(offsetA);
        a2.set(polygonA.points.at(i + 1)).add(offsetA);
        for (j = 0; j < bSize - 1; ++j) {
            b1.set(polygonB.points.at(j)).add(offsetB);
            b2.set(polygonB.points.at(j + 1)).add(offsetB);
            if (b1.onSegment(a1, a2) || b1.almostEqual(a1)) {
                // if a point is on a segment, it could intersect or it could not. Check via the neighboring points
                if (checkPolygon(polygonB, polygonA, point, b2, j, -1, offsetB)) {
                    return true;
                }
                else {
                    continue;
                }
            }
            if (b2.onSegment(a1, a2) || b2.almostEqual(a2)) {
                // if a point is on a segment, it could intersect or it could not. Check via the neighboring points
                if (checkPolygon(polygonB, polygonA, point, b1, j + 1, 1, offsetB)) {
                    return true;
                }
                else {
                    continue;
                }
            }
            if (a1.onSegment(b1, b2) || a1.almostEqual(b2)) {
                // if a point is on a segment, it could intersect or it could not. Check via the neighboring points
                if (checkPolygon(polygonA, polygonB, point, a2, i, -1, offsetA)) {
                    return true;
                }
                else {
                    continue;
                }
            }
            if (a2.onSegment(b1, b2) || a2.almostEqual(b1)) {
                // if a point is on a segment, it could intersect or it could not. Check via the neighboring points
                if (checkPolygon(polygonA, polygonB, point, a1, i + 1, 1, offsetA)) {
                    return true;
                }
                else {
                    continue;
                }
            }
            if (lineIntersect(b1, b2, a1, a2) !== null) {
                return true;
            }
        }
    }
    return false;
}
function pointDistance(p, s1, s2, normal, infinite) {
    if (infinite === void 0) { infinite = false; }
    var localNormal = FloatPoint.normalizeVector(normal);
    var dir = FloatPoint.normal(localNormal);
    var pDot = dir.dot(p);
    var s1Dot = dir.dot(s1);
    var s2Dot = dir.dot(s2);
    var pDotNorm = localNormal.dot(p);
    var s1DotNorm = localNormal.dot(s1);
    var s2DotNorm = localNormal.dot(s2);
    var diffNorm1 = pDotNorm - s1DotNorm;
    var diffNorm2 = pDotNorm - s2DotNorm;
    var diff1 = pDot - s1Dot;
    var diff2 = pDot - s2Dot;
    if (!infinite) {
        if ((diff1 < TOL && diff2 < TOL) || (diff1 > -TOL && diff2 > -TOL)) {
            return -1; // dot doesn't collide with segment, or lies directly on the vertex
        }
        if (almostEqual(pDot, s1Dot) &&
            almostEqual(pDot, s2Dot) &&
            diffNorm1 > 0 &&
            diffNorm2 > 0) {
            return Math.min(diffNorm1, diffNorm2);
        }
        if (almostEqual(pDot, s1Dot) &&
            almostEqual(pDot, s2Dot) &&
            diffNorm1 < 0 &&
            diffNorm1 < 0) {
            return Math.max(diffNorm1, diffNorm2);
        }
    }
    return ((s1DotNorm - s2DotNorm) * diff1) / (s1Dot - s2Dot) - diffNorm1;
}
export function segmentDistance(A, B, E, F, direction) {
    var normal = FloatPoint.normal(direction);
    var reverse = FloatPoint.reverse(direction);
    var dotA = normal.dot(A);
    var dotB = normal.dot(B);
    var dotE = normal.dot(E);
    var dotF = normal.dot(F);
    var crossA = direction.dot(A);
    var crossB = direction.dot(B);
    var crossE = direction.dot(E);
    var crossF = direction.dot(F);
    var minAB = Math.min(dotA, dotB);
    var maxAB = Math.max(dotA, dotB);
    var maxEF = Math.max(dotE, dotF);
    var minEF = Math.min(dotE, dotF);
    var offsetAB = FloatPoint.sub(A, B);
    var offsetEF = FloatPoint.sub(E, F);
    // segments that will merely touch at one point
    // segments miss eachother completely
    if (almostEqual(maxAB, minEF) ||
        almostEqual(minAB, maxEF) ||
        maxAB < minEF ||
        minAB > maxEF) {
        return null;
    }
    var overlap = 1;
    var maxOffset = maxAB - maxEF;
    var minOffset = minAB - minEF;
    if (Math.abs(maxOffset + minOffset) >= Math.abs(maxOffset - minOffset)) {
        var minMax = Math.min(maxAB, maxEF);
        var maxMin = Math.max(minAB, minEF);
        var maxMax = Math.max(maxAB, maxEF);
        var minMin = Math.min(minAB, minEF);
        overlap = (minMax - maxMin) / (maxMax - minMin);
    }
    var offsetEA = FloatPoint.sub(A, E);
    var offsetFA = FloatPoint.sub(A, F);
    var crossABE = offsetEA.cross(offsetAB, -1);
    var crossABF = offsetFA.cross(offsetAB, -1);
    // lines are colinear
    if (almostEqual(crossABE, 0) && almostEqual(crossABF, 0)) {
        var normalAB = FloatPoint.normal(offsetAB);
        var normalEF = FloatPoint.normal(offsetEF);
        normalAB.scale(1 / normalAB.length);
        normalEF.scale(1 / normalEF.length);
        // segment normals must point in opposite directions
        if (Math.abs(normalAB.cross(normalEF, -1)) < TOL &&
            normalAB.dot(normalEF) < 0) {
            // normal of AB segment must point in same direction as given direction vector
            var normalDot = direction.dot(normalAB);
            // the segments merely slide along eachother
            if (almostEqual(normalDot, 0)) {
                return null;
            }
            if (normalDot < 0) {
                return 0;
            }
        }
        return null;
    }
    var distances = [];
    var d = null;
    var delat = 0;
    // coincident points
    if (almostEqual(dotA, dotE)) {
        distances.push(crossA - crossE);
    }
    else if (almostEqual(dotA, dotF)) {
        distances.push(crossA - crossF);
    }
    else if (dotA > minEF && dotA < maxEF) {
        d = pointDistance(A, E, F, reverse);
        if (d !== null && Math.abs(d) < TOL) {
            //  A currently touches EF, but AB is moving away from EF
            delat = pointDistance(B, E, F, reverse, true);
            if (delat < 0 || Math.abs(delat * overlap) < TOL) {
                d = null;
            }
        }
        if (d !== null) {
            distances.push(d);
        }
    }
    if (almostEqual(dotB, dotE)) {
        distances.push(crossB - crossE);
    }
    else if (almostEqual(dotB, dotF)) {
        distances.push(crossB - crossF);
    }
    else if (dotB > minEF && dotB < maxEF) {
        d = pointDistance(B, E, F, reverse);
        if (d !== null && Math.abs(d) < TOL) {
            // crossA>crossB A currently touches EF, but AB is moving away from EF
            delat = pointDistance(A, E, F, reverse, true);
            if (delat < 0 || Math.abs(delat * overlap) < TOL) {
                d = null;
            }
        }
        if (d !== null) {
            distances.push(d);
        }
    }
    if (dotE > minAB && dotE < maxAB) {
        d = pointDistance(E, A, B, direction);
        if (d !== null && Math.abs(d) < TOL) {
            // crossF<crossE A currently touches EF, but AB is moving away from EF
            delat = pointDistance(F, A, B, direction, true);
            if (delat < 0 || Math.abs(delat * overlap) < TOL) {
                d = null;
            }
        }
        if (d !== null) {
            distances.push(d);
        }
    }
    if (dotF > minAB && dotF < maxAB) {
        d = pointDistance(F, A, B, direction);
        if (d !== null && Math.abs(d) < TOL) {
            // && crossE<crossF A currently touches EF, but AB is moving away from EF
            delat = pointDistance(E, A, B, direction, true);
            if (delat < 0 || Math.abs(delat * overlap) < TOL) {
                d = null;
            }
        }
        if (d !== null) {
            distances.push(d);
        }
    }
    return distances.length ? Math.min.apply(Math, distances) : null;
}
function polygonSlideDistance(a, b, direction, ignoreNegative) {
    var a1 = new FloatPoint();
    var a2 = new FloatPoint();
    var b1 = new FloatPoint();
    var b2 = new FloatPoint();
    var offsetA = new FloatPoint(a.offsetx || 0, a.offsety || 0);
    var offsetB = new FloatPoint(b.offsetx || 0, b.offsety || 0);
    var dir = FloatPoint.normalizeVector(direction);
    var edgeA = FloatPolygon.fromPoints(a.points, a.id); // TODO: this should be a full clone?
    var edgeB = FloatPolygon.fromPoints(b.points, b.id);
    var sizeA = edgeA.points.length;
    var sizeB = edgeB.points.length;
    var result = null;
    var distance = null;
    var i = 0;
    var j = 0;
    // close the loop for polygons
    if (edgeA.points.at(0) != edgeA.points.at(sizeA - 1)) {
        ++sizeA;
        edgeA.points.push(edgeA.points.at(0));
    }
    if (edgeB.points.at(0) != edgeB.points.at(sizeB - 1)) {
        ++sizeB;
        edgeB.points.push(edgeB.points.at(0));
    }
    for (i = 0; i < sizeB - 1; ++i) {
        b1.set(edgeB.points.at(i)).add(offsetB);
        b2.set(edgeB.points.at(i + 1)).add(offsetB); // 8, 10   x  13, 10
        if (FloatPoint.almostEqual(b1, b2)) {
            continue;
        }
        for (j = 0; j < sizeA - 1; ++j) {
            a1.set(edgeA.points.at(j)).add(offsetA);
            a2.set(edgeA.points.at(j + 1)).add(offsetA);
            if (FloatPoint.almostEqual(a1, a2)) {
                continue; // ignore extremely small lines
            }
            distance = segmentDistance(a1, a2, b1, b2, dir);
            if (distance !== null &&
                (result === null || distance < result) &&
                (!ignoreNegative || distance > 0 || almostEqual(distance, 0))) {
                result = distance;
            }
        }
    }
    return result;
}
// project each point of B onto A in the given direction, and return the
function polygonProjectionDistance(a, b, direction) {
    var offsetA = new FloatPoint(a.offsetx || 0, a.offsety || 0);
    var offsetB = new FloatPoint(b.offsetx || 0, b.offsety || 0);
    var edgeA = FloatPolygon.fromPoints(a.points, a.id);
    var edgeB = FloatPolygon.fromPoints(b.points, b.id);
    var p = new FloatPoint();
    var s1 = new FloatPoint();
    var s2 = new FloatPoint();
    var result = null;
    var distance = null;
    var sizeA = edgeA.points.length;
    var sizeB = edgeB.points.length;
    var minProjection = null;
    var i = 0;
    var j = 0;
    // close the loop for polygons
    if (edgeA.points.at(0) != edgeA.points.at(sizeA - 1)) {
        ++sizeA;
        edgeA.points.push(edgeA.points.at(0));
    }
    if (edgeB.points.at(0) != edgeB.points.at(sizeB - 1)) {
        ++sizeB;
        edgeB.points.push(edgeB.points.at(0));
    }
    for (i = 0; i < sizeB; ++i) {
        // the shortest/most negative projection of B onto A
        minProjection = null;
        p.set(edgeB.points.at(i)).add(offsetB);
        for (j = 0; j < sizeA - 1; ++j) {
            s1.set(edgeA.points.at(j)).add(offsetA);
            s2.set(edgeA.points.at(j + 1)).add(offsetA);
            if (almostEqual((s2.y - s1.y) * direction.x, (s2.x - s1.x) * direction.y)) {
                continue;
            }
            // project point, ignore edge boundaries
            distance = pointDistance(p, s1, s2, direction);
            if (distance !== null &&
                (minProjection === null || distance < minProjection)) {
                minProjection = distance;
            }
        }
        if (minProjection !== null && (result === null || minProjection > result)) {
            result = minProjection;
        }
    }
    return result;
}
// searches for an arrangement of A and B such that they do not overlap
// if an NFP is given, only search for startpoints that have not already been traversed in the given NFP
function searchStartPoint(A, B, inside, NFP) {
    if (NFP === void 0) { NFP = []; }
    // clone arrays
    var edgeA = FloatPolygon.fromPoints(A.points, A.id);
    var edgeB = FloatPolygon.fromPoints(B.points, B.id);
    var offset = new FloatPoint();
    var point = new FloatPoint();
    var i = 0;
    var j = 0;
    var k = 0;
    var projectionDistance1 = 0;
    var projectionDistance2 = 0;
    var vectorDistance = 0;
    var distance = 0;
    var sizeA = edgeA.points.length;
    var sizeB = edgeB.points.length;
    // close the loop for polygons
    if (edgeA.points.at(0) != edgeA.points.at(sizeA - 1)) {
        ++sizeA;
        edgeA.points.push(edgeA.points.at(0));
    }
    if (edgeB.points.at(0) != edgeB.points.at(sizeB - 1)) {
        ++sizeB;
        edgeB.points.push(edgeB.points.at(0));
    }
    for (i = 0; i < sizeA - 1; ++i) {
        if (!edgeA.points.at(i).marked) {
            edgeA.points.at(i).marked = true;
            for (j = 0; j < sizeB; ++j) {
                offset.set(edgeA.points.at(i)).sub(edgeB.points.at(j));
                edgeB.setOffset(offset);
                var firstNonIdenticalPointIsInside = null;
                for (k = 0; k < sizeB; ++k) {
                    firstNonIdenticalPointIsInside = pointInPolygon(point.set(edgeB.points.at(k)).add(offset), edgeA);
                    if (firstNonIdenticalPointIsInside != null) {
                        break;
                    }
                }
                // A and B are the same shape (ie. all points in B are on the perimiter of A)
                if (firstNonIdenticalPointIsInside == null) {
                    return null;
                }
                if ((firstNonIdenticalPointIsInside == inside) && !intersect(edgeA, edgeB) && !inNfp(offset, NFP)) {
                    return offset.clone();
                }
                // slide B along vector
                point.set(edgeA.points.at(i + 1)).sub(edgeA.points.at(i));
                projectionDistance1 = polygonProjectionDistance(edgeA, edgeB, point);
                projectionDistance2 = polygonProjectionDistance(edgeB, edgeA, FloatPoint.reverse(point));
                // todo: clean this up
                if (projectionDistance1 === null && projectionDistance2 === null) {
                    continue;
                }
                projectionDistance1 =
                    projectionDistance1 === null
                        ? projectionDistance2
                        : projectionDistance1;
                projectionDistance2 =
                    projectionDistance2 === null
                        ? projectionDistance1
                        : projectionDistance2;
                distance = Math.min(projectionDistance1, projectionDistance2);
                // only slide until no longer negative
                // todo: clean this up
                if (Math.abs(distance) < TOL || distance <= 0) {
                    continue;
                }
                vectorDistance = point.length;
                if (distance - vectorDistance < -TOL) {
                    point.scale(distance / vectorDistance);
                }
                offset.add(point);
                edgeB.setOffset(offset);
                firstNonIdenticalPointIsInside = null;
                for (k = 0; k < sizeB; ++k) {
                    firstNonIdenticalPointIsInside = pointInPolygon(point.set(edgeB.points.at(k)).add(offset), edgeA);
                    if (firstNonIdenticalPointIsInside != null) {
                        break;
                    }
                }
                if ((firstNonIdenticalPointIsInside == inside) && !intersect(edgeA, edgeB) && !inNfp(offset, NFP)) {
                    return offset.clone();
                }
            }
        }
    }
    return null;
}
// returns true if point already exists in the given nfp
function inNfp(p, nfp) {
    if (nfp === void 0) { nfp = []; }
    if (nfp.length == 0) {
        return false;
    }
    var rootSize = nfp.length;
    var nfpCount = 0;
    var i = 0;
    var j = 0;
    var nfpItem;
    for (i = 0; i < rootSize; ++i) {
        nfpItem = nfp.at(i);
        nfpCount = nfpItem.length;
        for (j = 0; j < nfpCount; ++j) {
            if (FloatPoint.almostEqual(p, nfpItem.at(j))) {
                return true;
            }
        }
    }
    return false;
}
// given a static polygon A and a movable polygon B, compute a no fit polygon by orbiting B about A
// if the inside flag is set, B is orbited inside of A rather than outside
// if the searchEdges flag is set, all edges of A are explored for NFPs - multiple
function noFitPolygon(a, b, inside, searchEdges) {
    if (a.points.length < 3 || b.points.length < 3) {
        return null;
    }
    a.setOffset(new FloatPoint(0, 0));
    var sizeA = a.points.length;
    var sizeB = b.points.length;
    var i = 0;
    var j = 0;
    var minA = a.points.at(0).y;
    var minAIndex = 0;
    var maxB = b.points.at(0).y;
    var maxBIndex = 0;
    for (i = 1; i < sizeA; ++i) {
        a.points.at(i).marked = false;
        if (a.points.at(i).y < minA) {
            minA = a.points.at(i).y;
            minAIndex = i;
        }
    }
    for (i = 1; i < sizeB; ++i) {
        b.points.at(i).marked = false;
        if (b.points.at(i).y > maxB) {
            maxB = b.points.at(i).y;
            maxBIndex = i;
        }
    }
    var startPoint = !inside
        ? // shift B such that the bottom-most point of B is at the top-most point of A. This guarantees an initial placement with no intersections
            FloatPoint.sub(b.points.at(maxBIndex), a.points.at(minAIndex))
        : // no reliable heuristic for inside
            searchStartPoint(a, b, true);
    var reference = new FloatPoint();
    var start = new FloatPoint();
    var offset = new FloatPoint();
    var point1 = new FloatPoint();
    var point2 = new FloatPoint();
    var point3 = new FloatPoint();
    var prevUnit = new FloatPoint();
    var unitV = new FloatPoint();
    var nfpList = [];
    var sumSize = sizeA + sizeB;
    var counter = 0;
    // maintain a list of touching points/edges
    var touching;
    var vectors;
    var vectorA1;
    var vectorA2;
    var vectorB1;
    var vectorB2;
    var looped = false;
    var prevVector = null;
    var nfp = null;
    var vLength2 = 0;
    var prevAIndex = 0;
    var nextAIndex = 0;
    var prevBIndex = 0;
    var nextBIndex = 0;
    var distance = 0;
    var maxDistance = 0;
    var translate;
    var prevA;
    var nextA;
    var prevB;
    var nextB;
    var vertexA;
    var vertexB;
    var touchingItem;
    while (startPoint !== null) {
        offset.set(startPoint);
        b.setOffset(offset);
        prevVector = null; // keep track of previous vector
        nfp = new Array();
        nfp.push(FloatPoint.add(b.points.at(0), startPoint));
        reference.set(b.points.at(0)).add(startPoint);
        start.set(reference);
        counter = 0;
        while (counter < 10 * sumSize) {
            // sanity check, prevent infinite loop
            touching = [];
            // find touching vertices/edges
            for (i = 0; i < sizeA; ++i) {
                for (j = 0; j < sizeB; ++j) {
                    point1.set(b.points.at(j)).add(offset);
                    point2.set(b.points.at((j + 1) % sizeB)).add(offset);
                    point3.set(a.points.at(i));
                    if (FloatPoint.almostEqual(a.points.at(i), point1)) {
                        touching.push({ type: 0, A: i, B: j });
                    }
                    else if (point1.onSegment(a.points.at(i), a.points.at((i + 1) % sizeA))) {
                        touching.push({ type: 1, A: (i + 1) % sizeA, B: j });
                    }
                    else if (point3.onSegment(point1, point2)) {
                        touching.push({ type: 2, A: i, B: (j + 1) % sizeB });
                    }
                }
            }
            // generate translation vectors from touching vertices/edges
            vectors = [];
            for (i = 0; i < touching.length; ++i) {
                touchingItem = touching.at(i);
                vertexA = a.points.at(touchingItem.A);
                vertexA.marked = true;
                // adjacent A vertices
                prevAIndex = (touchingItem.A - 1 + sizeA) % sizeA; // loop
                nextAIndex = (touchingItem.A + 1) % sizeA; // loop
                prevA = a.points.at(prevAIndex);
                nextA = a.points.at(nextAIndex);
                // adjacent B vertices
                vertexB = b.points.at(touchingItem.B);
                prevBIndex = (touchingItem.B - 1 + sizeB) % sizeB;
                nextBIndex = (touchingItem.B + 1) % sizeB;
                prevB = b.points.at(prevBIndex);
                nextB = b.points.at(nextBIndex);
                if (touchingItem.type == 0) {
                    vectorA1 = FloatPoint.sub(vertexA, prevA);
                    vectorA2 = FloatPoint.sub(vertexA, nextA);
                    // B vectors need to be inverted
                    vectorB1 = FloatPoint.sub(prevB, vertexB);
                    vectorB2 = FloatPoint.sub(nextB, vertexB);
                    (vectorA1.start = vertexA), (vectorA1.end = prevA);
                    (vectorA2.start = vertexA), (vectorA2.end = nextA);
                    (vectorB1.start = prevB), (vectorB1.end = vertexB);
                    (vectorB2.start = nextB), (vectorB2.end = vertexB);
                    vectors.push(vectorA1);
                    vectors.push(vectorA2);
                    vectors.push(vectorB1);
                    vectors.push(vectorB2);
                }
                else if (touchingItem.type == 1) {
                    vectors.push({
                        x: vertexA.x - (vertexB.x + offset.x),
                        y: vertexA.y - (vertexB.y + offset.y),
                        start: prevA,
                        end: vertexA
                    });
                    vectors.push({
                        x: prevA.x - (vertexB.x + offset.x),
                        y: prevA.y - (vertexB.y + offset.y),
                        start: vertexA,
                        end: prevA
                    });
                }
                else if (touchingItem.type == 2) {
                    vectors.push({
                        x: vertexA.x - (vertexB.x + offset.x),
                        y: vertexA.y - (vertexB.y + offset.y),
                        start: prevB,
                        end: vertexB
                    });
                    vectors.push({
                        x: vertexA.x - (prevB.x + offset.x),
                        y: vertexA.y - (prevB.y + offset.y),
                        start: vertexB,
                        end: prevB
                    });
                }
            }
            // todo: there should be a faster way to reject vectors that will cause immediate intersection. For now just check them all
            translate = null;
            maxDistance = 0;
            for (i = 0; i < vectors.length; ++i) {
                if (vectors.at(i).x === 0 && vectors.at(i).y === 0) {
                    continue;
                }
                // if this vector points us back to where we came from, ignore it.
                // ie cross product = 0, dot product < 0
                point1.set(vectors.at(i));
                if (prevVector && point1.dot(prevVector) < 0) {
                    point2.set(prevVector);
                    // compare magnitude with unit vectors
                    unitV.set(point1).scale(1 / point1.length);
                    prevUnit.set(prevVector).scale(1 / point2.length);
                    // we need to scale down to unit vectors to normalize vector length. Could also just do a tan here
                    if (Math.abs(unitV.cross(prevUnit, -1)) < 0.0001) {
                        continue;
                    }
                }
                distance = polygonSlideDistance(a, b, point1, true);
                if (distance === null || distance * distance > point1.squareLength) {
                    distance = point1.length;
                }
                if (distance !== null && distance > maxDistance) {
                    maxDistance = distance;
                    translate = vectors.at(i);
                }
            }
            if (translate === null || almostEqual(maxDistance, 0)) {
                // didn't close the loop, something went wrong here
                nfp = null;
                break;
            }
            translate.start.marked = true;
            translate.end.marked = true;
            prevVector = translate;
            // trim
            vLength2 = translate.x * translate.x + translate.y * translate.y;
            if (maxDistance * maxDistance < vLength2 &&
                !almostEqual(maxDistance * maxDistance, vLength2)) {
                var scale = Math.sqrt((maxDistance * maxDistance) / vLength2);
                translate.x *= scale;
                translate.y *= scale;
            }
            reference.add(translate);
            if (reference.almostEqual(start)) {
                // we've made a full loop
                break;
            }
            // if A and B start on a touching horizontal line, the end point may not be the start point
            looped = false;
            if (nfp.length > 0) {
                for (i = 0; i < nfp.length - 1; ++i) {
                    if (reference.almostEqual(nfp.at(i))) {
                        looped = true;
                        break;
                    }
                }
            }
            if (looped) {
                // we've made a full loop
                break;
            }
            nfp.push(reference.clone());
            offset.add(translate);
            b.setOffset(offset);
            ++counter;
        }
        if (nfp && nfp.length > 0) {
            nfpList.push(nfp);
        }
        if (!searchEdges) {
            // only get outer NFP or first inner NFP
            break;
        }
        startPoint = searchStartPoint(a, b, inside, nfpList);
    }
    return nfpList;
}
// returns an interior NFP for the special case where A is a rectangle
function noFitPolygonRectangle(a, b) {
    var firstA = a.points.at(0);
    var firstB = b.points.at(0);
    var minA = FloatPoint.from(firstA);
    var maxA = FloatPoint.from(firstA);
    var minB = FloatPoint.from(firstB);
    var maxB = FloatPoint.from(firstB);
    var i = 0;
    var point;
    for (i = 1; i < a.points.length; ++i) {
        point = a.points.at(i);
        minA.min(point);
        maxA.max(point);
    }
    for (i = 1; i < b.points.length; ++i) {
        point = b.points.at(i);
        minB.min(point);
        maxB.max(point);
    }
    var offsetA = FloatPoint.sub(minA, maxA);
    var offsetB = FloatPoint.sub(minB, maxB);
    if (offsetB.x > offsetA.x || offsetB.y > offsetA.y) {
        return null;
    }
    var minABSum = FloatPoint.add(minA, firstB);
    var maxABSum = FloatPoint.add(maxA, firstB);
    //TODO: refactor when clipper logic will be removed
    return [
        [
            { x: minABSum.x - minB.x, y: minABSum.y - minB.y },
            { x: maxABSum.x - maxB.x, y: minABSum.y - minB.y },
            { x: maxABSum.x - maxB.x, y: maxABSum.y - maxB.y },
            { x: minABSum.x - minB.x, y: maxABSum.y - maxB.y }
        ]
    ];
}
// clipperjs uses alerts for warnings
function alert(message) {
    console.log("alert: ", message);
}
function minkowskiDifference(A, B) {
    var i = 0;
    var clipperNfp;
    var largestArea = null;
    var n;
    var sArea;
    var clippedA = toClipperCoordinates(A.points);
    var clippedB = toClipperCoordinates(B.points);
    ClipperLib.JS.ScaleUpPath(clippedA, 10000000);
    ClipperLib.JS.ScaleUpPath(clippedB, 10000000);
    for (i = 0; i < clippedB.length; ++i) {
        clippedB.at(i).X *= -1;
        clippedB.at(i).Y *= -1;
    }
    var solutions = ClipperLib.Clipper.MinkowskiSum(clippedA, clippedB, true);
    var solutionCount = solutions.length;
    for (i = 0; i < solutionCount; ++i) {
        n = toNestCoordinates(solutions.at(i), 10000000);
        sArea = polygonArea(n);
        if (largestArea === null || largestArea > sArea) {
            clipperNfp = n;
            largestArea = sArea;
        }
    }
    for (i = 0; i < clipperNfp.length; ++i) {
        clipperNfp.at(i).x += B.points.at(0).x;
        clipperNfp.at(i).y += B.points.at(0).y;
    }
    return [clipperNfp];
}
export function pairData(pair, env) {
    if (!pair) {
        return null;
    }
    var searchEdges = env.searchEdges;
    var useHoles = env.useHoles;
    var customNfpFn = env.customNfpFn;
    var nfpData = keyToNFPData(pair.key, env.rotations);
    var a = pair.A.rotate(nfpData["r1"]);
    var b = pair.B.rotate(nfpData["r2"]);
    var nfp;
    var i = 0;
    if (nfpData["inside"]) {
        // Try custom NFP function first if provided
        if (customNfpFn) {
            nfp = customNfpFn(a, b, true);
        }
        // Fall back to built-in implementations
        if (!nfp) {
            if (isRectangle(a)) {
                nfp = noFitPolygonRectangle(a, b);
            }
            else {
                nfp = noFitPolygon(a, b, true, searchEdges);
            }
        }
        // ensure all interior NFPs have the same winding direction
        if (nfp && nfp.length > 0) {
            for (i = 0; i < nfp.length; ++i) {
                if (polygonArea(nfp.at(i)) > 0) {
                    nfp.at(i).reverse();
                }
            }
        }
        else {
            // warning on null inner NFP
            // this is not an error, as the part may simply be larger than the bin or otherwise unplaceable due to geometry
            console.log("NFP Warning: ", nfpData);
            return null;
        }
    }
    else {
        // Try custom NFP function first if provided
        if (customNfpFn) {
            nfp = customNfpFn(a, b, false);
        }
        // Fall back to built-in implementations
        if (!nfp) {
            if (searchEdges) {
                nfp = noFitPolygon(a, b, false, searchEdges);
            }
            else {
                nfp = minkowskiDifference(a, b);
            }
        }
        // sanity check
        if (!nfp || nfp.length == 0) {
            console.log("NFP Error: ", nfpData);
            console.log("A: ", JSON.stringify(a));
            console.log("B: ", JSON.stringify(b));
            return null;
        }
        for (i = 0; i < nfp.length; ++i) {
            if (!searchEdges || i == 0) {
                // if searchedges is active, only the first NFP is guaranteed to pass sanity check
                if (Math.abs(polygonArea(nfp.at(i))) < Math.abs(polygonArea(a.points))) {
                    console.log("NFP Area Error: ", Math.abs(polygonArea(nfp.at(i))), nfpData);
                    console.log("computed area for a: " + polygonArea(a.points));
                    console.log("NFP:", JSON.stringify(nfp.at(i)));
                    console.log("A: ", JSON.stringify(a));
                    console.log("B: ", JSON.stringify(b));
                    nfp.splice(i, 1);
                    return null;
                }
            }
        }
        if (nfp.length == 0) {
            return null;
        }
        // for outer NFPs, the first is guaranteed to be the largest. Any subsequent NFPs that lie inside the first are holes
        for (i = 0; i < nfp.length; ++i) {
            if (polygonArea(nfp.at(i)) > 0) {
                nfp.at(i).reverse();
            }
            if (i > 0 &&
                pointInPolygon(nfp.at(i).at(0), FloatPolygon.fromPoints(nfp.at(0), "")) &&
                polygonArea(nfp.at(i)) < 0) {
                nfp.at(i).reverse();
            }
        }
        // generate nfps for children (holes of parts) if any exist
        if (useHoles && a.children && a.children.length > 0) {
            var boundsB = getPolygonBounds(b);
            var boundsA = void 0;
            var cnfp = void 0;
            var j = 0;
            for (i = 0; i < a.children.length; ++i) {
                boundsA = getPolygonBounds(a.children.at(i));
                // no need to find nfp if B's bounding box is too big
                if (boundsA.width > boundsB.width && boundsA.height > boundsB.height) {
                    cnfp = noFitPolygon(a.children.at(i), b, true, searchEdges);
                    // ensure all interior NFPs have the same winding direction
                    if (cnfp && cnfp.length > 0) {
                        for (j = 0; j < cnfp.length; ++j) {
                            if (polygonArea(cnfp.at(j)) < 0) {
                                cnfp.at(j).reverse();
                            }
                            nfp.push(cnfp.at(j));
                        }
                    }
                }
            }
        }
    }
    // TODO: absent ID seems dangerous here.
    var result = nfp.map(function (poly) { return FloatPolygon.fromPoints(poly, ""); });
    return { value: result, key: pair.key };
}

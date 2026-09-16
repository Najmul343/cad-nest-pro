import ClipperLib from "js-clipper";
import FloatPoint from "./float-point.js";
import FloatRect from "./float-rect.js";
import { almostEqual } from "../util.js";
import { toNestCoordinates, toClipperCoordinates } from "./geometry-utils.js";
/**
 * Represents a mutable polygon in 2D space.
 *
 * Provides some core polygon behavior natively like: bounds, translate, rotate.
 *
 * Note that some more advanced operations (eg: offset) are provided through Clipper.js. Clipper.js
 * performs all operations in integer coordinate space, therefore these advanced operations require
 * additional parameters which define the accuracy to execute the operation.
 */
var FloatPolygon = /** @class */ (function () {
    function FloatPolygon() {
        this._area = 0;
        this._rotation = 0;
    }
    /**
     * Get a new FloatPolygon using the given set of points.
     *
     * @param points
     * @param source
     * @returns
     */
    FloatPolygon.fromPoints = function (points, id) {
        var result = new FloatPolygon();
        result.updatePoints(points);
        result._children = [];
        result._id = id;
        result._offset = new FloatPoint();
        return result;
    };
    /**
     * @returns a deep copy of this polygon.
     */
    FloatPolygon.prototype.clone = function () {
        var points = this._points.map(function (point) { return point.clone(); });
        var result = FloatPolygon.fromPoints(points, this._id);
        result._rotation = this._rotation;
        result._offset = this._offset.clone();
        // deep clone of children
        this._children.map(function (child) {
            result._children.push(child.clone());
        });
        return result;
    };
    /**
     * Update the points in this polygon. Note that the resulting polygon may
     * store slightly different points at the end of this operation because 1) we enforce a
     * uniform winding direction on all polygons and 2) shared start/end points are deduplicated.
     */
    FloatPolygon.prototype.updatePoints = function (points) {
        this._points = points.map(function (p) { return FloatPoint.from(p); });
        this._isValid = this._points.length >= 3;
        if (!this._isValid) {
            throw new Error("Invalid points: " + JSON.stringify(points));
        }
        this._bounds = this._computeBounds();
        this._area = this._getArea();
        // Ensure a uniform winding direction for all Polygons.
        if (this._area > 0) {
            this._points.reverse();
            this._area = this._getArea();
        }
        // Don't allow shared start/end points. All polygons are implicitly loops already.
        if (FloatPoint.almostEqual(this._points[0], this._points.at(-1))) {
            this._points.pop();
        }
    };
    // TODO: this doesn't operate as a mutation method, probably should be updated.
    // TODO: should this be around some point besides the origin?
    FloatPolygon.prototype.rotate = function (angle) {
        var points = new Array();
        var pointCount = this._points.length;
        var radianAngle = (angle * Math.PI) / 180;
        var i = 0;
        for (i = 0; i < pointCount; ++i) {
            points.push(this._points[i].clone().rotate(radianAngle));
        }
        var result = FloatPolygon.fromPoints(points, this._id);
        if (this.hasChildren) {
            var childCount = this.childCount;
            for (i = 0; i < childCount; ++i) {
                result.children.push(this._children[i].rotate(angle));
            }
        }
        return result;
    };
    /**
     * Moves this polygon by the specified vector. Positive x value moves "right",
     * positive y value moves "up".
     */
    FloatPolygon.prototype.translate = function (vector) {
        this._points.map(function (point) {
            point.add(vector);
        });
    };
    // return true if point is in the polygon, false if outside, and null if exactly on a point or edge
    FloatPolygon.prototype.pointIn = function (point) {
        if (!this._isValid) {
            return false;
        }
        var innerPoint = FloatPoint.from(point);
        var pointCount = this._points.length;
        var result = false;
        var currentPoint = new FloatPoint();
        var prevPoint = new FloatPoint();
        var i = 0;
        for (i = 0; i < pointCount; ++i) {
            currentPoint.set(this._points[i]).add(this._offset);
            prevPoint
                .set(this._points[(i - 1 + pointCount) % pointCount])
                .add(this._offset);
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
    };
    // Note: for some polygons a negative offset will result in multiple polygons.
    // This case is not currently supported.
    FloatPolygon.prototype.polygonOffset = function (offset, clipperScale, curveTolerance) {
        if (almostEqual(offset, 0)) {
            return;
        }
        var p = toClipperCoordinates(this.points, clipperScale);
        var miterLimit = 2;
        var co = new ClipperLib.ClipperOffset(miterLimit, curveTolerance * clipperScale);
        co.AddPath(p, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
        var newPaths = new ClipperLib.Paths();
        co.Execute(newPaths, offset * clipperScale);
        if (newPaths.length > 1) {
            throw new Error("Bin offset too large and generated multiple bin spaces. This is not currently supported");
        }
        this.updatePoints(toNestCoordinates(newPaths[0], clipperScale));
    };
    /**
     * TODO(tristan): someday we should use this to actually do the offsetting. For now,
     * we just need a way to record an offset paired with a polygon for usage in pair-data-flow.ts
     *
     * @param offset
     */
    FloatPolygon.prototype.setOffset = function (offset) {
        this._offset = offset.clone();
    };
    FloatPolygon.prototype._computeBounds = function () {
        if (!this._isValid) {
            return null;
        }
        var point = this._points[0];
        var pointCount = this._points.length;
        var min = FloatPoint.from(point);
        var max = FloatPoint.from(point);
        var i = 0;
        for (i = 1; i < pointCount; ++i) {
            point = this._points[i];
            max.max(point);
            min.min(point);
        }
        return FloatRect.fromPoints(min, max);
    };
    FloatPolygon.prototype._getArea = function () {
        var pointCount = this._points.length;
        var result = 0;
        var i = 0;
        var currentPoint;
        var prevPoint;
        for (i = 0; i < pointCount; ++i) {
            prevPoint = this._points[(i - 1 + pointCount) % pointCount];
            currentPoint = this._points[i];
            result += (prevPoint.x + currentPoint.x) * (prevPoint.y - currentPoint.y);
        }
        return 0.5 * result;
    };
    Object.defineProperty(FloatPolygon.prototype, "points", {
        get: function () {
            return this._points; // TODO: should slice to copy?
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "isValid", {
        get: function () {
            return this._isValid;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "bound", {
        get: function () {
            return this._bounds;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "area", {
        get: function () {
            return this._area;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "firstPoint", {
        get: function () {
            return this._points[0] || null;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "x", {
        get: function () {
            return this._bounds ? this._bounds.x : 0;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "y", {
        get: function () {
            return this._bounds ? this._bounds.y : 0;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "width", {
        get: function () {
            return this._bounds !== null ? this._bounds.width : 0;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "height", {
        get: function () {
            return this._bounds !== null ? this._bounds.height : 0;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "id", {
        get: function () {
            return this._id;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "offsetx", {
        get: function () {
            return this._offset.x;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "offsety", {
        get: function () {
            return this._offset.y;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "offset", {
        get: function () {
            return this._offset;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "min", {
        get: function () {
            var result = FloatPoint.from(this._points[0]);
            var i = 0;
            var pointCount = this._points.length;
            for (i = 1; i < pointCount; ++i) {
                result.min(this._points[i]);
            }
            return result;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "max", {
        get: function () {
            var result = FloatPoint.from(this._points[0]);
            var i = 0;
            var pointCount = this._points.length;
            for (i = 1; i < pointCount; ++i) {
                result.max(this._points[i]);
            }
            return result;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "children", {
        get: function () {
            return this._children;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "hasChildren", {
        get: function () {
            return this._children.length > 0;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "childCount", {
        get: function () {
            return this._children.length;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "rotation", {
        get: function () {
            return this._rotation;
        },
        set: function (rotation) {
            this._rotation = rotation;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPolygon.prototype, "bounds", {
        get: function () {
            return this._bounds;
        },
        enumerable: false,
        configurable: true
    });
    return FloatPolygon;
}());
export { FloatPolygon };

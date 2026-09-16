import { almostEqual } from "../util.js";
var FloatPoint = /** @class */ (function () {
    function FloatPoint(x, y) {
        if (x === void 0) { x = 0; }
        if (y === void 0) { y = 0; }
        this._data = new Float32Array(2);
        this._data[0] = x;
        this._data[1] = y;
    }
    FloatPoint.prototype.scale = function (multiplier) {
        this._data[0] *= multiplier;
        this._data[1] *= multiplier;
        return this;
    };
    FloatPoint.prototype.add = function (value) {
        this._data[0] += value.x;
        this._data[1] += value.y;
        return this;
    };
    FloatPoint.prototype.sub = function (value) {
        this._data[0] -= value.x;
        this._data[1] -= value.y;
        return this;
    };
    FloatPoint.prototype.set = function (value) {
        this._data[0] = value.x;
        this._data[1] = value.y;
        return this;
    };
    FloatPoint.prototype.update = function (x, y) {
        this._data[0] = x;
        this._data[1] = y;
        return this;
    };
    FloatPoint.prototype.max = function (value) {
        this._data[0] = Math.max(value.x, this._data[0]);
        this._data[1] = Math.max(value.y, this._data[1]);
        return this;
    };
    FloatPoint.prototype.min = function (value) {
        this._data[0] = Math.min(value.x, this._data[0]);
        this._data[1] = Math.min(value.y, this._data[1]);
        return this;
    };
    FloatPoint.prototype.dot = function (value) {
        return value.x * this._data[0] + value.y * this._data[1];
    };
    FloatPoint.prototype.cross = function (value, sign) {
        if (sign === void 0) { sign = 1; }
        return this._data[1] * value.x + sign * this._data[0] * value.y;
    };
    FloatPoint.prototype.abs = function () {
        this._data[0] = Math.abs(this._data[0]);
        this._data[1] = Math.abs(this._data[1]);
        return this;
    };
    FloatPoint.prototype.rotate = function (angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        var x = this._data[0];
        var y = this._data[1];
        this._data[0] = x * cos - y * sin;
        this._data[1] = x * sin + y * cos;
        return this;
    };
    FloatPoint.prototype.clone = function () {
        return new FloatPoint(this._data[0], this._data[1]);
    };
    FloatPoint.prototype.almostEqual = function (point, tolerance) {
        return FloatPoint.almostEqual(this, point, tolerance);
    };
    // returns true if p lies on the line segment defined by AB, but not at any endpoints
    // may need work!
    FloatPoint.prototype.onSegment = function (a, b) {
        var tolerance = Math.pow(10, -9);
        var max = FloatPoint.from(a).max(b);
        var min = FloatPoint.from(a).min(b);
        var offsetAB = FloatPoint.sub(a, b);
        var offsetAP = FloatPoint.sub(a, this);
        // vertical line
        if (Math.abs(offsetAB.x) < tolerance && Math.abs(offsetAP.x) < tolerance) {
            return (!almostEqual(this.y, b.y) &&
                !almostEqual(this.y, a.y) &&
                this.y < max.y &&
                this.y > min.y);
        }
        // horizontal line
        if (Math.abs(offsetAB.x) < tolerance && Math.abs(offsetAP.x) < tolerance) {
            return (!almostEqual(this.x, b.x) &&
                !almostEqual(this.x, a.x) &&
                this.x < max.x &&
                this.x > min.x);
        }
        //range check
        if (this.x < min.x || this.x > max.x || this.y < min.y || this.y > max.y) {
            return false;
        }
        // exclude end points
        if (FloatPoint.almostEqual(this, a) ||
            FloatPoint.almostEqual(this, b) ||
            Math.abs(offsetAP.cross(offsetAB, -1)) > tolerance) {
            return false;
        }
        var dot = offsetAP.dot(offsetAB);
        var len2 = offsetAB.squareLength;
        if (dot < tolerance || dot > len2 || almostEqual(dot, len2)) {
            return false;
        }
        return true;
    };
    Object.defineProperty(FloatPoint.prototype, "x", {
        get: function () {
            return this._data[0];
        },
        set: function (value) {
            this._data[0] = value;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPoint.prototype, "y", {
        get: function () {
            return this._data[1];
        },
        set: function (value) {
            this._data[1] = value;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPoint.prototype, "squareLength", {
        get: function () {
            return this._data[0] * this._data[0] + this._data[1] * this._data[1];
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatPoint.prototype, "length", {
        get: function () {
            return Math.sqrt(this.squareLength);
        },
        enumerable: false,
        configurable: true
    });
    FloatPoint.from = function (point) {
        return new FloatPoint(point.x, point.y);
    };
    FloatPoint.abs = function (point) {
        return new FloatPoint(Math.abs(point.x), Math.abs(point.y));
    };
    FloatPoint.square = function (point) {
        return new FloatPoint(point.x * point.x, point.y * point.y);
    };
    FloatPoint.add = function (p1, p2) {
        return new FloatPoint(p1.x + p2.x, p1.y + p2.y);
    };
    FloatPoint.sub = function (p1, p2) {
        return new FloatPoint(p2.x - p1.x, p2.y - p1.y);
    };
    FloatPoint.almostEqual = function (point1, point2, tolerance) {
        if (tolerance === void 0) { tolerance = Math.pow(10, -9); }
        return (Math.abs(point1.x - point2.x) < tolerance &&
            Math.abs(point1.y - point2.y) < tolerance);
    };
    FloatPoint.normal = function (value) {
        return new FloatPoint(value.y, -value.x);
    };
    FloatPoint.reverse = function (value) {
        return new FloatPoint(-value.x, -value.y);
    };
    // normalize vector into a unit vector
    FloatPoint.normalizeVector = function (v) {
        var point = FloatPoint.from(v);
        // given vector was already a unit vector
        return almostEqual(point.squareLength, 1)
            ? point
            : point.scale(1 / point.length);
    };
    return FloatPoint;
}());
export default FloatPoint;

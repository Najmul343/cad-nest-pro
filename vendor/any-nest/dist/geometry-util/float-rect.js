import FloatPoint from "./float-point.js";
var FloatRect = /** @class */ (function () {
    function FloatRect(x, y, width, height) {
        if (x === void 0) { x = 0; }
        if (y === void 0) { y = 0; }
        if (width === void 0) { width = 0; }
        if (height === void 0) { height = 0; }
        this._bottomLeft = new FloatPoint();
        this._topRight = new FloatPoint();
        this._size = new FloatPoint();
        this._bottomLeft.update(x, y);
        this._topRight.update(x + width, y + height);
        this._size.update(width, height);
    }
    Object.defineProperty(FloatRect.prototype, "x", {
        get: function () {
            return this._bottomLeft.x;
        },
        set: function (value) {
            this._bottomLeft.x = value;
            this._topRight.x = this._size.x + value;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatRect.prototype, "y", {
        get: function () {
            return this._bottomLeft.y;
        },
        set: function (value) {
            this._bottomLeft.y = value;
            this._topRight.y = this._size.y + value;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatRect.prototype, "width", {
        get: function () {
            return this._size.x;
        },
        set: function (value) {
            this._size.x = value;
            this._topRight.x = this._size.x + value;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatRect.prototype, "height", {
        get: function () {
            return this._size.y;
        },
        set: function (value) {
            this._size.y = value;
            this._topRight.y = this._bottomLeft.y + value;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatRect.prototype, "bottomLeft", {
        get: function () {
            return this._bottomLeft.clone();
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatRect.prototype, "topRight", {
        get: function () {
            return this._topRight.clone();
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(FloatRect.prototype, "size", {
        get: function () {
            return this._size.clone();
        },
        enumerable: false,
        configurable: true
    });
    FloatRect.fromPoints = function (bottomLeft, topRight) {
        return new FloatRect(bottomLeft.x, bottomLeft.y, topRight.x - bottomLeft.x, topRight.y - bottomLeft.y);
    };
    return FloatRect;
}());
export default FloatRect;

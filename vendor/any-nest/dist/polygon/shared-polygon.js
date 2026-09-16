import ClipperLib from "js-clipper";
import { almostEqual } from "../util.js";
import { toNestCoordinates, toClipperCoordinates } from "../geometry-util/index.js";
import { FloatPolygon } from "../geometry-util/float-polygon.js";
var SharedPolygon = /** @class */ (function () {
    function SharedPolygon(configuration) {
        this._configuration = configuration;
    }
    // use the clipper library to return an offset to the given polygon. Positive offset expands the polygon, negative contracts
    // note that this returns an array of polygons
    SharedPolygon.prototype._polygonOffset = function (polygon, offset) {
        if (almostEqual(offset, 0)) {
            return [polygon];
        }
        var p = this.svgToClipper(polygon);
        var miterLimit = 2;
        var co = new ClipperLib.ClipperOffset(miterLimit, this._configuration.curveTolerance * this._configuration.clipperScale);
        co.AddPath(p, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
        var newPaths = new ClipperLib.Paths();
        co.Execute(newPaths, offset * this._configuration.clipperScale);
        var result = [];
        var i = 0;
        // TODO: modifying id is kinda sketchy since we're relying on parts always having a positive offset.
        if (newPaths.lengths == 1) {
            return [this.clipperToSvg(newPaths[0], polygon.id)];
        }
        else {
            for (i = 0; i < newPaths.length; ++i) {
                result.push(this.clipperToSvg(newPaths[i], polygon.id + "_offset_" + i));
            }
        }
        return result;
    };
    // converts a polygon from normal float coordinates to integer coordinates used by clipper, as well as x/y -> X/Y
    SharedPolygon.prototype.svgToClipper = function (polygon) {
        return toClipperCoordinates(polygon.points, this._configuration.clipperScale);
    };
    SharedPolygon.prototype.clipperToSvg = function (polygon, id) {
        return FloatPolygon.fromPoints(toNestCoordinates(polygon, this._configuration.clipperScale), id);
    };
    Object.defineProperty(SharedPolygon.prototype, "curveTolerance", {
        get: function () {
            return this._configuration.curveTolerance;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SharedPolygon.prototype, "clipperScale", {
        get: function () {
            return this._configuration.clipperScale;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SharedPolygon.prototype, "spacing", {
        get: function () {
            return this._configuration.spacing;
        },
        enumerable: false,
        configurable: true
    });
    return SharedPolygon;
}());
export default SharedPolygon;

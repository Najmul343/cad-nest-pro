var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
import SharedPolygon from "./shared-polygon.js";
var TreePolygon = /** @class */ (function (_super) {
    __extends(TreePolygon, _super);
    function TreePolygon(polygons, configuration, isOffset) {
        var _this = _super.call(this, configuration) || this;
        _this._polygons = polygons;
        if (isOffset) {
            _this._offsetTree(_this._polygons, _this.spacing * 0.5);
        }
        return _this;
    }
    TreePolygon.prototype.removeDuplicats = function () {
        var start;
        var end;
        var node;
        var i = 0;
    };
    TreePolygon.prototype.at = function (index) {
        return this._polygons[index];
    };
    TreePolygon.prototype.byId = function (id) {
        var result = this._polygons.filter(function (poly) { return poly.id == id; });
        if (result.length == 1) {
            return result[0];
        }
        // TODO: throw?
        return undefined;
    };
    TreePolygon.prototype.flat = function (index) {
        var part = this._polygons[index];
        return part.children && part.children.length > 0
            ? TreePolygon.flattenTree(part.children, true)
            : null;
    };
    // offset tree recursively
    TreePolygon.prototype._offsetTree = function (tree, offset) {
        if (!tree || tree.length == 0) {
            return;
        }
        var i = 0;
        var node;
        var offsetPaths;
        var treeSize = tree.length;
        for (i = 0; i < treeSize; ++i) {
            node = tree[i];
            if (!node) {
                console.warn("empty node in tree, this is probably bad?");
                continue;
            }
            offsetPaths = this._polygonOffset(node, offset);
            if (offsetPaths.length == 1) {
                //TODO: This is a problem since we need to recompute bounding box and area.
                node.updatePoints(offsetPaths[0].points);
                //var newNode:FloatPolygon = FloatPolygon.clone(offsetPaths[0]);
                // replace array items in place
                //        Array.prototype.splice.apply(
                //         node,
                //        [0, node.length].concat(offsetPaths[0])
                //    );
            }
            if (node.children && node.children.length > 0) {
                this._offsetTree(node.children, -offset);
            }
        }
    };
    Object.defineProperty(TreePolygon.prototype, "polygons", {
        get: function () {
            return this._polygons.slice();
        },
        enumerable: false,
        configurable: true
    });
    TreePolygon.flattenTree = function (tree, hole, result) {
        if (result === void 0) { result = []; }
        var nodeCount = tree.length;
        var i = 0;
        var node;
        var children;
        for (i = 0; i < nodeCount; ++i) {
            node = tree[i];
            node.hole = hole;
            children = node.children;
            result.push(node);
            if (children && children.length > 0) {
                TreePolygon.flattenTree(children, !hole, result);
            }
        }
        return result;
    };
    return TreePolygon;
}(SharedPolygon));
export default TreePolygon;

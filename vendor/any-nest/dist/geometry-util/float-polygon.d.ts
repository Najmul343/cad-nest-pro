import FloatPoint from "./float-point";
import FloatRect from "./float-rect";
import { Point, ArrayPolygon, BoundRect } from "../interfaces";
/**
 * Represents a mutable polygon in 2D space.
 *
 * Provides some core polygon behavior natively like: bounds, translate, rotate.
 *
 * Note that some more advanced operations (eg: offset) are provided through Clipper.js. Clipper.js
 * performs all operations in integer coordinate space, therefore these advanced operations require
 * additional parameters which define the accuracy to execute the operation.
 */
export declare class FloatPolygon implements ArrayPolygon, BoundRect {
    private _id;
    private _bounds;
    private _area;
    private _isValid;
    private _offset;
    private _children;
    private _rotation;
    private _points;
    private constructor();
    /**
     * Get a new FloatPolygon using the given set of points.
     *
     * @param points
     * @param source
     * @returns
     */
    static fromPoints(points: Array<Point>, id: string): FloatPolygon;
    /**
     * @returns a deep copy of this polygon.
     */
    clone(): FloatPolygon;
    /**
     * Update the points in this polygon. Note that the resulting polygon may
     * store slightly different points at the end of this operation because 1) we enforce a
     * uniform winding direction on all polygons and 2) shared start/end points are deduplicated.
     */
    updatePoints(points: Array<Point>): void;
    rotate(angle: number): FloatPolygon;
    /**
     * Moves this polygon by the specified vector. Positive x value moves "right",
     * positive y value moves "up".
     */
    translate(vector: Point): void;
    pointIn(point: Point): boolean;
    polygonOffset(offset: number, clipperScale: number, curveTolerance: number): void;
    /**
     * TODO(tristan): someday we should use this to actually do the offsetting. For now,
     * we just need a way to record an offset paired with a polygon for usage in pair-data-flow.ts
     *
     * @param offset
     */
    setOffset(offset: FloatPoint): void;
    private _computeBounds;
    private _getArea;
    get points(): Array<Point>;
    get isValid(): boolean;
    get bound(): FloatRect | null;
    get area(): number;
    get firstPoint(): FloatPoint | null;
    get x(): number;
    get y(): number;
    get width(): number;
    get height(): number;
    get id(): string;
    get offsetx(): number;
    get offsety(): number;
    get offset(): FloatPoint;
    get min(): FloatPoint;
    get max(): FloatPoint;
    get children(): Array<FloatPolygon>;
    get hasChildren(): boolean;
    get childCount(): number;
    set rotation(rotation: number);
    get rotation(): number;
    get bounds(): BoundRect;
}

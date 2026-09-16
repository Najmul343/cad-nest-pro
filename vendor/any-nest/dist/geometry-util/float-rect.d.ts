import FloatPoint from "./float-point";
import { BoundRect } from "../interfaces";
export default class FloatRect implements BoundRect {
    private _bottomLeft;
    private _topRight;
    private _size;
    constructor(x?: number, y?: number, width?: number, height?: number);
    get x(): number;
    set x(value: number);
    get y(): number;
    set y(value: number);
    get width(): number;
    set width(value: number);
    get height(): number;
    set height(value: number);
    get bottomLeft(): FloatPoint;
    get topRight(): FloatPoint;
    get size(): FloatPoint;
    static fromPoints(bottomLeft: FloatPoint, topRight: FloatPoint): FloatRect;
}

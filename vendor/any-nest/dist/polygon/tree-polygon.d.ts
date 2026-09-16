import { FloatPolygon } from "../geometry-util/float-polygon";
import SharedPolygon from "./shared-polygon";
import { ArrayPolygon, NestConfiguration } from "../interfaces";
export default class TreePolygon extends SharedPolygon {
    private _polygons;
    constructor(polygons: FloatPolygon[], configuration: NestConfiguration, isOffset: boolean);
    removeDuplicats(): void;
    at(index: number): ArrayPolygon;
    byId(id: string): ArrayPolygon;
    flat(index: number): ArrayPolygon[];
    _offsetTree(tree: FloatPolygon[], offset: number): void;
    get polygons(): FloatPolygon[];
    static flattenTree(tree: ArrayPolygon[], hole: boolean, result?: ArrayPolygon[]): ArrayPolygon[];
}

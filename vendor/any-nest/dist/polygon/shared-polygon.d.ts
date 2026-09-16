import { ArrayPolygon, ClipperPoint, NestConfiguration } from "../interfaces";
export default class SharedPolygon {
    private _configuration;
    constructor(configuration: NestConfiguration);
    protected _polygonOffset(polygon: ArrayPolygon, offset: number): ArrayPolygon[];
    protected svgToClipper(polygon: ArrayPolygon): ClipperPoint[];
    protected clipperToSvg(polygon: ClipperPoint[], id: string): ArrayPolygon;
    protected get curveTolerance(): number;
    protected get clipperScale(): number;
    protected get spacing(): number;
}

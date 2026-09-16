import { FloatPolygon } from "./geometry-util/float-polygon";
/**
 *
 */
export interface Shape {
    id: string;
    points: Point[];
}
export interface Placement {
    id: string;
    translate: Point;
    rotate: number;
}
export interface Point {
    x: number;
    y: number;
    id?: number;
    marked?: boolean;
    rotation?: number;
    start?: Point;
    end?: Point;
    nfp?: any;
    source?: string;
}
export interface GeneticAlgorithmConfig {
    populationSize: number;
    mutationRate: number;
    rotations: number;
}
export interface BoundRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
/**
 * Represents an arbitrary 2D polygon shape. ArrayPolygons don't have any particular unit
 * associated with their points.
 */
export interface ArrayPolygon {
    id: string;
    bounds: BoundRect;
    points: Array<Point>;
    parent?: ArrayPolygon;
    children?: ArrayPolygon[];
    rotation: number;
    area: number;
    hole?: boolean;
    marked?: boolean;
    offsetx?: number;
    offsety?: number;
    rotate(angle: number): FloatPolygon;
}
export interface NestConfigExternal {
    clipperScale?: number;
    curveTolerance?: number;
    spacing?: number;
    binSpacing?: number;
    rotations?: number;
    populationSize?: number;
    mutationRate?: number;
    useHoles?: boolean;
    exploreConcave?: boolean;
}
export interface NestConfiguration {
    clipperScale: number;
    curveTolerance: number;
    spacing: number;
    binSpacing: number;
    rotations: number;
    populationSize: number;
    mutationRate: number;
    useHoles: boolean;
    exploreConcave: boolean;
}
/**
 * Custom NFP (No-Fit Polygon) function type.
 * Allows external implementations (e.g., WASM-accelerated) to provide NFP computation.
 *
 * @param a - The static polygon (bin or placed shape)
 * @param b - The movable polygon to be placed
 * @param inside - If true, compute inner NFP (B orbits inside A); if false, outer NFP
 * @returns Array of NFP polygons, or null if computation fails
 */
export type CustomNfpFunction = (a: ArrayPolygon, b: ArrayPolygon, inside: boolean) => Array<Array<Point>> | null;
export interface PairWorkerData {
    rotations: number;
    binPolygon: ArrayPolygon;
    searchEdges: boolean;
    useHoles: boolean;
    /**
     * Optional custom NFP computation function.
     * When provided, this function is called instead of the built-in NFP algorithms.
     * Use this to inject WASM-accelerated or otherwise optimized NFP computation.
     */
    customNfpFn?: CustomNfpFunction;
}
export interface NfpPair {
    A: ArrayPolygon;
    B: ArrayPolygon;
    key: string;
}
export interface PlacePairConfiguration {
    binPolygon: ArrayPolygon;
    paths: ArrayPolygon[];
    ids: string[];
    rotations: number[];
    config: NestConfiguration;
    nfpCache: Map<string, ArrayPolygon[]>;
}
export interface ClipperPoint {
    X: number;
    Y: number;
}
export interface PairDataResult {
    value: ArrayPolygon[];
    key: string;
}
export interface PlaceDataResult {
    placements: Placement[][];
    fitness: number;
    paths: ArrayPolygon[];
    area: number;
}

import { ArrayPolygon } from "./interfaces";
export declare function almostEqual(a: number, b: number, tolerance?: number): boolean;
export declare function generateNFPCacheKey(rotationSplit: number, inside: boolean, polygon1: ArrayPolygon, polygon2: ArrayPolygon, rotation1?: number, rotation2?: number): string;
export declare function keyToNFPData(key: string, rotationSplit: number): Float32Array;

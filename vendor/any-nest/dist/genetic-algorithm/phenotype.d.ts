import { ArrayPolygon } from "../interfaces";
export default class Phenotype {
    private _placement;
    private _rotation;
    private _fitness;
    constructor(placement: Array<ArrayPolygon>, rotation: Array<number>);
    cut(cutPoint: number): Phenotype;
    clone(): Phenotype;
    mate(phenotype: Phenotype): void;
    private _contains;
    get placement(): Array<ArrayPolygon>;
    get rotation(): Array<number>;
    get size(): number;
    get fitness(): number;
    set fitness(value: number);
}

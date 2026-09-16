import { ArrayPolygon, BoundRect, GeneticAlgorithmConfig } from "../interfaces";
import Phenotype from "./phenotype";
export default class GeneticAlgorithm {
    private _population;
    private _config;
    private _binBounds;
    private _isEmpty;
    constructor();
    init(adam: Array<ArrayPolygon>, binBounds: BoundRect, config?: GeneticAlgorithmConfig): void;
    clear(): void;
    private _generation;
    private _randomAngle;
    private _mutate;
    private _mate;
    private _randomWeightedIndividual;
    get individual(): Phenotype | null;
    get population(): Array<Phenotype>;
    get isEmpty(): boolean;
    static shuffle(angleList: Array<number>): Array<number>;
}

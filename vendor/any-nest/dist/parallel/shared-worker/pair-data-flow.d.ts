import FloatPoint from "../../geometry-util/float-point";
import { NfpPair, PairDataResult, PairWorkerData } from "../../interfaces";
export declare function segmentDistance(A: FloatPoint, B: FloatPoint, E: FloatPoint, F: FloatPoint, direction: FloatPoint): number | null;
export declare function pairData(pair: NfpPair, env: PairWorkerData): PairDataResult;

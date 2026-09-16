/*!
 * SvgNest
 * Licensed under the MIT license
 */
import { FloatPolygon } from "./geometry-util";
import { Placement, NestConfiguration, NestConfigExternal, Point } from "./interfaces";
export { AnyNest, FloatPolygon };
export type { NestConfigExternal, Placement, Point };
declare class AnyNest {
    private _best;
    private _isWorking;
    private _genethicAlgorithm;
    private _progress;
    private _configuration;
    private _tree;
    private _binPolygon;
    private _nfpCache;
    private _workerTimer;
    constructor();
    /**
     * Provide the bin shape into which all parts will attempt to be nested.
     *
     * The bin can be an arbitrary shape. All ArrayPolygons use unspecified units.
     */
    setBin(bin: FloatPolygon): void;
    /**
     * Provide the list of parts which will attempt to be packed into the bin.
     *
     * Note: ArrayPolyon has a 'children' element which can be used to represent holes within a given part.
     * In general children are holes, their children are islands, etc.
     * Children elements should not appear at top-level members of the given parts array.
     *
     * The given parts list should not include the bin polygon.
     */
    setParts(parts: FloatPolygon[]): void;
    /**
     * Provide the configuration for this nesting algorithm. See interfaces.ts for full details on the configuration
     * object. But some important values to consider are:
     *   - spacing: the additinal buffer to leave around each shape when nesting. Same arbitrary units as ArrayPolygon's points
     *   - rotations: this library will attempt to rotate shapes to find a better nesting, but will rotate shapes only by
     *                360 / configuration.rotations degree increments.
     *                higher values here incur substantial increases in runtime but may yeild better nestings
     *   -  useHoles: place pieces in holes of other parts if they fit. Default false
     * See https://github.com/Jack000/SVGnest?tab=readme-ov-file#configuration-parameters for additional information.
     *
     * @param configuration to override some, none, or all of the default config values.
     * @returns a copy of the configuration which will be used, including defaults for any configurations which were
     *     unspecified in the input.
     */
    config(configuration: NestConfigExternal): NestConfigExternal;
    getConfig(): NestConfiguration;
    /**
     * Start the nesting algorithm. A genetic algorithm which produces generations of
     * possible packings.
     *
     * @param progressCallback
     *        called periodically as the algorithm runs, approx 10/sec.
     *        progress - progress on the current generation of nestings. [0:1]
     * @param displayCallback(
     *        called at the end of a generation with the best placement that has been identified so far.
     *        placements - a list of list of Placements. If all parts cannot be fit in a single bin
     *                   then a list of Placments will be specified for each bin which is needed in order to
     *                   fit all parts.
     *        fitness - TODO: semantically what does this mean? - portion of the bin which is used
     * If parts cannot be placed (eg: some part is too big to fit in any bin), then displayCallback will be
     * called with an undefined placements value.
     */
    start(progressCallback: (progress: number) => void, displayCallback: (placements: Placement[][], untilization: number) => void): void;
    /**
     * Stop the nesting algorithm.
     */
    stop(): void;
    private _calculateNfpPairs;
    private _launchWorkers;
}

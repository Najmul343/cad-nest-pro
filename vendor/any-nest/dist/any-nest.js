/*!
 * SvgNest
 * Licensed under the MIT license
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import GeneticAlgorithm from "./genetic-algorithm/genetic-algorithm.js";
import { polygonArea, FloatPolygon } from "./geometry-util/index.js";
import { TreePolygon } from "./polygon/index.js";
import { generateNFPCacheKey } from "./util.js";
import { pairData } from "./parallel/shared-worker/pair-data-flow.js";
import placePaths from "./parallel/shared-worker/place-path-flow.js";
export { AnyNest, FloatPolygon };
var AnyNest = /** @class */ (function () {
    function AnyNest() {
        this._best = null;
        this._isWorking = false;
        this._progress = 0;
        this._tree = null;
        this._binPolygon = null;
        this._workerTimer = null;
        // keep a reference to any style nodes, to maintain color/fill info
        this._nfpCache = new Map();
        this._configuration = {
            clipperScale: 10000000,
            curveTolerance: 0.3,
            spacing: 0,
            binSpacing: 0,
            rotations: 4,
            populationSize: 10,
            mutationRate: 50,
            useHoles: false,
            exploreConcave: false
        };
        this._genethicAlgorithm = new GeneticAlgorithm();
    }
    /**
     * Provide the bin shape into which all parts will attempt to be nested.
     *
     * The bin can be an arbitrary shape. All ArrayPolygons use unspecified units.
     */
    AnyNest.prototype.setBin = function (bin) {
        // move to align with origin
        this._binPolygon = bin.clone();
        this._binPolygon.translate(this._binPolygon.min.scale(-1));
        var binOffset = -1 * this._configuration.binSpacing;
        this._binPolygon.polygonOffset(binOffset, this._configuration.clipperScale, this._configuration.curveTolerance);
    };
    /**
     * Provide the list of parts which will attempt to be packed into the bin.
     *
     * Note: ArrayPolyon has a 'children' element which can be used to represent holes within a given part.
     * In general children are holes, their children are islands, etc.
     * Children elements should not appear at top-level members of the given parts array.
     *
     * The given parts list should not include the bin polygon.
     */
    AnyNest.prototype.setParts = function (parts) {
        this._tree = new TreePolygon(parts, this._configuration, true);
    };
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
    AnyNest.prototype.config = function (configuration) {
        if (this._binPolygon || this._tree) {
            throw new Error("Config must be set before bin and parts in order to behave correctly.");
        }
        if (!configuration) {
            return this._configuration;
        }
        for (var property in this._configuration) {
            if (configuration[property]) {
                this._configuration[property] = configuration[property];
            }
        }
        this._best = null;
        this._nfpCache.clear();
        this._genethicAlgorithm.clear();
        return this._configuration;
    };
    AnyNest.prototype.getConfig = function () {
        return this._configuration;
    };
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
    AnyNest.prototype.start = function (progressCallback, displayCallback) {
        var _this = this;
        if (!this._binPolygon) {
            throw new Error("Missing bin for packing. Ensure you have called setBin");
        }
        if (!this._tree) {
            throw new Error("Missing shapes for nesting. Ensure you have called setParts");
        }
        this._tree.removeDuplicats();
        this._isWorking = false;
        this._workerTimer = setInterval(function () {
            if (!_this._isWorking) {
                try {
                    _this._launchWorkers(displayCallback);
                    _this._isWorking = true;
                }
                catch (err) {
                    console.log(err);
                }
            }
            progressCallback(_this._progress);
        }, 100);
    };
    /**
     * Stop the nesting algorithm.
     */
    AnyNest.prototype.stop = function () {
        this._isWorking = false;
        if (this._workerTimer) {
            clearInterval(this._workerTimer);
            this._workerTimer = null;
        }
    };
    AnyNest.prototype._calculateNfpPairs = function (batchSize, nfpPairs) {
        return __awaiter(this, void 0, void 0, function () {
            var results, i;
            return __generator(this, function (_a) {
                results = [];
                for (i = 0; i < nfpPairs.length; i++) {
                    results.push(pairData(nfpPairs[i], {
                        rotations: this._configuration.rotations,
                        binPolygon: this._binPolygon, // TODO: this is unused.
                        searchEdges: this._configuration.exploreConcave,
                        useHoles: this._configuration.useHoles,
                        customNfpFn: this._configuration.customNfpFn
                    }));
                    this._progress = results.length / nfpPairs.length;
                }
                return [2 /*return*/, results];
            });
        });
    };
    AnyNest.prototype._launchWorkers = function (displayCallback) {
        var _this = this;
        var i = 0;
        var j = 0;
        if (this._genethicAlgorithm.isEmpty) {
            // initiate new GA
            var adam = this._tree.polygons;
            // seed with decreasing area
            adam.sort(function (a, b) {
                return Math.abs(polygonArea(b.points)) - Math.abs(polygonArea(a.points));
            });
            this._genethicAlgorithm.init(adam, this._binPolygon.bounds, this._configuration);
        }
        var individual = this._genethicAlgorithm.individual;
        var placeList = individual.placement;
        var rotations = individual.rotation;
        var placeCount = placeList.length;
        var ids = [];
        var nfpPairs = [];
        var newCache = new Map();
        var part;
        var key;
        var updateCache = function (polygon1, polygon2, rotation1, rotation2, inside) {
            key = generateNFPCacheKey(_this._configuration.rotations, inside, polygon1, polygon2, rotation1, rotation2);
            if (!_this._nfpCache.has(key)) {
                nfpPairs.push({ A: polygon1, B: polygon2, key: key });
            }
            else {
                newCache.set(key, _this._nfpCache.get(key));
            }
        };
        for (i = 0; i < placeCount; ++i) {
            part = placeList[i];
            ids.push(part.id);
            part.rotation = rotations[i];
            updateCache(this._binPolygon, part, 0, rotations[i], true);
            for (j = 0; j < i; ++j) {
                updateCache(placeList[j], part, rotations[j], rotations[i], false);
            }
        }
        // only keep cache for one cycle
        this._nfpCache = newCache;
        var placementWorkerData = {
            binPolygon: this._binPolygon,
            paths: placeList.slice(),
            ids: ids,
            rotations: rotations,
            config: this._configuration,
            nfpCache: this._nfpCache
        };
        var pairResult = this._calculateNfpPairs(4, nfpPairs);
        pairResult.then(function (generatedNfp) {
            if (generatedNfp) {
                var i_1 = 0;
                var nfp = void 0;
                for (i_1 = 0; i_1 < generatedNfp.length; ++i_1) {
                    nfp = generatedNfp[i_1];
                    if (nfp) {
                        // a null nfp means the nfp could not be generated, either because the parts simply don't fit or an error in the nfp algo
                        _this._nfpCache.set(nfp.key, nfp.value);
                    }
                }
            }
            placementWorkerData.nfpCache = _this._nfpCache;
            return [placePaths(placeList.slice(), placementWorkerData)];
        })
            .then(function (placements) {
            if (!placements || placements.length == 0) {
                return;
            }
            var i = 0;
            var j = 0;
            var bestResult = placements[0];
            individual.fitness = bestResult.fitness;
            for (i = 1; i < placements.length; ++i) {
                if (placements[i].fitness < bestResult.fitness) {
                    bestResult = placements[i];
                }
            }
            if (!_this._best || bestResult.fitness < _this._best.fitness) {
                _this._best = bestResult;
                var placedArea = 0;
                var totalArea = 0;
                var numPlacedParts = 0;
                var bestPlacement = void 0;
                var binArea = Math.abs(_this._binPolygon.area);
                for (i = 0; i < _this._best.placements.length; ++i) {
                    totalArea += binArea;
                    bestPlacement = _this._best.placements[i];
                    numPlacedParts += bestPlacement.length;
                    for (j = 0; j < bestPlacement.length; ++j) {
                        if (!bestPlacement[j]) {
                            throw new Error("missing entry in placement: " + JSON.stringify(_this._best));
                        }
                        var part_1 = _this._tree.byId(bestPlacement[j].id);
                        placedArea += Math.abs(polygonArea(part_1.points));
                    }
                }
            }
            displayCallback(_this._best.placements, _this._best.fitness);
            _this._isWorking = false;
        }, function (err) {
            console.log(err);
        })
            .catch(function (err) {
            console.log(err);
        });
        // TODO: should we return this future chain as well?
    };
    return AnyNest;
}());

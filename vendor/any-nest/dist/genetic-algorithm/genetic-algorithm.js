import FloatRect from "../geometry-util/float-rect.js";
import Phenotype from "./phenotype.js";
var DEFAULT_CONFIG = {
    populationSize: 10,
    mutationRate: 10,
    rotations: 4
};
var DEFAULT_BOUNDS = new FloatRect();
var GeneticAlgorithm = /** @class */ (function () {
    function GeneticAlgorithm() {
        this._isEmpty = true;
        this._population = new Array();
        this._config = DEFAULT_CONFIG;
        this._binBounds = DEFAULT_BOUNDS;
    }
    GeneticAlgorithm.prototype.init = function (adam, binBounds, config) {
        if (config === void 0) { config = DEFAULT_CONFIG; }
        this._isEmpty = false;
        this._config = config;
        this._binBounds = binBounds;
        // population is an array of individuals. Each individual is a object representing the order of insertion and the angle each part is rotated
        var angles = [];
        var i = 0;
        var mutant;
        for (i = 0; i < adam.length; ++i) {
            //angles.push(this._randomAngle(adam[i]));
            angles.push(0); // start with Adam as using unrotated inputs
        }
        this._population = [new Phenotype(adam, angles)];
        while (this._population.length < config.populationSize) {
            mutant = this._mutate(this._population[0]);
            this._population.push(mutant);
        }
    };
    GeneticAlgorithm.prototype.clear = function () {
        if (!this._isEmpty) {
            this._isEmpty = true;
            this._population.length = 0;
            this._binBounds = DEFAULT_BOUNDS;
            this._config = DEFAULT_CONFIG;
        }
    };
    GeneticAlgorithm.prototype._generation = function () {
        console.log("starting a new generation in the GA");
        // Individuals with higher fitness are more likely to be selected for mating
        this._population.sort(function (a, b) { return a.fitness - b.fitness; });
        // fittest individual is preserved in the new generation (elitism)
        var result = [this._population[0]];
        var currentSize = this._population.length;
        var male;
        var female;
        var children;
        while (result.length < currentSize) {
            male = this._randomWeightedIndividual();
            female = this._randomWeightedIndividual(male);
            // each mating produces two children
            children = this._mate(male, female);
            // slightly mutate children
            result.push(this._mutate(children[0]));
            if (result.length < currentSize) {
                result.push(this._mutate(children[1]));
            }
        }
        this._population = result;
    };
    // returns a random angle of insertion
    GeneticAlgorithm.prototype._randomAngle = function (part) {
        var angleCount = Math.max(this._config.rotations, 1);
        var angleList = [];
        var i = 0;
        var rotatedPart;
        for (i = 0; i < angleCount; ++i) {
            angleList.push(i * (360 / angleCount));
        }
        angleList = GeneticAlgorithm.shuffle(angleList);
        for (i = 0; i < angleCount; ++i) {
            rotatedPart = part.rotate(angleList[i]).bounds;
            // don't use obviously bad angles where the part doesn't fit in the bin
            if (rotatedPart.width < this._binBounds.width &&
                rotatedPart.height < this._binBounds.height) {
                return angleList[i];
            }
        }
        return 0;
    };
    // returns a mutated individual with the given mutation rate
    GeneticAlgorithm.prototype._mutate = function (individual) {
        var trashold = 0.01 * this._config.mutationRate;
        var clone = individual.clone();
        var size = clone.size;
        var i = 0;
        var j = 0;
        var rand = 0;
        var placement;
        for (i = 0; i < size; ++i) {
            rand = Math.random();
            if (rand < trashold) {
                // swap current part with next part
                j = i + 1;
                if (j < size) {
                    placement = clone.placement[i];
                    clone.placement[i] = clone.placement[j];
                    clone.placement[j] = placement;
                }
            }
            rand = Math.random();
            if (rand < trashold) {
                clone.rotation[i] = this._randomAngle(clone.placement[i]);
            }
        }
        return clone;
    };
    // single point crossover
    GeneticAlgorithm.prototype._mate = function (male, female) {
        var cutPoint = Math.round(Math.min(Math.max(Math.random(), 0.1), 0.9) * (male.placement.length - 1));
        var result = [male.cut(cutPoint), female.cut(cutPoint)];
        result[0].mate(female);
        result[1].mate(male);
        return result;
    };
    // returns a random individual from the population, weighted to the front of the list (lower fitness value is more likely to be selected)
    GeneticAlgorithm.prototype._randomWeightedIndividual = function (exclude) {
        var localPopulation = this._population.slice();
        var excludeIndex = exclude
            ? localPopulation.indexOf(exclude)
            : -1;
        if (excludeIndex >= 0) {
            localPopulation.splice(excludeIndex, 1);
        }
        var size = localPopulation.length;
        var rand = Math.random();
        var weight = 2 / size;
        var lower = 0;
        var upper = weight / 2;
        var i = 0;
        for (i = 0; i < size; ++i) {
            // if the random number falls between lower and upper bounds, select this individual
            if (rand > lower && rand < upper) {
                return localPopulation[i];
            }
            lower = upper;
            upper += weight * ((size - i) / size);
        }
        return localPopulation[0];
    };
    Object.defineProperty(GeneticAlgorithm.prototype, "individual", {
        get: function () {
            var i = 0;
            // evaluate all members of the population
            for (i = 0; i < this._population.length; ++i) {
                if (!this._population[i].fitness) {
                    return this._population[i];
                }
            }
            // all individuals have been evaluated, start next generation
            this._generation();
            return this._population[1] || null;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(GeneticAlgorithm.prototype, "population", {
        get: function () {
            return this._population;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(GeneticAlgorithm.prototype, "isEmpty", {
        get: function () {
            return this._isEmpty;
        },
        enumerable: false,
        configurable: true
    });
    GeneticAlgorithm.shuffle = function (angleList) {
        var lastIndex = angleList.length - 1;
        var i = 0;
        var j = 0;
        var temp;
        for (i = lastIndex; i > 0; --i) {
            j = Math.floor(Math.random() * (i + 1));
            temp = angleList[i];
            angleList[i] = angleList[j];
            angleList[j] = temp;
        }
        return angleList;
    };
    return GeneticAlgorithm;
}());
export default GeneticAlgorithm;

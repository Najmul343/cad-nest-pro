var Phenotype = /** @class */ (function () {
    function Phenotype(placement, rotation) {
        this._fitness = 0;
        this._placement = placement;
        this._rotation = rotation;
    }
    Phenotype.prototype.cut = function (cutPoint) {
        return new Phenotype(this._placement.slice(0, cutPoint), this._rotation.slice(0, cutPoint));
    };
    Phenotype.prototype.clone = function () {
        return new Phenotype(this._placement.slice(), this._rotation.slice());
    };
    Phenotype.prototype.mate = function (phenotype) {
        var i = 0;
        var placement = phenotype.placement[0];
        var rotation = phenotype.rotation[0];
        for (i = 0; i < phenotype.size; ++i) {
            placement = phenotype.placement[i];
            rotation = phenotype.rotation[i];
            if (!this._contains(placement.id)) {
                this._placement.push(placement);
                this._rotation.push(rotation);
            }
        }
    };
    Phenotype.prototype._contains = function (id) {
        var i = 0;
        var size = this.size;
        for (i = 0; i < size; ++i) {
            if (this._placement[i].id === id) {
                return true;
            }
        }
        return false;
    };
    Object.defineProperty(Phenotype.prototype, "placement", {
        get: function () {
            return this._placement;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Phenotype.prototype, "rotation", {
        get: function () {
            return this._rotation;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Phenotype.prototype, "size", {
        get: function () {
            return this._placement.length;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Phenotype.prototype, "fitness", {
        get: function () {
            return this._fitness;
        },
        set: function (value) {
            this._fitness = value;
        },
        enumerable: false,
        configurable: true
    });
    return Phenotype;
}());
export default Phenotype;

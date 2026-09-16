import { OperationStatus } from "./enums.js";
var Operation = /** @class */ (function () {
    function Operation(result) {
        if (result === void 0) { result = null; }
        this._successCallbacks = [];
        this._errorCallbacks = [];
        this._status = result ? OperationStatus.Success : OperationStatus.Empty;
        this._result = result;
    }
    Operation.prototype.resolve = function (value) {
        this._proceed(OperationStatus.Success, value);
    };
    Operation.prototype.reject = function (value) {
        this._proceed(OperationStatus.Error, value);
    };
    Operation.prototype.then = function (resolve, reject) {
        switch (this._status) {
            case OperationStatus.Success:
                return resolve && resolve(this._result);
            case OperationStatus.Error:
                return reject && reject(this._result);
            default: {
                resolve && this._successCallbacks.push(resolve);
                reject && this._errorCallbacks.push(reject);
            }
        }
    };
    Operation.prototype._proceed = function (status, result) {
        this._status = status;
        this._result = result;
        var callbacks = status === OperationStatus.Error
            ? this._errorCallbacks
            : this._successCallbacks;
        var count = callbacks.length;
        var i = 0;
        for (i = 0; i < count; ++i) {
            callbacks[i](result);
        }
        this._successCallbacks = [];
        this._errorCallbacks = [];
    };
    return Operation;
}());
export default Operation;

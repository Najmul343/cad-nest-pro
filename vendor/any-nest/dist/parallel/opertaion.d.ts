export default class Operation {
    private _successCallbacks;
    private _errorCallbacks;
    private _status;
    private _result;
    constructor(result?: any);
    resolve(value: any): void;
    reject(value: any): void;
    then(resolve?: Function, reject?: Function): void;
    private _proceed;
}

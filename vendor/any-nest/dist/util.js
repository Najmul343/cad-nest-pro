// floating point comparison tolerance
var TOLEARANCE = Math.pow(10, -9); // Floating point error is likely to be above 1 epsilon
export function almostEqual(a, b, tolerance) {
    if (tolerance === void 0) { tolerance = TOLEARANCE; }
    return Math.abs(a - b) < tolerance;
}
export function generateNFPCacheKey(rotationSplit, inside, polygon1, polygon2, rotation1, rotation2) {
    if (rotation1 === void 0) { rotation1 = polygon1.rotation; }
    if (rotation2 === void 0) { rotation2 = polygon2.rotation; }
    var rotationOffset = Math.round(360 / rotationSplit);
    var rotationIndex1 = Math.round(rotation1 / rotationOffset);
    var rotationIndex2 = Math.round(rotation2 / rotationOffset);
    return JSON.stringify({
        "id1": polygon1.id,
        "id2": polygon2.id,
        "r1": rotation1,
        "r2": rotation2,
        "inside": inside
    });
}
export function keyToNFPData(key, rotationSplit) {
    var rotationOffset = Math.round(360 / rotationSplit);
    var result = new Float32Array(5);
    var accumulator = 0;
    /*
    result[4] = inside;
    result[3] = rotationIndexB * rotationOffset;
    result[2] = rotationIndexA * rotationOffset;
    result[1] = idB - 1;
    result[0] = idA - 1;
  */
    return JSON.parse(key);
    // return result;
}

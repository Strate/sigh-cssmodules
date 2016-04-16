"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.resolveImport = resolveImport;

var _path = require("path");

function resolveImport(path, relativeTo) {
    return (0, _path.resolve)((0, _path.dirname)(relativeTo), path.replace(/^"|"$/g, ''));
}
//# sourceMappingURL=resolveImport.js.map
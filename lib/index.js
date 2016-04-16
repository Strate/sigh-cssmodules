'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _sighCore = require('sigh-core');

var _sighCoreLibStream = require('sigh-core/lib/stream');

var _resolveImport = require("./resolveImport");

function getImportsTask(opts) {
  var Parser = require("css-modules-loader-core/lib/parser");
  var postcssModulesExtractImports = require("postcss-modules-extract-imports");
  var postcss = require("postcss");

  return function (event) {
    var imports = [];
    var parser = new Parser(function (path, relativeTo) {
      imports.push({ path: path, relativeTo: relativeTo });
      return { then: function then() {} };
    });
    function captureImportsPlugin(css, result) {
      return parser.fetchAllImports(css);
    }
    return postcss([postcssModulesExtractImports, captureImportsPlugin]).process(event.data, { from: event.sourcePath, map: { inline: false } }).then(function (_ref) {
      var css = _ref.css;
      var map = _ref.map;

      return { css: css, map: map, imports: imports };
    });
  };
}

function cssmodulesTask(opts) {
  // this function is called once for each subprocess in order to cache state,
  // it is not a closure and does not have access to the surrounding state, use
  // `require` to include any modules you need, for further info see
  // https://github.com/ohjames/process-pool
  // var log = require('sigh-core').log
  // var Promise = require("bluebird");
  var Core = require("css-modules-loader-core");
  var core = new Core();
  var Promise = require("bluebird");
  var resolveImport = require("./resolveImport").resolveImport;

  // this task runs inside the subprocess to transform each event
  return function (cwd, event, imports) {
    if (Object.keys(imports).length > 0) {
      console.log("here");
    }
    function fetch(path, relativeTo) {
      return core.load(imports[path + relativeTo], resolveImport(cwd, path, relativeTo), {}, fetch).then(function (_ref2) {
        var exportTokens = _ref2.exportTokens;
        return exportTokens;
      });
    }
    return core.load(event.data, event.projectPath, {}, function (path, relativeTo) {
      return core.load();
    }).then(function (_ref3) {
      var injectableSource = _ref3.injectableSource;
      var exportTokens = _ref3.exportTokens;

      if (Object.keys(imports).length > 0) {
        console.log("injectableSource", injectableSource, "exportTokens", exportTokens);
        process.exit(1);
      }
      return {
        css: event.data
      };
    });
  };
}

var files = {};
var cwd = process.cwd();

function getEvent(event) {
  return _lodash2['default'].pick(event, 'type', 'data', 'path', 'projectPath', 'sourcePath', '_basePath');
}

function getImportsForEvent(event) {
  var resolvedImports = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
}

function adaptEvent(getImports, compiler) {
  // data sent to/received from the subprocess has to be serialised/deserialised
  return function (event) {
    if (event.type !== 'add' && event.type !== 'change') return event;

    if (event.fileType !== 'css') return event;

    return getImports(getEvent(event)).then(function (_ref4) {
      var css = _ref4.css;
      var map = _ref4.map;
      var imports = _ref4.imports;

      if (map) {
        event.applySourceMap(map);
      }
      event.data = css;
      // resolve imports
      var resolvedImports = {};
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = imports[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var _step$value = _step.value;
          var path = _step$value.path;
          var relativeTo = _step$value.relativeTo;

          var hash = path + relativeTo;
          path = (0, _resolveImport.resolveImport)(cwd, path, relativeTo);
          resolvedImports[hash] = files[path];
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator['return']) {
            _iterator['return']();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }

      return compiler(cwd, getEvent(event), resolvedImports).then(function (_ref5) {
        var css = _ref5.css;
        var map = _ref5.map;

        event.data = css;

        if (map) {
          event.applySourceMap(map);
        }

        // event.changeFileSuffix('newSuffix')
        return event;
      });
    });
  };
}

var pooledProc;
var pooledGetImportsProc;

var Core = require("css-modules-loader-core");
var core = new Core();

exports['default'] = function (op) {
  var opts = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

  // if (!pooledProc) {
  //   pooledProc = op.procPool.prepare(cssmodulesTask, opts, { module })
  // }
  // if (!pooledGetImportsProc) {
  //   pooledGetImportsProc = op.procPool.prepare(getImportsTask, opts, {module})
  // }

  var stream;
  stream = (0, _sighCoreLibStream.mapEvents)(op.stream, function (event) {
    if (event.type === "add" || event.type === "change") {
      files[event.sourcePath] = event.data;
    }
    if (event.type === "remove") {
      delete files[event.sourcePath];
    }

    return event;
  });

  var index = 0;
  function pathFetcher(path, relativeTo, trace) {
    var file = (0, _resolveImport.resolveImport)(path, relativeTo);
    if (!files[file]) {
      file = file.replace(new RegExp('^/'), '');
    }
    if (!files[file]) {
      throw new Error('File ' + path + ' not found (require at ' + relativeTo + ')');
    }
    return core.load(files[file], file, index++, pathFetcher).then(function (_ref6) {
      var injectableSource = _ref6.injectableSource;
      var exportTokens = _ref6.exportTokens;

      return exportTokens;
    });
  }

  return (0, _sighCoreLibStream.mapEvents)(stream, function (event) {
    if (event.fileType !== 'css') return event;
    if (event.type === "add" || event.type === "change") {
      return core.load(event.data, event.sourcePath, index++, pathFetcher).then(function (_ref7) {
        var injectableSource = _ref7.injectableSource;
        var exportTokens = _ref7.exportTokens;

        var lines = [];
        _lodash2['default'].each(exportTokens, function (realClass, name) {
          lines.push("  " + name + ": " + realClass + ";");
        });
        event.data = ":export {\n" + lines.join("\n") + "\n}\n" + injectableSource;
        return event;
      });
    } else {
      return event;
    }
  });
};

module.exports = exports['default'];
//# sourceMappingURL=index.js.map
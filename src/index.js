import _ from 'lodash'
import Promise from 'bluebird'
import { Bacon } from 'sigh-core'
import { mapEvents, toFileSystemState } from 'sigh-core/lib/stream'
import {resolveImport} from "./resolveImport"

function getImportsTask(opts) {
  var Parser = require("css-modules-loader-core/lib/parser");
  var postcssModulesExtractImports = require("postcss-modules-extract-imports");
  var postcss = require("postcss");

  return event => {
    var imports = [];
    var parser = new Parser((path, relativeTo) => {
      imports.push({path, relativeTo})
      return {then: function() {}};
    })
    function captureImportsPlugin(css, result) {
      return parser.fetchAllImports(css)
    }
    return postcss([postcssModulesExtractImports, captureImportsPlugin])
        .process(event.data, {from: event.sourcePath, map: {inline: false}})
        .then(({css, map}) => {
          return {css, map, imports};
        })
  }
}

function cssmodulesTask(opts) {
  // this function is called once for each subprocess in order to cache state,
  // it is not a closure and does not have access to the surrounding state, use
  // `require` to include any modules you need, for further info see
  // https://github.com/ohjames/process-pool
  // var log = require('sigh-core').log
  // var Promise = require("bluebird");
  var Core = require("css-modules-loader-core");
  var core = new Core;
  var Promise = require("bluebird");
  var resolveImport = require("./resolveImport").resolveImport

  // this task runs inside the subprocess to transform each event
  return (cwd, event, imports) => {
    if (Object.keys(imports).length > 0) {
      console.log("here");
    }
    function fetch(path, relativeTo) {
      return core.load(imports[path + relativeTo], resolveImport(cwd, path, relativeTo), {}, fetch)
          .then(({exportTokens}) => exportTokens)
    }
    return core.load(
        event.data,
        event.projectPath,
        {},
        (path, relativeTo) => core.load()
    ).then(({injectableSource, exportTokens}) => {
      if (Object.keys(imports).length > 0) {
        console.log(
            "injectableSource", injectableSource,
            "exportTokens", exportTokens
        )
        process.exit(1)
      }
      return {
        css: event.data
      }
    });
  }
}

var files = {};
var cwd = process.cwd();

function getEvent(event) {
  return _.pick(event, 'type', 'data', 'path', 'projectPath', 'sourcePath', '_basePath')
}

function getImportsForEvent(event, resolvedImports = {}) {

}

function adaptEvent(getImports, compiler) {
  // data sent to/received from the subprocess has to be serialised/deserialised
  return event => {
    if (event.type !== 'add' && event.type !== 'change')
      return event

    if (event.fileType !== 'css') return event

    return getImports(getEvent(event)).then(({css, map, imports}) => {
      if (map) {
        event.applySourceMap(map);
      }
      event.data = css;
      // resolve imports
      var resolvedImports = {};
      for (let {path, relativeTo} of imports) {
        let hash = path + relativeTo;
        path = resolveImport(cwd, path, relativeTo);
        resolvedImports[hash] = files[path];
      }
      return compiler(cwd, getEvent(event), resolvedImports).then(({css, map}) => {
        event.data = css

        if (map) {
          event.applySourceMap(map)
        }

        // event.changeFileSuffix('newSuffix')
        return event
      })
    })
  }
}

var pooledProc
var pooledGetImportsProc

var Core = require("css-modules-loader-core");
var core = new Core;

export default function(op, opts = {}) {
  // if (!pooledProc) {
  //   pooledProc = op.procPool.prepare(cssmodulesTask, opts, { module })
  // }
  // if (!pooledGetImportsProc) {
  //   pooledGetImportsProc = op.procPool.prepare(getImportsTask, opts, {module})
  // }

  var stream;
  stream = mapEvents(op.stream, event => {
    if (event.type === "add" || event.type === "change") {
      files[event.sourcePath] = event.data
    }
    if (event.type === "remove") {
      delete files[event.sourcePath]
    }

    return event;
  })


  var index = 0;
  function pathFetcher(path, relativeTo, trace) {
    var file = resolveImport(path, relativeTo)
    if (!files[file]) {
      file = file.replace(new RegExp('^/'), '');
    }
    if (!files[file]) {
      throw new Error(`File ${path} not found (require at ${relativeTo})`)
    }
    return core.load(
        files[file],
        file,
        index++,
        pathFetcher
    ).then(({injectableSource, exportTokens}) => {
      return exportTokens;
    })
  }

  return mapEvents(stream, event => {
    if (event.fileType !== 'css') return event
    if (event.type === "add" || event.type === "change") {
      return core.load(
        event.data,
        event.sourcePath,
        index++,
        pathFetcher
      ).then(({injectableSource, exportTokens}) => {
        event.data = ":export " + JSON.stringify(exportTokens) + "\n" + injectableSource
        return event;
      })
    } else {
      return event;
    }
  });
}

import {relative, resolve, dirname} from "path"
export function resolveImport(path, relativeTo) {
    return resolve(dirname(relativeTo), path.replace(/^"|"$/g, ''));
}

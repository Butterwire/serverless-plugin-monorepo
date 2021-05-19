"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
/** Takes a path and returns all node_modules resolution paths (but not global include paths). */
function getNodeModulePaths(p) {
    const result = [];
    const paths = p.split(path.sep);
    while (paths.length) {
        result.push(path.join(paths.join(path.sep) || path.sep, 'node_modules'));
        paths.pop();
    }
    return result;
}
/** Creates a symlink. Ignore errors if symlink exists or package exists. */
async function link(target, f, type) {
    await fs.ensureDir(path.dirname(f));
    await fs.symlink(target, f, type).catch((e) => {
        if (e.code === 'EEXIST' || e.code === 'EISDIR') {
            return;
        }
        throw e;
    });
}
/** Plugin implementation */
module.exports = class ServerlessMonoRepo {
    constructor(serverless) {
        var _a, _b, _c, _d;
        this.serverless = serverless;
        this.hooks = {
            'package:cleanup': () => this.clean(),
            'package:initialize': () => this.initialise(),
            'offline:start:init': () => this.initialise(),
            'offline:start': () => this.initialise(),
            'deploy:function:initialize': async () => {
                await this.clean();
                await this.initialise();
            },
        };
        // Settings
        const custom = (_b = (_a = this.serverless.service.custom) === null || _a === void 0 ? void 0 : _a.serverlessMonoRepo) !== null && _b !== void 0 ? _b : {};
        this.settings = {
            path: (_c = custom.path) !== null && _c !== void 0 ? _c : this.serverless.config.servicePath,
            linkType: (_d = custom.linkType) !== null && _d !== void 0 ? _d : 'junction',
        };
    }
    log(msg) {
        this.serverless.cli.log(msg);
    }
    async linkPackage(name, fromPath, toPath, created, resolved) {
        // Ignore circular dependencies
        if (resolved.includes(name)) {
            return;
        }
        // Obtain list of module resolution paths to use for resolving modules
        const paths = getNodeModulePaths(fromPath);
        // Get package file path
        const pkg = require.resolve('./' + path.join(name, 'package.json'), {
            paths,
        });
        // Get relative path to package & create link if not an embedded node_modules
        const target = path.relative(path.join(toPath, path.dirname(name)), path.dirname(pkg));
        if ((pkg.match(/node_modules/g) || []).length <= 1 && !created.has(name)) {
            created.add(name);
            await link(target, path.join(toPath, name), this.settings.linkType);
        }
        // Get dependencies
        const { dependencies = {} } = require(pkg);
        // Link all dependencies
        await Promise.all(Object.keys(dependencies).map((dep) => this.linkPackage(dep, path.dirname(pkg), toPath, created, resolved.concat([name]))));
    }
    async clean() {
        // Remove all symlinks that are of form [...]/node_modules/link
        this.log('Cleaning dependency symlinks');
        // Checks if a given stat result indicates a scoped package directory
        const isScopedPkgDir = (c) => c.s.isDirectory() && c.f.startsWith('@');
        // Cleans all links in a specific path
        async function clean(p) {
            if (!(await fs.pathExists(p))) {
                return;
            }
            const files = await fs.readdir(p);
            let contents = await Promise.all(files.map((f) => fs.lstat(path.join(p, f)).then((s) => ({ f, s }))));
            // Remove all links
            await Promise.all(contents
                .filter((c) => c.s.isSymbolicLink())
                .map((c) => fs.unlink(path.join(p, c.f))));
            contents = contents.filter((c) => !c.s.isSymbolicLink());
            // Remove all links in scoped packages
            await Promise.all(contents.filter(isScopedPkgDir).map((c) => clean(path.join(p, c.f))));
            const remainingFiles = await fs.readdir(p);
            // Remove directory if empty
            if (!remainingFiles.length) {
                await fs.rmdir(p);
            }
        }
        // Clean node_modules
        await clean(path.join(this.settings.path, 'node_modules'));
    }
    async initialise() {
        // Read package JSON
        const { dependencies = {} } = require(path.join(this.settings.path, 'package.json'));
        // Link all dependent packages
        this.log('Creating dependency symlinks');
        const contents = new Set();
        await Promise.all(Object.keys(dependencies).map((name) => this.linkPackage(name, this.settings.path, path.join(this.settings.path, 'node_modules'), contents, [])));
    }
};

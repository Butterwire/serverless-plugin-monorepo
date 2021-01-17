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
const PathLib = __importStar(require("path"));
/** Takes a path and returns all node_modules resolution paths (but not global include paths). */
function getNodeModulePaths(p) {
    const result = [];
    const paths = p.split(PathLib.sep);
    while (paths.length) {
        result.push(PathLib.join(paths.join(PathLib.sep) || PathLib.sep, 'node_modules'));
        paths.pop();
    }
    return result;
}
/** Creates a symlink. Ignore errors if symlink exists or package exists. */
async function link(target, f, type) {
    await fs.ensureDir(PathLib.dirname(f));
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
        var _a, _b;
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
        const defaultSettings = {
            path: this.serverless.config.servicePath,
            linkType: 'junction',
        };
        const custom = (_a = this.serverless.service.custom) === null || _a === void 0 ? void 0 : _a.serverlessMonoRepo;
        if (!custom) {
            this.settings = [defaultSettings];
        }
        else if (Array.isArray(custom)) {
            this.settings = custom.map(({ path, linkType }) => {
                return {
                    path: PathLib.resolve(PathLib.join(this.serverless.config.servicePath, path)),
                    linkType: linkType !== null && linkType !== void 0 ? linkType : 'junction',
                };
            });
        }
        else {
            this.settings = [
                {
                    path: PathLib.join(this.serverless.config.servicePath, custom.path),
                    linkType: (_b = custom.linkType) !== null && _b !== void 0 ? _b : 'junction',
                },
            ];
        }
    }
    log(msg) {
        this.serverless.cli.log(msg);
    }
    async linkPackage(name, fromPath, linkType, toPath, created, resolved) {
        // Ignore circular dependencies
        if (resolved.includes(name)) {
            return;
        }
        // Obtain list of module resolution paths to use for resolving modules
        const paths = getNodeModulePaths(fromPath);
        // Get package file path
        const pkg = require.resolve('./' + PathLib.join(name, 'package.json'), {
            paths,
        });
        // Get relative path to package & create link if not an embedded node_modules
        const target = PathLib.relative(PathLib.join(toPath, PathLib.dirname(name)), PathLib.dirname(pkg));
        if ((pkg.match(/node_modules/g) || []).length <= 1 && !created.has(name)) {
            created.add(name);
            await link(target, PathLib.join(toPath, name), linkType);
        }
        // Get dependencies
        const { dependencies = {} } = require(pkg);
        // Link all dependencies
        await Promise.all(Object.keys(dependencies).map((dep) => this.linkPackage(dep, PathLib.dirname(pkg), linkType, toPath, created, resolved.concat([name]))));
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
            let contents = await Promise.all(files.map((f) => fs.lstat(PathLib.join(p, f)).then((s) => ({ f, s }))));
            // Remove all links
            await Promise.all(contents
                .filter((c) => c.s.isSymbolicLink())
                .map((c) => fs.unlink(PathLib.join(p, c.f))));
            contents = contents.filter((c) => !c.s.isSymbolicLink());
            // Remove all links in scoped packages
            await Promise.all(contents.filter(isScopedPkgDir).map((c) => clean(PathLib.join(p, c.f))));
            contents = contents.filter((c) => !isScopedPkgDir(c));
            // Remove directory if empty
            if (!contents.length) {
                await fs.rmdir(p);
            }
        }
        // Clean node_modules
        await Promise.all(this.settings.map(({ path }) => clean(PathLib.join(path, 'node_modules'))));
    }
    async initialise() {
        // Read package JSON
        await Promise.all(this.settings.map((repo) => this.initRepo(repo)));
    }
    async initRepo({ path, linkType }) {
        const { dependencies = {} } = require(PathLib.join(path, 'package.json'));
        // Link all dependent packages
        this.log(`Creating dependency symlinks in directory: ${path}`);
        const contents = new Set();
        await Promise.all(Object.keys(dependencies).map((name) => this.linkPackage(name, path, linkType, PathLib.join(path, 'node_modules'), contents, [])));
    }
};

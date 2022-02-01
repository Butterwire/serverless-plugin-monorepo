import * as fs from 'fs-extra';
import * as path from 'path';
import Serverless from 'serverless';

/** Takes a path and returns all node_modules resolution paths (but not global include paths). */
function getNodeModulePaths(p: string): string[] {
  const result: string[] = [];
  const paths = p.split(path.sep);
  while (paths.length) {
    result.push(path.join(paths.join(path.sep) || path.sep, 'node_modules'));
    paths.pop();
  }
  return result;
}

/** Creates a symlink. Ignore errors if symlink exists or package exists. */
async function link(target: string, f: string, type: fs.SymlinkType) {
  await fs.ensureDir(path.dirname(f));
  await fs.symlink(target, f, type).catch((e) => {
    if (e.code === 'EEXIST' || e.code === 'EISDIR') {
      return;
    }
    throw e;
  });
}

/** Settings that can be specified in serverless YAML file */
export interface ServerlessMonoRepoSettings {
  path: string;
  linkType: fs.SymlinkType;
}

/** Plugin implementation */
module.exports = class ServerlessMonoRepo {
  settings: ServerlessMonoRepoSettings;
  hooks: { [key: string]: () => void };

  constructor(private serverless: Serverless) {
    this.hooks = {
      'package:cleanup': () => this.clean(),
      'package:initialize': () => this.initialise(),
      'before:offline:start:init': () => this.initialise(),
      'offline:start': () => this.initialise(),
      'deploy:function:initialize': async () => {
        await this.clean();
        await this.initialise();
      },
    };

    // Settings
    const custom: Partial<ServerlessMonoRepoSettings> =
      this.serverless.service.custom?.serverlessMonoRepo ?? {};
    this.settings = {
      path: custom.path ?? this.serverless.config.servicePath,
      linkType: custom.linkType ?? 'junction',
    };
  }

  log(msg: string) {
    this.serverless.cli.log(msg);
  }

  async linkPackage(parent: string, fromPath: string, toPath: string) {
    const key = parent + ':';
    const visited = new Set([key]);
    const queue = [[key, fromPath]];

    while (queue.length) {
      let [key, fromPath] = queue.shift() as string[];
      const [name] = key.split(':');

      // Obtain list of module resolution paths to use for resolving modules
      const paths = getNodeModulePaths(fromPath);

      // Get package file path
      const pkg = require.resolve('./' + path.join(name, 'package.json'), {
        paths,
      });

      // Get dependencies
      const { dependencies = {} } = require(pkg);

      fromPath = path.dirname(pkg);

      // Get relative path to package
      const target = path.relative(
        path.join(toPath, path.dirname(name)),
        fromPath
      );

      // Create link, ignoring the parent package and embedded modules
      if (parent !== name && (pkg.match(/node_modules/g) || []).length <= 1)
        await link(target, path.join(toPath, name), this.settings.linkType);

      for (const [name, version] of Object.entries(dependencies)) {
        key = name + ':' + version;

        if (!visited.has(key)) {
          queue.push([key, fromPath]);
          visited.add(key);
        }
      }
    }
  }

  async clean() {
    // Remove all symlinks that are of form [...]/node_modules/link
    this.log('Cleaning dependency symlinks');

    type File = { f: string; s: fs.Stats };

    // Checks if a given stat result indicates a scoped package directory
    const isScopedPkgDir = (c: File) =>
      c.s.isDirectory() && c.f.startsWith('@');

    // Cleans all links in a specific path
    async function clean(p: string) {
      if (!(await fs.pathExists(p))) {
        return;
      }

      const files = await fs.readdir(p);
      let contents: File[] = await Promise.all(
        files.map((f) => fs.lstat(path.join(p, f)).then((s) => ({ f, s })))
      );

      // Remove all links
      await Promise.all(
        contents
          .filter((c) => c.s.isSymbolicLink())
          .map((c) => fs.unlink(path.join(p, c.f)))
      );
      contents = contents.filter((c) => !c.s.isSymbolicLink());

      // Remove all links in scoped packages
      await Promise.all(
        contents.filter(isScopedPkgDir).map((c) => clean(path.join(p, c.f)))
      );
      contents = contents.filter((c) => !isScopedPkgDir(c));

      // Remove directory if empty
      const filesInDir = await fs.readdir(p);
      if (!filesInDir.length) {
        await fs.rmdir(p);
      }
    }

    // Clean node_modules
    await clean(path.join(this.settings.path, 'node_modules'));
  }

  async initialise() {
    // Read package JSON
    const { name = '' } = require(path.join(
      this.settings.path,
      'package.json'
    ));

    // Link all dependent packages
    this.log('Creating dependency symlinks');
    this.linkPackage(
      name,
      this.settings.path,
      path.join(this.settings.path, 'node_modules')
    );
  }
};

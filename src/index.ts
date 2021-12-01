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
async function link(target: string, f: string, type: fs.FsSymlinkType) {
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
  linkType: fs.FsSymlinkType;
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

  async linkPackage(
    name: string,
    fromPath: string,
    toPath: string,
    created: Set<string>,
    resolved: string[]
  ) {
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
    const target = path.relative(
      path.join(toPath, path.dirname(name)),
      path.dirname(pkg)
    );
    if ((pkg.match(/node_modules/g) || []).length <= 1 && !created.has(name)) {
      created.add(name);
      await link(target, path.join(toPath, name), this.settings.linkType);
    }

    // Get dependencies
    const { dependencies = {} } = require(pkg);

    // Link all dependencies
    await Promise.all(
      Object.keys(dependencies).map((dep) =>
        this.linkPackage(
          dep,
          path.dirname(pkg),
          toPath,
          created,
          resolved.concat([name])
        )
      )
    );
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
      if (!contents.length) {
        await fs.rmdir(p);
      }
    }

    // Clean node_modules
    await clean(path.join(this.settings.path, 'node_modules'));
  }

  async initialise() {
    // Read package JSON
    const { dependencies = {} } = require(path.join(
      this.settings.path,
      'package.json'
    ));

    // Link all dependent packages
    this.log('Creating dependency symlinks');
    const contents = new Set<string>();
    await Promise.all(
      Object.keys(dependencies).map((name) =>
        this.linkPackage(
          name,
          this.settings.path,
          path.join(this.settings.path, 'node_modules'),
          contents,
          []
        )
      )
    );
  }
};

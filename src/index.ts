import * as fs from 'fs-extra';
import * as PathLib from 'path';
import Serverless from 'serverless';

/** Takes a path and returns all node_modules resolution paths (but not global include paths). */
function getNodeModulePaths(p: string): string[] {
  const result: string[] = [];
  const paths = p.split(PathLib.sep);
  while (paths.length) {
    result.push(
      PathLib.join(paths.join(PathLib.sep) || PathLib.sep, 'node_modules')
    );
    paths.pop();
  }
  return result;
}

/** Creates a symlink. Ignore errors if symlink exists or package exists. */
async function link(target: string, f: string, type: fs.FsSymlinkType) {
  await fs.ensureDir(PathLib.dirname(f));
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
  settings: ServerlessMonoRepoSettings[];
  hooks: { [key: string]: () => void };

  constructor(private serverless: Serverless) {
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
    } as ServerlessMonoRepoSettings;

    const custom = this.serverless.service.custom?.serverlessMonoRepo;
    if (!custom) {
      this.settings = [defaultSettings];
    } else if (Array.isArray(custom)) {
      this.settings = custom.map(({ path, linkType }) => {
        return {
          path: PathLib.resolve(
            PathLib.join(this.serverless.config.servicePath, path)
          ),
          linkType: linkType ?? 'junction', // the only optional param
        } as ServerlessMonoRepoSettings;
      });
    } else {
      this.settings = [
        {
          path: PathLib.join(this.serverless.config.servicePath, custom.path),
          linkType: custom.linkType ?? 'junction',
        },
      ];
    }
  }

  log(msg: string) {
    this.serverless.cli.log(msg);
  }

  async linkPackage(
    name: string,
    fromPath: string,
    linkType: fs.FsSymlinkType,
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
    const pkg = require.resolve('./' + PathLib.join(name, 'package.json'), {
      paths,
    });

    // Get relative path to package & create link if not an embedded node_modules
    const target = PathLib.relative(
      PathLib.join(toPath, PathLib.dirname(name)),
      PathLib.dirname(pkg)
    );
    if ((pkg.match(/node_modules/g) || []).length <= 1 && !created.has(name)) {
      created.add(name);
      await link(target, PathLib.join(toPath, name), linkType);
    }

    // Get dependencies
    const { dependencies = {} } = require(pkg);

    // Link all dependencies
    await Promise.all(
      Object.keys(dependencies).map((dep) =>
        this.linkPackage(
          dep,
          PathLib.dirname(pkg),
          linkType,
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
        files.map((f) => fs.lstat(PathLib.join(p, f)).then((s) => ({ f, s })))
      );

      // Remove all links
      await Promise.all(
        contents
          .filter((c) => c.s.isSymbolicLink())
          .map((c) => fs.unlink(PathLib.join(p, c.f)))
      );
      contents = contents.filter((c) => !c.s.isSymbolicLink());

      // Remove all links in scoped packages
      await Promise.all(
        contents.filter(isScopedPkgDir).map((c) => clean(PathLib.join(p, c.f)))
      );
      contents = contents.filter((c) => !isScopedPkgDir(c));

      // Remove directory if empty
      if (!contents.length) {
        await fs.rmdir(p);
      }
    }

    // Clean node_modules
    await Promise.all(
      this.settings.map(({ path }) => clean(PathLib.join(path, 'node_modules')))
    );
  }

  async initialise() {
    // Read package JSON
    await Promise.all(this.settings.map((repo) => this.initRepo(repo)));
  }

  async initRepo({ path, linkType }: ServerlessMonoRepoSettings) {
    const { dependencies = {} } = require(PathLib.join(path, 'package.json'));

    // Link all dependent packages
    this.log(`Creating dependency symlinks in directory: ${path}`);
    const contents = new Set<string>();
    await Promise.all(
      Object.keys(dependencies).map((name) =>
        this.linkPackage(
          name,
          path,
          linkType,
          PathLib.join(path, 'node_modules'),
          contents,
          []
        )
      )
    );
  }
};

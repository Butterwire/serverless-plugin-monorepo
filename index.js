const fs = require('fs-extra')
const path = require('path')

// Takes a path and returns all node_modules resolution paths (but not global include paths).
const getNodeModulePaths = p => {
  const result = []
  let paths = p.split(path.sep)
  while (paths.length) {
    result.push(path.join(paths.join(path.sep) || path.sep, 'node_modules'))
    paths.pop()
  }
  return result
}

// Creates a symlink. Ignores if fails to create due to already existing.
async function link (target, f) {
  await fs.ensureDir(path.dirname(f))
  await fs.symlink(target, f)
    .catch(e => {
      if (e.code === 'EEXIST') {
        return
      }
      throw e
    })
}

class ServerlessMonoRepo {
  constructor (serverless) {
    this.serverless = serverless
    this.hooks = {
      'package:cleanup': this.clean.bind(this),
      'package:initialize': this.packageInitialise.bind(this)
    }
    this.log = msg => serverless.cli.log(msg)

    // Settings
    this.settings = this.serverless.service.custom.serverlessMonoRepo || {}
    this.settings.path = this.settings.path || this.serverless.config.servicePath
  }

  async linkPackage (name, fromPath, toPath, created) {
    // Do nothing if already created
    if (created.has(name)) {
      return
    }

    // Obtain list of module resolution paths to use for resolving modules
    const paths = getNodeModulePaths(fromPath)

    // Get package file path
    const pkg = require.resolve(path.join(name, 'package.json'), { paths })

    // Get relative path to package & create link if not an embedded node_modules
    const target = path.relative(path.join(toPath, path.dirname(name)), path.dirname(pkg))
    if ((pkg.match(/node_modules/g) || []).length <= 1) {
      created.add(name)
      await link(target, path.join(toPath, name))
    }

    // Get dependencies
    const { dependencies = {} } = require(pkg)

    // Link all dependencies
    await Promise.all(Object.keys(dependencies).map(name =>
      this.linkPackage(name, path.dirname(pkg), toPath, created)
    ))
  }

  async clean () {
    // Remove all symlinks that are of form [...]/node_modules/link
    this.log('Cleaning dependency symlinks')

    // Checks if a given stat result indicates a scoped package directory
    const isScopedPkgDir = c => c.s.isDirectory() && c.f.startsWith('@')

    // Cleans all links in a specific path
    async function clean (p) {
      const files = await fs.readdir(p)
      let contents = await Promise.all(files.map(f =>
        fs.lstat(path.join(p, f)).then(s => ({ f, s }))
      ))

      // Remove all links
      await Promise.all(contents.filter(c => c.s.isSymbolicLink())
        .map(c => fs.unlink(path.join(p, c.f))))
      contents = contents.filter(c => !c.s.isSymbolicLink())

      // Remove all links in scoped packages
      await Promise.all(contents.filter(isScopedPkgDir)
        .map(c => clean(path.join(p, c.f))))
      contents = contents.filter(c => !isScopedPkgDir(c))

      // Remove directory if empty
      if (!contents.length) {
        await fs.rmdir(p)
      }
    }

    // Clean node_modules
    await clean(path.join(this.settings.path, 'node_modules'))
  }

  async packageInitialise () {
    // Read package JSON
    const { dependencies = {} } = require(path.join(this.settings.path, 'package.json'))

    // Link all dependent packages
    this.log('Creating dependency symlinks')
    const contents = new Set()
    await Promise.all(Object.keys(dependencies).map(name =>
      this.linkPackage(name, this.settings.path, path.join(this.settings.path, 'node_modules'), contents)
    ))
  }
}

module.exports = ServerlessMonoRepo

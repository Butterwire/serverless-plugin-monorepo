# serverless-plugin-monorepo

[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![NPM Package](https://img.shields.io/npm/v/serverless-plugin-monorepo.svg)](https://www.npmjs.com/package/serverless-plugin-monorepo)

A Serverless plugin design to make it possible to use Serverless in a
Javascript mono repo with hoisted dependencies, e.g. when using [Yarn Workspaces](https://yarnpkg.com/lang/en/docs/workspaces/).

This plugin alleviates the need to use [nohoist](https://yarnpkg.com/blog/2018/02/15/nohoist/) functionality by creating
symlinks to all declared dependencies. Development dependencies are deliberately NOT linked so these
will not be packaged into the resulting archive.

[Butterwire](https://www.butterwire.com) uses Yarn workspaces and we created this plugin to improve our development
experience. Not using nohoist saves wasting disk space and also accidentally including
development dependencies in our packaged functions.

*Note, this package will only work on operating systems that support symbolic links!*


## Installation

```
yarn add --dev serverless-plugin-monorepo
# or using NPM
npm install --dev serverless-plugin-monorepo
```

Currently this plugin requires Node V8+. If there is interest in support older
versions then trans-compilation with Babel could be added.


## Usage

Add the plugin to your `serverless.yml` file:

```
plugins:
  - serverless-plugin-monorepo
```

The plugin listens for package lifecycle events. Prior to Serverless packaging
up the service, it will scan the `package.json` file for dependencies and
ensure that all dependencies (including transitive dependencies) are symlinked in `node_modules`.

Hence when Serverless creates the archive, it will follow the symlinks and all
dependencies will be added as expected. Development/peer dependencies are ignored.

The plugin will run when you do:
- A full deployment (`sls deploy`)
- Deployment of individual functions (`sls deploy -f`)
- Spinning up a local sandbox with [serverless-offline](https://github.com/dherault/serverless-offline) (`sls offline [start]`)

## Contributing

We welcome issue reports and pull requests!

There is a small `run` script which will launch Node V8 in a Docker container which
you may find useful for development purposes.

Note we are using [StandardJS](https://standardjs.com/) and you can run
the lint tool via `yarn lint` which will attempt to automatically issues like spacing etc.

## Copyright

Copyright [Butterwire Limited](https://www.butterwire.com) 2018

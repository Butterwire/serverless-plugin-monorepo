# serverless-plugin-monorepo

[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![NPM Package](https://img.shields.io/npm/v/serverless-plugin-monorepo.svg)](https://www.npmjs.com/package/serverless-plugin-monorepo)

A Serverless plugin design to make it possible to use Serverless in a
Javascript mono repo with hoisted dependencies, e.g. when using [Yarn Workspaces](https://yarnpkg.com/lang/en/docs/workspaces/).

This plugin alleviates the need to use [nohoist](https://yarnpkg.com/blog/2018/02/15/nohoist/) functionality by creating
symlinks to all declared dependencies. Development dependencies are deliberately NOT linked so these
will not be packaged into the resulting archive.

[Butterwire](https://www.butterwire.com) uses Yarn workspaces and we created this plugin to improve our development
experience. Not using nohoist saves wasting disk space and also accidentally including
development dependencies in our packaged functions.

_Note, this package will only work on operating systems that support symbolic links!_

## Installation

```
yarn add --dev serverless-plugin-monorepo
# or using NPM
npm install --dev serverless-plugin-monorepo
```

Currently this plugin requires Node V10+. If there is interest in support older
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

Optionally, you can add a custom configuration to point to one or many directories containing package.json files which you would like to have symlinks created in.
For example:

```
custom:
  serverlessMonoRepo:
    path: ./
    linkType: junction
```

`linkType` is optional and defaults to `junction`.

If you have multiple `package.json` files, which is common when using the `serverless-plugin-layer-manager` plugin, you can create a list of paths:

```
custom:
  serverlessMonoRepo:
    - path: ./lambda-layer/
      linkType: junction
    - path: ./lambda-layer-2/
```

Hence when Serverless creates the archive, it will follow the symlinks and all
dependencies will be added as expected. Development/peer dependencies are ignored.

The plugin will run when you do:

- A full deployment (`sls deploy`)
- Deployment of individual functions (`sls deploy -f`)
- Spinning up a local sandbox with [serverless-offline](https://github.com/dherault/serverless-offline) (`sls offline [start]`)

## Settings

On Windows platforms only, the package will create [junction links](https://docs.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions) by default as these do not require administrative privileges on older versions of Windows.
You can set the `linkType` setting to `dir` to create symbolic links instead. This setting is directly passed to the [fs.symlink](https://nodejs.org/docs/latest/api/fs.html#fs_fs_symlink_target_path_type_callback) function. It is ignored on non Windows platforms.

## Contributing

We welcome issue reports and pull requests!

There is a small `run` script which will launch Node V14 in a Docker container which
you may find useful for development purposes.

Note we are using [Prettier](https://prettier.io/) with [Typescript ESLint](https://github.com/typescript-eslint/typescript-eslint) and you can run
the lint tool via `yarn lint` which will attempt to automatically issues like spacing etc.

## Copyright

Copyright [Butterwire Limited](https://www.butterwire.com) 2018 - 2020

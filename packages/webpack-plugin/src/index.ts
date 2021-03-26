import path from 'path';
import type { Compiler, RuleSetRule } from 'webpack';
import chalk from 'chalk';

import { ChildCompiler } from './compiler';
import createCompat, { WebpackCompat } from './compat';

const pluginName = 'treat-webpack-plugin';

const resolvedFileScopeModule = path.dirname(
  require.resolve('@mattsjones/css-core/fileScope/package.json'),
);

const resolvedCoreModule = path.dirname(
  require.resolve('@mattsjones/css-core/package.json'),
);

function markCSSFilesAsSideEffects(compiler: Compiler, compat: WebpackCompat) {
  compiler.hooks.normalModuleFactory.tap(pluginName, (nmf) => {
    if (compat.isWebpack5) {
      nmf.hooks.createModule.tap(
        pluginName,
        // @ts-expect-error CreateData is typed as 'object'...
        (createData: {
          matchResource?: string;
          settings: { sideEffects?: boolean };
        }) => {
          if (
            createData.matchResource &&
            createData.matchResource.endsWith('.vanilla.css')
          ) {
            createData.settings.sideEffects = true;
          }
        },
      );
    } else {
      nmf.hooks.afterResolve.tap(
        pluginName,
        // @ts-expect-error Can't be typesafe for webpack 4
        (result: {
          matchResource?: string;
          settings: { sideEffects?: boolean };
        }) => {
          if (
            result.matchResource &&
            result.matchResource.endsWith('.vanilla.css')
          ) {
            result.settings.sideEffects = true;
          }
        },
      );
    }
  });
}

interface PluginOptions {
  test?: RuleSetRule['test'];
  outputCss?: boolean;
  externals?: any;
  allowRuntime?: boolean;
}
export class TreatPlugin {
  test: RuleSetRule['test'];
  outputCss: boolean;
  allowRuntime: boolean;
  childCompiler: ChildCompiler;

  constructor(options: PluginOptions = {}) {
    const {
      test = /\.css\.(js|ts|jsx|tsx)$/,
      outputCss = true,
      externals,
      allowRuntime = false,
    } = options;

    this.test = test;
    this.outputCss = outputCss;
    this.allowRuntime = allowRuntime;
    this.childCompiler = new ChildCompiler(externals);
  }

  apply(compiler: Compiler) {
    const compat = createCompat(
      Boolean(compiler.webpack && compiler.webpack.version),
    );

    compiler.hooks.watchRun.tap(pluginName, () => {
      this.childCompiler.clearCache();
    });

    if (!compiler.parentCompilation && !this.allowRuntime) {
      compiler.hooks.compilation.tap(pluginName, (compilation) => {
        compilation.hooks.afterOptimizeModules.tap(pluginName, (modules) => {
          for (const module of modules) {
            if (
              // Use the presence of the `fileScope` module as the indicator that the runtime has been loaded
              module.context?.startsWith(resolvedFileScopeModule)
            ) {
              const dependentResources = new Set<string>();

              if (compat.isWebpack5) {
                for (const con of compilation.moduleGraph.getIncomingConnections(
                  module,
                )) {
                  // @ts-expect-error resource should exist on module
                  const originResource = con.originModule.resource || '';

                  if (!originResource.startsWith(resolvedCoreModule)) {
                    dependentResources.add(originResource);
                  }
                }
              }

              let errorMessage = chalk.red(
                `VanillaExtractPlugin: Styles detected outside of '.css.(ts/js)' files. You probably don't want this as these styles can't be statically extracted. If this is the desired behaviour, set 'allowRuntime: true'.`,
              );

              if (dependentResources.size > 0) {
                errorMessage += '\n\nOffending files:\n';
                errorMessage += Array.from(dependentResources)
                  .map(
                    (res) =>
                      `- ${chalk.yellow(path.relative(compiler.context, res))}`,
                  )
                  .join('\n');
              }

              throw new Error(errorMessage);
            }
          }
        });
      });
    }

    markCSSFilesAsSideEffects(compiler, compat);

    compiler.options.module?.rules.splice(0, 0, {
      test: this.test,
      use: [
        {
          loader: require.resolve('@mattsjones/css-webpack-plugin/loader'),
          options: {
            outputCss: this.outputCss,
            childCompiler: this.childCompiler,
          },
        },
      ],
    });
  }
}

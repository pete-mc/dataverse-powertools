/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-var-requires */
const Webpack = require("webpack");
const Path = require("path");

module.exports = {
  entry: "./webresources_src/library.ts",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        // Build against tsconfig.build.json (types:[] + tests excluded) so the production bundle
        // does not type-check Jest tests or require @types/jest to be in the LOCAL node_modules —
        // it isn't when the project sits inside another node project / a workspace / pnpm layout,
        // where @types/jest hoists to a parent node_modules the explicit typeRoots can't see. The
        // generated XRM typings still load (they're regular .d.ts in the program, not `types`).
        use: { loader: "ts-loader", options: { configFile: Path.resolve(__dirname, "tsconfig.build.json") } },
        exclude: /node_modules/,
      },
      {
        test: require.resolve("./webresources_src/lib/dg.xrmquery.web.min"),
        loader: "exports-loader",
        options: {
          exports: ["XrmQuery", "Filter", "XQW"],
        },
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: "SOLUTIONPREFIX_library.js",
    library: ["SOLUTIONPREFIX"], //used to call functions on forms eg: LIBRARYPREFIX.Class.Function
    libraryTarget: "var",
  },
  plugins: [
    new Webpack.ProvidePlugin({
      XrmQuery: [Path.resolve(__dirname, "./webresources_src/lib/dg.xrmquery.web.min"), "XrmQuery"],
      Filter: [Path.resolve(__dirname, "./webresources_src/lib/dg.xrmquery.web.min"), "Filter"],
      XQW: [Path.resolve(__dirname, "./webresources_src/lib/dg.xrmquery.web.min"), "XQW"],
    }),
  ],
};

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
        use: "ts-loader",
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

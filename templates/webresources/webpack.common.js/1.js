module.exports = {
  entry: "./src/library.ts",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: "PREFIX_library.js",
    library: ["PREFIX"], //used to call functions on forms eg: PREFIX.Class.Function
    libraryTarget: "var",
  },
};

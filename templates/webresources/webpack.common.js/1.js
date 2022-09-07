module.exports = {
    entry: "./webresources_src/library.ts",
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
        filename: "SOLUTIONPREFIX_library.js",
        library: ["SOLUTIONPREFIX"], //used to call functions on forms eg: LIBRARYPREFIX.Class.Function
        libraryTarget: "var",
    },
};

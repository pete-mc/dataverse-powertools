module.exports = {
  preset: "ts-jest",
  testMatch: ["**/__tests__/**/*.ts"],
  globals: {
    "ts-jest": {
      tsconfig: "tsconfig.json",
    },
  },
};

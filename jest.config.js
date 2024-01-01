// jest.config.js
module.exports = {
    type: 'module',
    testEnvironment: 'node',
    preset: 'ts-jest',
    verbose: true, // report individual test
    bail: false, // enable to stop test when an error occur,
    detectOpenHandles: true,
    moduleDirectories: ['node_modules', 'src', 'test'],
    transform: {
        '^.+\\.tsx?$': 'babel-jest',
      },
    // Other Jest configuration options...
  };
  
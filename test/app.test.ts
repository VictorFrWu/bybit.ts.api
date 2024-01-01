// app.test.ts

import {add} from "../src/app";

test('add function should add two numbers correctly', () => {
  expect(add(3, 5)).toBe(8);
});

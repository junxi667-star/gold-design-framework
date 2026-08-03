import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, functionSelector } from "../backend/keccak.js";

test("keccak256 matches Ethereum known vectors", () => {
  assert.equal(keccak256(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256("abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal(functionSelector("registerVersion(bytes32,bytes32,bytes32,string)"), "0x6258b181");
});

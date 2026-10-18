import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../src/cli.js";

test("parses directory, port, host, and browser options", () => {
  const options = parseArguments([
    "./docs",
    "--port",
    "8080",
    "--host",
    "127.0.0.1",
    "--no-open",
  ]);

  assert.equal(options.directory, "./docs");
  assert.equal(options.port, 8080);
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.open, false);
  assert.equal(options.token, "");
});

test("automatically creates a token for a non-loopback host", () => {
  const options = parseArguments(["./notes", "--host", "0.0.0.0"]);

  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.tokenRequested, true);
  assert.match(options.token, /^[A-Za-z0-9_-]{20,}$/);
});

test("accepts explicit and inline tokens", () => {
  assert.equal(parseArguments(["--token", "secret"]).token, "secret");
  assert.equal(parseArguments(["--token=another-secret"]).token, "another-secret");
});

test("rejects invalid ports and multiple directories", () => {
  assert.throws(() => parseArguments(["--port", "70000"]), /Port must be/);
  assert.throws(() => parseArguments(["one", "two"]), /Only one document directory/);
});

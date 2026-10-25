import test from "node:test";
import assert from "node:assert/strict";

import { parseIpv4, parseIpv6, isBlockedIp, validateReplayTarget, SsrfError } from "../worker/ssrf.js";

test("parseIpv4 accepts dotted, decimal, hex and octal forms", () => {
  assert.deepEqual(parseIpv4("127.0.0.1"), [127, 0, 0, 1]);
  assert.deepEqual(parseIpv4("2130706433"), [127, 0, 0, 1]);
  assert.deepEqual(parseIpv4("0x7f.0.0.1"), [127, 0, 0, 1]);
  assert.deepEqual(parseIpv4("0177.0.0.1"), [127, 0, 0, 1]);
  assert.deepEqual(parseIpv4("169.254.169.254"), [169, 254, 169, 254]);
  assert.equal(parseIpv4("example.com"), null);
  assert.equal(parseIpv4("1.2.3.4.5"), null);
  assert.equal(parseIpv4("256.1.1.1"), null);
});

test("parseIpv6 expands compressed and embedded-IPv4 literals", () => {
  assert.deepEqual(parseIpv6("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseIpv6("::"), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(parseIpv6("::ffff:127.0.0.1"), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
  assert.deepEqual(parseIpv6("2606:4700:3037::ac43:d928"), [
    0x2606, 0x4700, 0x3037, 0, 0, 0, 0xac43, 0xd928,
  ]);
  assert.equal(parseIpv6("1:2:3:4:5:6:7:8:9"), null);
  assert.equal(parseIpv6("not-an-ip"), null);
});

test("isBlockedIp rejects private, loopback, link-local and metadata ranges", () => {
  const blocked = [
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "not-an-ip",
  ];
  for (const ip of blocked) assert.equal(isBlockedIp(ip), true, `${ip} must be blocked`);
});

test("isBlockedIp allows public addresses", () => {
  const allowed = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "172.32.0.1"];
  for (const ip of allowed) assert.equal(isBlockedIp(ip), false, `${ip} must be allowed`);
});

test("validateReplayTarget rejects non-http(s) and credentialed URLs", () => {
  assert.throws(() => validateReplayTarget("file:///etc/passwd", {}), SsrfError);
  assert.throws(() => validateReplayTarget("ftp://example.com/x", {}), SsrfError);
  assert.throws(() => validateReplayTarget("https://user:pass@example.com/x", {}), SsrfError);
  assert.throws(() => validateReplayTarget("not a url", {}), SsrfError);
});

test("validateReplayTarget blocks metadata, loopback and internal zones", () => {
  const cases = [
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://localhost:8080/",
    "http://app.internal/",
    "http://printer.local/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://10.0.0.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://intranet/",
  ];
  for (const target of cases) {
    assert.throws(() => validateReplayTarget(target, {}), SsrfError, `${target} must be rejected`);
  }
});

test("validateReplayTarget rejects unusual ports", () => {
  assert.throws(() => validateReplayTarget("https://example.com:22/", {}), SsrfError);
  assert.throws(() => validateReplayTarget("https://example.com:6379/", {}), SsrfError);
  assert.doesNotThrow(() => validateReplayTarget("https://example.com/", {}));
  assert.doesNotThrow(() => validateReplayTarget("http://example.com:8080/hook", {}));
});

test("ALLOWED_REPLAY_HOSTS allow-list is enforced", () => {
  assert.throws(
    () => validateReplayTarget("https://evil.example.org/x", { ALLOWED_REPLAY_HOSTS: "mycompany.io" }),
    SsrfError,
  );
  assert.doesNotThrow(() => validateReplayTarget("https://hooks.mycompany.io/x", { ALLOWED_REPLAY_HOSTS: "mycompany.io" }));
  assert.doesNotThrow(() =>
    validateReplayTarget("https://api.hooks.mycompany.io/x", { ALLOWED_REPLAY_HOSTS: "mycompany.io" }),
  );
});

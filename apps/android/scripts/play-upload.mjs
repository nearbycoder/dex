#!/usr/bin/env node
// Uploads an App Bundle to a Google Play testing track with the Play Developer API (androidpublisher v3), signed in as
// a service account: one edit that uploads the bundle (and R8's mapping, for readable crash reports), puts it on the
// track, and commits. Run by scripts/play-internal.sh; no dependencies beyond Node.
import { createSign } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    "service-account": { type: "string" },
    package: { type: "string" },
    bundle: { type: "string" },
    mapping: { type: "string" },
    track: { type: "string", default: "internal" },
    name: { type: "string" },
    notes: { type: "string", default: "" }
  }
})
for (const required of ["service-account", "package", "bundle"]) {
  if (!args[required]) throw new Error(`--${required} is required`)
}

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3"
const UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3"

/** An access token for the service account (OAuth 2.0 JWT bearer grant). */
async function accessToken(keyFile) {
  const key = JSON.parse(readFileSync(keyFile, "utf8"))
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: key.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  })}`
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url")
  const response = await fetch(key.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` })
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`Google sign-in failed for ${key.client_email}: ${body.error_description ?? body.error}`)
  return body.access_token
}

const token = await accessToken(args["service-account"])
const app = `applications/${encodeURIComponent(args.package)}`

async function call(method, url, body, contentType = "application/json") {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": contentType }) },
    body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : body
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const error = new Error(json.error?.message ?? `${method} ${url} failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return json
}

const edit = await call("POST", `${API}/${app}/edits`, {})
const editUrl = `${API}/${app}/edits/${edit.id}`
try {
  const bundle = await call("POST", `${UPLOAD_API}/${app}/edits/${edit.id}/bundles?uploadType=media`, readFileSync(args.bundle), "application/octet-stream")
  const versionCode = bundle.versionCode
  console.log(`  uploaded bundle ${versionCode}`)

  if (args.mapping && existsSync(args.mapping)) {
    await call(
      "POST",
      `${UPLOAD_API}/${app}/edits/${edit.id}/apks/${versionCode}/deobfuscationFiles/proguard?uploadType=media`,
      readFileSync(args.mapping),
      "application/octet-stream"
    ).then(
      () => console.log("  uploaded R8 mapping"),
      (error) => console.warn(`  (R8 mapping not uploaded: ${error.message})`)
    )
  }

  const release = (status) => ({
    track: args.track,
    releases: [
      {
        name: args.name ?? String(versionCode),
        versionCodes: [String(versionCode)],
        status,
        ...(args.notes ? { releaseNotes: [{ language: "en-US", text: args.notes.slice(0, 500) }] } : {})
      }
    ]
  })
  let status = "completed"
  try {
    await call("PUT", `${editUrl}/tracks/${args.track}`, release(status))
  } catch (error) {
    // Until the app's store listing is set up and it's been sent for review once, Play takes only draft releases.
    if (!/draft/i.test(error.message)) throw error
    status = "draft"
    await call("PUT", `${editUrl}/tracks/${args.track}`, release(status))
  }
  await call("POST", `${editUrl}:commit`)
  console.log(
    status === "completed"
      ? `✓ Released ${versionCode} to ${args.track} testers. Play processes it for a few minutes before the Play Store offers it.`
      : `✓ Uploaded ${versionCode} to ${args.track} as a draft: Play takes only drafts until the app is set up in Play Console. Roll it out there (Testing → ${args.track === "internal" ? "Internal testing" : args.track}).`
  )
} catch (error) {
  await call("DELETE", editUrl).catch(() => undefined)
  console.error(`✗ ${error.message}`)
  process.exit(1)
}

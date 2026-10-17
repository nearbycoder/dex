/**
 * Stands in for `react-syntax-highlighter` (aliased in vite.config.ts) when OpenUI renders code blocks. The package
 * root bundles every Prism language (~750 KB); this light build registers the common ones, and anything else is
 * shown as plain text.
 */
import PrismLight from "react-syntax-highlighter/dist/esm/prism-light"
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash"
import c from "react-syntax-highlighter/dist/esm/languages/prism/c"
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp"
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp"
import css from "react-syntax-highlighter/dist/esm/languages/prism/css"
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff"
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker"
import go from "react-syntax-highlighter/dist/esm/languages/prism/go"
import java from "react-syntax-highlighter/dist/esm/languages/prism/java"
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript"
import json from "react-syntax-highlighter/dist/esm/languages/prism/json"
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx"
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin"
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown"
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup"
import php from "react-syntax-highlighter/dist/esm/languages/prism/php"
import python from "react-syntax-highlighter/dist/esm/languages/prism/python"
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby"
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust"
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql"
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift"
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml"
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx"
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript"
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml"

const languages: Record<string, unknown> = {
  bash, sh: bash, shell: bash, zsh: bash, c, cpp, csharp, cs: csharp, css, diff, docker, dockerfile: docker, go, java,
  javascript, js: javascript, json, jsx, kotlin, markdown, md: markdown, markup, html: markup, xml: markup, svg: markup,
  php, python, py: python, ruby, rb: ruby, rust, rs: rust, sql, swift, toml, tsx, typescript, ts: typescript, yaml, yml: yaml
}
for (const [name, grammar] of Object.entries(languages)) PrismLight.registerLanguage(name, grammar)

export const Prism = PrismLight
export default PrismLight

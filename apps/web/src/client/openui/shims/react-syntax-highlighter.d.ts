// Untyped deep imports used by the light highlighter shim.
declare module "react-syntax-highlighter/dist/esm/prism-light" {
  const PrismLight: { registerLanguage(name: string, grammar: unknown): void } & ((props: Record<string, unknown>) => unknown)
  export default PrismLight
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/*" {
  const grammar: unknown
  export default grammar
}
declare module "react-syntax-highlighter/dist/esm/styles/prism/*" {
  const style: Record<string, Record<string, string>>
  export default style
}

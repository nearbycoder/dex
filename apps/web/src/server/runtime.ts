import { Layer, ManagedRuntime } from "effect"
import { AppConfig, envConfigProvider } from "./config"
import { Keys } from "./crypto"
import { GitHubOAuth } from "./github"
import { Sessions } from "./session"

export const ServerLayer = (env: object) =>
  Layer.mergeAll(Sessions.layer, GitHubOAuth.layer, Keys.layer).pipe(
    Layer.provideMerge(Keys.layer),
    Layer.provideMerge(AppConfig.layer),
    Layer.provide(envConfigProvider(env))
  )

const runtimes = new WeakMap<object, ManagedRuntime.ManagedRuntime<Layer.Success<ReturnType<typeof ServerLayer>>, Layer.Error<ReturnType<typeof ServerLayer>>>>()

/** One runtime per Worker `env`; services are built once per isolate. */
export const serverRuntime = (env: object) => {
  let runtime = runtimes.get(env)
  if (!runtime) {
    runtime = ManagedRuntime.make(ServerLayer(env))
    runtimes.set(env, runtime)
  }
  return runtime
}

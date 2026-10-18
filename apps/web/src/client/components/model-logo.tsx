import { findModel, MODEL_MAKERS } from "~/shared/models"

/** The maker's logo for a model id, e.g. the Kimi mark for Kimi K3. */
export function ModelLogo({ modelId, className = "size-4" }: { modelId: string; className?: string }) {
  const model = findModel(modelId)
  if (!model) return null
  const maker = MODEL_MAKERS[model.maker]
  return <img src={maker.logo} alt={maker.name} title={maker.name} className={`shrink-0 object-contain ${className}`} />
}

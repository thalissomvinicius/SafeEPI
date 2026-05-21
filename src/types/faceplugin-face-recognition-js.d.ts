declare module "faceplugin-face-recognition-js" {
  type FacepluginSource = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | string

  export function load_opencv(): Promise<void>
  export function loadDetectionModel(): Promise<unknown>
  export function loadLandmarkModel(): Promise<unknown>
  export function loadFeatureModel(): Promise<unknown>
  export function loadLivenessModel(): Promise<unknown>
  export function loadPoseModel(): Promise<unknown>
  export function detectFace(session: unknown, source: FacepluginSource): Promise<unknown>
  export function predictLandmark(session: unknown, source: FacepluginSource, bbox: unknown): Promise<unknown>
  export function predictLiveness(session: unknown, source: FacepluginSource, bbox: unknown): Promise<unknown>
  export function predictPose(session: unknown, source: FacepluginSource, bbox: unknown): Promise<unknown>
  export function extractFeature(session: unknown, source: FacepluginSource, landmarks: unknown): Promise<unknown>
}

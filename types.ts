
export interface RelatedLandmark {
  name: string;
  reason: string;
}

export interface LandmarkInfo {
  name: string;
  description: string;
  location?: string;
  latitude?: number;
  longitude?: number;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface LandmarkResult {
  id: string;
  info: LandmarkInfo;
  history: string;
  sources: GroundingSource[];
  imageUrl: string;
  timestamp: number;
  relatedLandmarks?: RelatedLandmark[];
  audioBase64?: string; // For offline narration playback
}

export enum AppState {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  IDENTIFYING = 'IDENTIFYING',
  SEARCHING = 'SEARCHING',
  RESULT = 'RESULT',
  ERROR = 'ERROR',
  HISTORY = 'HISTORY',
  MAP = 'MAP'
}


import React, { useEffect, useState, useRef } from 'react';
import { 
  Play, Pause, ChevronLeft, MapPin, 
  ExternalLink, RefreshCcw, Share2, ThumbsUp, ThumbsDown, 
  Sparkles, ChevronDown, ChevronUp, Twitter, Facebook, Copy,
  Type as TypeIcon, Compass, Gauge, Box, Eye, SkipBack, SkipForward,
  Info, Target, History as HistoryIcon, BookOpen
} from 'lucide-react';
import { LandmarkResult, RelatedLandmark } from '../types';
import { generateNarration, generateLandmarkImage } from '../services/gemini';
import { decodeBase64, decodeAudioData } from '../utils/audio';

interface NarratedExperienceProps {
  result: LandmarkResult;
  onBack: () => void;
  onExploreRelated?: (name: string) => void;
  onUpdateCache?: (audioBase64: string) => void;
}

interface HistorySection {
  title: string;
  content: string;
}

interface ARFactNode {
  id: string;
  year: string;
  text: string;
  x: number;
  y: number;
  z: number;
}

type FontSize = 'small' | 'medium' | 'large';
type PlaybackSpeed = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;

export const NarratedExperience: React.FC<NarratedExperienceProps> = ({ result, onBack, onExploreRelated, onUpdateCache }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isGeneratingImg, setIsGeneratingImg] = useState(false);
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({ 0: true });
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [parallaxOffset, setParallaxOffset] = useState(0);
  
  // AR Mode States
  const [isARMode, setIsARMode] = useState(() => {
    return localStorage.getItem(`ar_active_${result.id}`) === 'true';
  });
  const [selectedARFact, setSelectedARFact] = useState<ARFactNode | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const offsetRef = useRef<number>(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const animationFrameRef = useRef<number>(null);

  // Extract dates and key sentences for AR nodes
  const arFactNodes: ARFactNode[] = React.useMemo(() => {
    const nodes: ARFactNode[] = [];
    const yearRegex = /\b(1\d{3}|20\d{2})\b/g;
    const sentences = result.history.split(/[.!?]\s+/);
    
    sentences.forEach((s, idx) => {
      const match = s.match(yearRegex);
      if (match && nodes.length < 5) {
        nodes.push({
          id: `fact-${idx}`,
          year: match[0],
          text: s.trim().substring(0, 120) + (s.length > 120 ? '...' : ''),
          // Randomized but stable spatial positioning
          x: (Math.random() - 0.5) * 60,
          y: (Math.random() - 0.5) * 40,
          z: Math.random() * -100 - 50
        });
      }
    });
    return nodes;
  }, [result.history]);

  // Load existing feedback
  useEffect(() => {
    const savedFeedback = localStorage.getItem(`feedback_${result.id}`);
    if (savedFeedback === 'up' || savedFeedback === 'down') {
      setFeedback(savedFeedback);
    }
  }, [result.id]);

  const handleFeedback = (type: 'up' | 'down') => {
    const newFeedback = feedback === type ? null : type;
    setFeedback(newFeedback);
    if (newFeedback) {
      localStorage.setItem(`feedback_${result.id}`, newFeedback);
    } else {
      localStorage.removeItem(`feedback_${result.id}`);
    }
  };

  // Toggle AR Mode
  const toggleAR = async () => {
    const newState = !isARMode;
    setIsARMode(newState);
    localStorage.setItem(`ar_active_${result.id}`, String(newState));

    if (newState) {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
        setStream(mediaStream);
      } catch (err) {
        console.error("Camera access failed", err);
        setIsARMode(false);
        localStorage.removeItem(`ar_active_${result.id}`);
        alert("Camera access is required for AR mode. Please ensure permissions are granted.");
      }
    } else {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
    }
  };

  // Initialize camera if starting in AR mode
  useEffect(() => {
    if (isARMode && !stream) {
      toggleAR();
    }
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, isARMode]);

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  const sections: HistorySection[] = React.useMemo(() => {
    const raw = result.history.split(/##\s+/);
    const parsed: HistorySection[] = [];
    
    if (raw[0].trim()) {
      const lines = raw[0].trim().split('\n');
      const introTitle = lines[0].length < 30 ? lines[0] : "Introduction";
      parsed.push({
        title: introTitle,
        content: raw[0].trim()
      });
    }

    for (let i = 1; i < raw.length; i++) {
      const lines = raw[i].split('\n');
      const title = lines[0].trim();
      const content = lines.slice(1).join('\n').trim();
      parsed.push({ title, content });
    }
    return parsed;
  }, [result.history]);

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const handleScroll = () => {
    if (sidebarRef.current) {
      const scroll = sidebarRef.current.scrollTop;
      setParallaxOffset(scroll * 0.2);
    }
  };

  useEffect(() => {
    const fetchNarration = async () => {
      if (result.audioBase64) {
        try {
          const bytes = decodeBase64(result.audioBase64);
          if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          }
          const audioBuffer = await decodeAudioData(bytes, audioContextRef.current);
          audioBufferRef.current = audioBuffer;
          setDuration(audioBuffer.duration);
          playFromOffset(0);
          return;
        } catch (e) {
          console.error("Failed to load cached audio", e);
        }
      }

      if (!navigator.onLine) return;

      setIsLoadingAudio(true);
      try {
        const base64 = await generateNarration(result.history);
        const bytes = decodeBase64(base64);
        
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const audioBuffer = await decodeAudioData(bytes, audioContextRef.current);
        audioBufferRef.current = audioBuffer;
        setDuration(audioBuffer.duration);
        
        if (onUpdateCache) onUpdateCache(base64);
        
        playFromOffset(0);
      } catch (err) {
        console.error("Narration failed", err);
      } finally {
        setIsLoadingAudio(false);
      }
    };

    fetchNarration();

    return () => {
      stopPlayback();
      if (audioContextRef.current) audioContextRef.current.close();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [result.history, result.id]);

  const updateProgress = () => {
    if (isPlaying && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      const elapsed = (now - startTimeRef.current) * playbackSpeed;
      const current = elapsed + offsetRef.current;
      setCurrentTime(current);
      
      if (current >= duration) {
        setIsPlaying(false);
        setCurrentTime(duration);
        return;
      }
    }
    animationFrameRef.current = requestAnimationFrame(updateProgress);
  };

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(updateProgress);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, duration, playbackSpeed]);

  const playFromOffset = (offset: number) => {
    if (!audioBufferRef.current || !audioContextRef.current) return;
    
    stopPlayback();
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBufferRef.current;
    source.playbackRate.value = playbackSpeed;
    source.connect(audioContextRef.current.destination);
    
    offsetRef.current = Math.max(0, Math.min(offset, duration));
    startTimeRef.current = audioContextRef.current.currentTime;
    
    source.start(0, offsetRef.current);
    sourceNodeRef.current = source;
    setIsPlaying(true);
    setCurrentTime(offsetRef.current);
  };

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e) {}
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const togglePlayback = () => {
    if (isPlaying) {
      offsetRef.current = currentTime;
      stopPlayback();
    } else {
      if (currentTime >= duration) {
        playFromOffset(0);
      } else {
        playFromOffset(currentTime);
      }
    }
  };

  const skip = (seconds: number) => {
    const newTime = Math.max(0, Math.min(currentTime + seconds, duration));
    if (isPlaying) {
      playFromOffset(newTime);
    } else {
      offsetRef.current = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (isPlaying) {
      playFromOffset(newTime);
    } else {
      offsetRef.current = newTime;
    }
  };

  const changePlaybackSpeed = (speed: PlaybackSpeed) => {
    if (playbackSpeed === speed) return;
    const now = audioContextRef.current?.currentTime || 0;
    offsetRef.current = currentTime;
    startTimeRef.current = now;
    setPlaybackSpeed(speed);
    if (isPlaying && sourceNodeRef.current) {
      sourceNodeRef.current.playbackRate.value = speed;
    }
  };

  const handleGenerateImage = async () => {
    setIsGeneratingImg(true);
    try {
      const url = await generateLandmarkImage(result.info.name);
      setAiImageUrl(url);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingImg(false);
    }
  };

  const shareViaPlatform = (platform: string) => {
    const text = `Discovering history with LuminaTour: ${result.info.name}`;
    const url = window.location.href;
    let shareUrl = "";

    switch (platform) {
      case 'twitter': shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`; break;
      case 'facebook': shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`; break;
      case 'copy':
        navigator.clipboard.writeText(`${text} - ${url}`);
        alert("Link copied!");
        return;
    }
    if (shareUrl) window.open(shareUrl, '_blank');
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getFontSizeClass = () => {
    switch (fontSize) {
      case 'small': return 'text-[13px]';
      case 'large': return 'text-[18px]';
      default: return 'text-[15px]';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col md:flex-row overflow-hidden animate-in fade-in duration-500" role="main">
      <style>{`
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.4); }
        }
        @keyframes idle-shimmer {
          0%, 100% { opacity: 0.1; }
          50% { opacity: 0.3; }
        }
        .animate-pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
        .animate-idle-shimmer { animation: idle-shimmer 3s ease-in-out infinite; }
      `}</style>

      {/* Visual Component Area */}
      <div className="relative flex-1 h-[40vh] md:h-full bg-zinc-900 group overflow-hidden">
        {isARMode ? (
          <div className="absolute inset-0 bg-black overflow-hidden">
            <video 
              ref={videoRef}
              autoPlay 
              playsInline 
              muted 
              className="absolute inset-0 w-full h-full object-cover opacity-80"
            />
            
            {/* AR SPATIAL SCENE */}
            <div 
              className="absolute inset-0 pointer-events-none"
              style={{ perspective: '1200px', transformStyle: 'preserve-3d' }}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40" />
              
              {/* Feature Lock Tracker (Center) */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border border-amber-500/20 rounded-full flex items-center justify-center animate-pulse">
                <div className="absolute inset-0 border-t border-b border-amber-500/40 rounded-full animate-spin duration-[8s]" />
                <div className="absolute w-12 h-12 border-2 border-amber-500/60 rounded-sm rotate-45 animate-ping opacity-30" />
                <Target size={24} className="text-amber-500 opacity-60" />
                
                {/* HUD Label for Locked Landmark */}
                <div className="absolute top-full mt-4 bg-amber-500/90 text-black px-4 py-1.5 rounded-full font-black text-[10px] uppercase tracking-tighter shadow-2xl animate-in zoom-in-95">
                  LOCKED: {result.info.name}
                </div>
              </div>

              {/* Spatial Nodes Container */}
              <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
                <div className="absolute bottom-0 w-full h-24 bg-gradient-to-t from-amber-500/5 to-transparent border-t border-amber-500/10" style={{ transform: 'rotateX(80deg) translateZ(-50px)' }} />

                {arFactNodes.map((node) => {
                  const isSelected = selectedARFact?.id === node.id;
                  const noneSelected = !selectedARFact;
                  return (
                    <div 
                      key={node.id}
                      className="absolute pointer-events-auto cursor-pointer group/node"
                      style={{
                        left: `calc(50% + ${node.x}%)`,
                        top: `calc(50% + ${node.y}%)`,
                        transform: `translateZ(${node.z}px) translate(-50%, -50%)`,
                        transformStyle: 'preserve-3d'
                      }}
                      onClick={() => setSelectedARFact(node)}
                    >
                      <div className={`relative transition-all duration-300 ${isSelected ? 'scale-110' : 'hover:scale-105'}`}>
                        {/* Connector Line */}
                        <div className={`w-0.5 h-16 bg-gradient-to-t from-amber-500 to-transparent mx-auto transition-opacity ${isSelected ? 'opacity-100' : 'opacity-40 group-hover/node:opacity-100'}`} />
                        
                        {/* Floating Card */}
                        <div className={`p-4 rounded-2xl backdrop-blur-xl border transition-all duration-500 flex flex-col items-center gap-1 shadow-2xl w-40 text-center
                          ${isSelected 
                            ? 'bg-amber-500 border-amber-400 scale-110 shadow-amber-500/30' 
                            : 'bg-black/60 border-white/20 group-hover/node:border-amber-500/50'}`}
                        >
                           <HistoryIcon size={14} className={isSelected ? 'text-black' : 'text-amber-500'} />
                           <span className={`text-[11px] font-black tracking-widest ${isSelected ? 'text-black' : 'text-zinc-100'}`}>
                             ERA: {node.year}
                           </span>
                           <div className={`w-8 h-1 rounded-full mb-1 ${isSelected ? 'bg-black/20' : 'bg-amber-500/30'}`} />
                           <p className={`text-[9px] font-medium leading-tight line-clamp-2 ${isSelected ? 'text-black/80' : 'text-zinc-400'}`}>
                             {node.text}
                           </p>
                        </div>
                        
                        {/* Highlight / Pulse Glow Effects */}
                        <div className={`absolute -inset-2 bg-amber-500 blur-2xl rounded-full transition-opacity pointer-events-none
                          ${isSelected ? 'opacity-40 animate-pulse-glow' : 'opacity-0 group-hover/node:opacity-20'}
                          ${noneSelected ? 'animate-idle-shimmer' : ''}
                        `} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Live HUD Readouts */}
              <div className="absolute top-10 left-10 space-y-2 pointer-events-none">
                 <div className="flex items-center gap-2 text-zinc-500 font-mono text-[10px] tracking-widest bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/5">
                    <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                    SYSTEM: ANALYSIS_ACTIVE
                 </div>
                 <div className="flex flex-col gap-1 text-[9px] font-mono text-amber-500/60 pl-3">
                    <span>X_COORD: {(Math.random() * 100).toFixed(4)}</span>
                    <span>Y_COORD: {(Math.random() * 100).toFixed(4)}</span>
                    <span>DEPTH: SPATIAL_LOCK_STABLE</span>
                 </div>
              </div>
            </div>

            {/* Selected Fact Detailed Pop-up */}
            {selectedARFact && (
              <div className="absolute inset-0 flex items-center justify-center p-8 bg-black/40 backdrop-blur-sm z-50 animate-in fade-in duration-300">
                 <div className="bg-zinc-900 border border-amber-500/30 rounded-3xl p-8 max-w-md w-full shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-amber-500 animate-pulse" />
                    <button 
                      onClick={() => setSelectedARFact(null)}
                      className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-white transition-colors"
                    >
                      <X size={20} />
                    </button>
                    <div className="flex items-center gap-3 mb-6">
                       <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                          <BookOpen className="text-black" />
                       </div>
                       <div>
                          <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Historical Date</p>
                          <h4 className="text-2xl font-serif text-white">The Year {selectedARFact.year}</h4>
                       </div>
                    </div>
                    <p className="text-zinc-300 text-sm leading-relaxed italic mb-8 border-l-2 border-amber-500/30 pl-4">
                       {selectedARFact.text}
                    </p>
                    <button 
                      onClick={() => setSelectedARFact(null)}
                      className="w-full py-3 bg-amber-500 text-black font-black uppercase text-xs tracking-widest rounded-xl hover:bg-amber-400 transition-colors"
                    >
                      Resume Scan
                    </button>
                 </div>
              </div>
            )}
          </div>
        ) : (
          <div 
            className="absolute inset-0 w-full h-full"
            style={{ transform: `translateY(${parallaxOffset}px)` }}
          >
            <img 
              src={aiImageUrl || result.imageUrl} 
              className={`absolute inset-0 w-full h-full object-cover scale-110 blur-[4px] opacity-40 transition-all duration-1000 ${isGeneratingImg ? 'opacity-10 animate-pulse' : ''}`} 
              alt="Parallax background of landmark"
            />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60 pointer-events-none" />
        
        {!isARMode && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="relative w-full max-w-2xl aspect-video rounded-2xl overflow-hidden shadow-[0_0_100px_rgba(251,191,36,0.1)] ring-1 ring-white/10 group/img">
              {isGeneratingImg ? (
                <div className="w-full h-full bg-zinc-800 animate-pulse flex flex-col items-center justify-center space-y-4">
                   <RefreshCcw className="w-12 h-12 text-amber-500 animate-spin" />
                   <p className="text-zinc-400 font-serif italic">Reimagining through AI...</p>
                </div>
              ) : (
                <img 
                  src={aiImageUrl || result.imageUrl} 
                  className="w-full h-full object-cover animate-zoom-in" 
                  alt={`View of ${result.info.name}`} 
                />
              )}
              
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black/90 to-transparent">
                 <div className="flex items-center gap-2 text-amber-400 mb-2">
                   <MapPin size={16} />
                   <span className="text-xs font-bold uppercase tracking-widest">{result.info.location || 'Unknown'}</span>
                 </div>
                 <div className="flex justify-between items-end">
                   <div>
                     <h1 className="text-4xl font-serif text-white mb-1 leading-tight">{result.info.name}</h1>
                     <p className="text-zinc-200 text-sm max-w-md line-clamp-1 opacity-80">{result.info.description}</p>
                   </div>
                   <div className="flex gap-2">
                      <button 
                        onClick={handleGenerateImage}
                        disabled={isGeneratingImg}
                        aria-label="Generate AI reimagining of landmark"
                        className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/20 hover:bg-amber-500 hover:text-black transition-all group/btn relative focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        {isGeneratingImg ? <RefreshCcw className="animate-spin" /> : <Sparkles size={18} />}
                        <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-[10px] rounded opacity-0 group-hover/btn:opacity-100 transition-opacity whitespace-nowrap">AI Reimagining</span>
                      </button>
                      <div className="relative">
                        <button 
                          onClick={() => setShowShareMenu(!showShareMenu)}
                          aria-label="Share story"
                          aria-expanded={showShareMenu}
                          className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/20 transition-all focus:outline-none focus:ring-2 focus:ring-white"
                        >
                          <Share2 size={18} />
                        </button>
                        {showShareMenu && (
                          <div className="absolute bottom-full right-0 mb-4 bg-zinc-900 border border-white/10 p-2 rounded-2xl flex flex-col gap-1 shadow-2xl animate-in fade-in slide-in-from-bottom-2 z-50">
                            <button onClick={() => shareViaPlatform('twitter')} className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 rounded-xl text-sm text-zinc-300">
                              <Twitter size={14} className="text-blue-400" /> Twitter
                            </button>
                            <button onClick={() => shareViaPlatform('facebook')} className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 rounded-xl text-sm text-zinc-300">
                              <Facebook size={14} className="text-blue-600" /> Facebook
                            </button>
                            <button onClick={() => shareViaPlatform('copy')} className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 rounded-xl text-sm text-zinc-300">
                              <Copy size={14} /> Copy Link
                            </button>
                          </div>
                        )}
                      </div>
                   </div>
                 </div>
              </div>
              {!isGeneratingImg && <div className="absolute top-0 left-0 w-full h-1 bg-amber-500/50 shadow-[0_0_15px_#f59e0b] animate-scan" />}
            </div>
          </div>
        )}

        {/* Global HUD Controls */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-4 z-40">
           <button 
              onClick={toggleAR}
              className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all border shadow-2xl group/ar
                ${isARMode 
                  ? 'bg-red-500 text-white border-red-400 hover:bg-red-600' 
                  : 'bg-amber-500 border-amber-400 text-black hover:bg-amber-400 hover:scale-105 active:scale-95'}`}
           >
              {isARMode ? <Box size={18} className="animate-pulse" /> : <Eye size={18} className="group-hover/ar:animate-bounce" />}
              {isARMode ? "Disconnect AR" : "Augmented Vision"}
           </button>
        </div>

        <button 
          onClick={onBack}
          className="absolute top-6 left-6 flex items-center gap-2 px-5 py-2.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white hover:bg-white/10 transition-colors z-50 focus:outline-none focus:ring-2 focus:ring-white"
        >
          <ChevronLeft size={20} /> Exit Tour
        </button>
      </div>

      <div 
        ref={sidebarRef}
        onScroll={handleScroll}
        className="w-full md:w-[480px] bg-zinc-950 border-l border-white/5 flex flex-col h-[60vh] md:h-full relative shadow-2xl overflow-y-auto custom-scrollbar"
        role="complementary"
      >
        <div className="p-8 space-y-8 pb-56">
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <h2 className="text-xs font-bold text-amber-500 uppercase tracking-[0.2em]">The Chronicle</h2>
            <div className="flex gap-1 p-1 bg-white/5 rounded-lg border border-white/5">
              {(['small', 'medium', 'large'] as FontSize[]).map(size => (
                <button
                  key={size}
                  onClick={() => setFontSize(size)}
                  className={`p-1.5 rounded-md transition-all ${fontSize === size ? 'bg-amber-500 text-black' : 'text-zinc-500 hover:text-white'}`}
                >
                  <TypeIcon size={14} />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {sections.map((section, idx) => (
              <article key={idx} className="border border-white/5 rounded-xl overflow-hidden bg-white/[0.02]">
                <button 
                  onClick={() => toggleSection(idx)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors focus:outline-none focus:bg-white/5"
                >
                  <span className="font-semibold text-zinc-100">{section.title}</span>
                  {expandedSections[idx] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {expandedSections[idx] && (
                  <div className="px-4 pb-4 pt-0">
                    <div className={`${getFontSizeClass()} text-zinc-200 leading-relaxed whitespace-pre-wrap font-light`}>
                      {section.content}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>

          {result.sources && result.sources.length > 0 && (
            <div className="space-y-4 pt-4">
               <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Verified Sources</h3>
               <div className="flex flex-wrap gap-2">
                 {result.sources.map((source, i) => (
                   <a 
                     key={i} 
                     href={source.uri} 
                     target="_blank" 
                     rel="noopener noreferrer"
                     className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-white/5 text-[11px] text-zinc-300 hover:text-amber-500 hover:border-amber-500/30 transition-all focus:outline-none focus:ring-1 focus:ring-amber-500"
                   >
                     {source.title.length > 25 ? source.title.substring(0, 25) + '...' : source.title}
                     <ExternalLink size={10} />
                   </a>
                 ))}
               </div>
            </div>
          )}

          {result.relatedLandmarks && result.relatedLandmarks.length > 0 && (
            <div className="space-y-6 pt-8 border-t border-white/5">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em]">Discover Related Sites</h3>
              <div className="grid gap-4">
                {result.relatedLandmarks.map((rel, i) => (
                  <div key={i} className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 group/rel">
                    <h4 className="font-bold text-zinc-100 mb-1 group-hover/rel:text-amber-400 transition-colors">{rel.name}</h4>
                    <p className="text-xs text-zinc-400 italic mb-4">"{rel.reason}"</p>
                    <button 
                      onClick={() => onExploreRelated?.(rel.name)}
                      className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-500 hover:text-amber-400 transition-colors focus:outline-none"
                    >
                      <Compass size={12} /> Explore Site
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 left-0 right-0 p-6 bg-zinc-900/95 backdrop-blur-2xl border-t border-white/10 space-y-4 z-40 shadow-[0_-10px_50px_rgba(0,0,0,0.8)]">
          <div className="space-y-3">
            <div className="flex justify-between items-center text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-amber-500">
                  <Gauge size={12} /> Speed:
                </span>
                <div className="flex gap-2">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                    <button
                      key={speed}
                      onClick={() => changePlaybackSpeed(speed as PlaybackSpeed)}
                      className={`hover:text-white transition-all px-1.5 rounded ${playbackSpeed === speed ? 'bg-amber-500 text-black' : 'text-zinc-500'}`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 font-mono tabular-nums">
                <span>{formatTime(currentTime)}</span>
                <span className="opacity-40">/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
            <input 
              type="range" 
              min="0" 
              max={duration || 100} 
              step="0.1" 
              value={currentTime} 
              onChange={handleSeek}
              className="w-full h-1.5 cursor-pointer accent-amber-500"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                 <button onClick={() => skip(-10)} className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-colors"><SkipBack size={18} /></button>
                 <button 
                   onClick={togglePlayback}
                   disabled={isLoadingAudio && !result.audioBase64}
                   className={`w-14 h-14 rounded-full flex items-center justify-center transition-all transform active:scale-95 focus:outline-none focus:ring-4 focus:ring-amber-500/50 ${isLoadingAudio && !result.audioBase64 ? 'bg-zinc-800' : 'bg-amber-500 hover:bg-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.3)]'} text-black`}
                 >
                   {isLoadingAudio && !result.audioBase64 ? <RefreshCcw className="animate-spin" /> : isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="ml-1" />}
                 </button>
                 <button onClick={() => skip(10)} className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-colors"><SkipForward size={18} /></button>
              </div>
              <div>
                <p className="text-sm font-bold text-white tracking-wide">Audio Narrator</p>
                <p className="text-[11px] text-zinc-400 font-medium">{isPlaying ? 'Tour in progress' : 'Ready'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-black/40 p-1.5 rounded-full border border-white/10">
              <button onClick={() => handleFeedback('up')} className={`p-2 rounded-full transition-all ${feedback === 'up' ? 'text-green-500 bg-green-500/10' : 'text-zinc-500 hover:text-zinc-200'}`}><ThumbsUp size={16} /></button>
              <button onClick={() => handleFeedback('down')} className={`p-2 rounded-full transition-all ${feedback === 'down' ? 'text-red-500 bg-red-500/10' : 'text-zinc-500 hover:text-zinc-200'}`}><ThumbsDown size={16} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const X = ({ size, className = "" }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

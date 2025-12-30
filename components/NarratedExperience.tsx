
import React, { useEffect, useState, useRef } from 'react';
import { 
  Play, Pause, ChevronLeft, MapPin, 
  ExternalLink, RefreshCcw, Share2, ThumbsUp, ThumbsDown, 
  Sparkles, ChevronDown, ChevronUp, Twitter, Facebook, Copy,
  Type as TypeIcon, Compass, Gauge, Box, Eye, SkipBack, SkipForward,
  Info, Target, History as HistoryIcon, BookOpen, Camera, Image as ImageIcon,
  ArrowRight, Bookmark, Download, MessageSquare, Mail, Layers, Filter,
  ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon, Wifi, X
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
  theme: string;
  sectionIdx: number;
  x: number;
  y: number;
  z: number;
}

type FontSize = 'small' | 'medium' | 'large';
type PlaybackSpeed = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;
type ARBgMode = 'live' | 'stylized';

export const NarratedExperience: React.FC<NarratedExperienceProps> = ({ result, onBack, onExploreRelated, onUpdateCache }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isGeneratingImg, setIsGeneratingImg] = useState(false);
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(null);
  const [abstractImageUrl, setAbstractImageUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({ 0: true });
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [parallaxOffset, setParallaxOffset] = useState(0);
  
  const [isBookmarked, setIsBookmarked] = useState(result.isBookmarked || false);
  const [isDownloaded, setIsDownloaded] = useState(result.isDownloaded || false);

  // AR Mode States
  const [isARMode, setIsARMode] = useState(() => {
    return localStorage.getItem(`ar_active_${result.id}`) === 'true';
  });
  const [arBgMode, setArBgMode] = useState<ARBgMode>('live');
  const [selectedARFact, setSelectedARFact] = useState<ARFactNode | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string>('All');
  const [trackingConfidence, setTrackingConfidence] = useState(98);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<number, HTMLElement | null>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const offsetRef = useRef<number>(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const animationFrameRef = useRef<number>(null);

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

  const arFactNodes: ARFactNode[] = React.useMemo(() => {
    const nodes: ARFactNode[] = [];
    const yearRegex = /\b(1\d{3}|20\d{2})\b/g;
    
    sections.forEach((section, sIdx) => {
      const sentences = section.content.split(/[.!?]\s+/);
      sentences.forEach((s, idx) => {
        const match = s.match(yearRegex);
        if (match && nodes.length < 8) {
          let theme = "General History";
          if (s.toLowerCase().includes('architect') || s.toLowerCase().includes('design')) theme = "Architecture";
          if (s.toLowerCase().includes('war') || s.toLowerCase().includes('battle') || s.toLowerCase().includes('conflict')) theme = "Conflict";
          if (s.toLowerCase().includes('rebuild') || s.toLowerCase().includes('modern') || s.toLowerCase().includes('today')) theme = "Modernization";
          if (s.toLowerCase().includes('king') || s.toLowerCase().includes('queen') || s.toLowerCase().includes('emperor')) theme = "Royal Era";

          nodes.push({
            id: `fact-${sIdx}-${idx}`,
            year: match[0],
            text: s.trim().substring(0, 120) + (s.length > 120 ? '...' : ''),
            theme: theme,
            sectionIdx: sIdx,
            x: (Math.random() - 0.5) * 50,
            y: (Math.random() - 0.5) * 35,
            z: Math.random() * -120 - 80
          });
        }
      });
    });
    return nodes;
  }, [sections]);

  const uniqueThemes = React.useMemo(() => {
    const themes = new Set(arFactNodes.map(n => n.theme));
    return ['All', ...Array.from(themes)];
  }, [arFactNodes]);

  const filteredNodes = React.useMemo(() => {
    return selectedTheme === 'All' 
      ? arFactNodes 
      : arFactNodes.filter(n => n.theme === selectedTheme);
  }, [arFactNodes, selectedTheme]);

  // Handle temporal navigation (Next/Prev fact by year)
  const sortedNodesByYear = React.useMemo(() => {
    return [...arFactNodes].sort((a, b) => parseInt(a.year) - parseInt(b.year));
  }, [arFactNodes]);

  const navigateFact = (direction: 'next' | 'prev') => {
    if (!selectedARFact) return;
    const currentIndex = sortedNodesByYear.findIndex(n => n.id === selectedARFact.id);
    let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0) nextIndex = sortedNodesByYear.length - 1;
    if (nextIndex >= sortedNodesByYear.length) nextIndex = 0;
    setSelectedARFact(sortedNodesByYear[nextIndex]);
  };

  // Fluctuate tracking confidence for visual immersion
  useEffect(() => {
    const interval = setInterval(() => {
      setTrackingConfidence(prev => {
        const delta = (Math.random() - 0.5) * 4;
        const next = Math.max(50, Math.min(100, prev + delta));
        return next;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

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

  const jumpToChronicleSection = (idx: number) => {
    setExpandedSections(prev => ({ ...prev, [idx]: true }));
    setSelectedARFact(null);
    setTimeout(() => {
      const sectionEl = sectionRefs.current[idx];
      if (sectionEl && sidebarRef.current) {
        sidebarRef.current.scrollTo({
          top: sectionEl.offsetTop - 100,
          behavior: 'smooth'
        });
      }
    }, 50);
  };

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

  const handleToggleStylized = async () => {
    const nextMode = arBgMode === 'live' ? 'stylized' : 'live';
    setArBgMode(nextMode);
    
    if (nextMode === 'stylized' && !abstractImageUrl && !isGeneratingImg) {
      setIsGeneratingImg(true);
      try {
        const url = await generateLandmarkImage(result.info.name, 'abstract');
        setAbstractImageUrl(url);
      } catch (err) {
        console.error(err);
      } finally {
        setIsGeneratingImg(false);
      }
    }
  };

  const handleBookmark = () => {
    setIsBookmarked(!isBookmarked);
    const saved = localStorage.getItem('lumina_tour_history');
    if (saved) {
      const history = JSON.parse(saved);
      const updated = history.map((item: any) => 
        item.id === result.id ? { ...item, isBookmarked: !isBookmarked } : item
      );
      localStorage.setItem('lumina_tour_history', JSON.stringify(updated));
    }
  };

  const handleDownload = () => {
    setIsDownloaded(true);
    const saved = localStorage.getItem('lumina_tour_history');
    if (saved) {
      const history = JSON.parse(saved);
      const updated = history.map((item: any) => 
        item.id === result.id ? { ...item, isDownloaded: true } : item
      );
      localStorage.setItem('lumina_tour_history', JSON.stringify(updated));
    }
    alert(`${result.info.name} saved for offline access.`);
  };

  const shareViaPlatform = (platform: string) => {
    const text = `Discovering history with LuminaTour: ${result.info.name}`;
    const url = window.location.href;
    let shareUrl = "";

    switch (platform) {
      case 'twitter': shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`; break;
      case 'facebook': shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`; break;
      case 'whatsapp': shareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text + " " + url)}`; break;
      case 'email': shareUrl = `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(url)}`; break;
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
        @keyframes dash-scroll {
          from { stroke-dashoffset: 40; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes line-pulse {
          0%, 100% { stroke-width: 2; filter: blur(4px); opacity: 0.4; }
          50% { stroke-width: 4; filter: blur(10px); opacity: 0.9; }
        }
        .animate-pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
        .animate-idle-shimmer { animation: idle-shimmer 3s ease-in-out infinite; }
        .animate-dash-scroll { animation: dash-scroll 2s linear infinite; }
        .animate-line-pulse { animation: line-pulse 3s ease-in-out infinite; }
      `}</style>

      {/* Visual Component Area */}
      <div className="relative flex-1 h-[40vh] md:h-full bg-zinc-900 group overflow-hidden">
        {isARMode ? (
          <div className="absolute inset-0 bg-black overflow-hidden transition-all duration-700">
            {/* Background Layer */}
            <div className={`absolute inset-0 transition-opacity duration-1000 ${arBgMode === 'stylized' ? 'opacity-100' : 'opacity-100'}`}>
              <video 
                ref={videoRef}
                autoPlay 
                playsInline 
                muted 
                className={`absolute inset-0 w-full h-full object-cover opacity-80 transition-all duration-1000 ${arBgMode === 'stylized' ? 'blur-2xl scale-125 opacity-20' : ''}`}
              />
            </div>
            
            {arBgMode === 'stylized' && (
              <div className="absolute inset-0 transition-all duration-1000 animate-in fade-in">
                {abstractImageUrl ? (
                   <img 
                    src={abstractImageUrl} 
                    className="absolute inset-0 w-full h-full object-cover animate-zoom-in" 
                    alt="Neural interpretation"
                   />
                ) : (
                   <div className="absolute inset-0 bg-zinc-900 flex flex-col items-center justify-center space-y-4">
                      <RefreshCcw className="w-12 h-12 text-amber-500 animate-spin" />
                      <p className="text-zinc-500 font-mono text-xs uppercase tracking-[0.2em]">Crafting Artistic Vision...</p>
                   </div>
                )}
                <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
              </div>
            )}
            
            {/* AR Scene Container with Confidence Fading */}
            <div 
              className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${trackingConfidence < 65 ? 'opacity-10' : trackingConfidence < 85 ? 'opacity-50' : 'opacity-100'}`}
              style={{ perspective: '1200px', transformStyle: 'preserve-3d' }}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60" />
              
              <svg className="absolute inset-0 w-full h-full overflow-visible z-10 pointer-events-none">
                <defs>
                   <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="8" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                   </filter>
                   <linearGradient id="arLineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.1" />
                      <stop offset="50%" stopColor="#f59e0b" stopOpacity="1" />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.1" />
                   </linearGradient>
                </defs>
                {selectedARFact && filteredNodes.map((node) => {
                  if (node.id === selectedARFact.id || node.theme !== selectedARFact.theme) return null;
                  const x1 = 50 + selectedARFact.x;
                  const y1 = 50 + selectedARFact.y;
                  const x2 = 50 + node.x;
                  const y2 = 50 + node.y;
                  return (
                    <line 
                      key={`link-${node.id}`}
                      x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`}
                      stroke="url(#arLineGrad)"
                      strokeWidth="3"
                      strokeDasharray="15 8"
                      className="animate-dash-scroll animate-line-pulse"
                      style={{ filter: 'url(#lineGlow)' }}
                    />
                  );
                })}
              </svg>

              {/* Central Tracking Target */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 border border-amber-500/10 rounded-full flex items-center justify-center animate-pulse">
                <div className="absolute inset-0 border-t-2 border-b-2 border-amber-500/30 rounded-full animate-spin duration-[12s]" />
                <div className="absolute w-14 h-14 border-2 border-amber-500/50 rounded-lg rotate-12 animate-ping opacity-20" />
                <Target size={28} className="text-amber-500 opacity-40" />
              </div>

              {/* Spatial Nodes */}
              <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
                {filteredNodes.map((node) => {
                  const isSelected = selectedARFact?.id === node.id;
                  const isThematicNeighbor = selectedARFact && node.theme === selectedARFact.theme && !isSelected;
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
                      <div className={`relative transition-all duration-500 ${isSelected ? 'scale-110' : 'hover:scale-105'}`}>
                        <div className={`w-0.5 h-16 bg-gradient-to-t from-amber-500 to-transparent mx-auto transition-opacity ${isSelected || isThematicNeighbor ? 'opacity-100' : 'opacity-30 group-hover/node:opacity-100'}`} />
                        <div className={`p-4 rounded-2xl backdrop-blur-2xl border transition-all duration-500 flex flex-col items-center gap-1 shadow-2xl w-44 text-center
                          ${isSelected 
                            ? 'bg-amber-500 border-amber-400 scale-110 shadow-amber-500/40' 
                            : isThematicNeighbor 
                              ? 'bg-amber-500/20 border-amber-500/50 animate-pulse' 
                              : 'bg-black/70 border-white/20 group-hover/node:border-amber-500/40'}`}
                        >
                           <HistoryIcon size={16} className={isSelected ? 'text-black' : 'text-amber-500'} />
                           <span className={`text-[12px] font-black tracking-widest ${isSelected ? 'text-black' : 'text-zinc-100'}`}>
                             {node.year}
                           </span>
                           <span className={`text-[8px] font-bold uppercase tracking-[0.1em] opacity-60 ${isSelected ? 'text-black' : 'text-amber-500'}`}>
                             {node.theme}
                           </span>
                           <p className={`text-[10px] font-medium leading-tight line-clamp-2 mt-1 ${isSelected ? 'text-black/80' : 'text-zinc-400'}`}>
                             {node.text}
                           </p>
                        </div>
                        <div className={`absolute -inset-4 bg-amber-500 blur-3xl rounded-full transition-opacity pointer-events-none
                          ${isSelected ? 'opacity-30 animate-pulse-glow' : 'opacity-0 group-hover/node:opacity-10'}
                        `} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* AR HUD Display */}
              <div className="absolute top-12 left-12 space-y-4 pointer-events-none">
                 <div className="flex items-center gap-4 bg-black/60 backdrop-blur-xl px-5 py-3 rounded-2xl border border-white/10 pointer-events-auto shadow-2xl">
                    <div className={`w-2.5 h-2.5 rounded-full ${trackingConfidence > 85 ? 'bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]' : trackingConfidence > 65 ? 'bg-amber-500 shadow-[0_0_10px_#f59e0b]' : 'bg-red-500 animate-ping shadow-[0_0_10px_#ef4444]'}`} />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest leading-none mb-1">Stability Sync</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden">
                           <div 
                             className={`h-full transition-all duration-1000 ${trackingConfidence > 85 ? 'bg-green-500' : trackingConfidence > 65 ? 'bg-amber-500' : 'bg-red-500'}`}
                             style={{ width: `${trackingConfidence}%` }}
                           />
                        </div>
                        <span className={`text-[11px] font-mono tabular-nums ${trackingConfidence > 85 ? 'text-green-500' : trackingConfidence > 65 ? 'text-amber-500' : 'text-red-500'}`}>{trackingConfidence.toFixed(0)}%</span>
                      </div>
                    </div>
                 </div>
                 
                 {/* Theme Toggle HUD */}
                 <div className="flex flex-wrap gap-2 max-w-sm pointer-events-auto">
                   {uniqueThemes.map(theme => (
                     <button 
                       key={theme}
                       onClick={() => setSelectedTheme(theme)}
                       className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all active:scale-95
                         ${selectedTheme === theme 
                           ? 'bg-amber-500 border-amber-400 text-black shadow-xl shadow-amber-500/20' 
                           : 'bg-black/50 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10'}`}
                     >
                       {theme === 'All' ? <Layers size={10} className="inline mr-1.5 mb-0.5" /> : <Filter size={10} className="inline mr-1.5 mb-0.5" />}
                       {theme}
                     </button>
                   ))}
                 </div>
                 
                 <div className="pointer-events-auto">
                   <button 
                     onClick={handleToggleStylized}
                     className={`flex items-center gap-3 px-5 py-2.5 bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl hover:bg-zinc-800 transition-all group/mode shadow-2xl
                       ${arBgMode === 'stylized' ? 'border-amber-500/50 text-amber-500' : 'text-zinc-300'}`}
                   >
                     {arBgMode === 'live' ? <Sparkles size={16} /> : <Eye size={16} />}
                     <span className="text-[10px] font-black uppercase tracking-widest">{arBgMode === 'live' ? 'Activate Neural Art' : 'Return to Reality'}</span>
                   </button>
                 </div>
              </div>
            </div>

            {/* Fact Detailed Modal */}
            {selectedARFact && (
              <div className="absolute inset-0 flex items-center justify-center p-8 bg-black/70 backdrop-blur-md z-50 animate-in fade-in duration-500">
                 <div className="bg-zinc-950 border border-amber-500/20 rounded-[3rem] p-12 max-w-xl w-full shadow-[0_0_150px_rgba(245,158,11,0.15)] relative overflow-hidden group/modal">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.6)] animate-pulse" />
                    
                    <button 
                      onClick={() => setSelectedARFact(null)}
                      className="absolute top-8 right-8 p-3 text-zinc-500 hover:text-white transition-all hover:bg-white/5 rounded-full"
                    >
                      <X size={28} />
                    </button>
                    
                    {/* Chronological Navigation */}
                    <div className="absolute top-1/2 -translate-y-1/2 left-6">
                       <button 
                        onClick={() => navigateFact('prev')} 
                        className="p-4 bg-white/5 hover:bg-amber-500 hover:text-black border border-white/10 rounded-full transition-all hover:scale-110 active:scale-90 shadow-2xl"
                       >
                         <ChevronLeftIcon size={24} />
                       </button>
                    </div>
                    <div className="absolute top-1/2 -translate-y-1/2 right-6">
                       <button 
                        onClick={() => navigateFact('next')} 
                        className="p-4 bg-white/5 hover:bg-amber-500 hover:text-black border border-white/10 rounded-full transition-all hover:scale-110 active:scale-90 shadow-2xl"
                       >
                         <ChevronRightIcon size={24} />
                       </button>
                    </div>

                    <div className="flex items-center gap-6 mb-10">
                       <div className="w-20 h-20 bg-amber-500 rounded-[2rem] flex items-center justify-center shadow-3xl shadow-amber-500/40 group-hover/modal:scale-105 transition-transform duration-700">
                          <BookOpen className="text-black w-10 h-10" />
                       </div>
                       <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="px-3 py-1 rounded-lg bg-amber-500/10 text-amber-500 text-[10px] font-black uppercase tracking-[0.2em] border border-amber-500/30">
                              {selectedARFact.theme}
                            </span>
                          </div>
                          <h4 className="text-4xl font-serif text-white tracking-tight">The Year {selectedARFact.year}</h4>
                       </div>
                    </div>
                    
                    <div className="relative mb-12 min-h-[100px] flex items-center">
                      <p className="text-zinc-200 text-xl leading-relaxed italic border-l-4 border-amber-500/50 pl-8 py-3 bg-white/[0.02] rounded-r-2xl">
                         {selectedARFact.text}
                      </p>
                    </div>

                    <div className="flex gap-5">
                      <button 
                        onClick={() => jumpToChronicleSection(selectedARFact.sectionIdx)}
                        className="flex-1 py-5 bg-amber-500 text-black font-black uppercase text-[11px] tracking-[0.3em] rounded-3xl hover:bg-amber-400 transition-all flex items-center justify-center gap-4 shadow-[0_20px_40px_rgba(245,158,11,0.2)] active:scale-95"
                      >
                        <Compass size={20} /> View in Chronicle
                      </button>
                      <button 
                        onClick={() => setSelectedARFact(null)}
                        className="px-8 py-5 bg-white/5 border border-white/10 text-white font-black uppercase text-[11px] tracking-[0.3em] rounded-3xl hover:bg-white/10 transition-all active:scale-95"
                      >
                        Dismiss
                      </button>
                    </div>
                    
                    {/* Artistic flourish background */}
                    <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-amber-500/5 rounded-full blur-[80px]" />
                 </div>
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 w-full h-full" style={{ transform: `translateY(${parallaxOffset}px)` }}>
            <img src={aiImageUrl || result.imageUrl} className={`absolute inset-0 w-full h-full object-cover scale-110 blur-[4px] opacity-40 transition-all duration-1000 ${isGeneratingImg ? 'opacity-10 animate-pulse' : ''}`} alt="" />
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
                <img src={aiImageUrl || result.imageUrl} className="w-full h-full object-cover animate-zoom-in" alt={result.info.name} />
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
                      <button onClick={handleGenerateImage} disabled={isGeneratingImg} className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/20 hover:bg-amber-500 hover:text-black transition-all group/btn relative">
                        {isGeneratingImg ? <RefreshCcw className="animate-spin" /> : <Sparkles size={18} />}
                      </button>
                      <div className="relative">
                        <button onClick={() => setShowShareMenu(!showShareMenu)} className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/20 transition-all">
                          <Share2 size={18} />
                        </button>
                        {showShareMenu && (
                          <div className="absolute bottom-full right-0 mb-4 bg-zinc-900 border border-white/10 p-2 rounded-2xl flex flex-col gap-1 shadow-2xl animate-in fade-in slide-in-from-bottom-2 z-50">
                            <button onClick={() => shareViaPlatform('whatsapp')} className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 rounded-xl text-sm text-zinc-300">
                              <MessageSquare size={14} className="text-green-500" /> WhatsApp
                            </button>
                            <button onClick={() => shareViaPlatform('email')} className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 rounded-xl text-sm text-zinc-300">
                              <Mail size={14} className="text-blue-500" /> Email
                            </button>
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

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-4 z-40">
           <button onClick={toggleAR} className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] transition-all border shadow-2xl group/ar ${isARMode ? 'bg-red-500 text-white border-red-400 hover:bg-red-600' : 'bg-amber-500 border-amber-400 text-black hover:bg-amber-400 hover:scale-105 active:scale-95'}`}>
              {isARMode ? <Box size={20} className="animate-pulse" /> : <Eye size={20} className="group-hover/ar:animate-bounce" />}
              {isARMode ? "Disconnect AR" : "Augmented Vision"}
           </button>
        </div>

        <button onClick={onBack} className="absolute top-8 left-8 flex items-center gap-3 px-6 py-3 rounded-full bg-black/50 backdrop-blur-xl border border-white/10 text-white hover:bg-white/10 transition-colors z-50 shadow-2xl">
          <ChevronLeft size={22} /> Exit Experience
        </button>
      </div>

      <div ref={sidebarRef} onScroll={handleScroll} className="w-full md:w-[480px] bg-zinc-950 border-l border-white/5 flex flex-col h-[60vh] md:h-full relative shadow-2xl overflow-y-auto custom-scrollbar" role="complementary">
        <div className="p-10 space-y-10 pb-56">
          <div className="flex items-center justify-between border-b border-white/5 pb-6">
            <h2 className="text-[11px] font-black text-amber-500 uppercase tracking-[0.3em]">The Chronicle</h2>
            <div className="flex gap-2">
              <button 
                onClick={handleBookmark} 
                className={`p-2.5 rounded-xl border transition-all ${isBookmarked ? 'bg-amber-500 border-amber-400 text-black' : 'bg-white/5 border-white/5 text-zinc-500 hover:text-white'}`}
              >
                <Bookmark size={18} fill={isBookmarked ? "currentColor" : "none"} />
              </button>
              <button 
                onClick={handleDownload} 
                className={`p-2.5 rounded-xl border transition-all ${isDownloaded ? 'bg-green-500 border-green-400 text-black' : 'bg-white/5 border-white/5 text-zinc-500 hover:text-white'}`}
              >
                <Download size={18} />
              </button>
              <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/5">
                {(['small', 'medium', 'large'] as FontSize[]).map(size => (
                  <button key={size} onClick={() => setFontSize(size)} className={`p-2 rounded-lg transition-all ${fontSize === size ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' : 'text-zinc-500 hover:text-white'}`}>
                    <TypeIcon size={14} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {sections.map((section, idx) => (
              <article key={idx} ref={el => { sectionRefs.current[idx] = el; }} className={`border border-white/5 rounded-2xl overflow-hidden transition-all duration-700 ${expandedSections[idx] ? 'bg-white/[0.04] ring-1 ring-amber-500/30' : 'bg-white/[0.02]'}`}>
                <button onClick={() => toggleSection(idx)} className="w-full flex items-center justify-between p-5 text-left hover:bg-white/5 transition-colors focus:outline-none focus:bg-white/5">
                  <span className="font-bold text-zinc-100 tracking-tight">{section.title}</span>
                  {expandedSections[idx] ? <ChevronUp size={20} className="text-amber-500" /> : <ChevronDown size={20} className="text-zinc-600" />}
                </button>
                {expandedSections[idx] && (
                  <div className="px-5 pb-5 pt-0">
                    <div className={`${getFontSizeClass()} text-zinc-300 leading-relaxed whitespace-pre-wrap font-light`}>{section.content}</div>
                  </div>
                )}
              </article>
            ))}
          </div>

          {result.sources && result.sources.length > 0 && (
            <div className="space-y-5 pt-6">
               <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em]">Verified Sources</h3>
               <div className="flex flex-wrap gap-2.5">
                 {result.sources.map((source, i) => (
                   <a key={i} href={source.uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-zinc-900 border border-white/5 text-[11px] text-zinc-300 hover:text-amber-500 hover:border-amber-500/40 transition-all focus:outline-none focus:ring-1 focus:ring-amber-500 shadow-sm">
                     {source.title.length > 30 ? source.title.substring(0, 30) + '...' : source.title}
                     <ExternalLink size={11} />
                   </a>
                 ))}
               </div>
            </div>
          )}

          {result.relatedLandmarks && result.relatedLandmarks.length > 0 && (
            <div className="space-y-8 pt-10 border-t border-white/5">
              <h3 className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.2em]">Discover Related Sites</h3>
              <div className="grid gap-5">
                {result.relatedLandmarks.map((rel, i) => (
                  <div key={i} className="p-6 rounded-2xl bg-amber-500/5 border border-amber-500/10 group/rel hover:bg-amber-500/10 transition-all">
                    <h4 className="font-black text-zinc-100 mb-2 group-hover/rel:text-amber-500 transition-colors uppercase tracking-tight">{rel.name}</h4>
                    <p className="text-xs text-zinc-400 italic mb-5 leading-relaxed">"{rel.reason}"</p>
                    <button onClick={() => onExploreRelated?.(rel.name)} className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-amber-500 hover:text-amber-400 transition-colors focus:outline-none">
                      <Compass size={14} /> Explore Site <ArrowRight size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 left-0 right-0 p-8 bg-zinc-900/98 backdrop-blur-3xl border-t border-white/10 space-y-5 z-40 shadow-[0_-20px_60px_rgba(0,0,0,0.9)]">
          <div className="space-y-4">
            <div className="flex justify-between items-center text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-2 text-amber-500">
                  <Gauge size={14} /> Playback Rate:
                </span>
                <div className="flex gap-2.5">
                  {[0.5, 1, 1.5, 2].map(speed => (
                    <button key={speed} onClick={() => changePlaybackSpeed(speed as PlaybackSpeed)} className={`hover:text-white transition-all px-2 py-0.5 rounded-md ${playbackSpeed === speed ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' : 'text-zinc-600'}`}>
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 font-mono tabular-nums bg-black/40 px-3 py-1 rounded-lg border border-white/5">
                <span className="text-zinc-200">{formatTime(currentTime)}</span>
                <span className="opacity-20">/</span>
                <span className="text-zinc-500">{formatTime(duration)}</span>
              </div>
            </div>
            <input type="range" min="0" max={duration || 100} step="0.1" value={currentTime} onChange={handleSeek} className="w-full h-2 cursor-pointer accent-amber-500" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-2">
                 <button onClick={() => skip(-10)} className="p-2.5 text-zinc-500 hover:text-white hover:bg-white/5 rounded-full transition-colors"><SkipBack size={20} /></button>
                 <button 
                   onClick={togglePlayback} 
                   disabled={isLoadingAudio && !result.audioBase64} 
                   className={`w-16 h-16 rounded-full flex items-center justify-center transition-all transform active:scale-90 focus:outline-none focus:ring-4 focus:ring-amber-500/40 ${isLoadingAudio && !result.audioBase64 ? 'bg-zinc-800' : 'bg-amber-500 hover:bg-amber-400 shadow-[0_10px_30px_rgba(245,158,11,0.3)]'} text-black`}
                 >
                   {isLoadingAudio && !result.audioBase64 ? <RefreshCcw className="animate-spin" size={24} /> : isPlaying ? <Pause fill="currentColor" size={24} /> : <Play fill="currentColor" size={24} className="ml-1" />}
                 </button>
                 <button onClick={() => skip(10)} className="p-2.5 text-zinc-500 hover:text-white hover:bg-white/5 rounded-full transition-colors"><SkipForward size={20} /></button>
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-black text-amber-500 uppercase tracking-[0.2em] mb-0.5">Neural Narrator</p>
                <p className="text-[11px] text-zinc-400 font-medium tracking-tight">{isPlaying ? 'Immersion Active' : 'Waiting for Input'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 bg-black/50 p-2 rounded-2xl border border-white/5 shadow-inner">
              <button onClick={() => handleFeedback('up')} className={`p-2.5 rounded-xl transition-all ${feedback === 'up' ? 'text-green-500 bg-green-500/10 shadow-inner shadow-green-500/20' : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/5'}`}><ThumbsUp size={18} /></button>
              <button onClick={() => handleFeedback('down')} className={`p-2.5 rounded-xl transition-all ${feedback === 'down' ? 'text-red-500 bg-red-500/10 shadow-inner shadow-red-500/20' : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/5'}`}><ThumbsDown size={18} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

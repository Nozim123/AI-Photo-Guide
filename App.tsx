
import React, { useState, useEffect, useRef } from 'react';
import { CameraView } from './components/CameraView';
import { NarratedExperience } from './components/NarratedExperience';
import { identifyLandmark, getLandmarkHistory, getRelatedLandmarks, searchLandmarkByName, generateLandmarkImage } from './services/gemini';
import { AppState, LandmarkResult } from './types';
import { 
  Sparkles, Loader2, AlertCircle, Compass, Map as MapIcon, 
  Layers, Search, Eye, BookOpen, Clock, Globe, LayoutGrid, X, 
  WifiOff, Bookmark, Download, MapPin
} from 'lucide-react';

const STORAGE_KEY = 'lumina_tour_history';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [result, setResult] = useState<LandmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [history, setHistory] = useState<LandmarkResult[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [searchQuery, setSearchQuery] = useState('');
  const mapRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Sync history with localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history");
      }
    }

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const saveToHistory = (newResult: LandmarkResult) => {
    setHistory(prev => {
      const filtered = prev.filter(item => item.id !== newResult.id);
      const updated = [newResult, ...filtered].slice(0, 50); // Increased limit
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const handleCapture = async (base64Image: string) => {
    if (isOffline) {
      setError("Internet connection required for new discoveries.");
      setState(AppState.ERROR);
      return;
    }
    setCapturedImage(base64Image);
    setState(AppState.IDENTIFYING);
    setError(null);
    try {
      const info = await identifyLandmark(base64Image);
      await processLandmark(info, base64Image);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to analyze image. Please try again.");
      setState(AppState.ERROR);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || isOffline) return;
    
    setState(AppState.IDENTIFYING);
    setError(null);
    try {
      const info = await searchLandmarkByName(searchQuery);
      // Fetch an image for it
      const imageUrl = await generateLandmarkImage(info.name);
      setCapturedImage(imageUrl);
      await processLandmark(info, imageUrl);
      setSearchQuery('');
    } catch (err: any) {
      setError("Landmark not found or search failed.");
      setState(AppState.ERROR);
    }
  };

  const processLandmark = async (info: any, image: string) => {
    setState(AppState.SEARCHING);
    const [historyData, relatedData] = await Promise.all([
      getLandmarkHistory(info.name),
      getRelatedLandmarks(info.name, info.location || "")
    ]);
    
    const newResult: LandmarkResult = {
      id: crypto.randomUUID(),
      info,
      history: historyData.text,
      sources: historyData.sources,
      relatedLandmarks: relatedData,
      imageUrl: image,
      timestamp: Date.now(),
      isBookmarked: false,
      isDownloaded: false
    };
    
    setResult(newResult);
    saveToHistory(newResult);
    setState(AppState.RESULT);
  };

  const toggleBookmark = (id: string) => {
    setHistory(prev => {
      const updated = prev.map(item => 
        item.id === id ? { ...item, isBookmarked: !item.isBookmarked } : item
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    if (result && result.id === id) {
      setResult({ ...result, isBookmarked: !result.isBookmarked });
    }
  };

  const toggleDownload = (id: string) => {
    setHistory(prev => {
      const updated = prev.map(item => 
        item.id === id ? { ...item, isDownloaded: !item.isDownloaded } : item
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    if (result && result.id === id) {
      setResult({ ...result, isDownloaded: !result.isDownloaded });
    }
  };

  const exploreRelated = async (name: string) => {
    if (isOffline) return;
    setSearchQuery(name);
    // Reuse search logic
    setState(AppState.IDENTIFYING);
    try {
      const info = await searchLandmarkByName(name);
      const imageUrl = await generateLandmarkImage(info.name);
      setCapturedImage(imageUrl);
      await processLandmark(info, imageUrl);
      setSearchQuery('');
    } catch (err) {
      setError("Could not explore related site.");
      setState(AppState.ERROR);
    }
  };

  const updateAudioCache = (audioBase64: string) => {
    if (result) {
      const updatedResult = { ...result, audioBase64 };
      setResult(updatedResult);
      saveToHistory(updatedResult);
    }
  };

  const viewHistoryItem = (item: LandmarkResult) => {
    setResult(item);
    setState(AppState.RESULT);
  };

  const reset = () => {
    setState(AppState.IDLE);
    setResult(null);
    setError(null);
    setCapturedImage(null);
  };

  // Map Initialization
  useEffect(() => {
    if (state === AppState.MAP && mapContainerRef.current && !mapRef.current) {
      const L = (window as any).L;
      if (!L) return;

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([20, 0], 2);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
      }).addTo(map);

      history.forEach(item => {
        if (item.info.latitude && item.info.longitude) {
          const marker = L.marker([item.info.latitude, item.info.longitude]).addTo(map);
          marker.on('click', () => {
            // Smoothly fly to marker before opening
            map.flyTo([item.info.latitude, item.info.longitude], 12, {
              animate: true,
              duration: 1.5
            });
            setTimeout(() => {
              viewHistoryItem(item);
            }, 1000);
          });
        }
      });

      mapRef.current = map;
    }
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [state, history]);

  const bookmarks = history.filter(item => item.isBookmarked);

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-amber-500/30 flex flex-col">
      {/* Header */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-black/40 backdrop-blur-xl border-b border-white/5 px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 group cursor-pointer flex-shrink-0" onClick={reset}>
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center group-hover:scale-110 group-hover:rotate-6 transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)]">
              <Compass className="w-6 h-6 text-black" />
            </div>
            <span className="text-2xl font-serif tracking-tight font-bold bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent hidden sm:inline">LuminaTour</span>
          </div>

          <form onSubmit={handleSearch} className="flex-1 max-w-xl relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-amber-500 transition-colors" />
            <input 
              type="text"
              placeholder="Search landmarks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={isOffline}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-2.5 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:bg-white/10 transition-all disabled:opacity-50"
            />
          </form>

          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
            <div className="hidden lg:flex items-center gap-6 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
              <button onClick={() => setState(AppState.HISTORY)} className={`hover:text-amber-400 transition-colors flex items-center gap-2 ${state === AppState.HISTORY ? 'text-amber-400' : ''}`}>
                <Clock size={14} /> Journal
              </button>
              <button onClick={() => setState(AppState.BOOKMARKS)} className={`hover:text-amber-400 transition-colors flex items-center gap-2 ${state === AppState.BOOKMARKS ? 'text-amber-400' : ''}`}>
                <Bookmark size={14} /> Saved
              </button>
              <button onClick={() => setState(AppState.MAP)} className={`hover:text-amber-400 transition-colors flex items-center gap-2 ${state === AppState.MAP ? 'text-amber-400' : ''}`}>
                <Globe size={14} /> Map
              </button>
            </div>
            
            {isOffline && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-bold uppercase tracking-widest">
                <WifiOff size={14} /> Offline
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-28 pb-20 px-8 flex-1 flex flex-col">
        {state === AppState.IDLE && (
          <div className="max-w-5xl mx-auto space-y-24 animate-in fade-in slide-in-from-bottom-8 duration-1000 flex-1 py-10">
            <div className="text-center space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/5 border border-amber-500/10 text-amber-500 text-[10px] font-black uppercase tracking-[0.3em] shadow-inner">
                <Sparkles size={14} fill="currentColor" /> AI-Augmented Travel
              </div>
              <h1 className="text-6xl md:text-8xl font-serif leading-[1.1] tracking-tight">
                Reveal the Secrets of <br />
                <span className="italic text-zinc-600 font-light">Every Horizon.</span>
              </h1>
              <p className="text-zinc-500 text-xl max-w-2xl mx-auto leading-relaxed font-light">
                {isOffline 
                  ? "Explore your offline journal. Connect to the internet to identify new landmarks."
                  : "LuminaTour uses next-gen vision and search grounding to transform your travel photography into deep journeys."}
              </p>
            </div>

            <div className={`relative group ${isOffline ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
               <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/20 to-transparent blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
               <CameraView onCapture={handleCapture} disabled={isOffline} />
            </div>

            {/* Quick Journal Preview */}
            {history.length > 0 && (
              <div className="space-y-8 pb-10">
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                  <h3 className="text-xl font-serif">Recent Discoveries</h3>
                  <button onClick={() => setState(AppState.HISTORY)} className="text-xs font-bold uppercase tracking-widest text-amber-500 hover:text-amber-400">View All</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {history.slice(0, 5).map(item => (
                    <button 
                      key={item.id} 
                      onClick={() => viewHistoryItem(item)}
                      className="group relative aspect-[4/5] rounded-xl overflow-hidden border border-white/5 hover:border-amber-500/30 transition-all text-left"
                    >
                      <img src={item.imageUrl} className="absolute inset-0 w-full h-full object-cover grayscale-[0.5] group-hover:grayscale-0 group-hover:scale-110 transition-all" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3">
                         <p className="text-[10px] text-amber-500 font-bold uppercase tracking-widest mb-0.5">{new Date(item.timestamp).toLocaleDateString()}</p>
                         <p className="text-xs font-bold line-clamp-1">{item.info.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(state === AppState.HISTORY || state === AppState.BOOKMARKS) && (
          <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 py-10 w-full">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-serif mb-2">{state === AppState.HISTORY ? 'Travel Journal' : 'Saved Destinations'}</h1>
                <p className="text-zinc-500 text-sm">
                  {state === AppState.HISTORY ? 'A collection of your global cultural discoveries.' : 'Landmarks you flagged for later revisiting.'}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setState(AppState.IDLE)} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"><X size={20} /></button>
              </div>
            </div>

            {(state === AppState.HISTORY ? history : bookmarks).length === 0 ? (
              <div className="text-center py-20 border border-dashed border-white/10 rounded-3xl">
                {state === AppState.HISTORY ? <Clock className="w-12 h-12 text-zinc-800 mx-auto mb-4" /> : <Bookmark className="w-12 h-12 text-zinc-800 mx-auto mb-4" />}
                <p className="text-zinc-500">No {state === AppState.HISTORY ? 'discoveries' : 'bookmarks'} yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
                {(state === AppState.HISTORY ? history : bookmarks).map(item => (
                  <div key={item.id} className="group bg-zinc-900/40 border border-white/5 rounded-3xl overflow-hidden hover:border-amber-500/20 transition-all flex flex-col relative">
                    <div className="relative aspect-video overflow-hidden">
                      <img src={item.imageUrl} className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-700" />
                      <div className="absolute top-4 left-4 flex gap-2">
                         <div className="px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-[10px] font-bold text-amber-500 uppercase tracking-widest border border-white/10">
                           {item.info.location || 'Discovery'}
                         </div>
                         {item.isDownloaded && (
                           <div className="p-1 px-2 bg-green-500/20 backdrop-blur-md rounded-full text-[8px] font-black uppercase text-green-500 border border-green-500/30 flex items-center gap-1">
                             <Download size={10} /> Saved Offline
                           </div>
                         )}
                      </div>
                      <button 
                        onClick={() => toggleBookmark(item.id)}
                        className={`absolute top-4 right-4 p-2 rounded-full transition-all ${item.isBookmarked ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30' : 'bg-black/50 text-white border border-white/10'}`}
                      >
                        <Bookmark size={14} fill={item.isBookmarked ? "currentColor" : "none"} />
                      </button>
                    </div>
                    <div className="p-6 flex-1 flex flex-col">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="text-xl font-bold tracking-tight">{item.info.name}</h3>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase mt-1">{new Date(item.timestamp).toLocaleDateString()}</p>
                      </div>
                      <p className="text-sm text-zinc-500 line-clamp-2 mb-6 flex-1 font-light italic">"{item.info.description}"</p>
                      <button 
                        onClick={() => viewHistoryItem(item)}
                        className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-widest hover:bg-amber-500 hover:text-black transition-all"
                      >
                        Revisit Story
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {state === AppState.MAP && (
          <div className="max-w-6xl mx-auto flex-1 flex flex-col space-y-6 animate-in fade-in slide-in-from-bottom-4 py-10 w-full">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-serif mb-2">Explorer Map</h1>
                <p className="text-zinc-500 text-sm">Visualizing your cultural footprint across the globe.</p>
              </div>
              <button onClick={() => setState(AppState.IDLE)} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"><X size={20} /></button>
            </div>
            <div ref={mapContainerRef} className="flex-1 w-full min-h-[500px] rounded-3xl overflow-hidden border border-white/5" />
          </div>
        )}

        {/* Loading States */}
        {(state === AppState.IDENTIFYING || state === AppState.SEARCHING) && (
          <div className="max-w-2xl mx-auto flex-1 flex flex-col items-center justify-center py-20">
             <div className="relative mb-16">
                <div className="absolute inset-0 bg-amber-500/20 blur-[80px] rounded-full animate-pulse" />
                <div className="relative w-48 h-48 rounded-full border border-white/5 p-2 bg-black/50 overflow-hidden">
                  <div className="absolute inset-0 border-t-2 border-amber-500 rounded-full animate-spin duration-[3s] z-10" />
                  <div className="w-full h-full rounded-full overflow-hidden border border-white/10">
                    <img src={capturedImage || 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?q=80&w=1000&auto=format&fit=crop'} className="w-full h-full object-cover grayscale opacity-50" />
                    <div className="absolute inset-0 flex items-center justify-center">
                       <div className="w-full h-1 bg-amber-500 shadow-[0_0_20px_#f59e0b] animate-scan-loading opacity-80" />
                    </div>
                  </div>
                </div>
             </div>
             <div className="text-center space-y-6">
                <h2 className="text-4xl font-serif font-bold text-white mb-2">
                  {state === AppState.IDENTIFYING ? "Analyzing Architecture..." : "Gathering Historical Data..."}
                </h2>
                <div className="h-8 overflow-hidden relative">
                   <div className="animate-slide-up-messages flex flex-col items-center">
                     <p className="text-zinc-500 italic h-8">Deciphering structural patterns...</p>
                     <p className="text-zinc-500 italic h-8">Cross-referencing global landmarks database...</p>
                     <p className="text-zinc-500 italic h-8">Querying historical archives for verified facts...</p>
                   </div>
                </div>
             </div>
          </div>
        )}

        {/* Error State */}
        {state === AppState.ERROR && (
          <div className="max-w-md mx-auto p-12 rounded-[2rem] bg-zinc-900 border border-white/5 text-center space-y-8 animate-in zoom-in-95 duration-500 my-auto">
            <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center mx-auto">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <div className="space-y-3">
              <h3 className="text-2xl font-bold tracking-tight">System Notice</h3>
              <p className="text-zinc-500 text-sm leading-relaxed">{error}</p>
            </div>
            <button onClick={reset} className="w-full py-4 rounded-2xl bg-white text-black font-black uppercase tracking-widest text-xs hover:bg-zinc-200 transition-all">Recalibrate</button>
          </div>
        )}

        {state === AppState.RESULT && result && (
          <NarratedExperience 
            result={result} 
            onBack={reset} 
            onExploreRelated={exploreRelated}
            onUpdateCache={updateAudioCache}
          />
        )}
      </main>

      {/* Footer Nav for Mobile */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-xl border-t border-white/5 px-8 py-4 flex justify-around items-center z-40">
        <button onClick={() => setState(AppState.HISTORY)} className={`flex flex-col items-center gap-1 ${state === AppState.HISTORY ? 'text-amber-500' : 'text-zinc-500'}`}>
          <Clock size={20} />
          <span className="text-[9px] font-bold uppercase">Journal</span>
        </button>
        <button onClick={() => setState(AppState.BOOKMARKS)} className={`flex flex-col items-center gap-1 ${state === AppState.BOOKMARKS ? 'text-amber-500' : 'text-zinc-500'}`}>
          <Bookmark size={20} />
          <span className="text-[9px] font-bold uppercase">Saved</span>
        </button>
        <button onClick={() => setState(AppState.MAP)} className={`flex flex-col items-center gap-1 ${state === AppState.MAP ? 'text-amber-500' : 'text-zinc-500'}`}>
          <Globe size={20} />
          <span className="text-[9px] font-bold uppercase">Map</span>
        </button>
      </div>

      <style>{`
        @keyframes scan-loading { 0% { top: 0; } 100% { top: 100%; } }
        .animate-scan-loading { animation: scan-loading 2s ease-in-out infinite alternate; }
        @keyframes spin-reverse { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        .animate-spin-reverse { animation: spin-reverse 4s linear infinite; }
        @keyframes slide-up-messages {
          0%, 30% { transform: translateY(0); }
          33%, 63% { transform: translateY(-32px); }
          66%, 96% { transform: translateY(-64px); }
          100% { transform: translateY(0); }
        }
        .animate-slide-up-messages { animation: slide-up-messages 9s infinite; }
      `}</style>
    </div>
  );
};

export default App;

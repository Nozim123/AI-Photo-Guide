
import React, { useRef, useState } from 'react';
import { Camera, Upload, Image as ImageIcon } from 'lucide-react';

interface CameraViewProps {
  onCapture: (base64: string) => void;
  disabled?: boolean;
}

export const CameraView: React.FC<CameraViewProps> = ({ onCapture, disabled }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      onCapture(result);
    };
    reader.readAsDataURL(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div 
      className={`relative w-full max-w-xl mx-auto h-80 rounded-3xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center p-8 bg-zinc-900/50 backdrop-blur-sm
        ${dragActive ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-700 hover:border-zinc-500'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && fileInputRef.current?.click()}
    >
      <input 
        type="file" 
        className="hidden" 
        ref={fileInputRef} 
        accept="image/*" 
        capture="environment"
        onChange={onFileChange} 
      />
      
      <div className="bg-zinc-800 p-6 rounded-full mb-6 ring-8 ring-zinc-900 shadow-xl">
        <Camera className="w-12 h-12 text-amber-400" />
      </div>
      
      <h3 className="text-xl font-medium mb-2">Snap or Upload</h3>
      <p className="text-zinc-400 text-center max-w-xs">
        Capture a landmark to reveal its history and experience an immersive tour.
      </p>
      
      <div className="absolute bottom-6 flex gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
          <Upload size={14} /> Upload
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
          <ImageIcon size={14} /> Browse
        </div>
      </div>
    </div>
  );
};

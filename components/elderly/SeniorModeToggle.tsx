'use client';

import { useCareMode } from '@/context/CareModeContext';
import { Eye, Volume2, Sparkles } from 'lucide-react';

export function SeniorModeToggle() {
  const { mode, toggleSeniorMode, audioFeedback, setAudioFeedback, speakText } = useCareMode();

  const handleToggle = () => {
    toggleSeniorMode();
    if (mode === 'standard') {
      speakText('Senior mode activated. Text size increased.');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleToggle}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all shadow-sm ${
          mode === 'senior'
            ? 'bg-amber-100 text-amber-900 border-amber-300 ring-2 ring-amber-400'
            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
        }`}
        aria-pressed={mode === 'senior'}
        title="Toggle Senior Mode: Larger text, higher contrast, and simplified layout"
      >
        <Eye className={`w-3.5 h-3.5 ${mode === 'senior' ? 'text-amber-700' : 'text-slate-500'}`} />
        <span>Senior Mode: {mode === 'senior' ? 'ON' : 'OFF'}</span>
      </button>

      {mode === 'senior' && (
        <button
          onClick={() => {
            const next = !audioFeedback;
            setAudioFeedback(next);
            if (next) speakText('Voice assistance enabled.');
          }}
          className={`p-1.5 rounded-full border text-xs ${
            audioFeedback
              ? 'bg-sky-100 text-sky-800 border-sky-300 ring-1 ring-sky-400'
              : 'bg-white text-slate-500 border-slate-200'
          }`}
          title="Toggle Voice Assistance"
        >
          <Volume2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

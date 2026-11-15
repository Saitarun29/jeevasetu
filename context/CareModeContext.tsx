'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type AppMode = 'standard' | 'senior';
export type FontSize = 'normal' | 'large' | 'extra-large';

interface CareModeContextType {
  mode: AppMode;
  fontSize: FontSize;
  highContrast: boolean;
  audioFeedback: boolean;
  toggleSeniorMode: () => void;
  setFontSize: (size: FontSize) => void;
  setHighContrast: (enabled: boolean) => void;
  setAudioFeedback: (enabled: boolean) => void;
  speakText: (text: string) => void;
}

const CareModeContext = createContext<CareModeContextType | undefined>(undefined);

export function CareModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppMode>('standard');
  const [fontSize, setFontSizeState] = useState<FontSize>('normal');
  const [highContrast, setHighContrastState] = useState<boolean>(false);
  const [audioFeedback, setAudioFeedbackState] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem('jeevasetu_mode') as AppMode | null;
      if (savedMode === 'senior') {
        setMode('senior');
        setFontSizeState('large');
        setHighContrastState(true);
      }
    }
  }, []);

  const toggleSeniorMode = () => {
    setMode((prev) => {
      const next = prev === 'standard' ? 'senior' : 'standard';
      if (typeof window !== 'undefined') {
        localStorage.setItem('jeevasetu_mode', next);
      }
      if (next === 'senior') {
        setFontSizeState('large');
        setHighContrastState(true);
      } else {
        setFontSizeState('normal');
        setHighContrastState(false);
      }
      return next;
    });
  };

  const setFontSize = (size: FontSize) => {
    setFontSizeState(size);
    if (typeof window !== 'undefined') {
      localStorage.setItem('jeevasetu_font_size', size);
    }
  };

  const setHighContrast = (enabled: boolean) => {
    setHighContrastState(enabled);
    if (typeof window !== 'undefined') {
      localStorage.setItem('jeevasetu_contrast', enabled ? 'high' : 'normal');
    }
  };

  const setAudioFeedback = (enabled: boolean) => {
    setAudioFeedbackState(enabled);
  };

  // Safe Web Speech API TTS reader for elderly users
  // Invariant: Speech reads instructions only; it NEVER records medication as taken
  const speakText = (text: string) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Stop any pending speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9; // Slightly slower, clear cadence for elderly comprehension
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <CareModeContext.Provider
      value={{
        mode,
        fontSize,
        highContrast,
        audioFeedback,
        toggleSeniorMode,
        setFontSize,
        setHighContrast,
        setAudioFeedback,
        speakText,
      }}
    >
      <div
        className={`${
          mode === 'senior' ? 'senior-mode' : ''
        } ${highContrast ? 'high-contrast' : ''} ${
          fontSize === 'large'
            ? 'text-lg'
            : fontSize === 'extra-large'
            ? 'text-xl'
            : 'text-base'
        }`}
      >
        {children}
      </div>
    </CareModeContext.Provider>
  );
}

export function useCareMode() {
  const context = useContext(CareModeContext);
  if (!context) {
    throw new Error('useCareMode must be used within a CareModeProvider');
  }
  return context;
}
